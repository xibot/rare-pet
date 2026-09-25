import test from 'node:test';
import assert from 'node:assert/strict';
import { actionAvailability, applyCare, blankCare, DAY, FOUR_HOURS, PET_GRACE, projectCare, readPreview, savePreview, type CareState } from '../games/rare-pet/care.ts';
const START = 20 * DAY + 3600;
function buildStreak(days: number): CareState {
  let state = blankCare();
  for (let day = 0; day < days; day++) state = applyCare(state, 'pet', START + day * DAY);
  return state;
}

test('never-used actions are immediately ready, including at epoch zero', () => {
  const state = blankCare();
  for (const action of ['pet', 'feed', 'poop', 'launch', 'play'] as const) {
    assert.deepEqual(actionAvailability(state, action, 0), { remaining: action === 'play' ? 3 : 1, readyAt: 0, waitSeconds: 0 });
  }
  const first = applyCare(state, 'pet', 0);
  assert.equal(first.lastPetAt, 0);
  assert.throws(() => applyCare(first, 'pet', 0), /ready in 24:00:00/);
  assert.equal(applyCare(first, 'pet', DAY).streak, 2);
  assert.equal(state.lastPetAt, -1);
});

test('pet is unavailable until exactly 24h; midnight does not reset it or refresh its timer', () => {
  const start = 21 * DAY - 60;
  const first = applyCare(blankCare(), 'pet', start);
  assert.throws(() => applyCare(first, 'pet', 21 * DAY + 60), /ready in/);
  assert.deepEqual(actionAvailability(first, 'pet', start + DAY - 1), { remaining: 0, readyAt: start + DAY, waitSeconds: 1 });
  const next = applyCare(first, 'pet', start + DAY);
  assert.equal(next.kinship, 2); assert.equal(next.streak, 2);
  assert.equal(first.lastPetAt, start);
});

test('24h grace begins after pet unlocks; deadline is inclusive and decay starts a second later', () => {
  assert.equal(PET_GRACE, DAY);
  const state = buildStreak(7), deadline = state.lastPetAt + DAY + PET_GRACE;
  for (const time of [state.lastPetAt + DAY, deadline]) {
    assert.equal(projectCare(state, time).streak, 7);
    assert.equal(actionAvailability(state, 'pet', time).remaining, 1);
    assert.equal(applyCare(state, 'pet', time).streak, 8);
  }
  const overdue = projectCare(state, deadline + 1);
  assert.equal(overdue.kinship, 6); assert.equal(overdue.streak, 0); assert.equal(overdue.rarity, 0);
  const next = applyCare(overdue, 'pet', deadline + 1);
  assert.equal(next.kinship, 7); assert.equal(next.streak, 1); assert.equal(next.decayApplied, 0);
});

test('decay accrues once per missed 24h after grace and other actions cannot refresh pet', () => {
  const state = buildStreak(5), deadline = state.lastPetAt + DAY + PET_GRACE;
  let overdue = projectCare(state, deadline + 1);
  for (const action of ['feed', 'poop', 'play'] as const) overdue = applyCare(overdue, action, deadline + 1);
  assert.equal(overdue.kinship, 4); assert.equal(overdue.lastPetAt, state.lastPetAt);
  assert.equal(projectCare(overdue, deadline + DAY).kinship, 4);
  assert.equal(projectCare(overdue, deadline + DAY + 1).kinship, 3);
  assert.equal(projectCare(overdue, deadline + 36500 * DAY).kinship, 0);
  assert.equal(projectCare(applyCare(blankCare(), 'pet', 0), DAY + PET_GRACE + 1).streak, 0);
});

test('rarity grows for each seven successful pet windows and resets with its streak', () => {
  assert.equal(buildStreak(6).rarity, 0); assert.equal(buildStreak(7).rarity, 1);
  const state = buildStreak(14);
  assert.equal(state.rarity, 2);
  assert.equal(projectCare(state, state.lastPetAt + DAY + PET_GRACE + 1).rarity, 0);
});

for (const action of ['feed', 'poop'] as const) test(`${action} has its own exact 4h cooldown, independent of midnight and other actions`, () => {
  const start = 21 * DAY - 60;
  const first = applyCare(blankCare(), action, start);
  assert.throws(() => applyCare(first, action, 21 * DAY + 1), /ready in/);
  assert.throws(() => applyCare(first, action, start + FOUR_HOURS - 1), /00:00:01/);
  assert.equal(actionAvailability(first, action, start + FOUR_HOURS).remaining, 1);
  const next = applyCare(first, action, start + FOUR_HOURS);
  assert.equal(next[action === 'feed' ? 'strength' : 'health'], 2);
  if (action === 'feed') assert.equal(next.stamina, 10);
  assert.equal(actionAvailability(first, action === 'feed' ? 'poop' : 'feed', start).remaining, 1);
  assert.equal(actionAvailability(first, 'pet', start).remaining, 1);
});

test('play slots return individually 24h after staggered completions', () => {
  let state = blankCare();
  for (const elapsed of [0, 3600, 7200]) state = applyCare(state, 'play', START + elapsed);
  assert.equal(state.experience, 30);
  assert.deepEqual(state.playTimes, [START, START + 3600, START + 7200]);
  assert.throws(() => applyCare(state, 'play', 21 * DAY), /rolling 24-hour/);
  assert.deepEqual(actionAvailability(state, 'play', START + DAY - 1), { remaining: 0, readyAt: START + DAY, waitSeconds: 1 });
  assert.equal(actionAvailability(state, 'play', START + DAY).remaining, 1);
  assert.equal(actionAvailability(state, 'play', START + DAY + 3600).remaining, 2);
  state = applyCare(state, 'play', START + DAY);
  assert.equal(state.experience, 40);
  assert.deepEqual(state.playTimes, [START + 3600, START + 7200, START + DAY]);
  assert.equal(actionAvailability(state, 'play', START + DAY).waitSeconds, 3600);
});

