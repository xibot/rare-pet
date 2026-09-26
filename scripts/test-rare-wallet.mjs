import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, parseAbi, padHex, toHex, zeroAddress } from 'viem';

// Every non-local request and every wallet method is intercepted. No real wallet or transaction is used.
const origin = process.env.RAREPET_TEST_URL || 'http://127.0.0.1:4175';
const rpc = 'https://rpc.mainnet.chain.robinhood.com';
const account = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const tba = '0x3333333333333333333333333333333333333333';
const recipient = '0x4444444444444444444444444444444444444444';
const token20 = '0x5555555555555555555555555555555555555555';
const token721 = '0x6666666666666666666666666666666666666666';
const token1155 = '0x7777777777777777777777777777777777777777';
const genesis = '0x116EaA62241751E0c98dA43d458600c6C17cD361';
const generations = '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D';
const blockHash = `0x${'ab'.repeat(32)}`;
const amount20 = 1000000000000000001n;
const nftAbi = parseAbi([
  'function balanceOf(address account) view returns (uint256)', 'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)', 'function tokenURI(uint256 tokenId) view returns (string)',
  'function name() view returns (string)', 'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function safeTransferFrom(address from,address to,uint256 tokenId)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
]);
const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)', 'function name() view returns (string)',
  'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
  'function transfer(address to,uint256 amount) returns (bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const multiAbi = parseAbi([
  'function balanceOf(address account,uint256 tokenId) view returns (uint256)', 'function name() view returns (string)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function safeTransferFrom(address from,address to,uint256 tokenId,uint256 amount,bytes data)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
]);
const walletAbi = parseAbi([
  'function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes result)',
  'function owner() view returns (address)', 'function token() view returns (uint256 chainId,address tokenContract,uint256 tokenId)',
]);
const portrait = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="white"/><path fill="black" d="M1 1h6v6H1zM2 2v1h1V2zm3 0v1h1V2zM3 4v1h2V4z" fill-rule="evenodd"/></svg>').toString('base64');
const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Genesis #1', image: portrait })).toString('base64');
const equal = (a, b) => a.toLowerCase() === b.toLowerCase();
function log(address, abi, eventName, args, data = '0x', index = 0, transactionHash = `0x${'cd'.repeat(32)}`) {
  return { address, topics: encodeEventTopics({ abi, eventName, args }), data, blockNumber: '0x100', blockHash,
    transactionHash, transactionIndex: '0x0', logIndex: toHex(index), removed: false };
}
const ownedFriend = log(genesis, nftAbi, 'Transfer', { from: zeroAddress, to: account, tokenId: 1n });
const tokenLog = log(token20, erc20Abi, 'Transfer', { from: zeroAddress, to: tba }, encodeAbiParameters([{ type: 'uint256' }], [amount20]), 1);
const nftLog = log(token721, nftAbi, 'Transfer', { from: zeroAddress, to: tba, tokenId: 0n }, '0x', 2);
const multiLog = log(token1155, multiAbi, 'TransferSingle', { operator: account, from: zeroAddress, to: tba }, encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [0n, 3n]), 3);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const screenshotDir = process.env.RAREPET_WALLET_SCREENSHOTS || 'artifacts/rare-wallet';
await mkdir(screenshotDir, { recursive: true });

function validateExecution(payload, expected) {
  assert(expected, 'No reviewed transfer was expected');
  assert(equal(payload.from, account), 'Outer sender must be the selected owner');
  assert(equal(payload.to, tba), 'Outer target must be the canonical RF wallet');
  assert.equal(BigInt(payload.value ?? '0x0'), 0n, 'Owner EOA sends zero asset value');
  const execution = decodeFunctionData({ abi: walletAbi, data: payload.data });
  assert.equal(execution.functionName, 'execute');
  const [target, value, data, operation] = execution.args;
  assert.equal(operation, 0, 'Only CALL is allowed');
  if (expected.kind === 'native') {
    assert(equal(target, recipient)); assert.equal(value, expected.amount); assert.equal(data, '0x');
  } else {
    assert(equal(target, expected.contract)); assert.equal(value, 0n);
    const nested = decodeFunctionData({ abi: expected.kind === 'erc20' ? erc20Abi : expected.kind === 'erc721' ? nftAbi : multiAbi, data });
    if (expected.kind === 'erc20') {
      assert.equal(nested.functionName, 'transfer'); assert(equal(nested.args[0], recipient)); assert.equal(nested.args[1], expected.amount);
    } else {
      assert.equal(nested.functionName, 'safeTransferFrom'); assert(equal(nested.args[0], tba)); assert(equal(nested.args[1], recipient));
      assert.equal(nested.args[2], 0n, 'Token ID zero is valid and must not be lost');
      if (expected.kind === 'erc1155') { assert.equal(nested.args[3], expected.amount); assert.equal(nested.args[4], '0x'); }
    }
  }
}

