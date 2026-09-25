import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRun, jump, setSliding, setPace, stepRun, FIXED_STEP, GROUND_Y, MAX_SPEED,
  type Entity, type EntityKind, type RunState,
} from '../games/rare-rush/engine.ts';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../games/rare-rush/difficulty.ts';

function emptyRun(seed: number | string = 7, difficulty: Difficulty = 'normal'): RunState {
  const run = createRun(seed, difficulty);
  run.entities = [];
  run._nextSpawnDistance = Infinity;
  run._nextBonusAt = Infinity;
  return run;
}

function hazard(run: RunState, kind: EntityKind = 'crystal', x = 175): Entity {
  const entity = { id: ++run._id, kind, x, y: kind === 'drone' ? 313 : 353, w: 44, h: 43 };
  run.entities.push(entity);
  return entity;
}

function advance(run: RunState, seconds: number, frame = 1 / 60): void {
  const count = Math.round(seconds / frame);
  for (let i = 0; i < count; i += 1) stepRun(run, frame);
}

function isHazard(entity: Entity): boolean {
  return entity.kind === 'crystal' || entity.kind === 'block' || entity.kind === 'drone';
}

function legalPilot(run: RunState): void {
  const next = run.entities.filter((entity) => isHazard(entity) && !entity.hit && entity.x + entity.w > run.player.x)
    .sort((first, second) => first.x - second.x)[0];
  const until = next ? (next.x - run.player.x - run.player.w) / run.speed : Infinity;
  setSliding(run, Boolean(next?.kind === 'drone' && until < 0.6));
  if (next && next.kind !== 'drone') {
    if (until < 0.24 && run.player.grounded) jump(run);
    else if (until < 0.3 && run.player.jumps === 1 && run.player.vy >= -80) jump(run);
  }
}

test('seeded generation and physics are reproducible', () => {
  const first = createRun('rare-friend-42');
  const second = createRun('rare-friend-42');
  for (let frame = 0; frame < 1200; frame += 1) {
    if (frame % 83 === 0) { jump(first); jump(second); }
    assert.deepEqual(stepRun(first, 1 / 60), stepRun(second, 1 / 60));
  }
  assert.deepEqual(first, second);
  assert.notEqual(createRun('another-friend')._nextSpawnDistance, createRun('rare-friend-42')._nextSpawnDistance);
});

test('fixed stepping agrees across30,60 and144fps', () => {
  const runs = [30, 60, 144].map((fps) => {
    const run = emptyRun();
    jump(run);
    advance(run, 6, 1 / fps);
    return run;
  });
  for (const run of runs) {
    assert.equal(run.elapsed, 6);
    assert.equal(run.player.y, GROUND_Y);
    assert.equal(run.distance, runs[0].distance);
    assert.equal(run.score, runs[0].score);
  }
});

test('held pace smoothly changes speed and distance without changing run duration', () => {
  const slow = emptyRun(), normal = emptyRun(), fast = emptyRun();
  setPace(slow, -1);
  setPace(fast, 1);
  assert.equal(fast.speedMultiplier, 1);
  stepRun(fast, FIXED_STEP);
  assert.ok(fast.speedMultiplier > 1 && fast.speedMultiplier < 1.3);
  stepRun(slow, FIXED_STEP);
  stepRun(normal, FIXED_STEP);
  for (const run of [slow, normal, fast]) advance(run, 10);
  assert.ok(Math.abs(slow.speedMultiplier - 0.7) < 1e-8);
  assert.ok(Math.abs(fast.speedMultiplier - 1.3) < 1e-8);
  assert.ok(slow.distance < normal.distance * 0.72);
  assert.ok(fast.distance > normal.distance * 1.28);
  assert.equal(slow.elapsed, normal.elapsed);
  assert.equal(fast.elapsed, normal.elapsed);
});

test('releasing pace returns smoothly to normal and a new run resets all input', () => {
  const run = emptyRun();
  setPace(run, 1);
  advance(run, 1);
  const boosted = run.speedMultiplier;
  setPace(run, 0);
  assert.equal(run.pace, 0);
  assert.equal(run.speedMultiplier, boosted);
  stepRun(run, FIXED_STEP);
  assert.ok(run.speedMultiplier < boosted && run.speedMultiplier > 1);
  advance(run, 3);
  assert.ok(Math.abs(run.speedMultiplier - 1) < 1e-8);
  const fresh = createRun(7);
  assert.equal(fresh.pace, 0);
  assert.equal(fresh.speedMultiplier, 1);
  assert.equal(fresh.growth, 1);
});

