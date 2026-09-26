import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatUnits, type Address, type Hex } from 'viem';
import { PET_DEPLOYMENT, type PetIdentity, type PetWalletSession } from './wallet';
import { LAUNCH_QUOTE_ASSETS } from './launch-quotes';
import { readRareLaunchHistory, readRareSelfLaunchHistory, readRareLaunchFees, claimRareLaunchFees, claimRareSelfLaunchFees, confirmRareLaunchFeeClaim, RareLaunchTransactionError, type RareLaunchHistoryItem, type RareLaunchPendingFees } from './launch-doppler';
import { getLaunchClaim, setLaunchClaim, subscribeLaunchClaims, type LaunchClaimRecord } from './launch-claim-record';
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Fees are unavailable. Please refresh.';
type Props = {
  mode: 'self' | 'friend'; creator: Address; pet: PetIdentity | null; session: PetWalletSession; revision: number; router: Address; refresh: Hex | null;
  title?: string; transactionsBlocked?: boolean; acquireWalletRequest?: () => (() => void); onClaimConfirmed?: () => void;
};
/** Reset all reads and review state when the selected identity or wallet session changes. */
export function LaunchHistory(props: Props) {
  const identity = [props.mode, props.creator.toLowerCase(), props.pet?.owner.toLowerCase(), props.pet?.contract.toLowerCase(), props.pet?.tokenId, props.revision, props.router.toLowerCase()].join(':');
  return <LaunchHistoryContent key={identity} {...props}/>;
}
function LaunchHistoryContent({ mode, creator, pet, session, revision, router, refresh, title, transactionsBlocked = false, acquireWalletRequest, onClaimConfirmed }: Props) {
  const alive = useRef(true), locked = useRef(false);
  const [items, setItems] = useState<readonly RareLaunchHistoryItem[]>([]), [loading, setLoading] = useState(false), [reload, setReload] = useState(0);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [fees, setFees] = useState<RareLaunchPendingFees | null>(null), [selected, setSelected] = useState<RareLaunchHistoryItem | null>(null);
  const record = useSyncExternalStore(subscribeLaunchClaims, () => getLaunchClaim(creator));
  const unresolved = !!record && ['awaiting-wallet','pending','unverified'].includes(record.status);
  const confirmedHash = useRef(record?.status === 'confirmed' ? record.hash : null);
  const onConfirmed = useRef(onClaimConfirmed); onConfirmed.current = onClaimConfirmed;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (record?.status === 'confirmed' && record.hash && record.hash !== confirmedHash.current) {
      confirmedHash.current = record.hash; onConfirmed.current?.();
    }
  }, [record]);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(''); setItems([]); setFees(null); setSelected(null);
    if (mode === 'friend' && (!pet?.walletAddress || pet.walletAddress.toLowerCase() !== creator.toLowerCase())) {
      setError('Choose a verified Rare Friend wallet to read its launches.'); setLoading(false); return () => abort.abort();
    }
    const read = mode === 'self' ? readRareSelfLaunchHistory({ router, account: creator, signal: abort.signal }) : readRareLaunchHistory({ router, pet: pet!, signal: abort.signal });
    void read.then(result => { if (!abort.signal.aborted) setItems(result.items); }).catch(cause => { if (!abort.signal.aborted) setError(message(cause)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [creator, router, mode, pet, refresh, reload]);
  function assertActive() {
    const snapshot = session.getSnapshot();
    if (!alive.current || snapshot.revision !== revision || snapshot.status !== 'connected' || snapshot.chainId !== 4663
      || snapshot.account?.toLowerCase() !== (mode === 'self' ? creator : pet?.owner)?.toLowerCase()
      || mode === 'friend' && pet?.walletAddress?.toLowerCase() !== creator.toLowerCase()) throw new Error('Your wallet or selected Friend changed. Open its wallet again.');
  }
  async function inspect(item: RareLaunchHistoryItem) {
    if (locked.current || unresolved || transactionsBlocked) return;
    locked.current = true; setBusy(true); setError(''); setFees(null); setSelected(item);
    try { assertActive(); const value = await readRareLaunchFees({ asset: item.asset, wallet: creator }); assertActive(); setFees(value); }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function copyAddress(asset: Address) {
    try { await navigator.clipboard.writeText(asset); if (alive.current) setStatus('Token contract address copied.'); }
    catch { if (alive.current) setStatus('Copy the full contract address shown beside CA.'); }
  }
  async function claim() {
    if (!fees || !selected || locked.current || unresolved || transactionsBlocked) return;
    locked.current = true; setBusy(true); setError(''); setStatus('Confirm the fee claim in your wallet.');
    const owner = mode === 'self' ? creator : pet!.owner;
    const pending: LaunchClaimRecord = { requestId: crypto.randomUUID(), mode, asset: selected.asset, wallet: creator, owner, hash: null, status: 'awaiting-wallet' };
    let hash: Hex | null = null, requested = false, recorded = false;
    let release: (() => void) | undefined;
    try {
      assertActive(); release = acquireWalletRequest?.();
      setLaunchClaim(creator, pending); recorded = true;
      const options = { session, revision, asset: selected.asset, assertActive, onWalletRequest: () => { requested = true; }, onHash: (value: Hex) => {
        hash = value; setLaunchClaim(creator, { ...pending, hash, status: 'pending' }); release?.(); release = undefined;
        if (alive.current) setStatus('Fee claim submitted…');
      } };
      const result = await (mode === 'self' ? claimRareSelfLaunchFees({ ...options, account: creator }) : claimRareLaunchFees({ ...options, pet: pet! }));
      setLaunchClaim(creator, { ...pending, hash: result.hash, status: 'confirmed' });
      if (alive.current) { setFees(null); setSelected(null); setStatus(`Fees confirmed in your ${mode === 'self' ? 'creator wallet' : 'Rare Wallet'}.`); }
    } catch (cause) {
      const text = message(cause);
      if (recorded) setLaunchClaim(creator, !hash && (!requested || /user rejected|user denied|rejected the request/i.test(text)) ? null : { ...pending, hash, status: cause instanceof RareLaunchTransactionError && cause.code === 'reverted' ? 'failed' : 'unverified', error: text.slice(0,1000) });
      if (alive.current) { setError(text); setStatus(''); }
    } finally { release?.(); locked.current = false; if (alive.current) setBusy(false); }
  }
  async function recheck() {
    if (!record?.hash || locked.current) return;
    const previous = record; locked.current = true; setBusy(true);
    try { await confirmRareLaunchFeeClaim({ ...record, hash: record.hash }); if (getLaunchClaim(creator) === previous) setLaunchClaim(creator, { ...previous, status: 'confirmed', error: undefined }); if (alive.current) { setFees(null); setStatus('Fee claim confirmed.'); } }
    catch (cause) { if (getLaunchClaim(creator) === previous) setLaunchClaim(creator, { ...previous, status: cause instanceof RareLaunchTransactionError && cause.code === 'reverted' ? 'failed' : 'unverified', error: message(cause).slice(0,1000) }); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  function tokenLabel(token: Address) { return LAUNCH_QUOTE_ASSETS.find(item => item.address.toLowerCase() === token.toLowerCase())?.symbol ?? 'Launched token'; }
  return <section className="launch-my-tokens"><div className="launch-history-heading"><h4>{title ?? (mode === 'self' ? 'Your launches' : 'Your Friend’s launches')}</h4><button disabled={loading || busy} onClick={() => setReload(value => value + 1)}>REFRESH ↻</button></div>
    {loading ? <p className="launch-fine" role="status">Reading confirmed launches…</p> : !error && !items.length && <p className="launch-fine">{mode === 'friend' ? 'This Rare Friend has not launched a token yet. Its confirmed tokens and trading fees will appear here.' : 'A new idea starts here. Your confirmed tokens and fee claims will appear below.'}</p>}
    {items.map(item => <div className="launch-history-item" key={item.asset} data-launched-token={item.asset}><strong>Launched token</strong><p className="launch-token-ca"><span>CA</span> <code>{item.asset}</code></p><div className="launch-token-links"><button aria-label={`Copy contract address ${item.asset}`} onClick={() => void copyAddress(item.asset)}>COPY CA</button><a href={`${PET_DEPLOYMENT.explorer}/token/${item.asset}`} target="_blank" rel="noopener noreferrer">VIEW TOKEN ↗</a></div><div><span>{new Date(Number(item.timestamp) * 1000).toLocaleDateString()} · {item.fee / 10000}% trading fee</span><button disabled={busy || unresolved || transactionsBlocked} onClick={() => void inspect(item)}>CHECK FEES</button></div></div>)}
    {transactionsBlocked && <p className="launch-fine">Finish the pending wallet transaction before claiming trading fees.</p>}
    {selected && fees && <div className="launch-claim-review"><h4>Review fee claim</h4><p className="launch-fine">Token CA: <code>{selected.asset}</code></p><p className="launch-fine">To {mode === 'friend' ? 'Rare Wallet' : 'creator wallet'}: <code>{creator}</code></p>{([0,1] as const).map(index => <p key={index} className="launch-fine">{formatUnits(index === 0 ? fees.amount0 : fees.amount1,18)} {tokenLabel(index === 0 ? fees.token0 : fees.token1)}</p>)}<p className="launch-fine">Your connected {mode === 'friend' ? 'owner ' : ''}wallet pays the ETH network fee. The amount is refreshed before signing.</p><button disabled={busy || unresolved || transactionsBlocked || fees.amount0 + fees.amount1 === 0n} onClick={() => void claim()}>CLAIM TO {mode === 'self' ? 'MY WALLET' : 'RARE WALLET'} ↗</button></div>}
    {error && <p className="launch-error" role="alert">{error}</p>}
    {record && <div className="launch-note" role="status"><p>{record.status === 'confirmed' ? 'Last fee claim confirmed.' : record.status === 'failed' ? 'Last fee claim reverted.' : record.error || 'A fee claim is awaiting confirmation.'}</p>{record.hash && <a href={`${PET_DEPLOYMENT.explorer}/tx/${record.hash}`} target="_blank" rel="noopener noreferrer">VIEW FEE CLAIM ↗</a>}{unresolved && record.hash && <button disabled={busy} onClick={() => void recheck()}>RECHECK CLAIM</button>}{unresolved && !record.hash && record.status === 'unverified' && <><a href={`${PET_DEPLOYMENT.explorer}/address/${record.owner}`} target="_blank" rel="noopener noreferrer">CHECK WALLET ACTIVITY ↗</a><p>If no claim was sent and you cancelled the request in your wallet, clear it here.</p><button disabled={busy} onClick={() => setLaunchClaim(creator,null)}>CLEAR CANCELLED REQUEST</button></>}</div>}
    <p className="launch-status" role="status">{status}</p>
  </section>;
}
