import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { createMarketRoutingHandler, type MarketRoutingDiagnostic } from '../api/market-routing.ts';
import catalog from '../games/rare-pet/launch-quote-catalog.json' with { type: 'json' };
import { createPetServer } from '../scripts/pet-site.mjs';

const KEY = 'test-server-secret-do-not-reflect';
const input = { tokenIn: catalog.assets[0].address, tokenOut: catalog.assets[1].address, amount: '1000000000000000000', swapper: '0x1111111111111111111111111111111111111111' };
const route = [[{ type: 'v3-pool', address: '0x2222222222222222222222222222222222222222', tokenIn: { address: input.tokenIn }, tokenOut: { address: input.tokenOut }, fee: '3000' }]];
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
const classic = () => json({ routing: 'CLASSIC', quote: { route, amount: '999', permit2Data: 'not-forwarded' }, requestId: 'not-forwarded' });
type Handler = ReturnType<typeof createMarketRoutingHandler>;
function setup(fetcher: typeof fetch = async () => classic(), options: Parameters<typeof createMarketRoutingHandler>[0] = {}) {
  return createMarketRoutingHandler({ apiKey: () => KEY, fetcher, warn: () => {}, ...options });
}
async function invoke(handler: Handler, body: unknown = input, options: { method?: string; headers?: Record<string, string>; chunks?: Array<string | Buffer> } = {}) {
  const request = Readable.from(options.chunks ?? []) as IncomingMessage & { body?: unknown };
  request.method = options.method ?? 'POST'; request.headers = { 'content-type': 'application/json', ...options.headers };
  if (!options.chunks) request.body = body;
  const headers: Record<string, string> = {}; let raw = '';
  const response = { statusCode: 0, setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; }, end: (body = '') => { raw = body; } };
  await handler(request, response);
  assert.equal(headers['cache-control'], 'no-store'); assert.equal(headers['x-content-type-options'], 'nosniff');
  return { status: response.statusCode, headers, raw, body: JSON.parse(raw) };
}

test('only fixed provider, chain, exact-input policy and server credential are used; response contains routes only', async () => {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const result = await invoke(setup(async (url, init) => { calls.push({ url: String(url), init: init!, body: JSON.parse(init!.body as string) }); return classic(); }));
  assert.equal(result.status, 200); assert.deepEqual(result.body, { routes: [route, route] }); assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://trade-api.gateway.uniswap.org/v1/quote'); assert.equal(call.init.method, 'POST'); assert.equal(call.init.redirect, 'error'); assert(call.init.signal instanceof AbortSignal);
    assert.deepEqual(call.init.headers, { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': KEY, 'x-permit2-disabled': 'true', 'x-universal-router-version': '2.1.1' });
    assert.equal(call.body.type, 'EXACT_INPUT'); assert.equal(call.body.tokenInChainId, 4663); assert.equal(call.body.tokenOutChainId, 4663);
    assert.equal(call.body.permitAmount, 'EXACT'); assert.equal(call.body.slippageTolerance, 0.5); assert.equal(call.body.routingPreference, 'BEST_PRICE');
    for (const key of Object.keys(input)) assert.equal(call.body[key], input[key as keyof typeof input]);
  }
  assert.deepEqual(calls.map(call => call.body.protocols), [['V3'], ['V4']]);
  assert.equal(calls[0].body.hooksOptions, undefined); assert.equal(calls[1].body.hooksOptions, 'V4_NO_HOOKS');
  assert(!result.raw.includes(KEY)); assert(!result.raw.includes('not-forwarded')); assert(!result.raw.includes('permit2'));
});

test('all 199 canonical assets are accepted, with case-insensitive address matching and uint128 maximum', async () => {
  assert.equal(catalog.assets.length, 199);
  for (const asset of catalog.assets) {
    const other = asset.address === input.tokenIn ? input.tokenOut : input.tokenIn;
    const result = await invoke(setup(), { ...input, tokenIn: asset.address.toLowerCase(), tokenOut: other, amount: ((1n << 128n) - 1n).toString() });
    assert.equal(result.status, 200, asset.symbol);
  }
});

test('rejects unreviewed tokens, self pairs, zero wallets, unsafe amounts and any caller-controlled provider settings before fetch', async () => {
  let calls = 0; const handler = setup(async () => { calls++; return classic(); });
  const invalid = [null, [], {}, { ...input, tokenIn: input.swapper }, { ...input, tokenOut: 'https://attacker.test' },
    { ...input, tokenOut: input.tokenIn.toLowerCase() }, { ...input, swapper: '0x' + '0'.repeat(40) }, { ...input, swapper: '0x1234' },
    { ...input, amount: '0' }, { ...input, amount: '-1' }, { ...input, amount: '1.1' }, { ...input, amount: '1e18' }, { ...input, amount: 1 },
    { ...input, amount: '01' }, { ...input, amount: (1n << 128n).toString() }, { ...input, amount: '9'.repeat(40) },
    { ...input, apiKey: KEY }, { ...input, url: 'https://attacker.test' }, { ...input, tokenInChainId: 1 }, { ...input, protocols: ['UNISWAPX'] },
  ];
  for (const value of invalid) assert.equal((await invoke(handler, value)).status, 400);
  assert.equal(calls, 0);
});

test('requires POST and uncompressed JSON; missing configuration is explicit without exposing credentials', async () => {
  let calls = 0; const handler = setup(async () => { calls++; return classic(); }, { apiKey: () => undefined });
  const wrongMethod = await invoke(handler, input, { method: 'GET' }); assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.allow, 'POST');
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/jsonp' }, { 'content-type': 'application/json; charset=latin1' }, { 'content-encoding': 'gzip' }]) {
    assert.equal((await invoke(handler, input, { headers })).status, 415);
  }
  const result = await invoke(handler); assert.equal(result.status, 503); assert.match(result.body.error, /UNISWAP_API_KEY/); assert(!result.raw.includes(KEY)); assert.equal(calls, 0);
});

