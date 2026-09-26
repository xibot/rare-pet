import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, toHex } from 'viem';

// All wallet calls are a fake injected provider. All RPC requests are fulfilled here.
// Never launch this test with a persistent browser profile or a real wallet extension.
const origin = process.env.RAREPET_DEPLOY_TEST_URL || 'http://127.0.0.1:4180';
assert(['http://127.0.0.1:4180', 'http://localhost:4180'].includes(origin), 'Only the local handoff may be tested.');
const review = JSON.parse(await readFile(new URL('../contracts/rare-launchpad/deployment-review.json', import.meta.url), 'utf8'));
const rpc = 'https://rpc.mainnet.chain.robinhood.com';
const key = `rarepet:router-deployment:${keccak256(review.unsignedTransaction.data)}`;
const wrongOwner = '0x1111111111111111111111111111111111111111';
const deployed = '0x2222222222222222222222222222222222222222';
const hash = `0x${'12'.repeat(32)}`, blockHash = `0x${'ab'.repeat(32)}`;
const gasEstimate = BigInt(review.unsignedTransaction.gasEstimate);
const abi = parseAbi(['function treasury() view returns(address)', 'function friendShares() view returns(uint96)', 'function treasuryShares() view returns(uint96)', 'function totalSupply() view returns(uint256)', 'function CHAIN_ID() view returns(uint256)', 'function quoteTokens() view returns(address[])', 'function getModuleState(address) view returns(uint8)']);
const equal = (a, b) => a.toLowerCase() === b.toLowerCase();
const screenshots = 'artifacts/launch-deploy';
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = new Set();
let passed = 0;

function validatePayload(payload) {
  assert(equal(payload.from, review.config.deployer), 'Only the reviewed deployer can send.');
  assert(payload.to === undefined || payload.to === null, 'Deployment must have no destination.');
  assert.equal(payload.data, review.unsignedTransaction.data, 'Exact reviewed creation bytecode and constructor arguments.');
  assert.equal(BigInt(payload.value ?? '0x0'), 0n, 'Contract creation sends no native asset value.');
  if (payload.chainId !== undefined) assert.equal(BigInt(payload.chainId), 4663n);
}

