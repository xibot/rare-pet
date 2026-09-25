import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRun, stepRun, jump, setSliding, setPace, demoControls, FIXED_STEP,
  TRANSITION_DURATION, SHAFT_LEFT, SHAFT_RIGHT, STEER_SPEED,
  type RunState, type Phase, type Entity, type RunEvent,
} from '../games/rare-rush/twist/engine.ts';
import {
  createRun as createClassicRun, stepRun as stepClassicRun, jump as jumpClassic,
  setSliding as slideClassic, setPace as paceClassic,
} from '../games/rare-rush/engine.ts';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../games/rare-rush/difficulty.ts';

function advance(run: RunState, seconds: number, fps = 120): RunEvent[] {
  const events: RunEvent[] = [];
  for (let i = 0; i < Math.round(seconds * fps); i++) events.push(...stepRun(run, 1 / fps));
  return events;
}

function verticalRun(phase: 'up' | 'down' = 'up'): RunState {
  const run = createRun('vertical-fixture');
  run.phase = phase;
  run.phasePlan = [{ phase: 'side', start: 0, end: 0 }, { phase, start: 0, end: 90 }];
  run._phaseIndex = 1;
  run.phaseEnteredAt = -10;
  run.player = { x: 461, y: phase === 'up' ? 370 : 175, w: 38, height: 58, vy: 0, grounded: false, jumps: 0, slide: false };
  run.entities = [];
  run._nextSpawnAt = Infinity;
  run._nextBonusAt = Infinity;
  return run;
}

function overlapEntity(run: RunState, kind: Entity['kind']): Entity {
  const entity: Entity = { id: ++run._id, kind, x: run.player.x + 8, y: run.player.y - 35, w: 24, h: 24 };
  run.entities.push(entity);
  return entity;
}

test('the classic opening preserves the existing course, controls, physics and reward events', () => {
  for (const difficulty of DIFFICULTY_ORDER) {
    const run = createRun('opening-parity', difficulty), original = createClassicRun('opening-parity', difficulty);
    run.invulnerable = original.invulnerable = 10;
    for (let tick = 0; tick < 6 * 120; tick++) {
      if (tick === 170 || tick === 250) { jump(run); jumpClassic(original); }
      if (tick === 360) { setSliding(run, true); slideClassic(original, true); }
      if (tick === 450) { setSliding(run, false); slideClassic(original, false); }
      if (tick === 500) { setPace(run, 1); paceClassic(original, 1); }
      assert.deepEqual(stepRun(run, FIXED_STEP), stepClassicRun(original, FIXED_STEP));
    }
    for (const key of Object.keys(original) as Array<keyof typeof original>) assert.deepEqual(run[key], original[key], `${difficulty}: ${key}`);
    assert.equal(run.phase, 'side');
  }
});

test('seeded full routes fit unchanged mode timers, start classic and include both vertical directions', () => {
  const routes = new Set<string>();
  for (const difficulty of DIFFICULTY_ORDER) {
    for (let seed = 0; seed < 300; seed++) {
      const run = createRun(seed, difficulty);
      assert.equal(run.duration, DIFFICULTIES[difficulty].seconds);
      assert.equal(run.phase, 'side');
      assert.equal(run.phasePlan[0].start, 0);
      assert.equal(run.phasePlan.at(-1)?.end, run.duration);
      assert.equal(run.phasePlan.at(-1)?.phase, 'side');
      assert.equal(run.phasePlan.filter(section => section.phase !== 'side').length, difficulty === 'degen' ? 3 : 2);
      assert.ok(run.phasePlan.some(section => section.phase === 'up'));
      assert.ok(run.phasePlan.some(section => section.phase === 'down'));
      for (let i = 0; i < run.phasePlan.length; i++) {
        const section = run.phasePlan[i];
        assert.ok(section.end - section.start >= 4.5 - FIXED_STEP);
        if (i > 0) assert.equal(section.start, run.phasePlan[i - 1].end);
      }
      assert.deepEqual(run.phasePlan, createRun(seed, difficulty).phasePlan);
      routes.add(JSON.stringify(run.phasePlan));
    }
  }
  assert.ok(routes.size > 800);
});

