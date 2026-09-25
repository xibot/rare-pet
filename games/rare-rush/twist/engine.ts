/** Arcade direction changes. The verified Testnet and landing engines stay independent. */
import { difficultySettings, type Difficulty } from '../difficulty.ts';
import type { Entity, EntityKind, FinishReason, Pace, Player, RunEvent, RunState as ClassicRunState } from '../engine.ts';
export type { Entity, EntityKind, FinishReason, Pace, Player, RunEvent, Difficulty };
export { WIDTH, HEIGHT, GROUND_Y, PLAYER_X, RUN_SECONDS, FIXED_STEP, START_SPEED, MAX_SPEED } from '../engine.ts';
import { WIDTH, HEIGHT, GROUND_Y, PLAYER_X, FIXED_STEP } from '../engine.ts';

export type Phase = 'side' | 'up' | 'down';
export interface PhaseSection { phase: Phase; start: number; end: number }
export const TRANSITION_GRACE = 0.8;
export const TRANSITION_DURATION = 1.15;
export const GATE_LEAD_TIME = 2;
export const SHAFT_LEFT = 100;
export const SHAFT_RIGHT = 860;
export const STEER_SPEED = 560;
export interface UpcomingGate { direction: 'up' | 'down'; x: number; width: number; progress: number }
export interface MapTransition {
  from: Phase;
  to: Phase;
  progress: number;
  elapsed: number;
  duration: number;
  fromPlayer: Pick<Player, 'x' | 'y' | 'w' | 'height'>;
  toPlayer: Pick<Player, 'x' | 'y' | 'w' | 'height'>;
  gateX: number;
  gateWidth: number;
  fromDistance: number;
  fromLocalDistance: number;
  fromEntities: Entity[];
}
export interface RunState extends ClassicRunState {
  seed: string;
  phase: Phase;
  phasePlan: PhaseSection[];
  phaseEnteredAt: number;
  phaseDistanceOrigin: number;
  transition?: MapTransition;
  gate?: UpcomingGate;
  transitionGrace: number;
  _phaseIndex: number;
  _nextSpawnAt: number;
  _gapCenter: number;
  _gateInitialDistance: number;
}

