import { isAddress, zeroAddress, type Address, type Hex } from 'viem';
import { confirmRareLaunch, confirmRareSelfLaunch, RareLaunchTransactionError, validateStoredRareLaunch, validateStoredRareSelfLaunch, type PreparedRareLaunchTransaction } from './launch-doppler.ts';

export type RareLaunchTransactionStatus = 'awaiting-wallet' | 'pending' | 'unverified' | 'confirmed' | 'failed';
export type RareLaunchTransactionRecord = Readonly<{
  hash: Hex | null; status: RareLaunchTransactionStatus; prepared: PreparedRareLaunchTransaction; error?: string;
}>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Options = { storage?: Storage | null; confirm?: (hash: Hex, prepared: PreparedRareLaunchTransaction) => Promise<unknown> };
const KEY = 'rarepet:launch-transactions:v1';
const STATUSES = ['awaiting-wallet', 'pending', 'unverified', 'confirmed', 'failed'];
const MAX_JSON = 2_000_000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): value is Hex => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value);
function walletKey(wallet: Address): string {
  if (!isAddress(wallet) || wallet.toLowerCase() === zeroAddress) throw new Error('Invalid Rare Wallet.');
  return wallet.toLowerCase();
}
function checked(wallet: Address, record: unknown): RareLaunchTransactionRecord {
  if (!object(record) || !STATUSES.includes(record.status as string) || record.hash !== null && !hash(record.hash)
    || record.status === 'awaiting-wallet' && record.hash !== null || ['pending', 'confirmed'].includes(record.status as string) && !record.hash) throw new Error('Invalid saved launch status.');
  if (record.error !== undefined && (typeof record.error !== 'string' || record.error.length > 1000)) throw new Error('Invalid saved launch error.');
  const prepared = object(record.prepared) && record.prepared.mode === 'self' ? validateStoredRareSelfLaunch(wallet, record.prepared) : validateStoredRareLaunch(wallet, record.prepared);
  return Object.freeze({ hash: record.hash as Hex | null, status: record.status as RareLaunchTransactionStatus, prepared,
    error: typeof record.error === 'string' ? record.error.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '') : undefined });
}
function revive(_key: string, value: unknown): unknown {
  if (object(value) && Object.hasOwn(value, '$bigint')) {
    if (Object.keys(value).length !== 1 || typeof value.$bigint !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value.$bigint)) throw new Error('Invalid saved integer.');
    const parsed = BigInt(value.$bigint); if (parsed >= 1n << 256n) throw new Error('Invalid saved integer.'); return parsed;
  }
  return value;
}
/** A tab reload preserves exact review proof. Recovery only reads receipts, never signs or retries. */
export function createRareLaunchTransactionStore(options: Options = {}) {
  const records = new Map<string, RareLaunchTransactionRecord>(), listeners = new Set<() => void>();
  const refreshing = new Map<string, Promise<RareLaunchTransactionRecord | null>>();
  let loaded = false;
  const storage = (): Storage | null => {
    if (Object.hasOwn(options, 'storage')) return options.storage ?? null;
    try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
  };
  function save() {
    try {
      const target = storage(); if (!target) return;
      if (!records.size) { target.removeItem(KEY); return; }
      const payload = JSON.stringify({ version: 1, chainId: 4663, records: [...records].map(([wallet, record]) => ({ wallet, ...record,
        prepared: record.prepared.mode === 'self' ? record.prepared : { ...record.prepared, pet: { ...record.prepared.pet, image: '', sprites: undefined } },
      })) }, (_key, value) => typeof value === 'bigint' ? { $bigint: value.toString() } : value);
      if (payload.length <= MAX_JSON) target.setItem(KEY, payload);
    } catch { /* The current tab still retains its pending transaction if storage is unavailable. */ }
  }
  function load() {
    if (loaded) return; loaded = true;
    try {
      const raw = storage()?.getItem(KEY); if (!raw || raw.length > MAX_JSON) return;
      const parsed: unknown = JSON.parse(raw, revive);
      if (!object(parsed) || parsed.version !== 1 || parsed.chainId !== 4663 || !Array.isArray(parsed.records) || parsed.records.length > 32) return;
      for (const value of parsed.records) {
        try {
          if (!object(value) || typeof value.wallet !== 'string') continue;
          const wallet = value.wallet as Address, key = walletKey(wallet), record = checked(wallet, value);
          records.set(key, record.status === 'awaiting-wallet'
            ? Object.freeze({ ...record, status: 'unverified', error: 'No hash was returned before reload. Check the owner wallet’s activity before another launch.' }) : record);
        } catch { /* Malformed records do not become signing or confirmation requests. */ }
      }
      save();
    } catch { /* Untrusted browser storage is never sufficient proof of a launch. */ }
  }
  function get(wallet: Address | null | undefined): RareLaunchTransactionRecord | null {
    load(); if (!wallet) return null;
    try { return records.get(walletKey(wallet)) ?? null; } catch { return null; }
  }
  function set(wallet: Address, record: RareLaunchTransactionRecord | null) {
    load(); const key = walletKey(wallet);
    if (!record) records.delete(key);
    else {
      const current = records.get(key);
      // A late initial waiter cannot downgrade a receipt already recovered to its final status.
      if (current?.hash && current.hash === record.hash && ['confirmed', 'failed'].includes(current.status) && ['pending', 'unverified', 'awaiting-wallet'].includes(record.status)) return;
      // Starting a fresh review is explicit; late callbacks from an older review cannot replace it.
      if (current && record.status !== 'awaiting-wallet' && current.prepared.data !== record.prepared.data) return;
      if (current && record.status === 'awaiting-wallet' && ['awaiting-wallet', 'pending', 'unverified'].includes(current.status)) throw new Error('This creator already has an unresolved launch.');
      if (!current && records.size >= 32) {
        const finalized = [...records].find(([, item]) => ['confirmed', 'failed'].includes(item.status));
        if (finalized) records.delete(finalized[0]);
        else throw new Error('Too many pending launch records. Resolve an existing transaction first.');
      }
      const normalized = checked(wallet, { ...record, error: record.error?.slice(0, 1000) });
      records.set(key, normalized);
    }
    save(); for (const listener of listeners) listener();
  }
  function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
  function refresh(wallet: Address) {
    const key = walletKey(wallet), existing = refreshing.get(key); if (existing) return existing;
    const promise = recover(wallet).finally(() => { if (refreshing.get(key) === promise) refreshing.delete(key); });
    refreshing.set(key, promise); return promise;
  }
  async function recover(wallet: Address): Promise<RareLaunchTransactionRecord | null> {
    const previous = get(wallet); if (!previous) return null;
    const commit = (update: Partial<RareLaunchTransactionRecord>) => {
      if (get(wallet) !== previous) return get(wallet);
      records.set(walletKey(wallet), checked(wallet, { ...previous, ...update }));
      save(); for (const listener of listeners) listener(); return get(wallet);
    };
    if (!previous.hash) return commit({ status: 'unverified', error: 'No hash is available. Check your owner wallet’s activity before sending another launch.' });
    try {
      if (options.confirm) await options.confirm(previous.hash, previous.prepared);
      else if (previous.prepared.mode === 'self') await confirmRareSelfLaunch(previous.hash, previous.prepared);
      else await confirmRareLaunch(previous.hash, previous.prepared);
      return commit({ status: 'confirmed', error: undefined });
    } catch (error) {
      if (error instanceof RareLaunchTransactionError && error.code === 'reverted') return commit({ status: 'failed', error: error.message });
      if (error instanceof RareLaunchTransactionError && error.code === 'unconfirmed') return commit({ status: 'pending', error: error.message });
      return commit({ status: 'unverified', error: 'The submitted launch could not be fully verified. Inspect its transaction before launching again.' });
    }
  }
  return { getRareLaunchTransaction: get, setRareLaunchTransaction: set, subscribeRareLaunchTransactions: subscribe, refreshRareLaunchTransaction: refresh };
}
export const { getRareLaunchTransaction, setRareLaunchTransaction, subscribeRareLaunchTransactions, refreshRareLaunchTransaction } = createRareLaunchTransactionStore();
