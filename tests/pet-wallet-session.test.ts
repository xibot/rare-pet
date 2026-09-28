import test from 'node:test';
import assert from 'node:assert/strict';
import type { FriendWalletProvider, FriendWalletSession } from '@rarefriends/friendsdk/wallet';
import { createPetWalletSession } from '../games/rare-pet/wallet-session.ts';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const key = 'rarepet:wallet-session:v1';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function target() { return new EventTarget() as EventTarget & { ethereum?: unknown }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function wallet(initialAccounts = [ACCOUNT], initialChain = '0x1237') {
  let accounts = initialAccounts, chain = initialChain;
  const methods: string[] = [], listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let requestHook: ((method: string) => Promise<unknown> | undefined) | undefined;
  const provider: FriendWalletProvider = {
    async request({ method }) {
      methods.push(method);
      const result = requestHook?.(method);
      if (result !== undefined) return result;
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [...accounts];
      if (method === 'eth_chainId') return chain;
      if (method === 'wallet_switchEthereumChain') { chain = '0x1237'; return null; }
      throw new Error(`Unexpected wallet method ${method}`);
    },
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
  };
  return { provider, methods, listeners,
    hook(value: typeof requestHook) { requestHook = value; },
    accounts(value: string[]) { accounts = value; for (const listener of listeners.get('accountsChanged') ?? []) listener(value); },
    chain(value: string) { chain = value; for (const listener of listeners.get('chainChanged') ?? []) listener(value); },
  };
}
function announce(window: EventTarget, provider: FriendWalletProvider, name: string, rdns: string, id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: id, name, rdns }, provider } }));
}

test('startup silently restores an authorized injected wallet and persists provider metadata only', async () => {
  const browser = target(), provider = wallet(), saved = storage(); browser.ethereum = provider.provider;
  const session: FriendWalletSession = createPetWalletSession({ target: browser, storage: saved });
  try {
    await tick();
    assert.equal(session.getSnapshot().status, 'connected');
    assert.equal(session.getSnapshot().account, ACCOUNT);
    assert.deepEqual(provider.methods, ['eth_accounts', 'eth_chainId']);
    assert.deepEqual(JSON.parse(saved.values.get(key)!), { version: 1, disconnected: false, wallet: { kind: 'injected', name: 'Browser wallet' } });
    assert.equal(saved.values.get(key)!.includes(ACCOUNT), false);
  } finally { session.dispose(); }
});

test('explicit disconnect survives reload and announcements; manual connect remains an explicit request', async () => {
  const browser = target(), provider = wallet(), saved = storage(); browser.ethereum = provider.provider;
  const first = createPetWalletSession({ target: browser, storage: saved });
  await tick(); first.disconnect(); first.dispose(); provider.methods.length = 0;
  const restored = createPetWalletSession({ target: browser, storage: saved });
  try {
    announce(browser, provider.provider, 'Wallet', 'io.wallet'); browser.dispatchEvent(new Event('focus'));
    await tick();
    assert.equal(restored.getSnapshot().status, 'disconnected');
    assert.equal(restored.getProvider(), null);
    assert.deepEqual(provider.methods, []);
    assert.deepEqual(JSON.parse(saved.values.get(key)!), { version: 1, disconnected: true });
    await restored.connect();
    assert.equal(restored.getSnapshot().account, ACCOUNT);
    assert.deepEqual(provider.methods, ['eth_requestAccounts', 'eth_chainId']);
    assert.equal(JSON.parse(saved.values.get(key)!).disconnected, false);
  } finally { restored.dispose(); }
});

