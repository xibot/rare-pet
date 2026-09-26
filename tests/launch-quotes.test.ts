import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import catalog from '../games/rare-pet/launch-quote-catalog.json' with { type: 'json' };
import { poolFixture } from './fixtures/rarefriends-pool.ts';
import { catalogCandidates } from '../scripts/generate-launch-quote-catalog.mjs';
const source = fileURLToPath(new URL('../games/rare-pet/launch-quotes.ts', import.meta.url));
const proxySource = fileURLToPath(new URL('../api/launch-quotes.ts', import.meta.url));
const bundled = await build({ stdin: { contents: `export * from ${JSON.stringify(source)}; export * from ${JSON.stringify(proxySource)};`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { LAUNCH_QUOTE_ASSETS, getLaunchQuoteAsset, createLaunchQuoteReader, createLaunchQuotesHandler } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + '\n//# sourceURL=launch-quotes-test-bundle.mjs\n').toString('base64')}`);
const NOW = 1_790_000_000, MULTIPLIER = 1250000000000000000n;
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
function directory() {
  return {
    robinhood: { assets: LAUNCH_QUOTE_ASSETS.filter(asset => asset.kind === 'stock').map(asset => ({ id: asset.assetId, tokenSymbol: asset.symbol, tokenName: `${asset.name} • Robinhood Token`, status: 'ASSET_STATUS_ACTIVE', tokenDecimals: 18,
      currentMultiplier: '1.250000000000000000', deployments: [{ chainId: 4663, contractAddress: asset.address }] })) },
    chainlink: LAUNCH_QUOTE_ASSETS.filter(asset => asset.priceSource === 'chainlink').map(asset => ({ proxyAddress: asset.feedAddress, name: asset.feedName, decimals: 8, heartbeat: 86400,
      assetName: asset.symbol === 'GLD' ? 'SPDR Gold Shares • Robinhood Token' : undefined,
      path: asset.feedRegistry.path, docs: Object.fromEntries(Object.entries(asset.feedRegistry).filter(([key, value]) => key !== 'path' && value !== null)) })),
    price: { quotes: LAUNCH_QUOTE_ASSETS.filter(asset => asset.priceSource === 'robinhood').map(asset => ({ tokenSymbol: asset.symbol, currency: 'USD', bid: '1.000000000000000001', ask: '1.000000000000000003', isTradingHalt: false,
      generatedAt: new Date((NOW - 10) * 1000).toISOString(), deployments: [{ chainId: 4663, contractAddress: asset.address }] })) },
  };
}
function setup(options: Record<string, unknown> = {}) {
  const calls: Record<string, unknown>[] = [], payload = directory(), pool = poolFixture();
  const client = {
    getChainId: async () => 4663, getBlock: pool.client.getBlock, getLogs: pool.client.getLogs,
    getCode: async (args: Record<string, unknown>) => { calls.push({ operation: 'code', ...args }); return (await pool.client.getCode(args)) ?? '0x60006000'; },
    readContract: async (args: Record<string, unknown>) => {
      calls.push(args); if (['poolKey', 'poolManager', 'poolId', 'seedComplete', 'getSlot0', 'getLiquidity', 'getPositionInfo'].includes(args.functionName as string)) return pool.client.readContract(args); const asset = LAUNCH_QUOTE_ASSETS.find(asset => asset.address === args.address || asset.feedAddress === args.address);
      assert(asset, 'only pinned addresses can be read');
      if (args.functionName === 'decimals') return args.address === asset.address ? asset.decimals : 8;
      if (args.functionName === 'symbol') return asset.symbol;
      if (args.functionName === 'uid') return asset.assetId;
      if (args.functionName === 'description') return asset.feedDescription;
      if (args.functionName === 'oraclePaused') return false;
      if (args.functionName === 'uiMultiplier' || args.functionName === 'newUIMultiplier') return MULTIPLIER;
      if (args.functionName === 'effectiveAt') return 0n;
      if (args.functionName === 'latestRoundData') return [7n, 900719925474099312n, BigInt(NOW - 62), BigInt(NOW - 60), 7n];
      assert.fail(`Unexpected read ${args.functionName}`);
    }, ...(options.client as object ?? {}),
  };
  const reader = createLaunchQuoteReader({ clientFactory: () => client, now: () => NOW * 1000,
    fetcher: async (url: string, init: RequestInit) => { assert.match(url, /^\/api\/launch-quotes\?asset=[a-z0-9.-]+$/); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); return jsonResponse(payload); },
    ...(options.dependencies as object ?? {}),
  });
  return { reader, client, payload, calls };
}
const stock = data => data.robinhood.assets.find(asset => asset.tokenSymbol === 'NVDA');
const feed = data => data.chainlink.find(entry => entry.proxyAddress === getLaunchQuoteAsset('nvda').feedAddress);
const price = data => data.price.quotes.find(entry => entry.tokenSymbol === 'QNT');

test('shared reviewed catalog covers every issuer stock, including the asset Bankr omits', () => {
  assert.equal(LAUNCH_QUOTE_ASSETS.length, catalog.assets.length); assert.equal(catalog.coverage.activeStocks, 195);
  assert.equal(getLaunchQuoteAsset('usdg').decimals, 6);
  assert.equal(getLaunchQuoteAsset('cbbtc').decimals, 8);
  assert.equal(getLaunchQuoteAsset('cbbtc').address.toLowerCase(), '0xcec185eb182c47d1ba1efc84e6959e18cd620be4');
  assert.equal(getLaunchQuoteAsset('usdg').address.toLowerCase(), '0x5fc5360d0400a0fd4f2af552add042d716f1d168');
  assert.equal(catalog.coverage.chainlinkStocks, 35); assert.equal(catalog.coverage.issuerPricedStocks, 160);
  assert.equal(getLaunchQuoteAsset('qnt').address, '0xB7EDfE2F33C1aC06830a971dFb559bDe8A2a3d76');
  assert.equal(getLaunchQuoteAsset('qnt').priceSource, 'robinhood');
  for (const asset of LAUNCH_QUOTE_ASSETS) {
    assert.match(asset.address, /^0x[0-9a-fA-F]{40}$/); assert.equal(asset.chainId, 4663); assert.equal(asset.decimals, asset.kind === 'usdg' ? 6 : asset.kind === 'cbbtc' ? 8 : 18); assert(Object.isFrozen(asset));
    if (asset.priceSource === 'chainlink' || asset.priceSource === 'rarefriends-pool') { assert.match(asset.feedAddress, /^0x[0-9a-fA-F]{40}$/); assert(Object.isFrozen(asset.feedRegistry)); }
    else { assert.equal(asset.feedAddress, null); assert.equal(asset.kind, 'stock'); }
  }
  assert.equal(new Set(LAUNCH_QUOTE_ASSETS.map(asset => asset.address.toLowerCase())).size, LAUNCH_QUOTE_ASSETS.length);
  for (const id of ['STOCKS', 'ETH', '0x1111111111111111111111111111111111111111', '<script>', 'qnt/../../bad']) assert.throws(() => getLaunchQuoteAsset(id), /supported/);
});

test('generator is complete, deterministic and rejects ambiguous issuer identities', () => {
  const data = directory(); const assets = catalogCandidates(data.robinhood, data.chainlink);
  assert.deepEqual(assets.map(asset => asset.address), LAUNCH_QUOTE_ASSETS.map(asset => asset.address));
  data.robinhood.assets.reverse(); assert.deepEqual(catalogCandidates(data.robinhood, data.chainlink).map(asset => asset.address), assets.map(asset => asset.address));
  for (const mutate of [
    data => data.robinhood.assets.push({ ...data.robinhood.assets[0] }),
    data => { data.robinhood.assets[0].tokenDecimals = 6; },
    data => { data.robinhood.assets[0].deployments.push(data.robinhood.assets[0].deployments[0]); },
    data => { data.chainlink.push(data.chainlink.find(feed => feed.name.includes('NVDA'))); },
  ]) { const data = directory(); mutate(data); assert.throws(() => catalogCandidates(data.robinhood, data.chainlink), /Duplicate|ambiguous|unsupported|Ambiguous/); }
});

test('selected Chainlink stock retains exact token price without double-applying multiplier', async () => {
  const { reader, calls } = setup(); const quote = await reader.readLaunchQuotePrice('nvda');
  assert.equal(quote.usdPriceE18, 9007199254740993120000000000n); assert.equal(quote.usdPrice, '9007199254.74099312');
  assert.equal(quote.updatedAt, NOW - 60); assert.equal(quote.expiresAt, NOW + 120); assert.equal(quote.blockNumber, 100000n); assert.equal(quote.source, 'chainlink');
  assert(calls.every(call => call.blockNumber === 100000n)); assert(!calls.some(call => call.functionName === 'uiMultiplier'));
});

test('issuer midpoint uses exact arithmetic and current onchain multiplier once for QNT', async () => {
  const { reader, calls } = setup(); const quote = await reader.readLaunchQuotePrice('qnt');
  assert.equal(quote.usdPriceE18, 1250000000000000002n); assert.equal(quote.usdPrice, '1.250000000000000002');
  assert.equal(quote.source, 'robinhood'); assert.equal(quote.feedAddress, null); assert.equal(quote.updatedAt, NOW - 10); assert.equal(quote.expiresAt, NOW + 80);
  assert(calls.every(call => call.blockNumber === 100000n && call.address === quote.asset.address));
});

test('all catalog paths price with their exact pinned metadata, including GLD and incomplete Chainlink docs', async () => {
  const { reader } = setup();
  for (const asset of LAUNCH_QUOTE_ASSETS) { const quote = await reader.readLaunchQuotePrice(asset.id); assert.equal(quote.asset.address, asset.address); assert.equal(quote.source, asset.priceSource); }
});

test('WETH is independent of stock registries and issuer pricing is independent of Chainlink or Bankr', async () => {
  const one = setup(); one.payload.robinhood.assets = []; one.payload.chainlink = one.payload.chainlink.filter(entry => entry.name === 'ETH / USD');
  assert.equal((await one.reader.readLaunchQuotePrice('weth')).asset.kind, 'weth'); assert(!one.calls.some(call => call.functionName === 'oraclePaused'));
  const two = setup(); two.payload.chainlink = []; assert.equal((await two.reader.readLaunchQuotePrice('qnt')).source, 'robinhood');
});

test('non-18-decimal crypto quotes use the live USD feed without a dollar peg assumption or stock multiplier', async () => {
  const crypto = LAUNCH_QUOTE_ASSETS.filter(asset => asset.kind === 'usdg' || asset.kind === 'cbbtc');
  assert(crypto.some(asset => asset.kind === 'usdg'));
  for (const asset of crypto) {
    const { reader, client, payload, calls } = setup(), read = client.readContract;
    const answer = asset.kind === 'usdg' ? 98234567n : 6734567890123n;
    payload.robinhood.assets = [];
    payload.chainlink = payload.chainlink.filter(feed => feed.proxyAddress === asset.feedAddress);
    client.readContract = async args => args.functionName === 'latestRoundData'
      ? [7n, answer, BigInt(NOW - 62), BigInt(NOW - 60), 7n] : read(args);
    const quote = await reader.readLaunchQuotePrice(asset.id);
    assert.equal(quote.asset.decimals, asset.kind === 'usdg' ? 6 : 8);
    assert.equal(quote.usdPriceE18, answer * 10n ** 10n);
    assert.equal(quote.usdPrice, asset.kind === 'usdg' ? '0.98234567' : '67345.67890123');
    assert(!calls.some(call => ['uid', 'oraclePaused', 'uiMultiplier'].includes(call.functionName as string)));
  }
});

test('crypto quotes reject wrong token units, copied symbols, feed identities, stale prices and zero prices', async () => {
  for (const asset of LAUNCH_QUOTE_ASSETS.filter(asset => asset.kind === 'usdg' || asset.kind === 'cbbtc')) {
    for (const mutation of ['decimals', 'symbol', 'description', 'zero', 'stale', 'feed'] as const) {
      const { reader, client, payload } = setup(), read = client.readContract;
      if (mutation === 'feed') payload.chainlink.find(feed => feed.proxyAddress === asset.feedAddress)!.docs.baseAsset = 'UNVERIFIED';
      client.readContract = async args => {
        if (args.address === asset.address && args.functionName === 'decimals' && mutation === 'decimals') return 18;
        if (args.address === asset.address && args.functionName === 'symbol' && mutation === 'symbol') return 'LOOKALIKE';
        if (args.functionName === 'description' && mutation === 'description') return 'UNVERIFIED / USD';
        if (args.functionName === 'latestRoundData' && ['zero', 'stale'].includes(mutation)) return [7n, mutation === 'zero' ? 0n : 100000000n, BigInt(NOW - 86402), BigInt(NOW - 86401), 7n];
        return read(args);
      };
      await assert.rejects(reader.readLaunchQuotePrice(asset.id), /metadata|registry|stale|incomplete/);
    }
  }
});

test('issuer identity, status, decimals and exact published feed metadata mismatches fail closed', async () => {
  for (const mutate of [
    data => { stock(data).id = '0x' + '11'.repeat(32); }, data => { stock(data).deployments[0].chainId = 46630; },
    data => { stock(data).status = 'ASSET_STATUS_INACTIVE'; }, data => { stock(data).tokenDecimals = 6; },
    data => { stock(data).deployments[0].contractAddress = '0x' + '11'.repeat(20); },
    data => { feed(data).proxyAddress = '0x' + '11'.repeat(20); }, data => { feed(data).docs.baseAsset = 'TSLA'; },
    data => { feed(data).docs.blockchainName = 'Ethereum'; }, data => { feed(data).heartbeat = 86401; }, data => { feed(data).decimals = 18; },
  ]) { const { reader, payload, calls } = setup(); mutate(payload); await assert.rejects(reader.readLaunchQuotePrice('nvda'), /registry|verified|active/); assert.equal(calls.length, 0); }
});

test('rejects wrong RPC, stale blocks, empty code, altered symbol, uid, feed or corporate-action pause', async () => {
  for (const changes of [{ getChainId: async () => 1 }, { getBlock: async () => ({ number: 100000n, timestamp: BigInt(NOW - 121) }) }, { getBlock: async () => ({ number: 100000n, timestamp: BigInt(NOW + 31) }) }, { getCode: async () => '0x' }]) await assert.rejects(setup({ client: changes }).reader.readLaunchQuotePrice('weth'), /Robinhood|block|deployed/);
  for (const [target, result] of [['decimals', 6], ['symbol', 'FAKE'], ['uid', '0x' + '11'.repeat(32)], ['description', 'ETH / EUR'], ['oraclePaused', true]]) {
    const { client, reader } = setup(); const read = client.readContract; client.readContract = async args => args.functionName === target ? result : read(args);
    await assert.rejects(reader.readLaunchQuotePrice('nvda'), /metadata|paused/);
  }
});

test('rejects invalid, incomplete, stale or future Chainlink rounds', async () => {
  const valid = [7n, 34145318048n, BigInt(NOW - 62), BigInt(NOW - 60), 7n];
  for (const values of [[0, 0n], [1, 0n], [1, -1n], [1, 1n << 255n], [2, 0n], [2, BigInt(NOW - 59)], [3, BigInt(NOW + 10)], [3, BigInt(NOW - 86401)], [4, 6n]]) {
    const { client, reader } = setup(); const read = client.readContract; const invalid = [...valid]; invalid[values[0]] = values[1];
    client.readContract = async args => args.functionName === 'latestRoundData' ? invalid : read(args); await assert.rejects(reader.readLaunchQuotePrice('weth'), /stale|incomplete/);
  }
});

test('issuer rejects halted, crossed, wrong-chain, stale, future or malformed price responses', async () => {
  for (const mutate of [
    data => { price(data).isTradingHalt = true; }, data => { price(data).currency = 'EUR'; },
    data => { price(data).deployments[0].chainId = 46630; }, data => { price(data).deployments[0].contractAddress = '0x' + '11'.repeat(20); },
    data => { price(data).bid = '2'; }, data => { price(data).bid = '0'; }, data => { price(data).ask = '1e10'; },
    data => { price(data).generatedAt = new Date((NOW - 91) * 1000).toISOString(); }, data => { price(data).generatedAt = new Date((NOW + 31) * 1000).toISOString(); },
    data => { price(data).generatedAt = 'not-a-date'; }, data => { data.price.quotes.push(price(data)); },
  ]) { const { reader, payload } = setup(); mutate(payload); await assert.rejects(reader.readLaunchQuotePrice('qnt'), /Issuer|issuer/); }
});

test('multiplier disagreements and effective corporate actions block; near-future action bounds review expiry', async () => {
  for (const [target, value] of [['uiMultiplier', 1n], ['uiMultiplier', 0n], ['newUIMultiplier', 2n]]) {
    const { client, reader } = setup(); const read = client.readContract;
    client.readContract = async args => args.functionName === target ? value : args.functionName === 'effectiveAt' ? BigInt(NOW - 1) : read(args);
    await assert.rejects(reader.readLaunchQuotePrice('qnt'), /multiplier|corporate action/);
  }
  const { client, reader } = setup(); const read = client.readContract;
  client.readContract = async args => args.functionName === 'newUIMultiplier' ? MULTIPLIER * 2n : args.functionName === 'effectiveAt' ? BigInt(NOW + 5) : read(args);
  assert.equal((await reader.readLaunchQuotePrice('qnt')).expiresAt, NOW + 5);
});

test('network changes, failed/HTML/oversized service and cancellation never return a price', async () => {
  let reads = 0; await assert.rejects(setup({ client: { getChainId: async () => ++reads === 1 ? 4663 : 1 } }).reader.readLaunchQuotePrice('weth'), /changed networks/);
  let blocks = 0; await assert.rejects(setup({ client: { getBlock: async () => ({ number: 100000n, timestamp: BigInt(NOW - 1), hash: '0x' + (++blocks === 1 ? 'ab' : 'cd').repeat(32) }) } }).reader.readLaunchQuotePrice('qnt'), /block changed/);
  for (const response of [new Response('', { status: 503 }), new Response('<html/>'), jsonResponse({ data: 'x'.repeat(2_000_001) })]) await assert.rejects(setup({ dependencies: { fetcher: async () => response } }).reader.readLaunchQuotePrice('weth'), /unavailable|JSON|large/);
  const controller = new AbortController(); controller.abort(new Error('User switched Friend')); await assert.rejects(setup().reader.readLaunchQuotePrice('weth', controller.signal), /switched Friend/);
});
function output() { const headers: Record<string, string> = {}; return { statusCode: 0, body: '', headers, setHeader: (key: string, value: string) => { headers[key] = value; }, end(body = '') { this.body = body; } }; }
test('proxy accepts catalog IDs only and fetches the minimum official sources without auth or Bankr', async () => {
  const calls: string[] = []; const handler = createLaunchQuotesHandler(async (url: string, init: RequestInit) => { calls.push(url); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.deepEqual(init.headers, { Accept: 'application/json' }); return jsonResponse({ source: url }); });
  for (const request of [{ method: 'POST' }, ...['?url=https://attacker.example', '?asset=qnt&asset=aapl', '?asset=https://attacker.example', '?asset=', '?asset=qnt/../../bad'].map(query => ({ method: 'GET', url: '/api/launch-quotes' + query }))]) { const response = output(); await handler(request, response); assert([400, 405].includes(response.statusCode)); assert.equal(calls.length, 0); }
  const response = output(); await handler({ method: 'GET', url: '/api/launch-quotes?asset=qnt' }, response); assert.equal(response.statusCode, 200); assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(calls.sort(), ['https://api.robinhood.com/rhj/assets', 'https://api.robinhood.com/rhj/prices/QNT'].sort()); calls.length = 0;
  for (const id of ['weth', 'rarefriends', 'usdg', 'cbbtc']) {
    const response = output(); await handler({ method: 'GET', url: `/api/launch-quotes?asset=${id}` }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, ['https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json']); calls.length = 0;
  }
});
test('proxy returns truthful retryable failure when a needed official source is unavailable or too large', async () => {
  for (const responseFactory of [() => new Response('', { status: 403 }), () => new Response('<html>'), () => jsonResponse({ large: 'x'.repeat(600001) })]) { const handler = createLaunchQuotesHandler(async () => responseFactory()), response = output(); await handler({ method: 'GET' }, response); assert.equal(response.statusCode, 503); assert.equal(response.headers['Cache-Control'], 'no-store'); assert.match(JSON.parse(response.body).error, /Retry/); }
});

test('RAREFRIENDS converts its pool average using ETH/USD and includes bounded review evidence', async () => {
  const { reader } = setup(); const quote = await reader.readLaunchQuotePrice('rarefriends');
  assert.equal(quote.source, 'rarefriends-pool'); assert.equal(quote.asset.kind, 'rarefriends'); assert.equal(quote.pool.windowSeconds, 1800);
  assert.equal(quote.usdPriceE18, 9007199254740993120000000000n * quote.pool.wethPerTokenE18 / 10n ** 18n);
  assert.equal(quote.expiresAt, NOW + 120); assert.equal(quote.feedAddress, getLaunchQuoteAsset('weth').feedAddress);
});