test('pace transitions remain deterministic across30,60 and144fps', () => {
  const runs = [30, 60, 144].map((fps) => {
    const run = createRun('pace-test');
    // Skip damage so the same input schedule can exercise generated courses.
    run.invulnerable = 20;
    setPace(run, 1);
    advance(run, 2, 1 / fps);
    setPace(run, -1);
    advance(run, 2, 1 / fps);
    setPace(run, 0);
    advance(run, 2, 1 / fps);
    return run;
  });
  for (const run of runs) {
    assert.equal(run.elapsed, 6);
    assert.equal(run.distance, runs[0].distance);
    assert.equal(run.speedMultiplier, runs[0].speedMultiplier);
    assert.equal(run.speed, runs[0].speed);
    assert.deepEqual(run.entities, runs[0].entities);
  }
});

test('a jump and one air jump are permitted; landing rearms both', () => {
  const run = emptyRun();
  assert.equal(jump(run), true);
  advance(run, 0.15);
  assert.ok(run.player.y < GROUND_Y);
  assert.equal(jump(run), true);
  assert.equal(run.player.jumps, 2);
  assert.equal(jump(run), false);
  advance(run, 2);
  assert.equal(run.player.grounded, true);
  assert.equal(run.player.jumps, 0);
  assert.equal(jump(run), true);
});

test('an unobstructed ground collision removes one heart and grants invulnerability', () => {
  const run = emptyRun();
  hazard(run);
  const events = stepRun(run, FIXED_STEP);
  assert.equal(run.hearts, 2);
  assert.equal(events.filter((event) => event.type === 'hit').length, 1);
  hazard(run, 'block');
  stepRun(run, FIXED_STEP);
  assert.equal(run.hearts, 2);
  assert.ok(run.invulnerable > 1);
  advance(run, 2);
  hazard(run);
  stepRun(run, FIXED_STEP);
  assert.equal(run.hearts, 1);
});

test('sliding clears a drone and holding slide fast-falls from a jump', () => {
  const standing = emptyRun();
  hazard(standing, 'drone');
  stepRun(standing, FIXED_STEP);
  assert.equal(standing.hearts, 2);
  const sliding = emptyRun();
  setSliding(sliding, true);
  hazard(sliding, 'drone');
  stepRun(sliding, FIXED_STEP);
  assert.equal(sliding.player.height, 28);
  assert.equal(sliding.hearts, 3);
  setSliding(sliding, false);
  sliding.entities = [];
  jump(sliding);
  advance(sliding, 0.1);
  setSliding(sliding, true);
  assert.ok(sliding.player.vy >= 470);
  advance(sliding, 0.2);
  assert.equal(sliding.player.grounded, true);
});

test('ground obstacles remain dangerous while sliding but are cleared by a jump', () => {
  const sliding = emptyRun();
  setSliding(sliding, true);
  hazard(sliding);
  stepRun(sliding, FIXED_STEP);
  assert.equal(sliding.hearts, 2);
  const jumping = emptyRun();
  jump(jumping);
  advance(jumping, 0.2);
  hazard(jumping);
  stepRun(jumping, FIXED_STEP);
  assert.equal(jumping.hearts, 3);
});

test('a sliding player collects the generated ground coin row beneath a drone', () => {
  const run = createRun(7);
  const row = run.entities.filter((entity) => entity.kind === 'coin' && entity.x < 600);
  assert.equal(row.length, 4);
  run.entities = row;
  run._nextSpawnDistance = Infinity;
  setSliding(run, true);
  // Place a drone across the first pickup: the player must remain ducked.
  hazard(run, 'drone', row[0].x);
  advance(run, 2);
  assert.equal(run.coins, 4);
  assert.equal(run.hearts, 3);
  assert.equal(run.player.slide, true);
});

test('score combos never multiply the number of collected coins', () => {
  const run = emptyRun();
  const events = [];
  for (let i = 0; i < 25; i += 1) {
    const coin = hazard(run, 'coin');
    coin.y = 355;
    coin.w = coin.h = 24;
    events.push(...stepRun(run, FIXED_STEP));
  }
  assert.equal(run.coins, 25);
  assert.equal(run.combo, 5);
  assert.ok(run.score > 250);
  assert.equal(events.filter((event) => event.type === 'coin').reduce((sum, event) => sum + (event.amount ?? 0), 0), 25);
  advance(run, 5);
  assert.equal(run.combo, 1);
});

