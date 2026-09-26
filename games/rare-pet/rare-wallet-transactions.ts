import { getAddress, isAddress, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';
import { buildRareWalletTransfer, verifyRareWalletTransferReceipt, verifyRareWalletTransferTransaction, RareWalletTransferError, type RareWalletTransferIntent } from './rare-wallet-transfer.ts';

export type RareWalletTransferStatus = 'awaiting-wallet' | 'pending' | 'confirmed' | 'failed' | 'unverified';
export type RareWalletTransferRecord = Readonly<{
  owner: Address;
  intent: RareWalletTransferIntent;
  hash: Hex | null;
  status: RareWalletTransferStatus;
  friendLabel?: string;
  error?: string;
}>;
type RecoveryClient = Pick<PublicClient, 'getChainId' | 'getTransaction' | 'getTransactionReceipt' | 'getBlock'>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StoreOptions = { storage?: Storage | null; client?: RecoveryClient };
const KEY = 'rarepet:rare-wallet-transfers:v1';
const CHAIN_ID = 4663;
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const statusValues: readonly RareWalletTransferStatus[] = ['awaiting-wallet', 'pending', 'confirmed', 'failed', 'unverified'];
const hashValid = (value: unknown): value is Hex => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value);
function account(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || equal(value, zeroAddress)) throw new Error('Invalid transfer account.');
  return getAddress(value.toLowerCase());
}
function label(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid transfer text.');
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
}
function quantity(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error('Invalid saved transfer amount.');
  return BigInt(value);
}
function checkedRecord(wallet: Address, value: unknown): RareWalletTransferRecord {
  if (!object(value) || !object(value.intent) || !statusValues.includes(value.status as RareWalletTransferStatus) || value.hash !== null && !hashValid(value.hash)) throw new Error('Invalid saved transfer.');
  if (value.status === 'awaiting-wallet' && value.hash !== null || ['pending', 'confirmed'].includes(value.status as string) && !value.hash) throw new Error('Invalid transfer status.');
  const source = value.intent, to = account(source.to);
  let intent: RareWalletTransferIntent;
  switch (source.kind) {
    case 'native': intent = { kind: 'native', to, amount: quantity(source.amount) }; break;
    case 'erc20': intent = { kind: 'erc20', to, contract: account(source.contract), amount: quantity(source.amount) }; break;
    case 'erc721': intent = { kind: 'erc721', to, contract: account(source.contract), tokenId: quantity(source.tokenId) }; break;
    case 'erc1155': intent = { kind: 'erc1155', to, contract: account(source.contract), tokenId: quantity(source.tokenId), amount: quantity(source.amount) }; break;
    default: throw new Error('Invalid saved transfer asset.');
  }
  return Object.freeze({ owner: account(value.owner), intent: buildRareWalletTransfer(wallet, intent).intent,
    hash: value.hash as Hex | null, status: value.status as RareWalletTransferStatus,
    friendLabel: label(value.friendLabel, 120), error: label(value.error, 1000) });
}
const notFound = (error: unknown, name: string) => error instanceof Error && error.name === name;