test('same-second runs and epoch-zero completions still consume three slots', () => {
  let state = blankCare();
  for (let i = 0; i < 3; i++) state = applyCare(state, 'play', 0);
  assert.equal(actionAvailability(state, 'play', DAY - 1).remaining, 0);
  assert.equal(actionAvailability(state, 'play', DAY).remaining, 3);
  const projected = projectCare(state, DAY);
  assert.deepEqual(projected.playTimes, []); assert.equal(projected.experience, 30);
  assert.deepEqual(state.playTimes, [0, 0, 0], 'projection never mutates source timestamps');
});

test('launch availability models 24h while no applyCare launch grant is exposed', () => {
  const state = { ...blankCare(), lastLaunchAt: START };
  assert.equal(actionAvailability(state, 'launch', START + DAY - 1).waitSeconds, 1);
  assert.equal(actionAvailability(state, 'launch', START + DAY).remaining, 1);
  assert.equal(state.brain, 0);
});

function storage() {
  const values = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  return { values, restore() { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); } };
}
const legacy = () => ({ kinship: 4, strength: 5, stamina: 25, health: 3, experience: 30, brain: 0, streak: 4, rarity: 0,
  lastPetAt: START, careDay: 20, feedsToday: 5, playsToday: 3, poopsToday: 3, rewardDay: 20, decayApplied: 0 });

test('v1 migration preserves earned stats and conservatively starts unknown current-day cooldowns once', () => {
  const mock = storage();
  try {
    mock.values.set('rarepet:preview:v1:1', JSON.stringify(legacy()));
    const next = readPreview('1', START + 60);
    for (const key of ['kinship', 'strength', 'stamina', 'health', 'experience', 'streak'] as const) assert.equal(next[key], legacy()[key]);
    assert.equal(next.lastPetAt, START); assert.equal(next.lastFeedAt, START + 60); assert.equal(next.lastPoopAt, START + 60);
    assert.equal(actionAvailability(next, 'play', START + 60).remaining, 0);
    assert.equal(actionAvailability(next, 'feed', START + 60).waitSeconds, FOUR_HOURS);
    assert(mock.values.has('rarepet:preview:v2:1'));
    assert.equal(readPreview('1', START + 120).lastFeedAt, START + 60, 'later loads cannot restart migration cooldowns');
  } finally { mock.restore(); }
});

test('yesterday quotas migrate using their latest possible use and slots expire normally', () => {
  const mock = storage();
  try {
    mock.values.set('rarepet:preview:v1:1', JSON.stringify(legacy()));
    const now = 21 * DAY + 60, next = readPreview('1', now);
    assert.equal(next.lastFeedAt, 21 * DAY - 1);
    assert.equal(actionAvailability(next, 'feed', now).waitSeconds, FOUR_HOURS - 61);
    assert.equal(actionAvailability(next, 'play', 22 * DAY - 1).remaining, 3);
  } finally { mock.restore(); }
});

test('a legacy midnight reset cannot erase possibly recent previous-day plays', () => {
  const mock = storage();
  try {
    mock.values.set('rarepet:preview:v1:1', JSON.stringify({ ...legacy(), careDay: 21, feedsToday: 0, playsToday: 0, poopsToday: 0 }));
    const now = 21 * DAY + 60, next = readPreview('1', now);
    assert.equal(next.lastFeedAt, 21 * DAY - 1);
    assert.equal(actionAvailability(next, 'play', now).remaining, 0);
    assert.equal(next.experience, 30);
  } finally { mock.restore(); }
});

test('migration and reset keep Genesis/Generations namespaces separate; v2 wins over old stats', () => {
  const mock = storage();
  try {
    mock.values.set('rarepet:preview:v1:1', JSON.stringify(legacy()));
    mock.values.set('rarepet:preview:v1:genesis:1', JSON.stringify({ ...legacy(), strength: 2 }));
    assert.equal(readPreview('1', START).strength, 5);
    assert.equal(readPreview('genesis:1', START).strength, 2);
    savePreview('genesis:1', blankCare());
    assert.equal(readPreview('genesis:1', START).strength, 0);
    assert.equal(readPreview('1', START).strength, 5);
  } finally { mock.restore(); }
});

test('corrupt caches and unavailable storage cannot crash care or resurrect a reset v1 cache', () => {
  const mock = storage();
  try {
    mock.values.set('rarepet:preview:v1:1', JSON.stringify(legacy()));
    mock.values.set('rarepet:preview:v2:1', '{bad');
    assert.deepEqual(readPreview('1', START), blankCare());
    mock.values.set('rarepet:preview:v2:1', JSON.stringify({ ...blankCare(), playTimes: [0, 1, 2, 3] }));
    assert.deepEqual(readPreview('1', START), blankCare());
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('Unavailable'); } });
    assert.deepEqual(readPreview('1', START), blankCare());
    assert.doesNotThrow(() => savePreview('1', blankCare()));
  } finally { mock.restore(); }
});