test('shield absorbs one collision; magnet collects nearby coins', () => {
  const run = emptyRun();
  run.shield = 5;
  hazard(run);
  stepRun(run, FIXED_STEP);
  assert.equal(run.hearts, 3);
  assert.equal(run.shield, 0);
  run.magnet = 5;
  hazard(run, 'coin', 280);
  stepRun(run, FIXED_STEP);
  assert.equal(run.coins, 1);
});

test('each coin grows the visual Friend to a cap while collision geometry stays fixed', () => {
  const run = emptyRun();
  hazard(run, 'coin');
  stepRun(run, FIXED_STEP);
  assert.equal(run.growth, 1.035);
  for (let i = 0; i < 30; i += 1) {
    hazard(run, 'coin');
    stepRun(run, FIXED_STEP);
  }
  assert.equal(run.growth, 1.75);
  assert.equal(run.player.w, 38);
  assert.equal(run.player.height, 58);
  setSliding(run, true);
  hazard(run, 'drone');
  stepRun(run, FIXED_STEP);
  assert.equal(run.player.height, 28);
  assert.equal(run.hearts, 3);
});

test('damaging hits shrink the Friend by0.35 down to its original size', () => {
  const run = emptyRun();
  run.growth = 1.75;
  hazard(run);
  stepRun(run, FIXED_STEP);
  assert.equal(run.growth, 1.4);
  // An overlapping hazard during protection causes neither damage nor shrinking.
  hazard(run);
  stepRun(run, FIXED_STEP);
  assert.equal(run.growth, 1.4);
  advance(run, 2);
  run.growth = 1.1;
  hazard(run);
  stepRun(run, FIXED_STEP);
  assert.equal(run.growth, 1);
  assert.equal(run.hearts, 1);
});

test('a shield-blocked obstacle preserves the Friend growth', () => {
  const run = emptyRun();
  run.growth = 1.6;
  run.shield = 5;
  hazard(run);
  stepRun(run, FIXED_STEP);
  assert.equal(run.growth, 1.6);
  assert.equal(run.hearts, 3);
  assert.equal(run.shield, 0);
});

test('a run finishes at exactly90 simulation seconds and cannot restart implicitly', () => {
  const run = emptyRun();
  advance(run, 90);
  assert.equal(run.elapsed, 90);
  assert.equal(run.status, 'finished');
  assert.equal(run.finishReason, 'time');
  assert.equal(run.speed, MAX_SPEED);
  assert.equal(jump(run), false);
  assert.deepEqual(stepRun(run, 0.2), []);
  assert.equal(run.elapsed, 90);
});

test('third hit finishes once with a hearts reason', () => {
  const run = emptyRun();
  run.hearts = 1;
  hazard(run);
  const events = stepRun(run, 0.2);
  assert.equal(run.hearts, 0);
  assert.equal(run.status, 'finished');
  assert.equal(run.finishReason, 'hearts');
  assert.equal(events.filter((event) => event.type === 'finish').length, 1);
});

test('long or malformed deltas never teleport the player through the course', () => {
  const run = emptyRun();
  stepRun(run, NaN);
  stepRun(run, Infinity);
  stepRun(run, -1);
  assert.equal(run.elapsed, 0);
  stepRun(run, 100);
  assert.equal(run.elapsed, 0.25);
});

test('mobile crop gives at least one second of visible obstacle warning at normal pace', () => {
  const run = createRun(1);
  const firstCollisionEdge = run.player.x + run.player.w;
  assert.ok((520 - firstCollisionEdge) / MAX_SPEED > 1);
  assert.ok(run.entities.filter((entity) => entity.kind === 'crystal').every((entity) => entity.x > 900));
});

test('normal remains the default and every difficulty keeps the same four tutorial coins', () => {
  assert.deepEqual(createRun(42), createRun(42, 'normal'));
  const tutorial = createRun(42).entities.filter((entity) => entity.id <= 4);
  for (const difficulty of DIFFICULTY_ORDER) {
    const run = createRun(42, difficulty);
    assert.equal(run.difficulty, difficulty);
    assert.equal(run.duration, DIFFICULTIES[difficulty].seconds);
    assert.equal(run.speed, DIFFICULTIES[difficulty].startSpeed);
    assert.deepEqual(run.entities.filter((entity) => entity.id <= 4), tutorial);
  }
});

