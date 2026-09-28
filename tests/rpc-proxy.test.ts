import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRpcHandler, RPC_LIMITS } from '../api/rpc.ts';
import { getPrivateRpcUrl } from '../server/rarepet-rpc.ts';

const ENDPOINT = 'https://private-rpc.example/secret-fixture-key';
const ADDRESS = `0x${'11'.repeat(20)}`, HASH = `0x${'ab'.repeat(32)}`;
type Handler = ReturnType<typeof createRpcHandler>;
type Options = NonNullable<Parameters<typeof createRpcHandler>[0]>;
const call = (method = 'eth_chainId', params: unknown[] = [], id: number | string = 1) => ({ jsonrpc: '2.0', id, method, params });
const result = (id: number | string, value: unknown) => ({ jsonrpc: '2.0', id, result: value });
const response = (value: unknown) => Response.json(value);
function setup(options: Options = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const handler = createRpcHandler({ rpcUrl: () => ENDPOINT, environment: { VERCEL: '1', NODE_ENV: 'production' },
    fetcher: async (url, init) => { calls.push({ url: String(url), init: init! }); return response(result(JSON.parse(String(init?.body)).id, '0x1237')); }, ...options });
  return { handler, calls };
}
async function invoke(handler: Handler, body: unknown = call(), options: { method?: string; headers?: Record<string, string | string[] | undefined>; streamed?: boolean } = {}) {
  const request = Object.assign(Readable.from(options.streamed ? [typeof body === 'string' ? body : JSON.stringify(body)] : []), {
    method: options.method ?? 'POST', headers: { origin: 'https://rarepet.app', 'content-type': 'application/json', ...options.headers },
    ...(options.streamed ? {} : { body }),
  });
  const headers = new Map<string, string>(); let text = '';
  const reply = { statusCode: 200, setHeader: (key: string, value: string) => { headers.set(key, value); }, end: (value: string) => { text = value; } };
  await handler(request as never, reply as never);
  assert.equal(headers.get('Content-Type'), 'application/json'); assert.equal(headers.get('Cache-Control'), 'no-store');
  return { status: reply.statusCode, headers, body: JSON.parse(text), text };
}

test('private RPC configuration prefers the new variable, accepts legacy, and never exposes invalid values', () => {
  assert.equal(getPrivateRpcUrl({ RAREPET_RPC_URL: ENDPOINT, RAREPET_SNAPSHOT_RPC_URL: 'https://legacy.example/key' }), ENDPOINT);
  assert.equal(getPrivateRpcUrl({ RAREPET_SNAPSHOT_RPC_URL: ' https://legacy.example/key\n' }), 'https://legacy.example/key');
  for (const value of [undefined, '', 'http://private.example/secret', 'not a URL secret', 'https://user:secret@private.example', 'https://private.example/#secret']) {
    assert.throws(() => getPrivateRpcUrl({ RAREPET_RPC_URL: value }), { message: 'Private RPC is not configured correctly.' });
  }
});

test('valid read requests preserve IDs, normalize absent params, use one fixed destination and never forward browser headers', async () => {
  const { handler, calls } = setup();
  const output = await invoke(handler, { jsonrpc: '2.0', id: 'client-42', method: 'eth_chainId' }, { headers: { authorization: 'browser-secret' }, streamed: true });
  assert.equal(output.status, 200); assert.deepEqual(output.body, result('client-42', '0x1237'));
  assert.equal(calls.length, 1); assert.equal(calls[0].url, ENDPOINT); assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), call('eth_chainId', [], 'client-42'));
});

