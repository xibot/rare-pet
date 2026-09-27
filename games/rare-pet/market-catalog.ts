import { airlockAbi, computePoolId, dopplerHookInitializerAbi } from '@whetstone-research/doppler-sdk/evm';
import { isAddress, keccak256, parseAbi, parseEventLogs, stringToHex, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';
import { RARE_LAUNCH_DOPPLER, RARE_LAUNCH_FEES, RARE_LAUNCH_ROUTER_ABI } from './launch-doppler.ts';
import { ARCHIVED_LAUNCH_ROUTERS } from './launch-router-history.ts';
import { LAUNCH_QUOTE_ASSETS, type LaunchQuoteAsset } from './launch-quotes.ts';

/** Exact deployed routers; changing a build-time launch address cannot add an arbitrary market. */
export const RARE_MARKET_ROUTERS = Object.freeze([
  Object.freeze({ address: '0xc6a4b2D4D369747B26e4Ff805a79A57da2505dC3' as Address, fromBlock: 73457586n,
    runtimeCodeHash: '0xaceed1b3c1e28af617fe78ca850a4b29c391aec09a90fd05258261637c183149' as Hex }),
  ...ARCHIVED_LAUNCH_ROUTERS,
]);
export type RareMarketPoolKey = Readonly<{ currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }>;
export type RareMarketToken = Readonly<{
  asset: Address; name: string; symbol: string; decimals: 18; imageUrl: string | null;
  router: Address; creator: Address; mode: 'self' | 'friend'; collection: Address | null; tokenId: string | null;
  quote: LaunchQuoteAsset; fee: number; poolKey: RareMarketPoolKey; poolId: Hex;
  hash: Hex; timestamp: bigint; blockNumber: bigint;
}>;
/** A cursor belongs to the reader that returned it. It is not accepted from URLs/storage. */
export type RareMarketCursor = Readonly<{ snapshot: bigint; snapshotHash: Hex; nextToBlock: bigint }>;
export type RareMarketPage = Readonly<{
  items: readonly RareMarketToken[]; cursor: RareMarketCursor | null; complete: boolean;
  blockNumber: bigint; blockHash: Hex; scannedFromBlock: bigint; scannedToBlock: bigint;
}>;
export type RareMarketClient = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'getLogs' | 'readContract' | 'getTransactionReceipt'>;
type Dependencies = { clientFactory?: (signal?: AbortSignal) => RareMarketClient | Promise<RareMarketClient> };
const FIRST_BLOCK = RARE_MARKET_ROUTERS.reduce((lowest, router) => router.fromBlock < lowest ? router.fromBlock : lowest, RARE_MARKET_ROUTERS[0].fromBlock);
const LOG_RANGE = 10_000n, RANGES_PER_PAGE = 8, MAX_RANGE_EVENTS = 64;
const COLLECTIONS = ['0x116eaa62241751e0c98da43d458600c6c17cd361', '0x14c49e6118f46525de9ab41a51cbaa3c6ebf181d'];
const TOKEN_ABI = parseAbi(['function name() view returns(string)', 'function symbol() view returns(string)', 'function decimals() view returns(uint8)', 'function tokenURI() view returns(string)']);
const EVENTS = RARE_LAUNCH_ROUTER_ABI.filter(item => item.type === 'event');
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const validAddress = (value: unknown): value is Address => typeof value === 'string' && isAddress(value) && !equal(value, zeroAddress);
const validHash = (value: unknown): value is Hex => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const cleanText = (value: unknown, limit: number): string | null => typeof value === 'string'
  ? value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, limit) || null : null;

