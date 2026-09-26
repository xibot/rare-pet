import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentConfig, QUOTES } from '../script/prepare-deployment.mjs';

const config = { chainId: 4663, deployer: '0x0000000000000000000000000000000000000001', treasury: '0x0000000000000000000000000000000000000002', friendFeeBps: 8500, totalSupply: '1000000000000000000000000000' };
test('requires an explicit fee policy, treasury and deployer before any RPC read', () => {
  assert.equal(validateDeploymentConfig(config).friendFeeBps, 8500);
  assert.equal(validateDeploymentConfig({ ...config, friendFeeBps: 8500 }).friendFeeBps, 8500);
  for (const override of [{ friendFeeBps: null }, { friendFeeBps: 8550 }, { friendFeeBps: 9000 }, { friendFeeBps: 9500 }, { treasury: null }, { deployer: null }, { chainId: 1 }, { totalSupply: '1' }]) assert.throws(() => validateDeploymentConfig({ ...config, ...override }));
  assert.throws(() => validateDeploymentConfig({ ...config, privateKey: 'never accepted' }), /public configuration fields/);
});
test('initial deployment includes canonical WETH and four individually identified stock tokens', () => {
  assert.deepEqual(QUOTES.map(quote => quote.symbol), ['WETH', 'NVDA', 'AAPL', 'TSLA', 'SPY']);
  assert.equal(new Set(QUOTES.map(quote => quote.address)).size, 5);
});
