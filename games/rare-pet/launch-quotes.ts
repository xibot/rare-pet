import { formatUnits, parseAbi, parseUnits, type Address } from 'viem';
import type { createPetPublicClient } from './wallet';
import catalog from './launch-quote-catalog.json' with { type: 'json' };

/** Generated from the issuer registry; Bankr's smaller menu never limits canonical stock support.
 * See scripts/generate-launch-quote-catalog.mjs and the source hashes in the shared catalog.
 */
export type LaunchQuoteAsset = Readonly<{
  id: string; chainId: 4663; address: Address; symbol: string; name: string; kind: 'weth' | 'stock'; decimals: 18;
  assetId: string | null; priceSource: 'chainlink' | 'robinhood'; feedAddress: Address | null;
  feedDescription: string | null; feedName: string | null; feedRegistry: Readonly<Record<string, string | null>> | null;
}>;
export const LAUNCH_QUOTE_ASSETS: readonly LaunchQuoteAsset[] = Object.freeze(catalog.assets.map(asset => Object.freeze({ ...asset, feedRegistry: asset.feedRegistry ? Object.freeze({ ...asset.feedRegistry }) : null })) as LaunchQuoteAsset[]);
export type LaunchQuoteId = LaunchQuoteAsset['id'];
export type LaunchQuotePrice = Readonly<{
  asset: LaunchQuoteAsset; usdPrice: string; usdPriceE18: bigint; blockNumber: bigint;
  updatedAt: number; readAt: number; expiresAt: number; heartbeatSeconds: number;
  source: 'chainlink' | 'robinhood'; feedAddress: Address | null;
  /** No canonical Robinhood sequencer uptime address is published in Chainlink's registry. */
  sequencerVerified: false;
}>;
const QUOTE_ABI = parseAbi([
  'function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function uid() view returns(bytes32)',
  'function description() view returns (string)', 'function oraclePaused() view returns (bool)',
  'function uiMultiplier() view returns(uint256)', 'function newUIMultiplier() view returns(uint256)', 'function effectiveAt() view returns(uint256)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);
const MAX_JSON_BYTES = 2_000_000, MAX_HEARTBEAT_SECONDS = 86_400, MAX_REVIEW_AGE_SECONDS = 120, ISSUER_MAX_AGE_SECONDS = 90;
type QuoteClient = Pick<ReturnType<typeof createPetPublicClient>, 'getChainId' | 'getBlock' | 'getCode' | 'readContract'>;
type Dependencies = { clientFactory?: (signal?: AbortSignal) => QuoteClient | Promise<QuoteClient>; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const same = (a: unknown, b: string | null) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const list = (value: unknown) => Array.isArray(value) && value.length <= 2_000 ? value : [];
const hasCode = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) && value !== '0x0';
const exactDecimal = (value: unknown) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})(\.[0-9]{1,18})?$/.test(value)) throw new Error('Issuer quote has an invalid decimal value.');
  return parseUnits(value, 18);
};
/** Resolves only reviewed IDs, never an arbitrary contract supplied by a form. */
export function getLaunchQuoteAsset(id: string): LaunchQuoteAsset {
  const asset = LAUNCH_QUOTE_ASSETS.find(item => item.id === id);
  if (!asset) throw new Error('Choose a supported WETH or stock pair.');
  return asset;
}
function verifyDirectory(value: unknown, asset: LaunchQuoteAsset) {
  const directory = object(value); let stock: Record<string, unknown> | null = null;
  if (asset.kind === 'stock') {
    const stocks = list(object(directory.robinhood).assets).map(object).filter(row => same(row.id, asset.assetId) || row.tokenSymbol === asset.symbol);
    stock = stocks[0] ?? null;
    const deployments = list(stock?.deployments).map(object).filter(row => row.chainId === 4663);
    if (stocks.length !== 1 || !stock || !same(stock.id, asset.assetId) || stock.tokenSymbol !== asset.symbol || stock.status !== 'ASSET_STATUS_ACTIVE'
      || stock.tokenDecimals !== asset.decimals || deployments.length !== 1 || !same(deployments[0].contractAddress, asset.address)) {
      throw new Error('The stock is not an active, verified Robinhood Chain token.');
    }
  }
  if (asset.priceSource === 'robinhood') return { stock, heartbeatSeconds: ISSUER_MAX_AGE_SECONDS };
  const feeds = list(directory.chainlink).map(object).filter(row => same(row.proxyAddress, asset.feedAddress));
  const feed = feeds[0], docs = object(feed?.docs);
  if (feeds.length !== 1 || feed.name !== asset.feedName || feed.decimals !== 8 || !asset.feedRegistry
    || Object.entries(asset.feedRegistry).some(([key, expected]) => ((key === 'path' ? feed.path : docs[key]) ?? null) !== expected)
    || typeof feed.heartbeat !== 'number' || !Number.isInteger(feed.heartbeat) || feed.heartbeat <= 0 || feed.heartbeat > MAX_HEARTBEAT_SECONDS) {
    throw new Error('The USD feed no longer matches the verified Robinhood Chainlink registry.');
  }
  return { stock, heartbeatSeconds: feed.heartbeat };
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) throw new Error(`Quote verification service is unavailable (${response.status}). Retry before launching.`);
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Quote verification did not return JSON.');
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let total = 0;
  try {
    for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength; if (total > MAX_JSON_BYTES) throw new Error('Quote registry response is too large.'); parts.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
/** Public reads only. Chainlink already includes the multiplier. Issuer bid/ask is underlying USD;
 * its exact midpoint is multiplied once by the verified, current onchain multiplier.
 * https://docs.robinhood.com/chain/stock-token-apis/ */
export function createLaunchQuoteReader(dependencies: Dependencies = {}) {
  const clientFactory = dependencies.clientFactory ?? (async (signal?: AbortSignal) => (await import('./wallet')).createPetPublicClient(signal));
  const fetcher = dependencies.fetcher ?? fetch, now = dependencies.now ?? Date.now;
  async function readLaunchQuotePrice(id: LaunchQuoteId, callerSignal?: AbortSignal): Promise<LaunchQuotePrice> {
    const asset = getLaunchQuoteAsset(id), controller = new AbortController();
    const abort = () => controller.abort(callerSignal?.reason); callerSignal?.addEventListener('abort', abort, { once: true }); if (callerSignal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error('Quote verification timed out. Retry before launching.')), dependencies.timeoutMs ?? 20_000);
    const signal = controller.signal;
    try {
      signal.throwIfAborted(); const client = await clientFactory(signal); signal.throwIfAborted();
      if (await client.getChainId() !== 4663) throw new Error('Quote RPC must be Robinhood mainnet (4663).');
      const [directory, block] = await Promise.all([
        fetcher(`/api/launch-quotes?asset=${encodeURIComponent(asset.id)}`, { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal }).then(response => boundedJson(response, signal)),
        client.getBlock({ blockTag: 'latest' }),
      ]);
      signal.throwIfAborted(); const { stock, heartbeatSeconds } = verifyDirectory(directory, asset);
      const readAt = Math.floor(now() / 1_000);
      if (typeof block.number !== 'bigint' || block.number < 0n || typeof block.timestamp !== 'bigint' || !block.hash
        || block.timestamp > BigInt(readAt + 30) || block.timestamp < BigInt(readAt - 120)) throw new Error('Robinhood latest block is stale. Retry before launching.');
      const blockNumber = block.number;
      const tokenRead = (functionName: 'decimals' | 'symbol' | 'uid' | 'oraclePaused' | 'uiMultiplier' | 'newUIMultiplier' | 'effectiveAt') => client.readContract({ address: asset.address, abi: QUOTE_ABI, functionName, blockNumber });
      const [tokenCode, decimals, symbol, paused, uid] = await Promise.all([
        client.getCode({ address: asset.address, blockNumber }), tokenRead('decimals'), tokenRead('symbol'),
        asset.kind === 'stock' ? tokenRead('oraclePaused') : Promise.resolve(false), asset.kind === 'stock' ? tokenRead('uid') : Promise.resolve(null),
      ]);
      signal.throwIfAborted();
      if (!hasCode(tokenCode)) throw new Error('The selected quote token has no deployed code.');
      if (decimals !== asset.decimals || symbol !== asset.symbol || (asset.kind === 'stock' && !same(uid, asset.assetId))) throw new Error('Onchain quote metadata does not match the verified pair.');
      if (paused !== false) throw new Error('This stock oracle is paused for a corporate action. Choose another pair or retry later.');
      let usdPriceE18: bigint, updatedAt: number, effectiveExpiry = Number.MAX_SAFE_INTEGER;
      if (asset.priceSource === 'chainlink') {
        if (!asset.feedAddress) throw new Error('Missing verified Chainlink feed.');
        const feedRead = (functionName: 'decimals' | 'description' | 'latestRoundData') => client.readContract({ address: asset.feedAddress!, abi: QUOTE_ABI, functionName, blockNumber });
        const [feedCode, feedDecimals, description, round] = await Promise.all([client.getCode({ address: asset.feedAddress, blockNumber }), feedRead('decimals'), feedRead('description'), feedRead('latestRoundData')]);
        if (!hasCode(feedCode)) throw new Error('The USD feed has no deployed code.');
        if (feedDecimals !== 8 || description !== asset.feedDescription) throw new Error('Onchain quote metadata does not match the verified pair.');
        if (!Array.isArray(round) || round.length !== 5 || round.some(value => typeof value !== 'bigint')) throw new Error('USD oracle returned an invalid round.');
        const [roundId, answer, startedAt, updated, answeredInRound] = round as readonly bigint[];
        const checkedAt = Math.floor(now() / 1_000);
        if (roundId <= 0n || answeredInRound < roundId || answer <= 0n || answer >= 1n << 255n || startedAt <= 0n || startedAt > updated
          || updated <= 0n || updated > BigInt(checkedAt + 30) || updated > block.timestamp || updated < BigInt(checkedAt - heartbeatSeconds)) throw new Error('USD oracle is stale or its round is incomplete. Retry when a fresh price is available.');
        usdPriceE18 = answer * 10n ** 10n; updatedAt = Number(updated);
      } else {
        const quotes = list(object(object(directory).price).quotes).map(object).filter(row => row.tokenSymbol === asset.symbol);
        const quote = quotes[0], deployments = list(quote?.deployments).map(object).filter(row => row.chainId === 4663);
        if (quotes.length !== 1 || quote.currency !== 'USD' || quote.isTradingHalt !== false || deployments.length !== 1 || !same(deployments[0].contractAddress, asset.address)) throw new Error('Issuer price is halted or does not match the selected canonical stock.');
        if (typeof quote.generatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(quote.generatedAt)) throw new Error('Issuer price timestamp is invalid.');
        updatedAt = Math.floor(Date.parse(quote.generatedAt) / 1000);
        const checkedAt = Math.floor(now() / 1000), bid = exactDecimal(quote.bid), ask = exactDecimal(quote.ask);
        if (!Number.isSafeInteger(updatedAt) || updatedAt > checkedAt + 30 || updatedAt < checkedAt - heartbeatSeconds || bid <= 0n || ask < bid) throw new Error('Issuer USD quote is stale, crossed or invalid. Retry for a fresh quote.');
        const [multiplier, nextMultiplier, effectiveAt] = await Promise.all([tokenRead('uiMultiplier'), tokenRead('newUIMultiplier'), tokenRead('effectiveAt')]);
        if (typeof multiplier !== 'bigint' || multiplier <= 0n || multiplier >= 1n << 128n || typeof nextMultiplier !== 'bigint' || typeof effectiveAt !== 'bigint'
          || exactDecimal(stock?.currentMultiplier) !== multiplier) throw new Error('Issuer and onchain stock multipliers do not agree. Retry after the corporate action update.');
        if (nextMultiplier !== 0n && nextMultiplier !== multiplier && effectiveAt > 0n) {
          if (effectiveAt <= BigInt(checkedAt)) throw new Error('A stock multiplier update is taking effect. Retry after the corporate action update.');
          if (effectiveAt < BigInt(Number.MAX_SAFE_INTEGER)) effectiveExpiry = Number(effectiveAt);
        }
        usdPriceE18 = (bid + ask) * multiplier / (2n * 10n ** 18n);
        if (usdPriceE18 <= 0n || usdPriceE18 >= 1n << 255n) throw new Error('Issuer token price is invalid.');
      }
      const [chainId, checkedBlock] = await Promise.all([client.getChainId(), client.getBlock({ blockNumber })]);
      if (chainId !== 4663) throw new Error('Quote RPC changed networks. Retry on Robinhood mainnet.');
      if (checkedBlock.hash !== block.hash) throw new Error('Quote verification block changed. Retry for a fresh quote.');
      signal.throwIfAborted(); const checkedAt = Math.floor(now() / 1000), expiresAt = Math.min(checkedAt + MAX_REVIEW_AGE_SECONDS, updatedAt + heartbeatSeconds, effectiveExpiry);
      if (expiresAt <= checkedAt) throw new Error('Quote expired during verification. Retry for a fresh quote.');
      return Object.freeze({ asset, usdPrice: formatUnits(usdPriceE18, 18), usdPriceE18, blockNumber, updatedAt, readAt: checkedAt, expiresAt, heartbeatSeconds, source: asset.priceSource, feedAddress: asset.feedAddress, sequencerVerified: false });
    } finally { clearTimeout(timer); callerSignal?.removeEventListener('abort', abort); }
  }
  return { readLaunchQuotePrice };
}
export const { readLaunchQuotePrice } = createLaunchQuoteReader();
