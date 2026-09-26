import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { type Hex } from 'viem';
import { Icon, GenesisPetSprite, PetSprite, type PreviewFriend } from './art';
import { type PetIdentity, type PetWalletSession, PET_DEPLOYMENT } from './wallet';
import { launchpadContract, launchStorageReady, launchTreasury } from './config';
import { prepareLaunchImage, validateLaunchName, validateLaunchTicker, type LaunchImage } from './launch-image';
import { LAUNCH_QUOTE_ASSETS, getLaunchQuoteAsset, readLaunchQuotePrice, type LaunchQuoteId } from './launch-quotes';
import { tokenMetadataURI, uploadLaunchImage, selfTokenMetadataURI, uploadSelfLaunchImage } from './launch-upload';
import { createRareLaunchSalt, prepareRareLaunch, readRareLaunchConfig, sendRareLaunch, type RareLaunchConfig, type PreparedRareLaunch, type RareLaunchFee, readRareSelfLaunchConfig, prepareRareSelfLaunch, sendRareSelfLaunch, type PreparedRareSelfLaunch, RareLaunchTransactionError } from './launch-doppler';
import { getRareLaunchTransaction, subscribeRareLaunchTransactions, setRareLaunchTransaction, refreshRareLaunchTransaction } from './launch-transactions';
import { LaunchHistory } from './LaunchHistory';
import './launch.css';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The launch could not be prepared. Please try again.';
const percent = (shares: bigint) => `${Number(shares) / 1e16}%`;
const explorer = (address: string) => `${PET_DEPLOYMENT.explorer}/address/${address}`;
type DraftReview = { name: string; symbol: string; quoteId: LaunchQuoteId; fee: RareLaunchFee; image: LaunchImage };

