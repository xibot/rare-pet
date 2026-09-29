/** Offline tests; no wallet, RPC or chain transaction. Run node --test tests/rarepet-agent-helper.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calldata, decodePet, decodeRules, inspect, makeRpc, parseArguments, protocol } from '../skills/rarepet/scripts/rarepet.mjs';
const enc = (...values) => '0x' + values.flat().map(value => BigInt(value).toString(16).padStart(64, '0')).join('');
const one = 1n;

test('plans encode the version-pinned overload for the correct Friend', () => {
  const data = calldata('feed', [protocol.collections.generations, 68356n, 1n]);
  assert.equal(data, '0x53db7839' + protocol.collections.generations.slice(2).toLowerCase().padStart(64, '0') + (68356n).toString(16).padStart(64, '0') + '1'.padStart(64, '0'));
  assert.equal(data.length, 202);
});
test('does not accept arbitrary write commands, unknown methods or incomplete plans', async () => {
  assert.throws(() => calldata('approve'), /Unknown/);
  assert.throws(() => parseArguments(['send', '--collection', 'genesis', '--token-id', '2']), /status or plan/);
  assert.throws(() => parseArguments(['plan', '--collection', 'genesis', '--token-id', '2', '--action', 'pet']), /requires/);
  assert.throws(() => parseArguments(['status', '--collection', 'genesis', '--token-id', '2', '--action', 'pet']), /cannot contain/);
  let called = false;
  await assert.rejects(inspect({ collection: 'genesis', tokenId: '2', action: 'play' }, () => { called = true; }), /pet, feed and poop/);
  assert.equal(called, false);
});
test('rejects invalid Friend IDs and addresses before RPC access', async () => {
  const rpc = () => { throw new Error('Unexpected RPC'); };
  for (const tokenId of ['0', '-1', '1e3', '01', (1n << 256n).toString()]) await assert.rejects(inspect({ collection: 'genesis', tokenId }, rpc), /uint256|positive/);
  await assert.rejects(inspect({ collection: 'foreign', tokenId: '1' }, rpc), /Collection/);
  await assert.rejects(inspect({ collection: 'genesis', tokenId: '1', owner: '0x' + '0'.repeat(40) }, rpc), /nonzero/);
});
test('wrong chain stops before any contract or owner read', async () => {
  const calls = [];
  await assert.rejects(inspect({ collection: 'genesis', tokenId: '2' }, async method => { calls.push(method); return '0x1'; }), /not Robinhood/);
  assert.deepEqual(calls, ['eth_chainId']);
});
test('decodes dynamic care tuple and rejects a corrupted play array', () => {
  const raw = enc(32, 5, 6, 30, 4, 0, 999, 2, 0, 100, 200, 300, 999, 608, 2, 0, 1, 1, 1, 0, 2, 12, 13);
  const value = decodePet(raw);
  assert.equal(value.kinship, '5'); assert.equal(value.stamina, '30');
  assert.deepEqual(value.playTimes, ['12', '13']); assert.equal(value.hasPet, true);
  assert.equal('brain' in value, false); assert.equal('unusedCareBrain' in value, false);
  assert.throws(() => decodePet(raw.slice(0, -64)), /play history/);
  assert.throws(() => decodePet(enc(64, ...Array(20).fill(0))), /care tuple/);
});
test('reads live rules without assuming the default Feed reward', () => {
  const raw = enc([1, 0, 86400, 1, 1], [8, 9, 14400, 6, 1], [10, 0, 0, 3, 1], [1, 0, 14400, 6, 1], 86400, 86400, 1, 7, 1, 0);
  const rules = decodeRules(raw);
  assert.equal(rules.actions.feed.points, '8'); assert.equal(rules.actions.feed.secondaryPoints, '9');
  assert.equal(rules.playSigner, '0x' + '0'.repeat(40));
  assert.throws(() => decodeRules(enc([1, 0, 1, 1, 1], ...Array(21).fill(one))), /policy/);
  assert.throws(() => decodeRules('0x'), /length/);
});
test('read-only network layer rejects signing, broadcast, overrides and insecure remote URLs', async () => {
  assert.throws(() => makeRpc('http://remote.example/rpc'), /HTTPS/);
  const rpc = makeRpc('https://rpc.example/private-key');
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'wallet_sendCalls']) await assert.rejects(rpc(method), /forbidden/);
  await assert.rejects(rpc('eth_call', [{ to: protocol.care }, 'latest', {}]), /overrides/);
});
test('network failures never echo the private endpoint', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('PRIVATE_ENDPOINT_SECRET'); };
  try {
    await assert.rejects(makeRpc('https://rpc.example/PRIVATE_ENDPOINT_SECRET')('eth_chainId'), error => !error.message.includes('PRIVATE_ENDPOINT_SECRET') && /failed/.test(error.message));
  } finally { globalThis.fetch = saved; }
});
test('RPC response identity is checked', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 999, result: '0x1237' }));
  try { await assert.rejects(makeRpc('https://rpc.example/')('eth_chainId'), /identity mismatch/); }
  finally { globalThis.fetch = saved; }
});

test('malformed provider error codes cannot leak response text', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 'PRIVATE_ENDPOINT_SECRET', message: 'PRIVATE_ENDPOINT_SECRET' } }));
  try { await assert.rejects(makeRpc('https://rpc.example/')('eth_chainId'), error => !error.message.includes('PRIVATE_ENDPOINT_SECRET') && /failed/.test(error.message)); }
  finally { globalThis.fetch = saved; }
});
test('oversized response streams stop before JSON parsing', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response(' '.repeat(1_000_001));
  try { await assert.rejects(makeRpc('https://rpc.example/')('eth_chainId'), /size limit/); }
  finally { globalThis.fetch = saved; }
});
