import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { validateDeploymentConfig, QUOTES } from '../script/prepare-deployment.mjs';
import { readDeploymentCatalog, validateQuoteCatalog, rehearsalMatches } from '../script/deployment-policy.mjs';

const config = { chainId: 4663, deployer: '0x0000000000000000000000000000000000000001', treasury: '0x0000000000000000000000000000000000000002', friendFeeBps: 8500, totalSupply: '1000000000000000000000000000' };
test('requires an explicit fee policy, treasury and deployer before any RPC read', () => {
  assert.equal(validateDeploymentConfig(config).friendFeeBps, 8500);
  for (const override of [{ friendFeeBps: null }, { friendFeeBps: 8550 }, { friendFeeBps: 9000 }, { friendFeeBps: 9500 }, { treasury: null }, { deployer: null }, { chainId: 1 }, { totalSupply: '1' }]) assert.throws(() => validateDeploymentConfig({ ...config, ...override }));
  assert.throws(() => validateDeploymentConfig({ ...config, privateKey: 'never accepted' }), /public configuration fields/);
});
test('deployment derives every issuer token including QNT from the same catalog as the app', () => {
  const { catalog } = readDeploymentCatalog();
  assert.equal(QUOTES.length, 196);
  assert.equal(QUOTES.length, catalog.coverage.activeStocks + 1);
  assert.equal(QUOTES[0].symbol, 'WETH');
  assert(QUOTES.some(quote => quote.symbol === 'QNT'));
  assert.deepEqual(QUOTES.map(q=>q.address.toLowerCase()), catalog.assets.map(q=>q.address.toLowerCase()));
  assert.equal(new Set(QUOTES.map(quote => quote.address)).size, QUOTES.length);
});
test('catalog rejects missing coverage, duplicate identities, noncanonical WETH and wrong chains', () => {
  const { catalog } = readDeploymentCatalog();
  for (const change of [c=>c.assets.pop(), c=>c.assets.push(c.assets[1]), c=>c.assets[0].address=c.assets[1].address, c=>c.assets[1].chainId=1, c=>c.assets[1].decimals=6, c=>c.coverage.activeStocks--]) {
    const altered = structuredClone(catalog); change(altered); assert.throws(()=>validateQuoteCatalog(altered));
  }
});
test('a rehearsal must bind exact constructor data, catalog bytes, count and deployer, not merely bytecode', () => {
  const review = { config, quotes: QUOTES, creationBytecodeHash: keccak256('0x6000'), deploymentDataHash: keccak256('0x60001234'), catalogHash: readDeploymentCatalog().catalogHash, unsignedTransaction: { data: '0x60001234' } };
  const proof = { status: 'READ-ONLY eth_call PASSED — no contracts deployed or transactions sent', creationBytecodeHash: review.creationBytecodeHash, deploymentDataHash: review.deploymentDataHash, catalogHash: review.catalogHash, quoteCount: QUOTES.length, deployer: config.deployer };
  assert(rehearsalMatches(proof, review));
  for (const patch of [{ deploymentDataHash: keccak256('0x60005678') }, { deploymentDataHash: undefined }, { catalogHash: 'old-catalog' }, { quoteCount: 5 }, { deployer: config.treasury }]) assert(!rehearsalMatches({...proof, ...patch}, review));
  assert(!rehearsalMatches(proof, {...review, unsignedTransaction: {data:'0x60005678'}}));
});