async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1280, height: 1100 }, serviceWorkers: 'block' });
  contexts.add(context);
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const state = { errors: [], unexpected: [], failures: [], rpc: [], wallet: [], attempts: 0, sends: 0,
    reject: false, unknownError: false, holdReceipt: false, rpcChain: '0x1237', changedModule: false,
    wrongTransaction: false, wrongTreasury: false, staleReview: false, unavailableReview: false, balance: 1000000000000000000n, pendingStorageFailure: !!options.pendingStorageFailure };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.exposeFunction('mockWalletMethod', method => { state.wallet.push(method); });
  await page.exposeFunction('validateMockDeployment', ({ payload, storage }) => {
    try {
      validatePayload(payload);
      assert.equal(BigInt(payload.gas), gasEstimate * 120n / 100n, 'Gas limit includes the reviewed 20% buffer.');
      assert.equal(JSON.parse(storage).status, 'awaiting-wallet', 'Unknown-request protection is saved before wallet submission.');
      state.attempts++;
      if (state.reject) return { error: 'User rejected the request.', code: 4001 };
      if (state.unknownError) return { error: 'Provider disconnected after submission. Request outcome unknown.', code: 4900 };
      state.sends++;
      return { hash };
    } catch (error) { state.failures.push(error.message); throw error; }
  });
  await page.addInitScript(({ account, key, saved, pendingStorageFailure }) => {
    let current = account, chainId = '0x1237';
    if (saved !== undefined && !sessionStorage.getItem('mock-initialized')) {
      localStorage.setItem(key, saved); sessionStorage.setItem('mock-initialized', '1');
    }
    if (pendingStorageFailure) {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key && JSON.parse(value).status === 'pending') throw new DOMException('Test quota exceeded.', 'QuotaExceededError');
        return original.call(this, name, value);
      };
    }
    window.ethereum = { async request({ method, params }) {
      await window.mockWalletMethod(method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return current ? [current] : [];
      if (method === 'eth_chainId') return chainId;
      if (method === 'wallet_switchEthereumChain') { chainId = params[0].chainId; return null; }
      if (method === 'eth_sendTransaction') {
        const result = await window.validateMockDeployment({ payload: params[0], storage: localStorage.getItem(key) });
        if (result.error) { const error = new Error(result.error); error.code = result.code; throw error; }
        return result.hash;
      }
      throw new Error(`Unexpected mocked wallet method: ${method}`);
    } };
    window.testWallet = { change(next) { current = next; }, chain(next) { chainId = next; } };
  }, { account: options.account ?? review.config.deployer, key, saved: options.saved, pendingStorageFailure: state.pendingStorageFailure });
  async function rpcResult(call) {
    state.rpc.push(call.method);
    if (call.method === 'eth_chainId') return state.rpcChain;
    if (call.method === 'eth_blockNumber') return '0x100';
    if (call.method === 'eth_gasPrice') return '0x3b9aca00';
    if (call.method === 'eth_getBalance') { assert(equal(call.params[0], review.config.deployer), 'Only the reviewed deployer balance is checked.'); return toHex(state.balance); }
    if (call.method === 'eth_estimateGas') { validatePayload(call.params[0]); return toHex(gasEstimate); }
    if (call.method === 'eth_call') {
      const payload = call.params[0], decoded = decodeFunctionData({ abi, data: payload.data });
      let result;
      if (equal(payload.to, review.airlock.address)) {
        assert.equal(decoded.functionName, 'getModuleState');
        const module = review.modules.find(entry => equal(entry.address, decoded.args[0]));
        assert(module, 'Only a reviewed Doppler module may be checked.');
        result = state.changedModule ? 0 : module.state;
      } else {
        assert(equal(payload.to, deployed), 'Only the fake deployed contract may be inspected.');
        result = { treasury: state.wrongTreasury ? wrongOwner : review.config.treasury,
          friendShares: 850000000000000000n, treasuryShares: 100000000000000000n,
          totalSupply: BigInt(review.config.totalSupply), CHAIN_ID: 4663n, quoteTokens: review.quotes.map(entry => entry.address) }[decoded.functionName];
        assert.notEqual(result, undefined, 'Unexpected getter.');
      }
      return encodeFunctionResult({ abi, functionName: decoded.functionName, result });
    }
    if (call.method === 'eth_getCode') { assert(equal(call.params[0], deployed)); return '0x6000'; }
    if (call.method === 'eth_getBlockByNumber') return { hash: blockHash, parentHash: `0x${'aa'.repeat(32)}`, number: '0x100', timestamp: '0x60000000', nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1000000', gasUsed: '0x0', size: '0x1', extraData: '0x', transactions: [], uncles: [], baseFeePerGas: '0x1' };
    if (call.method === 'eth_getTransactionReceipt' || call.method === 'eth_getTransactionByHash') {
      assert.equal(call.params[0], hash, 'Only the fake submitted hash may be inspected.');
      if (call.method === 'eth_getTransactionByHash') return { hash, from: review.config.deployer, to: null, value: '0x0', input: state.wrongTransaction ? '0x6000' : review.unsignedTransaction.data, blockHash, blockNumber: '0x100', transactionIndex: '0x0', nonce: '0x1', gas: '0x400000', gasPrice: '0x1', type: '0x0', chainId: '0x1237', v: '0x1', r: `0x${'00'.repeat(32)}`, s: `0x${'00'.repeat(32)}` };
      if (state.holdReceipt) return null;
      return { transactionHash: hash, from: review.config.deployer, to: null, contractAddress: deployed, blockHash, blockNumber: '0x100', transactionIndex: '0x0', status: '0x1', gasUsed: toHex(gasEstimate), cumulativeGasUsed: toHex(gasEstimate), effectiveGasPrice: '0x1', logs: [], logsBloom: `0x${'00'.repeat(256)}`, type: '0x0' };
    }
    throw new Error(`Unexpected RPC method: ${call.method}`);
  }
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === '/review.json' && state.unavailableReview) return route.fulfill({status:409,body:'Review changed.'});
      if (url.pathname === '/review.json' && state.staleReview) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...review,catalogHash:'obsolete-catalog'})});
      return route.continue();
    }
    if (url.origin === rpc && url.pathname === '/') {
      try {
        assert.equal(route.request().method(), 'POST');
        const payload = route.request().postDataJSON();
        const result = async call => ({ jsonrpc: '2.0', id: call.id, result: await rpcResult(call) });
        const body = Array.isArray(payload) ? await Promise.all(payload.map(result)) : await result(payload);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
      } catch (error) { state.failures.push(error.message); return route.abort(); }
    }
    state.unexpected.push(route.request().url()); return route.abort();
  });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#details').getByText(review.config.treasury, { exact: true }).first().waitFor();
  async function status(pattern) { await page.waitForFunction(source => new RegExp(source).test(document.querySelector('#status').textContent), pattern.source); }
  async function connect() { await page.locator('#connect').click(); await status(/Deployer connected/); }
  async function estimate() { await page.locator('#estimate').click(); await page.waitForFunction(() => !document.querySelector('#estimate').disabled); await status(/Network fee checked/); }
  async function ready() { await connect(); await estimate(); await page.locator('#reviewed').check(); assert(await page.locator('#deploy').isEnabled()); }
  async function checked() {
    assert.deepEqual(state.errors, [], 'No browser exceptions.'); assert.deepEqual(state.failures, [], 'Every RPC/payload was expected.'); assert.deepEqual(state.unexpected, [], 'No external network was allowed.');
    assert(!state.wallet.some(method => !['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_sendTransaction'].includes(method)), 'Only expected wallet methods.');
  }
  return { context, page, state, status, connect, estimate, ready, checked };
}
async function scenario(name, run) {
  const activeBefore = new Set(contexts);
  try { await run(); passed++; console.log(`PASS ${name}`); }
  finally { for (const context of contexts) if (!activeBefore.has(context)) { await context.close(); contexts.delete(context); } }
}

