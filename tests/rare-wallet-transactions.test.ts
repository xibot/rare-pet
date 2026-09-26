import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hex } from 'viem';
import { createRareWalletTransferStore, type RareWalletTransferRecord } from '../games/rare-pet/rare-wallet-transactions.ts';
import { buildRareWalletTransfer, type RareWalletTransferIntent } from '../games/rare-pet/rare-wallet-transfer.ts';

const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const WALLET = '0x2222222222222222222222222222222222222222' as Address;
const TO = '0x3333333333333333333333333333333333333333' as Address;
const ASSET = '0x4444444444444444444444444444444444444444' as Address;
const HASH = `0x${'a'.repeat(64)}` as Hex;
const BLOCK = `0x${'b'.repeat(64)}` as Hex;
const OTHER_HASH = `0x${'c'.repeat(64)}` as Hex;
const native: RareWalletTransferIntent = { kind: 'native', to: TO, amount: 7n };
const token: RareWalletTransferIntent = { kind: 'erc20', to: TO, contract: ASSET, amount: 7n };
const KEY = 'rarepet:rare-wallet-transfers:v1';
function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function fixture(intent: RareWalletTransferIntent = native) {
  const storage = memoryStorage(), calls: string[] = [];
  const abi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
  const record: RareWalletTransferRecord = { owner: OWNER, intent, hash: HASH, status: 'pending', friendLabel: 'Genesis #2' };
  const changes = { chain: 4663, txError: null as Error | null, receiptError: null as Error | null,
    transaction: { from: OWNER, to: WALLET, value: 0n, input: buildRareWalletTransfer(WALLET, intent).data },
    receipt: { transactionHash: HASH, blockHash: BLOCK, blockNumber: 21n, status: 'success', logs: intent.kind === 'native' ? [] : [{ address: ASSET, topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: WALLET, to: TO } }), data: encodeAbiParameters([{ type: 'uint256' }], [7n]) }] },
    blockHash: BLOCK, gate: null as Promise<void> | null,
  };
  const client = {
    async getChainId() { calls.push('chain'); return changes.chain; },
    async getTransaction() { calls.push('transaction'); if (changes.gate) await changes.gate; if (changes.txError) throw changes.txError; return changes.transaction; },
    async getTransactionReceipt() { calls.push('receipt'); if (changes.receiptError) throw changes.receiptError; return changes.receipt; },
    async getBlock() { calls.push('block'); return { hash: changes.blockHash }; },
  };
  const store = createRareWalletTransferStore({ storage, client: client as never });
  store.setRareWalletTransfer(WALLET, record);
  return { storage, calls, changes, client, record, store, refresh: () => store.refreshRareWalletTransfer(WALLET) };
}
const errorNamed = (name: string) => Object.assign(new Error(name), { name });

