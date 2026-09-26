import { isAddress, zeroAddress, type Address, type Hex } from 'viem';
export type LaunchClaimRecord = Readonly<{
  requestId: string; mode: 'self' | 'friend'; asset: Address; wallet: Address; owner: Address;
  hash: Hex | null; status: 'awaiting-wallet' | 'pending' | 'confirmed' | 'failed' | 'unverified'; error?: string;
}>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'rarepet:launch-claims:v1';
const unresolved = (status: LaunchClaimRecord['status']) => ['awaiting-wallet', 'pending', 'unverified'].includes(status);
function valid(value: unknown): value is LaunchClaimRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as LaunchClaimRecord;
  return typeof item.requestId === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(item.requestId)
    && ['self', 'friend'].includes(item.mode) && [item.asset, item.wallet, item.owner].every(a => typeof a === 'string' && isAddress(a) && a.toLowerCase() !== zeroAddress)
    && (item.mode !== 'self' || item.owner.toLowerCase() === item.wallet.toLowerCase())
    && ['awaiting-wallet', 'pending', 'confirmed', 'failed', 'unverified'].includes(item.status)
    && (item.hash === null ? ['awaiting-wallet', 'unverified'].includes(item.status) : item.status !== 'awaiting-wallet' && /^0x[0-9a-f]{64}$/i.test(item.hash))
    && (item.error === undefined || typeof item.error === 'string' && item.error.length <= 1000);
}
/** Request identity separates repeat claims of the same asset from late provider responses. */
export function createLaunchClaimStore(options: { storage?: Storage | null } = {}) {
  const records = new Map<string, LaunchClaimRecord>(), listeners = new Set<() => void>();
  let loaded = false;
  const storage = (): Storage | null => {
    if (Object.hasOwn(options, 'storage')) return options.storage ?? null;
    try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
  };
  function save() {
    try { const target = storage(); if (!target) return; if (!records.size) target.removeItem(KEY); else target.setItem(KEY, JSON.stringify([...records.values()])); }
    catch { /* Retain the record in this tab when browser storage is disabled or full. */ }
  }
  function load() {
    if (loaded) return; loaded = true;
    try {
      const raw = storage()?.getItem(KEY); if (!raw || raw.length > 100_000) return;
      const values: unknown = JSON.parse(raw); if (!Array.isArray(values) || values.length > 32) return;
      for (const item of values) if (valid(item)) records.set(item.wallet.toLowerCase(), Object.freeze(item.status === 'awaiting-wallet'
        ? { ...item, status: 'unverified', error: 'Check your wallet activity before another claim. No hash was returned before reload.' } : item));
    } catch { /* Browser storage is never a confirmation or signing authority. */ }
  }
  function get(wallet: Address | null) { load(); return wallet ? records.get(wallet.toLowerCase()) ?? null : null; }
  function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
  function set(wallet: Address, value: LaunchClaimRecord | null) {
    load(); const key = wallet.toLowerCase();
    if (!value) records.delete(key);
    else {
      if (!valid(value) || value.wallet.toLowerCase() !== key) throw new Error('Invalid fee claim record.');
      const previous = records.get(key);
      // Only a deliberate new wallet request may replace a completed request's identity.
      if (previous && previous.requestId !== value.requestId && value.status !== 'awaiting-wallet') return;
      if (previous && value.status === 'awaiting-wallet' && unresolved(previous.status)) throw new Error('This creator already has an unresolved fee claim.');
      if (previous?.requestId === value.requestId && previous.hash && previous.hash === value.hash && ['confirmed', 'failed'].includes(previous.status) && unresolved(value.status)) return;
      if (!previous && records.size >= 32) {
        const finalized = [...records].find(([, item]) => ['confirmed', 'failed'].includes(item.status));
        if (finalized) records.delete(finalized[0]); else throw new Error('Too many pending claims. Resolve an existing claim first.');
      }
      records.set(key, Object.freeze({ ...value, error: value.error?.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '') }));
    }
    save(); for (const listener of listeners) listener();
  }
  return { getLaunchClaim: get, subscribeLaunchClaims: subscribe, setLaunchClaim: set };
}
export const { getLaunchClaim, subscribeLaunchClaims, setLaunchClaim } = createLaunchClaimStore();
