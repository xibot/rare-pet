import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, parseAbi, zeroAddress } from 'viem';

// Test-only provider and RPC fixtures. The production app still verifies canonical ownership.
const origin = new URL(process.env.RAREPET_TEST_URL || 'http://127.0.0.1:4175').origin;
const rpc = `${origin}/api/rpc`;
const account = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const tba = '0x3333333333333333333333333333333333333333';
const genesis = '0x116EaA62241751E0c98dA43d458600c6C17cD361';
const generations = '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D';
const abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
const portrait = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="white"/><path fill="black" d="M1 1h6v6H1zM2 2v1h1V2zm3 0v1h1V2zM3 4v1h2V4z" fill-rule="evenodd"/></svg>').toString('base64');
const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Genesis #1', image: portrait })).toString('base64');
const transfer = {
  address: genesis, topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: zeroAddress, to: account, tokenId: 1n } }),
  data: '0x', blockNumber: '0x100', blockHash: '0x' + 'ab'.repeat(32), transactionHash: '0x' + 'cd'.repeat(32),
  transactionIndex: '0x0', logIndex: '0x0', removed: false,
};
const allowedWalletMethods = ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function fixture(width = 1100, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(15000);
  const state = { requests: [], errors: [], consoleErrors: [], unexpected: [], failures: [], ownerReads: 0, nextOwnerGate: null };
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') state.consoleErrors.push(message.text()); });
  await page.addInitScript(({ account }) => {
    // Browser reloads preserve the fake extension's authorization and network.
    // This fixture is isolated to its own browser context and never touches a real wallet.
    const key = 'rarepet:test-wallet:v1';
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* Fresh fixture. */ }
    let current = saved?.account ?? null, chain = saved?.chain ?? '0x1237';
    const listeners = new Map(), methods = Array.isArray(saved?.methods) ? saved.methods : [];
    const persist = () => localStorage.setItem(key, JSON.stringify({ account: current, chain, methods }));
    const emit = (name, data) => [...(listeners.get(name) ?? [])].forEach(fn => fn(data));
    window.ethereum = {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeListener(name, fn) { listeners.get(name)?.delete(fn); },
      async request({ method, params }) {
        methods.push(method); persist();
        if (method === 'eth_accounts') return current ? [current] : [];
        if (method === 'eth_requestAccounts') { current = account; persist(); return [current]; }
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') { chain = params[0].chainId; persist(); emit('chainChanged', chain); return null; }
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    };
    window.testWallet = {
      methods,
      change(next) { current = next; persist(); emit('accountsChanged', next ? [next] : []); },
      network(next) { chain = next; persist(); emit('chainChanged', next); },
    };
  }, { account });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.href !== rpc) {
      if (url.origin === origin || url.protocol === 'data:') return route.continue();
      state.unexpected.push(url.href); return route.abort();
    }
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const call = route.request().postDataJSON();
    state.requests.push(call);
    try {
      let result;
      if (call.method === 'eth_chainId') result = '0x1237';
      else if (call.method === 'eth_blockNumber') result = '0x100';
      else if (call.method === 'eth_getLogs') {
        assert.equal(call.params[0].address.toLowerCase(), genesis.toLowerCase());
        assert(call.params[0].topics[1] || call.params[0].topics[2], 'Discovery must filter transfer history by owner');
        result = call.params[0].topics[2]?.toLowerCase().endsWith(account.slice(2)) ? [transfer] : [];
      } else if (call.method === 'eth_call') {
        const contract = call.params[0].to.toLowerCase();
        assert([genesis.toLowerCase(), generations.toLowerCase()].includes(contract), 'Reads stay on canonical NFT contracts');
        const decoded = decodeFunctionData({ abi, data: call.params[0].data });
        if (contract === generations.toLowerCase()) {
          assert.equal(decoded.functionName, 'balanceOf');
          result = encodeFunctionResult({ abi, functionName: 'balanceOf', result: 0n });
        } else {
          if (decoded.functionName === 'ownerOf') {
            state.ownerReads++;
            const gate = state.nextOwnerGate;
            state.nextOwnerGate = null;
            if (gate) await gate;
          }
          const value = {
            balanceOf: decoded.args[0].toString().toLowerCase() === account.toLowerCase() ? 1n : 0n,
            ownerOf: account, tokenBoundAccount: tba, tokenURI: uri,
          }[decoded.functionName];
          assert.notEqual(value, undefined, `Unexpected read ${decoded.functionName}`);
          result = encodeFunctionResult({ abi, functionName: decoded.functionName, result: value });
        }
      } else throw new Error(`Unexpected RPC: ${call.method}`);
      await route.fulfill({ json: { jsonrpc: '2.0', id: call.id, result }, headers });
    } catch (error) {
      state.failures.push(error.message);
      await route.fulfill({ json: { jsonrpc: '2.0', id: call.id, error: { code: -32603, message: 'Test fixture rejected request' } }, headers }).catch(() => {});
    }
  });
  return { page, state };
}

