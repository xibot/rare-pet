import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = fileURLToPath(new URL('../games/rare-pet/launch-quotes.ts', import.meta.url));
const proxySource = fileURLToPath(new URL('../api/launch-quotes.ts', import.meta.url));
const bundled = await build({ stdin: { contents: `export * from ${JSON.stringify(source)}; export * from ${JSON.stringify(proxySource)};`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { LAUNCH_QUOTE_ASSETS, getLaunchQuoteAsset, createLaunchQuoteReader, createLaunchQuotesHandler } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const NOW = 1_790_000_000;
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
function directory() {
  return {
    bankr: { chain: 'robinhood', provider: 'doppler', quoteTokens: LAUNCH_QUOTE_ASSETS.map(asset => ({ address: asset.address, symbol: asset.symbol, kind: asset.kind === 'weth' ? 'major' : 'stock' })) },
    robinhood: { assets: LAUNCH_QUOTE_ASSETS.filter(asset => asset.kind === 'stock').map(asset => ({ tokenSymbol: asset.symbol, status: 'ASSET_STATUS_ACTIVE', tokenDecimals: 18,
      currentMultiplier: '1.999999999999999999', deployments: [{ chainId: 4663, contractAddress: asset.address }] })) },
    chainlink: LAUNCH_QUOTE_ASSETS.map(asset => ({ proxyAddress: asset.feedAddress, name: asset.feedName, decimals: 8, heartbeat: 86400,
      docs: { blockchainName: 'Robinhood', baseAsset: asset.kind === 'weth' ? 'ETH' : asset.symbol, quoteAsset: 'USD', assetClass: asset.kind === 'weth' ? 'Crypto' : 'Equity' } })),
  };
}
function setup(options: Record<string, unknown> = {}) {
  const calls: Record<string, unknown>[] = [], payload = directory();
  const client = {
    getChainId: async () => 4663,
    getBlock: async () => ({ number: 77n, timestamp: BigInt(NOW - 1) }),
    getCode: async (args: Record<string, unknown>) => { calls.push({ operation: 'code', ...args }); return '0x60006000'; },
    readContract: async (args: Record<string, unknown>) => {
      calls.push(args);
      const asset = LAUNCH_QUOTE_ASSETS.find(asset => asset.address === args.address || asset.feedAddress === args.address);
      assert(asset, 'only pinned addresses can be read');
      if (args.functionName === 'decimals') return args.address === asset.address ? 18 : 8;
      if (args.functionName === 'symbol') return asset.symbol;
      if (args.functionName === 'description') return asset.feedDescription;
      if (args.functionName === 'oraclePaused') return false;
      if (args.functionName === 'latestRoundData') return [7n, 900719925474099312n, BigInt(NOW - 62), BigInt(NOW - 60), 7n];
      assert.fail(`Unexpected read ${args.functionName}`);
    },
    ...(options.client as object ?? {}),
  };
  const reader = createLaunchQuoteReader({ clientFactory: () => client, now: () => NOW * 1000,
    fetcher: async (url: string, init: RequestInit) => { assert.equal(url, '/api/launch-quotes'); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); return jsonResponse(payload); },
    ...(options.dependencies as object ?? {}),
  });
  return { reader, client, payload, calls };
}

test('only five immutable, full-length canonical quote contracts can be selected', () => {
  assert.equal(LAUNCH_QUOTE_ASSETS.length, 5);
  for (const asset of LAUNCH_QUOTE_ASSETS) {
    assert.match(asset.address, /^0x[0-9a-fA-F]{40}$/); assert.match(asset.feedAddress, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(asset.chainId, 4663); assert.equal(asset.decimals, 18); assert(Object.isFrozen(asset));
  }
  assert.equal(getLaunchQuoteAsset('weth').address.toLowerCase(), '0x0bd7d308f8e1639fab988df18a8011f41eacad73');
  for (const id of ['STOCKS', 'ETH', '0x1111111111111111111111111111111111111111', '<script>']) assert.throws(() => getLaunchQuoteAsset(id), /supported/);
});

test('validates selected stock at one block and retains exact price without double-applying multiplier', async () => {
  const { reader, calls } = setup(); const quote = await reader.readLaunchQuotePrice('nvda');
  assert.equal(quote.asset.symbol, 'NVDA'); assert.equal(quote.usdPriceE18, 9007199254740993120000000000n);
  assert.equal(quote.usdPrice, '9007199254.74099312'); assert.equal(quote.updatedAt, NOW - 60);
  assert.equal(quote.expiresAt, NOW + 120); assert.equal(quote.blockNumber, 77n); assert.equal(quote.sequencerVerified, false);
  assert(calls.every(call => call.blockNumber === 77n));
  assert(calls.some(call => call.functionName === 'oraclePaused'));
  assert(calls.every(call => call.address === quote.asset.address || call.address === quote.asset.feedAddress));
});

test('WETH has no dependency on an unrelated stock being active or its oracle being healthy', async () => {
  const { reader, payload, calls } = setup(); payload.robinhood.assets = [];
  const quote = await reader.readLaunchQuotePrice('weth'); assert.equal(quote.asset.kind, 'weth');
  assert(!calls.some(call => call.functionName === 'oraclePaused'));
});

test('registry chain/provider/address/symbol/status/decimals/feed mismatches fail closed', async () => {
  for (const mutate of [
    data => { data.bankr.chain = 'base'; }, data => { data.bankr.provider = 'clanker'; },
    data => { data.bankr.quoteTokens[1].address = '0x1111111111111111111111111111111111111111'; },
    data => { data.bankr.quoteTokens[1].symbol = 'FAKE'; },
    data => { data.robinhood.assets[0].deployments[0].chainId = 46630; },
    data => { data.robinhood.assets[0].status = 'ASSET_STATUS_INACTIVE'; },
    data => { data.robinhood.assets[0].tokenDecimals = 6; },
    data => { data.chainlink[1].proxyAddress = data.chainlink[0].proxyAddress; },
    data => { data.chainlink[1].docs.baseAsset = 'TSLA'; },
    data => { data.chainlink[1].docs.blockchainName = 'Ethereum'; },
    data => { data.chainlink[1].heartbeat = 86401; },
    data => { data.chainlink[1].decimals = 18; },
  ]) {
    const { reader, payload, calls } = setup(); mutate(payload);
    await assert.rejects(reader.readLaunchQuotePrice('nvda'), /registry|verified|active/);
    assert.equal(calls.length, 0, 'mismatched registry cannot reach contract reads');
  }
});

test('rejects wrong RPC chain, stale or future blocks, empty bytecode and altered metadata', async () => {
  for (const changes of [
    { getChainId: async () => 1 },
    { getBlock: async () => ({ number: 77n, timestamp: BigInt(NOW - 121) }) },
    { getBlock: async () => ({ number: 77n, timestamp: BigInt(NOW + 31) }) },
    { getCode: async () => '0x' },
  ]) await assert.rejects(setup({ client: changes }).reader.readLaunchQuotePrice('weth'), /Robinhood|block|deployed/);
  for (const [target, result] of [['decimals', 6], ['symbol', 'FAKE'], ['description', 'ETH / EUR'], ['oraclePaused', true]]) {
    const { client, reader } = setup(); const read = client.readContract;
    client.readContract = async args => args.functionName === target ? result : read(args);
    await assert.rejects(reader.readLaunchQuotePrice('nvda'), /metadata|paused/);
  }
});

test('rejects invalid/incomplete/stale/future oracle rounds and limits review to the remaining heartbeat', async () => {
  const valid = [7n, 34145318048n, BigInt(NOW - 62), BigInt(NOW - 60), 7n];
  for (const values of [
    [0, 0n], [1, 0n], [1, -1n], [1, 1n << 255n], [2, 0n], [2, BigInt(NOW - 59)],
    [3, BigInt(NOW + 10)], [3, BigInt(NOW - 86401)], [4, 6n],
  ]) {
    const { client, reader } = setup(); const read = client.readContract; const invalid = [...valid]; invalid[values[0]] = values[1];
    client.readContract = async args => args.functionName === 'latestRoundData' ? invalid : read(args);
    await assert.rejects(reader.readLaunchQuotePrice('weth'), /stale|incomplete/);
  }
  const { client, reader } = setup(); const read = client.readContract;
  client.readContract = async args => args.functionName === 'latestRoundData' ? [7n, 34145318048n, BigInt(NOW - 86391), BigInt(NOW - 86390), 7n] : read(args);
  assert.equal((await reader.readLaunchQuotePrice('weth')).expiresAt, NOW + 10);
});

test('network change, failed/HTML/oversized service response and caller cancellation never return a price', async () => {
  let reads = 0;
  await assert.rejects(setup({ client: { getChainId: async () => ++reads === 1 ? 4663 : 1 } }).reader.readLaunchQuotePrice('weth'), /changed networks/);
  for (const response of [new Response('', { status: 503 }), new Response('<html/>'), jsonResponse({ data: 'x'.repeat(2_000_001) })]) {
    await assert.rejects(setup({ dependencies: { fetcher: async () => response } }).reader.readLaunchQuotePrice('weth'), /unavailable|JSON|large/);
  }
  const controller = new AbortController(); controller.abort(new Error('User switched Friend'));
  await assert.rejects(setup().reader.readLaunchQuotePrice('weth', controller.signal), /switched Friend/);
});

function output() {
  const headers: Record<string, string> = {};
  return { statusCode: 0, body: '', headers, setHeader: (key: string, value: string) => { headers[key] = value; }, end(body = '') { this.body = body; } };
}
test('proxy accepts only GET with no parameters and reads only the three official URLs without auth', async () => {
  const calls: string[] = [];
  const handler = createLaunchQuotesHandler(async (url: string, init: RequestInit) => {
    calls.push(url); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { Accept: 'application/json' }); return jsonResponse({ source: url });
  });
  for (const request of [{ method: 'POST' }, { method: 'GET', url: '/api/launch-quotes?url=https://attacker.example' }]) {
    const response = output(); await handler(request, response); assert([400, 405].includes(response.statusCode)); assert.equal(calls.length, 0);
  }
  const response = output(); await handler({ method: 'GET' }, response); assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.sort(), ['https://api.bankr.bot/token-launches/quote-tokens?chain=robinhood', 'https://api.robinhood.com/rhj/assets', 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json'].sort());
  assert.deepEqual(Object.keys(JSON.parse(response.body)).sort(), ['bankr', 'chainlink', 'robinhood']);
});

test('proxy returns a truthful retryable failure when any registry is unavailable or too large', async () => {
  for (const responseFactory of [() => new Response('', { status: 403 }), () => new Response('<html>'), () => jsonResponse({ large: 'x'.repeat(600001) })]) {
    const handler = createLaunchQuotesHandler(async () => responseFactory()), response = output();
    await handler({ method: 'GET' }, response); assert.equal(response.statusCode, 503);
    assert.equal(response.headers['Cache-Control'], 'no-store'); assert.match(JSON.parse(response.body).error, /Retry/);
  }
});