test('a human-input pilot can complete every mode through both directions without modifying health or scores', () => {
  for (const difficulty of DIFFICULTY_ORDER) {
    for (let seed = 0; seed < 12; seed++) {
      const run = createRun(`pilot-${seed}`, difficulty);
      const phases = new Set<Phase>(), turns = new Set<number>();
      const collected: RunEvent[] = [];
      while (run.status === 'running') {
        const controls = demoControls(run);
        setPace(run, controls.axis);
        setSliding(run, controls.slide);
        if (controls.jump) jump(run);
        const events = stepRun(run, FIXED_STEP);
        collected.push(...events.filter(event => event.type === 'coin'));
        phases.add(run.phase);
        if (run.transition) turns.add(run._phaseIndex);
      }
      assert.equal(run.finishReason, 'time', `${difficulty}, seed ${seed}`);
      assert.equal(run.elapsed, DIFFICULTIES[difficulty].seconds);
      assert.deepEqual([...phases].sort(), ['down', 'side', 'up']);
      assert.equal(turns.size, difficulty === 'degen' ? 6 : 4);
      assert.equal(collected.length, run.coins);
      assert.equal(collected.filter(event => event.rewardMultiplier === 10).length, run.bonusCoins);
      assert.ok(run.bonusCoins > 0);
      assert.ok(run.hearts > 0);
      assert.ok(run.growth <= 1.75);
    }
  }
});

test('whole-course fixed stepping agrees at30,60 and144fps, including physical gates and section boundaries', () => {
  for (const difficulty of DIFFICULTY_ORDER) {
    const snapshots = [30, 60, 144].map(fps => {
      const run = createRun('frame-independent', difficulty);
      run.invulnerable = run.duration + 1;
      advance(run, run.duration, fps);
      const { _accumulator, ...snapshot } = run;
      return snapshot;
    });
    assert.equal(snapshots[0].finishReason, 'time');
    assert.deepEqual(snapshots[0], snapshots[1]);
    assert.deepEqual(snapshots[0], snapshots[2]);
  }
});

test('changing pace while a gate approaches keeps route sections ordered and never extends the timer', () => {
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const sign of [-1, 1] as const) {
      const run = createRun(`gate-pace-${sign}`, difficulty);
      run.invulnerable = run.duration + 1;
      while (run.status === 'running') {
        setPace(run, run.phase === 'side' ? run.gate ? sign : -sign as -1 | 1 : 0);
        stepRun(run, FIXED_STEP);
      }
      assert.equal(run.elapsed, run.duration);
      assert.equal(run.finishReason, 'time');
      assert.equal(run.phase, 'side');
      assert.equal(run._phaseIndex, run.phasePlan.length - 1);
      for (let i = 1; i < run.phasePlan.length; i++) {
        assert.equal(run.phasePlan[i].start, run.phasePlan[i - 1].end);
        assert.ok(run.phasePlan[i].end - run.phasePlan[i].start > TRANSITION_DURATION + 0.8);
      }
    }
  }
});

test('connected turns freeze their departing map, ignore jump and slide, and protect arrival', () => {
  const run = createRun('entry-snapshot', 'degen');
  run.invulnerable = 20;
  while (!run.transition) stepRun(run, FIXED_STEP);
  const departure = structuredClone(run.transition!.fromEntities);
  const target = structuredClone(run.player);
  assert.equal(jump(run), false);
  setSliding(run, true);
  assert.deepEqual(run.player, target);
  while (run.transition) {
    assert.deepEqual(run.transition.fromEntities, departure);
    stepRun(run, FIXED_STEP);
  }
  run.invulnerable = run.transitionGrace;
  const hearts = run.hearts;
  overlapEntity(run, 'block');
  stepRun(run, FIXED_STEP);
  assert.equal(run.hearts, hearts);
  advance(run, 1);
  overlapEntity(run, 'block');
  assert.equal(stepRun(run, FIXED_STEP).filter(event => event.type === 'hit').length, 1);
  assert.equal(run.hearts, hearts - 1);
});