for (const difficulty of DIFFICULTY_ORDER) {
  test(`${difficulty} ends at its exact duration at normal and boosted pace`, () => {
    for (const pace of [0, 1] as const) {
      const run = emptyRun(7, difficulty);
      setPace(run, pace);
      advance(run, run.duration - 0.25, 0.25);
      assert.equal(run.status, 'running');
      const events = stepRun(run, 0.25);
      assert.equal(run.elapsed, DIFFICULTIES[difficulty].seconds);
      assert.equal(run.finishReason, 'time');
      assert.equal(events.filter((event) => event.type === 'finish').length, 1);
      assert.ok(Math.abs(run.speed - DIFFICULTIES[difficulty].maxSpeed * (1 + pace * 0.3)) < 1e-8);
    }
  });

  test(`${difficulty} course generation and pace are repeatable across frame rates`, () => {
    const runs = [30, 60, 144, 60].map((fps) => {
      const run = createRun('difficulty-repeatability', difficulty);
      run.invulnerable = run.duration + 1;
      for (const pace of [0, 1, -1] as const) {
        setPace(run, pace);
        advance(run, 8, 1 / fps);
      }
      return run;
    });
    for (const run of runs) {
      assert.equal(run.elapsed, 24);
      assert.equal(run.distance, runs[0].distance);
      assert.equal(run.speed, runs[0].speed);
      assert.equal(run._rng, runs[0]._rng);
      assert.deepEqual(run.entities, runs[0].entities);
    }
  });

  test(`${difficulty} can finish with legal jumps and slides at normal and boosted pace`, () => {
    for (const pace of [0, 1] as const) for (let seed = 1; seed <= 12; seed += 1) {
      const run = createRun(seed, difficulty);
      setPace(run, pace);
      while (run.status === 'running') {
        legalPilot(run);
        stepRun(run, 1 / 60);
      }
      assert.equal(run.finishReason, 'time', `${difficulty}, pace${pace}, seed${seed}`);
      assert.equal(run.hearts, 3, `${difficulty}, pace${pace}, seed${seed}`);
    }
  });
}

test('difficulty changes hazard density while all generated coins remain clear and reachable', () => {
  const hazardCounts = { easy: 0, normal: 0, degen: 0 };
  const maximumHeights = { easy: 0, normal: 0, degen: 0 };
  const coinHeights = { easy: new Set<number>(), normal: new Set<number>(), degen: new Set<number>() };
  for (const difficulty of DIFFICULTY_ORDER) for (let seed = 1; seed <= 12; seed += 1) {
    const run = createRun(seed, difficulty);
    run.invulnerable = run.duration + 1;
    const seen = new Set<number>();
    while (run.elapsed < 60 && run.status === 'running') {
      for (const entity of run.entities) {
        if (seen.has(entity.id)) continue;
        seen.add(entity.id);
        assert.ok(entity.w > 0 && entity.h > 0);
        assert.ok(entity.y >= 180 && entity.y + entity.h <= GROUND_Y);
        if (isHazard(entity)) {
          hazardCounts[difficulty] += 1;
          if (entity.kind === 'drone') assert.ok(entity.y + entity.h < GROUND_Y - 28);
          else maximumHeights[difficulty] = Math.max(maximumHeights[difficulty], entity.h);
        }
        if (entity.kind === 'coin') {
          coinHeights[difficulty].add(Math.round(entity.y));
          // This envelope is reached by the actual double-jump physics below.
          assert.ok(entity.y >= 180 && entity.y <= 360);
          for (const obstacle of run.entities.filter(isHazard)) {
            const overlapping = entity.x < obstacle.x + obstacle.w && entity.x + entity.w > obstacle.x &&
              entity.y < obstacle.y + obstacle.h && entity.y + entity.h > obstacle.y;
            assert.equal(overlapping, false, `${difficulty} coin${entity.id} overlaps obstacle${obstacle.id}`);
          }
        }
      }
      stepRun(run, 0.25);
    }
  }
  assert.ok(hazardCounts.easy < hazardCounts.normal);
  assert.ok(hazardCounts.normal < hazardCounts.degen);
  assert.ok(maximumHeights.easy < maximumHeights.normal);
  assert.ok(maximumHeights.normal < maximumHeights.degen);
  assert.ok(coinHeights.easy.size < coinHeights.normal.size);
  assert.ok(coinHeights.normal.size < coinHeights.degen.size);
  assert.ok(Math.min(...coinHeights.degen) < Math.min(...coinHeights.normal));
  const jumper = emptyRun();
  jump(jumper);
  advance(jumper, 0.38);
  jump(jumper);
  advance(jumper, 0.35);
  assert.ok(jumper.player.y - jumper.player.height < 180);
  assert.ok(jumper.player.y > 180);
});

