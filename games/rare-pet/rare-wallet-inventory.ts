import { decodeAbiParameters, isAddress, keccak256, padHex, toHex, zeroAddress, type Address, type Hex } from 'viem';
import { createPetPublicClient, PET_DEPLOYMENT } from './wallet';
import { readTokenHolding, readNftHolding, HoldingNotOwnedError, type TokenHolding, type NftHolding } from './rare-wallet-holdings';

const TRANSFER = keccak256(toHex('Transfer(address,address,uint256)'));
const SINGLE = keccak256(toHex('TransferSingle(address,address,address,uint256,uint256)'));
const BATCH = keccak256(toHex('TransferBatch(address,address,address,uint256[],uint256[])'));
const MAX_LOGS = 5000, MIN_SPLIT_RANGE = 1000n;
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uintTopic = (value: unknown): value is Hex => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value);
const validAddress = (value: unknown): value is Address => typeof value === 'string' && isAddress(value, { strict: false }) && !equal(value, zeroAddress);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

type Candidate = { kind: 'erc20'; contract: Address } | { kind: 'erc721' | 'erc1155'; contract: Address; tokenId: string };
type Range = { kind: 'transfer' | 'erc1155'; from: bigint; to: bigint };
export type InventoryLogFilter = { fromBlock: Hex; toBlock: Hex; topics: readonly (Hex | readonly Hex[] | null)[] };
type InventoryClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getLogs(filter: InventoryLogFilter): Promise<unknown>;
};
type HoldingsReader = { readTokenHolding: typeof readTokenHolding; readNftHolding: typeof readNftHolding };
export type InventoryProgress = Readonly<{
  phase: 'history' | 'balances'; scannedBlocks: bigint; totalBlocks: bigint; candidates: number; checked: number;
}>;
/** Opaque, in-memory continuation, bound to one wallet and one Robinhood snapshot. */
export type InventoryCursor = Readonly<{ wallet: Address; blockNumber: bigint; source: 'rpc' }>;
export type RareWalletInventoryCursor = InventoryCursor;
export type RareWalletInventory = Readonly<{
  tokens: readonly TokenHolding[]; nfts: readonly NftHolding[]; warnings: readonly string[];
  /** Complete standard Transfer/TransferSingle/TransferBatch history and balance checks. */
  complete: boolean; blockNumber: bigint; cursor: InventoryCursor | null; source: 'rpc';
}>;
export type InventoryReadOptions = { cursor?: InventoryCursor | null; onProgress?: (progress: InventoryProgress) => void };
type ReaderOptions = {
  client?: InventoryClient; holdings?: HoldingsReader;
  maxLogRequests?: number; maxBalanceChecks?: number; logTimeoutMs?: number; scanBudgetMs?: number;
  balanceBudgetMs?: number; balanceTimeoutMs?: number; balancePauseMs?: number;
};
type State = {
  wallet: Address; block: bigint; ranges: Range[]; scanned: bigint;
  candidates: Map<string, Candidate>; checked: Set<string>; tokens: Map<string, TokenHolding>; nfts: Map<string, NftHolding>;
  invalidLogs: number; failedChecks: number;
};
const candidateKey = (value: Candidate) => `${value.kind}:${value.contract.toLowerCase()}:${'tokenId' in value ? value.tokenId : ''}`;

/** Timeout also races non-cooperative test/providers; the real transport is aborted. */
async function deadline<T>(outer: AbortSignal | undefined, timeout: number, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(outer?.reason);
  outer?.addEventListener('abort', cancel, { once: true });
  if (outer?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new Error('Robinhood inventory request timed out.')), timeout);
  let listener: (() => void) | undefined;
  try {
    controller.signal.throwIfAborted();
    const stopped = new Promise<never>((_, reject) => {
      listener = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', listener, { once: true });
    });
    return await Promise.race([read(controller.signal), stopped]);
  } finally {
    clearTimeout(timer); outer?.removeEventListener('abort', cancel);
    if (listener) controller.signal.removeEventListener('abort', listener);
  }
}

function rpc(signal: AbortSignal): InventoryClient {
  const client = createPetPublicClient(signal);
  return {
    getChainId: () => client.getChainId(), getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    getLogs: filter => client.request({ method: 'eth_getLogs', params: [{ ...filter, topics: [...filter.topics].map(topic => Array.isArray(topic) ? [...topic] : topic) }] }),
  };
}