test('bounds parsed and streaming body bytes and accepts complete streamed JSON', async () => {
  let calls = 0; const handler = setup(async () => { calls++; return classic(); });
  assert.equal((await invoke(handler, { ...input, padding: 'x'.repeat(1024) })).status, 413);
  assert.equal((await invoke(handler, input, { headers: { 'content-length': '1025' } })).status, 413);
  assert.equal((await invoke(handler, input, { headers: { 'content-length': '-1' } })).status, 413);
  assert.equal((await invoke(handler, undefined, { chunks: ['x'.repeat(600), 'x'.repeat(600)] })).status, 413);
  assert.equal((await invoke(handler, '{malformed')).status, 400);
  assert.equal((await invoke(handler, undefined, { chunks: ['{malformed'] })).status, 400); assert.equal(calls, 0);
  const raw = JSON.stringify(input);
  assert.equal((await invoke(handler, undefined, { chunks: [raw.slice(0, 50), raw.slice(50)], headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 200);
  assert.equal(calls, 2);
});

test('protocol requests run in parallel and preserve a successful route when the other fails', async () => {
  let starts = 0; let release: (() => void) | undefined;
  const bothStarted = new Promise<void>(resolve => { release = resolve; });
  const handler = setup(async (_url, init) => {
    starts++; if (starts === 2) release!(); await bothStarted;
    return JSON.parse(init!.body as string).protocols[0] === 'V3' ? classic() : json({ error: KEY }, { status: 403 });
  });
  const result = await invoke(handler); assert.equal(starts, 2); assert.equal(result.status, 200); assert.deepEqual(result.body.routes, [route]);
});

test('valid CLASSIC empty routes are an honest empty result; unknown routing cannot pass through', async () => {
  const empty = await invoke(setup(async () => json({ routing: 'CLASSIC', quote: { route: [] } })));
  assert.equal(empty.status, 200); assert.deepEqual(empty.body, { routes: [] });
  for (const payload of [{ routing: 'DUTCH_V2', quote: { route } }, { routing: 'CLASSIC', quote: { route: KEY } }, { routing: 'CLASSIC', quote: { route: [KEY] } }, { routing: 'CLASSIC', quote: { route: [[null]] } }]) {
    const result = await invoke(setup(async () => json(payload))); assert.equal(result.status, 503); assert(!result.raw.includes(KEY));
  }
});

test('provider errors, malformed JSON, redirects and wrong content types are generic and do not reflect secrets', async () => {
  const responses = [() => json({ error: `Sensitive ${KEY}` }, { status: 401 }), () => new Response(KEY, { status: 302, headers: { location: `https://attacker.test/${KEY}` } }),
    () => new Response(KEY, { headers: { 'content-type': 'text/html' } }), () => new Response('{malformed' + KEY, { headers: { 'content-type': 'application/json' } })];
  for (const make of responses) { const result = await invoke(setup(async () => make())); assert.equal(result.status, 503); assert(!result.raw.includes(KEY)); assert(!result.raw.includes('attacker')); }
  const thrown = await invoke(setup(async () => { throw new Error(`Network error ${KEY}`); })); assert.equal(thrown.status, 503); assert(!thrown.raw.includes(KEY));
});

test('safe diagnostics classify provider failures without logging secrets, bodies, headers or wallet data', async () => {
  const cases: { fetcher: typeof fetch; stage: MarketRoutingDiagnostic['stage']; status?: number }[] = [
    ...[400, 401, 403, 429, 500].map(status => ({ fetcher: async () => json({ error: KEY, wallet: input.swapper }, { status }), stage: 'http' as const, status })),
    { fetcher: async () => { throw new Error(`${KEY} ${JSON.stringify(input)}`); }, stage: 'fetch' },
    { fetcher: async () => new Response(KEY, { headers: { 'content-type': 'text/html' } }), stage: 'response-type', status: 200 },
    { fetcher: async () => json({ secret: KEY }, { headers: { 'content-length': '200001' } }), stage: 'response-size', status: 200 },
    { fetcher: async () => new Response(`{${KEY}`, { headers: { 'content-type': 'application/json' } }), stage: 'response-json', status: 200 },
    { fetcher: async () => json({ routing: KEY, quote: { route } }), stage: 'response-shape', status: 200 },
    { fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(KEY)); } }), { headers: { 'content-type': 'application/json' } }), stage: 'response-body', status: 200 },
    { fetcher: async () => new Promise<Response>(() => {}), stage: 'timeout' },
  ];
  for (const entry of cases) {
    const logs: MarketRoutingDiagnostic[] = [];
    const result = await invoke(setup(entry.fetcher, { timeoutMs: 10, warn: diagnostic => logs.push(diagnostic) }));
    assert.equal(result.status, 503);
    assert.deepEqual(logs, ['V3', 'V4'].map(protocol => ({ protocol, stage: entry.stage, ...(entry.status === undefined ? {} : { status: entry.status }) })));
    assert(logs.every(Object.isFrozen));
    const rendered = JSON.stringify(logs);
    for (const privateValue of [KEY, ...Object.values(input), '"headers":', '"body":', 'x-api-key']) assert(!rendered.includes(privateValue));
  }
});