async function fixture(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const state = { requests: [], errors: [], unexpected: [], failures: [], sends: [], attempts: 0, expected: null, reject: false,
    balance20: amount20, balanceNative: 2000000000000000001n, owner721: tba, balance1155: 3n,
    nextOwnerGate: null, ownerReads: 0, transactions: new Map(), holdReceipts: false };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.exposeFunction('validateMockTransfer', payload => {
    try {
      validateExecution(payload, state.expected); state.attempts++;
      if (state.reject) return { rejected: true };
      const hash = `0x${(state.sends.length + 1).toString(16).padStart(64, '0')}`;
      const entry = { payload, expected: { ...state.expected }, hash };
      state.sends.push(entry); state.transactions.set(hash, entry);
      if (state.expected.kind === 'native') state.balanceNative -= state.expected.amount;
      if (state.expected.kind === 'erc20') state.balance20 -= state.expected.amount;
      if (state.expected.kind === 'erc721') state.owner721 = recipient;
      if (state.expected.kind === 'erc1155') state.balance1155 -= state.expected.amount;
      return { hash };
    } catch (error) { state.failures.push(error.message); throw error; }
  });
  await page.addInitScript(({ account }) => {
    let current = null; const listeners = new Map(), methods = [];
    const emit = (name, value) => [...listeners.get(name) ?? []].forEach(fn => fn(value));
    window.ethereum = {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeListener(name, fn) { listeners.get(name)?.delete(fn); },
      async request({ method, params }) {
        methods.push(method);
        if (method === 'eth_accounts') return current ? [current] : [];
        if (method === 'eth_requestAccounts') { current = account; return [current]; }
        if (method === 'eth_chainId') return '0x1237';
        if (method === 'eth_sendTransaction') {
          const result = await window.validateMockTransfer(params[0]);
          if (result.rejected) { const error = new Error('User rejected the request.'); error.code = 4001; throw error; }
          return result.hash;
        }
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    };
    window.testWallet = { methods, change(next) { current = next; emit('accountsChanged', next ? [next] : []); } };
  }, { account });
  async function resultFor(call) {
    if (call.method === 'eth_chainId') return '0x1237';
    if (call.method === 'eth_blockNumber') return '0x100';
    if (call.method === 'eth_getCode') { assert([tba, token20, token721, token1155].some(value => equal(value, call.params[0]))); return '0x1234'; }
    if (call.method === 'eth_getBalance') { assert(equal(call.params[0], tba), 'Balance read must target RF wallet'); return toHex(state.balanceNative); }
    if (call.method === 'eth_getLogs') {
      const query = call.params[0];
      if (query.address) {
        assert(equal(query.address, genesis), 'Canonical friend discovery contract');
        assert(query.topics[1] || query.topics[2], 'Friend discovery must filter owner');
        return query.topics[2] && equal(query.topics[2], padHex(account, { size: 32 })) ? [ownedFriend] : [];
      }
      const target = Array.isArray(query.topics[0]) ? query.topics[3] : query.topics[2];
      assert(equal(target, padHex(tba, { size: 32 })), 'Asset discovery must filter canonical RF wallet, not owner EOA');
      return Array.isArray(query.topics[0]) ? [multiLog] : [tokenLog, nftLog];
    }
    if (call.method === 'eth_call') {
      const payload = call.params[0], contract = payload.to;
      let abi, value;
      if (equal(contract, tba)) {
        abi = walletAbi;
        const decoded = decodeFunctionData({ abi, data: payload.data });
        if (decoded.functionName === 'execute') {
          validateExecution(payload, state.expected);
          value = state.expected.kind === 'erc20' ? encodeAbiParameters([{ type: 'bool' }], [true]) : '0x';
        } else value = decoded.functionName === 'owner' ? account : [4663n, genesis, 1n];
        return encodeFunctionResult({ abi, functionName: decoded.functionName, result: value });
      }
      assert([genesis, generations, token20, token721, token1155].some(value => equal(value, contract)), 'Known fixture contract only');
      abi = equal(contract, token20) ? erc20Abi : equal(contract, token1155) ? multiAbi : nftAbi;
      const decoded = decodeFunctionData({ abi, data: payload.data });
      if (equal(contract, generations)) { assert.equal(decoded.functionName, 'balanceOf'); value = 0n; }
      else if (equal(contract, genesis)) {
        if (decoded.functionName === 'ownerOf') {
          state.ownerReads++; const gate = state.nextOwnerGate; state.nextOwnerGate = null; if (gate) await gate;
        }
        value = { balanceOf: decoded.args?.[0] && equal(String(decoded.args[0]), account) ? 1n : 0n, ownerOf: account, tokenBoundAccount: tba, tokenURI: uri }[decoded.functionName];
      } else if (equal(contract, token20)) {
        if (decoded.functionName === 'balanceOf') assert(equal(decoded.args[0], tba));
        value = { balanceOf: state.balance20, name: 'Rare Token', symbol: 'RF', decimals: 18 }[decoded.functionName];
      } else if (equal(contract, token721)) {
        if (decoded.functionName === 'ownerOf') assert.equal(decoded.args[0], 0n);
        value = { ownerOf: state.owner721, name: 'Rare Collectible', supportsInterface: true }[decoded.functionName];
      } else {
        if (decoded.functionName === 'balanceOf') { assert(equal(decoded.args[0], tba)); assert.equal(decoded.args[1], 0n); }
        value = { balanceOf: state.balance1155, name: 'Rare Editions', supportsInterface: true }[decoded.functionName];
      }
      assert.notEqual(value, undefined, `Unexpected ${contract} read ${decoded.functionName}`);
      return encodeFunctionResult({ abi, functionName: decoded.functionName, result: value });
    }
    if (call.method === 'eth_getBlockByNumber') return { hash: blockHash, parentHash: `0x${'aa'.repeat(32)}`, number: '0x100', timestamp: '0x60000000', nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1000000', gasUsed: '0x0', size: '0x1', extraData: '0x', transactions: [], uncles: [], baseFeePerGas: '0x1' };
    if (call.method === 'eth_getTransactionReceipt' || call.method === 'eth_getTransactionByHash') {
      const entry = state.transactions.get(call.params[0]); assert(entry, 'Only submitted fake transactions can be queried');
      const { expected, payload, hash } = entry;
      if (call.method === 'eth_getTransactionReceipt' && state.holdReceipts) return null;
      if (call.method === 'eth_getTransactionByHash') return { hash, from: account, to: tba, value: '0x0', input: payload.data, blockHash, blockNumber: '0x100', transactionIndex: '0x0', nonce: '0x1', gas: '0x20000', gasPrice: '0x1', type: '0x0', chainId: '0x1237', v: '0x1', r: `0x${'00'.repeat(32)}`, s: `0x${'00'.repeat(32)}` };
      const logs = expected.kind === 'native' ? [] : expected.kind === 'erc20'
        ? [log(token20, erc20Abi, 'Transfer', { from: tba, to: recipient }, encodeAbiParameters([{ type: 'uint256' }], [expected.amount]), 0, hash)]
        : expected.kind === 'erc721' ? [log(token721, nftAbi, 'Transfer', { from: tba, to: recipient, tokenId: 0n }, '0x', 0, hash)]
          : [log(token1155, multiAbi, 'TransferSingle', { operator: tba, from: tba, to: recipient }, encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [0n, expected.amount]), 0, hash)];
      return { transactionHash: hash, from: account, to: tba, blockHash, blockNumber: '0x100', transactionIndex: '0x0', status: '0x1', cumulativeGasUsed: '0x1000', gasUsed: '0x1000', effectiveGasPrice: '0x1', logsBloom: `0x${'00'.repeat(256)}`, contractAddress: null, logs, type: '0x0' };
    }
    throw new Error(`Unexpected RPC: ${call.method}`);
  }
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'data:') return route.continue();
    if (url.origin !== rpc) { state.unexpected.push(url.href); return route.abort(); }
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = route.request().postDataJSON();
    async function process(call) {
      state.requests.push(call);
      try { return { jsonrpc: '2.0', id: call.id, result: await resultFor(call) }; }
      catch (error) { state.failures.push(error.message); return { jsonrpc: '2.0', id: call.id, error: { code: -32603, message: 'Fixture rejected request' } }; }
    }
    const output = Array.isArray(body) ? await Promise.all(body.map(process)) : await process(body);
    await route.fulfill({ json: output, headers }).catch(() => {});
  });
  return { context, page, state };
}