type LaunchProps = {
  friend: PreviewFriend | PetIdentity; pet: PetIdentity | null; session: PetWalletSession; revision: number; bodyId: string;
  close: () => void; chooseFriend: () => void; onLaunch: () => void; embedded?: boolean; creatorMode?: 'self' | 'friend'; onCreatorModeChange?: (mode: 'self' | 'friend') => void;
};
export function LaunchDialog(props: LaunchProps) {
  const [mode, setMode] = useState<'self' | 'friend'>(props.embedded && !props.pet ? 'self' : 'friend');
  const selectedMode = props.creatorMode ?? mode;
  return <LaunchForm key={selectedMode} {...props} mode={selectedMode} setMode={props.onCreatorModeChange ?? setMode}/>;
}
function LaunchForm({ friend, pet, session, revision, bodyId, close, chooseFriend, onLaunch, embedded = false, mode, setMode }: LaunchProps & {
  mode: 'self' | 'friend'; setMode: (mode: 'self' | 'friend') => void;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const account = snapshot.status === 'connected' ? snapshot.account : null;
  const creator = mode === 'self' ? account : pet?.walletAddress ?? null;
  const transaction = useSyncExternalStore(subscribeRareLaunchTransactions, () => getRareLaunchTransaction(creator));
  const unresolved = !!transaction && ['awaiting-wallet', 'pending', 'unverified'].includes(transaction.status);
  const [rechecking, setRechecking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), operation = useRef(0), lock = useRef(false);
  const abort = useRef(new AbortController()), imageRef = useRef<LaunchImage | null>(null), imageGeneration = useRef(0);
  const published = useRef<{url: string; sha256: string} | null>(null);
  const [name, setName] = useState(''), [symbol, setSymbol] = useState('');
  const [quoteId, setQuoteId] = useState<LaunchQuoteId>('weth'), [fee, setFee] = useState<RareLaunchFee>(10000);
  const [image, setImage] = useState<LaunchImage | null>(null), [imageBusy, setImageBusy] = useState(false);
  const [review, setReview] = useState<DraftReview | null>(null), [prepared, setPrepared] = useState<PreparedRareLaunch | PreparedRareSelfLaunch | null>(null);
  const [config, setConfig] = useState<RareLaunchConfig | null>(null), [configError, setConfigError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const hash = transaction?.hash ?? null;
  const [asset, setAsset] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const quote = getLaunchQuoteAsset(quoteId), preview = mode === 'self' ? !account : !pet;
  const enabled = !!creator && !!launchpadContract && launchStorageReady && !!config;
  const wait = mode === 'friend' && config ? Math.max(0, Number(config.readyAt) - now) : 0;
  const expired = !!prepared && prepared.draft.quote.expiresAt <= now;
  useEffect(() => {
    const element = dialog.current; if (!embedded) element?.showModal();
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => { alive.current = false; operation.current++; abort.current.abort(); imageGeneration.current++; clearInterval(timer); if (imageRef.current) URL.revokeObjectURL(imageRef.current.previewUrl); element?.close(); };
  }, []);
  useEffect(() => {
    const router = launchpadContract;
    if (!creator || !router) return;
    let active = true;
    void (mode === 'self' ? readRareSelfLaunchConfig(router, creator) : readRareLaunchConfig(router, pet!)).then(value => { if (active) setConfig(value); }).catch(cause => { if (active) setConfigError(message(cause)); });
    return () => { active = false; };
  }, [pet, creator, mode]);
  function assertActive(task: number) {
    if (!alive.current || task !== operation.current) throw new Error('This launch review is no longer active.');
    const current = session.getSnapshot();
    if (current.revision !== revision || current.status !== 'connected' || current.account?.toLowerCase() !== (mode === 'self' ? account : pet?.owner)?.toLowerCase()) throw new Error('Your wallet changed. Open Launch again.');
  }
  async function selectImage(file?: File) {
    if (!file || lock.current) return;
    const generation = ++imageGeneration.current;
    setImageBusy(true); setError('');
    try {
      const next = await prepareLaunchImage(file);
      if (!alive.current || generation !== imageGeneration.current) { URL.revokeObjectURL(next.previewUrl); return; }
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.previewUrl);
      imageRef.current = next; setImage(next); published.current = null;
    } catch (cause) { if (alive.current && generation === imageGeneration.current) setError(message(cause)); }
    finally { if (alive.current && generation === imageGeneration.current) setImageBusy(false); }
  }
  function reviewDraft(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      if (!image || imageBusy) throw new Error('Choose a token image first.');
      const checked = { name: validateLaunchName(name), symbol: validateLaunchTicker(symbol), quoteId, fee, image };
      setName(checked.name); setSymbol(checked.symbol); setReview(checked); setPrepared(null); setStatus('');
    } catch (cause) { setError(message(cause)); }
  }
  async function prepare() {
    if (!review || !creator || !launchpadContract || !enabled || lock.current || unresolved) return;
    const task = ++operation.current; lock.current = true; setBusy(true); setError('');
    try {
      assertActive(task);
      const current = await (mode === 'self' ? readRareSelfLaunchConfig(launchpadContract, creator) : readRareLaunchConfig(launchpadContract, pet!)); assertActive(task); setConfig(current);
      if (mode === 'friend' && current.readyAt > current.timestamp) throw new Error('This Friend’s next launch unlocks 24 hours after its last launch.');
      if (!published.current || published.current.sha256 !== review.image.sha256) {
        setStatus('Confirm the image-publishing message in your wallet.');
        published.current = await (mode === 'self' ? uploadSelfLaunchImage({ session, owner: creator, revision, image: review.image, signal: abort.current.signal, assertActive: () => assertActive(task) }) : uploadLaunchImage({ session, pet: pet!, revision, image: review.image, signal: abort.current.signal, assertActive: () => assertActive(task) }));
      }
      assertActive(task); setStatus('Checking the pair, liquidity and launch transaction…');
      const price = await readLaunchQuotePrice(review.quoteId, abort.current.signal); assertActive(task);
      const draft = { name: review.name, symbol: review.symbol, fee: review.fee, tokenURI: mode === 'self' ? selfTokenMetadataURI(review.name, review.symbol, published.current!, creator) : tokenMetadataURI(review.name, review.symbol, published.current!, pet!), quote: price, salt: createRareLaunchSalt() };
      const common = { session, revision, router: launchpadContract, draft, assertActive: () => assertActive(task) };
      const value = await (mode === 'self' ? prepareRareSelfLaunch({ ...common, account: creator }) : prepareRareLaunch({ ...common, pet: pet! }));
      assertActive(task); setPrepared(value); setStatus('Launch verified. Check the final details before confirming.');
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function send() {
    if (!prepared || !creator || lock.current || unresolved) return;
    const task = ++operation.current; lock.current = true; setBusy(true); setError(''); setStatus('Confirm the launch in your wallet.');
    let submitted: Hex | null = null; let requested = false, recorded = false;
    try {
      setRareLaunchTransaction(creator, { prepared, hash: null, status: 'awaiting-wallet' }); recorded = true;
      const common = { session, revision, assertActive: () => assertActive(task), onWalletRequest: () => { requested = true; }, onHash: (value: Hex) => {
        submitted = value; setRareLaunchTransaction(creator, { prepared, hash: value, status: 'pending' });
        if (alive.current) setStatus('Launch submitted. Waiting for confirmation…');
      } };
      const result = await (prepared.mode === 'self' ? sendRareSelfLaunch({ ...common, account: creator, prepared }) : sendRareLaunch({ ...common, pet: pet!, prepared }));
      setRareLaunchTransaction(creator, { prepared, hash: result.hash, status: 'confirmed' });
      if (alive.current) { setAsset(result.asset); setStatus(mode === 'friend' ? 'Your token is live. +1 Brain.' : 'Your token is live.'); onLaunch(); }
    } catch (cause) {
      const text = message(cause), rejected = /user rejected|user denied|rejected the request/i.test(text);
      if (recorded) setRareLaunchTransaction(creator, !submitted && (!requested || rejected) ? null : { prepared, hash: submitted, status: cause instanceof RareLaunchTransactionError && cause.code === 'reverted' ? 'failed' : 'unverified', error: text });
      if (alive.current && !submitted && !requested) setPrepared(null);
      if (alive.current) setError(text);
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function recheck() {
    if (!creator || rechecking) return;
    setRechecking(true);
    try { const result = await refreshRareLaunchTransaction(creator); if (alive.current && result?.status === 'confirmed') { setAsset(result.prepared.doppler.prediction.tokenAddress); setStatus('Launch confirmed.'); onLaunch(); } }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setRechecking(false); }
  }
  const requestClose = () => { if (!lock.current) close(); };
  const content = <>
    <div className="dialog-heading"><h2 id="launch-heading"><Icon name="launch"/> RARE LAUNCHPAD</h2>{!embedded && <button aria-label="Close Rare Launchpad" disabled={busy} onClick={requestClose}>×</button>}</div>
    <div className="launch-content">
      <div className="launch-mode-toggle" role="group" aria-label="Launch as"><button aria-pressed={mode === 'self'} disabled={busy} onClick={() => setMode('self')}>LAUNCH AS YOURSELF</button><button aria-pressed={mode === 'friend'} disabled={busy} onClick={() => setMode('friend')}>LAUNCH AS YOUR RARE FRIEND</button></div>
      <div className="launch-intro"><div><span className="launch-eyebrow">A BIG IDEA. A RARE FRIEND.</span><h3>{asset ? 'Hello, world.' : review ? 'Make it rare.' : 'Launch something rare.'}</h3><p>{mode === 'friend' ? 'Your Friend. Their token. Their trading fees.' : 'Your token. Your wallet. Your trading fees.'}</p></div><span className="launch-mode">{preview ? 'PREVIEW' : enabled ? 'ROBINHOOD' : 'PREVIEW / SETUP'}</span></div>
      {mode === 'friend' ? <div className="launch-friend"><span className="launch-friend-art">{friend.collection === 'genesis' ? <GenesisPetSprite portraitUrl={friend.image} bodyId={bodyId}/> : friend.sprites ? <PetSprite sprites={friend.sprites} frame={0}/> : <img src={friend.image} alt=""/>}</span><div><small>CREATOR / {friend.collection.toUpperCase()}</small><b>{friend.label}</b></div><span>+1 BRAIN<br/><small>1 LAUNCH / 24H</small></span><button className="launch-change-friend" disabled={busy} onClick={chooseFriend}>CHANGE ⇄</button></div> : <div className="launch-self"><span>CREATOR / YOUR WALLET</span>{account ? <b>{account}</b> : <button disabled={snapshot.status === 'connecting' || snapshot.status === 'switching-network'} onClick={() => snapshot.status === 'wrong-network' ? void session.switchNetwork() : void session.connect()}>{snapshot.status === 'wrong-network' ? 'SWITCH TO ROBINHOOD' : 'CONNECT WALLET ↗'}</button>}<small>Creator fees go to your connected wallet. No Rare Friend needed.</small></div>}
      {!review ? <form className="launch-form" onSubmit={reviewDraft}>
        <div className="launch-specs"><label className="launch-image-label"><span>TOKEN IMAGE</span><span className={`launch-image-box ${image ? 'has-image' : ''}`}>{image ? <img src={image.previewUrl} alt="Token image preview"/> : <><b>+</b><span>ADD IMAGE</span></>}<input aria-label="Token image" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void selectImage(event.target.files?.[0]); event.target.value = ''; }} disabled={imageBusy}/></span><small>{imageBusy ? 'PREPARING…' : image ? 'CHANGE IMAGE ↗' : 'PNG, JPG, WEBP · UP TO 5 MB'}</small></label><div className="launch-names"><label htmlFor="launch-name">TOKEN NAME<input id="launch-name" placeholder="Rare Ideas" value={name} onChange={event => setName(event.target.value)} maxLength={40} autoComplete="off" required/></label><label htmlFor="launch-symbol">TICKER<span className="launch-ticker"><span>$</span><input id="launch-symbol" placeholder="RARE" value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} maxLength={10} autoComplete="off" spellCheck={false} required/></span></label></div></div>
        <fieldset><legend>PAIR WITH</legend><div className="launch-options"><button type="button" aria-pressed={quoteId === 'weth'} onClick={() => setQuoteId('weth')}><b>Ξ WETH</b><small>Wrapped Ether</small></button><button type="button" aria-pressed={quoteId !== 'weth'} onClick={() => { if (quoteId === 'weth') setQuoteId('nvda'); }}><b>↗ STOCKS</b><small>Stock tokens</small></button></div>{quoteId !== 'weth' && <label className="launch-stock-label" htmlFor="launch-stock">STOCK TOKEN<select id="launch-stock" value={quoteId} onChange={event => setQuoteId(event.target.value as LaunchQuoteId)}>{LAUNCH_QUOTE_ASSETS.filter(item => item.kind === 'stock').map(item => <option key={item.id} value={item.id}>{item.symbol} — {item.name}</option>)}</select></label>}</fieldset>
        <fieldset><legend>TRADING FEE</legend><div className="launch-options launch-fees">{([3000,10000,20000] as const).map(value => <button type="button" key={value} aria-pressed={fee === value} onClick={() => setFee(value)}><b>{value / 10000}%</b></button>)}</div><p className="launch-fine">Collected on swaps, in both pool tokens.</p></fieldset>
        <div className="launch-split"><span>FEES THAT GIVE BACK</span><b>{config ? `${percent(config.friendShares)} ${mode === 'friend' ? 'YOUR RF' : 'YOU'} · ${percent(config.treasuryShares)} PRIZES · 5% DOPPLER` : `85% ${mode === 'friend' ? 'YOUR RF' : 'YOU'} · 10% PRIZES · 5% DOPPLER`}</b><small>{config ? mode === 'friend' ? 'Creator fees belong to your Rare Friend’s wallet.' : 'Creator fees belong to your connected wallet.' : 'The creator keeps 85%. 10% funds RarePet prizes. Doppler receives 5%.'}</small></div>
        <button className="launch-primary" disabled={imageBusy || unresolved} type="submit">REVIEW {preview || !enabled ? 'PREVIEW' : 'LAUNCH'} <span>↗</span></button>
        <p className="launch-fine launch-center">1 billion tokens · 100% to liquidity · no creator allocation</p>
      </form> : <div className="launch-review">
        {!asset && !unresolved && <button className="launch-back" disabled={busy} onClick={() => { setReview(null); setPrepared(null); setError(''); setStatus(''); }}>← EDIT TOKEN</button>}
        <div className="launch-token"><img src={review.image.previewUrl} alt={`${review.name} token artwork`}/><div><h4>{review.name}</h4><span>${review.symbol} / {quote.symbol}</span></div></div>
        <dl><div><dt>NETWORK / PAIR</dt><dd>Robinhood · {quote.symbol}<a href={explorer(quote.address)} target="_blank" rel="noreferrer">{quote.address} ↗</a></dd></div><div><dt>TRADING FEE</dt><dd>{review.fee / 10000}% of each swap</dd></div><div><dt>SUPPLY / LIQUIDITY</dt><dd>1,000,000,000 tokens · 100% in the pool</dd></div><div><dt>STARTING VALUE</dt><dd>{prepared ? `Approximately $${Math.round(prepared.review.approximateStartMarketCapUSD).toLocaleString()}` : 'Approximately $10,000'} fully diluted value<small>Fixed launch curve. Price changes as people trade.</small></dd></div><div><dt>CREATOR WALLET</dt><dd>{creator ?? (mode === 'friend' ? 'Choose a Friend you own to launch.' : 'Connect your wallet to launch.')}</dd></div><div><dt>FEE SPLIT</dt><dd>{config ? <>{percent(config.friendShares)} {mode === 'friend' ? 'RF' : 'creator'} · {percent(config.treasuryShares)} prize treasury · 5% Doppler<small>Treasury: {config.treasury}</small><small>Doppler: {config.protocol}</small></> : <>85% creator · 10% RarePet treasury · 5% Doppler<small>Treasury: {launchTreasury}</small></>}</dd></div>{prepared && <><div><dt>PRICE REFERENCE</dt><dd>{prepared.draft.quote.usdPrice} USD / {quote.symbol}<small>Chainlink observation: {new Date(prepared.draft.quote.updatedAt * 1000).toLocaleString()}</small><small>Review expires in {Math.max(0, prepared.draft.quote.expiresAt - now)}s. Refresh to use a new quote.</small></dd></div><div><dt>NETWORK FEE</dt><dd>Paid by your connected owner wallet<small>{prepared.gasEstimate ? `${prepared.gasEstimate.toLocaleString()} estimated gas units. ` : ''}Your wallet shows the final ETH cost.</small></dd></div></>}</dl>
        <p className="launch-fine">The token starts with one-sided liquidity. Buyers add {quote.symbol}; liquidity and a starting value do not guarantee buyers or a market value. Token details, artwork and fee settings are public.</p>
        {asset ? <a className="launch-primary" href={`${PET_DEPLOYMENT.explorer}/token/${asset}`} target="_blank" rel="noreferrer">VIEW YOUR TOKEN ↗</a> : preview ? <><p className="launch-note">This is a preview. Nothing has been uploaded or launched.</p><button className="launch-primary" onClick={() => mode === 'friend' ? chooseFriend() : snapshot.status === 'wrong-network' ? void session.switchNetwork() : void session.connect()}>{mode === 'friend' ? 'CHOOSE MY FRIEND ↗' : snapshot.status === 'wrong-network' ? 'SWITCH TO ROBINHOOD' : 'CONNECT WALLET ↗'}</button></> : !enabled ? <p className="launch-note">Launch preview is ready. Live launches open after the reviewed launch contract is deployed and activated.{mode === 'friend' && !pet?.walletAddress && ' This Friend needs an active Rare Wallet.'}</p> : unresolved ? <p className="launch-note">The launch was submitted. Check its confirmation before starting another launch.</p> : prepared && !expired ? <button className="launch-primary" disabled={busy || unresolved} onClick={() => void send()}>{busy ? 'CONFIRMING…' : 'CONFIRM LAUNCH IN WALLET ↗'}</button> : <><p className="launch-fine">{expired ? 'This quote expired. Refresh the review before signing.' : 'Next: sign a message to publish your image, then review the verified launch. This step does not launch the token.'}</p><button className="launch-primary" disabled={busy || wait > 0 || unresolved} onClick={() => void prepare()}>{busy ? 'PREPARING…' : wait > 0 ? `NEXT LAUNCH IN ${Math.ceil(wait / 3600)}H` : prepared ? 'REFRESH LAUNCH REVIEW ↻' : 'PUBLISH IMAGE & VERIFY LAUNCH ↗'}</button></>}
      </div>}
      {asset && <button className="launch-back" onClick={() => { setAsset(null); setReview(null); setPrepared(null); setName(''); setSymbol(''); setStatus(''); setError(''); }}>START A NEW LAUNCH ↗</button>}
      {transaction && !busy && <div className="launch-note" role="status"><p>{transaction.status === 'confirmed' ? 'Last launch confirmed.' : transaction.status === 'failed' ? 'Last launch reverted.' : transaction.error || 'A launch is pending. Check it before launching again.'}</p>{unresolved && hash && <button disabled={rechecking} onClick={() => void recheck()}>{rechecking ? 'CHECKING…' : 'RECHECK TRANSACTION'}</button>}{unresolved && !hash && transaction.status === 'unverified' && <><a href={explorer(mode === 'self' ? creator! : pet!.owner)} target="_blank" rel="noreferrer">CHECK WALLET ACTIVITY ↗</a><p>If you cancelled the wallet request and no transaction was sent, clear it to try again.</p><button onClick={() => creator && setRareLaunchTransaction(creator, null)}>CLEAR CANCELLED REQUEST</button></>}</div>}
      {configError && <p className="launch-error" role="alert">{configError}</p>}{error && <p className="launch-error" role="alert">{error}</p>}
      {hash && <p className="launch-fine"><a href={`${PET_DEPLOYMENT.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">VIEW LAUNCH TRANSACTION ↗</a></p>}
      <p className="launch-status" role="status">{status}</p>
      {creator && launchpadContract && <LaunchHistory key={`${mode}:${creator}`} mode={mode} creator={creator} pet={pet} session={session} revision={revision} router={launchpadContract} refresh={transaction?.status === 'confirmed' ? transaction.hash : null}/>}
      <div className="launch-footer"><a href="/docs/#launch">HOW LAUNCHES WORK ↗</a><span>POWERED BY DOPPLER</span></div>
    </div>
  </>;
  return embedded ? <section className="pet-dialog launch-dialog launch-page-card" aria-labelledby="launch-heading">{content}</section> : <dialog ref={dialog} className="pet-dialog launch-dialog" aria-labelledby="launch-heading" onCancel={event => { event.preventDefault(); requestClose(); }} onClick={event => { if (event.target === dialog.current) requestClose(); }}>{content}</dialog>;
}
