/** Pure, deterministic runner simulation. All coordinates are logical SVG pixels. */
import { difficultySettings, type Difficulty } from './difficulty.ts';

export const WIDTH = 960;
export const HEIGHT = 500;
export const GROUND_Y = 400;
export const PLAYER_X = 165;
export const RUN_SECONDS = 90;
export const FIXED_STEP = 1 / 120;
export const START_SPEED = 255;
// At normal pace a 520px mobile crop gives >1s of visible hazard warning.
// Holding fast pace deliberately trades some of that reaction time for distance.
export const MAX_SPEED = 305;

export type EntityKind = 'coin' | 'bonus' | 'crystal' | 'block' | 'drone' | 'shield' | 'magnet';
export type FinishReason = 'time' | 'hearts';
export type Pace = -1 | 0 | 1;

export interface Entity {
  id: number;
  kind: EntityKind;
  /** Top-left corner of the collision box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** A collided obstacle stays visible but cannot damage the player again. */
  hit?: boolean;
  collected?: boolean;
  /** Airborne bonus trajectory; y already includes its gentle vertical bob. */
  fly?: { baseY: number; phase: number; speedMultiplier: number; extraSpeed: number };
}

export interface Player {
  x: number;
  /** FEET / bottom of the collision box. Standing on the floor means y=400. */
  y: number;
  w: number;
  height: number;
  vy: number;
  grounded: boolean;
  jumps: number;
  slide: boolean;
}

export interface RunEvent {
  type: 'coin' | 'hit' | 'shield' | 'magnet' | 'finish' | 'combo' | 'bonus-spawn';
  x?: number;
  y?: number;
  /** Coins always award exactly one pickup; combos only change points. */
  amount?: number;
  points?: number;
  /** Token reward weight, never an extra pickup, growth step, or score multiplier. */
  rewardMultiplier?: 1 | 10;
  reason?: FinishReason;
}

export interface RunState {
  difficulty: Difficulty;
  /** Fixed run length captured from the selected difficulty at creation. */
  duration: number;
  player: Player;
  entities: Entity[];
  elapsed: number;
  /** Distance in metres: ten logical pixels equal one metre. */
  distance: number;
  coins: number;
  /** Bonus pickups are included once in coins, and counted separately here. */
  bonusCoins: number;
  score: number;
  hearts: number;
  /** Current score multiplier, from 1 through 5. */
  combo: number;
  /** Scroll speed in logical pixels per second. */
  speed: number;
  /** Held pace input: slow, normal, or fast. Release returns this to0. */
  pace: Pace;
  /** Smoothed multiplier applied to the course's normal speed. */
  speedMultiplier: number;
  /** Visual sprite scale only; the collision box and jump physics stay stable. */
  growth: number;
  status: 'running' | 'finished';
  finishReason?: FinishReason;
  invulnerable: number;
  /** Remaining seconds. A shield is consumed by one collision. */
  shield: number;
  magnet: number;
  /** Internal deterministic simulation state. Renderers should not change it. */
  _tick: number;
  _accumulator: number;
  _rng: number;
  _id: number;
  _bonusRng: number;
  _bonusId: number;
  _nextBonusAt: number;
  _travel: number;
  _nextSpawnDistance: number;
  _pattern: number;
  _coinStreak: number;
  _comboClock: number;
  _coinScore: number;
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

function add(run: RunState, kind: EntityKind, x: number, y: number, w: number, h: number): void {
  run.entities.push({ id: ++run._id, kind, x, y, w, h });
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

export function createRun(seed: number | string, difficulty: Difficulty = 'normal'): RunState {
  const settings = difficultySettings(difficulty);
  const run: RunState = {
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
  if (run.status !== 'running' || run.player.jumps >= 2) return false;
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
  if (run.status !== 'running') return;
  run.player.slide = sliding;
  run.player.height = sliding ? 28 : 58;
  if (sliding && !run.player.grounded) run.player.vy = Math.max(run.player.vy, 470);
}

/** Hold slow(-1) or fast(1); release, pause, and blur should request normal(0). */
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
  const targetMultiplier = 1 + run.pace * 0.3;
  run.speedMultiplier += (targetMultiplier - run.speedMultiplier) * (1 - Math.exp(-6 * dt));
  const settings = difficultySettings(run.difficulty);
  run.speed = (settings.startSpeed + (settings.maxSpeed - settings.startSpeed) * (run.elapsed / run.duration)) * run.speedMultiplier;
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

  const player = run.player;
  if (!player.grounded) {
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
    if (entity.kind === 'bonus' && entity.fly) {
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

  run.entities = run.entities.filter((entity) => entity.x + entity.w > -80 && !entity.collected);
  run.score = Math.floor(run.distance) + run._coinScore;
  if (run.hearts === 0) finish(run, 'hearts', events);
  else if (run.elapsed >= run.duration) finish(run, 'time', events);
  else {
    if (run._travel >= run._nextSpawnDistance) spawnPattern(run);
    if (run.elapsed >= run._nextBonusAt) spawnBonusWave(run, events);
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
