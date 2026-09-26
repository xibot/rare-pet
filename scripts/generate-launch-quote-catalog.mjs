/** Rebuild the reviewed, shared Robinhood quote catalog. Public GET/eth_call only; never signs. */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPublicClient, getAddress, http, parseAbi } from 'viem';
export const CATALOG_SOURCES = Object.freeze({ robinhood: 'https://api.robinhood.com/rhj/assets', chainlink: 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json', bankr: 'https://api.bankr.bot/token-launches/quote-tokens?chain=robinhood' });
export const RAREFRIENDS = '0x0779369854d3EcdEA927206718FFD7730C67B71f';
export const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
export const CBBTC = '0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4';
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
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
  const assets = [{ id: 'weth', chainId: 4663, address: WETH, symbol: 'WETH', name: 'Wrapped Ether', kind: 'weth', decimals: 18, assetId: null, feed: ether[0] }, { id: 'rarefriends', chainId: 4663, address: RAREFRIENDS, symbol: 'RAREFRIENDS', name: 'RareFriends', kind: 'rarefriends', decimals: 18, assetId: null, feed: ether[0] }];
  const dollar = chainlink.filter(feed => feed.name === 'USDG / USD' && feed.docs?.baseAsset === 'USDG' && feed.docs?.quoteAsset === 'USD' && feed.docs?.blockchainName === 'Robinhood');
  if (dollar.length !== 1 || dollar[0].proxyAddress?.toLowerCase() !== '0x61b7e5650328764b076a108eff5fa7282a1b9ad2') fail('Canonical USDG feed is missing or changed.');
  assets.push({ id: 'usdg', chainId: 4663, address: USDG, symbol: 'USDG', name: 'Global Dollar', kind: 'usdg', decimals: 6, assetId: null, feed: dollar[0] });
  const bitcoin = chainlink.filter(feed => feed.name === 'CBBTC / USD' && feed.docs?.baseAsset === 'CBBTC' && feed.docs?.quoteAsset === 'USD' && feed.docs?.blockchainName === 'Robinhood');
  if (bitcoin.length !== 1 || bitcoin[0].proxyAddress?.toLowerCase() !== '0x0009cd492adf8167f9eebf1293556a673530a21a') fail('Canonical cbBTC feed is missing or changed.');
  assets.push({ id: 'cbbtc', chainId: 4663, address: CBBTC, symbol: 'cbBTC', name: 'Coinbase Wrapped BTC (CCIP)', kind: 'cbbtc', decimals: 8, assetId: null, feed: bitcoin[0] });
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
  // Official CCIP registration must still connect this Robinhood representation to Base cbBTC.
  const registry = '0x1912C3cFafE8A76A32a92861d815aC2837F237Ca';
  const pool = '0x402430ca607c52a99Aa82AB4C726001D4203C9e7';
  const baseSelector = 15971525489660198786n;
  const bridgeAbi = parseAbi(['function getPool(address) view returns(address)', 'function getToken() view returns(address)', 'function getRemoteToken(uint64) view returns(bytes)', 'function getRemotePools(uint64) view returns(bytes[])']);
  const [registeredPool, token, remoteToken, remotePools] = await Promise.all([
    reader.readContract({ address: registry, abi: bridgeAbi, functionName: 'getPool', args: [CBBTC], blockNumber: block.number }),
    reader.readContract({ address: pool, abi: bridgeAbi, functionName: 'getToken', blockNumber: block.number }),
    reader.readContract({ address: pool, abi: bridgeAbi, functionName: 'getRemoteToken', args: [baseSelector], blockNumber: block.number }),
    reader.readContract({ address: pool, abi: bridgeAbi, functionName: 'getRemotePools', args: [baseSelector], blockNumber: block.number }),
  ]);
  const baseToken = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
  const basePool = '0x93cF6F19fdd01c8C240651357193E25abf41523a';
  const encodedAddress = address => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
  if (registeredPool.toLowerCase() !== pool.toLowerCase() || token.toLowerCase() !== CBBTC.toLowerCase()
    || remoteToken.toLowerCase() !== encodedAddress(baseToken) || !remotePools.some(remote => remote.toLowerCase() === encodedAddress(basePool))) fail('cbBTC CCIP registration or canonical Base mapping changed.');
  const assets = new Array(candidates.length); let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const index = cursor++; if (index >= candidates.length) return;
      const { feed, ...asset } = candidates[index];
      const call = (address, functionName) => reader.readContract({ address, abi, functionName, blockNumber: block.number });
      const [code, decimals, symbol, uid] = await Promise.all([reader.getCode({ address: asset.address, blockNumber: block.number }), call(asset.address, 'decimals'), call(asset.address, 'symbol'), asset.kind === 'stock' ? call(asset.address, 'uid') : Promise.resolve(null)]);
      if (!code || code === '0x' || decimals !== asset.decimals || symbol !== asset.symbol || (asset.kind === 'stock' && uid.toLowerCase() !== asset.assetId)) fail(`Onchain issuer metadata mismatch for ${asset.symbol}`);
      let feedAddress = null, feedDescription = null;
      if (feed) {
        feedAddress = getAddress(feed.proxyAddress);
        const [code, decimals, description] = await Promise.all([reader.getCode({ address: feedAddress, blockNumber: block.number }), call(feedAddress, 'decimals'), call(feedAddress, 'description')]);
        if (!code || code === '0x' || decimals !== 8 || typeof description !== 'string' || !description.includes('USD')) fail(`Onchain feed metadata mismatch for ${asset.symbol}`);
        feedDescription = description;
      }
      assets[index] = { ...asset, priceSource: asset.kind === 'rarefriends' ? 'rarefriends-pool' : feed ? 'chainlink' : 'robinhood', feedAddress, feedName: feed?.name ?? null, feedDescription, feedRegistry: feed ? feedRegistry(feed) : null };
    }
  }));
  if (await reader.getChainId() !== 4663 || (await reader.getBlock({ blockNumber: block.number })).hash !== block.hash) fail('Verification block changed.');
  const bankr = snapshots.bankr.data;
  if (bankr.chain !== 'robinhood' || bankr.provider !== 'doppler' || !Array.isArray(bankr.quoteTokens)) fail('Unexpected Bankr comparison registry.');
  const omittedByBankr = assets.filter(asset => asset.kind === 'stock' && !bankr.quoteTokens.some(token => token.address?.toLowerCase() === asset.address.toLowerCase())).map(asset => asset.symbol);
  const catalog = { version: 1, chainId: 4663, generatedAt: now().toISOString(), verifiedBlockNumber: String(block.number), verifiedBlockHash: block.hash,
    rarefriendsVerification: { verifiedBlockNumber: String(block.number), source: 'https://rarefriends.com/docs/contracts', priceSource: 'Canonical RF/WETH 30-minute arithmetic TWAP reconstructed from onchain Swap events, converted using Chainlink ETH/USD.' },
    cryptoVerification: {
      verifiedBlockNumber: String(block.number),
      usdg: { address: USDG, decimals: 6, sources: ['https://docs.robinhood.com/chain/contracts/', 'https://docs.sandbox.paxos.com/guides/stablecoin/usdg/mainnet'] },
      cbbtc: { address: CBBTC, decimals: 8, representation: 'CCIP-bridged cbBTC from Base', registry, pool, baseSelector: String(baseSelector), baseToken, basePool,
        sources: ['https://docs.chain.link/ccip/directory/mainnet/token/cbBTC', 'https://www.coinbase.com/cbbtc'] },
    },
    sources: Object.fromEntries(Object.entries(CATALOG_SOURCES).map(([key, url]) => [key, { url, sha256: snapshots[key].sha256 }])),
    coverage: { activeStocks: assets.filter(asset => asset.kind === 'stock').length, chainlinkStocks: assets.filter(asset => asset.kind === 'stock' && asset.priceSource === 'chainlink').length, issuerPricedStocks: assets.filter(asset => asset.priceSource === 'robinhood').length, omittedByBankr }, assets };
  await writeFile(outputPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Verified ${assets.length} quotes at block ${block.number}: ${JSON.stringify(catalog.coverage)}`);
  return catalog;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generateCatalog();
