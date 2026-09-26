/** Rebuild the reviewed, shared Robinhood quote catalog. Public GET/eth_call only; never signs. */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPublicClient, getAddress, http, parseAbi } from 'viem';
export const CATALOG_SOURCES = Object.freeze({ robinhood: 'https://api.robinhood.com/rhj/assets', chainlink: 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json', bankr: 'https://api.bankr.bot/token-launches/quote-tokens?chain=robinhood' });
export const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const abi = parseAbi(['function decimals() view returns(uint8)', 'function symbol() view returns(string)', 'function description() view returns(string)', 'function uid() view returns(bytes32)']);
const fail = message => { throw new Error(message); };
export function feedRegistry(feed) {
  return Object.fromEntries(['path', 'baseAsset', 'quoteAsset', 'assetClass', 'blockchainName', 'baseAssetEntityId', 'quoteAssetEntityId', 'marketHours'].map(key => [key, (key === 'path' ? feed.path : feed.docs?.[key]) ?? null]));
}
export function catalogCandidates(robinhood, chainlink) {
  if (!Array.isArray(robinhood?.assets) || robinhood.assets.length > 2000 || !Array.isArray(chainlink) || chainlink.length > 2000) fail('Official registries have an unexpected shape.');
  const stockFeeds = new Map();
  for (const feed of chainlink) {
    // Generic DEX-reference feeds (including GLD) do not document corporate-action
    // multiplication. They use the issuer quote + verified onchain multiplier path.
    const symbol = /^Robinhood ([A-Z0-9.-]+)(?: \/ USD|-USD)$/.exec(feed.name)?.[1];
    if (symbol) { if (stockFeeds.has(symbol)) fail(`Ambiguous USD feed for ${symbol}`); stockFeeds.set(symbol, feed); }
  }
  const ether = chainlink.filter(feed => feed.name === 'ETH / USD' && feed.docs?.baseAsset === 'ETH' && feed.docs?.blockchainName === 'Robinhood');
  if (ether.length !== 1) fail('Canonical ETH feed is missing or ambiguous.');
  const assets = [{ id: 'weth', chainId: 4663, address: WETH, symbol: 'WETH', name: 'Wrapped Ether', kind: 'weth', decimals: 18, assetId: null, feed: ether[0] }];
  const stocks = robinhood.assets.filter(asset => asset.status === 'ASSET_STATUS_ACTIVE' && asset.deployments?.some(deployment => deployment.chainId === 4663));
  if (!stocks.length) fail('No active Robinhood stock deployments.');
  stocks.sort((a, b) => a.tokenSymbol.localeCompare(b.tokenSymbol, 'en'));
  for (const stock of stocks) {
    const deployments = stock.deployments.filter(deployment => deployment.chainId === 4663);
    if (deployments.length !== 1 || stock.tokenDecimals !== 18 || !/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(stock.tokenSymbol) || !/^0x[0-9a-f]{64}$/i.test(stock.id)) fail('An issuer entry is ambiguous or unsupported; review before regenerating.');
    if (typeof stock.tokenName !== 'string' || stock.tokenName.length > 240 || !stock.tokenName.endsWith(' • Robinhood Token')) fail(`Unexpected issuer name for ${stock.tokenSymbol}`);
    assets.push({ id: stock.tokenSymbol.toLowerCase(), chainId: 4663, address: getAddress(deployments[0].contractAddress), symbol: stock.tokenSymbol,
      name: stock.tokenName.slice(0, -' • Robinhood Token'.length).replace(/\s+/g, ' ').trim(), kind: 'stock', decimals: 18, assetId: stock.id.toLowerCase(), feed: stockFeeds.get(stock.tokenSymbol) ?? null });
  }
  for (const field of ['id', 'address', 'symbol']) if (new Set(assets.map(asset => asset[field].toLowerCase())).size !== assets.length) fail(`Duplicate quote ${field}.`);
  for (const asset of assets) if (asset.feed && (asset.feed.decimals !== 8 || !Number.isSafeInteger(asset.feed.heartbeat) || asset.feed.heartbeat <= 0 || asset.feed.heartbeat > 86400)) fail(`Unexpected USD feed parameters for ${asset.symbol}`);
  return assets;
}
export async function generateCatalog({ fetcher = fetch, client, outputPath = fileURLToPath(new URL('../games/rare-pet/launch-quote-catalog.json', import.meta.url)), now = () => new Date() } = {}) {
  const snapshots = {};
  for (const [key, url] of Object.entries(CATALOG_SOURCES)) {
    const response = await fetcher(url, { redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) fail(`Could not read official ${key} registry.`);
    const raw = await response.text(); if (Buffer.byteLength(raw) > 2000000) fail('Official registry exceeds review bounds.');
    snapshots[key] = { data: JSON.parse(raw), sha256: createHash('sha256').update(raw).digest('hex') };
  }
  const candidates = catalogCandidates(snapshots.robinhood.data, snapshots.chainlink.data);
  const reader = client ?? createPublicClient({ transport: http(RPC, { batch: { batchSize: 30, wait: 20 }, timeout: 20000, retryCount: 0 }) });
  if (await reader.getChainId() !== 4663) fail('RPC chain mismatch.');
  const block = await reader.getBlock(); if (!block.hash) fail('Missing verification block.');
  const assets = new Array(candidates.length); let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const index = cursor++; if (index >= candidates.length) return;
      const { feed, ...asset } = candidates[index];
      const call = (address, functionName) => reader.readContract({ address, abi, functionName, blockNumber: block.number });
      const [code, decimals, symbol, uid] = await Promise.all([reader.getCode({ address: asset.address, blockNumber: block.number }), call(asset.address, 'decimals'), call(asset.address, 'symbol'), asset.kind === 'stock' ? call(asset.address, 'uid') : Promise.resolve(null)]);
      if (!code || code === '0x' || decimals !== 18 || symbol !== asset.symbol || (asset.kind === 'stock' && uid.toLowerCase() !== asset.assetId)) fail(`Onchain issuer metadata mismatch for ${asset.symbol}`);
      let feedAddress = null, feedDescription = null;
      if (feed) {
        feedAddress = getAddress(feed.proxyAddress);
        const [code, decimals, description] = await Promise.all([reader.getCode({ address: feedAddress, blockNumber: block.number }), call(feedAddress, 'decimals'), call(feedAddress, 'description')]);
        if (!code || code === '0x' || decimals !== 8 || typeof description !== 'string' || !description.includes('USD')) fail(`Onchain feed metadata mismatch for ${asset.symbol}`);
        feedDescription = description;
      }
      assets[index] = { ...asset, priceSource: feed ? 'chainlink' : 'robinhood', feedAddress, feedName: feed?.name ?? null, feedDescription, feedRegistry: feed ? feedRegistry(feed) : null };
    }
  }));
  if (await reader.getChainId() !== 4663 || (await reader.getBlock({ blockNumber: block.number })).hash !== block.hash) fail('Verification block changed.');
  const bankr = snapshots.bankr.data;
  if (bankr.chain !== 'robinhood' || bankr.provider !== 'doppler' || !Array.isArray(bankr.quoteTokens)) fail('Unexpected Bankr comparison registry.');
  const omittedByBankr = assets.filter(asset => asset.kind === 'stock' && !bankr.quoteTokens.some(token => token.address?.toLowerCase() === asset.address.toLowerCase())).map(asset => asset.symbol);
  const catalog = { version: 1, chainId: 4663, generatedAt: now().toISOString(), verifiedBlockNumber: String(block.number), verifiedBlockHash: block.hash,
    sources: Object.fromEntries(Object.entries(CATALOG_SOURCES).map(([key, url]) => [key, { url, sha256: snapshots[key].sha256 }])),
    coverage: { activeStocks: assets.length - 1, chainlinkStocks: assets.filter(asset => asset.kind === 'stock' && asset.priceSource === 'chainlink').length, issuerPricedStocks: assets.filter(asset => asset.priceSource === 'robinhood').length, omittedByBankr }, assets };
  await writeFile(outputPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Verified ${assets.length} quotes at block ${block.number}: ${JSON.stringify(catalog.coverage)}`);
  return catalog;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generateCatalog();
