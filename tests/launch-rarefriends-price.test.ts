import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { poolFixture, POOL_NOW, POOL_ID, POOL_SQRT, POOL_LIQUIDITY, poolHash } from './fixtures/rarefriends-pool.ts';
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../games/rare-pet/launch-rarefriends-price.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm' });
const { readRareFriendsPoolPrice } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const run = fixture => readRareFriendsPoolPrice(fixture.client, fixture.block, new AbortController().signal);
const price = (sqrt: bigint) => sqrt * sqrt * 10n ** 18n / (1n << 192n);

test('RF price integrates every event over exactly 30 minutes, using permanent full-range depth', async () => {
  const f = poolFixture(), calls = []; const read = f.client.readContract, logs = f.client.getLogs;
  f.client.readContract = async args => { calls.push(args); return read(args); };
  f.client.getLogs = async args => { assert.equal(args.fromBlock, 28000n); assert.equal(args.toBlock, 100000n); assert.equal(args.strict, true); assert.equal(args.args.id, POOL_ID); return logs(); };
  const q = await run(f);
  assert.equal(q.wethPerTokenE18, (price(POOL_SQRT) * 1200n + price(POOL_SQRT * 1001n / 1000n) * 600n) / 1800n);
  assert.equal(q.spotWethPerTokenE18, price(POOL_SQRT)); assert.equal(q.windowStart, POOL_NOW - 1801); assert.equal(q.windowEnd, POOL_NOW - 1);
  assert.equal(q.windowSeconds, 1800); assert.equal(q.lastSwapAt, POOL_NOW - 301); assert(q.permanentWethDepthWei > 100n * 10n ** 18n); assert(Object.isFrozen(q));
  assert(calls.every(call => call.blockNumber === 100000n));
  assert.deepEqual(calls.find(call => call.functionName === 'getPositionInfo').args.slice(2), [-887220, 887220, `0x${'0'.repeat(64)}`]);
});

test('same-block swaps have zero duration and the final event sets the following interval', async () => {
  const f = poolFixture(); f.logs.splice(2, 0, { ...f.logs[1], logIndex: 2, args: { ...f.logs[1].args, sqrtPriceX96: POOL_SQRT } }); f.logs[3].logIndex = 3;
  assert.equal((await run(f)).wethPerTokenE18, price(POOL_SQRT));
});

test('an anchor exactly at the window boundary and a fresh unchanged pool are valid', async () => {
  const f = poolFixture(); f.headers.get(81000n).timestamp = BigInt(POOL_NOW - 1801); const q = await run(f);
  assert.equal(q.windowEnd - q.windowStart, 1800);
  const g = poolFixture(); g.logs.length = 1;
  assert.equal((await run(g)).wethPerTokenE18, price(POOL_SQRT));
  const h = poolFixture(); h.logs.length = 1; h.headers.get(81000n).timestamp = BigInt(POOL_NOW - 3601);
  assert.equal((await run(h)).lastSwapAt, POOL_NOW - 3601);
});

test('canonical contract bytecode and pool identity changes fail closed', async () => {
  const f = poolFixture(); f.client.getCode = async () => '0x60006000'; await assert.rejects(run(f), /code changed/);
  for (const [key, value] of [['poolKey', [null]], ['poolManager', '0x'+'11'.repeat(20)], ['poolId', '0x'+'11'.repeat(32)], ['seedComplete', false], ['decimals', 6], ['symbol', 'FAKE']]) {
    const f = poolFixture(); f.values[key] = value; await assert.rejects(run(f), /identity/);
  }
});

test('zero, shallow, non-full-range or changed fee state cannot seed launches', async () => {
  for (const [key, value] of [['getPositionInfo', [0n, 0n, 0n]], ['getPositionInfo', [POOL_LIQUIDITY / 100n, 0n, 0n]], ['getLiquidity', 1n], ['getSlot0', [POOL_SQRT, -143337, 0, 3000]]]) {
    const f = poolFixture(); f.values[key] = value; await assert.rejects(run(f), /liquidity|state/);
  }
});

test('missing anchor, stale history, bounded-log saturation and insufficient chain history reject', async () => {
  const a = poolFixture(); a.logs.shift(); await assert.rejects(run(a), /anchor/);
  const b = poolFixture(); b.logs.length = 1; b.headers.get(81000n).timestamp = BigInt(POOL_NOW - 3602); await assert.rejects(run(b), /stale/);
  const c = poolFixture(); c.logs.length = 0; await assert.rejects(run(c), /history/);
  const d = poolFixture(); while (d.logs.length < 500) d.logs.push(d.logs[0]); await assert.rejects(run(d), /bounded/);
  const e = poolFixture(); e.headers.get(28000n).timestamp = BigInt(POOL_NOW - 1000); await assert.rejects(run(e), /full 30-minute/);
  const f = poolFixture(); f.block.number = 2000n; await assert.rejects(run(f), /history/);
});

test('removed, duplicate, out-of-order, malformed or changed-block logs reject', async () => {
  for (const mutate of [
    f => { f.logs[0].removed = true; }, f => { f.logs[0].args.id = '0x'+'11'.repeat(32); },
    f => { f.logs[0].address = '0x'+'11'.repeat(20); }, f => { f.logs[0].blockHash = poolHash(99n); },
    f => { f.logs[0].args.sqrtPriceX96 = 0n; }, f => { f.logs[0].args.liquidity = 0n; }, f => { f.logs[0].args.fee = 100; },
    f => { f.logs[0].transactionHash = null; }, f => { f.logs.reverse(); }, f => { f.logs.splice(1, 0, f.logs[0]); },
    f => { f.logs[0].logIndex = -1; }, f => { f.logs[0].blockHash = '0x'; },
    f => { f.headers.get(91000n).timestamp = BigInt(POOL_NOW + 1); },
    f => { f.headers.get(91000n).timestamp = undefined; }, f => { f.headers.get(91000n).hash = '0x'; },
  ]) { const f = poolFixture(); mutate(f); await assert.rejects(run(f), /history|block|timestamp/); }
});

test('latest state mismatch, a >20% spot deviation, and verification reorg reject', async () => {
  const f = poolFixture(); f.values.getSlot0 = [POOL_SQRT + 1n, -143337, 0, 0]; await assert.rejects(run(f), /current pool state/);
  const g = poolFixture(); const sqrt = POOL_SQRT * 2n; g.logs.at(-1).args.sqrtPriceX96 = sqrt; g.values.getSlot0 = [sqrt, -143337, 0, 0]; await assert.rejects(run(g), /more than 20%/);
  const h = poolFixture(); const read = h.client.getBlock; h.client.getBlock = async args => args.blockNumber === 100000n ? { ...h.block, hash: poolHash(99n) } : read(args); await assert.rejects(run(h), /verification block changed/);
});

test('RPC failure and cancellation do not fall back to spot or return a partial price', async () => {
  const f = poolFixture(); f.client.getLogs = async () => { throw new Error('RPC history unavailable'); }; await assert.rejects(run(f), /unavailable/);
  const c = new AbortController(); c.abort(new Error('Friend changed')); await assert.rejects(readRareFriendsPoolPrice(poolFixture().client, poolFixture().block, c.signal), /Friend changed/);
});
