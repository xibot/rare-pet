import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDeploymentConfig, validateInitialRules, assertReviewNonce, careRulesMatch } from '../script/deployment-policy.mjs';
import { decodeFunctionResult, encodeFunctionResult } from 'viem';
import { governanceRequest } from '../script/prepare-rule-change.mjs';
const base = JSON.parse(readFileSync(new URL('../deployment-config.example.json', import.meta.url), 'utf8'));
const rules = JSON.parse(readFileSync(new URL('../rules.example.json', import.meta.url), 'utf8'));
const abi = JSON.parse(readFileSync(new URL('../RarePetCare.abi.json', import.meta.url), 'utf8'));
test('deployment rejects wrong chain, absent/zero authority and premature live signer', () => {
  assert.equal(validateDeploymentConfig(base).chainId, 4663);
  for (const input of [{ ...base, chainId: 1 }, { ...base, admin: base.playSigner }, { ...base, deployer: base.playSigner }, { ...base, playSigner: base.admin }, { ...base, privateKey: 'never' }]) assert.throws(() => validateDeploymentConfig(input));
});
test('governance schedules a complete policy and never exposes a points-history write', () => {
  assert.equal(governanceRequest('schedule', rules).functionName, 'scheduleRules');
  assert.throws(() => governanceRequest('schedule', { actions: rules.actions }));
  assert.throws(() => governanceRequest('schedule', { ...rules, resetTotals: true }));
  assert.throws(() => governanceRequest('schedule', { ...rules, actions: rules.actions.slice(0, 3) }));
  assert.throws(() => governanceRequest('setPoints', {}));
  assert.throws(() => governanceRequest('toString'));
  assert.throws(() => governanceRequest('constructor'));
  for (const petRule of [{ ...rules.actions[0], cooldown: 3600 }, { ...rules.actions[0], dailyLimit: 2 }]) {
    assert.throws(() => governanceRequest('schedule', { ...rules, actions: [petRule, ...rules.actions.slice(1)] }));
  }
});
test('admin handoff is separate nomination/acceptance and cancel/execute take no arbitrary payload', () => {
  assert.equal(governanceRequest('nominate-admin', base.admin).functionName, 'scheduleAdmin');
  assert.equal(governanceRequest('accept-admin').functionName, 'acceptAdmin');
  assert.throws(() => governanceRequest('nominate-admin', base.playSigner));
  assert.throws(() => governanceRequest('execute', rules));
});
test('rule verification accepts decoded tuples and equivalent numeric representations but rejects changed policy', () => {
  assert.equal(validateInitialRules(abi, rules), rules);
  const decoded = decodeFunctionResult({ abi, functionName: 'currentRules', data: encodeFunctionResult({ abi, functionName: 'currentRules', result: rules }) });
  assert.equal(careRulesMatch(abi, decoded, rules), true);
  const equivalent = {
    ...Object.fromEntries(Object.entries(rules).reverse()),
    petGrace: 86400n,
    actions: rules.actions.map(action => ({ ...Object.fromEntries(Object.entries(action).reverse()), points: BigInt(action.points) })),
  };
  assert.equal(careRulesMatch(abi, decoded, equivalent), true);
  for (const changed of [
    { ...rules, petGrace: 86401 },
    { ...rules, playSigner: base.admin },
    { ...rules, actions: [{ ...rules.actions[0], cooldown: 3600 }, ...rules.actions.slice(1)] },
    { ...rules, actions: [{ ...rules.actions[0], enabled: false }, ...rules.actions.slice(1)] },
    { ...rules, actions: rules.actions.slice(1) },
    { ...rules, rarityPoints: undefined },
  ]) {
    assert.equal(careRulesMatch(abi, decoded, changed), false);
    assert.throws(() => validateInitialRules(abi, changed));
  }
});
test('deployment review refuses a mined or pending transaction consuming the predicted nonce', () => {
  assert.doesNotThrow(() => assertReviewNonce(2, 2, 2));
  assert.throws(() => assertReviewNonce(2, 2, 3));
  assert.throws(() => assertReviewNonce(2, 3, 3));
  assert.throws(() => assertReviewNonce(2, 1, 2));
  assert.throws(() => assertReviewNonce(-1, -1, -1));
  assert.throws(() => assertReviewNonce(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1));
});