test('origin, method, encoding and request size gates reject before contacting the provider', async () => {
  const { handler, calls } = setup();
  for (const origin of ['https://attacker.example', 'null', 'https://rarepet.app.attacker.example', 'https://rarepet.app/path', 'http://localhost:4175']) {
    assert.equal((await invoke(handler, call(), { headers: { origin, 'sec-fetch-site': 'same-origin' } })).status, 403);
  }
  assert.equal((await invoke(handler, call(), { headers: { origin: undefined } })).status, 403);
  assert.equal((await invoke(handler, call(), { headers: { origin: ['https://rarepet.app'] } })).status, 403);
  assert.equal((await invoke(handler, call(), { headers: { origin: undefined, 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await invoke(handler, call(), { method: 'GET' })).status, 405);
  assert.equal((await invoke(handler, call(), { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await invoke(handler, call(), { headers: { 'content-encoding': 'gzip' } })).status, 415);
  assert.equal((await invoke(handler, call(), { headers: { 'content-length': String(RPC_LIMITS.inputBytes + 1) } })).status, 413);
  assert.equal((await invoke(handler, ' '.repeat(RPC_LIMITS.inputBytes + 1), { streamed: true })).status, 413);
  assert.equal((await invoke(handler, '{invalid-json')).body.error.code, -32700);
  assert.equal(calls.length, 0);
});

test('same-origin fetch metadata and exact Vercel preview origins are accepted; loopback is development-only', async () => {
  const live = setup({ environment: { VERCEL: '1', VERCEL_URL: 'rarepet-fixture.vercel.app' } });
  assert.equal((await invoke(live.handler, call(), { headers: { origin: undefined, 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal((await invoke(live.handler, call(), { headers: { origin: 'https://rarepet-fixture.vercel.app' } })).status, 200);
  for (const origin of ['https://rarepet.app', 'https://www.rarepet.app', 'https://rarepet.vercel.app', 'https://rarepet-xibot.vercel.app']) {
    assert.equal((await invoke(live.handler, call(), { headers: { origin } })).status, 200);
  }
  assert.equal((await invoke(live.handler, call(), { headers: { origin: 'https://some-other-preview.vercel.app' } })).status, 403);
  for (const environment of [{ VERCEL: '1' }, { NODE_ENV: 'production' }]) {
    assert.equal((await invoke(setup({ environment }).handler, call(), { headers: { origin: 'http://127.0.0.1:4175' } })).status, 403);
  }
  const development = setup({ environment: {} });
  for (const origin of ['http://localhost:4175', 'http://127.0.0.1:4175', 'http://[::1]:4175']) assert.equal((await invoke(development.handler, call(), { headers: { origin } })).status, 200);
  assert.equal((await invoke(development.handler, call(), { headers: { origin: 'http://192.168.1.1:4175' } })).status, 403);
});

test('only whitelisted read methods and bounded standard parameters are forwarded', async () => {
  const { handler, calls } = setup();
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4', 'wallet_addEthereumChain', 'debug_traceCall', 'admin_peers', 'eth_subscribe', 'eth_newFilter', 'net_version']) {
    const output = await invoke(handler, call(method)); assert.equal(output.status, 400); assert.equal(output.body.error.code, -32601);
  }
  const invalid = [
    { jsonrpc: '2.0', method: 'eth_chainId' }, { ...call(), id: null }, { ...call(), id: {} }, { ...call(), id: 'x'.repeat(101) },
    { ...call(), jsonrpc: '1.0' }, { ...call(), url: 'https://attacker.example' }, { ...call(), params: {} }, { ...call(), params: null },
    call('eth_call', [{ to: ADDRESS, data: '0x00' }, 'latest', {}]), call('eth_call', [{ to: ADDRESS, data: '0x00', stateOverride: {} }, 'latest']),
    call('eth_call', [{ to: 'https://attacker.example' }, 'latest']), call('eth_call', [{ to: ADDRESS, data: '0x1' }, 'latest']),
    call('eth_call', [{ to: ADDRESS, gas: '0x00' }, 'latest']), call('eth_call', [{}, 'latest']),
    call('eth_call', [{ to: ADDRESS, data: `0x${'aa'.repeat(RPC_LIMITS.dataBytes + 1)}` }, 'latest']),
    call('eth_getBalance', [ADDRESS, { blockNumber: '0x1' }]), call('eth_getBalance', [ADDRESS, '-1']), call('eth_getBalance', [ADDRESS, ['latest']]),
    call('eth_getLogs', [{ blockHash: HASH, fromBlock: '0x0' }]), call('eth_getLogs', [{ topics: [HASH, HASH, HASH, HASH, HASH] }]),
    call('eth_getLogs', [{ address: 'bad' }]), call('eth_getLogs', [{ topics: [[...Array(21).fill(HASH)]] }]),
    call('eth_getLogs', [{}]), call('eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest' }]),
    call('eth_getLogs', [{ topics: [null, [null, HASH]] }]),
    call('eth_feeHistory', ['0x401', 'latest', []]), call('eth_feeHistory', ['0x1', 'latest', [80, 20]]),
    [], Array.from({ length: RPC_LIMITS.batch + 1 }, (_, id) => call('eth_chainId', [], id)), [call(), call()],
  ];
  for (const body of invalid) assert.equal((await invoke(handler, body)).status, 400);
  assert.equal(calls.length, 0);
});

test('all app read methods accept representative payloads, deployless verification, full-history logs and reversed batch replies', async () => {
  const tx = { hash: HASH, from: ADDRESS, to: ADDRESS, input: '0x00', value: '0x0' };
  const examples: [string, unknown[], unknown][] = [
    ['eth_chainId', [], '0x1237'], ['eth_blockNumber', [], '0x4680000'], ['eth_gasPrice', [], '0x1'], ['eth_maxPriorityFeePerGas', [], '0x1'],
    ['eth_getBalance', [ADDRESS, 'latest'], '0x0'], ['eth_getTransactionCount', [ADDRESS, 'pending'], '0x1'],
    ['eth_getCode', [ADDRESS, '0x123'], '0x6000'], ['eth_getBlockByNumber', ['latest', false], { hash: HASH, number: '0x1', timestamp: '0x2', transactions: [HASH] }],
    ['eth_getBlockByHash', [HASH, true], { hash: HASH, number: '0x1', timestamp: '0x2', transactions: [tx] }],
    ['eth_getTransactionByHash', [HASH], tx], ['eth_getTransactionReceipt', [HASH], { transactionHash: HASH, blockHash: HASH, blockNumber: '0x1', logs: [] }],
    ['eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest', topics: [HASH, null, HASH] }], []],
    ['eth_getLogs', [{ address: ADDRESS, fromBlock: '0x0', toBlock: '0x4680000', topics: [HASH, null, HASH] }], []],
    ['eth_call', [{ from: ADDRESS, to: ADDRESS, data: '0xaabb', value: '0x0', accessList: [{ address: ADDRESS, storageKeys: [HASH] }] }, 'latest'], '0x1234'],
    ['eth_call', [{ data: '0x6000' }, 'latest'], '0x01'],
    ['eth_estimateGas', [{ from: ADDRESS, to: ADDRESS, data: '0xaabb', value: '0x0' }], '0x123'],
    ['eth_feeHistory', ['0x1', 'latest', [25, 75]], { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x2'], gasUsedRatio: [0.5], reward: [['0x1', '0x2']] }],
  ];
  const input = examples.map(([method, params], index) => call(method, params, index));
  const expected = examples.map(([, , value], index) => result(index, value)).reverse();
  const state = setup({ fetcher: async () => response(expected) });
  const output = await invoke(state.handler, input);
  assert.equal(output.status, 200); assert.deepEqual(output.body, expected);
});

test('missing configuration, fetch errors, HTTP failures and timeouts return safe JSON without provider details', async () => {
  const missing = setup({ rpcUrl: () => getPrivateRpcUrl({}) });
  assert.equal((await invoke(missing.handler)).status, 503); assert.equal(missing.calls.length, 0);
  for (const fetcher of [
    async () => { throw new Error(`Authentication failed at ${ENDPOINT}`); },
    async () => new Response(`Error from ${ENDPOINT}`, { status: 500 }),
    async () => new Response('<html>Bad gateway</html>', { headers: { 'Content-Type': 'text/html' } }),
  ]) {
    const output = await invoke(setup({ fetcher }).handler); assert.equal(output.status, 502); assert(!output.text.includes('secret-fixture-key'));
  }
  const limited = await invoke(setup({ fetcher: async () => new Response(ENDPOINT, { status: 429 }) }).handler);
  assert.equal(limited.status, 429); assert.match(limited.body.error.message, /rate limit/i); assert(!limited.text.includes(ENDPOINT));
  let signal: AbortSignal | undefined;
  const timed = await invoke(setup({ timeoutMs: 10, fetcher: async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); } }).handler);
  assert.equal(timed.status, 504); assert.equal(signal?.aborted, true); assert.match(timed.body.error.message, /timed out/);
});

test('upstream messages and metadata are redacted while codes and bounded revert bytes survive', async () => {
  const cases = [
    { code: 3, message: ENDPOINT, data: '0xdeadbeef', expected: 'Execution reverted.' },
    { code: -32000, message: ENDPOINT, data: { originalError: { data: '0xaabb', message: ENDPOINT }, secret: ENDPOINT }, expected: 'Execution reverted.' },
    { code: -32000, message: `request denied at ${ENDPOINT}`, data: { message: ENDPOINT }, expected: 'RPC request failed.' },
    { code: -32005, message: `too many requests; ${ENDPOINT}`, expected: 'RPC rate limit exceeded. Retry shortly.' },
    { code: -32000, message: `block range too wide at ${ENDPOINT}`, expected: 'RPC block range limit exceeded. Retry a smaller range.' },
    { code: -32000, message: ENDPOINT, data: `0x${'ab'.repeat(RPC_LIMITS.dataBytes + 1)}`, expected: 'RPC request failed.' },
  ];
  for (const fixture of cases) {
    const { expected, ...error } = fixture;
    const output = await invoke(setup({ fetcher: async () => response({ jsonrpc: '2.0', id: 1, error, providerUrl: ENDPOINT }) }).handler, call('eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest', topics: [HASH] }]));
    assert.equal(output.status, 200); assert.equal(output.body.error.code, error.code); assert.equal(output.body.error.message, expected);
    assert(!output.text.includes('secret-fixture-key')); assert(!Object.hasOwn(output.body, 'providerUrl'));
    if (expected === 'Execution reverted.') assert.match(output.body.error.data, /^0x(?:deadbeef|aabb)$/);
    else assert.equal(output.body.error.data, undefined);
  }
});

test('standard result fields are projected recursively and provider metadata never leaves the proxy', async () => {
  const secret = { providerUrl: ENDPOINT, errorMessage: ENDPOINT };
  const log = { address: ADDRESS, topics: [HASH], data: '0x00', transactionHash: HASH, blockHash: HASH, blockNumber: '0x1', logIndex: '0x0', ...secret };
  const tx = { hash: HASH, from: ADDRESS, to: ADDRESS, input: '0x00', value: '0x0', ...secret,
    accessList: [{ address: ADDRESS, storageKeys: [HASH], ...secret }],
    authorizationList: [{ address: ADDRESS, chainId: '0x1237', nonce: '0x0', yParity: '0x0', r: '0x1', s: '0x2', ...secret }],
  };
  const examples: [string, unknown[], unknown][] = [
    ['eth_getBlockByNumber', ['latest', true], { hash: HASH, number: '0x1', timestamp: '0x2', transactions: [tx], ...secret,
      withdrawals: [{ index: '0x0', validatorIndex: '0x1', address: ADDRESS, amount: '0x2', ...secret }] }],
    ['eth_getTransactionByHash', [HASH], tx],
    ['eth_getTransactionReceipt', [HASH], { transactionHash: HASH, blockHash: HASH, blockNumber: '0x1', logs: [log], ...secret }],
    ['eth_getLogs', [{ address: ADDRESS }], [log]],
    ['eth_feeHistory', ['0x1', 'latest', []], { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x2'], gasUsedRatio: [0.5], ...secret }],
  ];
  for (const [method, params, value] of examples) {
    const output = await invoke(setup({ fetcher: async () => response({ ...result(1, value), ...secret }) }).handler, call(method, params));
    assert.equal(output.status, 200); assert(!output.text.includes(ENDPOINT)); assert(!output.text.includes('providerUrl')); assert(!output.text.includes('errorMessage'));
    assert.equal(output.body.id, 1); assert(Object.hasOwn(output.body, 'result'));
  }
  const invalidKnownField = await invoke(setup({ fetcher: async () => response(result(1, { ...tx, gasPrice: ENDPOINT })) }).handler, call('eth_getTransactionByHash', [HASH]));
  assert.equal(invalidKnownField.status, 502); assert(!invalidKnownField.text.includes(ENDPOINT));
});

test('bounded provider bodies and complete matching response schemas fail closed', async () => {
  const malformed = [
    {}, result(2, '0x1237'), { ...result(1, '0x1237'), jsonrpc: '1.0' }, { ...result(1, '0x1237'), error: { code: -1 } },
    { jsonrpc: '2.0', id: 1, error: { code: 'bad', message: ENDPOINT } }, result(1, ENDPOINT), [result(1, '0x1237')],
  ];
  for (const value of malformed) {
    const output = await invoke(setup({ fetcher: async () => response(value) }).handler); assert.equal(output.status, 502); assert(!output.text.includes(ENDPOINT));
  }
  for (const value of [[result(1, '0x1237')], [result(1, '0x1237'), result(1, '0x1237')]]) {
    assert.equal((await invoke(setup({ fetcher: async () => response(value) }).handler, [call(), call('eth_chainId', [], 2)])).status, 502);
  }
  for (const headers of [{ 'Content-Type': 'application/json' }, { 'Content-Type': 'application/json', 'Content-Length': String(RPC_LIMITS.outputBytes + 1) }]) {
    const output = await invoke(setup({ fetcher: async () => new Response(' '.repeat(RPC_LIMITS.outputBytes + 1), { headers }) }).handler);
    assert.equal(output.status, 502); assert.match(output.body.error.message, /response size/);
  }
});

test('per-instance concurrency and call-rate backstops include batches and release capacity after completion', async () => {
  let release!: (value: Response) => void, invoked = 0, time = 0;
  const concurrent = setup({ maxConcurrent: 1, fetcher: async () => { invoked++; return new Promise<Response>(resolve => { release = resolve; }); } });
  const first = invoke(concurrent.handler);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await invoke(concurrent.handler)).status, 429); assert.equal(invoked, 1);
  release(response(result(1, '0x1237'))); assert.equal((await first).status, 200);
  const rate = setup({ requestsPerMinute: 2, now: () => time, fetcher: async (_url, init) => {
    const input = JSON.parse(String(init?.body)); return response(Array.isArray(input) ? input.map(item => result(item.id, '0x1237')) : result(input.id, '0x1237'));
  } });
  assert.equal((await invoke(rate.handler, [call(), call('eth_chainId', [], 2)])).status, 200);
  assert.equal((await invoke(rate.handler)).status, 429);
  time = 60_000; assert.equal((await invoke(rate.handler)).status, 200);
});

test('concurrency counts calls within batches and restores slots after each request', async () => {
  const pending: { resolve: (value: Response) => void; input: ReturnType<typeof call> | ReturnType<typeof call>[] }[] = [];
  const state = setup({ maxConcurrent: 3, fetcher: async (_url, init) => new Promise<Response>(resolve => { pending.push({ resolve, input: JSON.parse(String(init?.body)) }); }) });
  const first = invoke(state.handler, [call(), call('eth_chainId', [], 2)]);
  while (pending.length < 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await invoke(state.handler, [call(), call('eth_chainId', [], 2)])).status, 429);
  const lastSlot = invoke(state.handler);
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await invoke(state.handler)).status, 429);
  for (const item of pending) item.resolve(response(Array.isArray(item.input) ? item.input.map(call => result(call.id, '0x1237')) : result(item.input.id, '0x1237')));
  assert.equal((await first).status, 200); assert.equal((await lastSlot).status, 200);
  const after = invoke(state.handler, [call(), call('eth_chainId', [], 2)]);
  while (pending.length < 3) await new Promise(resolve => setImmediate(resolve));
  pending[2].resolve(response([result(1, '0x1237'), result(2, '0x1237')])); assert.equal((await after).status, 200);
});