function parseTransfer(value: unknown, wallet: Address, range: Range): Candidate[] {
  if (!record(value) || !validAddress(value.address) || !Array.isArray(value.topics) || typeof value.data !== 'string' || typeof value.blockNumber !== 'string' || !/^0x[\da-f]+$/i.test(value.blockNumber)) throw new Error('Invalid transfer log.');
  const block = BigInt(value.blockNumber), topics = value.topics;
  if (value.removed === true || block < range.from || block > range.to || !topics.every(uintTopic)) throw new Error('Transfer log is outside the pinned snapshot.');
  const target = padHex(wallet, { size: 32 }).toLowerCase();
  if (range.kind === 'transfer') {
    if (topics[0]?.toLowerCase() !== TRANSFER || topics[2]?.toLowerCase() !== target) throw new Error('Transfer recipient does not match this wallet.');
    if (topics.length === 3 && /^0x[\da-f]{64}$/i.test(value.data)) return [{ kind: 'erc20', contract: value.address }];
    if (topics.length === 4 && value.data === '0x') return [{ kind: 'erc721', contract: value.address, tokenId: String(BigInt(topics[3])) }];
    throw new Error('Unsupported Transfer event shape.');
  }
  if (topics.length !== 4 || topics[3]?.toLowerCase() !== target) throw new Error('NFT transfer recipient does not match this wallet.');
  if (topics[0].toLowerCase() === SINGLE) {
    if (!/^0x[\da-f]{128}$/i.test(value.data)) throw new Error('Invalid single NFT transfer.');
    const [id, amount] = decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], value.data as Hex);
    return amount > 0n ? [{ kind: 'erc1155', contract: value.address, tokenId: String(id) }] : [];
  }
  if (topics[0].toLowerCase() !== BATCH || !/^0x[\da-f]+$/i.test(value.data) || value.data.length > 500_000) throw new Error('Invalid NFT batch.');
  const [ids, amounts] = decodeAbiParameters([{ type: 'uint256[]' }, { type: 'uint256[]' }], value.data as Hex);
  if (ids.length !== amounts.length || ids.length > 2000) throw new Error('NFT batch is too large or incomplete.');
  return ids.flatMap((id, index) => amounts[index] > 0n ? [{ kind: 'erc1155' as const, contract: value.address as Address, tokenId: String(id) }] : []);
}

