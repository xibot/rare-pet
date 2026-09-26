import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, zeroAddress } from 'viem';
import { DEFAULT_CARE_RULES, CARE_ACTIONS } from '../games/rare-pet/care-policy.ts';

// Exercise the actual reader with a transport fixture; no wallet or live RPC is used.
const contract = '0x1111111111111111111111111111111111111111';
const collection = '0x116EaA62241751E0c98dA43d458600c6C17cD361';
const owner = '0x2222222222222222222222222222222222222222';
const hash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
const output = await build({ entryPoints: [fileURLToPath(new URL('../games/rare-pet/chain.ts', import.meta.url))], bundle: true,
  write: false, platform: 'node', format: 'esm', define: { __RAREPET_CONTRACT__: JSON.stringify(contract) }, logLevel: 'silent' });
const chain = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

function fixture({ reorg = false, wrongPolicy = false } = {}) {
  const calls: any[] = [];
  const original = globalThis.fetch;
  let blocks = 0;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init!.body)); calls.push(request);
    let result: unknown;
    if (request.method === 'eth_getBlockByNumber') result = { number: '0x64', timestamp: '0x3e8', hash: reorg && blocks++ ? hash : blockHash };
    else if (request.method === 'eth_getCode') result = '0x6000';
    else if (request.method === 'eth_call') {
      const decoded = decodeFunctionData({ abi: chain.careAbi, data: request.params[0].data });
      const results: Record<string, unknown> = {
        CHAIN_ID: 4663n, currentRuleVersion: 2n,
        rules: { ...DEFAULT_CARE_RULES, actions: CARE_ACTIONS.map(action => ({ ...DEFAULT_CARE_RULES.actions[action], dailyLimit: wrongPolicy ? 33 : DEFAULT_CARE_RULES.actions[action].dailyLimit })) },
        getPet: { kinship: 1n, strength: 0n, stamina: 0n, health: 0n, experience: 0n, brain: 0n, streak: 1n, rarity: 0n,
          lastPetAt: 900n, lastFeedAt: 0n, lastPoopAt: 0n, lastLaunchAt: 0n, playTimes: [], playCount: 0n, decayApplied: 0n,
          hasPet: true, hasFed: false, hasPooped: false, hasLaunched: false },
        getLifetime: { kinship: 1n, strength: 0n, stamina: 0n, health: 0n, experience: 0n, rarity: 0n, bestStreak: 1n, actionCounts: [1n, 0n, 0n, 0n] },
        actionCount: 1n,
        getPetSchedule: { nextAvailableAt: 87300n, graceDeadline: 173700n, decayInterval: 86400n, decayPoints: 1n, nextRarityAt: 7n, nextRarityPoints: 1n },
        actionRecord: { action: 0, timestamp: 900n, owner, ruleVersion: 1n, points: 1n, secondaryPoints: 0n, rarityPoints: 0n },
      };
      if (decoded.functionName === 'actionAvailability') {
        const action = Number(decoded.args![2]);
        result = encodeFunctionResult({ abi: chain.careAbi, functionName: decoded.functionName,
          result: action === 0 ? [0n, 87300n, true] : action === 2 ? [0n, 1000n, false] : [6n, 1000n, true] });
      } else result = encodeFunctionResult({ abi: chain.careAbi, functionName: decoded.functionName, result: results[decoded.functionName] });
    } else throw new Error(`Unexpected RPC method ${request.method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

test('live reader pins rules, traits, availability, lifetime and history to one canonical block', async () => {
  const f = fixture();
  try {
    const state = await chain.readCare({ contract: collection, tokenId: '1', owner });
    assert.equal(state.policy.version, 2);
    assert.equal(state.policy.blockNumber, '100');
    assert.equal(state.policy.petSchedule.graceDeadline, 173700);
    assert.equal(state.policy.availability.pet.readyAt, 87300);
    assert.equal(state.lastFeedAt, -1);
    assert.equal(state.lifetime.kinship, 1);
    assert.equal(state.history[0].ruleVersion, 1, 'old records keep the original rule version');
    const reads = f.calls.filter(call => call.method === 'eth_call' || call.method === 'eth_getCode');
    assert.equal(reads.length, 13);
    for (const call of reads) assert.equal(call.params[1], '0x64');
    assert.deepEqual(f.calls.filter(call => call.method === 'eth_getBlockByNumber').map(call => call.params[0]), ['latest', '0x64']);
  } finally { f.restore(); }
});

test('reader rejects incompatible policy and reorg snapshots without granting default traits', async () => {
  for (const options of [{ wrongPolicy: true }, { reorg: true }]) {
    const f = fixture(options);
    try { await assert.rejects(() => chain.readCare({ contract: collection, tokenId: '1', owner })); }
    finally { f.restore(); }
  }
});

test('care receipts still require the exact hash, success, contract, current owner and action', () => {
  const pet = { contract: collection, tokenId: '1', owner };
  const topics = encodeEventTopics({ abi: chain.careAbi, eventName: 'CaredFor', args: { collection, tokenId: 1n, owner } });
  const receipt = { transactionHash: hash, status: 'success', logs: [{ address: contract, topics,
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [0, 1000n]) }] };
  assert.doesNotThrow(() => chain.verifyCareReceipt(receipt, hash, contract, pet, 'pet'));
  assert.throws(() => chain.verifyCareReceipt({ ...receipt, transactionHash: blockHash }, hash, contract, pet, 'pet'), /replaced/);
  assert.throws(() => chain.verifyCareReceipt({ ...receipt, status: 'reverted' }, hash, contract, pet, 'pet'), /reverted/);
  assert.throws(() => chain.verifyCareReceipt(receipt, hash, zeroAddress, pet, 'pet'), /could not be verified/);
  assert.throws(() => chain.verifyCareReceipt(receipt, hash, contract, { ...pet, owner: zeroAddress }, 'pet'), /could not be verified/);
  assert.throws(() => chain.verifyCareReceipt(receipt, hash, contract, pet, 'feed'), /could not be verified/);
});
