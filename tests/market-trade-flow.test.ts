import assert from 'node:assert/strict';
import test from 'node:test';
import { runMarketTrade, type MarketTradeStage } from '../games/rare-pet/market-trade-flow.ts';
import type { MarketActor, MarketSwapQuote } from '../games/rare-pet/market-swap.ts';
import type { Address, Hex } from 'viem';

const NOW = 1_800_000_000_000;
const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const INPUT = '0x2222222222222222222222222222222222222222' as Address;
const OUTPUT = '0x3333333333333333333333333333333333333333' as Address;
const ROUTER = '0x4444444444444444444444444444444444444444' as Address;
const POOL = `0x${'a'.repeat(64)}` as Hex;
function quote(approval: MarketSwapQuote['approval'] = null): MarketSwapQuote {
  const input = { address: INPUT, symbol: 'PAY', decimals: 18 as const };
  return {
    actor: { kind: 'owner', account: OWNER }, account: OWNER,
    market: {
      asset: OUTPUT, name: 'Test Token', symbol: 'TOKEN', decimals: 18, imageUrl: null, router: ROUTER,
      creator: OWNER, mode: 'self', collection: null, tokenId: null,
      quote: { ...input, id: 'weth', chainId: 4663, kind: 'weth', name: 'Wrapped Ether', assetId: null,
        priceSource: 'chainlink', feedAddress: null, feedDescription: null, feedName: null, feedRegistry: null }, fee: 3000,
      poolKey: { currency0: INPUT, currency1: OUTPUT, fee: 3000, tickSpacing: 60, hooks: ROUTER },
      poolId: POOL, hash: POOL, timestamp: 1n, blockNumber: 1n,
    },
    side: 'buy', tokenIn: input, tokenOut: { address: OUTPUT, symbol: 'TOKEN', decimals: 18 }, route: null,
    amountIn: 1000n, amountOut: 100n, minimumAmountOut: 99n, slippageBps: 100,
    balance: 2000n, tokenAllowance: 2000n, routerAllowance: 2000n, routerAllowanceExpiresAt: NOW / 1000 + 1200,
    approval, quotedAt: NOW, expiresAt: NOW + 60_000, blockNumber: 1n,
  };
}
function flow(initial: MarketSwapQuote, refreshed: MarketSwapQuote[] = []) {
  const stages: MarketTradeStage[] = [], approvals: MarketSwapQuote[] = [], swaps: MarketSwapQuote[] = [];
  const receipt = { transactionHash: POOL }, state = { active: true, now: NOW };
  const options = {
    quote: initial, now: () => state.now,
    assertActive: () => { if (!state.active) throw new Error('Wallet changed'); },
    refreshQuote: async (_reviewed: MarketSwapQuote) => {
      const next = refreshed.shift(); if (!next) throw new Error('Unexpected refresh'); return next;
    },
    approve: async (reviewed: MarketSwapQuote) => { approvals.push(reviewed); },
    swap: async (reviewed: MarketSwapQuote) => { swaps.push(reviewed); return receipt; },
    onStage: (stage: MarketTradeStage) => { stages.push(stage); },
  };
  return { options, stages, approvals, swaps, receipt, state };
}