function bonusOnlyRun(seed: number | string = 7, difficulty: Difficulty = 'normal'): RunState {
  const run = createRun(seed, difficulty);
  run.entities = [];
  run._nextSpawnDistance = Infinity;
  return run;
}

function addBonus(run: RunState, x = 175, y = 230): Entity {
  const bonus: Entity = {
    id: --run._bonusId, kind: 'bonus', x, y, w: 48, h: 48,
    fly: { baseY: y, phase: 0, speedMultiplier: 1.15, extraSpeed: 25 },
  };
  run.entities.push(bonus);
  return bonus;
}

test('bonus waves start at4–6 seconds, repeat occasionally, and sometimes contain a staggered pair', () => {
  let pairedWaves = 0;
  let singleWaves = 0;
  for (let seed = 1; seed <= 10; seed += 1) {
    const run = bonusOnlyRun(seed);
    const waveTimes: number[] = [];
    while (run.status === 'running') {
      const events = stepRun(run, 1 / 60);
      for (const event of events.filter((event) => event.type === 'bonus-spawn')) {
        waveTimes.push(run.elapsed);
        assert.ok(event.amount === 1 || event.amount === 2);
        if (event.amount === 2) {
          pairedWaves += 1;
          const pair = run.entities.filter((entity) => entity.kind === 'bonus').slice(-2);
          assert.equal(pair.length, 2);
          assert.ok(pair[1].x - pair[0].x >= 260 && pair[1].x - pair[0].x <= 360);
          assert.ok(Math.abs(pair[0].fly!.baseY - pair[1].fly!.baseY) >= 27);
        } else singleWaves += 1;
      }
      for (const bonus of run.entities.filter((entity) => entity.kind === 'bonus')) {
        assert.equal(bonus.w, 48);
        assert.equal(bonus.h, 48);
        assert.ok(bonus.y >= 183 && bonus.y + bonus.h <= 299);
      }
    }
    assert.ok(waveTimes.length >= 6 && waveTimes.length <= 9);
    assert.ok(waveTimes[0] >= 4 && waveTimes[0] <= 6 + 1 / 60);
    for (let i = 1; i < waveTimes.length; i += 1) {
      const gap = waveTimes[i] - waveTimes[i - 1];
      assert.ok(gap >= 10 && gap <= 15 + 1 / 60);
    }
  }
  assert.ok(pairedWaves > 0);
  assert.ok(singleWaves > pairedWaves);
});

test('bonus flight overtakes normal scroll and bobs within the airborne pickup lane', () => {
  const run = emptyRun();
  const bonus = addBonus(run, 800, 230);
  const initialX = bonus.x;
  const initialDistance = run.distance;
  stepRun(run, 0.25);
  const scroll = (run.distance - initialDistance) * 10;
  assert.ok(Math.abs((initialX - bonus.x) - (scroll * 1.15 + 25 * 0.25)) < 1e-8);
  assert.ok(initialX - bonus.x > scroll);
  assert.notEqual(bonus.y, 230);
  assert.ok(bonus.y >= 223 && bonus.y <= 237);
});

test('one bonus pickup gives one coin, growth and combo step, with a10x token reward weight', () => {
  const run = emptyRun();
  jump(run);
  advance(run, 0.25);
  const bonus = addBonus(run);
  const event = stepRun(run, FIXED_STEP).find((event) => event.type === 'coin');
  assert.ok(event);
  assert.equal(event.rewardMultiplier, 10);
  assert.equal(event.amount, 1);
  assert.equal(event.points, 10);
  assert.equal(run.coins, 1);
  assert.equal(run.bonusCoins, 1);
  assert.equal(run._coinStreak, 1);
  assert.equal(run.growth, 1.035);
  assert.ok(!run.entities.includes(bonus));
  assert.ok(!stepRun(run, 0.25).some((event) => event.type === 'coin'));
  assert.equal(run.coins, 1);
  const regular = emptyRun();
  hazard(regular, 'coin');
  assert.equal(stepRun(regular, FIXED_STEP).find((event) => event.type === 'coin')?.rewardMultiplier, 1);
  assert.equal(regular.bonusCoins, 0);
});

