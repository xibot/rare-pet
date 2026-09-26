import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { getAddress, isAddress, zeroAddress, type Address } from 'viem';
import { GenesisPetSprite, Icon, PetSprite, type PreviewFriend } from './art';
import { PET_DEPLOYMENT, type PetIdentity, type PetWalletSession } from './wallet';
import { formatHoldingBalance, readNativeBalance, readNftHolding, readTokenHolding, type NativeHolding, type NftHolding, type TokenHolding } from './rare-wallet-holdings';
import { readRareWalletInventory, type RareWalletInventoryCursor } from './rare-wallet-inventory';
import { buildRareWalletTransfer, parseRareWalletAmount, RareWalletTransferError, sendRareWalletTransfer, type RareWalletTransferIntent } from './rare-wallet-transfer';
import { getRareWalletTransfer, setRareWalletTransfer, subscribeRareWalletTransfers, refreshRareWalletTransfer } from './rare-wallet-transactions';
import './rare-wallet.css';

type Asset = NativeHolding | TokenHolding | NftHolding;
type Review = Readonly<{ asset: Asset; intent: RareWalletTransferIntent; amount: string; recipient: Address }>;
const keyOf = (asset: Asset) => asset.kind === 'native' ? 'native' : `${asset.kind}:${asset.contract.toLowerCase()}${'tokenId' in asset ? `:${asset.tokenId}` : ''}`;
const isToken = (asset: Asset): asset is NativeHolding | TokenHolding => asset.kind === 'native' || asset.kind === 'erc20';
const assetName = (asset: Asset) => isToken(asset) ? asset.symbol : `${asset.collectionName} #${asset.tokenId}`;
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Could not read this wallet. Please try again.';
function merge<T extends Asset>(old: readonly T[], incoming: readonly T[]): T[] {
  const merged = new Map(old.map(asset => [keyOf(asset), asset]));
  for (const asset of incoming) {
    const previous = merged.get(keyOf(asset));
    if (!previous || (previous.blockNumber ?? 0n) <= (asset.blockNumber ?? 0n)) merged.set(keyOf(asset), asset);
  }
  return [...merged.values()];
}
function canSend(asset: Asset) { return asset.balance !== null && asset.balance > 0n && (!isToken(asset) || asset.decimals !== null); }
function AssetIcon({ asset }: { asset: Asset }) {
  const [broken, setBroken] = useState(false);
  return <span className={`rw-asset-icon ${asset.kind === 'native' ? 'rw-eth' : ''}`}>{asset.kind !== 'native' && asset.imageUrl && !broken ? <img src={asset.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)}/> : asset.kind === 'native' ? 'Ξ' : isToken(asset) ? <Icon name="wallet"/> : '✦'}</span>;
}

