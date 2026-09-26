import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getContractAddress, keccak256 } from 'viem';
import { validateDeploymentConfig, QUOTES } from '../script/prepare-deployment.mjs';
import { readDeploymentCatalog, validateQuoteCatalog, rehearsalMatches, reviewedDeploymentAddress, validatePreviousManifest, RAREFRIENDS_QUOTE } from '../script/deployment-policy.mjs';

const config = { chainId: 4663, deployer: '0x0000000000000000000000000000000000000001', treasury: '0x0000000000000000000000000000000000000002', friendFeeBps: 8500, totalSupply: '1000000000000000000000000000' };
test('requires an explicit fee policy, treasury and deployer before any RPC read', () => {
  assert.equal(validateDeploymentConfig(config).friendFeeBps, 8500);
  for (const override of [{ friendFeeBps: null }, { friendFeeBps: 8550 }, { friendFeeBps: 9000 }, { friendFeeBps: 9500 }, { treasury: null }, { deployer: null }, { chainId: 1 }, { totalSupply: '1' }]) assert.throws(() => validateDeploymentConfig({ ...config, ...override }));
  assert.throws(() => validateDeploymentConfig({ ...config, privateKey: 'never accepted' }), /public configuration fields/);
});
test('deployment derives every issuer token including QNT from the same catalog as the app', () => {
  const { catalog } = readDeploymentCatalog();
  assert.equal(QUOTES.length, 197);
  assert.equal(QUOTES.length, catalog.coverage.activeStocks + 2);
  assert.equal(QUOTES[0].symbol, 'WETH');
  assert.equal(QUOTES[1].symbol, 'RAREFRIENDS');
  assert.equal(QUOTES[1].address, RAREFRIENDS_QUOTE);
  assert(QUOTES.some(quote => quote.symbol === 'QNT'));
  assert.deepEqual(QUOTES.map(q=>q.address.toLowerCase()), catalog.assets.map(q=>q.address.toLowerCase()));
  assert.equal(new Set(QUOTES.map(quote => quote.address)).size, QUOTES.length);
});
test('catalog rejects missing coverage, duplicate identities, noncanonical quote identities and wrong chains', () => {
  const { catalog } = readDeploymentCatalog();
  for (const change of [c=>c.assets.pop(), c=>c.assets.push(c.assets[1]), c=>c.assets[0].address=c.assets[1].address, c=>c.assets[1].chainId=1, c=>c.assets[1].decimals=6, c=>c.coverage.activeStocks--,
    c=>c.assets[1].address=c.assets[2].address, c=>c.assets[1].symbol='FAKE', c=>c.assets[1].id='fake', c=>c.assets[1].kind='stock', c=>c.assets.splice(1,1), c=>[c.assets[1],c.assets[2]]=[c.assets[2],c.assets[1]]]) {
    const altered = structuredClone(catalog); change(altered); assert.throws(()=>validateQuoteCatalog(altered));
  }
});
test('a rehearsal must bind exact constructor data, catalog bytes, count and deployer, not merely bytecode', () => {
  const prospectiveRouter = getContractAddress({from: config.deployer, nonce: 1n});
  const review = { config, quotes: QUOTES, creationBytecodeHash: keccak256('0x6000'), deploymentDataHash: keccak256('0x60001234'), catalogHash: readDeploymentCatalog().catalogHash, unsignedTransaction: { data: '0x60001234', nonce: '0x1' }, deploymentAddressRead: { prospectiveRouter, deployerNonce: 1 } };
  const proof = { status: 'READ-ONLY eth_call PASSED — no contracts deployed or transactions sent', creationBytecodeHash: review.creationBytecodeHash, deploymentDataHash: review.deploymentDataHash, catalogHash: review.catalogHash, quoteCount: QUOTES.length, deployer: config.deployer,
    prospectiveRouter, deployerNonceAtRead: 1, rarefriends: { quote: RAREFRIENDS_QUOTE, friendAsset: config.deployer, selfAsset: config.treasury } };
  assert(rehearsalMatches(proof, review));
  for (const patch of [{ deploymentDataHash: keccak256('0x60005678') }, { deploymentDataHash: undefined }, { catalogHash: 'old-catalog' }, { quoteCount: 5 }, { deployer: config.treasury }, { deployerNonceAtRead: 0 }, { prospectiveRouter: config.deployer }, { rarefriends: undefined }, { rarefriends: {...proof.rarefriends, quote: config.treasury} }, { rarefriends: {...proof.rarefriends, friendAsset: '0x0000000000000000000000000000000000000000'} }]) assert(!rehearsalMatches({...proof, ...patch}, review));
  assert(!rehearsalMatches(proof, {...review, unsignedTransaction: {data:'0x60005678'}}));
});
test('replacement verification binds the exact reviewed nonce and CREATE address', () => {
  const prospectiveRouter = getContractAddress({from: config.deployer, nonce: 3n});
  const review = {config, deploymentAddressRead: {prospectiveRouter, deployerNonce: 3}, unsignedTransaction: {nonce:'0x3'}};
  assert.equal(reviewedDeploymentAddress(review), prospectiveRouter);
  for (const changed of [{...review, deploymentAddressRead:{...review.deploymentAddressRead,deployerNonce:0}}, {...review, unsignedTransaction:{nonce:'0x4'}}, {...review, deploymentAddressRead:{...review.deploymentAddressRead,prospectiveRouter:config.deployer}}, {...review, deploymentAddressRead:{...review.deploymentAddressRead,deployerNonce:-1}}]) assert.throws(()=>reviewedDeploymentAddress(changed));
});
test('replacement accepts only the preserved known predecessor manifest and source', () => {
  const manifest = JSON.parse(readFileSync(new URL('../deployments/4663.json', import.meta.url), 'utf8'));
  const expected = {sourceHash:manifest.source.sourceHash, creationBytecodeHash:manifest.integrity.creationBytecodeHash, treasury:manifest.configuration.treasury, totalSupply:manifest.configuration.totalSupply};
  assert.equal(validatePreviousManifest(manifest, expected), manifest);
  for (const change of [m=>m.address=config.deployer,m=>m.chainId=1,m=>m.integrity.runtimeCodeHash=keccak256('0x6000'),m=>m.configuration.quotes.pop(),m=>m.configuration.feePercent.creator=90,m=>m.transactionHash=keccak256('0x6000')]) {
    const copy=structuredClone(manifest);change(copy);assert.throws(()=>validatePreviousManifest(copy,expected));
  }
  assert.throws(()=>validatePreviousManifest(manifest,{...expected,sourceHash:keccak256('0x6000')}));
});
