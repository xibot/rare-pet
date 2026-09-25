import { useEffect, useRef, useState } from 'react';
import type { GameComponentProps } from '@rarefriends/friendsdk/runtime';
import type { GameClient } from '@rarefriends/friendsdk/game';
import { createFriendReader, type GenerationSprites } from '@rarefriends/friendsdk/sprites';
import { createFriendSoundKit, type FriendSoundKit } from '@rarefriends/friendsdk/sounds';
import { GameMenu } from '@rarefriends/friendsdk/frame';
import { createRun, FIXED_STEP, type RunState } from './twist/engine';
import { DirectionScene } from './twist/DirectionScene';
import { headingFor } from './twist/presentation';
import { startArcadeAnalytics, type ArcadeAnalyticsRun, type ArcadeSignal } from './analytics';
import { createEconomy, enterRun, collectCoin, nextCoinReward, formatToken, formatRF } from './economy';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from './difficulty';
import { WorldArt } from './WorldArt';
import { TokenCoin } from './CanonicalArt';
import { BrandMark } from './BrandMark';
import { FriendSprite as Sprite, EntityArt } from './RunnerArt';
import { GenesisRunnerSprite } from './genesis/GenesisRunnerSprite';
import { DEFAULT_BODY_ID, pickGenesisBody } from './genesis/bodies';
import { requestArcadeNavigation } from './navigation';
import { advanceHumanRecording, createHumanRecording, exportHumanReplay, queueHumanJump, releaseHumanControls, type HumanRecording } from './replay-recorder';
import { requestArcadeRunSave, requestSavedRunNavigation, type ArcadeRunCapture } from './run-save-bridge';
import './style.css';

type Screen = 'ready' | 'running' | 'result';
type Panel = 'rules' | 'economy' | null;
type ArcadeNavigation = (destination: 'home' | 'friends') => void;
export type RareRushRunResult = Readonly<{ score: number; elapsed: number; difficulty: Difficulty }>;
type RunIntegration = {
  beforeRun?: () => Promise<void>;
  onRunComplete?: (result: RareRushRunResult) => void;
  enableRunSaving?: boolean;
};
const BIOMES = ['GARDEN COMMONS', 'CIRCUIT COURTYARD', 'CRYSTAL STEPS'];

export default function RareRush(props: GameComponentProps & RunIntegration & { onNavigate?: ArcadeNavigation; previewSprites?: GenerationSprites }) {
  return <Runner {...props}/>;
}

/** Genesis hosts supply verified original portraits and an ownership/entry gate. */
export function GenesisRush({ portraitUrl, bodyId, beforeRun, ...props }: RunIntegration & { friendId: bigint; paused: boolean; portraitUrl: string; bodyId?: string; beforeRun: () => Promise<void>; onNavigate?: ArcadeNavigation; onAnalytics?: (event: ArcadeSignal) => void }) {
  return <Runner {...props} beforeRun={beforeRun} genesis={{ portraitUrl, bodyId }}/>;
}