async function openOwned(page) {
  await page.locator('.nav-arcade').click();
  await page.locator('.friend-picker:not(.preview-picker)').getByRole('button').filter({ has: page.locator('b', { hasText: /^Genesis #1$/ }) }).click();
  await page.waitForFunction(() => document.querySelector('.habitat-heading h2')?.textContent === 'Genesis #1');
  await page.getByRole('button', { name: 'Rare Wallet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'RARE WALLET', exact: true });
  await dialog.getByText('Rare Token', { exact: true }).waitFor();
  await dialog.locator('.rw-assets[aria-busy="false"]').waitFor();
  return dialog;
}
async function openSend(dialog, name, recipientValue = recipient, amount = null) {
  await dialog.getByRole('button', { name, exact: true }).click();
  await dialog.getByLabel('RECIPIENT ADDRESS', { exact: true }).fill(recipientValue);
  if (amount !== null) await dialog.locator('.rw-amount input').fill(amount);
}
async function review(dialog, amountText) {
  await dialog.getByRole('button', { name: 'REVIEW TRANSFER ↗', exact: true }).click();
  await dialog.getByText('Review your transfer.', { exact: true }).waitFor();
  assert.equal(await dialog.locator('[data-recipient]').innerText(), recipient);
  assert.equal(await dialog.locator('[data-transfer-amount]').innerText(), amountText);
  assert((await dialog.locator('.rw-review').innerText()).includes(account));
}
async function confirm(dialog, state, expected) {
  state.expected = expected;
  const prior = state.sends.length;
  await dialog.getByRole('button', { name: 'CONFIRM IN WALLET ↗', exact: true }).click();
  await dialog.getByText('Transfer confirmed.', { exact: true }).waitFor();
  assert.equal(state.sends.length, prior + 1);
  await dialog.getByRole('button', { name: 'BACK TO HOLDINGS ↗', exact: true }).click();
  await dialog.locator('.rw-assets[aria-busy="false"]').waitFor();
}
async function assertFits(dialog) {
  assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'Wallet modal must not overflow horizontally');
  assert.equal(await dialog.locator('.rw-content').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'Wallet content must fit viewport');
}

try {
  for (const [width, height] of [[1280, 1000], [390, 844]]) {
    const { page, state, context } = await fixture(width, height);
    await page.goto(origin);
    await page.getByRole('button', { name: 'Rare Wallet', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'RARE WALLET', exact: true });
    await dialog.getByText('Your Friend. Their wallet.', { exact: true }).waitFor();
    assert.equal(state.requests.length, 0, 'Preview wallet modal makes no RPC requests');
    assert.equal(state.attempts, 0); assert.equal(await dialog.getByRole('button', { name: /^SEND/ }).count(), 0);
    await assertFits(dialog);
    await page.screenshot({ path: `${screenshotDir}/preview-${width}.png` });
    await dialog.getByRole('button', { name: 'Close Rare Wallet' }).click();
    dialog = await openOwned(page);
    assert.equal(await dialog.getByLabel('Rare Friend wallet address').inputValue(), tba);
    assert.equal(await dialog.locator('.rw-portrait image[data-genesis-art]').getAttribute('href'), portrait);
    await dialog.getByRole('button', { name: 'Copy wallet address' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), tba);
    assert((await dialog.innerText()).includes('2.000000000000000001'));
    assert((await dialog.innerText()).includes('1.000000000000000001'));
    await assertFits(dialog); await page.screenshot({ path: `${screenshotDir}/tokens-${width}.png` });
    await dialog.locator('.rw-tabs').getByRole('button', { name: /^NFTs/ }).click();
    assert.equal(await dialog.getByText('ID #0', { exact: true }).count(), 2);
    assert.equal(await dialog.getByRole('button', { name: 'Send Rare Collectible #0', exact: true }).isEnabled(), true);
    assert.equal(await dialog.getByRole('button', { name: 'Send Rare Editions #0', exact: true }).isEnabled(), true);
    await assertFits(dialog); await page.screenshot({ path: `${screenshotDir}/nfts-${width}.png` });
    if (width === 1280) {
      await dialog.locator('.rw-tabs').getByRole('button', { name: 'TOKENS', exact: true }).click();
      await openSend(dialog, 'Send RF', '0xnotvalid', '1');
      await dialog.getByRole('button', { name: 'REVIEW TRANSFER ↗', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'valid recipient' }).waitFor(); assert.equal(state.attempts, 0);
      await dialog.getByLabel('RECIPIENT ADDRESS', { exact: true }).fill(recipient);
      await dialog.locator('.rw-amount input').fill('1.0000000000000000001');
      await dialog.getByRole('button', { name: 'REVIEW TRANSFER ↗', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'decimal places' }).waitFor(); assert.equal(state.attempts, 0);
      await dialog.locator('.rw-amount input').fill('2');
      await dialog.getByRole('button', { name: 'REVIEW TRANSFER ↗', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'exceeds' }).waitFor(); assert.equal(state.attempts, 0);
      await dialog.locator('.rw-amount input').fill('1.000000000000000001');
      await review(dialog, '1.000000000000000001 × RF');
      await page.screenshot({ path: `${screenshotDir}/review-${width}.png` });
      await confirm(dialog, state, { kind: 'erc20', contract: token20, amount: amount20 });

      await openSend(dialog, 'Send ETH', recipient, '0.1'); await review(dialog, '0.1 × ETH');
      await confirm(dialog, state, { kind: 'native', amount: 100000000000000000n });

      await dialog.locator('.rw-tabs').getByRole('button', { name: /^NFTs/ }).click();
      await openSend(dialog, 'Send Rare Collectible #0'); await review(dialog, '1 × Rare Collectible #0');
      await confirm(dialog, state, { kind: 'erc721', contract: token721 });
      await openSend(dialog, 'Send Rare Editions #0', recipient, '2'); await review(dialog, '2 × Rare Editions #0');
      await confirm(dialog, state, { kind: 'erc1155', contract: token1155, amount: 2n });

      await dialog.locator('.rw-tabs').getByRole('button', { name: 'TOKENS', exact: true }).click();
      await openSend(dialog, 'Send ETH', recipient, '0.1'); await review(dialog, '0.1 × ETH');
      state.expected = { kind: 'native', amount: 100000000000000000n }; state.reject = true;
      const sent = state.sends.length;
      await dialog.getByRole('button', { name: 'CONFIRM IN WALLET ↗', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: /rejected/i }).waitFor();
      assert.equal(state.sends.length, sent); assert.equal(await dialog.getByText('Transfer confirmed.', { exact: true }).count(), 0);
      assert.equal(await dialog.getByRole('button', { name: 'CONFIRM IN WALLET ↗', exact: true }).isEnabled(), true);
      state.reject = false;
      let release; state.nextOwnerGate = new Promise(resolve => { release = resolve; });
      const reads = state.ownerReads, attempts = state.attempts;
      await dialog.getByRole('button', { name: 'CONFIRM IN WALLET ↗', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.rw-status')?.textContent.includes('Checking ownership'));
      for (let i = 0; i < 100 && state.ownerReads === reads; i++) await page.waitForTimeout(10);
      assert(state.ownerReads > reads, 'Transfer reached the delayed ownership recheck');
      await page.evaluate(other => window.testWallet.change(other), other);
      await page.waitForFunction(() => !document.querySelector('.rare-wallet-dialog'));
      release(); await page.waitForTimeout(150);
      assert.equal(state.attempts, attempts, 'Account change prevents any signing prompt for the stale review');
      assert.equal(state.sends.length, sent);
    }
    assert.deepEqual(state.errors, [], 'No uncaught browser errors');
    assert.deepEqual(state.unexpected, [], 'No real external services used');
    assert.deepEqual(state.failures, [], 'All RPC requests and fake sends matched the expected RF wallet');
    const methods = await page.evaluate(() => window.testWallet.methods);
    assert(methods.every(method => ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'eth_sendTransaction'].includes(method)));
    await context.close();
    console.log(`${width}px: preview read-only; canonical wallet copy; ETH/ERC20/ERC721/ERC1155 holdings; responsive modal passed`);
  }
  // A broadcast remains a single transfer after account invalidation and a full page reload.
  {
    const { page, state, context } = await fixture(1280, 1000);
    await page.goto(origin);
    let dialog = await openOwned(page);
    await openSend(dialog, 'Send ETH', recipient, '0.1'); await review(dialog, '0.1 × ETH');
    state.expected = { kind: 'native', amount: 100000000000000000n }; state.holdReceipts = true;
    await dialog.getByRole('button', { name: 'CONFIRM IN WALLET ↗', exact: true }).click();
    await page.waitForFunction(() => {
      const saved = sessionStorage.getItem('rarepet:rare-wallet-transfers:v1');
      return saved && JSON.parse(saved).transfers.some(transfer => transfer.hash && transfer.status === 'pending');
    });
    assert.equal(state.sends.length, 1);
    await page.evaluate(other => window.testWallet.change(other), other);
    await page.waitForFunction(() => !document.querySelector('.rare-wallet-dialog'));
    assert.equal(state.sends.length, 1, 'Account change cannot resend an already broadcast transfer');
    await page.reload();
    dialog = await openOwned(page);
    assert.equal(await dialog.getByRole('button', { name: /^SEND TOKENS/ }).isDisabled(), true, 'Saved pending transfer blocks another send');
    assert.equal(await dialog.getByRole('button', { name: /^SEND NFT/ }).isDisabled(), true);
    const savedHash = state.sends[0].hash;
    assert.equal(await dialog.locator(`a[href$="/tx/${savedHash}"]`).count(), 1, 'Submitted hash survives account change and reload');
    await page.screenshot({ path: `${screenshotDir}/pending-recovery-1280.png` });
    state.holdReceipts = false;
    await dialog.getByRole('button', { name: 'RECHECK TRANSACTION', exact: true }).click();
    await page.waitForFunction(() => {
      const saved = sessionStorage.getItem('rarepet:rare-wallet-transfers:v1');
      return saved && JSON.parse(saved).transfers.some(transfer => transfer.hash && transfer.status === 'confirmed');
    });
    assert.equal(state.sends.length, 1, 'Recovery verifies receipt and reviewed payload without sending again');
    assert.equal(state.attempts, 1);
    assert.deepEqual(state.errors, []); assert.deepEqual(state.unexpected, []); assert.deepEqual(state.failures, []);
    assert(!(await page.evaluate(() => window.testWallet.methods)).includes('eth_sendTransaction'), 'Reloaded page only performed read-only recovery');
    await context.close();
    console.log('Pending transfer survives account change and reload; duplicate sends blocked; exact transaction recovered read-only.');
  }
  console.log('Mocked native/ERC20/ERC721/ERC1155 sends, exact 18-decimal amount, NFT ID zero, validation, rejection and account-change invalidation passed. No real transactions.');
} finally { await browser.close(); }
