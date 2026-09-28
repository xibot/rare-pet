import { createFriendWalletSession, type FriendWalletProvider, type FriendWalletSessionOptions, type FriendWalletSnapshot } from '@rarefriends/friendsdk/wallet';

const STORAGE_KEY = 'rarepet:wallet-session:v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type WalletHint = { kind: 'injected' | 'supplied' | 'eip6963'; name: string; rdns?: string };
type Preference = { version: 1; disconnected: true } | { version: 1; disconnected: false; wallet: WalletHint };
type Options = FriendWalletSessionOptions & { storage?: Storage | null };
type Entry = { id: string; hint: WalletHint; bridge: FriendWalletProvider; silentConnect: boolean };
const providerLike = (value: unknown): value is FriendWalletProvider => !!value && typeof value === 'object'
  && typeof (value as FriendWalletProvider).request === 'function' && typeof (value as FriendWalletProvider).on === 'function'
  && typeof (value as FriendWalletProvider).removeListener === 'function';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const name = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
const rdns = (value: unknown): value is string => typeof value === 'string' && value.length <= 255 && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value);

function readPreference(storage: Storage | null): Preference | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw || raw.length > 1024) return null;
    const value = JSON.parse(raw);
    if (value?.version !== 1) return null;
    if (value.disconnected === true) return { version: 1, disconnected: true };
    const hint = value.wallet;
    if (value.disconnected !== false || !hint || !['injected', 'supplied', 'eip6963'].includes(hint.kind) || !name(hint.name)
      || hint.rdns !== undefined && !rdns(hint.rdns)) return null;
    return { version: 1, disconnected: false, wallet: { kind: hint.kind, name: hint.name, ...(hint.rdns ? { rdns: hint.rdns } : {}) } };
  } catch { return null; }
}

/** Remember the chosen provider, while FriendSDK retains account, revision and signing lifecycle ownership. */
export function createPetWalletSession(options: Options = {}) {
  const target: FriendWalletSessionOptions['target'] = options.target ?? (typeof window === 'undefined' ? undefined : window);
  let storage: Storage | null = options.storage ?? null;
  if (options.storage === undefined) {
    try { storage = (target as { localStorage?: Storage } | undefined)?.localStorage ?? null; } catch { /* Browser storage may be disabled. */ }
  }
  let preference = readPreference(storage), restore = preference?.disconnected !== true, disposed = false, nextId = 0;
  const entries = new Map<FriendWalletProvider, Entry>(), listeners = new Set<() => void>();
  // The SDK restores the first announced provider. A private discovery target
  // lets us choose the remembered wallet first without replacing its lifecycle.
  const discovery = new EventTarget();
  const session = createFriendWalletSession({ target: discovery });
  session.disconnect();
  let snapshot = session.getSnapshot();
  const save = (value: Preference) => {
    preference = value;
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Live connection still works without persistence. */ }
  };
  const selectedEntry = () => [...entries.values()].find(entry => entry.id === session.getSnapshot().selectedWalletId);
  function publish() {
    const current = session.getSnapshot(), selected = selectedEntry();
    if (current.account && (current.status === 'connected' || current.status === 'wrong-network') && selected) {
      save({ version: 1, disconnected: false, wallet: selected.hint });
    }
    snapshot = Object.freeze({ ...current, wallets: Object.freeze(current.wallets.map(choice =>
      Object.freeze({ id: choice.id, name: [...entries.values()].find(entry => entry.id === choice.id)?.hint.name ?? choice.name }))) });
    for (const listener of listeners) listener();
  }
  const unsubscribe = session.subscribe(publish);
  function preferred(entry: Entry) {
    if (!preference || preference.disconnected) return !preference;
    const hint = preference.wallet;
    return hint.kind === entry.hint.kind && (hint.kind !== 'eip6963' || (hint.rdns ? hint.rdns === entry.hint.rdns : hint.name === entry.hint.name));
  }
  function restoreEntry(entry: Entry) {
    if (!restore || !preferred(entry) || disposed) return;
    restore = false;
    // connect() synchronously starts the SDK request before returning its promise.
    // Only this one selection is silent; subsequent manual connects still prompt.
    entry.silentConnect = true;
    try { void session.connect(entry.id); } finally { entry.silentConnect = false; }
  }
  function add(provider: FriendWalletProvider, hint: WalletHint) {
    if (disposed) return;
    let entry = entries.get(provider);
    if (entry) {
      if (hint.kind === 'eip6963' && (entry.hint.kind !== hint.kind || entry.hint.name !== hint.name || entry.hint.rdns !== hint.rdns)) {
        entry.hint = hint; publish();
      }
      restoreEntry(entry);
      return;
    }
    const added: Entry = {
      id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`, hint, silentConnect: false,
      bridge: {
        request: args => provider.request(added.silentConnect && args.method === 'eth_requestAccounts' ? { ...args, method: 'eth_accounts' } : args),
        on: (event, listener) => provider.on(event, listener),
        removeListener: (event, listener) => provider.removeListener(event, listener),
      },
    };
    entries.set(provider, added);
    discovery.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: added.id, name: hint.name }, provider: added.bridge } }));
    restoreEntry(added);
  }
  function announce(event: Event) {
    try {
      const { info, provider } = (event as CustomEvent).detail ?? {};
      if (!info || !uuid(info.uuid) || !name(info.name) || !providerLike(provider)) return;
      add(provider, { kind: 'eip6963', name: info.name.trim(), ...(rdns(info.rdns) ? { rdns: info.rdns } : {}) });
    } catch { /* Ignore malformed discovery announcements. */ }
  }
  function discover() {
    if (disposed) return;
    if (options.provider) { add(options.provider, { kind: 'supplied', name: 'Connected wallet' }); return; }
    try { if (providerLike(target?.ethereum)) add(target.ethereum, { kind: 'injected', name: 'Browser wallet' }); } catch { /* An unavailable extension must not break the app. */ }
    target?.dispatchEvent(new Event('eip6963:requestProvider'));
  }
  if (options.provider && !providerLike(options.provider)) throw new TypeError('The wallet provider must support EIP-1193 requests and connection events.');
  if (!options.provider) target?.addEventListener('eip6963:announceProvider', announce);
  const discoveryEvents = ['ethereum#initialized', 'load', 'pageshow', 'focus'];
  for (const event of discoveryEvents) target?.addEventListener(event, discover);
  discover();
  // Some extensions inject after the first render without announcing immediately.
  const timers = target && !options.provider ? [100, 500, 1500, 3000, 6000, 10_000].map(delay => setTimeout(discover, delay)) : [];

  return Object.freeze({
    getSnapshot: (): FriendWalletSnapshot => snapshot,
    getProvider: session.getProvider,
    subscribe(listener: () => void) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    async connect(walletId?: string) {
      if (disposed) return snapshot;
      restore = false;
      discover();
      return session.connect(walletId);
    },
    refresh() { if (!disposed) discover(); return session.refresh(); },
    switchNetwork: session.switchNetwork,
    disconnect() {
      if (disposed) return;
      restore = false;
      save({ version: 1, disconnected: true });
      session.disconnect();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      target?.removeEventListener('eip6963:announceProvider', announce);
      for (const event of discoveryEvents) target?.removeEventListener(event, discover);
      unsubscribe(); listeners.clear(); session.dispose(); snapshot = session.getSnapshot(); entries.clear();
    },
  });
}
