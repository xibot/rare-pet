import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createGamePreview, parseChanceGame } from '@rarefriends/friendsdk/game';
import RareRush, { GenesisRush } from '../rare-rush/index';
import rushDefinition from '../rare-rush/game.json';
import { PetBrand, Icon, PetSprite, GenesisPetSprite, previewFriends, GENESIS_BODIES, DEFAULT_BODY_ID, pickGenesisBody, type PreviewFriend } from './art';
import { IslandPicker, HabitatIsland, FriendMotion } from './habitat';
import { getIsland, restoreIsland, type Island } from './islands';
import { createPetWalletSession, listOwnedPets, verifyPet, PetDiscoveryError, type PetCollection, type PetIdentity } from './wallet';
import { applyCare, blankCare, DAY, PET_GRACE, actionAvailability, duration, projectCare, readPreview, savePreview, type CareAction, type CareState } from './care';
import { readCare, writeCare } from './chain';
import { CARE_ACTIONS, DEFAULT_CARE_RULES, actionGain, actionSchedule } from './care-policy';
import { careContract, launchpadContract } from './config';
import { LaunchDialog } from './LaunchDialog';
import { readRareLaunchConfig, type RareLaunchConfig } from './launch-doppler';
import { Docs } from './Docs';
import { HowToCare } from './HowToCare';
import { PlayDialog } from './PlayDialog';
import { SpaceBackdrop } from './SpaceBackdrop';
import { islandFlights } from './islandFlights';
import { ShareDialog } from './ShareDialog';
import { RareWalletDialog } from './RareWalletDialog';
import { MarketDialog } from './MarketDialog';
import type { ShareAction } from './share-image';
import '@rarefriends/friendsdk/frame.css';
import '../rare-rush/fonts.css';
import './style.css';
import './navigation.css';
import './habitat.css';
import './preview.css';
import './action-timers.css';
import './care-ledger.css';