test('records survive dialog lifetimes, emit changes and provide stable immutable snapshots', () => {
  const f = fixture(); let updates = 0;
  const unsubscribe = f.store.subscribeRareWalletTransfers(() => updates++);
  const first = f.store.getRareWalletTransfer(WALLET);
  assert.equal(first, f.store.getRareWalletTransfer(WALLET)); assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first!.intent), true);
  f.store.setRareWalletTransfer(WALLET, { ...f.record, status: 'confirmed' }); assert.equal(updates, 1);
  assert.notEqual(first, f.store.getRareWalletTransfer(WALLET));
  unsubscribe(); f.store.setRareWalletTransfer(WALLET, null); assert.equal(updates, 1); assert.equal(f.store.getRareWalletTransfer(WALLET), null);
});
test('session persistence round-trips exact bigints and binds records to their wallet and chain', () => {
  const f = fixture({ ...token, amount: 123456789012345678901234567890n });
  const restored = createRareWalletTransferStore({ storage: f.storage });
  assert.deepEqual(restored.getRareWalletTransfer(WALLET), f.store.getRareWalletTransfer(WALLET));
  assert.equal(restored.getRareWalletTransfer(TO), null);
  const parsed = JSON.parse(f.storage.getItem(KEY)!); parsed.chainId = 1; f.storage.setItem(KEY, JSON.stringify(parsed));
  assert.equal(createRareWalletTransferStore({ storage: f.storage }).getRareWalletTransfer(WALLET), null);
});
test('pending extension prompts remain blocked as unverified after reload', () => {
  const f = fixture(); f.store.setRareWalletTransfer(WALLET, { ...f.record, hash: null, status: 'awaiting-wallet' });
  const restored = createRareWalletTransferStore({ storage: f.storage }).getRareWalletTransfer(WALLET);
  assert.equal(restored?.status, 'unverified'); assert.equal(restored?.hash, null); assert.match(restored?.error ?? '', /wallet’s activity/);
});
test('malformed or mismatched persisted intents are discarded without losing valid records', () => {
  const f = fixture(), parsed = JSON.parse(f.storage.getItem(KEY)!);
  parsed.transfers.push({ ...parsed.transfers[0], wallet: TO, intent: { kind: 'native', to: TO, amount: '7' } });
  parsed.transfers.push({ ...parsed.transfers[0], wallet: ASSET, intent: { kind: 'native', to: TO, amount: '1e18' } });
  f.storage.setItem(KEY, JSON.stringify(parsed));
  const restored = createRareWalletTransferStore({ storage: f.storage });
  assert.ok(restored.getRareWalletTransfer(WALLET)); assert.equal(restored.getRareWalletTransfer(TO), null); assert.equal(restored.getRareWalletTransfer(ASSET), null);
  assert.throws(() => f.store.setRareWalletTransfer(WALLET, { ...f.record, hash: '0x1234' } as never));
  assert.throws(() => f.store.setRareWalletTransfer(WALLET, { ...f.record, status: 'awaiting-wallet' }));
});
test('disabled browser storage still retains live transaction recovery state', () => {
  const storage = { getItem: () => { throw Error('Disabled'); }, setItem: () => { throw Error('Full'); }, removeItem: () => { throw Error('Disabled'); } };
  const store = createRareWalletTransferStore({ storage });
  store.setRareWalletTransfer(WALLET, { owner: OWNER, intent: native, hash: HASH, status: 'pending' });
  assert.equal(store.getRareWalletTransfer(WALLET)?.hash, HASH);
});
test('verbose provider errors cannot prevent persisting a submitted transaction hash', () => {
  const f = fixture(); f.store.setRareWalletTransfer(WALLET, { ...f.record, status: 'unverified', error: 'RPC details '.repeat(1000) });
  const stored = f.store.getRareWalletTransfer(WALLET);
  assert.equal(stored?.hash, HASH); assert.equal(stored?.error?.length, 1000);
});
for (const intent of [native, token]) test(`${intent.kind} recovery verifies exact transaction and receipt using reads only`, async () => {
  const f = fixture(intent), result = await f.refresh();
  assert.equal(result?.status, 'confirmed'); assert.equal(result?.hash, HASH);
  assert.ok(f.calls.includes('transaction') && f.calls.includes('receipt') && f.calls.includes('block'));
  assert.ok(f.calls.every(value => ['chain', 'transaction', 'receipt', 'block'].includes(value)));
});
test('a missing receipt stays pending and never reports a failed or successful transfer', async () => {
  const f = fixture(); f.changes.receiptError = errorNamed('TransactionReceiptNotFoundError');
  assert.equal((await f.refresh())?.status, 'pending'); assert.equal(f.store.getRareWalletTransfer(WALLET)?.hash, HASH);
  f.changes.txError = errorNamed('TransactionNotFoundError');
  assert.equal((await f.refresh())?.status, 'pending');
});
test('reverted receipt becomes failed only after the reviewed transaction and block are verified', async () => {
  const f = fixture(); f.changes.receipt.status = 'reverted';
  assert.equal((await f.refresh())?.status, 'failed');
  const g = fixture(); g.changes.receipt.status = 'reverted'; g.changes.transaction.input = '0x';
  assert.equal((await g.refresh())?.status, 'unverified');
});
test('wrong owner, target, value, calldata, receipt hash, block or chain cannot confirm recovery', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.changes.transaction.from = TO; },
    (f: ReturnType<typeof fixture>) => { f.changes.transaction.to = TO; },
    (f: ReturnType<typeof fixture>) => { f.changes.transaction.value = 1n; },
    (f: ReturnType<typeof fixture>) => { f.changes.transaction.input = '0x'; },
    (f: ReturnType<typeof fixture>) => { f.changes.receipt.transactionHash = OTHER_HASH; },
    (f: ReturnType<typeof fixture>) => { f.changes.blockHash = OTHER_HASH; },
    (f: ReturnType<typeof fixture>) => { f.changes.chain = 1; },
  ]) { const f = fixture(); mutate(f); assert.equal((await f.refresh())?.status, 'unverified'); }
});
test('false ERC20 transfers and read errors remain blocked as unverified', async () => {
  const f = fixture(token); f.changes.receipt.logs = [];
  assert.equal((await f.refresh())?.status, 'unverified');
  const g = fixture(); g.changes.receiptError = Error('RPC unavailable');
  assert.equal((await g.refresh())?.status, 'unverified');
});
test('simultaneous refreshes share reads and a late response cannot overwrite a newer transfer', async () => {
  const f = fixture(); let release!: () => void;
  f.changes.gate = new Promise<void>(resolve => { release = resolve; });
  const first = f.refresh(), second = f.refresh(); assert.equal(first, second);
  const next = { ...f.record, hash: OTHER_HASH, status: 'pending' as const };
  f.store.setRareWalletTransfer(WALLET, next); release(); await first;
  assert.equal(f.store.getRareWalletTransfer(WALLET)?.hash, OTHER_HASH); assert.equal(f.store.getRareWalletTransfer(WALLET)?.status, 'pending');
  assert.equal(f.calls.filter(value => value === 'transaction').length, 1);
});
test('explicit record clearing during recovery is preserved', async () => {
  const f = fixture(); let release!: () => void;
  f.changes.gate = new Promise<void>(resolve => { release = resolve; });
  const task = f.refresh(); f.store.setRareWalletTransfer(WALLET, null); release();
  assert.equal(await task, null); assert.equal(f.store.getRareWalletTransfer(WALLET), null);
});
test('hashless recovery makes no network calls and asks for a wallet activity check', async () => {
  const f = fixture(); f.store.setRareWalletTransfer(WALLET, { ...f.record, hash: null, status: 'awaiting-wallet' });
  const result = await f.refresh(); assert.equal(result?.status, 'unverified'); assert.equal(f.calls.length, 0);
});