function Runner({ friendId, client, paused, genesis, beforeRun, onRunComplete, previewSprites, enableRunSaving = true, onNavigate = requestArcadeNavigation, onAnalytics }: RunIntegration & { friendId: bigint; client?: GameClient; paused: boolean; genesis?: { portraitUrl: string; bodyId?: string }; onNavigate?: ArcadeNavigation; previewSprites?: GenerationSprites; onAnalytics?: (event: ArcadeSignal) => void }) {
  const collection = genesis ? 'genesis' : 'generations';
  const [sprites, setSprites] = useState<GenerationSprites | null>(null);
  const [genesisBodyId, setGenesisBodyId] = useState(DEFAULT_BODY_ID);
  const previousGenesisBody = useRef<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false), mounted = useRef(false);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [screen, setScreen] = useState<Screen>('ready'), [panel, setPanel] = useState<Panel>(null);
  const [userPaused, setUserPaused] = useState(false), [muted, setMuted] = useState(true);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [viewWidth, setViewWidth] = useState(960), [, draw] = useState(0);
  const [notice, setNotice] = useState(''), [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [best, setBest] = useState<Record<Difficulty, number>>({ easy: 0, normal: 0, degen: 0 });
  const [saveBusy, setSaveBusy] = useState(false), [saveError, setSaveError] = useState(''), [savedRunId, setSavedRunId] = useState('');
  const recording = useRef<HumanRecording | null>(null), captured = useRef<ArcadeRunCapture | null>(null);
  const runArt = useRef<ArcadeRunCapture['art'] | null>(null), saving = useRef<AbortController | null>(null);
  const root = useRef<HTMLElement>(null), stage = useRef<SVGSVGElement>(null);
  const engine = useRef(createRun(1)), economy = useRef(createEconomy());
  const reward = useRef(0n), sounds = useRef<FriendSoundKit | null>(null);
  const analyticsRun = useRef<ArcadeAnalyticsRun | null>(null);
  const active = useRef(false), screenRef = useRef<Screen>('ready'), noticeUntil = useRef(0);
  const paceInputs = useRef(new Set<string>()), displayedGrowth = useRef(1);
  const beforeRunRef = useRef(beforeRun), onRunCompleteRef = useRef(onRunComplete);
  const completedRun = useRef<RunState | null>(null), initialization = useRef(0);
  beforeRunRef.current = beforeRun;
  onRunCompleteRef.current = onRunComplete;
  screenRef.current = screen;
  active.current = screen === 'running' && !paused && !userPaused && !panel && !document.hidden;

  useEffect(() => {
    let cancelled = false;
    initialization.current++;
    mounted.current = true; startingRef.current = false; setStarting(false);
    setLoaded(false); setError(''); setSprites(null); setScreen('ready'); setUserPaused(false); setPanel(null); setDifficulty('normal'); setBest({ easy: 0, normal: 0, degen: 0 });
    economy.current = createEconomy(); engine.current = createRun(1); reward.current = 0n; displayedGrowth.current = 1; paceInputs.current.clear(); analyticsRun.current = null;
    recording.current = null; captured.current = null; runArt.current = null; saving.current?.abort(); saving.current = null;
    setSaveBusy(false); setSaveError(''); setSavedRunId('');
    previousGenesisBody.current = undefined; setGenesisBodyId(genesis?.bodyId ?? DEFAULT_BODY_ID);
    const load = async () => {
      if (genesis) return null;
      if (!client) throw new Error('Connect through the FriendSDK game host.');
      if (previewSprites && previewSprites.tokenId !== friendId) throw new Error('Preview artwork does not match your selected Friend.');
      const [snapshot, art] = await Promise.all([client.read(), previewSprites ?? createFriendReader().read(friendId)]);
      if (snapshot.friendId !== friendId) throw new Error('Selected Friend changed. Choose your Friend again.');
      if (client.mode !== 'preview') throw new Error('Rare Rush currently supports the simulated economy only.');
      return art;
    };
    load().then(art => {
      if (cancelled) return;
      setSprites(art); setLoaded(true);
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load your Friend.'); });
    return () => { cancelled = true; mounted.current = false; active.current = false; saving.current?.abort(); };
  }, [friendId, client, retry, genesis?.portraitUrl, genesis?.bodyId, previewSprites]);

  useEffect(() => {
    sounds.current = createFriendSoundKit({ muted: true, volume: .4 });
    return () => { sounds.current?.dispose(); };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setViewWidth(entry.contentRect.width <= 600 ? 520 : 960));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(preference.matches);
    preference.addEventListener('change', changed);
    return () => preference.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    let id = 0, previous = 0, accumulator = 0;
    let currentRecording: HumanRecording | null = null;
    const tick = (time: number) => {
      const frameDt = previous ? Math.min((time - previous) / 1000, .25) : 0; previous = time;
      if (recording.current !== currentRecording) { currentRecording = recording.current; accumulator = 0; }
      if (active.current && currentRecording) {
        // A slow render frame may span a shaft exit. Re-map held arrows at
        // every recorded physics step so playback receives identical controls.
        accumulator += frameDt;
        while (accumulator + 1e-10 >= FIXED_STEP && engine.current.status === 'running') {
          accumulator = Math.max(0, accumulator - FIXED_STEP);
          const events = advanceHumanRecording(currentRecording, screenAxis());
          for (const event of events) {
            if (event.type === 'coin') {
              const gained = collectCoin(economy.current, engine.current.difficulty, event.rewardMultiplier ?? 1, collection);
              reward.current += gained;
              const bonus = event.rewardMultiplier === 10;
              sounds.current?.play(bonus ? 'reveal-rare' : 'select');
              if (bonus) { setNotice(`10× COIN! +${formatToken(gained)}`); noticeUntil.current = engine.current.elapsed + 1.8; }
            }
            if (event.type === 'hit') { sounds.current?.play('impact'); setNotice('OUCH! SIZE DOWN'); noticeUntil.current = engine.current.elapsed + 1.3; }
            if (event.type === 'magnet' || event.type === 'shield') { sounds.current?.play('reveal-rare'); setNotice(event.type === 'magnet' ? 'COIN MAGNET!' : event.amount === 0 ? 'SHIELD SAVED YOU!' : 'SHIELD UP!'); noticeUntil.current = engine.current.elapsed + 1.5; }
            if (event.type === 'finish') {
              const finished = engine.current;
              if (event.reason === 'time' || event.reason === 'hearts') analyticsRun.current?.finish(event.reason, finished.elapsed);
              analyticsRun.current = null;
              if (enableRunSaving && runArt.current) captured.current = { collection: runArt.current.collection, tokenId: runArt.current.tokenId,
                seed: finished.seed, difficulty: finished.difficulty, replay: exportHumanReplay(currentRecording), art: runArt.current };
              active.current = false; setScreen('result'); setBest(old => ({ ...old, [finished.difficulty]: Math.max(old[finished.difficulty], finished.score) })); sounds.current?.play('reward');
              if (completedRun.current !== finished) {
                completedRun.current = finished;
                try { onRunCompleteRef.current?.({ score: finished.score, elapsed: finished.elapsed, difficulty: finished.difficulty }); }
                catch { setError('Your run finished, but its result could not be recorded by the host.'); }
              }
            }
          }
        }
        displayedGrowth.current += (engine.current.growth - displayedGrowth.current) * (1 - Math.exp(-14 * frameDt));
        if (engine.current.elapsed > noticeUntil.current) setNotice('');
        draw(time);
      } else accumulator = 0;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  function doJump() { if (active.current && recording.current) { queueHumanJump(recording.current); void sounds.current?.unlock(); sounds.current?.play('action-start'); } }
  function focusWorld() { if (screenRef.current === 'running') requestAnimationFrame(() => stage.current?.focus()); }
  function slide(value: boolean) { if ((active.current || !value) && recording.current) recording.current.slide = value; }
  function paceInput(source: string, held: boolean) {
    if (held && !active.current) return;
    if (held) paceInputs.current.add(source); else paceInputs.current.delete(source);
  }
  function screenAxis(): -1 | 0 | 1 {
    const left = [...paceInputs.current].some(key => key.endsWith('left'));
    const right = [...paceInputs.current].some(key => key.endsWith('right'));
    return left === right ? 0 : right ? 1 : -1;
  }
  function releaseControls() { paceInputs.current.clear(); if (recording.current) releaseHumanControls(recording.current); }
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('button,input,select,textarea') || panel || paused) return;
      if (['Space', 'ArrowUp', 'KeyW'].includes(event.code)) { event.preventDefault(); if (!event.repeat) doJump(); }
      if (['ArrowDown', 'KeyS'].includes(event.code)) { event.preventDefault(); slide(true); }
      if (['ArrowLeft', 'ArrowRight'].includes(event.code)) { event.preventDefault(); paceInput(event.code === 'ArrowLeft' ? 'key-left' : 'key-right', true); }
      if (['Escape', 'KeyP'].includes(event.code) && screenRef.current === 'running' && !event.repeat) { setUserPaused(value => !value); releaseControls(); }
    };
    const up = (event: KeyboardEvent) => {
      if (['ArrowDown', 'KeyS'].includes(event.code)) slide(false);
      if (['ArrowLeft', 'ArrowRight'].includes(event.code)) paceInput(event.code === 'ArrowLeft' ? 'key-left' : 'key-right', false);
    };
    const blur = () => { releaseControls(); if (screenRef.current === 'running') { active.current = false; setUserPaused(true); } sounds.current?.stop(); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, [panel, paused]);
  useEffect(() => { if (paused || panel || userPaused) { releaseControls(); sounds.current?.stop(); } }, [paused, panel, userPaused]);
  useEffect(() => { if (screen !== 'running') releaseControls(); }, [screen]);

  function chooseDifficulty(value: Difficulty) {
    if (screen !== 'ready' || startingRef.current) return;
    setDifficulty(value); engine.current = createRun(1, value); displayedGrowth.current = 1; reward.current = 0n;
  }
  function backToDifficulty() {
    releaseControls();
    saving.current?.abort(); captured.current = null; recording.current = null;
    engine.current = createRun(1, difficulty); displayedGrowth.current = 1; reward.current = 0n;
    setNotice(''); setUserPaused(false); setScreen('ready');
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('.difficulty-picker button[aria-pressed="true"]')?.focus());
  }
  async function start() {
    if (!loaded || paused || panel || startingRef.current) return;
    const currentInitialization = initialization.current;
    startingRef.current = true; setStarting(true); setError('');
    try {
      if (beforeRunRef.current) await beforeRunRef.current();
      if (!mounted.current || currentInitialization !== initialization.current) return;
      if (!enterRun(economy.current, collection)) { setError('You used all 100 demo RF. Reset the simulation in Token lab to keep testing.'); return; }
      let bodyId = genesisBodyId;
      if (genesis) {
        const body = genesis.bodyId ?? pickGenesisBody(previousGenesisBody.current);
        previousGenesisBody.current = body; setGenesisBodyId(body); bodyId = body;
      }
    const runSeed = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('')}`;
    recording.current = createHumanRecording(runSeed, difficulty); engine.current = recording.current.run;
    captured.current = null; saving.current?.abort(); saving.current = null; setSaveBusy(false); setSaveError(''); setSavedRunId('');
    const tokenId = friendId.toString();
    runArt.current = genesis ? { collection: 1, tokenId, chainId: 4663, label: `Genesis #${tokenId}`, portraitUrl: genesis.portraitUrl, bodyId }
      : sprites ? { collection: 0, tokenId, chainId: 4663, label: `Generations #${tokenId}`, sprites: {
        familyId: sprites.familyId, seed: sprites.seed, frames: sprites.frames.map(String) } } : null;
    reward.current = 0n; displayedGrowth.current = 1; paceInputs.current.clear();
    analyticsRun.current = startArcadeAnalytics(collection, difficulty, onAnalytics);
    setNotice(''); setError(''); setUserPaused(false); setScreen('running');
    void sounds.current?.unlock(); sounds.current?.play('action-ready');
    requestAnimationFrame(() => stage.current?.focus());
    } catch (cause) {
      if (mounted.current && currentInitialization === initialization.current) setError(cause instanceof Error
        ? cause.message : 'Could not start this run. Please try again.');
    }
    finally { if (currentInitialization === initialization.current) { startingRef.current = false; if (mounted.current) setStarting(false); } }
  }
  async function saveRun() {
    const capture = captured.current;
    if (!capture || saving.current || savedRunId) return;
    const controller = new AbortController(); saving.current = controller; setSaveBusy(true); setSaveError('');
    try {
      const id = await requestArcadeRunSave(capture, controller.signal);
      if (mounted.current && captured.current === capture && !controller.signal.aborted) setSavedRunId(id);
    } catch (error) {
      if (mounted.current && captured.current === capture && !controller.signal.aborted) setSaveError((error as Error).message || 'The run could not be saved. Try again.');
    } finally {
      if (saving.current === controller) { saving.current = null; if (mounted.current) setSaveBusy(false); }
    }
  }
  const run = engine.current, e = economy.current, biome = Math.min(2, Math.floor(run.elapsed / run.duration * 3));
  const mode = DIFFICULTIES[run.difficulty], modeBest = best[run.difficulty];
  const running = screen === 'running', freeze = paused || userPaused || Boolean(panel);
  const vertical = run.phase !== 'side', heading = headingFor(run);
  const timer = Math.max(0, Math.ceil(run.duration-run.elapsed));
  const playerFrame = reduced || freeze ? 0 : Math.floor(run.elapsed * 12) % 8;
  const growth = reduced ? run.growth : displayedGrowth.current;
  const friendCenter = run.player.x + run.player.w / 2;
  const friendHeight = run.player.slide ? 30 : 60 * growth;
  const hasCharacter = Boolean(sprites || genesis);
  const renderCharacter = (frame: number, walking = false) => genesis
    ? <GenesisRunnerSprite portraitUrl={genesis.portraitUrl} bodyId={genesisBodyId} frame={frame} walking={walking && !reduced && !freeze}/>
    : sprites ? <Sprite sprites={sprites} frame={frame} walking={walking}/> : null;

  return <section ref={root} className={`rare-rush ${reduced ? 'reduce-motion' : ''}`} data-collection={collection} data-screen={screen} data-phase={run.phase} data-heading={vertical ? 0 : heading} data-difficulty={run.difficulty} data-run-duration={run.duration} data-bonus-coins={run.bonusCoins} aria-label="Rare Rush arcade game">
    <div className="arcade-top"><button type="button" className="arcade-logo" aria-label="Rare Rush home" onClick={() => onNavigate('home')}><BrandMark/></button>
      <div className="top-actions"><span className="preview-tag">SIMULATED</span><button onClick={() => { const next = !muted; setMuted(next); sounds.current?.setMuted(next); if (!next) void sounds.current?.unlock(); focusWorld(); }} aria-label={muted ? 'Turn sound on' : 'Mute sound'} title={muted ? 'Sound off' : 'Sound on'}>{muted ? '♪ OFF' : '♪ ON'}</button>
        <button onClick={() => { setReduced(value => !value); focusWorld(); }} aria-pressed={reduced} title="Reduce background motion">FX {reduced ? 'OFF' : 'ON'}</button>
        {running ? <button onClick={() => { setUserPaused(value => !value); focusWorld(); }} aria-label={userPaused ? 'Resume game' : 'Pause game'}>{userPaused ? '▶' : 'Ⅱ'}</button> : <button onClick={() => setPanel('rules')} aria-label="How to play">?</button>}
      </div>
    </div>
    <div className="hud"><div><span>{mode.label.toUpperCase()} · TIME</span><strong className={timer < 15 ? 'urgent' : ''}>{String(Math.floor(timer / 60)).padStart(2,'0')}<em>:</em>{String(timer%60).padStart(2,'0')}</strong></div>
      <div><span>DISTANCE</span><strong>{Math.floor(run.distance).toString().padStart(4,'0')}<small>m</small></strong></div>
      <div className="token-hud"><span>DEMO $RUSH</span><strong>{formatToken(reward.current)}<small>✦</small></strong></div>
      <div className="life-hud"><span>KEEP IT RARE</span><strong aria-label={`${run.hearts} hearts remaining`}>{[0,1,2].map(i => <b key={i} className={i>=run.hearts?'lost':''}>♥</b>)}</strong></div>
    </div>
    <div className={`playfield ${running && !freeze ? 'playing' : ''}`}>
      <svg ref={stage} className="world-svg" viewBox={`0 0 ${viewWidth} 500`} preserveAspectRatio="xMidYMid meet" tabIndex={running ? 0 : -1} role="img" aria-label={vertical ? `Runner world. ${run.phase === 'up' ? 'Pulled upward' : 'Free falling'} automatically. Hold left or right to steer around obstacles.` : `Runner world. Space or up to jump, down to slide. Hold ${heading === -1 ? 'left' : 'right'} to speed up, ${heading === -1 ? 'right' : 'left'} to slow down.`} onPointerDown={event => { if (running) { event.preventDefault(); stage.current?.focus(); doJump(); } }}>
        {screen !== 'ready' ? <DirectionScene run={run} reducedMotion={reduced} running={running && !freeze} biome={biome} growth={growth} renderCharacter={renderCharacter} viewportWidth={viewWidth}/> : <>
        <WorldArt distance={run.distance} elapsed={run.elapsed * 1000} reducedMotion={reduced || !running} biome={biome}/>
        {!running && screen === 'ready' && <g>{[0,1,2,3,4].map(i => <TokenCoin key={i} x={370+i*52} y={295 - Math.sin(i/4*Math.PI)*65} size={30}/>)}<EntityArt entity={{id:999,kind:'crystal',x:730,y:339,w:44,h:61} as RunState['entities'][number]} elapsed={0} reduced={reduced}/></g>}
        {run.entities.map(entity => <EntityArt key={entity.id} entity={entity} elapsed={run.elapsed} reduced={reduced}/>)}
        {hasCharacter && <g transform={screen === 'ready' ? `translate(${viewWidth === 960 ? 265 : 200} 0)` : undefined} opacity={run.invulnerable > 0 ? (reduced ? .65 : Math.floor(run.elapsed * 12)%2 ? .4 : 1) : 1}>
          <ellipse cx={friendCenter} cy="403" rx={32*growth} ry="3" fill="#000000"/>
          {run.magnet > 0 && <circle cx={friendCenter} cy={run.player.y-friendHeight/2} r={58*growth} fill="none" stroke="#CCFF00" strokeDasharray="3 10"/>}
          {run.shield > 0 && <rect x={friendCenter-38*growth} y={run.player.y-friendHeight-10} width={76*growth} height={friendHeight+16} fill="none" stroke="#CCFF00" strokeWidth="2"/>}
          <g data-character="friend" data-slide={run.player.slide} data-growth={run.growth.toFixed(3)} transform={`translate(${friendCenter-32*growth} ${run.player.y-friendHeight}) scale(${4*growth} ${run.player.slide?2:4*growth})`}>{renderCharacter(playerFrame, running)}</g>
        </g>}
        </>}
      </svg>
      <div className="zone-label"><span>{vertical ? run.phase === 'up' ? '↑' : '↓' : `0${biome+1}`}</span> {vertical ? run.phase === 'up' ? 'SUCTION SHAFT' : 'FREE FALL' : BIOMES[biome]} <span className="zone-line"/></div>
      {running && <><div className="run-score"><span>SCORE</span><strong>{run.score.toLocaleString()}</strong><small>{run.coins} COINS <b>×{run.combo} CHAIN</b></small></div>
        <div className="run-modifiers"><span>{vertical ? 'STEER' : 'PACE'} <b data-pace={run.pace}>{vertical ? run.pace < 0 ? '←' : run.pace > 0 ? '→' : '← →' : `${run.speedMultiplier.toFixed(2)}×`}</b></span><span>SIZE <b>{run.growth.toFixed(2)}×</b></span><div className="growth-meter" role="meter" aria-label="Friend size" aria-valuemin={1} aria-valuemax={1.75} aria-valuenow={run.growth}><i style={{width:`${(run.growth-1)/.75*100}%`}}/></div></div>
        {notice && <div className="pickup-notice" role="status">{notice}</div>}
        <div className="run-progress"><i style={{width:`${run.elapsed / run.duration * 100}%`}}/></div></>}
    </div>

    {!loaded && <div className="game-overlay loading-screen"><div className="loading-pixel"/><p role={error?'alert':'status'}>{error || 'Loading your Rare Friend…'}</p>{error && <button className="primary" onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
    {loaded && screen === 'ready' && <div className="start-screen">
      <div className="start-title"><span className="eyebrow">ENDLESS WORLD. {mode.seconds} SECONDS.</span><h1>RARE<br/><span>RUSH</span><sup>✦</sup></h1>{hasCharacter && <svg className="mobile-friend" viewBox="-1 -1 18 18" aria-label={genesis ? 'Your Genesis Friend' : `Your ${sprites?.familyName} Friend`}>{renderCharacter(0)}</svg>}<div className="selected-friend">{genesis ? 'GENESIS' : 'FRIEND'} #{friendId.toString()}<span>{genesis ? '100× DEMO REWARDS' : sprites?.familyName}</span></div></div>
      <div className="start-card"><div className="start-card-heading"><span className="card-kicker">YOUR NEXT HIGH SCORE STARTS HERE</span><button type="button" className="start-back" aria-label="Back to Friend selection" onClick={() => onNavigate('friends')}>BACK</button></div><h2>Run. Collect.<br/>{' '}Stay rare.</h2>
        <div className="difficulty-picker" role="group" aria-label="Choose difficulty">{DIFFICULTY_ORDER.map(key => <button key={key} type="button" aria-pressed={difficulty === key} aria-label={`${DIFFICULTIES[key].label} difficulty`} onClick={() => chooseDifficulty(key)}><b>{DIFFICULTIES[key].label}</b><span>{DIFFICULTIES[key].seconds}s · {DIFFICULTIES[key].rewardLabel}</span></button>)}</div>
        <div className="mode-description" aria-live="polite">{mode.description}<span>{mode.rewardLabel} rewards · 3 hearts</span></div>
        <button className="primary start-button" disabled={starting} onClick={start}>{starting ? 'CHECKING YOUR FRIEND…' : 'LET’S RUSH'} <span>↗</span></button><small className="entry-note">{genesis ? 'GENESIS · FREE ENTRY · 100× DEMO REWARDS' : '1 demo RF · All fees → demo prize pool'}</small>
      </div>
    </div>}
    {screen === 'result' && <div className="game-overlay result-screen"><div className="result-card"><span className="eyebrow">{mode.label.toUpperCase()} · {run.finishReason === 'time' ? 'TIME’S UP. NICE RUN.' : 'DOWN, BUT STILL RARE.'}</span><h2>{run.score >= modeBest ? `NEW ${mode.label.toUpperCase()} BEST` : 'ONE MORE RUN?'}</h2><div className="result-score">{run.score.toLocaleString()}<span>POINTS</span></div>
      <div className="results-grid"><div><b>{Math.floor(run.distance)}m</b><span>DISTANCE</span></div><div><b>{run.coins}</b><span>{run.bonusCoins ? `COINS · ${run.bonusCoins} BONUS` : 'COINS'}</span></div><div><b>+{formatToken(reward.current)}</b><span>DEMO $RUSH</span></div></div>
      <p>Demo rewards banked. Nothing minted onchain.</p>
      {enableRunSaving && <div className="run-save">{savedRunId ? <><p role="status">Run saved to the public feed.</p><button className="primary" onClick={() => requestSavedRunNavigation(savedRunId)}>VIEW SAVED RUN ↗</button></> : <><p>Sign to publish this replay to the public feed. No transaction.</p><button className="primary" disabled={saveBusy || !captured.current} onClick={saveRun}>{saveBusy ? 'WAITING FOR SAVE…' : saveError ? 'RETRY SAVE RUN' : 'SAVE RUN'}</button></>}{saveError && <p role="alert">{saveError}</p>}</div>}
      <div className="result-actions"><button className="primary" disabled={starting || saveBusy} onClick={start}>{starting ? 'CHECKING YOUR FRIEND…' : 'RUN IT BACK'} <span>↗</span></button><button className="change-difficulty" disabled={starting || saveBusy} onClick={backToDifficulty}><span aria-hidden="true">←</span> CHANGE DIFFICULTY</button></div>
      <small>{mode.label} best: {modeBest.toLocaleString()} · {formatToken(e.balance)} demo $RUSH collected</small></div></div>}
    {running && userPaused && !paused && !panel && <div className="game-overlay"><div className="pause-card"><span className="eyebrow">TAKE A BREATHER</span><h2>PAUSED</h2><p>Your timer is paused too.</p><button className="primary" onClick={() => { setUserPaused(false); stage.current?.focus(); }}>KEEP RUNNING <span>▶</span></button><button className="text-button" onClick={() => setPanel('rules')}>Controls & rules</button></div></div>}

    <div className="arcade-bottom"><div className="keyboard-controls">{vertical ? <><span><kbd>{run.phase === 'up' ? '↑' : '↓'}</kbd> AUTO {run.phase === 'up' ? 'LIFT' : 'FALL'}</span><span><kbd>←</kbd><kbd>→</kbd> HOLD TO STEER</span></> : <><span><kbd>SPACE</kbd> JUMP <small>×2 DOUBLE</small></span><span><kbd>↓</kbd> SLIDE</span><span><kbd>←</kbd><kbd>→</kbd> HOLD FOR PACE</span></>}</div>
      <div className="touch-controls"><button className="touch-pace" disabled={!running || freeze} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); paceInput('touch-left', true); }} onPointerUp={() => paceInput('touch-left', false)} onPointerCancel={() => paceInput('touch-left', false)} onLostPointerCapture={() => paceInput('touch-left', false)} aria-label={vertical ? 'Steer left' : heading === -1 ? 'Hold to speed up' : 'Hold to slow down'}>← <span>{vertical ? 'LEFT' : heading === -1 ? 'FAST' : 'SLOW'}</span></button>
        {vertical ? <span className="vertical-touch">{run.phase === 'up' ? '↑ AUTO LIFT' : '↓ FREE FALL'}<small>← STEER →</small></span> : <><button disabled={!running || freeze} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); slide(true); }} onPointerUp={() => slide(false)} onPointerCancel={() => slide(false)} onLostPointerCapture={() => slide(false)} aria-label="Hold to slide">↓ <span>SLIDE</span></button>
        <button className="touch-jump" disabled={!running || freeze} onPointerDown={event => { event.preventDefault(); doJump(); }} aria-label="Jump, tap twice to double jump">↑ <span>JUMP <small>×2</small></span></button></>}
        <button className="touch-pace" disabled={!running || freeze} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); paceInput('touch-right', true); }} onPointerUp={() => paceInput('touch-right', false)} onPointerCancel={() => paceInput('touch-right', false)} onLostPointerCapture={() => paceInput('touch-right', false)} aria-label={vertical ? 'Steer right' : heading === -1 ? 'Hold to slow down' : 'Hold to speed up'}>→ <span>{vertical ? 'RIGHT' : heading === -1 ? 'SLOW' : 'FAST'}</span></button></div>
      <div className="economy-bar"><span><b>{formatToken(nextCoinReward(e, run.difficulty, 1, collection))}</b> DEMO $RUSH / COIN</span><button onClick={() => setPanel('economy')}>TOKEN LAB <span>↗</span></button></div>
    </div>
    {error && loaded && <div className="error-toast" role="alert">{error}</div>}
    {panel && <GameMenu title={panel === 'rules' ? 'HOW TO RUSH' : 'TOKEN LAB · SIMULATION'} onClose={() => { setPanel(null); if (running && !userPaused) requestAnimationFrame(() => stage.current?.focus()); }}>
      {panel === 'rules' ? <div className="rules-panel"><p>Choose your difficulty before a run. Three hearts, an endless world, and a best score for each mode.</p><dl><dt>PICK YOUR CHALLENGE</dt><dd>Easy: 120 seconds, roomy obstacles and 0.75× rewards. Normal: 90 seconds, mixed obstacles and 1× rewards. Degen: 60 seconds, tougher combinations, wider coin scatter and 2× rewards. Difficulty stays locked until the run ends.</dd>{genesis && <><dt>{genesis.bodyId ? 'YOUR CHOSEN BODY' : 'A NEW BODY EACH RUN'}</dt><dd>{genesis.bodyId ? 'Your original Genesis face keeps the body you selected in RarePet throughout the run.' : 'Your original Genesis face gets one of 36 Generations bodies at the start of each run. It stays with you until the run ends.'} Bodies are cosmetic: movement, collision rules and rewards stay the same.</dd></>}<dt>JUMP / DOUBLE JUMP</dt><dd>Space, ↑ or W. On phone, tap JUMP or the world. Tap again in the air for a double jump.</dd><dt>SLIDE</dt><dd>Hold ↓, S or SLIDE to duck under the floating bridges. Release to stand up.</dd><dt>SET YOUR PACE</dt><dd>Hold the direction you are running to speed up, or the opposite direction to slow down. On phone, hold FAST or SLOW. Release to return to cruising speed.</dd><dt>FOLLOW THE TWIST</dt><dd>Every run starts sideways. A ceiling intake can pull you up, or a break in the floor can drop you into free fall. Hold ← / → (LEFT / RIGHT on phone) to steer through the shaft. Your Friend spins continuously. A shaft can sometimes send you out running left; jump and slide return on the horizontal track.</dd><dt>COLLECT & GROW</dt><dd>Every bear coin grows your Friend, up to 1.75× size. An obstacle hit shrinks it by 0.35×, down to its starting size. A shield protects your size too. You can still squeeze under bridges.</dd><dt>CHASE THE 10× COIN</dt><dd>Giant bear coins fly in from ahead at surprise intervals, sometimes in a pair. They are twice the size and earn 10× your difficulty’s current coin reward, up to the remaining emission cap. Jump, double jump, or use a magnet to catch them. Each still counts as one coin for growth and chains.</dd><dt>CHAIN YOUR COINS</dt><dd>Collect coins in a row to grow your score multiplier to ×5. Getting hit breaks your chain.</dd><dt>POWER UP</dt><dd>S shields you from a hit. M attracts nearby coins. Crystals and crates cost a heart.</dd><dt>TAKE A BREAK</dt><dd>Press P or Escape to pause. Switching tabs pauses your run. Sound and FX controls are at the top.</dd></dl><p className="fine-print">{genesis ? 'Genesis runs are free and earn 100× demo token rewards. ' : 'Each run costs 1 simulated RF. All fees enter the simulated prize pool. '} Coins earn demo $RUSH at the selected difficulty rate; combo boosts score only. Rewards are banked on timeout or your third hit. Reloading or switching Friends resets this session.</p></div> : <div className="economy-panel">
        <p>Early coins earn more. Every 10,000 simulated pickups halves the reward. Try a later chapter of the economy.</p>
        <div className="lab-stat"><span>NEXT COIN · {mode.label.toUpperCase()} · {mode.rewardLabel}{genesis ? ' · GENESIS 100×' : ''}</span><strong>{formatToken(nextCoinReward(e, run.difficulty, 1, collection))}<small> demo $RUSH</small></strong></div>
        <div className="scenario-buttons">{[[0,'LAUNCH'],[10000,'10K COINS'],[30000,'30K COINS'],[100000,'100K COINS']].map(([n,label]) => <button key={n} disabled={running} onClick={() => { economy.current = createEconomy(Number(n)); reward.current = 0n; setError(''); draw(performance.now()); }}>{label}</button>)}</div>
        <small className="fine-print">Scenario changes reset the demo ledger using Normal-rate history. Finish your run to change it. All difficulties share one pickup counter and the same emission cap; the displayed rate includes any remaining cap. Flying bonus coins earn 10× the difficulty rate before cap clipping and advance the pickup counter once.</small>
        <dl className="ledger"><div><dt>Your demo RF</dt><dd>{formatRF(e.rfBalance)}</dd></div><div><dt>Your collected demo $RUSH</dt><dd>{formatToken(e.balance)}</dd></div><div><dt>Demo RF prize pool</dt><dd>{formatRF(e.prizePool)}</dd></div><div><dt>Simulated global pickups</dt><dd>{e.collected.toLocaleString()}</dd></div><div><dt>Illustrative lifetime cap</dt><dd>200,000 $RUSH</dd></div></dl>
        <p className="fine-print">The counter is local to this session, not live player activity. No RF is charged and no token is minted. The pool has no payout yet. $RUSH is a working name, with no monetary value or RF redemption promise.</p>
        <div className="future-note"><b>PLANNED FOR LIVE PLAY</b><p>Verified onchain rewards · a $RUSH / $RAREFRIENDS liquidity pair · prize distribution. These need additional integrations and a finalized economy.</p></div>
      </div>}
    </GameMenu>}
  </section>;
}
