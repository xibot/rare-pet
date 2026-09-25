import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createGamePreview, parseChanceGame } from '@rarefriends/friendsdk/game';
import RareRush, { GenesisRush } from '../rare-rush/index';
import rushDefinition from '../rare-rush/game.json';
import { PetBrand, Icon, PetSprite, previewFriends } from './art';
import { createPetWalletSession, listOwnedPets, verifyPet, PetDiscoveryError, type PetCollection, type PetIdentity } from './wallet';
import { applyCare, blankCare, DAY, duration, projectCare, readPreview, savePreview, type CareAction, type CareState } from './care';
import { readCare, writeCare } from './chain';
import { careContract } from './config';
import '@rarefriends/friendsdk/frame.css';
import '../rare-rush/fonts.css';
import './style.css';
import './navigation.css';

type Selected = { kind: 'preview'; index: number } | { kind: 'owned'; pet: PetIdentity; revision: number };
const actions = [
  { id: 'pet', name: 'Pet', trait: 'KINSHIP', hint: 'A little love, every day.', gain: '+1 kinship / day', max: 1 },
  { id: 'feed', name: 'Feed', trait: 'STRENGTH + STAMINA', hint: 'Good food. Strong Friend.', gain: '+1 strength · +5 stamina', max: 5 },
  { id: 'play', name: 'Play', trait: 'EXPERIENCE', hint: 'Take your Friend for a Rush.', gain: '+10 XP / completed run', max: 3 },
  { id: 'launch', name: 'Launch', trait: 'BRAIN', hint: 'Rare Launchpad is coming.', gain: '1 launch / day · soon', max: 1 },
  { id: 'poop', name: 'Poop', trait: 'HEALTH', hint: 'Let the good health flow.', gain: '+1 health / break', max: 3 },
] as const;
const statNames = ['Kinship', 'Strength', 'Stamina', 'Experience', 'Brain', 'Health', 'Rarity'] as const;
function Dialog({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`pet-dialog ${wide ? 'wide' : ''}`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === ref.current) close(); }}><div className="dialog-heading"><h2>{title}</h2><button aria-label="Close dialog" onClick={close}>×</button></div>{children}</dialog>;
}