test('vertical steering uses the shared arrows, stays in the shaft and does not change scroll speed', () => {
  for (const phase of ['up', 'down'] as const) {
    const run = verticalRun(phase), x = run.player.x;
    const y = run.player.y;
    setPace(run, 1);
    advance(run, 0.1);
    assert.ok(Math.abs(run.player.x - x - STEER_SPEED * 0.1) < 1e-8);
    assert.equal(run.player.y, y);
    assert.equal(run.speed, phase === 'up' ? 492 : 564);
    advance(run, 2);
    assert.equal(run.player.x, SHAFT_RIGHT - run.player.w - 12);
    setPace(run, -1);
    advance(run, 2);
    assert.equal(run.player.x, SHAFT_LEFT + 12);
    assert.equal(jump(run), false);
    setSliding(run, true);
    assert.equal(run.player.height, 58);
    assert.equal(run.player.slide, false);
  }
});

test('vertical coin and flying-bonus pickups preserve single-pickup growth, combo score and10x reward weight', () => {
  for (const phase of ['up', 'down'] as const) {
    const run = verticalRun(phase);
    for (let i = 0; i < 11; i++) overlapEntity(run, 'coin');
    overlapEntity(run, 'bonus');
    const events = stepRun(run, FIXED_STEP).filter(event => event.type === 'coin');
    assert.equal(events.length, 12);
    assert.ok(events.every(event => event.amount === 1));
    assert.equal(events.reduce((sum, event) => sum + event.rewardMultiplier!, 0), 21);
    assert.equal(run.coins, 12);
    assert.equal(run.bonusCoins, 1);
    assert.ok(Math.abs(run.growth - (1 + 12 * 0.035)) < 1e-10);
    assert.equal(run.combo, 3);
    assert.equal(run.score, Math.floor(run.distance) + events.reduce((sum, event) => sum + event.points!, 0));
    assert.equal(stepRun(run, FIXED_STEP).filter(event => event.type === 'coin').length, 0);
  }
});

test('shaft shields and magnets keep their original protection and pickup semantics', () => {
  const run = verticalRun();
  overlapEntity(run, 'shield');
  assert.equal(stepRun(run, FIXED_STEP).filter(event => event.type === 'shield').length, 1);
  assert.equal(run.shield, 9);
  overlapEntity(run, 'block');
  const shieldEvents = stepRun(run, FIXED_STEP);
  assert.equal(run.hearts, 3);
  assert.equal(run.shield, 0);
  assert.equal(shieldEvents.find(event => event.type === 'shield')?.amount, 0);
  overlapEntity(run, 'magnet');
  stepRun(run, FIXED_STEP);
  const coin = overlapEntity(run, 'coin');
  coin.x += 90;
  assert.equal(stepRun(run, FIXED_STEP).filter(event => event.type === 'coin').length, 1);
});

test('pause leaves the clock unchanged, resumed turns continue, and finish emits exactly once then freezes', () => {
  const run = createRun('pause-turn', 'easy');
  run.invulnerable = run.duration + 1;
  while (!run.transition) stepRun(run, FIXED_STEP);
  const paused = structuredClone(run);
  for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(stepRun(run, dt), []);
  assert.deepEqual(run, paused);
  stepRun(run, FIXED_STEP);
  assert.ok(run.transition!.progress > paused.transition!.progress);
  const events = advance(run, run.duration);
  assert.equal(run.elapsed, run.duration);
  assert.equal(events.filter(event => event.type === 'finish').length, 1);
  assert.equal(run.finishReason, 'time');
  const finished = structuredClone(run);
  assert.deepEqual(stepRun(run, 100), []);
  assert.equal(jump(run), false);
  setPace(run, 1);
  setSliding(run, true);
  assert.deepEqual(run, finished);
});

test('losing the final heart in a shaft ends the run immediately with one finish event', () => {
  const run = verticalRun('down');
  run.hearts = 1;
  overlapEntity(run, 'block');
  const events = stepRun(run, 0.25);
  assert.equal(run.status, 'finished');
  assert.equal(run.finishReason, 'hearts');
  assert.equal(run.elapsed, FIXED_STEP);
  assert.equal(events.filter(event => event.type === 'hit').length, 1);
  assert.equal(events.filter(event => event.type === 'finish').length, 1);
});