try {
  await scenario('explicit connect, signer, checkbox, fresh chain/module fee gates', async () => {
    const t = await fixture();
    assert.deepEqual(t.state.wallet, []); assert.deepEqual(t.state.rpc, []);
    assert(await t.page.locator('#deploy').isDisabled()); assert(await t.page.locator('#estimate').isDisabled());
    await t.page.locator('#reviewed').check(); assert(await t.page.locator('#deploy').isDisabled());
    await t.connect(); assert(await t.page.locator('#deploy').isDisabled());
    t.state.rpcChain = '0x1'; await t.page.locator('#estimate').click(); await t.status(/RPC chain mismatch/); assert(await t.page.locator('#deploy').isDisabled());
    t.state.rpcChain = '0x1237'; t.state.changedModule = true; await t.page.locator('#estimate').click(); await t.status(/Doppler module changed/); assert(await t.page.locator('#deploy').isDisabled());
    t.state.changedModule = false; await t.estimate(); assert(await t.page.locator('#deploy').isEnabled());
    await t.page.locator('#reviewed').uncheck(); assert(await t.page.locator('#deploy').isDisabled());
    await t.page.locator('#reviewed').check();
    await t.page.evaluate(owner => window.testWallet.change(owner), wrongOwner);
    await t.page.locator('#deploy').click(); await t.status(/Use the reviewed deployer/);
    assert.equal(t.state.attempts, 0); await t.checked();
  });
  await scenario('stale or unavailable local review blocks an already-ready page before wallet submission', async () => {
    for (const kind of ['staleReview', 'unavailableReview']) {
      const t = await fixture(); await t.ready(); t.state[kind] = true;
      await t.page.locator('#deploy').click(); await t.status(kind === 'staleReview' ? /outdated deployment or quote list/ : /review changed or is unavailable/);
      assert.equal(t.state.attempts, 0); assert.equal(t.state.sends, 0); await t.checked();
    }
  });
  await scenario('wrong connected owner cannot estimate or submit', async () => {
    const t = await fixture({ account: wrongOwner }); await t.page.locator('#connect').click(); await t.status(/Select 0x/);
    assert(await t.page.locator('#estimate').isDisabled()); assert(await t.page.locator('#deploy').isDisabled());
    assert.equal(t.state.rpc.length, 0); assert.equal(t.state.attempts, 0); await t.checked();
  });
  await scenario('insufficient ETH blocks deployment and balance is rechecked before sending', async () => {
    const t = await fixture(); t.state.balance = 0n; await t.connect(); await t.page.locator('#reviewed').check(); await t.estimate();
    assert((await t.page.locator('#estimate-value').textContent()).includes('Add ETH on Robinhood Chain'));
    assert(await t.page.locator('#deploy').isDisabled()); assert.equal(t.state.attempts, 0);
    t.state.balance = gasEstimate * 1000000000n * 120n / 100n - 1n; await t.estimate();
    assert(await t.page.locator('#deploy').isDisabled(), 'The 20% gas buffer must be funded.');
    t.state.balance++; await t.estimate(); assert(await t.page.locator('#deploy').isEnabled());
    t.state.balance = 0n; await t.page.locator('#deploy').click(); await t.status(/deployer needs ETH/);
    assert(await t.page.locator('#deploy').isDisabled()); assert.equal(t.state.attempts, 0); await t.checked();
  });
  await scenario('wallet rejection remains retryable without a pending transaction', async () => {
    const t = await fixture(); await t.ready(); t.state.reject = true;
    await t.page.locator('#deploy').click(); await t.status(/User rejected/);
    assert.equal(t.state.attempts, 1); assert.equal(t.state.sends, 0);
    assert.equal(await t.page.evaluate(key => localStorage.getItem(key), key), null);
    assert(await t.page.locator('#clear').isHidden()); assert(await t.page.locator('#deploy').isEnabled()); await t.checked();
  });
  await scenario('unknown submission outcome blocks reload until explicitly cleared', async () => {
    const t = await fixture(); await t.ready(); t.state.unknownError = true;
    await t.page.locator('#deploy').click(); await t.status(/Provider disconnected/);
    assert(await t.page.locator('#clear').isVisible()); assert(await t.page.locator('#deploy').isDisabled());
    const walletCalls = t.state.wallet.length; await t.page.reload({ waitUntil: 'networkidle' }); await t.status(/previous wallet request/);
    assert.equal(t.state.wallet.length, walletCalls); assert.equal(t.state.attempts, 1);
    assert(await t.page.locator('#connect').isDisabled()); assert(await t.page.locator('#deploy').isDisabled());
    await t.page.locator('#clear').click(); await t.status(/Cancelled request cleared/);
    assert.equal(await t.page.evaluate(key => localStorage.getItem(key), key), null);
    assert(await t.page.locator('#connect').isEnabled()); assert(await t.page.locator('#deploy').isDisabled()); await t.checked();
  });
  await scenario('malformed, unknown, and invalid-hash records fail closed', async () => {
    for (const saved of ['not-json', JSON.stringify({ status: 'unknown' }), JSON.stringify({ status: 'pending', hash: '0x123' }), 'null']) {
      const t = await fixture({ saved }); await t.status(/Saved deployment state could not be read/);
      assert(await t.page.locator('#connect').isDisabled()); assert(await t.page.locator('#deploy').isDisabled()); assert(await t.page.locator('#clear').isVisible());
      assert.deepEqual(t.state.wallet, []); assert.deepEqual(t.state.rpc, []); await t.checked();
    }
  });
  await scenario('exact mocked deployment confirms checked immutable configuration', async () => {
    const t = await fixture(); await t.ready();
    await t.page.screenshot({ path: `${screenshots}/desktop-review.png`, fullPage: true });
    await t.page.locator('#deploy').click(); await t.status(/Deployment confirmed\. No token/);
    assert.equal(t.state.sends, 1); assert.equal(t.state.attempts, 1);
    assert((await t.page.locator('#result').textContent()).includes(deployed));
    assert(await t.page.locator('#deploy').isDisabled());
    await t.page.screenshot({ path: `${screenshots}/desktop-confirmed-mock.png`, fullPage: true }); await t.checked();
  });
  await scenario('pending hash survives reload and rechecks without reconnect or resubmit', async () => {
    const t = await fixture(); await t.ready(); t.state.holdReceipt = true;
    await t.page.locator('#deploy').click();
    await t.page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.status === 'pending', key);
    const walletCalls = t.state.wallet.length; await t.page.reload({ waitUntil: 'networkidle' }); await t.status(/Saved deployment transaction/);
    assert.equal(t.state.wallet.length, walletCalls); assert.equal(t.state.sends, 1);
    assert((await t.page.locator('#status').textContent()).includes(hash)); assert(await t.page.locator('#deploy').isDisabled());
    t.state.holdReceipt = false; await t.page.locator('#recheck').click(); await t.status(/Deployment confirmed\. No token/);
    assert.equal(t.state.sends, 1); assert.equal(t.state.wallet.length, walletCalls); await t.checked();
  });
  await scenario('pending-storage failure still surfaces hash and confirms, reload remains blocked', async () => {
    const t = await fixture({ pendingStorageFailure: true }); await t.ready(); await t.page.locator('#deploy').click();
    await t.status(/Deployment confirmed\. No token/);
    assert((await t.page.locator('#result').textContent()).includes(hash));
    assert.equal(JSON.parse(await t.page.evaluate(key => localStorage.getItem(key), key)).status, 'awaiting-wallet');
    await t.page.reload({ waitUntil: 'networkidle' }); await t.status(/previous wallet request/);
    assert.equal(t.state.sends, 1); assert(await t.page.locator('#connect').isDisabled()); await t.checked();
  });
  await scenario('mismatched submitted input or treasury cannot show a confirmed deployment', async () => {
    for (const kind of ['wrongTransaction', 'wrongTreasury']) {
      const t = await fixture(); await t.ready(); t.state[kind] = true; await t.page.locator('#deploy').click();
      await t.status(kind === 'wrongTransaction' ? /does not match the reviewed deployment/ : /Deployed configuration did not match/);
      assert(await t.page.locator('#result').isHidden()); assert(await t.page.locator('#recheck').isVisible()); assert(await t.page.locator('#deploy').isDisabled());
      assert.equal(t.state.sends, 1); await t.checked();
    }
  });
  await scenario('mobile review stays readable without horizontal overflow', async () => {
    const t = await fixture({ viewport: { width: 390, height: 844 } });
    assert(await t.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await t.page.screenshot({ path: `${screenshots}/mobile-review.png`, fullPage: true }); await t.checked();
  });
  console.log(`Deployment handoff: ${passed} scenarios passed. Only simulated transactions were used.`);
} finally {
  await Promise.all([...contexts].map(context => context.close())); await browser.close();
}