test('a ready trade swaps once and returns its verified receipt without an extra quote or approval', async () => {
  const f = flow(quote());
  assert.equal(await runMarketTrade(f.options), f.receipt);
  assert.deepEqual(f.stages, ['swap']); assert.equal(f.approvals.length, 0); assert.equal(f.swaps.length, 1);
});
test('one or both missing exact approvals continue automatically with a checked refresh between requests', async () => {
  for (const approvals of [['token'], ['router'], ['token', 'router']] as const) {
    const initial = quote(approvals[0]);
    const f = flow(initial, [...approvals.slice(1).map(value => quote(value)), quote()]);
    await runMarketTrade(f.options);
    assert.deepEqual(f.approvals.map(value => value.approval), approvals);
    assert.deepEqual(f.stages, [...approvals.flatMap(value => [`${value}-approval`, 'refresh']), 'swap']);
    assert.equal(f.swaps.length, 1);
    assert.equal(f.swaps[0].amountIn, initial.amountIn);
    assert.equal(f.swaps[0].minimumAmountOut, initial.minimumAmountOut);
  }
});
test('rejected or unverified approval stops immediately, without retry, refresh, or swap', async () => {
  for (const message of ['User rejected the request', 'Approval is still awaiting verification']) {
    const f = flow(quote('token'), [quote('router'), quote()]);
    f.options.approve = async reviewed => { f.approvals.push(reviewed); throw new Error(message); };
    await assert.rejects(runMarketTrade(f.options), new RegExp(message));
    assert.deepEqual(f.stages, ['token-approval']); assert.equal(f.approvals.length, 1); assert.equal(f.swaps.length, 0);
  }
});
test('a failed post-approval refresh never repeats the approval or sends the swap', async () => {
  const f = flow(quote('token'));
  f.options.refreshQuote = async () => { throw new Error('Read unavailable'); };
  await assert.rejects(runMarketTrade(f.options), /Read unavailable/);
  assert.deepEqual(f.stages, ['token-approval', 'refresh']); assert.equal(f.approvals.length, 1); assert.equal(f.swaps.length, 0);
});
test('an expired reviewed quote is renewed read-only while preserving its original trade', async () => {
  const f = flow({ ...quote(), expiresAt: NOW }, [quote()]);
  await runMarketTrade(f.options);
  assert.deepEqual(f.stages, ['refresh', 'swap']); assert.equal(f.approvals.length, 0); assert.equal(f.swaps.length, 1);
});
test('slow approvals renew expired quotes, but an already expired replacement cannot prompt again', async () => {
  const f = flow(quote('token'), [{ ...quote(), quotedAt: NOW + 70_000, expiresAt: NOW + 130_000 }]);
  f.options.approve = async reviewed => { f.approvals.push(reviewed); f.state.now += 70_000; };
  await runMarketTrade(f.options); assert.equal(f.swaps.length, 1);
  const stale = flow(quote('token'), [{ ...quote('router'), expiresAt: NOW }]);
  await assert.rejects(runMarketTrade(stale.options), /refreshed quote expired/);
  assert.equal(stale.approvals.length, 1); assert.equal(stale.swaps.length, 0);
});
test('unchanged or regressed allowance stages cannot create a repeated wallet prompt loop', async () => {
  for (const [start, next] of [['token', 'token'], ['router', 'router'], ['router', 'token']] as const) {
    const f = flow(quote(start), [quote(next)]);
    await assert.rejects(runMarketTrade(f.options), /approval did not advance/);
    assert.equal(f.approvals.length, 1); assert.equal(f.swaps.length, 0);
  }
  const f = flow(quote('token'), [quote('router'), quote('token')]);
  await assert.rejects(runMarketTrade(f.options), /approval did not advance/);
  assert.equal(f.approvals.length, 2); assert.equal(f.swaps.length, 0);
});
test('account changes during approval or quote refresh stop before the next stage or wallet request', async () => {
  const approval = flow(quote('token'), [quote('router')]);
  approval.options.approve = async reviewed => { approval.approvals.push(reviewed); approval.state.active = false; };
  await assert.rejects(runMarketTrade(approval.options), /Wallet changed/);
  assert.deepEqual(approval.stages, ['token-approval']); assert.equal(approval.swaps.length, 0);
  const refresh = flow(quote('token'));
  refresh.options.refreshQuote = async () => { refresh.state.active = false; return quote('router'); };
  await assert.rejects(runMarketTrade(refresh.options), /Wallet changed/);
  assert.deepEqual(refresh.stages, ['token-approval', 'refresh']); assert.equal(refresh.approvals.length, 1);
});
test('a stage callback that invalidates the session cannot be followed by a wallet request', async () => {
  for (const initial of [quote(), quote('token')]) {
    const f = flow(initial);
    f.options.onStage = stage => { f.stages.push(stage); f.state.active = false; };
    await assert.rejects(runMarketTrade(f.options), /Wallet changed/);
    assert.equal(f.approvals.length + f.swaps.length, 0);
  }
});
test('a stale session after the final receipt cannot publish the result into the new wallet UI', async () => {
  const f = flow(quote());
  f.options.swap = async reviewed => { f.swaps.push(reviewed); f.state.active = false; return f.receipt; };
  await assert.rejects(runMarketTrade(f.options), /Wallet changed/); assert.equal(f.swaps.length, 1);
});
test('refresh may never weaken the reviewed minimum or change account, pair, amount, direction, slippage, or pool', async () => {
  const next = quote();
  const changes: Partial<MarketSwapQuote>[] = [
    { minimumAmountOut: 98n }, { amountOut: 98n }, { account: INPUT }, { actor: { kind: 'owner', account: INPUT } },
    { tokenIn: { ...next.tokenIn, address: ROUTER } }, { tokenOut: { ...next.tokenOut, address: ROUTER } },
    { tokenOut: { ...next.tokenOut, decimals: 6 } }, { amountIn: 999n }, { side: 'sell' }, { slippageBps: 200 },
    { market: { ...next.market, poolId: `0x${'b'.repeat(64)}` as Hex } as MarketSwapQuote['market'] },
  ];
  for (const change of changes) {
    const f = flow(quote('token'), [{ ...next, ...change }]);
    await assert.rejects(runMarketTrade(f.options), /trade changed|reviewed minimum/);
    assert.equal(f.approvals.length, 1); assert.equal(f.swaps.length, 0);
  }
});
test('a stronger interim minimum remains protected at the next automatic refresh', async () => {
  const f = flow(quote('token'), [{ ...quote('router'), minimumAmountOut: 100n }, quote()]);
  await assert.rejects(runMarketTrade(f.options), /reviewed minimum/);
  assert.equal(f.approvals.length, 2); assert.equal(f.swaps.length, 0);
});
test('a refreshed route must keep every reviewed hop and pool identity', async () => {
  const route = { version: 3 as const, tokenIn: INPUT, tokenOut: OUTPUT,
    legs: [{ version: 3 as const, tokenIn: INPUT, tokenOut: OUTPUT, fee: 3000, poolAddress: ROUTER }] };
  const initial = { ...quote('token'), route };
  const changed = { ...quote(), route: { ...route, legs: [{ ...route.legs[0], fee: 10000 }] } };
  const f = flow(initial, [changed]);
  await assert.rejects(runMarketTrade(f.options), /trade changed/); assert.equal(f.swaps.length, 0);
});
test('Rare Wallet ownership, NFT identity, and receiving wallet stay bound to the reviewed trade', async () => {
  const actor: MarketActor = { kind: 'friend', pet: { chainId: 4663, collection: 'genesis', contract: ROUTER, tokenId: '2',
    owner: OWNER, walletAddress: INPUT, label: 'Genesis #2', image: '', blockNumber: '1', generation: null, rushEligible: true } };
  const initial = { ...quote('token'), actor, account: INPUT };
  for (const patch of [{ owner: OUTPUT }, { walletAddress: OUTPUT }, { tokenId: '3' }]) {
    const f = flow(initial, [{ ...quote(), actor: { ...actor, pet: { ...actor.pet, ...patch } }, account: INPUT }]);
    await assert.rejects(runMarketTrade(f.options), /trade changed/); assert.equal(f.swaps.length, 0);
  }
  const f = flow(initial, [{ ...quote(), actor, account: INPUT }]);
  await runMarketTrade(f.options); assert.equal(f.swaps[0].account, INPUT);
});
