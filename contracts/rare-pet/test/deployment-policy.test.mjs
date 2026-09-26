import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDeploymentConfig } from '../script/deployment-policy.mjs';
import { governanceRequest } from '../script/prepare-rule-change.mjs';
const base = JSON.parse(readFileSync(new URL('../deployment-config.example.json', import.meta.url), 'utf8'));
const rules = JSON.parse(readFileSync(new URL('../rules.example.json', import.meta.url), 'utf8'));
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
