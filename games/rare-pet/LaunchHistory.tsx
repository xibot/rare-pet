import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatUnits, type Address, type Hex } from 'viem';
import { PET_DEPLOYMENT, type PetIdentity, type PetWalletSession } from './wallet';
import { LAUNCH_QUOTE_ASSETS } from './launch-quotes';
import { readRareLaunchHistory, readRareSelfLaunchHistory, readRareLaunchFees, claimRareLaunchFees, claimRareSelfLaunchFees, confirmRareLaunchFeeClaim, RareLaunchTransactionError, type RareLaunchHistoryItem, type RareLaunchPendingFees } from './launch-doppler';
import { getLaunchClaim, setLaunchClaim, subscribeLaunchClaims, type LaunchClaimRecord } from './launch-claim-record';
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Fees are unavailable. Please refresh.';
const short = (value: string) => `${value.slice(0,8)}…${value.slice(-6)}`;
export function LaunchHistory({ mode, creator, pet, session, revision, router, refresh }: {
  mode: 'self' | 'friend'; creator: Address; pet: PetIdentity | null; session: PetWalletSession; revision: number; router: Address; refresh: Hex | null;
}) {
  const alive = useRef(true), locked = useRef(false);
  const [items, setItems] = useState<readonly RareLaunchHistoryItem[]>([]), [loading, setLoading] = useState(false), [reload, setReload] = useState(0);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [fees, setFees] = useState<RareLaunchPendingFees | null>(null), [selected, setSelected] = useState<RareLaunchHistoryItem | null>(null);
  const record = useSyncExternalStore(subscribeLaunchClaims, () => getLaunchClaim(creator));
  const unresolved = !!record && ['awaiting-wallet','pending','unverified'].includes(record.status);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    const read = mode === 'self' ? readRareSelfLaunchHistory({ router, account: creator, signal: abort.signal }) : readRareLaunchHistory({ router, pet: pet!, signal: abort.signal });
    void read.then(result => { if (!abort.signal.aborted) setItems(result.items); }).catch(cause => { if (!abort.signal.aborted) setError(message(cause)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [creator, router, mode, pet, refresh, reload]);
  function assertActive() {
    const snapshot = session.getSnapshot();
    if (!alive.current || snapshot.revision !== revision || snapshot.status !== 'connected' || snapshot.account?.toLowerCase() !== (mode === 'self' ? creator : pet?.owner)?.toLowerCase()) throw new Error('Your wallet changed. Open Launch again.');
  }
  async function inspect(item: RareLaunchHistoryItem) {
    if (locked.current || unresolved) return;
    locked.current = true; setBusy(true); setError(''); setFees(null); setSelected(item);
    try { const value = await readRareLaunchFees({ asset: item.asset, wallet: creator }); if (alive.current) setFees(value); }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function claim() {
    if (!fees || !selected || locked.current || unresolved) return;
    locked.current = true; setBusy(true); setError(''); setStatus('Confirm the fee claim in your wallet.');
    const owner = mode === 'self' ? creator : pet!.owner;
    const pending: LaunchClaimRecord = { requestId: crypto.randomUUID(), mode, asset: selected.asset, wallet: creator, owner, hash: null, status: 'awaiting-wallet' };
    let hash: Hex | null = null; let requested = false, recorded = false;
    try {
      setLaunchClaim(creator, pending); recorded = true;
      const options = { session, revision, asset: selected.asset, assertActive, onWalletRequest: () => { requested = true; }, onHash: (value: Hex) => { hash = value; setLaunchClaim(creator, { ...pending, hash, status: 'pending' }); if (alive.current) setStatus('Fee claim submitted…'); } };
      const result = await (mode === 'self' ? claimRareSelfLaunchFees({ ...options, account: creator }) : claimRareLaunchFees({ ...options, pet: pet! }));
      setLaunchClaim(creator, { ...pending, hash: result.hash, status: 'confirmed' });
      if (alive.current) { setFees(null); setSelected(null); setStatus('Fees confirmed in your creator wallet.'); }
    } catch (cause) {
      const text = message(cause);
      if (recorded) setLaunchClaim(creator, !hash && (!requested || /user rejected|user denied|rejected the request/i.test(text)) ? null : { ...pending, hash, status: cause instanceof RareLaunchTransactionError && cause.code === 'reverted' ? 'failed' : 'unverified', error: text.slice(0,1000) });
      if (alive.current) setError(text);
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function recheck() {
    if (!record?.hash || locked.current) return;
    const previous = record; locked.current = true; setBusy(true);
    try { await confirmRareLaunchFeeClaim({ ...record, hash: record.hash }); if (getLaunchClaim(creator) === previous) setLaunchClaim(creator, { ...previous, status: 'confirmed', error: undefined }); if (alive.current) { setFees(null); setStatus('Fee claim confirmed.'); } }
    catch (cause) { if (getLaunchClaim(creator) === previous) setLaunchClaim(creator, { ...previous, status: cause instanceof RareLaunchTransactionError && cause.code === 'reverted' ? 'failed' : 'unverified', error: message(cause).slice(0,1000) }); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  function tokenLabel(token: Address) { return LAUNCH_QUOTE_ASSETS.find(item => item.address.toLowerCase() === token.toLowerCase())?.symbol ?? 'Launched token'; }
  return <section className="launch-my-tokens"><div className="launch-history-heading"><h4>{mode === 'self' ? 'Your launches' : 'Your Friend’s launches'}</h4><button disabled={loading || busy} onClick={() => setReload(value => value + 1)}>REFRESH ↻</button></div>
    {loading ? <p className="launch-fine" role="status">Reading confirmed launches…</p> : !error && !items.length && <p className="launch-fine">A new idea starts here. Your confirmed tokens and fee claims will appear below.</p>}
    {items.map(item => <div className="launch-history-item" key={item.asset}><a href={`${PET_DEPLOYMENT.explorer}/token/${item.asset}`} target="_blank" rel="noreferrer">{short(item.asset)} ↗</a><div><span>{new Date(Number(item.timestamp) * 1000).toLocaleDateString()} · {item.fee / 10000}% trading fee</span><button disabled={busy || unresolved} onClick={() => void inspect(item)}>CHECK FEES</button></div></div>)}
    {selected && fees && <div className="launch-claim-review"><h4>Review fee claim</h4><p className="launch-fine">To: {creator}</p>{([0,1] as const).map(index => <p key={index} className="launch-fine">{formatUnits(index === 0 ? fees.amount0 : fees.amount1,18)} {tokenLabel(index === 0 ? fees.token0 : fees.token1)}</p>)}<p className="launch-fine">Your connected wallet pays the ETH network fee. The amount is refreshed before signing.</p><button disabled={busy || unresolved || fees.amount0 + fees.amount1 === 0n} onClick={() => void claim()}>CLAIM TO {mode === 'self' ? 'MY WALLET' : 'RARE WALLET'} ↗</button></div>}
    {error && <p className="launch-error" role="alert">{error}</p>}
    {record && <div className="launch-note" role="status"><p>{record.status === 'confirmed' ? 'Last fee claim confirmed.' : record.status === 'failed' ? 'Last fee claim reverted.' : record.error || 'A fee claim is awaiting confirmation.'}</p>{record.hash && <a href={`${PET_DEPLOYMENT.explorer}/tx/${record.hash}`} target="_blank" rel="noreferrer">VIEW FEE CLAIM ↗</a>}{unresolved && record.hash && <button disabled={busy} onClick={() => void recheck()}>RECHECK CLAIM</button>}{unresolved && !record.hash && record.status === 'unverified' && <><a href={`${PET_DEPLOYMENT.explorer}/address/${record.owner}`} target="_blank" rel="noreferrer">CHECK WALLET ACTIVITY ↗</a><p>If no claim was sent and you cancelled the request in your wallet, clear it here.</p><button disabled={busy} onClick={() => setLaunchClaim(creator,null)}>CLEAR CANCELLED REQUEST</button></>}</div>}
    <p className="launch-status" role="status">{status}</p>
  </section>;
}