function App() {
  const [session] = useState(createPetWalletSession);
  const wallet = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [selected, setSelected] = useState<Selected>({ kind: 'preview', index: 1 });
  const [care, setCare] = useState<CareState>(() => readPreview(previewFriends[1].tokenId));
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [frame, setFrame] = useState(0), [picker, setPicker] = useState(false), [rules, setRules] = useState(false), [playing, setPlaying] = useState(false);
  const [collection, setCollection] = useState<PetCollection>('genesis'), [manual, setManual] = useState('');
  const [owned, setOwned] = useState<PetIdentity[]>([]), [loading, setLoading] = useState(false), [selecting, setSelecting] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('A new friendship starts with a pet.');
  const [discoveryError, setDiscoveryError] = useState(''), [refresh, setRefresh] = useState(0), [pending, setPending] = useState('');
  const [confirmation, setConfirmation] = useState<'pet' | 'feed' | 'poop' | null>(null), [tx, setTx] = useState('');
  const [loadedCare, setLoadedCare] = useState(false), [reaction, setReaction] = useState('');
  const op = useRef(0), selectionOp = useRef(0), lock = useRef(false), careRef = useRef(care);
  careRef.current = care;
  const preview = selected.kind === 'preview', art = preview ? previewFriends[selected.index] : null;
  const live = selected.kind === 'owned' && selected.revision === wallet.revision && wallet.status === 'connected' ? selected.pet : null;
  const invalid = !preview && !live;
  const label = art?.label ?? live?.label ?? 'Choose your Friend';
  const state = preview ? projectCare(care, now) : care;
  const counters = { pet: state.lastPetAt && Math.floor(state.lastPetAt / DAY) === Math.floor(now / DAY) ? 1 : 0, feed: state.feedsToday, play: state.playsToday, poop: state.poopsToday, launch: 0 };
  const due = state.lastPetAt ? state.lastPetAt + DAY - now : 0;
  const counts = Object.values(counters).reduce((a, b) => a + b, 0);
  const rushClient = useMemo(() => createGamePreview(parseChanceGame(rushDefinition), { friendId: BigInt(art?.tokenId ?? live?.tokenId ?? '1'), rfBalance: 100n * 10n ** 18n, stake: 1000n * 10n ** 18n }).client, [art?.tokenId, live?.tokenId, playing]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const animation = window.setInterval(() => { if (!document.hidden && !motion.matches) setFrame(f => f + 1); }, 280);
    return () => { clearInterval(clock); clearInterval(animation); session.dispose(); };
  }, [session]);
  useEffect(() => {
    op.current++; selectionOp.current++; lock.current = false; setPending(''); setSelecting(false); setConfirmation(null); setPlaying(false); setOwned([]); setDiscoveryError('');
    if (wallet.status !== 'connected' || !wallet.account) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true);
    listOwnedPets(wallet.account, controller.signal).then(pets => { if (!controller.signal.aborted) setOwned(pets); }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof PetDiscoveryError) setOwned([...cause.partialPets]);
      setDiscoveryError(cause instanceof Error ? cause.message : 'Could not load your Friends. Retry or verify a token number.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [wallet.revision, wallet.status, wallet.account, refresh]);
  useEffect(() => {
    if (!live || !careContract || pending) { setLoadedCare(false); return; }
    let active = true; setLoadedCare(false);
    const load = () => readCare(live).then(value => { if (active) { setCare(value); setLoadedCare(true); } }).catch(cause => { if (active) { setError(cause.message); setLoadedCare(false); } });
    void load(); const timer = window.setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [live, pending]);

  function choosePreview(index: number) {
    if (lock.current) return;
    op.current++; selectionOp.current++; setSelected({ kind: 'preview', index }); setCare(readPreview(previewFriends[index].tokenId)); setPicker(false); setPlaying(false); setError(''); setTx(''); setNotice('Preview care is saved on this device.');
  }
  async function chooseOwned(which: PetCollection, tokenId: string) {
    if (lock.current) return;
    if (!wallet.account || wallet.status !== 'connected') return;
    const revision = wallet.revision, task = ++selectionOp.current; setSelecting(true); setError('');
    try {
      const pet = await verifyPet(which, tokenId, wallet.account);
      if (session.getSnapshot().revision !== revision || task !== selectionOp.current) return;
      op.current++; setSelected({ kind: 'owned', pet, revision }); setCare(blankCare()); setPicker(false); setPlaying(false); setTx('');
      setNotice(careContract ? 'Your Friend is home. Make today a rare one.' : 'Friend verified. Onchain care is awaiting deployment.');
    } catch (cause) { if (task === selectionOp.current) setError(cause instanceof Error ? cause.message : 'Could not verify this Friend.'); }
    finally { if (task === selectionOp.current) setSelecting(false); }
  }
  function reward(action: CareAction) {
    if (!art) return;
    try {
      const rewarded = careRef.current.rewardDay !== Math.floor(Date.now() / 1000 / DAY);
      const next = applyCare(careRef.current, action, Math.floor(Date.now() / 1000)); careRef.current = next; setCare(next); savePreview(art.tokenId, next);
      setReaction(action); window.setTimeout(() => setReaction(''), 1400);
      setNotice({ pet: rewarded ? 'That’s the spot. Your bond is growing. +1 daily kinship.' : 'Bond refreshed for 24 hours. Today’s kinship is already earned.', feed: 'Meal served. +1 strength, +5 stamina.', poop: 'Feeling lighter already. +1 health.', play: 'A rare run, a wiser Friend. +10 preview XP.' }[action]); setError('');
    } catch (cause) { setError((cause as Error).message); }
  }
  function act(action: CareAction) {
    if (action === 'play') { setPlaying(true); setError(''); return; }
    if (preview) reward(action); else setConfirmation(action);
  }
  async function confirm() {
    if (!confirmation || !live || lock.current) return;
    const action = confirmation, task = ++op.current; lock.current = true; setConfirmation(null); setPending('Confirm in your wallet…'); setError('');
    try {
      const result = await writeCare(session, live, action, wallet.revision, hash => { if (task === op.current) { setTx(hash); setPending('Waiting for onchain confirmation…'); } }, () => { if (task !== op.current) throw new Error('Your Friend selection changed. Choose an action again.'); });
      if (task !== op.current) return;
      setCare(result.care); setNotice(`${actions.find(a => a.id === action)!.name} confirmed onchain. Your Friend’s traits are updated.`); setReaction(action); window.setTimeout(() => setReaction(''), 1400);
    } catch (cause) { if (task === op.current) setError(cause instanceof Error ? cause.message : 'The transaction could not complete.'); }
    finally { if (task === op.current) { setPending(''); lock.current = false; } }
  }
  async function beforeRun() {
    if (projectCare(careRef.current, Math.floor(Date.now() / 1000)).playsToday >= 3) throw new Error('Your three rewarded runs are complete for today.');
    if (preview) return;
    if (!live || !session.getSnapshot().account || session.getSnapshot().revision !== selected.revision) throw new Error('Select your Friend again.');
    const check = await verifyPet(live.collection, live.tokenId, live.owner);
    if (!check.rushEligible || session.getSnapshot().revision !== selected.revision) throw new Error('This Friend is not currently eligible for Rare Rush.');
  }

  return <div className="rarepet-app">
    <div className="site-header-shell"><header className="site-header"><a className="site-logo" href="/" aria-label="RarePet home"><PetBrand/></a><nav aria-label="Main navigation"><button className="nav-how-to-play" onClick={() => setRules(true)}>HOW TO CARE</button><span className="nav-chain">ROBINHOOD CHAIN</span><button className="nav-arcade" onClick={() => wallet.status === 'wrong-network' ? void session.switchNetwork() : wallet.status === 'connected' ? setPicker(true) : void session.connect()} disabled={wallet.status === 'connecting' || wallet.status === 'switching-network'}>{wallet.status === 'connected' && wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : wallet.status === 'wrong-network' ? 'SWITCH NETWORK' : wallet.status === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'} <span aria-hidden="true">↗</span></button></nav></header></div>
    <main>
      <div className="page-title"><div><span className="eyebrow">A FRIEND FOR EVERY DAY</span><h1>My RarePet<span>.</span></h1></div><button className="change-button" disabled={!!pending} onClick={() => setPicker(true)}>CHOOSE FRIEND <span>⇄</span></button></div>
      <section className="pet-shell" aria-label="RarePet dashboard">
        <div className="shell-bar"><span><span className="tiny-cross">✦</span> {preview ? 'PREVIEW HABITAT' : 'YOUR FRIEND’S HABITAT'}</span><span className="mode-tag">{preview ? 'DEVICE DEMO' : careContract ? 'ONCHAIN CARE' : 'CARE COMING ONCHAIN'}</span></div>
        <div className="care-layout">
          <aside className="care-actions"><div className="actions-title"><span>DAILY CARE</span><span>01—05</span></div>{actions.map(a => {
            const used = counters[a.id]; const disabled = a.id === 'launch' || !!pending || invalid || (a.id !== 'pet' && used >= a.max) || (!preview && a.id !== 'play' && (!careContract || !loadedCare)) || (a.id === 'play' && !preview && !live?.rushEligible);
            return <button key={a.id} className={`care-action ${a.id === 'pet' ? 'primary-action' : ''} ${reaction === a.id ? 'activated' : ''}`} disabled={disabled} onClick={() => a.id !== 'launch' && act(a.id)} aria-label={`${a.name}${a.id === 'launch' ? ' coming soon' : `, ${a.gain}`}`}><span className="action-icon"><Icon name={a.id}/></span><span className="action-text"><strong>{a.name}{a.id === 'launch' && <em>SOON</em>}</strong><small>{a.trait}</small></span><span className="action-count">{a.id === 'launch' ? '—' : `${used}/${a.max}`}</span></button>;
          })}<div className="reset-note"><span>FRESH START IN</span><b>{duration(DAY - now % DAY)}</b><small>Daily limits · midnight UTC</small></div></aside>
          <div className={`habitat ${reaction ? `reaction-${reaction}` : ''}`}>
            <div className="habitat-heading"><div><span className="eyebrow">{preview ? 'GENERATIONS / PREVIEW' : live?.collection.toUpperCase() ?? 'WALLET CHANGED'}</span><h2>{label}</h2></div><span className="friend-status">{due > 0 ? 'FEELING LOVED' : state.lastPetAt ? 'NEEDS A LITTLE LOVE' : 'NICE TO MEET YOU'}</span></div>
            <div className="friend-stage"><div className="stage-coordinate">RF—{art?.tokenId ?? live?.tokenId ?? '000'}<br/>CARE. REPEAT. RARE.</div><div className="speech-bubble" key={reaction}>{reaction === 'pet' ? '♡ right back at you.' : reaction === 'feed' ? 'rare food. good mood.' : reaction === 'poop' ? 'ahh. much better.' : state.lastPetAt ? 'same time tomorrow?' : 'gm, new best friend.'}</div><div className={`friend-art ${reaction ? 'reacting' : ''}`}>{art ? <PetSprite sprites={art.sprites} frame={frame}/> : live ? <img className="pet-portrait" src={live.image} alt={live.label}/> : <span className="missing-friend">?</span>}</div><div className="stage-floor"/><span className="stage-mark left">+</span><span className="stage-mark right">+</span></div>
            <div className="bond-status"><span className="bond-heart">♡</span><div><b>{due > 0 ? 'A happy Friend is a rare Friend.' : 'A little love goes a long way.'}</b><span>{due > 0 ? `Pet again within ${duration(due)} to keep your streak.` : 'Pet your Friend to start a 24-hour bond.'}</span></div><span className="bond-clock">{due > 0 ? duration(due) : 'PET ME'}</span></div>
          </div>
        </div>
        <div className="trait-grid" aria-label="Pet traits">{statNames.map((name, i) => <div className={`trait ${name === 'Rarity' ? 'rarity-trait' : ''}`} key={name}><span>{name}</span><strong>{invalid ? '—' : state[name.toLowerCase() as keyof CareState].toLocaleString()}{name === 'Experience' && <small>XP</small>}</strong><div className="trait-meter" aria-hidden="true">{Array.from({ length: 10 }, (_, j) => <i key={j} className={j < (state[name.toLowerCase() as keyof CareState] === 0 ? 0 : Math.max(1, Math.min(10, state[name.toLowerCase() as keyof CareState] / (i === 3 ? 10 : 2)))) ? 'filled' : ''}/>)}</div></div>)}</div>
        <div className="streak-row"><div className="streak-heading"><span>✦</span><div><strong>{state.streak} DAY{state.streak !== 1 ? 'S' : ''} OF RARE</strong><small>Keep the bond. Grow your rarity.</small></div></div><div className="streak-days" aria-label={`${state.streak % 7} of 7 days toward the next rarity point`}>{Array.from({ length: 7 }, (_, i) => <span key={i} className={i < state.streak % 7 ? 'complete' : ''}>{i === 6 ? '✦' : String(i + 1).padStart(2, '0')}</span>)}</div><span className="streak-prize">7 DAYS <b>+1 RARITY</b></span></div>
      </section>
      <div className="activity-line"><span className="activity-label">{pending ? 'PENDING' : error ? 'NOTICE' : 'PET LOG'}</span><p role={error ? 'alert' : 'status'}>{pending || error || (invalid ? 'Your wallet changed. Choose your Friend again.' : notice)}</p><span>{counts}/12 TODAY</span></div>
      {tx && <p className="transaction-link"><a href={`https://robinhoodchain.blockscout.com/tx/${tx}`} target="_blank" rel="noreferrer">View care transaction ↗</a></p>}
      {wallet.error && <p className="inline-error" role="alert">{wallet.error}</p>}
      {wallet.status === 'unavailable' && <p className="inline-note">Use a browser with a wallet extension, or open RarePet in your wallet’s browser. The preview works without a wallet.</p>}
      <footer><span>RARE PET BY XIBOT</span><button className="footer-care" onClick={() => setRules(true)}>CARE GUIDE ↗</button><p>{preview ? 'Preview only · care stays on this device · no transactions.' : careContract ? 'Care lives onchain · original NFT traits stay unchanged.' : 'NFT ownership is live. Care transactions await contract deployment.'}</p><a href="https://rarefriends.com" target="_blank" rel="noreferrer">RARE FRIENDS ↗</a></footer><p className="credits"><a href="/credits.txt" target="_blank">Rare Friends artwork · Built with FriendSDK</a></p>
    </main>
    {picker && <Dialog title="Choose your Rare Friend" close={() => setPicker(false)}><div className="picker-content"><p>Genesis or Generations. Same Friend, a new daily ritual.</p>{wallet.status === 'connected' ? <><div className="picker-account"><span>{wallet.account?.slice(0, 8)}…{wallet.account?.slice(-6)}</span><button onClick={() => setRefresh(n => n + 1)} disabled={loading}>REFRESH</button><button onClick={() => session.disconnect()}>DISCONNECT</button></div>{loading && <p role="status">Finding your Friends on Robinhood…</p>}{discoveryError && <p className="inline-error" role="alert">{discoveryError}</p>}{!loading && !owned.length && !discoveryError && <p>No Rare Friends found in this wallet. Try another wallet or verify a token below.</p>}<div className="friend-picker">{owned.map(pet => <button key={`${pet.collection}:${pet.tokenId}`} disabled={selecting} onClick={() => void chooseOwned(pet.collection, pet.tokenId)}><img src={pet.image} alt=""/><b>{pet.label}</b><span>{pet.collection.toUpperCase()}</span></button>)}</div><form className="manual-pet" onSubmit={e => { e.preventDefault(); void chooseOwned(collection, manual); }}><label>COLLECTION<select value={collection} onChange={e => setCollection(e.target.value as PetCollection)}><option value="genesis">Genesis</option><option value="generations">Generations</option></select></label><label>TOKEN ID<input value={manual} onChange={e => setManual(e.target.value)} pattern="[1-9][0-9]{0,77}" maxLength={78} inputMode="numeric" placeholder="42" required/></label><button type="submit" disabled={selecting}>{selecting ? 'VERIFYING…' : 'VERIFY & SELECT'}</button></form></> : <><button className="solid-button" onClick={() => wallet.status === 'wrong-network' ? void session.switchNetwork() : void session.connect()}>{wallet.status === 'wrong-network' ? 'SWITCH TO ROBINHOOD' : 'CONNECT WALLET'}</button>{wallet.wallets.length > 1 && <div className="wallet-choices">{wallet.wallets.map(w => <button key={w.id} onClick={() => void session.connect(w.id)}>{w.name}</button>)}</div>}<p className="inline-note">A connection only reads your NFTs. Care actions ask you to confirm a transaction.</p></>}{error && <p className="inline-error" role="alert">{error}</p>}<div className="preview-picker-title"><b>JUST LOOKING?</b><span>Try a canonical Friend in device demo.</span></div><div className="friend-picker preview-picker">{previewFriends.slice(0, 6).map((f, index) => <button key={f.tokenId} onClick={() => choosePreview(index)}><img src={f.image} alt=""/><b>{f.label}</b><span>PREVIEW</span></button>)}</div></div></Dialog>}
    {rules && <Dialog title="A little care. Every day." close={() => setRules(false)}><div className="rules-content"><p>Every Genesis and Generations Rare Friend can have a RarePet life.</p>{actions.map(a => <div className="rule" key={a.id}><Icon name={a.id}/><div><b>{a.name} {a.id === 'launch' && '— soon'}</b><p>{a.hint} {a.gain}.</p></div></div>)}<p><b>24-hour bond.</b> Pet before the timer runs out. Extra pets refresh it; kinship and streak rewards happen at most once per UTC day. Missing the window breaks the streak and costs 1 kinship per missed 24-hour period.</p><p><b>Stay rare.</b> Every 7 consecutive daily pets adds 1 rarity. Breaking the streak resets this streak-based rarity. Feed, Play and Poop limits reset at midnight UTC.</p><p><b>Play to learn.</b> Preview XP arrives after a finished Rare Rush run, up to 3 a day. Live XP requires a trusted completion receipt; that service is not connected yet. Launch and Brain are coming with Rare Launchpad.</p><p className="inline-note">RarePet adds care stats without changing your original NFT traits. Live care requires the new contract to be deployed. Preview care is stored on this device and has no onchain value.</p></div></Dialog>}
    {confirmation && live && <Dialog title={`Confirm ${confirmation}`} close={() => setConfirmation(null)}><div className="rules-content"><p>{actions.find(a => a.id === confirmation)!.gain} for <b>{live.label}</b>.</p><p>This sends a transaction on Robinhood Chain. Your wallet shows the network fee before you approve. No token approval or NFT transfer is needed.</p><p className="contract-address">Care contract: {careContract}</p><button className="solid-button" onClick={() => void confirm()}>CONTINUE TO WALLET</button></div></Dialog>}
    {playing && !invalid && <Dialog title={`Rare Rush / ${label}`} close={() => setPlaying(false)} wide><div className="rush-context">{preview ? 'Finish a run to earn +10 preview XP. Up to 3 rewarded runs per UTC day.' : 'Play with your Friend. Onchain XP receipts are not connected yet.'}</div><div className="pet-rush">{live?.collection === 'genesis' ? <GenesisRush friendId={BigInt(live.tokenId)} portraitUrl={live.image} paused={false} beforeRun={beforeRun} onNavigate={() => setPlaying(false)}/> : <RareRush friendId={BigInt(art?.tokenId ?? live!.tokenId)} client={rushClient} paused={false} beforeRun={beforeRun} previewSprites={art?.sprites} onRunComplete={() => { if (preview) reward('play'); }} onNavigate={() => setPlaying(false)}/>}</div></Dialog>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
