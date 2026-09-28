import type { FriendWalletSnapshot } from '@rarefriends/friendsdk/wallet';

/** A restoration hint only. Verify current ownership before using it as a selected Friend. */
export type SavedFriend = Readonly<{ collection: 'genesis' | 'generations'; tokenId: string }>;
type SelectionStorage = Pick<Storage, 'getItem' | 'setItem'>;
const MAX_TOKEN_ID = (1n << 256n) - 1n;

function storageKey(account: string | null | undefined): string | null {
  if (typeof account !== 'string' || !/^0x[0-9a-f]{40}$/i.test(account) || /^0x0{40}$/i.test(account)) return null;
  return `rarepet:owned-friend:v1:4663:${account.toLowerCase()}`;
}
function friendHint(value: unknown): SavedFriend | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const friend = value as Record<string, unknown>;
  if (friend.collection !== 'genesis' && friend.collection !== 'generations' || typeof friend.tokenId !== 'string' ||
    !/^[1-9][0-9]{0,77}$/.test(friend.tokenId) || BigInt(friend.tokenId) > MAX_TOKEN_ID) return null;
  return Object.freeze({ collection: friend.collection, tokenId: friend.tokenId });
}
function browserStorage(): SelectionStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function readSavedFriend(account: string | null | undefined, storage?: SelectionStorage): SavedFriend | null {
  const key = storageKey(account);
  if (!key) return null;
  try {
    const saved = (storage ?? browserStorage())?.getItem(key);
    if (typeof saved !== 'string' || saved.length > 256) return null;
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'collection') || !Object.hasOwn(value, 'tokenId')) return null;
    return friendHint(value);
  } catch { return null; }
}

export function saveSelectedFriend(account: string | null | undefined, friend: SavedFriend, storage?: SelectionStorage): void {
  const key = storageKey(account);
  if (!key) return;
  try {
    const hint = friendHint(friend);
    if (hint) (storage ?? browserStorage())?.setItem(key, JSON.stringify(hint));
  } catch { /* Restoring a selection is optional when browser storage is unavailable. */ }
}

/** Connection transitions and retained accounts must not expose actionable preview care. */
export function isWalletMode(snapshot: Pick<FriendWalletSnapshot, 'status' | 'account'>): boolean {
  return !!snapshot.account || snapshot.status === 'connected' || snapshot.status === 'wrong-network' ||
    snapshot.status === 'connecting' || snapshot.status === 'switching-network';
}
