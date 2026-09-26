import test from 'node:test';
import assert from 'node:assert/strict';
import { actionGain, actionSchedule, careNumber, decodeCareRules, DEFAULT_CARE_RULES, CARE_ACTIONS } from '../games/rare-pet/care-policy.ts';
import { actionAvailability, applyCare, blankCare, projectCare, type CareState } from '../games/rare-pet/care.ts';

const raw = () => ({ ...DEFAULT_CARE_RULES, actions: CARE_ACTIONS.map(action => ({ ...DEFAULT_CARE_RULES.actions[action] })) });

test('contract rules decode exact action order and surface custom rewards, cooldowns and caps', () => {
  const data = raw();
  data.actions[1] = { points: 7, secondaryPoints: 12, cooldown: 7200, dailyLimit: 5, enabled: true };
  data.actions[2] = { points: 18, secondaryPoints: 0, cooldown: 0, dailyLimit: 8, enabled: true };
  const rules = decodeCareRules(data);
  assert.equal(actionGain('feed', rules), '+7 strength · +12 stamina');
  assert.equal(actionSchedule('feed', rules), '1 EVERY 2H · 5/24H');
  assert.equal(actionGain('play', rules), '+18 XP / completed run');
  assert.equal(actionSchedule('play', rules), '8 IN 24H');
  assert.equal(actionSchedule('pet'), '1 EVERY 24H');
  assert.equal(actionSchedule('poop'), '1 EVERY 4H');
});

test('incompatible policies fail closed rather than replacing fields with preview defaults', () => {
  for (const change of [
    (r: ReturnType<typeof raw>) => { r.actions.pop(); },
    (r: ReturnType<typeof raw>) => { r.actions[0].dailyLimit = 33; },
    (r: ReturnType<typeof raw>) => { r.actions[0].dailyLimit = 0; },
    (r: ReturnType<typeof raw>) => { r.actions[0].points = 1_000_001; },
    (r: ReturnType<typeof raw>) => { r.actions[0].secondaryPoints = 1; },
    (r: ReturnType<typeof raw>) => { r.actions[0].cooldown = 31 * 86400; },
    (r: ReturnType<typeof raw>) => { r.actions[0].cooldown = 3600; },
    (r: ReturnType<typeof raw>) => { r.actions[0].dailyLimit = 2; },
    (r: ReturnType<typeof raw>) => { r.decayInterval = 0; },
    (r: ReturnType<typeof raw>) => { r.rarityEvery = 0; },
    (r: ReturnType<typeof raw>) => { r.playSigner = 'wrong'; },
  ]) {
    const value = raw(); change(value); assert.throws(() => decodeCareRules(value));
  }
  assert.throws(() => careNumber(2n ** 100n));
  assert.throws(() => careNumber(-1n));
  assert.throws(() => careNumber(1.5));
  assert.equal(careNumber(32n, 32), 32);
});

test('onchain availability preserves snapshotted cooldowns through rule changes and timer expiry', () => {
  const state: CareState = { ...blankCare(), lastPetAt: 100,
    policy: { version: 2, rules: { ...DEFAULT_CARE_RULES, petGrace: 3600 },
      blockNumber: '100', blockTimestamp: 200,
      availability: { pet: { remaining: 0, readyAt: 86500, enabled: true }, feed: { remaining: 6, readyAt: 200, enabled: true },
        play: { remaining: 0, readyAt: 200, enabled: false }, poop: { remaining: 0, readyAt: 200, enabled: false } },
      petSchedule: { nextAvailableAt: 86500, graceDeadline: 172900, decayInterval: 86400, decayPoints: 1, nextRarityAt: 7, nextRarityPoints: 1 } } };
  assert.equal(actionAvailability(state, 'pet', 200).readyAt, 86500);
  assert.equal(actionAvailability(state, 'pet', 86501).remaining, 0, 'only a new onchain read may unlock an action');
  assert.equal(actionAvailability(state, 'poop', 86501).remaining, 0, 'paused actions cannot unlock as time passes');
  assert.strictEqual(projectCare(state, 1_000_000), state, 'never reproject a chain snapshot with newer rules');
  assert.throws(() => applyCare(state, 'feed', 200), /confirmed transaction/);
});
