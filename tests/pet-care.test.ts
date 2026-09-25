import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCare, blankCare, DAY, projectCare, type CareState } from '../games/rare-pet/care.ts';

const START = 20 * DAY + 3600;

function buildStreak(days: number, start = START): CareState {
  let state = blankCare();
  for (let day = 0; day < days; day++) state = applyCare(state, 'pet', start + day * DAY);
  return state;
}

test('new care starts unrewarded and first pet on UTC day zero earns its reward once', () => {
  const blank = blankCare();
  assert.equal(blank.rewardDay, -1);
  assert.equal(blank.careDay, -1);
  const first = applyCare(blank, 'pet', 0);
  assert.equal(first.rewardDay, 0);
  assert.equal(first.kinship, 1);
  assert.equal(first.streak, 1);
  const duplicate = applyCare(first, 'pet', 1);
  assert.equal(duplicate.kinship, 1);
  assert.equal(duplicate.streak, 1);
  assert.equal(duplicate.lastPetAt, 1);
  assert.deepEqual(blank, blankCare());
});

test('same-day pet refreshes its deadline without farming kinship or streak', () => {
  const first = applyCare(blankCare(), 'pet', START);
  const duplicate = applyCare(first, 'pet', START + 3600);
  assert.equal(duplicate.kinship, 1);
  assert.equal(duplicate.streak, 1);
  assert.equal(duplicate.lastPetAt, START + 3600);
  assert.equal(projectCare(duplicate, START + DAY + 3600).streak, 1);
  assert.equal(first.lastPetAt, START);
});

test('UTC day rollover allows a pet reward before 24 hours have elapsed', () => {
  const first = applyCare(blankCare(), 'pet', 21 * DAY - 60);
  const second = applyCare(first, 'pet', 21 * DAY + 60);
  assert.equal(second.kinship, 2);
  assert.equal(second.streak, 2);
  assert.equal(second.rewardDay, 21);
});

test('exactly 24 hours is on time and preserves the streak', () => {
  const state = applyCare(blankCare(), 'pet', START);
  const projection = projectCare(state, START + DAY);
  assert.equal(projection.kinship, 1);
  assert.equal(projection.streak, 1);
  assert.equal(projection.decayApplied, 0);
  const next = applyCare(state, 'pet', START + DAY);
  assert.equal(next.kinship, 2);
  assert.equal(next.streak, 2);
});

test('one second past 24 hours applies decay and the next pet restarts at one', () => {
  const state = applyCare(blankCare(), 'pet', START);
  const overdue = projectCare(state, START + DAY + 1);
  assert.equal(overdue.kinship, 0);
  assert.equal(overdue.streak, 0);
  assert.equal(overdue.rarity, 0);
  assert.equal(overdue.decayApplied, 1);
  const next = applyCare(overdue, 'pet', START + DAY + 1);
  assert.equal(next.kinship, 1);
  assert.equal(next.streak, 1);
  assert.equal(next.decayApplied, 0);
});

test('petting at epoch zero is initialized and decays after its deadline', () => {
  const state = applyCare(blankCare(), 'pet', 0);
  const overdue = projectCare(state, DAY + 1);
  assert.equal(overdue.kinship, 0);
  assert.equal(overdue.streak, 0);
  assert.equal(overdue.decayApplied, 1);
});

test('decay occurs once per missed 24-hour period and is not repeated by other actions', () => {
  const state = buildStreak(5);
  const firstMiss = state.lastPetAt + DAY + 1;
  let overdue = projectCare(state, firstMiss);
  assert.equal(overdue.kinship, 4);
  assert.equal(projectCare(overdue, firstMiss).kinship, 4);
  overdue = applyCare(overdue, 'feed', firstMiss);
  overdue = applyCare(overdue, 'poop', firstMiss);
  overdue = applyCare(overdue, 'play', firstMiss);
  assert.equal(overdue.kinship, 4);
  assert.equal(overdue.lastPetAt, state.lastPetAt);
  assert.equal(projectCare(overdue, state.lastPetAt + 2 * DAY).kinship, 4);
  const secondMiss = projectCare(overdue, state.lastPetAt + 2 * DAY + 1);
  assert.equal(secondMiss.kinship, 3);
  assert.equal(secondMiss.decayApplied, 2);
  assert.equal(projectCare(secondMiss, state.lastPetAt + 2 * DAY + 1).kinship, 3);
});