test('diagnostics log at most failed protocols, remain quiet for success/input errors, and cannot break a partial success', async () => {
  const logs: MarketRoutingDiagnostic[] = [];
  const handler = setup(async (_url, init) => JSON.parse(init!.body as string).protocols[0] === 'V3' ? classic() : json({ error: KEY }, { status: 401 }), { warn: diagnostic => { logs.push(diagnostic); throw new Error('Logger unavailable'); } });
  const result = await invoke(handler); assert.equal(result.status, 200); assert.deepEqual(result.body.routes, [route]);
  assert.deepEqual(logs, [{ protocol: 'V4', stage: 'http', status: 401 }]);
  logs.length = 0;
  await invoke(handler, { ...input, tokenIn: 'invalid' }); assert.equal(logs.length, 0);
  await invoke(setup(async () => classic(), { warn: diagnostic => logs.push(diagnostic) })); assert.equal(logs.length, 0);
});

test('provider response size is bounded using declared and actual streamed bytes', async () => {
  for (const make of [() => json({ routing: 'CLASSIC', quote: { route } }, { headers: { 'content-length': '200001' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(100001))); controller.enqueue(new TextEncoder().encode('x'.repeat(100001))); controller.close(); } }), { headers: { 'content-type': 'application/json', 'content-length': '1' } })]) {
    const result = await invoke(setup(async () => make())); assert.equal(result.status, 503);
  }
});

test('deadline aborts stalled fetch and body streams without exposing provider errors', async () => {
  const signals: AbortSignal[] = [];
  const timed = await invoke(setup(async (_url, init) => { signals.push(init!.signal!); return new Promise<Response>(() => {}); }, { timeoutMs: 10 }));
  assert.equal(timed.status, 503); assert(signals.every(signal => signal.aborted));
  const stream = await invoke(setup(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }), { headers: { 'content-type': 'application/json' } }), { timeoutMs: 10 }));
  assert.equal(stream.status, 503);
});

test('bounded per-instance budget limits provider traffic and recovers next minute', async () => {
  let now = 1000, calls = 0;
  const handler = setup(async () => { calls++; return classic(); }, { now: () => now });
  for (let count = 0; count < 120; count++) assert.equal((await invoke(handler)).status, 200);
  const limited = await invoke(handler); assert.equal(limited.status, 429); assert.equal(limited.headers['retry-after'], '60'); assert.equal(calls, 240);
  now += 60_000; assert.equal((await invoke(handler)).status, 200); assert.equal(calls, 242);
});

test('local site dispatches the real endpoint instead of a static 404', { timeout: 1000 }, async () => {
  const server = createPetServer('/unused');
  const request = Readable.from([]) as IncomingMessage; request.method = 'GET'; request.url = '/api/market-routing'; request.headers = {};
  const headers: Record<string, string> = {};
  let raw = '';
  const response = { statusCode: 0, setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; }, end: (_body = '') => {} };
  await new Promise<void>(resolve => { response.end = (body = '') => { raw = body; resolve(); }; server.emit('request', request, response); });
  assert.equal(response.statusCode, 405); assert.equal(headers.allow, 'POST'); assert.deepEqual(JSON.parse(raw), { error: 'Use POST.' });
});
