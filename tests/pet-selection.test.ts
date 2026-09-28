import test from 'node:test';
import assert from 'node:assert/strict';
import type { FriendWalletSnapshot } from '@rarefriends/friendsdk/wallet';
import { isWalletMode, readSavedFriend, saveSelectedFriend, type SavedFriend } from '../games/rare-pet/selection.ts';

const OWNER = '0x1234567890abcdef1234567890abcdef12345678';
const OTHER = '0x2222222222222222222222222222222222222222';
const key = (account = OWNER) => `rarepet:owned-friend:v1:4663:${account.toLowerCase()}`;
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value); } };
}

test('owned Friend hints are account-scoped, case-insensitive and fixed to chain 4663', () => {
  const saved = storage();
  saveSelectedFriend(OWNER.toUpperCase(), { collection: 'genesis', tokenId: '42' }, saved);
  assert.deepEqual(readSavedFriend(OWNER, saved), { collection: 'genesis', tokenId: '42' });
  assert.equal(readSavedFriend(OTHER, saved), null);
  saveSelectedFriend(OTHER, { collection: 'generations', tokenId: '106' }, saved);
  assert.deepEqual(readSavedFriend(OTHER.toUpperCase(), saved), { collection: 'generations', tokenId: '106' });
  assert.deepEqual(readSavedFriend(OWNER, saved), { collection: 'genesis', tokenId: '42' });
  assert.deepEqual([...saved.values.keys()], [key(), key(OTHER)]);
  saved.values.delete(key());
  saved.values.set(key().replace(':4663:', ':1:'), JSON.stringify({ collection: 'genesis', tokenId: '42' }));
  assert.equal(readSavedFriend(OWNER, saved), null);
});

test('saving a verified identity persists only the collection and token ID, never traits or trust', () => {
  const saved = storage();
  const identity = { collection: 'genesis' as const, tokenId: '42', owner: OWNER, account: OWNER, chainId: 4663,
    image: 'data:image/svg+xml,untrusted', kinship: 999999, verified: true, walletAddress: OTHER };
  saveSelectedFriend(OWNER, identity, saved);
  assert.equal(saved.values.get(key()), '{"collection":"genesis","tokenId":"42"}');
  const hint = readSavedFriend(OWNER, saved);
  assert.deepEqual(hint, { collection: 'genesis', tokenId: '42' }); assert(Object.isFrozen(hint));
});

test('positive uint256 boundaries round-trip and noncanonical or overflowing token IDs are rejected', () => {
  const saved = storage(), maximum = ((1n << 256n) - 1n).toString();
  for (const tokenId of ['1', maximum]) {
    saveSelectedFriend(OWNER, { collection: 'generations', tokenId }, saved);
    assert.deepEqual(readSavedFriend(OWNER, saved), { collection: 'generations', tokenId });
  }
  const unchanged = saved.values.get(key());
  for (const tokenId of ['0', '-1', '01', '+1', '1.0', '1e2', '0x2a', ' 42', '42 ', '', (1n << 256n).toString(), '9'.repeat(79), 42, null]) {
    saveSelectedFriend(OWNER, { collection: 'genesis', tokenId } as SavedFriend, saved);
    assert.equal(saved.values.get(key()), unchanged);
    const tampered = storage(); tampered.values.set(key(), JSON.stringify({ collection: 'genesis', tokenId }));
    assert.equal(readSavedFriend(OWNER, tampered), null);
  }
});

test('invalid accounts never read or write storage', () => {
  const unexpected = { getItem: () => assert.fail('Must not read'), setItem: () => assert.fail('Must not write') };
  for (const account of [undefined, null, '', '0x123', `0x${'0'.repeat(40)}`, `0x${'g'.repeat(40)}`, ` ${OWNER}`, `${OWNER} `, `${OWNER}/42`]) {
    assert.equal(readSavedFriend(account, unexpected), null);
    assert.doesNotThrow(() => saveSelectedFriend(account, { collection: 'genesis', tokenId: '42' }, unexpected));
  }
});

test('tampered hints, unexpected fields, malformed JSON and oversized storage are discarded', () => {
  const saved = storage();
  for (const value of [null, [], 'genesis:42', {}, { collection: 'genesis' }, { tokenId: '42' },
    { collection: 'other', tokenId: '42' }, { collection: 'Genesis', tokenId: '42' },
    { collection: 'genesis', tokenId: '42', verified: true }, { collection: 'genesis', tokenId: '42', account: OTHER },
    { collection: 'genesis', tokenId: '42', chainId: 1 }, { collection: 'genesis', tokenId: '42', image: 'untrusted' },
    { collection: 'genesis', tokenId: '42', traits: { kinship: 99 } },
  ]) {
    saved.values.set(key(), JSON.stringify(value)); assert.equal(readSavedFriend(OWNER, saved), null);
  }
  for (const raw of ['{invalid', '', ' '.repeat(257), '{"collection":"genesis","tokenId":"42","__proto__":{"verified":true}}']) {
    saved.values.set(key(), raw); assert.equal(readSavedFriend(OWNER, saved), null);
  }
});

test('storage read, write and browser storage getter errors are tolerated', () => {
  const unavailable = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.equal(readSavedFriend(OWNER, unavailable), null);
  assert.doesNotThrow(() => saveSelectedFriend(OWNER, { collection: 'genesis', tokenId: '42' }, unavailable));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new Error('Storage blocked'); } } });
    assert.equal(readSavedFriend(OWNER), null);
    assert.doesNotThrow(() => saveSelectedFriend(OWNER, { collection: 'genesis', tokenId: '42' }));
    const saved = storage();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: saved } });
    saveSelectedFriend(OWNER, { collection: 'genesis', tokenId: '42' });
    assert.deepEqual(readSavedFriend(OWNER), { collection: 'genesis', tokenId: '42' });
    Reflect.deleteProperty(globalThis, 'window');
    assert.equal(readSavedFriend(OWNER), null);
    assert.doesNotThrow(() => saveSelectedFriend(OWNER, { collection: 'genesis', tokenId: '42' }));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('wallet connection transitions never switch to actionable preview mode', () => {
  const statuses: FriendWalletSnapshot['status'][] = ['unavailable', 'disconnected', 'connecting', 'switching-network', 'connected', 'wrong-network', 'error'];
  for (const status of statuses) {
    assert.equal(isWalletMode({ status, account: OWNER }), true, `retained account in ${status}`);
    assert.equal(isWalletMode({ status, account: null }), ['connecting', 'switching-network', 'connected', 'wrong-network'].includes(status), status);
  }
  const lifecycle: Pick<FriendWalletSnapshot, 'status' | 'account'>[] = [
    { status: 'connecting', account: null }, { status: 'wrong-network', account: OWNER },
    { status: 'switching-network', account: OWNER }, { status: 'connecting', account: null }, { status: 'connected', account: OWNER },
  ];
  assert(lifecycle.every(isWalletMode));
});
