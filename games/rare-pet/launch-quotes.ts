import { formatUnits, parseAbi, type Address } from 'viem';
import type { createPetPublicClient } from './wallet';

/** Issuer/Chainlink addresses checked against their primary registries on 2026-09-26.
 * https://docs.robinhood.com/chain/contracts/
 * https://api.robinhood.com/rhj/assets
 * https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json
 * Bankr's STOCKS option selects an individual stock; there is no STOCKS token.
 */
export const LAUNCH_QUOTE_ASSETS = Object.freeze([
  { id: 'weth', chainId: 4663, address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'WETH', name: 'Wrapped Ether', kind: 'weth', decimals: 18,
    feedAddress: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9', feedDescription: 'ETH / USD', feedName: 'ETH / USD' },
  { id: 'nvda', chainId: 4663, address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', symbol: 'NVDA', name: 'NVIDIA', kind: 'stock', decimals: 18,
    feedAddress: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15', feedDescription: 'RHNVDA / USD', feedName: 'Robinhood NVDA / USD' },
  { id: 'aapl', chainId: 4663, address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', symbol: 'AAPL', name: 'Apple', kind: 'stock', decimals: 18,
    feedAddress: '0x6B22A786bAa607d76728168703a39Ea9C99f2cD0', feedDescription: 'Robinhood AAPL / USD', feedName: 'Robinhood AAPL / USD' },
  { id: 'tsla', chainId: 4663, address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', symbol: 'TSLA', name: 'Tesla', kind: 'stock', decimals: 18,
    feedAddress: '0x4A1166a659A55625345e9515b32adECea5547C38', feedDescription: 'RHTSLA / USD', feedName: 'Robinhood TSLA / USD' },
  { id: 'spy', chainId: 4663, address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', symbol: 'SPY', name: 'SPDR S&P 500 ETF', kind: 'stock', decimals: 18,
    feedAddress: '0x319724394D3A0e3669269846abE664Cd621f9f6A', feedDescription: 'RHSPY / USD', feedName: 'Robinhood SPY / USD' },
].map(asset => Object.freeze(asset)) as readonly Readonly<{
  id: 'weth' | 'nvda' | 'aapl' | 'tsla' | 'spy'; chainId: 4663; address: Address; symbol: string; name: string;
  kind: 'weth' | 'stock'; decimals: 18; feedAddress: Address; feedDescription: string; feedName: string;
}>[]);
export type LaunchQuoteAsset = typeof LAUNCH_QUOTE_ASSETS[number];
export type LaunchQuoteId = LaunchQuoteAsset['id'];
export type LaunchQuotePrice = Readonly<{
  asset: LaunchQuoteAsset; usdPrice: string; usdPriceE18: bigint; blockNumber: bigint;
  updatedAt: number; readAt: number; expiresAt: number; heartbeatSeconds: number;
  source: 'chainlink'; feedAddress: Address;
  /** No canonical Robinhood sequencer uptime address is published in the verified registry. */
  sequencerVerified: false;
}>;

const QUOTE_ABI = parseAbi([
  'function decimals() view returns (uint8)', 'function symbol() view returns (string)',
  'function description() view returns (string)', 'function oraclePaused() view returns (bool)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);
const DIRECTORY_URL = '/api/launch-quotes';
const MAX_JSON_BYTES = 2_000_000;
const MAX_HEARTBEAT_SECONDS = 86_400;
const MAX_REVIEW_AGE_SECONDS = 120;
type QuoteClient = Pick<ReturnType<typeof createPetPublicClient>, 'getChainId' | 'getBlock' | 'getCode' | 'readContract'>;
type Dependencies = { clientFactory?: (signal?: AbortSignal) => QuoteClient | Promise<QuoteClient>; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const list = (value: unknown) => Array.isArray(value) && value.length <= 2_000 ? value : [];
const hasCode = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) && value !== '0x0';

/** Resolves only the pinned picker IDs, never an arbitrary contract supplied by a form. */
export function getLaunchQuoteAsset(id: string): LaunchQuoteAsset {
  const asset = LAUNCH_QUOTE_ASSETS.find(item => item.id === id);
  if (!asset) throw new Error('Choose a supported WETH or stock pair.');
  return asset;
}

function verifyDirectory(value: unknown, asset: LaunchQuoteAsset) {
  const directory = object(value), bankr = object(directory.bankr);
  if (bankr.chain !== 'robinhood' || bankr.provider !== 'doppler') throw new Error('Quote registry is not for Robinhood Doppler.');
  const pairs = list(bankr.quoteTokens).map(object).filter(row => same(row.address, asset.address));
  if (pairs.length !== 1 || pairs[0].symbol !== asset.symbol || pairs[0].kind !== (asset.kind === 'weth' ? 'major' : 'stock')) {
    throw new Error('The selected pair no longer matches the verified quote registry.');
  }
  if (asset.kind === 'stock') {
    const stocks = list(object(directory.robinhood).assets).map(object).filter(row => row.tokenSymbol === asset.symbol);
    const stock = stocks.find(row => list(row.deployments).some(deployment => {
      const item = object(deployment); return item.chainId === 4663 && same(item.contractAddress, asset.address);
    }));
    if (stocks.length !== 1 || !stock || stock.status !== 'ASSET_STATUS_ACTIVE' || stock.tokenDecimals !== asset.decimals) {
      throw new Error('The stock is not an active, verified Robinhood Chain token.');
    }
  }
  const feeds = list(directory.chainlink).map(object).filter(row => same(row.proxyAddress, asset.feedAddress));
  const feed = feeds[0], docs = object(feed?.docs);
  if (feeds.length !== 1 || feed.name !== asset.feedName || feed.decimals !== 8 || docs.blockchainName !== 'Robinhood'
    || docs.baseAsset !== (asset.kind === 'weth' ? 'ETH' : asset.symbol) || docs.quoteAsset !== 'USD'
    || docs.assetClass !== (asset.kind === 'weth' ? 'Crypto' : 'Equity')
    || typeof feed.heartbeat !== 'number' || !Number.isInteger(feed.heartbeat) || feed.heartbeat <= 0 || feed.heartbeat > MAX_HEARTBEAT_SECONDS) {
    throw new Error('The USD feed no longer matches the verified Robinhood Chainlink registry.');
  }
  return feed.heartbeat;
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) throw new Error(`Quote verification service is unavailable (${response.status}). Retry before launching.`);
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Quote verification did not return JSON.');
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength; if (total > MAX_JSON_BYTES) throw new Error('Quote registry response is too large.'); parts.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Public reads only. Prices are exact; Chainlink stock feeds already include the corporate-action multiplier. */
export function createLaunchQuoteReader(dependencies: Dependencies = {}) {
  const clientFactory = dependencies.clientFactory ?? (async (signal?: AbortSignal) => (await import('./wallet')).createPetPublicClient(signal));
  const fetcher = dependencies.fetcher ?? fetch, now = dependencies.now ?? Date.now;
  async function readLaunchQuotePrice(id: LaunchQuoteId, callerSignal?: AbortSignal): Promise<LaunchQuotePrice> {
    const asset = getLaunchQuoteAsset(id), controller = new AbortController();
    const abort = () => controller.abort(callerSignal?.reason); callerSignal?.addEventListener('abort', abort, { once: true });
    if (callerSignal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error('Quote verification timed out. Retry before launching.')), dependencies.timeoutMs ?? 20_000);
    const signal = controller.signal;
    try {
      signal.throwIfAborted(); const client = await clientFactory(signal); signal.throwIfAborted();
      if (await client.getChainId() !== 4663) throw new Error('Quote RPC must be Robinhood mainnet (4663).');
      const [directory, block] = await Promise.all([
        fetcher(DIRECTORY_URL, { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal }).then(response => boundedJson(response, signal)),
        client.getBlock({ blockTag: 'latest' }),
      ]);
      signal.throwIfAborted(); const heartbeatSeconds = verifyDirectory(directory, asset);
      const readAt = Math.floor(now() / 1_000);
      if (typeof block.number !== 'bigint' || block.number < 0n || typeof block.timestamp !== 'bigint'
        || block.timestamp > BigInt(readAt + 30) || block.timestamp < BigInt(readAt - 120)) throw new Error('Robinhood latest block is stale. Retry before launching.');
      const blockNumber = block.number;
      const tokenRead = (functionName: 'decimals' | 'symbol' | 'oraclePaused') => client.readContract({ address: asset.address, abi: QUOTE_ABI, functionName, blockNumber });
      const feedRead = (functionName: 'decimals' | 'description' | 'latestRoundData') => client.readContract({ address: asset.feedAddress, abi: QUOTE_ABI, functionName, blockNumber });
      const [tokenCode, feedCode, decimals, symbol, feedDecimals, description, round, paused] = await Promise.all([
        client.getCode({ address: asset.address, blockNumber }), client.getCode({ address: asset.feedAddress, blockNumber }),
        tokenRead('decimals'), tokenRead('symbol'), feedRead('decimals'), feedRead('description'), feedRead('latestRoundData'),
        asset.kind === 'stock' ? tokenRead('oraclePaused') : Promise.resolve(false),
      ]);
      signal.throwIfAborted();
      if (!hasCode(tokenCode) || !hasCode(feedCode)) throw new Error('The selected quote token or USD feed has no deployed code.');
      if (decimals !== asset.decimals || symbol !== asset.symbol || feedDecimals !== 8 || description !== asset.feedDescription) throw new Error('Onchain quote metadata does not match the verified pair.');
      if (paused !== false) throw new Error('This stock oracle is paused for a corporate action. Choose another pair or retry later.');
      if (!Array.isArray(round) || round.length !== 5 || round.some(value => typeof value !== 'bigint')) throw new Error('USD oracle returned an invalid round.');
      const [roundId, answer, startedAt, updated, answeredInRound] = round as readonly bigint[];
      const checkedAt = Math.floor(now() / 1_000);
      if (roundId <= 0n || answeredInRound < roundId || answer <= 0n || answer >= 1n << 255n || startedAt <= 0n || startedAt > updated
        || updated <= 0n || updated > BigInt(checkedAt + 30) || updated > block.timestamp || updated < BigInt(checkedAt - heartbeatSeconds)) {
        throw new Error('USD oracle is stale or its round is incomplete. Retry when a fresh price is available.');
      }
      if (await client.getChainId() !== 4663) throw new Error('Quote RPC changed networks. Retry on Robinhood mainnet.');
      signal.throwIfAborted();
      const usdPriceE18 = answer * 10n ** 10n, updatedAt = Number(updated);
      return Object.freeze({ asset, usdPrice: formatUnits(usdPriceE18, 18), usdPriceE18, blockNumber, updatedAt, readAt: checkedAt,
        expiresAt: Math.min(checkedAt + MAX_REVIEW_AGE_SECONDS, updatedAt + heartbeatSeconds), heartbeatSeconds,
        source: 'chainlink', feedAddress: asset.feedAddress, sequencerVerified: false });
    } finally { clearTimeout(timer); callerSignal?.removeEventListener('abort', abort); }
  }
  return { readLaunchQuotePrice };
}

export const { readLaunchQuotePrice } = createLaunchQuoteReader();
