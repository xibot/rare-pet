/** Device-local preview of the care rules. Never used to authorize onchain rewards. */
export const DAY = 86_400;
export const FOUR_HOURS = 4 * 3_600;
/** Pet unlocks after 24h, then has a further 24h before its streak breaks. */
export const PET_GRACE = DAY;
export type CareAction = 'pet' | 'feed' | 'play' | 'poop';
export type TimedAction = CareAction | 'launch';
export type CareState = {
  kinship: number; strength: number; stamina: number; health: number; experience: number;
  brain: number; streak: number; rarity: number;
  /** -1 means never. Zero is a valid first action at the Unix epoch. */
  lastPetAt: number; lastFeedAt: number; lastPoopAt: number; lastLaunchAt: number;
  /** At most three completions, oldest first. Each slot returns after its own 24h. */
  playTimes: number[];
  decayApplied: number;
};
export const blankCare = (): CareState => ({ kinship: 0, strength: 0, stamina: 0, health: 0,
  experience: 0, brain: 0, streak: 0, rarity: 0, lastPetAt: -1, lastFeedAt: -1,
  lastPoopAt: -1, lastLaunchAt: -1, playTimes: [], decayApplied: 0 });
const recentPlays = (state: CareState, now: number) => state.playTimes.filter(time => time + DAY > now).sort((a, b) => a - b);
export function actionAvailability(state: CareState, action: TimedAction, now: number): { remaining: number; readyAt: number; waitSeconds: number } {
  if (action === 'play') {
    const plays = recentPlays(state, now), remaining = Math.max(0, 3 - plays.length);
    const readyAt = remaining ? now : plays[0] + DAY;
    return { remaining, readyAt, waitSeconds: Math.max(0, readyAt - now) };
  }
  const last = action === 'pet' ? state.lastPetAt : action === 'feed' ? state.lastFeedAt : action === 'poop' ? state.lastPoopAt : state.lastLaunchAt;
  const interval = action === 'feed' || action === 'poop' ? FOUR_HOURS : DAY;
  const readyAt = last < 0 ? now : Math.max(now, last + interval);
  const waitSeconds = Math.max(0, readyAt - now);
  return { remaining: waitSeconds ? 0 : 1, readyAt, waitSeconds };
}
export function projectCare(state: CareState, now: number): CareState {
  const next = { ...state, playTimes: recentPlays(state, now) };
  if (next.lastPetAt >= 0 && now > next.lastPetAt + DAY + PET_GRACE) {
    const missed = Math.ceil((now - next.lastPetAt - DAY - PET_GRACE) / DAY);
    next.kinship = Math.max(0, next.kinship - Math.max(0, missed - next.decayApplied));
    next.decayApplied = Math.max(next.decayApplied, missed); next.streak = 0; next.rarity = 0;
  }
  return next;
}
export function applyCare(state: CareState, action: CareAction, now: number): CareState {
  const next = projectCare(state, now);
  const available = actionAvailability(next, action, now);
  if (!available.remaining) throw new Error(action === 'play'
    ? `All three rolling 24-hour play slots are used. Next slot in ${duration(available.waitSeconds)}.`
    : `${action === 'pet' ? 'Pet' : action === 'feed' ? 'Feed' : 'Poop'} is ready in ${duration(available.waitSeconds)}.`);
  if (action === 'pet') {
    next.kinship++; next.streak++; next.lastPetAt = now; next.decayApplied = 0;
    next.rarity = Math.floor(next.streak / 7);
  } else if (action === 'feed') {
    next.lastFeedAt = now; next.strength++; next.stamina += 5;
  } else if (action === 'poop') {
    next.lastPoopAt = now; next.health++;
  } else {
    next.playTimes.push(now); next.playTimes.sort((a, b) => a - b); next.experience += 10;
  }
  return next;
}
const traits = ['kinship', 'strength', 'stamina', 'health', 'experience', 'brain', 'streak', 'rarity', 'decayApplied'] as const;
const timestamps = ['lastPetAt', 'lastFeedAt', 'lastPoopAt', 'lastLaunchAt'] as const;
const integer = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
function validCare(value: unknown): value is CareState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return traits.every(key => integer(state[key])) && timestamps.every(key => integer(state[key], -1)) &&
    Array.isArray(state.playTimes) && state.playTimes.length <= 3 && state.playTimes.every(time => integer(time));
}
/** Old quotas omit action timestamps. Use the latest possible time in their recorded UTC day. */
function migrateLegacy(value: unknown, now: number): CareState | null {
  if (!value || typeof value !== 'object') return null;
  const old = value as Record<string, number>;
  if (!traits.every(key => integer(old[key])) || !integer(old.lastPetAt) ||
    !['careDay', 'rewardDay'].every(key => integer(old[key], -1)) ||
    !['feedsToday', 'playsToday', 'poopsToday'].every(key => integer(old[key]))) return null;
  const next = blankCare();
  for (const key of traits) next[key] = old[key];
  next.lastPetAt = old.rewardDay >= 0 || old.lastPetAt > 0 ? old.lastPetAt : -1;
  // A nonzero quota could have been used a moment before the old day's end.
  const dayEnd = old.careDay >= 0 ? Math.min(now, (old.careDay + 1) * DAY - 1) : now;
  const previousDayEnd = old.careDay > 0 ? Math.min(now, old.careDay * DAY - 1) : -1;
  next.lastFeedAt = old.feedsToday ? dayEnd : old.strength ? previousDayEnd : -1;
  next.lastPoopAt = old.poopsToday ? dayEnd : old.health ? previousDayEnd : -1;
  const currentRuns = Math.min(3, old.playsToday);
  const earlierRuns = previousDayEnd < 0 ? 0 : Math.min(3 - currentRuns, Math.max(0, Math.floor(old.experience / 10) - currentRuns));
  next.playTimes = [...Array.from({ length: earlierRuns }, () => previousDayEnd), ...Array.from({ length: currentRuns }, () => dayEnd)];
  // Preserve earned points and already-applied decay; never award points during migration.
  return projectCare(next, now);
}
export function readPreview(key: string, now = Math.floor(Date.now() / 1000)): CareState {
  try {
    const saved = localStorage.getItem(`rarepet:preview:v2:${key}`);
    if (saved !== null) {
      const value: unknown = JSON.parse(saved);
      return validCare(value) ? projectCare(value, now) : blankCare();
    }
    const legacy: unknown = JSON.parse(localStorage.getItem(`rarepet:preview:v1:${key}`) || 'null');
    const migrated = migrateLegacy(legacy, now);
    if (migrated) { savePreview(key, migrated); return migrated; }
  } catch { /* Unavailable or malformed device storage starts a fresh preview. */ }
  return blankCare();
}
export function savePreview(key: string, value: CareState) {
  try { localStorage.setItem(`rarepet:preview:v2:${key}`, JSON.stringify(value)); } catch { /* Care remains usable for this session. */ }
}
export function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600).toString().padStart(2, '0')}:${Math.floor(s % 3600 / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}