/** Only the app's raster image store or a content-addressed IPFS image can be embedded. */
export function safeMarketImageURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) return null;
  if (/^ipfs:\/\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{20,120})(?:\/[A-Za-z0-9._~-]+)*$/.test(value)) {
    return `https://ipfs.io/ipfs/${value.slice(7)}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)
      || !/^\/rare-launchpad\/4663\/(?:self\/0x[0-9a-f]{40}|0x[0-9a-f]{40}\/[1-9][0-9]{0,77})\/images\/[0-9a-f]{64}\.png$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

/** Inline launch metadata is optional display data, never a source of contracts or trade routes. */
export function marketMetadataImage(uri: unknown, metadataHash: Hex): string | null {
  if (typeof uri !== 'string' || uri.length > 4096 || !/^data:application\/json;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri)
    || !equal(keccak256(stringToHex(uri)), metadataHash)) return null;
  try {
    const json: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(uri.slice(29)), c => c.charCodeAt(0))));
    return json && typeof json === 'object' && !Array.isArray(json) ? safeMarketImageURL((json as Record<string, unknown>).image) : null;
  } catch { return null; }
}

type LaunchEvent = {
  address: Address; blockNumber: bigint; blockHash: Hex; transactionHash: Hex; logIndex: number; data: Hex; topics: readonly Hex[];
  eventName: 'LaunchRecorded' | 'SelfLaunchRecorded';
  args: { asset: Address; quote: Address; fee: number; metadataHash: Hex; timestamp: bigint; creator?: Address; collection?: Address; tokenId?: bigint; friendWallet?: Address; owner?: Address };
};

export function createRareMarketCatalog(dependencies: Dependencies = {}) {
  const clientFactory = dependencies.clientFactory ?? (async (signal?: AbortSignal) => (await import('./wallet')).createPetPublicClient(signal));
  const cursors = new WeakSet<RareMarketCursor>();
  let rangeLimited = false;
  async function readPage(input: { cursor?: RareMarketCursor | null; signal?: AbortSignal } = {}): Promise<RareMarketPage> {
    const { cursor, signal } = input;
    signal?.throwIfAborted();
    if (cursor && !cursors.has(cursor)) throw new Error('Refresh the market to start a new catalog scan.');
    const client = await clientFactory(signal);
    if (await client.getChainId() !== 4663) throw new Error('Markets require Robinhood mainnet (4663).');
    const blockNumber = cursor?.snapshot ?? await client.getBlockNumber({ cacheTime: 0 });
    const block = await client.getBlock({ blockNumber });
    if (!validHash(block.hash) || cursor && !equal(block.hash, cursor.snapshotHash)) throw new Error('The market snapshot changed. Refresh the catalog.');
    const blockHash = block.hash;
    if (blockNumber < FIRST_BLOCK) throw new Error('The RPC is behind the Rare Launchpad deployments. Retry with a current mainnet connection.');
    await Promise.all(RARE_MARKET_ROUTERS.filter(router => router.fromBlock <= blockNumber).map(async router => {
      const code = await client.getCode({ address: router.address, blockNumber });
      if (!code || keccak256(code) !== router.runtimeCodeHash) throw new Error('A market router does not match its verified deployment.');
    }));
    signal?.throwIfAborted();
    const scannedToBlock = cursor?.nextToBlock ?? blockNumber;
    let nextToBlock = scannedToBlock, scannedFromBlock = scannedToBlock;
    const events: LaunchEvent[] = [];
    for (let range = 0; range < RANGES_PER_PAGE && nextToBlock >= FIRST_BLOCK; range++) {
      // Address + topic filtering supports the full deployed history on the public
      // mainnet RPC. Keep sparse catalogs complete in one request, with bounded
      // 10k-block fallback for providers that explicitly impose a range limit.
      let fromBlock = rangeLimited ? nextToBlock - LOG_RANGE + 1n : FIRST_BLOCK;
      if (fromBlock < FIRST_BLOCK) fromBlock = FIRST_BLOCK;
      // Busy ranges are narrowed instead of silently truncating a page of launches.
      let logs;
      for (;;) {
        signal?.throwIfAborted();
        try {
          logs = await client.getLogs({ address: RARE_MARKET_ROUTERS.filter(router => router.fromBlock <= nextToBlock).map(router => router.address),
            events: EVENTS, fromBlock, toBlock: nextToBlock, strict: true });
        } catch (cause) {
          if (nextToBlock - fromBlock >= LOG_RANGE && cause instanceof Error && /block range|too many (?:results|logs)|response size|query (?:timeout|returned)|limit exceeded|exceeds? (?:the |maximum )?(?:range|limit)/i.test(cause.message)) {
            rangeLimited = true; fromBlock = nextToBlock - LOG_RANGE + 1n;
            if (fromBlock < FIRST_BLOCK) fromBlock = FIRST_BLOCK;
            continue;
          }
          throw cause;
        }
        if (logs.length <= MAX_RANGE_EVENTS) break;
        if (fromBlock === nextToBlock) throw new Error('This block contains too many launches for a complete catalog page. Inspect it on the explorer.');
        fromBlock = (fromBlock + nextToBlock + 1n) / 2n;
      }
      for (const log of logs) {
        const router = RARE_MARKET_ROUTERS.find(item => equal(item.address, log.address));
        const a = log.args as LaunchEvent['args'];
        if (!router || log.removed || typeof log.blockNumber !== 'bigint' || log.blockNumber < fromBlock || log.blockNumber < router.fromBlock
          || log.blockNumber > nextToBlock || !validHash(log.blockHash) || !validHash(log.transactionHash) || !Number.isSafeInteger(log.logIndex) || log.logIndex! < 0
          || !validAddress(a.asset) || !validAddress(a.quote) || equal(a.asset, a.quote) || !validHash(a.metadataHash)
          || !RARE_LAUNCH_FEES.includes(a.fee as typeof RARE_LAUNCH_FEES[number]) || typeof a.timestamp !== 'bigint' || a.timestamp <= 0n || a.timestamp > block.timestamp
          || !LAUNCH_QUOTE_ASSETS.some(quote => equal(quote.address, a.quote))) throw new Error('An invalid launch event was returned. Refresh the market.');
        if (log.eventName === 'LaunchRecorded') {
          if (!validAddress(a.collection) || !COLLECTIONS.includes(a.collection.toLowerCase()) || typeof a.tokenId !== 'bigint' || a.tokenId <= 0n
            || !validAddress(a.friendWallet) || !validAddress(a.owner)) throw new Error('The Friend launch identity could not be verified.');
        } else if (log.eventName !== 'SelfLaunchRecorded' || !validAddress(a.creator)) throw new Error('The creator launch identity could not be verified.');
        events.push(log as LaunchEvent);
      }
      scannedFromBlock = fromBlock; nextToBlock = fromBlock - 1n;
      // Return populated pages promptly; empty pages still report how much history remains.
      if (events.length) break;
    }
    const seen = new Set<string>();
    for (const event of events) {
      if (seen.has(event.args.asset.toLowerCase())) throw new Error('The market history contains a duplicate asset. Refresh the catalog.');
      seen.add(event.args.asset.toLowerCase());
    }
    const items: RareMarketToken[] = [];
    // Small batches avoid issuing hundreds of simultaneous RPC reads on an active launch day.
    for (let start = 0; start < events.length; start += 4) {
      signal?.throwIfAborted();
      const batch = await Promise.all(events.slice(start, start + 4).map(async event => {
        const { asset, quote: quoteAddress, fee, metadataHash, timestamp } = event.args;
        const [receipt, eventBlock, launched, state, name, symbol, decimals, uri] = await Promise.all([
          client.getTransactionReceipt({ hash: event.transactionHash }), client.getBlock({ blockNumber: event.blockNumber }),
          client.readContract({ address: event.address, abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'launchedAsset', args: [asset], blockNumber }),
          client.readContract({ address: RARE_LAUNCH_DOPPLER.initializer, abi: dopplerHookInitializerAbi, functionName: 'getState', args: [asset], blockNumber }),
          client.readContract({ address: asset, abi: TOKEN_ABI, functionName: 'name', blockNumber }),
          client.readContract({ address: asset, abi: TOKEN_ABI, functionName: 'symbol', blockNumber }),
          client.readContract({ address: asset, abi: TOKEN_ABI, functionName: 'decimals', blockNumber }),
          client.readContract({ address: asset, abi: TOKEN_ABI, functionName: 'tokenURI', blockNumber }).catch(() => null),
        ]);
        signal?.throwIfAborted();
        if (receipt.status !== 'success' || !equal(receipt.transactionHash, event.transactionHash) || receipt.blockNumber !== event.blockNumber
          || !equal(receipt.blockHash, event.blockHash) || eventBlock.hash !== receipt.blockHash || eventBlock.timestamp !== timestamp
          || !receipt.logs.some(log => log.logIndex === event.logIndex && equal(log.address, event.address) && log.data === event.data
            && log.topics.length === event.topics.length && log.topics.every((topic, i) => topic === event.topics[i]))) {
          throw new Error('A launch receipt is no longer canonical. Refresh the catalog.');
        }
        const created = parseEventLogs({ abi: airlockAbi, eventName: 'Create', strict: true, logs: receipt.logs.filter(log => equal(log.address, RARE_LAUNCH_DOPPLER.airlock)) })
          .filter(log => equal(log.args.asset, asset) && equal(log.args.numeraire, quoteAddress)
            && equal(log.args.initializer, RARE_LAUNCH_DOPPLER.initializer) && equal(log.args.poolOrHook, asset));
        const poolKey = state[5];
        const currencies = [asset, quoteAddress].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
        if (!launched || created.length !== 1 || state[4] !== 2 || !equal(state[0], quoteAddress)
          || !equal(poolKey.currency0, currencies[0]) || !equal(poolKey.currency1, currencies[1]) || poolKey.fee !== fee
          || poolKey.tickSpacing !== 200 || !equal(poolKey.hooks, RARE_LAUNCH_DOPPLER.initializer) || decimals !== 18) {
          throw new Error('A launched token does not match its locked Doppler market. Refresh the catalog.');
        }
        const quote = LAUNCH_QUOTE_ASSETS.find(item => equal(item.address, quoteAddress))!;
        const friend = event.eventName === 'LaunchRecorded';
        return Object.freeze({ asset, name: cleanText(name, 64) ?? 'RarePet token', symbol: cleanText(symbol, 16) ?? 'TOKEN', decimals: 18 as const,
          imageUrl: marketMetadataImage(uri, metadataHash), router: event.address, creator: friend ? event.args.friendWallet! : event.args.creator!,
          mode: friend ? 'friend' as const : 'self' as const, collection: friend ? event.args.collection! : null, tokenId: friend ? event.args.tokenId!.toString() : null,
          quote, fee, poolKey: Object.freeze({ ...poolKey }), poolId: computePoolId(poolKey), hash: event.transactionHash, timestamp, blockNumber: event.blockNumber });
      }));
      items.push(...batch);
    }
    const current = await client.getBlock({ blockNumber });
    if (current.hash !== blockHash || await client.getChainId() !== 4663) throw new Error('The market snapshot changed. Refresh the catalog.');
    signal?.throwIfAborted();
    const complete = nextToBlock < FIRST_BLOCK;
    const next = complete ? null : Object.freeze({ snapshot: blockNumber, snapshotHash: blockHash, nextToBlock });
    if (next) cursors.add(next);
    return Object.freeze({ items: Object.freeze(items.sort((a, b) => a.blockNumber === b.blockNumber ? a.asset.localeCompare(b.asset) : a.blockNumber > b.blockNumber ? -1 : 1)),
      cursor: next, complete, blockNumber, blockHash, scannedFromBlock, scannedToBlock });
  }
  return { readPage };
}
export const readRareMarketPage = createRareMarketCatalog().readPage;