test('reload restores the selected EIP-6963 wallet by stable metadata despite changed UUID and discovery order', async () => {
  const browser = target(), firstWallet = wallet(), chosenWallet = wallet([OTHER]), saved = storage();
  browser.addEventListener('eip6963:requestProvider', () => {
    announce(browser, firstWallet.provider, 'First', 'io.first');
    announce(browser, chosenWallet.provider, 'Chosen', 'io.chosen', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });
  const first = createPetWalletSession({ target: browser, storage: saved });
  await tick(); await first.connect(first.getSnapshot().wallets.find(choice => choice.name === 'Chosen')!.id); first.dispose();
  firstWallet.methods.length = 0; chosenWallet.methods.length = 0;
  const reload = target(); reload.ethereum = firstWallet.provider;
  const restored = createPetWalletSession({ target: reload, storage: saved });
  try {
    await tick(); assert.equal(restored.getSnapshot().account, null); assert.deepEqual(firstWallet.methods, []);
    announce(reload, chosenWallet.provider, 'Chosen', 'io.chosen', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    await tick();
    assert.equal(restored.getSnapshot().account, OTHER);
    assert.deepEqual(chosenWallet.methods, ['eth_accounts', 'eth_chainId']);
    assert.deepEqual(firstWallet.methods, []);
    assert.equal(JSON.parse(saved.values.get(key)!).wallet.rdns, 'io.chosen');
  } finally { restored.dispose(); }
});

test('injection after initial render restores silently and duplicate announcements preserve one choice', async () => {
  const browser = target(), provider = wallet(), session = createPetWalletSession({ target: browser, storage: storage() });
  try {
    assert.equal(session.getSnapshot().status, 'unavailable');
    browser.ethereum = provider.provider; browser.dispatchEvent(new Event('ethereum#initialized'));
    announce(browser, provider.provider, 'Real wallet name', 'io.real');
    announce(browser, provider.provider, 'Real wallet name', 'io.real');
    await tick();
    assert.equal(session.getSnapshot().status, 'connected');
    assert.equal(session.getSnapshot().wallets.length, 1);
    assert.equal(session.getSnapshot().wallets[0].name, 'Real wallet name');
    assert.deepEqual(provider.methods, ['eth_accounts', 'eth_chainId']);
  } finally { session.dispose(); }
});

test('restoration never prompts or switches networks for wrong-chain, locked, or failed providers', async () => {
  for (const mode of ['wrong-network', 'locked', 'error'] as const) {
    const provider = wallet(mode === 'locked' ? [] : [ACCOUNT], mode === 'wrong-network' ? '0x1' : '0x1237');
    if (mode === 'error') provider.hook(method => method === 'eth_accounts' ? Promise.reject(new Error('Extension unavailable')) : undefined);
    const session = createPetWalletSession({ provider: provider.provider, storage: storage() });
    try {
      await tick();
      assert.equal(session.getSnapshot().status, mode === 'locked' ? 'disconnected' : mode);
      assert(provider.methods.every(method => ['eth_accounts', 'eth_chainId'].includes(method)));
      if (mode === 'wrong-network') { await session.switchNetwork(); assert(provider.methods.includes('wallet_switchEthereumChain')); }
    } finally { session.dispose(); }
  }
});

test('an account change invalidates identity synchronously and late startup results cannot replace the current account', async () => {
  const provider = wallet(), old = deferred<unknown>(); let reads = 0;
  provider.hook(method => method === 'eth_accounts' && reads++ === 0 ? old.promise : undefined);
  const session = createPetWalletSession({ provider: provider.provider, storage: storage() });
  try {
    const revision = session.getSnapshot().revision;
    provider.accounts([OTHER]);
    assert(session.getSnapshot().revision > revision); assert.equal(session.getSnapshot().account, null);
    await tick(); assert.equal(session.getSnapshot().account, OTHER);
    old.resolve([ACCOUNT]); await tick(); assert.equal(session.getSnapshot().account, OTHER);
    const connectedRevision = session.getSnapshot().revision;
    provider.chain('0x1');
    assert(session.getSnapshot().revision > connectedRevision); assert.equal(session.getSnapshot().account, null);
    await tick(); assert.equal(session.getSnapshot().status, 'wrong-network');
  } finally { session.dispose(); }
});

test('manual connect can supersede a pending silent restore without becoming silent itself', async () => {
  const provider = wallet([OTHER]), old = deferred<unknown>();
  provider.hook(method => method === 'eth_accounts' ? old.promise : undefined);
  const session = createPetWalletSession({ provider: provider.provider, storage: storage() });
  try {
    await session.connect();
    assert.equal(session.getSnapshot().account, OTHER);
    assert(provider.methods.includes('eth_requestAccounts'));
    old.resolve([ACCOUNT]); await tick();
    assert.equal(session.getSnapshot().account, OTHER);
  } finally { session.dispose(); }
});

test('disconnect and disposal invalidate pending restores and remove provider/discovery subscriptions', async () => {
  const browser = target(), provider = wallet(), old = deferred<unknown>(), saved = storage(); browser.ethereum = provider.provider;
  provider.hook(method => method === 'eth_accounts' ? old.promise : undefined);
  const session = createPetWalletSession({ target: browser, storage: saved });
  let updates = 0; session.subscribe(() => updates++);
  session.disconnect(); const disconnectedUpdates = updates;
  old.resolve([ACCOUNT]); await tick();
  assert.equal(session.getSnapshot().account, null); assert.equal(updates, disconnectedUpdates);
  session.dispose();
  assert([...provider.listeners.values()].every(listeners => listeners.size === 0));
  const another = wallet(); browser.ethereum = another.provider;
  announce(browser, another.provider, 'Late wallet', 'io.late'); browser.dispatchEvent(new Event('focus'));
  await tick(); assert.deepEqual(another.methods, []);
  assert.equal(session.getSnapshot().status, 'unavailable');
  assert.equal(session.getProvider(), null);
  assert.deepEqual(JSON.parse(saved.values.get(key)!), { version: 1, disconnected: true });
});

test('unavailable or malformed storage cannot block connection and disconnect remains effective in the live session', async () => {
  for (const saved of [{ getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } },
    { getItem() { return '{broken'; }, setItem() {} }]) {
    const browser = target(), provider = wallet(); browser.ethereum = provider.provider;
    const session = createPetWalletSession({ target: browser, storage: saved });
    try {
      await tick(); assert.equal(session.getSnapshot().status, 'connected');
      session.disconnect(); provider.methods.length = 0;
      browser.dispatchEvent(new Event('focus')); await tick();
      assert.equal(session.getSnapshot().account, null); assert.deepEqual(provider.methods, []);
    } finally { session.dispose(); }
  }
});