/** Records survive dialog unmounts and this tab's reloads; recovery never submits a transaction. */
export function createRareWalletTransferStore(options: StoreOptions = {}) {
  const records = new Map<string, RareWalletTransferRecord>();
  const listeners = new Set<() => void>();
  const refreshing = new Map<string, Promise<RareWalletTransferRecord | null>>();
  let loaded = false;
  const storage = (): Storage | null => {
    if (Object.hasOwn(options, 'storage')) return options.storage ?? null;
    try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
  };
  function save() {
    try {
      const target = storage(); if (!target) return;
      if (!records.size) { target.removeItem(KEY); return; }
      target.setItem(KEY, JSON.stringify({ version: 1, chainId: CHAIN_ID, transfers: [...records].map(([wallet, record]) => ({ wallet, ...record })) }, (_, value) => typeof value === 'bigint' ? String(value) : value));
    } catch { /* In-memory recovery remains available if browser storage is full or disabled. */ }
  }
  function load() {
    if (loaded) return; loaded = true;
    try {
      const raw = storage()?.getItem(KEY); if (!raw || raw.length > 500_000) return;
      const parsed: unknown = JSON.parse(raw);
      if (!object(parsed) || parsed.version !== 1 || parsed.chainId !== CHAIN_ID || !Array.isArray(parsed.transfers) || parsed.transfers.length > 256) return;
      for (const value of parsed.transfers) {
        try {
          if (!object(value)) continue;
          const wallet = account(value.wallet), record = checkedRecord(wallet, value);
          // A reloaded tab cannot know whether an old extension prompt was approved.
          records.set(wallet.toLowerCase(), record.status === 'awaiting-wallet' ? Object.freeze({ ...record, status: 'unverified', error: 'No transaction hash was returned before this page reloaded. Check your owner wallet’s activity before sending again.' }) : record);
        } catch { /* One corrupt record must not discard other valid pending transfers. */ }
      }
      save();
    } catch { /* Untrusted/malformed browser state never becomes a transaction request. */ }
  }
  function get(wallet: Address | null | undefined): RareWalletTransferRecord | null {
    load(); if (!wallet) return null;
    try { return records.get(account(wallet).toLowerCase()) ?? null; } catch { return null; }
  }
  function set(wallet: Address, value: RareWalletTransferRecord | null) {
    load(); const verified = account(wallet), key = verified.toLowerCase();
    if (value === null) records.delete(key);
    else records.set(key, checkedRecord(verified, { ...value, friendLabel: value.friendLabel?.slice(0, 120), error: value.error?.slice(0, 1000) }));
    save(); for (const listener of listeners) listener();
  }
  function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
  function refresh(wallet: Address): Promise<RareWalletTransferRecord | null> {
    const key = account(wallet).toLowerCase();
    const pending = refreshing.get(key); if (pending) return pending;
    const task = recover(wallet).finally(() => { if (refreshing.get(key) === task) refreshing.delete(key); });
    refreshing.set(key, task); return task;
  }
  async function recover(wallet: Address): Promise<RareWalletTransferRecord | null> {
    const previous = get(wallet); if (!previous) return null;
    const commit = (update: Partial<RareWalletTransferRecord>) => {
      // A late recovery response cannot overwrite a new transfer or an explicit dismissal.
      if (get(wallet) !== previous) return get(wallet);
      set(wallet, { ...previous, ...update }); return get(wallet);
    };
    if (!previous.hash) return commit({ status: 'unverified', error: 'No transaction hash is available. Check your owner wallet’s activity before sending again.' });
    try {
      const client = options.client ?? (await import('./wallet')).createPetPublicClient();
      if (await client.getChainId() !== CHAIN_ID) throw new Error('Recovery requires Robinhood Chain.');
      const [transaction, receipt] = await Promise.allSettled([
        client.getTransaction({ hash: previous.hash }), client.getTransactionReceipt({ hash: previous.hash }),
      ]);
      if (transaction.status === 'rejected' && !notFound(transaction.reason, 'TransactionNotFoundError')) throw transaction.reason;
      if (receipt.status === 'rejected' && !notFound(receipt.reason, 'TransactionReceiptNotFoundError')) throw receipt.reason;
      if (transaction.status === 'fulfilled') verifyRareWalletTransferTransaction(transaction.value, previous.owner, wallet, previous.intent);
      if (receipt.status === 'rejected') return commit({ status: 'pending', error: 'This transaction is not confirmed yet. Check again before sending another transfer.' });
      if (transaction.status !== 'fulfilled') throw new Error('The receipt exists, but its reviewed transaction could not be verified.');
      const block = await client.getBlock({ blockNumber: receipt.value.blockNumber });
      if (!block.hash || !equal(block.hash, receipt.value.blockHash) || await client.getChainId() !== CHAIN_ID) throw new Error('The receipt block could not be verified.');
      try { verifyRareWalletTransferReceipt(receipt.value, previous.hash, wallet, previous.intent); }
      catch (cause) {
        if (cause instanceof RareWalletTransferError && cause.code === 'reverted') return commit({ status: 'failed', error: 'The transfer reverted onchain. No successful transfer was confirmed.' });
        throw cause;
      }
      return commit({ status: 'confirmed', error: undefined });
    } catch {
      return commit({ status: 'unverified', error: 'The transfer could not be fully verified. Inspect its transaction on Robinhood before sending again.' });
    }
  }
  return { getRareWalletTransfer: get, setRareWalletTransfer: set, subscribeRareWalletTransfers: subscribe, refreshRareWalletTransfer: refresh };
}

export const {
  getRareWalletTransfer, setRareWalletTransfer, subscribeRareWalletTransfers, refreshRareWalletTransfer,
} = createRareWalletTransferStore();