export function RareWalletDialog({ friend, pet, session, revision, bodyId, close, chooseFriend }: {
  friend: PreviewFriend | PetIdentity; pet: PetIdentity | null; session: PetWalletSession; revision: number; bodyId: string; close: () => void; chooseFriend: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), addressInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true), sending = useRef(false), loadingMore = useRef(false);
  const controller = useRef(new AbortController());
  const inventoryController = useRef<AbortController | null>(null), inventoryGeneration = useRef(0);
  const wallet = pet?.walletAddress ?? null;
  const transfer = useSyncExternalStore(subscribeRareWalletTransfers, () => getRareWalletTransfer(wallet));
  const hash = transfer?.hash ?? null, confirmed = transfer?.status === 'confirmed';
  const unresolved = !!transfer && ['awaiting-wallet', 'pending', 'unverified'].includes(transfer.status);
  const [rechecking, setRechecking] = useState(false);
  const lastConfirmedHash = useRef(confirmed ? hash : null);
  const [native, setNative] = useState<NativeHolding | null>(null);
  const [tokens, setTokens] = useState<TokenHolding[]>([]), [nfts, setNfts] = useState<NftHolding[]>([]);
  const [loading, setLoading] = useState(false), [nativeLoading, setNativeLoading] = useState(false), [refresh, setRefresh] = useState(0);
  const [warnings, setWarnings] = useState<readonly string[]>([]), [loadError, setLoadError] = useState(''), [nativeError, setNativeError] = useState('');
  const [complete, setComplete] = useState(false), [cursor, setCursor] = useState<RareWalletInventoryCursor | null>(null);
  const [tab, setTab] = useState<'tokens' | 'nfts'>('tokens');
  const [view, setView] = useState<'holdings' | 'send' | 'review'>('holdings');
  const [sendKind, setSendKind] = useState<'tokens' | 'nfts'>('tokens'), [selected, setSelected] = useState('');
  const [recipient, setRecipient] = useState(''), [amount, setAmount] = useState(''), [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [importKind, setImportKind] = useState<'erc20' | 'erc721' | 'erc1155'>('erc20');
  const [importContract, setImportContract] = useState(''), [importId, setImportId] = useState(''), [importing, setImporting] = useState(false), [importError, setImportError] = useState('');
  const allTokens: (NativeHolding | TokenHolding)[] = [...(native ? [native] : []), ...tokens];
  const options: Asset[] = sendKind === 'tokens' ? allTokens : nfts;
  const asset = options.find(value => keyOf(value) === selected);
  useEffect(() => {
    const element = dialog.current!; element.showModal(); alive.current = true;
    return () => { alive.current = false; controller.current.abort(); element.close(); };
  }, []);
  useEffect(() => {
    if (!wallet) return;
    const abort = new AbortController(); inventoryController.current?.abort(); inventoryController.current = abort; inventoryGeneration.current++; loadingMore.current = false; setImporting(false);
    setLoading(true); setNativeLoading(true); setLoadError(''); setNativeError(''); setWarnings([]); setComplete(false); setCursor(null);
    setNative(null); setTokens([]); setNfts([]);
    void readNativeBalance(wallet, abort.signal).then(value => { if (!abort.signal.aborted) setNative(value); }).catch(cause => { if (!abort.signal.aborted) setNativeError(message(cause)); }).finally(() => { if (!abort.signal.aborted) setNativeLoading(false); });
    void readRareWalletInventory(wallet, abort.signal).then(value => {
      if (abort.signal.aborted) return;
      setTokens([...value.tokens]); setNfts([...value.nfts]); setWarnings(value.warnings); setComplete(value.complete); setCursor(value.cursor ?? null);
    }).catch(cause => { if (!abort.signal.aborted) setLoadError(message(cause)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [wallet, refresh]);
  useEffect(() => {
    if (confirmed && hash && hash !== lastConfirmedHash.current) { lastConfirmedHash.current = hash; setRefresh(value => value + 1); }
  }, [confirmed, hash]);
  async function loadMore() {
    if (!wallet || !cursor || loadingMore.current) return;
    const generation = inventoryGeneration.current, signal = inventoryController.current?.signal;
    if (!signal || signal.aborted) return;
    loadingMore.current = true; setLoading(true); setLoadError('');
    try {
      const value = await readRareWalletInventory(wallet, signal, { cursor });
      if (!alive.current || signal.aborted || generation !== inventoryGeneration.current) return;
      setTokens(old => merge(old, value.tokens)); setNfts(old => merge(old, value.nfts)); setWarnings(value.warnings); setComplete(value.complete); setCursor(value.cursor ?? null);
    } catch (cause) { if (alive.current && !signal.aborted && generation === inventoryGeneration.current) setLoadError(message(cause)); }
    finally { if (alive.current && !signal.aborted && generation === inventoryGeneration.current) { loadingMore.current = false; setLoading(false); } }
  }
  async function copyAddress() {
    if (!wallet) return;
    try { await navigator.clipboard.writeText(wallet); if (alive.current) setStatus('Wallet address copied.'); }
    catch { addressInput.current?.focus(); addressInput.current?.select(); setStatus('Address selected. Copy it from the address field.'); }
  }
  function startSend(kind: 'tokens' | 'nfts', choice?: Asset) {
    if (sending.current || unresolved) return;
    const list = kind === 'tokens' ? allTokens : nfts;
    setSendKind(kind); setSelected(choice ? keyOf(choice) : list.find(canSend) ? keyOf(list.find(canSend)!) : '');
    setAmount(choice?.kind === 'erc1155' ? '1' : ''); setRecipient(''); setReview(null); setError(''); setStatus(''); if (wallet) setRareWalletTransfer(wallet, null); setView('send');
  }
  function prepare(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      if (!wallet || !pet || !asset || !canSend(asset)) throw new Error('Choose an asset with an available balance.');
      if (!isAddress(recipient.trim()) || recipient.trim().toLowerCase() === zeroAddress) throw new Error('Enter a valid recipient address.');
      const to = getAddress(recipient.trim());
      let intent: RareWalletTransferIntent;
      let exactAmount = '1';
      if (isToken(asset)) {
        const units = parseRareWalletAmount(amount, asset.decimals!);
        if (units > asset.balance!) throw new Error('The amount exceeds this Friend’s balance.');
        exactAmount = formatHoldingBalance(units, asset.decimals);
        intent = asset.kind === 'native' ? { kind: 'native', to, amount: units } : { kind: 'erc20', contract: asset.contract, to, amount: units };
      } else if (asset.kind === 'erc721') intent = { kind: 'erc721', contract: asset.contract, tokenId: BigInt(asset.tokenId), to };
      else {
        const units = parseRareWalletAmount(amount, 0);
        if (units > asset.balance!) throw new Error('The quantity exceeds this Friend’s balance.');
        exactAmount = String(units); intent = { kind: 'erc1155', contract: asset.contract, tokenId: BigInt(asset.tokenId), amount: units, to };
      }
      const checked = buildRareWalletTransfer(wallet, intent);
      setReview(Object.freeze({ asset, intent: checked.intent, recipient: to, amount: exactAmount })); setView('review');
    } catch (cause) { setError(message(cause)); }
  }
  async function send() {
    if (!pet || !wallet || !review || sending.current || unresolved) return;
    sending.current = true; setBusy(true); setError(''); setStatus('Checking ownership and transfer…');
    const record = { owner: pet.owner, intent: review.intent, friendLabel: friend.label.slice(0, 120) };
    setRareWalletTransfer(wallet, { ...record, hash: null, status: 'awaiting-wallet' });
    const assertActive = () => { if (!alive.current || controller.current.signal.aborted) throw new Error('Rare Wallet was closed. Open it again to send.'); };
    try {
      const result = await sendRareWalletTransfer({ session, pet, revision, intent: review.intent, assertActive, onHash(value) {
        setRareWalletTransfer(wallet, { ...record, hash: value, status: 'pending' });
        if (alive.current) setStatus('Transaction submitted. Waiting for confirmation…');
      } });
      setRareWalletTransfer(wallet, { ...record, hash: result.hash, status: 'confirmed' });
      if (!alive.current) return;
      setStatus('Transfer confirmed. Your Friend’s holdings are updating.');
    } catch (cause) {
      const submitted = cause instanceof RareWalletTransferError ? cause.transactionHash : getRareWalletTransfer(wallet)?.hash;
      const saved = getRareWalletTransfer(wallet);
      const settled = !!saved && saved.hash === submitted && (saved.status === 'confirmed' || saved.status === 'failed');
      const newer = !!saved?.hash && saved.hash !== submitted;
      if (submitted && !settled && !newer) setRareWalletTransfer(wallet, { ...record, hash: submitted, status: cause instanceof RareWalletTransferError && cause.code === 'reverted' ? 'failed' : 'unverified', error: message(cause).slice(0, 1000) });
      else if (!submitted && saved?.status === 'awaiting-wallet') setRareWalletTransfer(wallet, null);
      if (!alive.current) return;
      setError(message(cause)); setStatus('');
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  async function recheck() {
    if (!wallet || rechecking) return;
    setRechecking(true); setError(''); setStatus('Checking the submitted transaction…');
    try {
      const result = await refreshRareWalletTransfer(wallet);
      if (!alive.current) return;
      if (result?.status === 'confirmed') { setStatus('Transfer confirmed. Your Friend’s holdings are updating.'); }
      else setStatus(result?.error ?? 'Transaction status updated.');
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setRechecking(false); }
  }
  async function importAsset(event: FormEvent) {
    event.preventDefault(); if (!wallet || importing || loading) return;
    const generation = inventoryGeneration.current, signal = inventoryController.current?.signal;
    if (!signal || signal.aborted) return;
    setImporting(true); setImportError('');
    try {
      if (!isAddress(importContract.trim())) throw new Error('Enter a valid asset contract address.');
      const contract = getAddress(importContract.trim());
      if (importKind === 'erc20') {
        const result = await readTokenHolding(wallet, contract, signal);
        if (!alive.current || signal.aborted || generation !== inventoryGeneration.current) return;
        if (result.balance === 0n) throw new Error('This Friend has no balance of this token.');
        setTokens(old => merge(old, [result])); setTab('tokens');
      } else {
        const result = await readNftHolding(wallet, contract, importId.trim(), importKind, signal);
        if (!alive.current || signal.aborted || generation !== inventoryGeneration.current) return;
        setNfts(old => merge(old, [result])); setTab('nfts');
      }
      setStatus('Asset found in your Friend’s wallet.'); setImportContract(''); setImportId('');
    } catch (cause) { if (alive.current && !signal.aborted && generation === inventoryGeneration.current) setImportError(message(cause)); }
    finally { if (alive.current && !signal.aborted && generation === inventoryGeneration.current) setImporting(false); }
  }
  const requestClose = () => { if (!sending.current) close(); };
  return <dialog ref={dialog} className="pet-dialog rare-wallet-dialog" aria-labelledby="rw-heading" onCancel={event => { event.preventDefault(); requestClose(); }} onClick={event => { if (event.target === dialog.current) requestClose(); }}>
    <div className="dialog-heading"><h2 id="rw-heading"><Icon name="wallet"/> RARE WALLET</h2><button aria-label="Close Rare Wallet" disabled={busy} onClick={requestClose}>×</button></div>
    <div className="rw-content">
      <div className="rw-profile"><div className="rw-portrait">{friend.collection === 'genesis' ? <GenesisPetSprite portraitUrl={friend.image} bodyId={bodyId}/> : friend.sprites ? <PetSprite sprites={friend.sprites} frame={0}/> : <img src={friend.image} alt={friend.label}/>}</div><div className="rw-identity"><span className="rw-eyebrow">{friend.collection.toUpperCase()} / ROBINHOOD CHAIN</span><h3>{friend.label}</h3>{wallet ? <><label className="rw-address-label" htmlFor="rw-address">YOUR FRIEND’S WALLET</label><div className="rw-address"><input ref={addressInput} id="rw-address" readOnly value={wallet} aria-label="Rare Friend wallet address" onClick={event => event.currentTarget.select()}/><button onClick={() => void copyAddress()} aria-label="Copy wallet address">COPY</button></div><a className="rw-explorer" href={`${PET_DEPLOYMENT.explorer}/address/${wallet}`} target="_blank" rel="noopener noreferrer">VIEW ON EXPLORER ↗</a></> : <p className="rw-subtitle">A wallet of their own.</p>}</div></div>
      {!pet ? <div className="rw-empty"><Icon name="wallet"/><h4>Your Friend. Their wallet.</h4><p>Connect your wallet and choose a Rare Friend you own to see its assets and make transfers.</p><button className="rw-primary" onClick={chooseFriend}>CHOOSE MY FRIEND ↗</button><small>Preview Friends do not give access to a real wallet.</small></div> : !wallet ? <div className="rw-empty"><h4>This Friend is not hardwired yet.</h4><p>Rare Wallet supports Genesis and hardwired Generations Friends. This Generations Friend does not have an active wallet to manage.</p><button className="rw-primary" onClick={chooseFriend}>CHOOSE ANOTHER FRIEND ↗</button></div> : <>
        {view === 'holdings' ? <>
          <div className="rw-send-buttons"><button className="rw-primary" disabled={!allTokens.some(canSend) || unresolved} onClick={() => startSend('tokens')}>SEND TOKENS <span>↗</span></button><button disabled={!nfts.some(canSend) || unresolved} onClick={() => startSend('nfts')}>SEND NFT <span>↗</span></button></div>
          <div className="rw-list-toolbar"><div className="rw-tabs" role="group" aria-label="Wallet holdings"><button aria-pressed={tab === 'tokens'} onClick={() => setTab('tokens')}>TOKENS</button><button aria-pressed={tab === 'nfts'} onClick={() => setTab('nfts')}>NFTs <span>{nfts.length}{!complete ? '+' : ''}</span></button></div><button className="rw-refresh" disabled={loading || nativeLoading || importing} onClick={() => { setStatus(''); setRefresh(value => value + 1); }} aria-label="Refresh wallet holdings">REFRESH ↻</button></div>
          <div className="rw-assets" aria-busy={loading || tab === 'tokens' && nativeLoading}>
            {tab === 'tokens' && nativeLoading && <p className="rw-reading">Reading ETH balance…</p>}
            {tab === 'tokens' && nativeError && <p className="rw-warning" role="alert">ETH balance unavailable. {nativeError}</p>}
            {(tab === 'tokens' ? allTokens : nfts).map(item => <div className="rw-asset" key={keyOf(item)}><AssetIcon asset={item}/><div className="rw-asset-info"><strong>{isToken(item) ? item.name : item.collectionName}</strong><small>{item.kind === 'native' ? 'NATIVE TOKEN' : <a href={`${PET_DEPLOYMENT.explorer}/token/${item.contract}`} target="_blank" rel="noopener noreferrer">{item.kind.toUpperCase().replace('ERC', 'ERC-')} · {short(item.contract)} ↗</a>}{'tokenId' in item && <span className="rw-token-id">ID #{item.tokenId}</span>}</small></div><div className="rw-asset-balance"><strong>{formatHoldingBalance(item.balance, isToken(item) ? item.decimals : 0)}</strong><small>{isToken(item) ? item.symbol : 'HELD'}</small></div><button className="rw-asset-send" aria-label={`Send ${assetName(item)}`} disabled={!canSend(item) || unresolved} onClick={() => startSend(isToken(item) ? 'tokens' : 'nfts', item)}>↗</button></div>)}
            {loading && <p className="rw-reading" role="status">Finding your Friend’s assets onchain…</p>}
            {!loading && complete && (tab === 'tokens' ? tokens.length : nfts.length) === 0 && <p className="rw-empty-list">{tab === 'tokens' ? 'No other tokens found in standard transfer history.' : 'No NFTs found in standard transfer history.'}</p>}
          </div>
          {loadError && <p className="rw-warning" role="alert">Asset discovery is unavailable. {loadError} You can add an asset below.</p>}
          {warnings.length > 0 && <div className="rw-warning" role="status">{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
          {cursor && <button className="rw-more" disabled={loading} onClick={() => void loadMore()}>{loading ? 'READING…' : 'LOAD MORE ASSETS ↓'}</button>}
          <details className="rw-import"><summary>Add a missing asset</summary><p>Enter its Robinhood Chain contract. RarePet checks what this Friend holds.</p><form onSubmit={event => void importAsset(event)}><label>ASSET TYPE<select value={importKind} onChange={event => setImportKind(event.target.value as typeof importKind)} disabled={importing}><option value="erc20">Token (ERC-20)</option><option value="erc721">NFT (ERC-721)</option><option value="erc1155">NFT (ERC-1155)</option></select></label><label>CONTRACT ADDRESS<input value={importContract} onChange={event => setImportContract(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} required disabled={importing}/></label>{importKind !== 'erc20' && <label>TOKEN ID<input value={importId} onChange={event => setImportId(event.target.value)} placeholder="0" inputMode="numeric" pattern="[0-9]+" maxLength={78} required disabled={importing}/></label>}<button disabled={importing || loading}>{importing ? 'CHECKING…' : 'FIND ASSET'}</button></form>{importError && <p className="rw-warning" role="alert">{importError}</p>}</details>
          <div className="rw-bottom"><small>Assets belong to this Friend’s wallet.</small><button onClick={chooseFriend}>CHANGE FRIEND ⇄</button></div>
        </> : view === 'send' ? <form className="rw-send-form" onSubmit={prepare}><button type="button" className="rw-back" onClick={() => { setView('holdings'); setError(''); }}>← HOLDINGS</button><h4>{sendKind === 'tokens' ? 'Send tokens' : 'Send an NFT'}</h4><label>ASSET<select value={selected} onChange={event => { setSelected(event.target.value); setAmount(''); setError(''); }} required><option value="" disabled>Choose an asset</option>{options.map(item => <option key={keyOf(item)} value={keyOf(item)} disabled={!canSend(item)}>{assetName(item)} — {formatHoldingBalance(item.balance, isToken(item) ? item.decimals : 0)}</option>)}</select></label>{asset && <div className="rw-selected-asset"><span>AVAILABLE: {formatHoldingBalance(asset.balance, isToken(asset) ? asset.decimals : 0)} {isToken(asset) ? asset.symbol : 'held'}</span>{asset.kind !== 'native' && <code>{asset.contract}{'tokenId' in asset ? ` / #${asset.tokenId}` : ''}</code>}</div>}<label>RECIPIENT ADDRESS<input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} maxLength={42} required/></label>{asset?.kind !== 'erc721' && <label>{asset?.kind === 'erc1155' ? 'QUANTITY' : 'AMOUNT'}<div className="rw-amount"><input value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" inputMode="decimal" maxLength={340} required/><button type="button" disabled={!asset || !canSend(asset)} onClick={() => { if (asset) setAmount(formatHoldingBalance(asset.balance, isToken(asset) ? asset.decimals : 0)); }}>MAX</button></div></label>}<p className="rw-fee-note">Sent from {friend.label}’s wallet on Robinhood Chain. Your connected owner wallet pays the network fee.</p><button className="rw-primary" disabled={!asset || !canSend(asset)}>REVIEW TRANSFER ↗</button></form> : review && <div className="rw-review"><button className="rw-back" disabled={busy || !!hash} onClick={() => { setView('send'); setError(''); }}>← EDIT TRANSFER</button><h4>{confirmed ? 'Transfer confirmed.' : 'Review your transfer.'}</h4><dl><div><dt>FROM / {friend.label}</dt><dd>{wallet}</dd></div><div><dt>TO / RECIPIENT</dt><dd data-recipient>{review.recipient}</dd></div><div><dt>{isToken(review.asset) ? 'AMOUNT' : 'NFT / QUANTITY'}</dt><dd data-transfer-amount>{review.amount} × {assetName(review.asset)}</dd></div>{review.asset.kind !== 'native' && <div><dt>ASSET CONTRACT</dt><dd>{review.asset.contract}</dd></div>}<div><dt>NETWORK</dt><dd>Robinhood Chain · 4663</dd></div><div><dt>NETWORK FEE PAID BY</dt><dd>{pet.owner}</dd></div></dl>{!hash && (!unresolved || busy) && <><p className="rw-fee-note">Your wallet will show the network fee and ask you to approve this transfer.</p><button className="rw-primary" disabled={busy} onClick={() => void send()}>{busy ? 'CONFIRMING…' : 'CONFIRM IN WALLET ↗'}</button></>}{(confirmed || transfer?.status === 'failed') && <button className="rw-primary" onClick={() => { setView('holdings'); setError(''); }}>BACK TO HOLDINGS ↗</button>}</div>}
      </>}
      {error && <p className="rw-warning" role="alert">{error}</p>}
      {transfer && !busy && <div className={`rw-transfer-record ${unresolved ? 'rw-warning' : ''}`} role="status"><p>{transfer.status === 'confirmed' ? 'Last transfer confirmed.' : transfer.status === 'failed' ? 'Last transfer reverted.' : transfer.error || 'A transfer is still pending. Check it before sending again.'}</p>{unresolved && hash && <button disabled={rechecking} onClick={() => void recheck()}>{rechecking ? 'CHECKING…' : 'RECHECK TRANSACTION'}</button>}{unresolved && !hash && <><a href={`${PET_DEPLOYMENT.explorer}/address/${transfer.owner}`} target="_blank" rel="noopener noreferrer">CHECK OWNER WALLET ACTIVITY ↗</a>{transfer.status === 'unverified' && <><p>If you cancelled or rejected the request in your wallet, clear it here to start again.</p><button onClick={() => { if (wallet) { setRareWalletTransfer(wallet, null); setStatus('Cancelled request cleared.'); } }}>CLEAR CANCELLED REQUEST</button></>}</>}</div>}
      {hash && <p className="rw-transaction"><a href={`${PET_DEPLOYMENT.explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer">{confirmed ? 'VIEW CONFIRMED TRANSFER' : 'CHECK TRANSACTION STATUS'} ↗</a>{!busy && !confirmed && <small>Check this transaction before sending again.</small>}</p>}
      <p className="rw-status" role="status">{status}</p>
    </div>
  </dialog>;
}