type Selected = { kind: 'preview'; index: number } | { kind: 'owned'; pet: PetIdentity; revision: number };
const previewKey = (friend: PreviewFriend) => friend.collection === 'genesis' ? `genesis:${friend.tokenId}` : friend.tokenId;
function savedChoice(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function saveChoice(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Keep cosmetic choices usable without storage. */ }
}
function savedPreviewIndex() {
  const saved = savedChoice('rarepet:friend:v1', '');
  const index = previewFriends.findIndex(friend => `${friend.collection}:${friend.tokenId}` === saved);
  return index < 0 ? 1 : index;
}
const actions = [
  { id: 'pet', name: 'Pet', trait: 'KINSHIP', hint: 'A little love, every day.', gain: '+1 kinship', schedule: '1 EVERY 24H' },
  { id: 'feed', name: 'Feed', trait: 'STRENGTH + STAMINA', hint: 'Good food. Strong Friend.', gain: '+1 strength · +5 stamina', schedule: '1 EVERY 4H' },
  { id: 'play', name: 'Play', trait: 'EXPERIENCE', hint: 'Take your Friend for a Rush.', gain: '+10 XP / completed run', schedule: '3 IN 24H' },
  { id: 'launch', name: 'Launch', trait: 'BRAIN', hint: 'Launch a token with your Friend.', gain: '+1 brain / confirmed launch', schedule: '1 EVERY 24H' },
  { id: 'poop', name: 'Poop', trait: 'HEALTH', hint: 'Let the good health flow.', gain: '+1 health / break', schedule: '1 EVERY 4H' },
] as const;
const statNames = ['Kinship', 'Strength', 'Stamina', 'Experience', 'Brain', 'Health', 'Rarity'] as const;
type TraitKey = Lowercase<(typeof statNames)[number]>;
function Dialog({ title, children, close, className = '' }: { title: string; children: ReactNode; close: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`pet-dialog ${className}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === ref.current) close(); }}><div className="dialog-heading"><h2 id={titleId}>{title}</h2><button aria-label="Close dialog" onClick={close}>×</button></div>{children}</dialog>;
}

function App() {
  const launchPage = /^\/launch(?:\/|\/index\.html)?$/.test(location.pathname);
  const [session] = useState(createPetWalletSession);
  const [pageLaunchMode, setPageLaunchMode] = useState<'self' | 'friend'>('self');
  const wallet = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [lastPreview, setLastPreview] = useState(savedPreviewIndex);
  const [selected, setSelected] = useState<Selected>(() => ({ kind: 'preview', index: lastPreview }));
  const [care, setCare] = useState<CareState>(() => readPreview(previewKey(previewFriends[lastPreview])));
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [frame, setFrame] = useState(0), [picker, setPicker] = useState(false), [rules, setRules] = useState(false), [playing, setPlaying] = useState(false);
  const [collection, setCollection] = useState<PetCollection>('genesis'), [manual, setManual] = useState('');
  const [pickerMode, setPickerMode] = useState<'preview' | 'wallet'>('preview');
  const [previewCollection, setPreviewCollection] = useState<PetCollection>(() => previewFriends[lastPreview].collection);
  const [island, setIsland] = useState<Island>(() => restoreIsland(savedChoice('rarepet:island:v1', 'garden')));
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);
  const flightLayout = useMemo(() => islandFlights(getIsland(island), stageWidth, stageHeight), [island, stageWidth, stageHeight]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setStageWidth(stage.clientWidth); setStageHeight(stage.clientHeight);
    const observer = new ResizeObserver(([entry]) => { setStageWidth(entry.contentRect.width); setStageHeight(entry.contentRect.height); });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const [bodyId, setBodyId] = useState(() => {
    const saved = savedChoice('rarepet:body:v1', DEFAULT_BODY_ID);
    return GENESIS_BODIES.some(body => body.id === saved) ? saved : DEFAULT_BODY_ID;
  });
  const [owned, setOwned] = useState<PetIdentity[]>([]), [loading, setLoading] = useState(false), [selecting, setSelecting] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('A new friendship starts with a pet.');
  const [discoveryError, setDiscoveryError] = useState(''), [refresh, setRefresh] = useState(0), [pending, setPending] = useState('');
  const [confirmation, setConfirmation] = useState<'pet' | 'feed' | 'poop' | null>(null), [tx, setTx] = useState('');
  const [loadedCare, setLoadedCare] = useState(false), [reaction, setReaction] = useState<CareAction | ''>('');
  const [reactionSequence, setReactionSequence] = useState(0), [reactionVariant, setReactionVariant] = useState(0);
  const [sharing, setSharing] = useState(false), [shareAction, setShareAction] = useState<ShareAction>('pet');
  const [rareWallet, setRareWallet] = useState(false), [launching, setLaunching] = useState(false);
  const [market, setMarket] = useState(false);
  const [walletAccount, setWalletAccount] = useState(false);
  const [launchConfig, setLaunchConfig] = useState<RareLaunchConfig | null>(null), [launchRefresh, setLaunchRefresh] = useState(0);
  const reactionTimer = useRef<number | undefined>(undefined), reactionCounts = useRef({ pet: 0, feed: 0, poop: 0, play: 0 });
  const playCelebration = useRef(false);
  const op = useRef(0), selectionOp = useRef(0), lock = useRef(false), careRef = useRef(care);
  careRef.current = care;
  const preview = selected.kind === 'preview', art = preview ? previewFriends[selected.index] : null;
  const live = selected.kind === 'owned' && selected.revision === wallet.revision && wallet.status === 'connected' ? selected.pet : null;
  const invalid = !preview && !live;
  const isGenesis = (art?.collection ?? live?.collection) === 'genesis';
  const label = art?.label ?? live?.label ?? 'Choose your Friend';
  const state = invalid ? blankCare() : preview ? projectCare(care, now) : care;
  const activeRules = state.policy?.rules ?? DEFAULT_CARE_RULES;
  const careKnown = preview || (!!state.policy && loadedCare);
  const careActions = actions.map(action => action.id === 'launch' ? action : { ...action,
    gain: careKnown ? actionGain(action.id, activeRules) : 'Onchain reward policy',
    schedule: careKnown ? actionSchedule(action.id, activeRules) : 'AWAITING POLICY' });
  const hasPet = state.lastPetAt >= 0;
  const petReady = actionAvailability(state, 'pet', now);
  const nextPlayAt = Math.min(...state.playTimes.filter(time => time + DAY > now).map(time => time + DAY));
  const graceDeadline = state.policy?.petSchedule.graceDeadline ?? (hasPet ? state.lastPetAt + DAY + PET_GRACE : 0);
  const due = hasPet ? Math.max(0, graceDeadline - now) : 0;
  const nextRarityAt = state.policy?.petSchedule.nextRarityAt || (Math.floor(state.streak / activeRules.rarityEvery) + 1) * activeRules.rarityEvery;
  const nextRarityPoints = state.policy?.petSchedule.nextRarityAt ? state.policy.petSchedule.nextRarityPoints : activeRules.rarityPoints;
  const rarityRemaining = Math.max(0, nextRarityAt - state.streak);
  const rushClient = useMemo(() => createGamePreview(parseChanceGame(rushDefinition), { friendId: BigInt(art?.tokenId ?? live?.tokenId ?? '1'), rfBalance: 100n * 10n ** 18n, stake: 1000n * 10n ** 18n }).client, [art?.tokenId, live?.tokenId, playing]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const animation = window.setInterval(() => { if (!document.hidden && !motion.matches) setFrame(f => f + 1); }, 280);
    return () => { clearInterval(clock); clearInterval(animation); clearTimeout(reactionTimer.current); session.dispose(); };
  }, [session]);
  useEffect(() => {
    if (wallet.status === 'disconnected' || wallet.status === 'unavailable' || wallet.status === 'error') setWalletAccount(false);
  }, [wallet.status]);
  useEffect(() => {
    op.current++; selectionOp.current++; lock.current = false; setPending(''); setSelecting(false); setConfirmation(null); setPlaying(false); setSharing(false); setRareWallet(false); setLaunching(false); playCelebration.current = false; setOwned([]); setDiscoveryError(''); clearReaction();
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
    let active = true, fetching = false, deadlineTimer: number | undefined; setLoadedCare(false);
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try { const value = await readCare(live); if (active) {
        setCare(value); setLoadedCare(true); clearTimeout(deadlineTimer);
        const policy = value.policy!;
        const deadlines = [...Object.values(policy.availability).filter(item => item.enabled && !item.remaining).map(item => item.readyAt), policy.petSchedule.graceDeadline + 1]
          .filter(time => time > policy.blockTimestamp);
        if (deadlines.length) deadlineTimer = window.setTimeout(() => void load(), Math.min(30_000, Math.max(1_000, (Math.min(...deadlines) - Date.now() / 1000) * 1000)));
      } }
      catch (cause) { if (active) { setError(cause instanceof Error ? cause.message : 'Care could not be loaded. Please retry.'); setLoadedCare(false); } }
      finally { fetching = false; }
    };
    void load(); const timer = window.setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); clearTimeout(deadlineTimer); };
  }, [live, pending]);

  useEffect(() => {
    setLaunchConfig(null);
    const router = launchpadContract;
    if (!live?.walletAddress || !router) return;
    let active = true, fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try { const value = await readRareLaunchConfig(router, live); if (active) setLaunchConfig(value); }
      catch { if (active) setLaunchConfig(null); }
      finally { fetching = false; }
    };
    void load(); const timer = window.setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [live, launchRefresh]);

  function choosePreview(index: number) {
    if (lock.current) return;
    setLastPreview(index); setPreviewCollection(previewFriends[index].collection); saveChoice('rarepet:friend:v1', `${previewFriends[index].collection}:${previewFriends[index].tokenId}`);
    const next = readPreview(previewKey(previewFriends[index]));
    op.current++; selectionOp.current++; setSelecting(false); setConfirmation(null); setSelected({ kind: 'preview', index }); careRef.current = next; setCare(next); setPicker(false); setPlaying(false); setError(''); setTx(''); clearReaction(); setNotice('Preview care is saved on this device.');
  }
  function openPicker(mode: 'preview' | 'wallet') { setPickerMode(mode); setPicker(true); }
  function openWallet() {
    if (lock.current) return;
    if (wallet.account) { setWalletAccount(true); return; }
    openPicker('wallet');
    void session.connect();
  }
  function disconnectWallet() {
    setWalletAccount(false);
    session.disconnect();
  }
  function clearReaction() { clearTimeout(reactionTimer.current); setReaction(''); }
  function animate(action: CareAction) {
    clearTimeout(reactionTimer.current);
    if (action !== 'play') setShareAction(action);
    setReactionVariant(reactionCounts.current[action]++ % 3); setReactionSequence(n => n + 1); setReaction(action);
    reactionTimer.current = window.setTimeout(() => setReaction(''), 2400);
  }
  function closePlay() {
    setPlaying(false);
    if (playCelebration.current) { playCelebration.current = false; animate('play'); }
  }
  function resetPreview() {
    if (!art || lock.current) return;
    const next = blankCare(); careRef.current = next; setCare(next); savePreview(previewKey(art), next); clearReaction(); setError('');
    setNotice('A fresh preview. Try the daily routine again.');
  }
  function chooseIsland(next: Island) { setIsland(next); saveChoice('rarepet:island:v1', next); }
  function changeBody() { const next = pickGenesisBody(bodyId); setBodyId(next); saveChoice('rarepet:body:v1', next); }
  async function chooseOwned(which: PetCollection, tokenId: string) {
    if (lock.current) return;
    if (!wallet.account || wallet.status !== 'connected') return;
    const revision = wallet.revision, task = ++selectionOp.current; setSelecting(true); setError('');
    try {
      const pet = await verifyPet(which, tokenId, wallet.account);
      if (session.getSnapshot().revision !== revision || task !== selectionOp.current) return;
      op.current++; setSelected({ kind: 'owned', pet, revision }); careRef.current = blankCare(); setCare(careRef.current); setPicker(false); setPlaying(false); setTx(''); clearReaction();
      setNotice(careContract ? 'Your Friend is home. Make today a rare one.' : 'Friend verified. Onchain care is not configured in this build.');
    } catch (cause) { if (task === selectionOp.current) setError(cause instanceof Error ? cause.message : 'Could not verify this Friend.'); }
    finally { if (task === selectionOp.current) setSelecting(false); }
  }
  function reward(action: CareAction) {
    if (!art) return;
    try {
      const next = applyCare(careRef.current, action, Math.floor(Date.now() / 1000)); careRef.current = next; setCare(next); savePreview(previewKey(art), next);
      if (action === 'play') playCelebration.current = true; else animate(action);
      setNotice({ pet: 'That’s the spot. +1 kinship. Your next pet unlocks in 24 hours.', feed: 'Meal served. +1 strength, +5 stamina.', poop: 'Feeling lighter already. +1 health.', play: 'A rare run, a wiser Friend. +10 preview XP.' }[action]); setError('');
    } catch (cause) { setError((cause as Error).message); }
  }
  function act(action: CareAction) {
    if (action === 'play') { playCelebration.current = false; clearReaction(); setPlaying(true); setError(''); return; }
    if (preview) reward(action); else setConfirmation(action);
  }
  async function confirm() {
    if (!confirmation || !live || lock.current) return;
    const action = confirmation, task = ++op.current; lock.current = true; setConfirmation(null); setPending('Confirm in your wallet…'); setError('');
    try {
      const result = await writeCare(session, live, action, wallet.revision, hash => { if (task === op.current) { setTx(hash); setPending('Waiting for onchain confirmation…'); } }, () => { if (task !== op.current) throw new Error('Your Friend selection changed. Choose an action again.'); }, care.policy?.version);
      if (task !== op.current) return;
      setCare(result.care); setNotice(`${actions.find(a => a.id === action)!.name} confirmed onchain. Your Friend’s traits are updated.`); animate(action);
    } catch (cause) { if (task === op.current) setError(cause instanceof Error ? cause.message : 'The transaction could not complete.'); }
    finally { if (task === op.current) { setPending(''); lock.current = false; } }
  }
  async function beforeRun() {
    if (preview && !actionAvailability(careRef.current, 'play', Math.floor(Date.now() / 1000)).remaining) throw new Error('All three preview Play slots are used. A slot returns 24 hours after its completed run.');
    if (preview) return;
    if (!live || !session.getSnapshot().account || session.getSnapshot().revision !== selected.revision) throw new Error('Select your Friend again.');
    const check = await verifyPet(live.collection, live.tokenId, live.owner);
    if (!check.rushEligible || session.getSnapshot().revision !== selected.revision) throw new Error('This Friend is not currently eligible for Rare Rush.');
  }

  return <div className="rarepet-app">
    <div className="site-header-shell"><header className="site-header"><a className="site-logo" href="/" aria-label="RarePet home"><PetBrand/></a><nav aria-label="Main navigation"><button className="nav-how-to-play" onClick={() => setRules(true)}>HOW TO CARE</button><a className="nav-docs" href="/docs/">DOCS</a><button className="nav-arcade" onClick={openWallet} aria-haspopup="dialog" aria-label={wallet.account ? 'Manage connected wallet' : undefined} disabled={!!pending || wallet.status === 'connecting' || wallet.status === 'switching-network'}>{wallet.status === 'connected' && wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : wallet.status === 'wrong-network' ? 'SWITCH NETWORK' : wallet.status === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'} <span aria-hidden="true">↗</span></button></nav></header></div>
    {!launchPage && <main>
      <div className="page-title"><div><span className="eyebrow">A FRIEND FOR EVERY DAY</span><h1>My RarePet<span>.</span></h1></div><button className="change-button" disabled={!!pending} onClick={() => openPicker(preview ? 'preview' : 'wallet')}>CHOOSE FRIEND <span>⇄</span></button></div>
      <div className="mode-bar"><div className="mode-switch" role="group" aria-label="Pet mode"><button aria-pressed={preview} disabled={!!pending} onClick={() => { if (!preview) choosePreview(lastPreview); }}>PREVIEW</button><button aria-pressed={!preview} disabled={!!pending} onClick={() => openPicker('wallet')}>MY WALLET <span aria-hidden="true">↗</span></button></div><p>{preview ? 'Try the daily routine. No wallet needed.' : 'Your own Friend. Your daily ritual.'}</p>{preview && <button className="reset-preview" onClick={resetPreview}>RESET PREVIEW ↻</button>}</div>
      <section className="pet-shell" aria-label="RarePet dashboard">
        <div className="shell-bar"><span><span className="tiny-cross">✦</span> {preview ? 'PREVIEW HABITAT' : 'YOUR FRIEND’S HABITAT'}</span><span className="mode-tag">{preview ? 'PREVIEW MODE' : careContract ? 'ONCHAIN CARE' : 'CARE NOT CONFIGURED'}</span></div>
        <div className="care-layout">
          <aside className="care-actions"><div className="actions-title"><span>DAILY CARE</span><span>01—07</span></div>{careActions.map(a => {
            const availability = actionAvailability(state, a.id, now);
            const practice = a.id === 'play' && !preview;
            const paused = a.id !== 'launch' && !practice && !preview && careKnown && !state.policy!.availability[a.id].enabled;
            const unavailableCare = !preview && a.id !== 'play' && a.id !== 'launch' && (!careContract || !loadedCare);
            const disabled = !!pending || invalid || (a.id !== 'launch' && !practice && !availability.remaining) || unavailableCare || paused || (practice && !live?.rushEligible);
            const timer = a.id === 'launch' ? preview || !launchpadContract ? 'PREVIEW' : launchConfig ? launchConfig.readyAt > BigInt(now) ? duration(Number(launchConfig.readyAt) - now) : 'READY' : 'OPEN LAUNCH' : invalid ? 'CHOOSE FRIEND' : practice ? 'PRACTICE · XP SOON' : unavailableCare ? careContract ? 'LOADING' : 'NOT CONFIGURED' : paused ? 'PAUSED' : availability.waitSeconds ? duration(availability.waitSeconds) : !availability.remaining ? 'REFRESHING' : a.id === 'play' ? `${availability.remaining}/${activeRules.actions.play.dailyLimit} READY` : 'READY';
            return <button key={a.id} className={`care-action ${a.id === 'pet' ? 'primary-action' : ''} ${reaction === a.id ? 'activated' : ''}`} disabled={disabled} onClick={() => a.id === 'launch' ? setLaunching(true) : act(a.id)} aria-label={`${a.name}, ${practice ? 'practice only, no onchain XP' : a.gain}`} aria-describedby={`timer-${a.id}`}><span className="action-icon"><Icon name={a.id}/></span><span className="action-text"><strong>{a.name}</strong><small>{a.trait}</small></span><span className="action-timing" id={`timer-${a.id}`}><span>{practice ? 'XP VERIFIER COMING SOON' : a.schedule}</span><b data-countdown={a.id}>{timer}</b>{a.id === 'play' && !practice && availability.remaining > 0 && availability.remaining < activeRules.actions.play.dailyLimit && Number.isFinite(nextPlayAt) && <small className="action-refill">NEXT {duration(nextPlayAt - now)}</small>}</span></button>;
          })}<button className="care-action rare-wallet-action" disabled={!!pending || invalid} onClick={() => setRareWallet(true)} aria-label="Rare Wallet"><span className="action-icon"><Icon name="wallet"/></span><span className="action-text"><strong>Rare Wallet</strong><small>YOUR FRIEND’S ASSETS</small></span><span className="action-timing"><b>OPEN WALLET ↗</b></span></button><button className="care-action rare-wallet-action market-action" disabled={!!pending} onClick={() => setMarket(true)} aria-label="Buy / Sell"><span className="action-icon"><Icon name="trade"/></span><span className="action-text"><strong>Buy / Sell</strong><small>RAREPET TOKENS</small></span><span className="action-timing"><b>OPEN MARKET ↗</b></span></button><div className="reset-note"><span>YOUR FRIEND’S RHYTHM</span><small>Each action has its own timer.</small><a href="/docs/#care">HOW TIMERS WORK ↗</a></div></aside>
          <div className={`habitat ${reaction ? `reaction-${reaction}` : ''}`}>
            <div className="habitat-heading"><div><span className="eyebrow">{preview ? `${art!.collection.toUpperCase()} / PREVIEW` : live?.collection.toUpperCase() ?? 'WALLET CHANGED'}</span><h2>{label}</h2></div><div className="friend-status-actions"><span className="friend-status">{due > 0 ? petReady.remaining ? 'READY FOR LOVE' : 'FEELING LOVED' : hasPet ? 'NEEDS A LITTLE LOVE' : 'NICE TO MEET YOU'}</span><button className="habitat-share-button" disabled={invalid || !!pending} onClick={() => setSharing(true)} aria-label="Share your Rare Friend">SHARE <span aria-hidden="true">↗</span></button></div></div>
            <div className="friend-stage" ref={stageRef} style={{ minHeight: flightLayout.minHeight }}><SpaceBackdrop mainIsland={island} stageWidth={stageWidth} flights={flightLayout.flights}/><div className="stage-coordinate">RF—{art?.tokenId ?? live?.tokenId ?? '000'}<br/>CARE. REPEAT. RARE.</div><HabitatIsland island={island} stageWidth={stageWidth}><FriendMotion speech={reaction === 'pet' ? '♡ right back at you.' : reaction === 'feed' ? 'rare food. good mood.' : reaction === 'poop' ? 'ahh. much better.' : reaction === 'play' ? 'one run wiser. +10 XP!' : hasPet ? 'same time tomorrow?' : 'gm, new best friend.'} action={reaction} sequence={reactionSequence} variant={reactionVariant}>{isGenesis ? <GenesisPetSprite portraitUrl={(art ?? live)!.image} bodyId={bodyId} frame={frame} walking={reaction === 'play'}/> : art?.collection === 'generations' ? <PetSprite sprites={art.sprites} frame={frame} walking={reaction === 'play'}/> : live?.sprites ? <PetSprite sprites={live.sprites} frame={frame} walking={reaction === 'play'}/> : <span className="missing-friend">?</span>}</FriendMotion></HabitatIsland><span className="stage-mark left">+</span><span className="stage-mark right">+</span></div>
            <div className="habitat-customize"><IslandPicker value={island} onChange={chooseIsland}/>{isGenesis && <button className="change-body" onClick={changeBody} title="Try one of 36 cosmetic bodies">CHANGE BODY <span aria-hidden="true">↻</span><small>36 COSMETIC BODIES</small></button>}</div>
            <div className="bond-status"><span className="bond-heart">♡</span><div><b>{due > 0 ? 'A happy Friend is a rare Friend.' : 'A little love goes a long way.'}</b><span>{due > 0 ? petReady.waitSeconds ? `Next pet in ${duration(petReady.waitSeconds)}. This streak’s grace deadline: ${new Date(graceDeadline * 1000).toLocaleString()}.` : `Pet within ${duration(due)} to keep your streak.` : 'Pet your Friend to start a daily streak.'}</span></div><span className="bond-clock">{due > 0 ? duration(due) : 'PET ME'}</span></div>
          </div>
        </div>
        <div className="trait-grid" aria-label="Pet traits">{statNames.map((name, i) => <div className={`trait ${name === 'Rarity' ? 'rarity-trait' : ''}`} key={name}><span>{name}</span><strong>{invalid ? '—' : name === 'Brain' && !preview ? launchpadContract ? launchConfig?.brain.toLocaleString() ?? '—' : '0' : state[name.toLowerCase() as TraitKey].toLocaleString()}{name === 'Experience' && <small>XP</small>}</strong><div className="trait-meter" aria-hidden="true">{Array.from({ length: 10 }, (_, j) => <i key={j} className={j < ((name === 'Brain' && !preview ? Number(launchConfig?.brain ?? 0n) : state[name.toLowerCase() as TraitKey]) === 0 ? 0 : Math.max(1, Math.min(10, (name === 'Brain' && !preview ? Number(launchConfig?.brain ?? 0n) : state[name.toLowerCase() as TraitKey]) / (i === 3 ? 10 : 2)))) ? 'filled' : ''}/>)}</div></div>)}</div>
        <div className="streak-row"><div className="streak-heading"><span>✦</span><div><strong>{state.streak} PET{state.streak !== 1 ? 'S' : ''} IN A ROW</strong><small>Keep the bond. Grow your rarity.</small></div></div><div className="streak-days" aria-label={`${rarityRemaining} more pets toward the next rarity reward`}>{Array.from({ length: Math.min(7, nextRarityAt) }, (_, i) => <span key={i} className={i < Math.max(0, Math.min(7, nextRarityAt) - rarityRemaining) ? 'complete' : ''}>{i === Math.min(7, nextRarityAt) - 1 ? '✦' : String(i + 1).padStart(2, '0')}</span>)}</div><span className="streak-prize">{careKnown ? `${rarityRemaining} MORE PET${rarityRemaining === 1 ? '' : 'S'}` : 'AWAITING POLICY'} <b>{careKnown ? `+${nextRarityPoints} RARITY` : '—'}</b></span></div>
        <details className="care-ledger"><summary>{preview ? 'PREVIEW CARE HISTORY' : 'PERMANENT CARE RECORD'} <span>{preview ? 'THIS DEVICE' : state.policy ? `RULES V${state.policy.version}` : 'ONCHAIN'}</span></summary>
          {careKnown && state.lifetime ? <div className="care-ledger-content"><p>{preview ? 'Practice totals saved on this device. Reset Preview clears them; they are not onchain.' : 'Lifetime earned points and action records stay with this Friend. Missed care can reduce current kinship and reset streak rarity; it never erases earned totals.'}</p>
            {!state.lifetime.complete && <p className="care-ledger-note">Your older preview traits are preserved. Totals below track new actions since this history feature was added; older lifetime totals are unknown.</p>}
            <dl className="care-ledger-totals">{(['kinship', 'strength', 'stamina', 'health', 'experience', 'rarity', 'bestStreak'] as const).map(key => <div key={key}><dt>{key === 'bestStreak' ? 'BEST STREAK' : key.toUpperCase()}</dt><dd>{state.lifetime![key].toLocaleString()}</dd></div>)}</dl>
            <p className="care-ledger-counts">{CARE_ACTIONS.map(action => `${action.toUpperCase()} ${state.lifetime!.actionCounts[action].toLocaleString()}`).join(' · ')}</p>
            <p className="care-ledger-note">Launch stays fixed: +1 Brain per confirmed launch, once every 24 hours, in the separate launchpad ledger.</p>
            {!!state.history?.length ? <ol className="care-ledger-history">{[...state.history].reverse().map(record => <li key={record.sequence}><b>{record.action.toUpperCase()}</b><span>{actionGain(record.action, { ...activeRules, actions: { ...activeRules.actions, [record.action]: { ...activeRules.actions[record.action], points: record.points, secondaryPoints: record.secondaryPoints } } })}{record.rarityPoints ? ` · +${record.rarityPoints} rarity` : ''}</span><time dateTime={new Date(record.timestamp * 1000).toISOString()}>{new Date(record.timestamp * 1000).toLocaleString()}</time><small>{preview ? 'PREVIEW' : `RULES V${record.ruleVersion}`}</small></li>)}</ol> : <p>No care actions recorded yet.</p>}
            {!preview && state.policy && <a href={`https://robinhoodchain.blockscout.com/address/${careContract}?tab=read_contract`} target="_blank" rel="noreferrer">READ THE FULL ONCHAIN RECORD ↗</a>}
          </div> : <div className="care-ledger-content"><p>{careContract ? 'Select a Friend and load its verified care record.' : 'Onchain care history is not configured in this build. Preview totals stay on this device.'}</p></div>}
        </details>
      </section>
      <div className="activity-line"><span className="activity-label">{pending ? 'PENDING' : error ? 'NOTICE' : 'PET LOG'}</span><p role={error ? 'alert' : 'status'}>{pending || error || (invalid ? 'Your wallet changed. Choose your Friend again.' : notice)}</p><a className="activity-docs" href="/docs/">DOCS ↗</a></div>
      {tx && <p className="transaction-link"><a href={`https://robinhoodchain.blockscout.com/tx/${tx}`} target="_blank" rel="noreferrer">View care transaction ↗</a></p>}
      {wallet.error && <p className="inline-error" role="alert">{wallet.error}</p>}
      {wallet.status === 'unavailable' && !preview && <p className="inline-note">Use a browser with a wallet extension, or open RarePet in your wallet’s browser. The preview works without a wallet.</p>}
      <footer><div className="footer-brand"><span>RARE PET BY XIBOT</span><small>ROBINHOOD CHAIN</small></div><a className="footer-docs" href="/docs/">DOCS ↗</a><p>{preview ? 'Preview only · care stays on this device · no transactions.' : careContract ? 'Care lives onchain · original NFT traits stay unchanged.' : 'NFT ownership is live. Onchain care is not configured in this build.'}</p><a href="https://rarefriends.com" target="_blank" rel="noreferrer">RARE FRIENDS ↗</a></footer><p className="credits"><a href="/credits.txt" target="_blank">Rare Friends artwork · Built with FriendSDK</a></p>
    </main>}
    {launchPage && <main className="launch-page"><a className="launch-page-back" href="/">← BACK TO RAREPET</a><LaunchDialog key={`page:${(art ?? live)?.collection}:${(art ?? live)?.tokenId}:${wallet.revision}`} embedded creatorMode={pageLaunchMode} onCreatorModeChange={setPageLaunchMode} friend={(art ?? live) ?? previewFriends[lastPreview]} pet={live} session={session} revision={wallet.revision} bodyId={bodyId} close={() => {}} chooseFriend={() => openPicker('wallet')} onLaunch={() => setLaunchRefresh(value => value + 1)}/><footer><div className="footer-brand"><span>RARE PET BY XIBOT</span><small>ROBINHOOD CHAIN</small></div><a href="/docs/#launch">LAUNCH DOCS ↗</a></footer></main>}
    {walletAccount && wallet.account && <Dialog title="Your wallet" className="wallet-account-dialog" close={() => setWalletAccount(false)}><div className="wallet-account-content">
      <span className="wallet-account-label">CONNECTED WALLET</span>
      <p className="wallet-account-address">{wallet.account}</p>
      <p>Disconnect your wallet from RarePet here. Your Friends and their onchain care records stay with you.</p>
      {wallet.status === 'wrong-network' && <button className="wallet-network-button" onClick={() => void session.switchNetwork()}>SWITCH TO ROBINHOOD ↗</button>}
      {wallet.error && <p role="alert">{wallet.error}</p>}
      <div className="wallet-account-actions"><button onClick={() => setWalletAccount(false)}>KEEP CONNECTED</button><button className="wallet-disconnect-button" onClick={disconnectWallet}>DISCONNECT WALLET</button></div>
    </div></Dialog>}
    {market && <MarketDialog session={session} close={() => setMarket(false)}/>}
    {sharing && (art ?? live) && <ShareDialog friend={(art ?? live)!} island={island} bodyId={bodyId} initialAction={shareAction} initialVariant={reactionVariant} close={() => setSharing(false)}/>}
    {launching && (art ?? live) && <LaunchDialog key={`launch:${(art ?? live)!.collection}:${(art ?? live)!.tokenId}:${wallet.revision}`} friend={(art ?? live)!} pet={live} session={session} revision={wallet.revision} bodyId={bodyId} close={() => setLaunching(false)} chooseFriend={() => { setLaunching(false); openPicker('wallet'); }} onLaunch={() => setLaunchRefresh(value => value + 1)}/>}
    {rareWallet && (art ?? live) && <RareWalletDialog key={`${(art ?? live)!.collection}:${(art ?? live)!.tokenId}:${wallet.revision}`} friend={(art ?? live)!} pet={live} session={session} revision={wallet.revision} bodyId={bodyId} close={() => setRareWallet(false)} chooseFriend={() => { setRareWallet(false); openPicker('wallet'); }}/>}
    {picker && <Dialog title="Choose your Rare Friend" className="friend-picker-dialog" close={() => setPicker(false)}><div className="picker-content">
      <div className="picker-mode-switch" role="group" aria-label="Choose Friend source"><button aria-pressed={pickerMode === 'preview'} onClick={() => setPickerMode('preview')}>PREVIEW FRIENDS</button><button aria-pressed={pickerMode === 'wallet'} onClick={() => setPickerMode('wallet')}>MY WALLET</button></div>
      {pickerMode === 'preview' ? <>
        <p>Meet a Genesis or Generations Friend. Try care and Rare Rush without connecting a wallet.</p>
        <div className="collection-switch" role="group" aria-label="Preview collection">{(['generations', 'genesis'] as const).map(which => <button key={which} aria-pressed={previewCollection === which} onClick={() => setPreviewCollection(which)}>{which === 'genesis' ? 'Genesis' : 'Generations'}</button>)}</div>
        <div className="friend-picker preview-picker">{previewFriends.map((friend, index) => friend.collection === previewCollection && <button key={`${friend.collection}:${friend.tokenId}`} onClick={() => choosePreview(index)} aria-pressed={preview && selected.index === index}>{friend.collection === 'genesis' ? <GenesisPetSprite portraitUrl={friend.image} bodyId={bodyId}/> : <PetSprite sprites={friend.sprites} frame={0}/>}<b>{friend.label}</b><span>PREVIEW</span></button>)}</div>
        <p className="inline-note">Preview care stays on this device. Genesis bodies and island floors are cosmetic.</p>
      </> : <>
        <p>Connect your wallet and bring home a Genesis or Generations Rare Friend.</p>
        {wallet.status === 'connected' ? <>
          <div className="picker-account"><span>{wallet.account?.slice(0, 8)}…{wallet.account?.slice(-6)}</span><button onClick={() => setRefresh(n => n + 1)} disabled={loading}>REFRESH</button></div>
          {loading && <p role="status">Finding your Friends on Robinhood…</p>}{discoveryError && <p className="inline-error" role="alert">{discoveryError}</p>}{!loading && !owned.length && !discoveryError && <p>No Rare Friends found in this wallet. Try another wallet or verify a token below.</p>}
          <div className="friend-picker">{owned.map(pet => <button key={`${pet.collection}:${pet.tokenId}`} disabled={selecting} onClick={() => void chooseOwned(pet.collection, pet.tokenId)}>{pet.collection === 'genesis' ? <GenesisPetSprite portraitUrl={pet.image} bodyId={bodyId}/> : pet.sprites ? <PetSprite sprites={pet.sprites} frame={0}/> : <img src={pet.image} alt=""/>}<b>{pet.label}</b><span>{pet.collection.toUpperCase()}</span></button>)}</div>
          <form className="manual-pet" onSubmit={e => { e.preventDefault(); void chooseOwned(collection, manual); }}><label>COLLECTION<select value={collection} onChange={e => setCollection(e.target.value as PetCollection)}><option value="genesis">Genesis</option><option value="generations">Generations</option></select></label><label>TOKEN ID<input value={manual} onChange={e => setManual(e.target.value)} pattern="[1-9][0-9]{0,77}" maxLength={78} inputMode="numeric" placeholder="42" required/></label><button type="submit" disabled={selecting}>{selecting ? 'VERIFYING…' : 'VERIFY & SELECT'}</button></form>
        </> : <>
          <button className="solid-button" onClick={() => wallet.status === 'wrong-network' ? void session.switchNetwork() : void session.connect()} disabled={wallet.status === 'connecting' || wallet.status === 'switching-network'}>{wallet.status === 'wrong-network' ? 'SWITCH TO ROBINHOOD' : wallet.status === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}</button>
          {wallet.wallets.length > 1 && <div className="wallet-choices">{wallet.wallets.map(w => <button key={w.id} onClick={() => void session.connect(w.id)}>{w.name}</button>)}</div>}
          <p className="inline-note">A connection only reads your NFTs. Care actions ask you to confirm a transaction.</p>
        </>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </>}
    </div></Dialog>}
    {rules && <Dialog title="A little care. Every day." className="how-to-care-dialog" close={() => setRules(false)}><HowToCare actions={careActions} preview={preview} invalid={invalid} careKnown={careKnown} careConfigured={!!careContract} launchConfigured={!!launchpadContract} launchEligible={!!live?.walletAddress} launchReadyAt={launchConfig ? Number(launchConfig.readyAt) : null} playEligible={preview || !!live?.rushEligible} rules={activeRules} state={state} now={now} rarityRemaining={rarityRemaining} nextRarityPoints={nextRarityPoints}/></Dialog>}
    {confirmation && live && <Dialog title={`Confirm ${confirmation}`} close={() => setConfirmation(null)}><div className="rules-content"><p>{careActions.find(a => a.id === confirmation)!.gain} for <b>{live.label}</b>.</p><p>Rules V{state.policy?.version ?? '—'} apply to the confirmed action. Earned points and its rule version remain in your Friend’s permanent history.</p><p>This sends a transaction on Robinhood Chain. Your wallet shows the network fee before you approve. No token approval or NFT transfer is needed.</p><p className="contract-address">Care contract: {careContract}</p><button className="solid-button" onClick={() => void confirm()}>CONTINUE TO WALLET</button></div></Dialog>}
    {playing && !invalid && <PlayDialog title={`Rare Rush / ${label}`} close={closePlay} summary={preview ? '+10 preview XP per completed run · 3 runs / 24h' : 'Practice with your Friend · onchain XP coming soon'}>{isGenesis ? <GenesisRush enableRunSaving={false} friendId={BigInt((art ?? live)!.tokenId)} portraitUrl={(art ?? live)!.image} bodyId={bodyId} paused={false} beforeRun={beforeRun} onRunComplete={() => { if (preview) reward('play'); }} onNavigate={closePlay}/> : <RareRush enableRunSaving={false} friendId={BigInt(art?.tokenId ?? live!.tokenId)} client={rushClient} paused={false} beforeRun={beforeRun} previewSprites={art?.collection === 'generations' ? art.sprites : undefined} onRunComplete={() => { if (preview) reward('play'); }} onNavigate={closePlay}/>}</PlayDialog>}
  </div>;
}
createRoot(document.getElementById('root')!).render(/^\/docs(?:\/|\/index\.html)?$/.test(location.pathname) ? <Docs petGraceHours={PET_GRACE / 3600}/> : <App/>);