function seedNumber(seed: number | string): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(run: RunState): number {
  run._rng = (run._rng + 0x6d2b79f5) >>> 0;
  let value = run._rng;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

// Independent stream: bonus schedules never perturb the original obstacle course.
function bonusRandom(run: RunState): number {
  run._bonusRng = (run._bonusRng + 0x6d2b79f5) >>> 0;
  let value = run._bonusRng;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function spawnBonusWave(run: RunState, events: RunEvent[]): void {
  const settings = difficultySettings(run.difficulty);
  // Even a player holding slow pace must have time to reach the last coin.
  const slowestFlight = settings.startSpeed * 0.7 * 1.15 + 25;
  const arrivalAllowance = (WIDTH + 64 + 360 - PLAYER_X - 38) / slowestFlight + 0.5;
  if (run.duration - run.elapsed < arrivalAllowance) {
    run._nextBonusAt = Infinity;
    return;
  }
  const count = bonusRandom(run) < 0.25 ? 2 : 1;
  const firstY = 190 + bonusRandom(run) * 54;
  for (let i = 0; i < count; i += 1) {
    const baseY = i === 0 ? firstY : firstY < 217 ? 244 : 190;
    const phase = bonusRandom(run) * Math.PI * 2;
    run.entities.push({
      // Separate negative IDs keep every normal course entity ID unchanged.
      id: --run._bonusId,
      kind: 'bonus',
      x: WIDTH + 64 + (i === 0 ? 0 : 260 + bonusRandom(run) * 100),
      y: baseY + Math.sin(run.elapsed * 2.6 + phase) * 7,
      w: 48,
      h: 48,
      fly: { baseY, phase, speedMultiplier: 1.15, extraSpeed: 25 },
    });
  }
  events.push({ type: 'bonus-spawn', x: WIDTH + 64, y: firstY, amount: count });
  run._nextBonusAt = run.elapsed + 10 + bonusRandom(run) * 5;
}

function add(run: RunState, kind: EntityKind, x: number, y: number, w: number, h: number): Entity {
  const entity = { id: ++run._id, kind, x, y, w, h };
  run.entities.push(entity);
  return entity;
}

function coins(run: RunState, x: number, count: number, arc: boolean): void {
  for (let i = 0; i < count; i += 1) {
    const lift = arc ? Math.sin((i / (count - 1)) * Math.PI) * 106 : 0;
    // Straight rows overlap the slide box (top372), including beneath drones.
    add(run, 'coin', x + i * 46, (arc ? 348 : 360) - lift, 24, 24);
  }
}

function routeCoins(run: RunState, x: number, count: number, arc: boolean): void {
  const easy = run.difficulty === 'easy';
  const degen = run.difficulty === 'degen';
  const stride = degen ? 54 : 46;
  for (let i = 0; i < count; i += 1) {
    const lift = arc ? Math.sin((i / (count - 1)) * Math.PI) * (easy ? 88 : degen ? 138 : 106) : 0;
    const coinX = x + i * stride + (easy ? 0 : (random(run) - 0.5) * (degen ? 32 : 10));
    let coinY = (arc ? 348 : 360) - lift + (easy ? 0 : (random(run) - 0.5) * (degen ? 116 : 16));
    // Degen scatters pickups through the double-jump envelope, never above it.
    coinY = Math.max(degen ? 180 : 220, Math.min(360, coinY));
    for (const hazard of run.entities) {
      if (hazard.kind !== 'crystal' && hazard.kind !== 'block' && hazard.kind !== 'drone') continue;
      if (coinX + 24 <= hazard.x - 8 || coinX >= hazard.x + hazard.w + 8) continue;
      if (hazard.kind === 'drone') {
        // A readable ground route beneath slide hazards; no pickup requires a hit.
        if (coinY + 24 > hazard.y - 8) coinY = 360;
      } else if (coinY + 24 > hazard.y - 12) {
        coinY = hazard.y - 36;
      }
    }
    add(run, 'coin', coinX, coinY, 24, 24);
  }
}

function spawnPattern(run: RunState): void {
  const x = WIDTH + 60;
  // The opening pattern teaches a jump. Later patterns alternate ground and air.
  const choice = run._pattern === 0 ? 0 : Math.floor(random(run) * 5);
  if (run.difficulty === 'easy') {
    if (choice <= 1) {
      const block = choice === 1;
      const height = block ? 46 : 36;
      add(run, block ? 'block' : 'crystal', x, GROUND_Y - height, block ? 46 : 38, height);
      routeCoins(run, x - 130, 7, true);
    } else if (choice === 2) {
      add(run, 'drone', x, 321, 70, 35);
      routeCoins(run, x - 110, 7, false);
    } else {
      routeCoins(run, x - 110, 9, false);
      if (choice === 4) add(run, run._pattern % 2 === 0 ? 'shield' : 'magnet', x + 130, 284, 30, 30);
    }
  } else if (run.difficulty === 'degen') {
    if (choice <= 1) {
      add(run, choice === 0 ? 'crystal' : 'block', x, GROUND_Y - 62, 54, 62);
      add(run, choice === 0 ? 'crystal' : 'block', x + 84, GROUND_Y - 72, 60, 72);
      routeCoins(run, x - 150, 9, true);
    } else if (choice === 2) {
      add(run, 'drone', x, 311, 92, 45);
      add(run, 'drone', x + 140, 313, 76, 43);
      routeCoins(run, x - 130, 10, false);
    } else if (choice === 3) {
      add(run, 'block', x, GROUND_Y - 80, 70, 80);
      routeCoins(run, x - 140, 9, true);
    } else {
      routeCoins(run, x - 110, 10, true);
      add(run, run._pattern % 2 === 0 ? 'shield' : 'magnet', x + 130, 270, 30, 30);
    }
  } else if (choice <= 1) {
    const tall = choice === 1;
    add(run, tall ? 'block' : 'crystal', x, GROUND_Y - (tall ? 65 : 47), tall ? 62 : 44, tall ? 65 : 47);
    routeCoins(run, x - 130, 7, true);
  } else if (choice === 2) {
    // Drone bottom is356: standing top342 collides; sliding top372 clears.
    add(run, 'drone', x, 313, 88, 43);
    routeCoins(run, x - 110, 7, false);
  } else if (choice === 3) {
    // A broad crystal pair can be cleared with one well-timed jump.
    add(run, 'crystal', x, GROUND_Y - 43, 36, 43);
    add(run, 'crystal', x + 57, GROUND_Y - 51, 36, 51);
    routeCoins(run, x - 110, 7, true);
  } else {
    // A short breather rewards the player and introduces an occasional powerup.
    routeCoins(run, x - 110, 9, false);
    const powerup = run._pattern % 2 === 0 ? 'shield' : 'magnet';
    add(run, powerup, x + 130, 284, 30, 30);
  }
  run._pattern += 1;
  const progress = run.elapsed / run.duration;
  // Degen combos are denser but retain recovery space at the full1.3x boost.
  const spacing = run.difficulty === 'easy' ? 900 - progress * 80 + random(run) * 150
    : run.difficulty === 'degen' ? 710 - progress * 60 + random(run) * 90
    : 750 - progress * 105 + random(run) * 110;
  run._nextSpawnDistance = run._travel + spacing;
}

/** The route stream never perturbs the original opening course or bonus schedule. */
function createRoute(seed: number | string, difficulty: Difficulty): PhaseSection[] {
  let state = seedNumber(`${seed}:route`);
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const between = (min: number, max: number) => Math.round((min + random() * (max - min)) * 120) / 120;
  const degen = difficulty === 'degen', easy = difficulty === 'easy';
  const first: Phase = random() < 0.5 ? 'up' : 'down';
  const second: Phase = first === 'up' ? 'down' : 'up';
  const opening = easy ? between(24, 30) : degen ? between(9, 12) : between(16, 22);
  const shaft = () => easy ? between(22, 27) : degen ? between(8, 10) : between(18, 23);
  const bridge = () => easy ? between(9, 12) : degen ? between(4.5, 5.5) : between(7, 9);
  const parts: Array<[Phase, number]> = [['side', opening], [first, shaft()], ['side', bridge()], [second, shaft()]];
  if (degen) parts.push(['side', bridge()], [random() < 0.5 ? 'up' : 'down', shaft()]);
  const duration = difficultySettings(difficulty).seconds;
  parts.push(['side', duration - parts.reduce((sum, [, length]) => sum + length, 0)]);
  let position = 0;
  return parts.map(([phase, length], index) => {
    const end = index === parts.length - 1 ? duration : Math.round((position + length) * 120) / 120;
    const section = { phase, start: position, end };
    position = end;
    return section;
  });
}

function initialPlayer(phase: Phase): Player {
  return { x: phase === 'side' ? PLAYER_X : WIDTH / 2 - 19,
    y: phase === 'side' ? GROUND_Y : phase === 'up' ? 370 : 175,
    w: 38, height: 58, vy: 0, grounded: phase === 'side', jumps: 0, slide: false };
}

/** Preserve the departing map so the renderer can carry one continuous scene through a turn. */
function enterPhase(run: RunState, index: number): void {
  const section = run.phasePlan[index];
  const fromPlayer = { x: run.player.x, y: run.player.y, w: run.player.w, height: run.player.height };
  const toPlayer = initialPlayer(section.phase);
  // Physical gate contact can shift a turn slightly with pace. Only the joining boundary
  // moves: subsequent exits and the countdown keep their original fixed schedule.
  run.phasePlan[index - 1].end = run.elapsed;
  section.start = run.elapsed;
  run.transition = {
    from: run.phase, to: section.phase, progress: 0, elapsed: 0, duration: TRANSITION_DURATION,
    fromPlayer, toPlayer: { x: toPlayer.x, y: toPlayer.y, w: toPlayer.w, height: toPlayer.height },
    gateX: run.gate?.x ?? WIDTH / 2,
    gateWidth: run.gate?.width ?? 320,
    fromDistance: run.distance,
    fromLocalDistance: run.distance - run.phaseDistanceOrigin,
    fromEntities: run.entities.map(entity => ({ ...entity, ...(entity.fly ? { fly: { ...entity.fly } } : {}) })),
  };
  run.phase = section.phase;
  run.phaseEnteredAt = run.elapsed;
  run.phaseDistanceOrigin = run.distance;
  run._phaseIndex = index;
  run.transitionGrace = TRANSITION_DURATION + TRANSITION_GRACE;
  run.invulnerable = Math.max(run.invulnerable, run.transitionGrace);
  run.entities = [];
  run.gate = undefined;
  run.player = toPlayer;
  run.speedMultiplier = 1;
  run._gapCenter = WIDTH / 2;
  run._pattern = 0;
  run._nextSpawnAt = run.elapsed + TRANSITION_DURATION + 0.08;
  run._nextSpawnDistance = run._travel;
  run._nextBonusAt = run.elapsed + TRANSITION_DURATION + 3.5;
}

/** Every barrier has a reachable opening. Coins trace the safe route to it. */
function shaftPattern(run: RunState, events: RunEvent[]): void {
  const degen = run.difficulty === 'degen';
  const gapWidth = run.difficulty === 'easy' ? 340 : degen ? 250 : 290;
  const previousGap = run._gapCenter;
  const shift = (Math.floor(random(run) * 3) - 1) * (degen ? 145 : 115);
  const center = Math.max(SHAFT_LEFT + gapWidth / 2 + 40,
    Math.min(SHAFT_RIGHT - gapWidth / 2 - 40, previousGap + shift));
  const down = run.phase === 'down';
  const y = down ? HEIGHT + 35 : -75;
  for (const [left, right] of [[SHAFT_LEFT, center - gapWidth / 2], [center + gapWidth / 2, SHAFT_RIGHT]]) {
    for (let x = left; x < right - 1; x += 78) {
      add(run, (Math.round(x / 78) + run._pattern) % 3 === 0 ? 'drone' : 'block', x, y, Math.min(76, right - x), 36);
    }
  }
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const x = previousGap + (center - previousGap) * t + Math.sin(t * Math.PI) * 24;
    add(run, 'coin', x - 12, y + (down ? -1 : 1) * (270 - t * 260), 24, 24);
  }
  if (run._pattern % 2 === 0) {
    const bonus = add(run, 'bonus', center - 24, y + (down ? -120 : 120), 48, 48);
    bonus.fly = { baseY: bonus.x, phase: bonusRandom(run) * Math.PI * 2, speedMultiplier: 1, extraSpeed: 0 };
    events.push({ type: 'bonus-spawn', x: bonus.x, y: bonus.y, amount: 1 });
  }
  if (run._pattern % 7 === 5) {
    add(run, run._pattern % 2 === 0 ? 'shield' : 'magnet', center - 15, y + (down ? -210 : 210), 30, 30);
  }
  run._gapCenter = center;
  run._pattern++;
  run._nextSpawnAt = run.elapsed + (run.difficulty === 'easy' ? 1.4 : degen ? 0.98 : 1.18);
}

export function getUpcomingGate(run: RunState): UpcomingGate | undefined { return run.gate; }

export function createRun(seed: number | string, difficulty: Difficulty = 'normal'): RunState {
  const settings = difficultySettings(difficulty);
  const run: RunState = {
    seed: String(seed), phase: 'side', phasePlan: createRoute(seed, difficulty), phaseEnteredAt: 0,
    phaseDistanceOrigin: 0, transitionGrace: 0, _phaseIndex: 0, _nextSpawnAt: 0,
    _gapCenter: WIDTH / 2, _gateInitialDistance: 0,
    difficulty,
    duration: settings.seconds,
    player: { x: PLAYER_X, y: GROUND_Y, w: 38, height: 58, vy: 0, grounded: true, jumps: 0, slide: false },
    entities: [],
    elapsed: 0,
    distance: 0,
    coins: 0,
    bonusCoins: 0,
    score: 0,
    hearts: 3,
    combo: 1,
    speed: settings.startSpeed,
    pace: 0,
    speedMultiplier: 1,
    growth: 1,
    status: 'running',
    invulnerable: 0,
    shield: 0,
    magnet: 0,
    _tick: 0,
    _accumulator: 0,
    _rng: seedNumber(seed),
    _id: 0,
    _bonusRng: (seedNumber(seed) ^ 0x9e3779b9) >>> 0,
    _bonusId: 0,
    _nextBonusAt: 0,
    _travel: 0,
    _nextSpawnDistance: 0,
    _pattern: 0,
    _coinStreak: 0,
    _comboClock: 0,
    _coinScore: 0,
  };
  coins(run, 390, 4, false);
  spawnPattern(run);
  run._nextBonusAt = 4 + bonusRandom(run) * 2;
  return run;
}

/** Trigger on a press edge, not on keyboard autorepeat. A second press air-jumps. */
export function jump(run: RunState): boolean {
  if (run.status !== 'running' || run.phase !== 'side' || run.transition || run.player.jumps >= 2) return false;
  const player = run.player;
  player.slide = false;
  player.height = 58;
  player.vy = player.jumps === 0 ? -620 : -570;
  player.jumps += 1;
  player.grounded = false;
  return true;
}

/** Holding slide ducks on the ground and fast-falls while airborne. */
export function setSliding(run: RunState, sliding: boolean): void {
  if (run.status !== 'running' || run.phase !== 'side' || run.transition) return;
  run.player.slide = sliding;
  run.player.height = sliding ? 28 : 58;
  if (sliding && !run.player.grounded) run.player.vy = Math.max(run.player.vy, 470);
}

/** Hold slow/fast on the classic track or steer left/right in shafts. Release, pause, and blur request0. */
export function setPace(run: RunState, pace: Pace): void {
  if (run.status !== 'running') return;
  run.pace = pace;
}

function overlaps(player: Player, entity: Entity): boolean {
  return player.x < entity.x + entity.w &&
    player.x + player.w > entity.x &&
    player.y - player.height < entity.y + entity.h &&
    player.y > entity.y;
}

function finish(run: RunState, reason: FinishReason, events: RunEvent[]): void {
  run.status = 'finished';
  run.finishReason = reason;
  run._accumulator = 0;
  events.push({ type: 'finish', reason });
}

function tick(run: RunState, events: RunEvent[]): void {
  const dt = FIXED_STEP;
  run._tick += 1;
  run.elapsed = Math.min(run.duration, run._tick * dt);
  const targetMultiplier = run.phase === 'side' ? 1 + run.pace * 0.3 : 1;
  run.speedMultiplier += (targetMultiplier - run.speedMultiplier) * (1 - Math.exp(-6 * dt));
  const settings = difficultySettings(run.difficulty);
  run.speed = run.phase === 'side'
    ? (settings.startSpeed + (settings.maxSpeed - settings.startSpeed) * (run.elapsed / run.duration)) * run.speedMultiplier
    : (run.phase === 'down' ? 564 : 492) * (run.difficulty === 'degen' ? 1.17 : run.difficulty === 'easy' ? 0.88 : 1);
  const travel = run.speed * dt;
  run._travel += travel;
  run.distance = run._travel / 10;
  run.invulnerable = Math.max(0, run.invulnerable - dt);
  run.shield = Math.max(0, run.shield - dt);
  run.magnet = Math.max(0, run.magnet - dt);
  run._comboClock = Math.max(0, run._comboClock - dt);
  if (run._comboClock === 0) {
    run._coinStreak = 0;
    run.combo = 1;
  }
  run.score = Math.floor(run.distance) + run._coinScore;

  if (run.transition) {
    if (run.elapsed >= run.duration) {
      finish(run, 'time', events);
      return;
    }
    if (run.transition.progress < 1) {
      run.transition.elapsed = Math.min(run.transition.duration, run.elapsed - run.phaseEnteredAt);
      run.transition.progress = Math.min(1, run.transition.elapsed / run.transition.duration);
      run.transitionGrace = TRANSITION_GRACE + run.transition.duration - run.transition.elapsed;
      return;
    }
    run.transition = undefined;
    run.phaseDistanceOrigin = run.distance;
  }
  run.transitionGrace = run._phaseIndex === 0 ? 0
    : Math.max(0, TRANSITION_DURATION + TRANSITION_GRACE - (run.elapsed - run.phaseEnteredAt));
  const next = run.phasePlan[run._phaseIndex + 1];
  if (next && run.phase === 'side') {
    if (!run.gate && next.start - run.elapsed <= GATE_LEAD_TIME) {
      run._gateInitialDistance = Math.max(travel, run.speed * (next.start - run.elapsed) + travel);
      const intakeOffset = next.phase === 'down' ? 160 : 100;
      run.gate = { direction: next.phase as 'up' | 'down',
        x: run.player.x + run.player.w / 2 + intakeOffset + run._gateInitialDistance,
        width: 320, progress: 0 };
    }
    if (run.gate) {
      run.gate.x -= travel;
      const intakeOffset = run.gate.direction === 'down' ? run.gate.width / 2 : 100;
      const intakeContact = run.player.x + run.player.w / 2 + intakeOffset;
      run.gate.progress = Math.max(0, Math.min(1, 1 - (run.gate.x - intakeContact) / run._gateInitialDistance));
      if (run.gate.x <= intakeContact + 1e-8) {
        enterPhase(run, run._phaseIndex + 1);
        return;
      }
    }
  } else if (next && run.elapsed + 1e-9 >= next.start) {
    enterPhase(run, run._phaseIndex + 1);
    return;
  }

  const player = run.player;
  if (run.phase !== 'side') {
    player.slide = false;
    player.height = 58;
    player.x = Math.max(SHAFT_LEFT + 12,
      Math.min(SHAFT_RIGHT - player.w - 12, player.x + run.pace * STEER_SPEED * dt));
  } else if (!player.grounded) {
    player.vy += 1600 * dt;
    player.y += player.vy * dt;
    if (player.y >= GROUND_Y) {
      player.y = GROUND_Y;
      player.vy = 0;
      player.grounded = true;
      player.jumps = 0;
    }
  }

  for (const entity of run.entities) {
    if (run.phase !== 'side') {
      entity.y += travel * (run.phase === 'up' ? 1 : -1);
      if (entity.fly) entity.x = entity.fly.baseY + Math.sin(run.elapsed * 2.9 + entity.fly.phase) * 18;
    } else if (entity.kind === 'bonus' && entity.fly) {
      entity.x -= travel * entity.fly.speedMultiplier + entity.fly.extraSpeed * dt;
      entity.y = entity.fly.baseY + Math.sin(run.elapsed * 2.6 + entity.fly.phase) * 7;
    } else entity.x -= travel;
    if (entity.collected || entity.hit) continue;
    const dx = entity.x + entity.w / 2 - (player.x + player.w / 2);
    const dy = entity.y + entity.h / 2 - (player.y - player.height / 2);
    const pickup = entity.kind === 'coin' || entity.kind === 'bonus';
    const magnetic = pickup && run.magnet > 0 && dx * dx + dy * dy < 155 * 155;
    if (!magnetic && !overlaps(player, entity)) continue;

    if (pickup) {
      entity.collected = true;
      run.coins += 1;
      if (entity.kind === 'bonus') run.bonusCoins += 1;
      run.growth = Math.min(1.75, run.growth + 0.035);
      run._coinStreak += 1;
      run._comboClock = 4.5;
      const multiplier = Math.min(5, 1 + Math.floor(run._coinStreak / 5));
      if (multiplier > run.combo) events.push({ type: 'combo', amount: multiplier });
      run.combo = multiplier;
      const points = 10 * multiplier;
      run._coinScore += points;
      events.push({ type: 'coin', x: entity.x + entity.w / 2, y: entity.y + entity.h / 2,
        amount: 1, points, rewardMultiplier: entity.kind === 'bonus' ? 10 : 1 });
    } else if (entity.kind === 'shield' || entity.kind === 'magnet') {
      entity.collected = true;
      if (entity.kind === 'shield') run.shield = 9;
      else run.magnet = 8;
      events.push({ type: entity.kind, x: entity.x + 15, y: entity.y + 15 });
    } else {
      entity.hit = true;
      if (run.invulnerable > 0) continue;
      if (run.shield > 0) {
        run.shield = 0;
        run.invulnerable = 1.35;
        events.push({ type: 'shield', x: player.x, y: player.y - 35, amount: 0 });
      } else {
        run.hearts -= 1;
        run.growth = Math.max(1, run.growth - 0.35);
        run.invulnerable = 1.65;
        run.combo = 1;
        run._coinStreak = 0;
        run._comboClock = 0;
        events.push({ type: 'hit', x: player.x, y: player.y - 35, amount: 1 });
        if (run.hearts === 0) break;
      }
    }
  }

  run.entities = run.entities.filter((entity) => !entity.collected && (run.phase === 'side'
    ? entity.x + entity.w > -80
    : run.phase === 'up' ? entity.y < HEIGHT + 90 : entity.y + entity.h > -90));
  run.score = Math.floor(run.distance) + run._coinScore;
  if (run.hearts === 0) finish(run, 'hearts', events);
  else if (run.elapsed >= run.duration) finish(run, 'time', events);
  else {
    const remaining = run.phasePlan[run._phaseIndex].end - run.elapsed;
    if (run.phase === 'side') {
      if (run.elapsed >= run._nextSpawnAt && remaining > 2.3 && run._travel >= run._nextSpawnDistance) spawnPattern(run);
      if (remaining > 3 && run.elapsed >= run._nextBonusAt) spawnBonusWave(run, events);
    } else if (remaining > 1.8 && run.elapsed >= run._nextSpawnAt) shaftPattern(run, events);
  }
}

/**
 * Advance an unpaused run. Fixed120Hz physics makes normal frame rates agree.
 * A single frame consumes at most250ms to avoid hidden-tab teleports; hosts must
 * pause on blur/visibility changes and must not call this while runtime-paused.
 * Mutates run and returns only events produced by this call.
 */
export function stepRun(run: RunState, deltaSeconds: number): RunEvent[] {
  const events: RunEvent[] = [];
  if (run.status !== 'running' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return events;
  run._accumulator += Math.min(deltaSeconds, 0.25);
  while (run._accumulator + 1e-10 >= FIXED_STEP && run.status === 'running') {
    run._accumulator = Math.max(0, run._accumulator - FIXED_STEP);
    tick(run, events);
  }
  return events;
}

export interface Controls { axis: Pace; jump: boolean; slide: boolean }

/** Legal-input pilot for deterministic QA/capture scripts. The Arcade UI never calls this. */
export function demoControls(run: RunState): Controls {
  if (run.transition || run.status !== 'running') return { axis: 0, jump: false, slide: false };
  const player = run.player;
  const hazard = (entity: Entity) => !entity.hit && ['block', 'crystal', 'drone'].includes(entity.kind);
  if (run.phase === 'side') {
    const next = run.entities.filter(entity => hazard(entity) && entity.x + entity.w > player.x)
      .sort((a, b) => a.x - b.x)[0];
    const until = next ? (next.x - player.x - player.w) / run.speed : Infinity;
    const slide = Boolean(next?.kind === 'drone' && until < 0.6);
    const leap = Boolean(next && next.kind !== 'drone' &&
      ((player.grounded && until < 0.24) || (player.jumps === 1 && player.vy >= -80 && until < 0.3)));
    return { axis: 0, jump: leap, slide };
  }
  const ahead = run.entities.filter(entity => hazard(entity) &&
    (run.phase === 'up' ? entity.y + entity.h < player.y : entity.y > player.y - player.height));
  ahead.sort((a, b) => run.phase === 'up' ? b.y - a.y : a.y - b.y);
  let target = run._gapCenter;
  if (ahead[0]) {
    const row = ahead.filter(entity => Math.abs(entity.y - ahead[0].y) < 3).sort((a, b) => a.x - b.x);
    let left = SHAFT_LEFT, widest = 0;
    for (const entity of [...row, { x: SHAFT_RIGHT, w: 0 }]) {
      const gap = entity.x - left;
      if (gap > widest) { target = left + gap / 2; widest = gap; }
      left = Math.max(left, entity.x + entity.w);
    }
  } else {
    const coin = run.entities.filter(entity => (entity.kind === 'coin' || entity.kind === 'bonus') &&
      (run.phase === 'up' ? entity.y < player.y : entity.y > player.y - player.height))
      .sort((a, b) => Math.abs(a.y - player.y) - Math.abs(b.y - player.y))[0];
    if (coin) target = coin.x + coin.w / 2;
  }
  const difference = target - (player.x + player.w / 2);
  return { axis: Math.abs(difference) < 7 ? 0 : difference < 0 ? -1 : 1, jump: false, slide: false };
}