function card(page) { return page.locator('.friend-picker:not(.preview-picker)').getByRole('button').filter({ has: page.locator('b', { hasText: /^Genesis #1$/ }) }); }
function accountDialog(page) { return page.getByRole('dialog', { name: 'Your wallet', exact: true }); }
function friendDialog(page) { return page.getByRole('dialog', { name: 'Choose your Rare Friend', exact: true }); }
async function assertSelectedGenesis(page) {
  await page.waitForFunction(() => document.querySelector('.habitat-heading h2')?.textContent === 'Genesis #1');
  assert.equal(await page.locator('.habitat-heading h2').innerText(), 'Genesis #1', 'Closing wallet management preserves the selected Friend');
  assert.equal(await page.locator('.pet-portrait image[data-genesis-art]').getAttribute('href'), portrait);
  assert.equal(await page.locator('.mode-switch').getByRole('button', { name: 'MY WALLET', exact: true }).getAttribute('aria-pressed'), 'true');
}
async function assertPreview(page) {
  await page.waitForFunction(() => document.querySelector('.mode-tag')?.textContent === 'PREVIEW MODE');
  assert.equal(await page.locator('.mode-switch').getByRole('button', { name: 'PREVIEW', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: /RESET PREVIEW/ }).count(), 1, 'Disconnected mode exposes device preview care');
  assert.equal(await page.getByRole('button', { name: 'Manage connected wallet', exact: true }).count(), 0);
}
async function connectPrompts(page) { return page.evaluate(() => window.testWallet.methods.filter(method => method === 'eth_requestAccounts').length); }
async function chooseGenesis(page, state) {
  if (!await page.getByRole('dialog').count()) await page.getByRole('button', { name: /CHOOSE FRIEND/ }).click();
  await card(page).waitFor();
  const priorReads = state.ownerReads;
  await card(page).click();
  await page.waitForFunction(() => document.querySelector('.habitat-heading h2')?.textContent === 'Genesis #1');
  assert(state.ownerReads > priorReads, 'Selection rechecks current Genesis ownership');
  assert.equal(await page.locator('.pet-portrait image[data-genesis-art]').getAttribute('href'), portrait, 'Dashboard body keeps the original canonical Genesis portrait');
  assert.equal(await page.locator('.pet-portrait [data-genesis-body]').count(), 1, 'Verified Genesis has an approved runner body');
  assert.equal(await page.locator('.mode-tag').innerText(), 'CARE NOT CONFIGURED');
  for (const name of ['Pet,', 'Feed,', 'Poop,']) {
    assert.equal(await page.getByRole('button', { name: new RegExp(`^${name}`) }).isDisabled(), true, 'Undeployed care never enables a transaction');
  }
  assert.equal(await page.getByRole('button', { name: /^Launch,/ }).isEnabled(), true, 'Launch preview is independent of the care contract');
  assert.equal(await page.getByRole('button', { name: /^Play,/ }).isEnabled(), true, 'Verified Genesis can open Rare Rush');
  assert.equal(await page.locator('.mode-switch').getByRole('button', { name: 'MY WALLET', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: /RESET PREVIEW/ }).count(), 0, 'Preview reset is unavailable for owned Friends');
}
async function assertInvalidated(page) {
  await page.waitForFunction(() => document.querySelector('.habitat-heading h2')?.textContent === 'Choose your Friend');
  assert.equal(await page.locator('.pet-portrait').count(), 0, 'A stale identity cannot remain visible');
  for (const button of await page.locator('.care-action:not(.market-action)').all()) assert.equal(await button.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Buy / Sell', exact: true }).isEnabled(), true, 'Market browsing remains available without an eligible Friend');
}
async function assertClean(page, state) {
  assert.deepEqual(state.errors, [], 'No uncaught browser errors');
  assert.deepEqual(state.consoleErrors, [], 'No browser console errors');
  assert.deepEqual(state.unexpected, [], 'No unexpected external requests');
  assert.deepEqual(state.failures, [], 'Every RPC request follows the fixture contract');
  const methods = await page.evaluate(() => [...window.testWallet.methods]);
  assert(methods.every(method => allowedWalletMethods.includes(method)), `No signatures or transactions: ${methods.join(', ')}`);
}

try {
  for (const [width, height] of [[1100, 900], [390, 844]]) {
    const { page, state } = await fixture(width, height);
    await page.goto(origin);
    await page.getByRole('button', { name: /^Pet,/ }).click();
    await page.getByRole('button', { name: /^Feed,/ }).click();
    await page.getByRole('button', { name: /^Poop,/ }).click();
    assert.equal(state.requests.length, 0, 'Device preview care needs no RPC');
    assert(!(await page.evaluate(() => window.testWallet.methods)).includes('eth_requestAccounts'), 'Preview never asks to connect');
    await page.locator('.nav-arcade').click();
    await page.waitForFunction(() => document.querySelector('.nav-arcade')?.textContent.includes('0x1111'));
    await chooseGenesis(page, state);
    await page.getByRole('button', { name: /CHOOSE FRIEND/ }).click();
    assert.equal(await friendDialog(page).getByRole('button', { name: /DISCONNECT/ }).count(), 0, 'Friend selection contains no disconnect action');
    assert.equal(await friendDialog(page).getByRole('button', { name: 'REFRESH', exact: true }).count(), 1);
    await friendDialog(page).getByRole('button', { name: 'REFRESH', exact: true }).click();
    await assertSelectedGenesis(page);
    await page.getByText('Finding your Friends on Robinhood…', { exact: true }).waitFor({ state: 'detached' });
    await assertSelectedGenesis(page);
    await friendDialog(page).getByRole('button', { name: 'Close dialog', exact: true }).click();
    await assertSelectedGenesis(page);
    for (const dismissal of ['KEEP CONNECTED', 'Close dialog', 'Escape']) {
      await page.getByRole('button', { name: 'Manage connected wallet', exact: true }).click();
      await accountDialog(page).waitFor();
      assert.equal(await accountDialog(page).locator('.wallet-account-address').innerText(), account);
      assert.equal(await friendDialog(page).count(), 0, 'Connected top-right button opens account management instead of Friend selection');
      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else await accountDialog(page).getByRole('button', { name: dismissal, exact: true }).click();
      await accountDialog(page).waitFor({ state: 'detached' });
      await assertSelectedGenesis(page);
      assert.equal(await page.getByRole('button', { name: 'Manage connected wallet', exact: true }).count(), 1, 'Dismissing the modal keeps the wallet connected');
    }
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, 'Dashboard fits viewport');
    const oldBody = await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body');
    await page.getByRole('button', { name: /CHANGE BODY/ }).click();
    const bodyId = await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body');
    assert.notEqual(bodyId, oldBody, 'Owned Genesis can change its cosmetic body');
    const promptsBeforeReload = await connectPrompts(page), readsBeforeReload = state.ownerReads;
    await page.reload();
    await assertSelectedGenesis(page);
    assert.equal(await connectPrompts(page), promptsBeforeReload, 'Reload restores the authorized wallet without eth_requestAccounts');
    assert(state.ownerReads > readsBeforeReload, 'Reload freshly verifies the saved Friend before selecting it');
    assert.equal(await page.getByRole('dialog').count(), 0, 'Successful saved Friend restoration needs no chooser');
    assert.equal(await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body'), bodyId, 'Cosmetic body survives owned Friend restoration');
    assert.deepEqual(await page.evaluate(owner => JSON.parse(localStorage.getItem(`rarepet:owned-friend:v1:4663:${owner}`)), account),
      { collection: 'genesis', tokenId: '1' }, 'Restoration stores only a collection and token hint');
    await page.getByRole('button', { name: /^Play,/ }).click();
    const rush = page.getByRole('dialog');
    await rush.getByRole('button', { name: /LET.S RUSH/ }).waitFor();
    assert.equal(await rush.locator('image[data-genesis-art]').first().getAttribute('href'), portrait);
    assert.equal(await rush.locator('[data-genesis-body]').first().getAttribute('data-genesis-body'), bodyId);
    const beforeRunReads = state.ownerReads;
    await rush.getByRole('button', { name: /LET.S RUSH/ }).click();
    await rush.locator('.rare-rush[data-screen="running"]').waitFor();
    assert(state.ownerReads > beforeRunReads, 'Starting owned Genesis Rush freshly verifies ownership');
    assert.equal(await rush.locator('[data-genesis-body]').first().getAttribute('data-genesis-body'), bodyId, 'The selected body survives run start');
    await rush.getByRole('button', { name: 'Close Rare Rush' }).click();
    await page.locator('.mode-switch').getByRole('button', { name: 'PREVIEW', exact: true }).click();
    await accountDialog(page).waitFor();
    await assertSelectedGenesis(page);
    assert.equal(await page.getByRole('button', { name: /RESET PREVIEW/ }).count(), 0, 'Connected Preview control cannot expose preview care');
    await accountDialog(page).getByRole('button', { name: 'KEEP CONNECTED', exact: true }).click();
    await assertSelectedGenesis(page);
    await page.locator('.mode-switch').getByRole('button', { name: 'PREVIEW', exact: true }).click();
    await accountDialog(page).getByRole('button', { name: 'DISCONNECT WALLET', exact: true }).click();
    await assertPreview(page);
    const previewRequests = state.requests.length;
    await page.getByRole('button', { name: /RESET PREVIEW/ }).click();
    await page.getByRole('button', { name: /^Pet,/ }).click();
    assert.equal(state.requests.length, previewRequests, 'Disconnected preview care needs no RPC or signing');
    const disconnectedPrompts = await connectPrompts(page);
    await page.reload();
    await assertPreview(page);
    assert.equal(await connectPrompts(page), disconnectedPrompts, 'Explicit disconnect survives reload without a new connection request');
    assert.equal(state.requests.length, previewRequests, 'Remembering a disconnect prevents silent onchain discovery');
    const reconnectReads = state.ownerReads;
    await page.locator('.nav-arcade').filter({ hasText: 'CONNECT WALLET' }).click();
    await assertSelectedGenesis(page);
    assert.equal(await connectPrompts(page), disconnectedPrompts + 1, 'Only explicit reconnect prompts for authorization');
    assert(state.ownerReads > reconnectReads, 'Reconnect restores the saved Friend through fresh ownership checks');
    assert.equal(await friendDialog(page).count(), 0, 'Saved Friend returns without manual reselection');

    if (width === 1100) {
      await page.evaluate(() => window.testWallet.network('0x1'));
      await assertInvalidated(page);
      await page.getByRole('button', { name: 'Manage connected wallet', exact: true }).click();
      await accountDialog(page).getByRole('button', { name: 'SWITCH TO ROBINHOOD ↗', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.nav-arcade')?.textContent.includes('0x1111'));
      await accountDialog(page).getByRole('button', { name: 'KEEP CONNECTED', exact: true }).click();
      await assertSelectedGenesis(page);

      await page.getByRole('button', { name: 'Manage connected wallet', exact: true }).click();
      await accountDialog(page).getByRole('button', { name: 'DISCONNECT WALLET', exact: true }).click();
      await assertPreview(page);
      assert.equal(await page.getByRole('dialog').count(), 0, 'Disconnect closes wallet management without opening the chooser');
      await page.locator('.nav-arcade').filter({ hasText: 'CONNECT WALLET' }).click();
      await assertSelectedGenesis(page);

      await page.getByRole('button', { name: 'Manage connected wallet', exact: true }).click();
      await page.evaluate(() => window.testWallet.change(null));
      await assertPreview(page);
      await accountDialog(page).waitFor({ state: 'detached' });
      await page.locator('.nav-arcade').filter({ hasText: 'CONNECT WALLET' }).click();
      await assertSelectedGenesis(page);
      assert.equal(await accountDialog(page).count(), 0, 'An external disconnect cannot resurrect an old account modal after reconnecting');

      await page.getByRole('button', { name: /CHOOSE FRIEND/ }).click();
      await card(page).waitFor();
      let release;
      state.nextOwnerGate = new Promise(resolve => { release = resolve; });
      const priorReads = state.ownerReads;
      await card(page).click();
      await page.getByRole('button', { name: 'VERIFYING…', exact: true }).waitFor();
      await page.waitForTimeout(100);
      assert.equal(state.ownerReads, priorReads + 1, 'Selection reaches the deliberately delayed owner read');
      await page.evaluate(next => window.testWallet.change(next), other);
      await assertInvalidated(page);
      await page.getByText('No Rare Friends found in this wallet.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'VERIFY & SELECT', exact: true }).isEnabled(), true, 'Account change clears a pending selection lock');
      release();
      await page.waitForTimeout(150);
      await assertInvalidated(page);
      await page.evaluate(next => window.testWallet.change(next), account);
      await assertSelectedGenesis(page);
      assert.equal(await friendDialog(page).count(), 0, 'Returning account restores its own saved Friend after an interrupted check');
    }
    await assertClean(page, state);
    await page.close();
    console.log(`${width}px: disconnected preview, silent owned Friend reload, canonical art, undeployed care gates and read-only wallet flow passed`);
  }
  console.log('Wrong-network invalidation, automatic Friend restoration, persistent disconnect and stale pending-selection rejection passed');
} finally {
  await browser.close();
}