test('magnet collects an airborne bonus once without counting ten pickups', () => {
  const run = emptyRun();
  addBonus(run, 230, 230);
  stepRun(run, FIXED_STEP);
  assert.equal(run.coins, 0);
  run.magnet = 3;
  const events = stepRun(run, 0.1).filter((event) => event.type === 'coin');
  assert.equal(events.length, 1);
  assert.equal(events[0].rewardMultiplier, 10);
  assert.equal(run.coins, 1);
  assert.equal(run.bonusCoins, 1);
  assert.equal(run.growth, 1.035);
});

test('bonus RNG and entity IDs never change the seeded obstacle or ordinary coin course', () => {
  const withBonus = createRun('independent-bonus');
  const withoutBonus = createRun('independent-bonus');
  withoutBonus._nextBonusAt = Infinity;
  withBonus.invulnerable = withoutBonus.invulnerable = 90;
  advance(withBonus, 40);
  advance(withoutBonus, 40);
  assert.equal(withBonus._rng, withoutBonus._rng);
  assert.equal(withBonus._id, withoutBonus._id);
  assert.deepEqual(withBonus.entities.filter((entity) => entity.kind !== 'bonus'), withoutBonus.entities);
  assert.equal(withBonus._nextSpawnDistance, withoutBonus._nextSpawnDistance);
});

test('bonus schedules, flight and wave events are identical across frame rates', () => {
  const records = [30, 60, 144].map((fps) => {
    const run = bonusOnlyRun('bonus-repeatability');
    const events = [];
    for (let frame = 0; frame < fps * 40; frame += 1) events.push(...stepRun(run, 1 / fps));
    return { entities: run.entities, events, bonusRng: run._bonusRng, nextAt: run._nextBonusAt };
  });
  for (const record of records) assert.deepEqual(record, records[0]);
});

test('generated flying bonuses are reachable with ordinary legal jump inputs', () => {
  for (const difficulty of DIFFICULTY_ORDER) for (let seed = 1; seed <= 6; seed += 1) {
    const run = bonusOnlyRun(seed, difficulty);
    while (run.status === 'running' && run.elapsed < 13) {
      const next = run.entities.find((entity) => entity.kind === 'bonus' && entity.x + entity.w > run.player.x);
      if (next && run.player.grounded) {
        const until = (next.x - run.player.x - run.player.w) / (run.speed * 1.15 + 25);
        if (until < 0.4) jump(run);
      }
      stepRun(run, 1 / 60);
    }
    assert.ok(run.bonusCoins >= 1, `${difficulty}, seed${seed}`);
  }
});

test('fresh runs reset bonus state and closing seconds never spawn unreachable rewards', () => {
  const first = createRun('bonus-reset', 'degen');
  const initialAt = first._nextBonusAt;
  first.entities = [];
  first._nextSpawnDistance = Infinity;
  advance(first, 10);
  assert.ok(first._bonusId < 0);
  const fresh = createRun('bonus-reset', 'degen');
  assert.equal(fresh._nextBonusAt, initialAt);
  assert.equal(fresh._bonusId, 0);
  assert.equal(fresh.bonusCoins, 0);
  assert.ok(!fresh.entities.some((entity) => entity.kind === 'bonus'));

  const ending = emptyRun(7, 'degen');
  ending._tick = (ending.duration - 2) / FIXED_STEP;
  ending.elapsed = ending.duration - 2;
  ending._nextBonusAt = ending.elapsed;
  assert.ok(!stepRun(ending, FIXED_STEP).some((event) => event.type === 'bonus-spawn'));
  assert.equal(ending._nextBonusAt, Infinity);
  advance(ending, 2);
  assert.equal(ending.elapsed, ending.duration);
  assert.equal(ending.finishReason, 'time');
  assert.equal(ending._bonusId, 0);
  assert.deepEqual(stepRun(ending, 0.25), []);
});
