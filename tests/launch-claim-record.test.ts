import assert from 'node:assert/strict';
import test from 'node:test';
import type { Address, Hex } from 'viem';
import { createLaunchClaimStore, type LaunchClaimRecord } from '../games/rare-pet/launch-claim-record.ts';
const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const WALLET = '0x2222222222222222222222222222222222222222' as Address;
const ASSET = '0x3333333333333333333333333333333333333333' as Address;
const HASH = `0x${'a'.repeat(64)}` as Hex;
const ID_A = '11111111-1111-4111-8111-111111111111', ID_B = '22222222-2222-4222-8222-222222222222';
const record: LaunchClaimRecord = { requestId: ID_A, mode: 'friend', asset: ASSET, wallet: WALLET, owner: OWNER, hash: HASH, status: 'pending' };
function memory() { let raw = ''; return { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = ''; } }; }
test('pending claim survives reload with exact request and beneficiary identity', () => {
  const storage = memory(); createLaunchClaimStore({ storage }).setLaunchClaim(WALLET, record);
  const store = createLaunchClaimStore({ storage }); assert.deepEqual(store.getLaunchClaim(WALLET), record); assert.equal(store.getLaunchClaim(OWNER), null);
});
test('reload without a hash is unverified; same-page live request stays awaiting', () => {
  const storage = memory(), store = createLaunchClaimStore({ storage });
  store.setLaunchClaim(WALLET, { ...record, hash: null, status: 'awaiting-wallet' }); assert.equal(store.getLaunchClaim(WALLET)?.status, 'awaiting-wallet');
  assert.equal(createLaunchClaimStore({ storage }).getLaunchClaim(WALLET)?.status, 'unverified');
});
test('late prior claim callback cannot replace newer claim of the exact same asset', () => {
  const store = createLaunchClaimStore({ storage: null });
  store.setLaunchClaim(WALLET, { ...record, status: 'confirmed' });
  const second = { ...record, requestId: ID_B, hash: null, status: 'awaiting-wallet' as const };
  store.setLaunchClaim(WALLET, second);
  for (const status of ['confirmed', 'pending', 'unverified', 'failed'] as const) store.setLaunchClaim(WALLET, { ...record, status });
  assert.equal(store.getLaunchClaim(WALLET)?.requestId, ID_B); assert.equal(store.getLaunchClaim(WALLET)?.status, 'awaiting-wallet');
  store.setLaunchClaim(WALLET, { ...second, hash: HASH, status: 'pending' }); assert.equal(store.getLaunchClaim(WALLET)?.status, 'pending');
});
test('duplicate wallet requests cannot replace unresolved claims', () => {
  const store = createLaunchClaimStore({ storage: null }); store.setLaunchClaim(WALLET, record);
  assert.throws(() => store.setLaunchClaim(WALLET, { ...record, requestId: ID_B, hash: null, status: 'awaiting-wallet' }), /unresolved/);
});
test('recovered final status survives a late timeout from the same request', () => {
  const store = createLaunchClaimStore({ storage: null }); store.setLaunchClaim(WALLET, { ...record, status: 'confirmed' });
  store.setLaunchClaim(WALLET, { ...record, status: 'unverified', error: 'late timeout' }); assert.equal(store.getLaunchClaim(WALLET)?.status, 'confirmed');
});
test('capacity evicts confirmed claims and preserves unresolved claims', () => {
  const store = createLaunchClaimStore({ storage: null });
  const account = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
  for (let i = 1; i <= 32; i++) store.setLaunchClaim(account(i), { ...record, wallet: account(i), status: i === 2 ? 'confirmed' : 'pending' });
  store.setLaunchClaim(account(33), { ...record, wallet: account(33) });
  assert.equal(store.getLaunchClaim(account(2)), null); assert.equal(store.getLaunchClaim(account(1))?.status, 'pending'); assert.ok(store.getLaunchClaim(account(33)));
  assert.throws(() => store.setLaunchClaim(account(34), { ...record, wallet: account(34) }), /Too many pending/);
});
test('malformed stored identities, hashes and request ids are rejected', () => {
  for (const changed of [{ ...record, requestId: 'bad' }, { ...record, mode: 'self' }, { ...record, hash: null, status: 'confirmed' }, { ...record, status: 'awaiting-wallet' }]) {
    const storage = memory(); storage.setItem('', JSON.stringify([changed])); assert.equal(createLaunchClaimStore({ storage }).getLaunchClaim(WALLET), null);
  }
});