test('many missed periods clamp kinship at zero and allow a fresh streak', () => {
  const state = buildStreak(7);
  const now = state.lastPetAt + 36500 * DAY;
  const overdue = projectCare(state, now);
  assert.equal(overdue.kinship, 0);
  assert.equal(overdue.streak, 0);
  assert.equal(overdue.rarity, 0);
  assert.equal(projectCare(overdue, now + DAY).kinship, 0);
  const next = applyCare(overdue, 'pet', now);
  assert.equal(next.kinship, 1);
  assert.equal(next.streak, 1);
});

test('rarity increases every seven streak days and resets on a broken streak', () => {
  assert.equal(buildStreak(6).rarity, 0);
  assert.equal(buildStreak(7).rarity, 1);
  assert.equal(buildStreak(13).rarity, 1);
  const fourteen = buildStreak(14);
  assert.equal(fourteen.rarity, 2);
  const overdue = projectCare(fourteen, fourteen.lastPetAt + DAY + 1);
  assert.equal(overdue.rarity, 0);
  assert.equal(overdue.streak, 0);
  const restart = applyCare(overdue, 'pet', fourteen.lastPetAt + DAY + 1);
  assert.equal(restart.rarity, 0);
  assert.equal(restart.streak, 1);
});

test('five meals grant strength and stamina, reject a sixth, and reset at UTC midnight', () => {
  let state = blankCare();
  for (let meal = 0; meal < 5; meal++) state = applyCare(state, 'feed', START);
  assert.equal(state.feedsToday, 5);
  assert.equal(state.strength, 5);
  assert.equal(state.stamina, 25);
  assert.throws(() => applyCare(state, 'feed', START), /five meals/);
  assert.equal(state.feedsToday, 5);
  const reset = projectCare(state, 21 * DAY);
  assert.equal(reset.feedsToday, 0);
  assert.equal(reset.strength, 5);
  assert.equal(reset.stamina, 25);
  const next = applyCare(state, 'feed', 21 * DAY);
  assert.equal(next.feedsToday, 1);
  assert.equal(next.strength, 6);
  assert.equal(next.stamina, 30);
});

test('three poop actions grant health and a new UTC day opens the quota again', () => {
  let state = blankCare();
  for (let action = 0; action < 3; action++) state = applyCare(state, 'poop', START);
  assert.equal(state.poopsToday, 3);
  assert.equal(state.health, 3);
  assert.throws(() => applyCare(state, 'poop', START), /Three healthy breaks/);
  assert.equal(projectCare(state, 21 * DAY).poopsToday, 0);
  const next = applyCare(state, 'poop', 21 * DAY);
  assert.equal(next.poopsToday, 1);
  assert.equal(next.health, 4);
});

test('preview play grants ten XP at most three times per UTC day', () => {
  let state = blankCare();
  for (let run = 0; run < 3; run++) state = applyCare(state, 'play', START);
  assert.equal(state.playsToday, 3);
  assert.equal(state.experience, 30);
  assert.throws(() => applyCare(state, 'play', START), /three rewarded runs/);
  assert.equal(state.experience, 30);
  assert.equal(projectCare(state, 21 * DAY).playsToday, 0);
  const next = applyCare(state, 'play', 21 * DAY);
  assert.equal(next.playsToday, 1);
  assert.equal(next.experience, 40);
  assert.equal(next.brain, 0);
});

test('quota rollover resets all daily counts and preserves lifetime traits', () => {
  let state = applyCare(blankCare(), 'pet', START);
  state = applyCare(state, 'feed', START);
  state = applyCare(state, 'poop', START);
  state = applyCare(state, 'play', START);
  const snapshot = { ...state };
  const reset = projectCare(state, 21 * DAY);
  assert.equal(reset.careDay, 21);
  assert.equal(reset.feedsToday, 0);
  assert.equal(reset.playsToday, 0);
  assert.equal(reset.poopsToday, 0);
  for (const trait of ['kinship', 'strength', 'stamina', 'health', 'experience', 'brain', 'streak'] as const) {
    assert.equal(reset[trait], state[trait]);
  }
  assert.deepEqual(state, snapshot);
});
