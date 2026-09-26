import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { encodeAbiParameters, getContractAddress, keccak256, toHex, zeroAddress } from 'viem';

// Run the actual browser controller with entirely local RPC, wallet and storage fakes.
// Deterministic EVM bytes keep these controller tests independent of deployment nonce
// snapshots and ignored compiler output. The deployment preparation separately checks
// the real compiled artifact. No browser, signing key or network request is used here.
const output = await build({ entryPoints: [fileURLToPath(new URL('../tools/care-deploy/deployment.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
const { CareDeployment, validateReview } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const initialRules = JSON.parse(await readFile(new URL('../contracts/rare-pet/rules.example.json', import.meta.url), 'utf8'));
const hash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
const otherHash = `0x${'ef'.repeat(32)}`;
const otherAddress = '0x1111111111111111111111111111111111111111';
const collectionCode = ['0x60016000', '0x60026000'];
const deployer = '0xCa88efc94b567A5185FEA63599aD895c3e514FBc';
const runtime = '0x6001600055';
const data = `0x6005600c60003960056000f36001600055${encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [deployer, zeroAddress]).slice(2)}`;
const reviewTemplate = {
  status: 'UNSIGNED — no transaction sent', contract: 'RarePetCare',
  config: { chainId: 4663, admin: deployer, deployer, playSigner: zeroAddress },
  sourceHash: keccak256('0x6000'), deploymentDataHash: keccak256(data), expectedRuntime: runtime,
  expectedRuntimeCodeHash: keccak256(runtime), prospectiveAddress: getContractAddress({ from: deployer, nonce: 3n }), deployerNonce: 3,
  collections: [{ address: '0x116EaA62241751E0c98dA43d458600c6C17cD361', codeHash: keccak256(collectionCode[0]) },
    { address: '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D', codeHash: keccak256(collectionCode[1]) }],
  unsignedTransaction: { chainId: 4663, from: deployer, data, value: '0x0', nonce: '0x3', gas: '0x400000' },
};

function fixture() {
  const review = structuredClone({ ...reviewTemplate, initialRules });
  review.collections.forEach((collection, index) => { collection.codeHash = keccak256(collectionCode[index]); });
  const log: { method: string; args?: any }[] = [];
  const updates: any[] = [];
  const saved = new Map<string, string>();
  const storage = {
    getItem(key: string) { return saved.get(key) ?? null; },
    setItem(key: string, value: string) { saved.set(key, value); },
    removeItem(key: string) { saved.delete(key); },
  };
  const block = { number: 100n, hash: blockHash };
  const tx = { hash, from: review.config.deployer, to: null, input: review.unsignedTransaction.data,
    value: 0n, nonce: review.deployerNonce, chainId: 4663, blockHash, blockNumber: 100n };
  const receipt = { transactionHash: hash, blockHash, blockNumber: 100n, status: 'success', contractAddress: review.prospectiveAddress };
  const fields: Record<string, any> = {
    admin: review.config.admin, currentRuleVersion: 1n, RULE_DELAY: 86400n, CHAIN_ID: 4663n,
    GENESIS: review.collections[0].address, GENERATIONS: review.collections[1].address,
    currentRules: structuredClone(initialRules),
  };
  const options = {
    account: review.config.deployer, walletChain: '0x1237', rpcChain: 4663,
    latestNonce: review.deployerNonce, pendingNonce: review.deployerNonce, occupied: false,
    collectionCode: [...collectionCode], simulation: review.expectedRuntime, runtime: review.expectedRuntime,
    balance: 10n ** 18n, gas: 3_219_383n, gasPrice: 20_000_000n,
    sendError: null as unknown, sendHash: hash, waitError: null as unknown,
    freshReview: review, reorg: false,
  };
  const call = (method: string, args?: any) => log.push({ method, args });
  const client = {
    async getChainId() { call('getChainId'); return options.rpcChain; },
    async getBlock(args?: any) { call('getBlock', args); return { ...block, hash: args?.blockNumber && options.reorg ? otherHash : block.hash }; },
    async getTransactionCount(args: any) { call('getTransactionCount', args); return args.blockTag === 'pending' ? options.pendingNonce : options.latestNonce; },
    async getCode(args: any) {
      call('getCode', args);
      const index = review.collections.findIndex(collection => collection.address === args.address);
      return index >= 0 ? options.collectionCode[index] : options.occupied ? options.runtime : '0x';
    },
    async call(args: any) { call('call', args); return { data: options.simulation }; },
    async estimateGas(args: any) { call('estimateGas', args); return options.gas; },
    async getGasPrice() { call('getGasPrice'); return options.gasPrice; },
    async getBalance(args: any) { call('getBalance', args); return options.balance; },
    async getTransaction(args: any) { call('getTransaction', args); return { ...tx }; },
    async waitForTransactionReceipt(args: any) { call('waitForTransactionReceipt', args); if (options.waitError) throw options.waitError; return { ...receipt }; },
    async readContract(args: any) { call('readContract', args); return fields[args.functionName]; },
  };
  const provider = {
    async request(args: any) {
      call(`wallet:${args.method}`, args.params);
      if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') return [options.account];
      if (args.method === 'eth_chainId') return options.walletChain;
      if (args.method === 'wallet_switchEthereumChain') return null;
      if (args.method === 'eth_sendTransaction') {
        if (options.sendError) throw options.sendError;
        options.occupied = true;
        return options.sendHash;
      }
      throw new Error(`Unexpected wallet method: ${args.method}`);
    },
  };
  let freshCalls = 0;
  const deps = { review, client, storage, async freshReview() { freshCalls++; return options.freshReview; }, changed(state: any) { updates.push(state); } };
  const controller = new CareDeployment(deps);
  return { controller, deps, review, client, provider, options, fields, tx, receipt, storage, saved, log, updates,
    get freshCalls() { return freshCalls; }, get sends() { return log.filter(entry => entry.method === 'wallet:eth_sendTransaction'); },
    async connect() { await controller.connect(provider); },
    makePending() { saved.set(controller.storageKey, JSON.stringify({ status: 'pending', hash, dataHash: review.deploymentDataHash })); options.occupied = true; },
  };
}

test('opening a review never requests accounts, performs RPC or signs automatically', () => {
  const f = fixture();
  assert.deepEqual(f.log, []);
  assert.equal(f.freshCalls, 0);
  assert.equal(f.controller.state.confirmed, false);
  assert.equal(f.controller.state.awaiting, false);
  assert.equal(f.saved.size, 0);
});

test('review validation rejects inconsistent payload, runtime, nonce, address and locked rules', () => {
  const f = fixture();
  assert.doesNotThrow(() => validateReview(f.review));
  for (const change of [
    r => { r.unsignedTransaction.data = '0x6000'; },
    r => { r.expectedRuntime = '0x6000'; },
    r => { r.unsignedTransaction.nonce = '0x77'; },
    r => { r.prospectiveAddress = otherAddress; },
    r => { r.initialRules.actions[0].cooldown = 1; },
    r => { r.initialRules.actions[0].dailyLimit = 2; },
    r => { r.initialRules.playSigner = otherAddress; },
    r => { r.unsignedTransaction.value = '0x1'; },
  ]) {
    const review = structuredClone(f.review); change(review);
    assert.throws(() => validateReview(review));
  }
});

for (const [label, change, error] of [
  ['wrong account', f => { f.options.account = otherAddress; }, /Select/],
  ['wrong wallet chain after switching', f => { f.options.walletChain = '0x1'; }, /Robinhood Chain/],
] as const) test(`connection rejects ${label}`, async () => {
  const f = fixture(); change(f); await f.connect();
  assert.match(f.controller.state.status, error);
  assert.equal(f.sends.length, 0);
});

for (const [label, change, error] of [
  ['RPC chain mismatch', f => { f.options.rpcChain = 1; }, /RPC chain mismatch/],
  ['consumed latest nonce', f => { f.options.latestNonce++; }, /nonce changed/],
  ['another pending transaction', f => { f.options.pendingNonce++; }, /nonce changed/],
  ['occupied deployment address', f => { f.options.occupied = true; }, /already has code/],
  ['changed canonical collection bytecode', f => { f.options.collectionCode[0] = '0x6003'; }, /collection changed/],
  ['missing canonical collection', f => { f.options.collectionCode[1] = '0x'; }, /collection changed/],
  ['reorganized pinned block', f => { f.options.reorg = true; }, /block changed/],
  ['unexpected constructor runtime', f => { f.options.simulation = '0x6000'; }, /unexpected runtime/],
  ['changed local review', f => { f.options.freshReview = { ...f.review, createdAt: 'changed' }; }, /local review changed/],
] as const) test(`fee/deployment preflight blocks ${label}`, async () => {
  const f = fixture(); await f.connect(); change(f); await f.controller.deploy(true);
  assert.match(f.controller.state.status, error);
  assert.equal(f.sends.length, 0);
  assert.equal(f.saved.size, 0);
  assert.equal(f.controller.state.confirmed, false);
});

test('deployment requires the user review checkbox and checks the signer again', async () => {
  const f = fixture(); await f.connect(); await f.controller.deploy(false);
  assert.match(f.controller.state.status, /Review the deployment/);
  f.options.account = otherAddress; await f.controller.deploy(true);
  assert.match(f.controller.state.status, /reviewed deployer/);
  assert.equal(f.sends.length, 0);
});

for (const [label, change, error] of [
  ['nonce consumed', f => { f.options.latestNonce++; }, /nonce changed/],
  ['wallet account changed', f => { f.options.account = otherAddress; }, /reviewed deployer/],
  ['local review replaced', f => { f.options.freshReview = { ...f.review, createdAt: 'changed' }; }, /local review changed/],
] as const) test(`checks again when ${label} during the gas estimate`, async () => {
  const f = fixture(); await f.connect();
  const getBalance = f.client.getBalance;
  f.client.getBalance = async args => { const balance = await getBalance(args); change(f); return balance; };
  await f.controller.deploy(true);
  assert.match(f.controller.state.status, error);
  assert.equal(f.sends.length, 0);
  assert.equal(f.saved.size, 0);
});

test('fee check is read-only and funding includes the rounded 20% gas buffer', async () => {
  const f = fixture(); await f.connect();
  const bufferedGas = (f.options.gas * 120n + 99n) / 100n;
  f.options.balance = bufferedGas * f.options.gasPrice - 1n;
  await f.controller.checkFee();
  assert.equal(f.controller.state.gas, f.options.gas);
  assert.equal(f.controller.state.funded, false);
  assert.match(f.controller.state.estimate, /Add ETH/);
  await f.controller.deploy(true);
  assert.match(f.controller.state.status, /needs ETH/);
  assert.equal(f.sends.length, 0);
  f.options.balance++;
  await f.controller.checkFee();
  assert.equal(f.controller.state.funded, true);
  assert.equal(f.saved.size, 0);
});

test('explicit deployment sends exactly reviewed creation data and confirms canonical runtime/defaults', async () => {
  const f = fixture(); await f.connect();
  let markerAtSend: any;
  const request = f.provider.request;
  f.provider.request = async args => {
    if (args.method === 'eth_sendTransaction') markerAtSend = JSON.parse(f.saved.get(f.controller.storageKey)!);
    return request(args);
  };
  await f.controller.deploy(true);
  assert.deepEqual(markerAtSend, { status: 'awaiting-wallet', dataHash: f.review.deploymentDataHash });
  assert.deepEqual(f.sends[0].args, [{ from: f.review.config.deployer, chainId: '0x1237', data: f.review.unsignedTransaction.data,
    value: '0x0', nonce: toHex(f.review.deployerNonce), gas: toHex((f.options.gas * 120n + 99n) / 100n) }]);
  assert.equal(f.sends.length, 1);
  assert.equal(f.controller.state.confirmed, true);
  assert.equal(f.controller.state.hash, hash);
  assert.equal(f.controller.state.awaiting, false);
  assert.match(f.controller.state.status, /runtime, admin and initial rules verified/);
  assert.deepEqual(JSON.parse(f.saved.get(f.controller.storageKey)!), { status: 'pending', hash, dataHash: f.review.deploymentDataHash });
  assert.deepEqual(f.log.find(entry => entry.method === 'waitForTransactionReceipt')?.args, { hash, timeout: 120000, confirmations: 2 });
  for (const entry of f.log.filter(entry => entry.method === 'readContract')) assert.equal(entry.args.blockNumber, 100n);
  assert.ok(f.updates.some(state => state.awaiting && state.busy), 'wallet-pending state is published before signing');
});

test('double click and saved pending transaction cannot send another deployment', async () => {
  const f = fixture(); await f.connect();
  await Promise.all([f.controller.deploy(true), f.controller.deploy(true)]);
  assert.equal(f.sends.length, 1);
  const restored = new CareDeployment(f.deps);
  assert.equal(restored.state.hash, hash);
  await restored.connect(f.provider); await restored.deploy(true);
  assert.equal(f.sends.length, 1);
  await restored.recheck();
  assert.equal(restored.state.confirmed, true);
});

test('another tab saved a request after construction: deployment stops before wallet send', async () => {
  const f = fixture(); await f.connect();
  f.saved.set(f.controller.storageKey, JSON.stringify({ status: 'awaiting-wallet', dataHash: f.review.deploymentDataHash }));
  await f.controller.deploy(true);
  assert.equal(f.sends.length, 0);
  assert.equal(f.controller.state.awaiting, true);
});

test('only explicit EIP-1193 rejection clears the pre-send marker', async () => {
  const f = fixture(); await f.connect();
  f.options.sendError = Object.assign(new Error('User declined'), { code: 4001 });
  await f.controller.deploy(true);
  assert.equal(f.controller.state.awaiting, false);
  assert.equal(f.saved.size, 0);
  assert.equal(f.controller.state.hash, null);
  assert.match(f.controller.state.status, /User declined/);
});

for (const invalidHash of [false, true]) test(`unknown send outcome (${invalidHash ? 'malformed hash' : 'provider error'}) blocks resubmission and survives reload`, async () => {
  const f = fixture(); await f.connect();
  if (invalidHash) f.options.sendHash = '0xnot-a-hash';
  else f.options.sendError = new Error('Provider disconnected during send');
  await f.controller.deploy(true);
  assert.equal(f.controller.state.awaiting, true);
  assert.equal(JSON.parse(f.saved.get(f.controller.storageKey)!).status, 'awaiting-wallet');
  const restored = new CareDeployment(f.deps);
  assert.equal(restored.state.awaiting, true);
  await restored.deploy(true);
  assert.equal(f.sends.length, 1);
});

test('storage failure before send prevents signing; failure after send retains the earlier safety marker', async () => {
  const f = fixture(); await f.connect();
  f.storage.setItem = () => { throw new Error('Storage blocked'); };
  await f.controller.deploy(true);
  assert.equal(f.sends.length, 0);
  assert.match(f.controller.state.status, /Storage blocked/);

  const g = fixture(); await g.connect();
  const setItem = g.storage.setItem;
  let writes = 0;
  g.storage.setItem = (key, value) => { if (++writes > 1) throw new Error('Storage full'); setItem(key, value); };
  await g.controller.deploy(true);
  assert.equal(g.sends.length, 1);
  assert.equal(g.controller.state.confirmed, true);
  assert.equal(JSON.parse(g.saved.get(g.controller.storageKey)!).status, 'awaiting-wallet');
  const restored = new CareDeployment(g.deps);
  assert.equal(restored.state.awaiting, true);
  await restored.deploy(true);
  assert.equal(g.sends.length, 1);
});

test('unreadable/corrupt or conflicting stored state fails closed without automatic RPC', () => {
  for (const saved of ['{bad-json', JSON.stringify({ status: 'pending', hash, dataHash: otherHash })]) {
    const f = fixture(); f.saved.set(f.controller.storageKey, saved);
    const restored = new CareDeployment(f.deps);
    assert.equal(restored.state.awaiting, true);
    assert.equal(f.log.length, 0);
  }
  const f = fixture(); f.storage.getItem = () => { throw new Error('Access denied'); };
  assert.equal(new CareDeployment(f.deps).state.awaiting, true);
});

test('recovery checks the exact transaction before saving or claiming deployment', async () => {
  for (const change of [
    f => { f.tx.from = otherAddress; }, f => { f.tx.to = otherAddress; },
    f => { f.tx.input = '0x6000'; }, f => { f.tx.value = 1n; },
    f => { f.tx.nonce++; }, f => { f.tx.chainId = 1; },
  ]) {
    const f = fixture(); change(f); await f.controller.recover(hash);
    assert.match(f.controller.state.status, /does not match/);
    assert.equal(f.saved.size, 0);
    assert.equal(f.controller.state.hash, null);
    assert.equal(f.controller.state.confirmed, false);
  }
});

for (const [label, change, error] of [
  ['transaction hash mismatch', f => { f.tx.hash = otherHash; }, /identities differ/],
  ['receipt hash mismatch', f => { f.receipt.transactionHash = otherHash; }, /identities differ/],
  ['receipt block mismatch', f => { f.receipt.blockNumber = 101n; }, /identities differ/],
  ['reverted creation', f => { f.receipt.status = 'reverted'; }, /reverted/],
  ['unexpected address', f => { f.receipt.contractAddress = otherAddress; }, /unexpected address/],
  ['wrong runtime', f => { f.options.runtime = '0x6000'; }, /runtime, authority or starting rules differ/],
  ['wrong admin', f => { f.fields.admin = otherAddress; }, /runtime, authority or starting rules differ/],
  ['changed initial rules', f => { f.fields.currentRules.actions[1].points++; }, /runtime, authority or starting rules differ/],
  ['wrong version', f => { f.fields.currentRuleVersion = 2n; }, /runtime, authority or starting rules differ/],
  ['wrong delay', f => { f.fields.RULE_DELAY = 1n; }, /runtime, authority or starting rules differ/],
  ['wrong contract chain', f => { f.fields.CHAIN_ID = 1n; }, /runtime, authority or starting rules differ/],
  ['wrong collection', f => { f.fields.GENESIS = otherAddress; }, /runtime, authority or starting rules differ/],
  ['receipt reorg', f => { f.options.reorg = true; }, /Confirmation block changed/],
] as const) test(`confirmation rejects ${label}`, async () => {
  const f = fixture(); f.makePending(); change(f);
  const restored = new CareDeployment(f.deps); await restored.recheck();
  assert.match(restored.state.status, error);
  assert.equal(restored.state.confirmed, false);
  assert.equal(restored.state.hash, hash, 'a failed verification must retain the transaction for inspection');
  assert.equal(f.sends.length, 0);
});

test('receipt timeout keeps the submitted hash and recheck confirms without resending', async () => {
  const f = fixture(); await f.connect(); f.options.waitError = new Error('Timed out waiting for receipt');
  await f.controller.deploy(true);
  assert.equal(f.controller.state.hash, hash);
  assert.equal(f.controller.state.confirmed, false);
  f.options.waitError = null; await f.controller.recheck();
  assert.equal(f.controller.state.confirmed, true);
  assert.equal(f.sends.length, 1);
});

test('a later failed confirmation invalidates an earlier success', async () => {
  const f = fixture(); await f.connect(); await f.controller.deploy(true);
  assert.equal(f.controller.state.confirmed, true);
  f.options.reorg = true; await f.controller.recheck();
  assert.match(f.controller.state.status, /Confirmation block changed/);
  assert.equal(f.controller.state.confirmed, false);
});

test('unknown wallet outcome can be recovered by exact transaction hash', async () => {
  const f = fixture(); await f.connect(); f.options.sendError = new Error('Unknown wallet result');
  await f.controller.deploy(true); f.options.occupied = true;
  await f.controller.recover(hash);
  assert.equal(f.controller.state.confirmed, true);
  assert.equal(f.controller.state.awaiting, false);
  assert.equal(f.controller.state.hash, hash);
  assert.equal(f.sends.length, 1);
});

test('clearing a cancelled request rechecks nonce and refuses pending or mined deployments', async () => {
  const f = fixture(); await f.connect(); f.options.sendError = new Error('Unknown wallet result');
  await f.controller.deploy(true);
  f.options.pendingNonce++; await f.controller.clearCancelled();
  assert.equal(f.controller.state.awaiting, true);
  assert.equal(f.saved.size, 1);
  f.options.pendingNonce--; await f.controller.clearCancelled();
  assert.equal(f.controller.state.awaiting, false);
  assert.equal(f.saved.size, 0);
  const g = fixture(); g.makePending();
  const restored = new CareDeployment(g.deps); await restored.clearCancelled();
  assert.match(restored.state.status, /must be verified, not cleared/);
  assert.equal(g.saved.size, 1);
});