/** Discover from public recipient-filtered logs; validate current balances at the same block. */
export function createRareWalletInventoryReader(options: ReaderOptions = {}) {
  const cursors = new WeakMap<InventoryCursor, State>();
  const holdings = options.holdings ?? { readTokenHolding, readNftHolding };
  const maxRequests = options.maxLogRequests ?? 12, maxChecks = options.maxBalanceChecks ?? 48;
  const call = <T,>(signal: AbortSignal | undefined, read: (client: InventoryClient) => Promise<T>) =>
    deadline(signal, options.logTimeoutMs ?? 7000, active => read(options.client ?? rpc(active)));
  return async function readRareWalletInventory(wallet: Address, signal?: AbortSignal, readOptions: InventoryReadOptions = {}): Promise<RareWalletInventory> {
    if (!validAddress(wallet)) throw new Error('Choose a valid Rare Friend wallet to discover its assets.');
    signal?.throwIfAborted();
    if (await call(signal, client => client.getChainId()) !== PET_DEPLOYMENT.chainId) throw new Error('Wallet inventory requires Robinhood Chain (4663).');
    let state: State;
    if (readOptions.cursor) {
      const saved = cursors.get(readOptions.cursor);
      if (!saved || !equal(saved.wallet, wallet) || readOptions.cursor.blockNumber !== saved.block) throw new Error('This inventory continuation does not match the wallet. Refresh its holdings.');
      // A cancelled page never mutates the previous continuation.
      state = { ...saved, ranges: [...saved.ranges], candidates: new Map(saved.candidates), checked: new Set(saved.checked), tokens: new Map(saved.tokens), nfts: new Map(saved.nfts) };
    } else {
      const block = await call(signal, client => client.getBlockNumber());
      if (typeof block !== 'bigint' || block < 0n) throw new Error('Could not pin the Robinhood inventory snapshot.');
      state = { wallet, block, ranges: [{ kind: 'transfer', from: 0n, to: block }, { kind: 'erc1155', from: 0n, to: block }], scanned: 0n,
        candidates: new Map(), checked: new Set(), tokens: new Map(), nfts: new Map(), invalidLogs: 0, failedChecks: 0 };
    }
    const progress = (phase: InventoryProgress['phase']) => readOptions.onProgress?.({ phase, scannedBlocks: state.scanned,
      totalBlocks: (state.block + 1n) * 2n, candidates: state.candidates.size, checked: state.checked.size });
    const scanStarted = Date.now();
    let requests = 0;
    progress('history');
    while (state.ranges.length && requests < maxRequests && Date.now() - scanStarted < (options.scanBudgetMs ?? 12_000)) {
      signal?.throwIfAborted();
      const range = state.ranges.shift()!, target = padHex(wallet, { size: 32 });
      const filter: InventoryLogFilter = { fromBlock: toHex(range.from), toBlock: toHex(range.to),
        topics: range.kind === 'transfer' ? [TRANSFER, null, target] : [[SINGLE, BATCH], null, null, target] };
      requests++;
      try {
        const logs = await call(signal, client => client.getLogs(filter));
        signal?.throwIfAborted();
        // At a common provider response cap, split instead of claiming complete history.
        if (!Array.isArray(logs) || logs.length >= MAX_LOGS) throw new Error('Log response may be truncated.');
        for (const log of logs) {
          try { for (const candidate of parseTransfer(log, wallet, range)) state.candidates.set(candidateKey(candidate), candidate); }
          catch { state.invalidLogs++; }
        }
        state.scanned += range.to - range.from + 1n;
        progress('history');
      } catch {
        signal?.throwIfAborted();
        if (range.to - range.from >= MIN_SPLIT_RANGE) {
          const middle = (range.from + range.to) / 2n;
          state.ranges.unshift({ ...range, from: middle + 1n }, { ...range, to: middle });
        } else {
          state.ranges.push(range);
          break;
        }
      }
    }
    signal?.throwIfAborted();
    const unchecked = [...state.candidates].filter(([key]) => !state.checked.has(key)).slice(0, maxChecks);
    const balanceStarted = Date.now(), balanceBudget = options.balanceBudgetMs ?? 12_000;
    let retryLater = false;
    progress('balances');
    // The public endpoint rate-limits bursts. One asset at a time, with a bounded
    // page duration, keeps large or unresponsive inventories resumable.
    for (const [key, candidate] of unchecked) {
      signal?.throwIfAborted();
      const remainingMs = balanceBudget - (Date.now() - balanceStarted);
      if (remainingMs <= 0) break;
      const verify = () => deadline<TokenHolding | NftHolding>(signal, Math.min(options.balanceTimeoutMs ?? 6000, remainingMs), active => candidate.kind === 'erc20'
        ? holdings.readTokenHolding(wallet, candidate.contract, active, state.block)
        : holdings.readNftHolding(wallet, candidate.contract, candidate.tokenId, candidate.kind, active, state.block));
      try {
        const item = await verify();
        signal?.throwIfAborted();
        if (item.blockNumber !== state.block || item.balance === null) throw new Error('Asset verification did not match the pinned snapshot.');
        if (item.balance > 0n) {
          if (item.kind === 'erc20') state.tokens.set(key, item); else state.nfts.set(key, item);
        }
      } catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        if (!/revert/i.test(message) && /timeout|timed out|too many requests|\b429\b|rate limit|fetch failed|network|RPC Request failed/i.test(message)) {
          retryLater = true;
          break;
        }
        if (!(error instanceof HoldingNotOwnedError)) state.failedChecks++;
      }
      state.checked.add(key); progress('balances');
      const pause = options.balancePauseMs ?? (options.holdings ? 0 : 500);
      if (pause && Date.now() - balanceStarted + pause < balanceBudget) {
        // Cancellation is checked immediately after this short request-spacing pause.
        try {
          await deadline(signal, pause + 1000, () => new Promise<void>(resolve => setTimeout(resolve, pause)));
        } finally { signal?.throwIfAborted(); }
      }
    }
    signal?.throwIfAborted();
    const remaining = state.ranges.length > 0 || state.checked.size < state.candidates.size;
    const warnings: string[] = [];
    if (state.ranges.length) warnings.push('Transfer-history discovery is incomplete. Continue scanning to look for more assets.');
    if (state.checked.size < state.candidates.size) warnings.push('More discovered assets still need a current balance check. Continue scanning.');
    if (retryLater) warnings.push('The public RPC is temporarily limiting or delaying balance reads. Continue scanning to retry the remaining assets.');
    if (state.invalidLogs) warnings.push(`${state.invalidLogs} transfer log${state.invalidLogs === 1 ? '' : 's'} could not be decoded. Some assets may be missing.`);
    if (state.failedChecks) warnings.push(`${state.failedChecks} discovered asset${state.failedChecks === 1 ? '' : 's'} could not be verified at this block. Refresh or add an asset by contract address.`);
    const cursor: InventoryCursor | null = remaining ? Object.freeze({ wallet, blockNumber: state.block, source: 'rpc' }) : null;
    if (cursor) cursors.set(cursor, state);
    return { tokens: [...state.tokens.values()], nfts: [...state.nfts.values()], warnings,
      complete: !remaining && !state.invalidLogs && !state.failedChecks, blockNumber: state.block, cursor, source: 'rpc' };
  };
}
export const readRareWalletInventory = createRareWalletInventoryReader();
