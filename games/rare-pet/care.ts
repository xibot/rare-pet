/** Device-local preview of the care rules. Never used to authorize onchain rewards. */
export const DAY = 86_400;
export type CareAction = 'pet' | 'feed' | 'play' | 'poop';
export type CareState = {
  kinship: number; strength: number; stamina: number; health: number; experience: number;
  brain: number; streak: number; rarity: number; lastPetAt: number; careDay: number;
  feedsToday: number; playsToday: number; poopsToday: number;
  rewardDay: number; decayApplied: number;
};
export const blankCare = (): CareState => ({ kinship: 0, strength: 0, stamina: 0, health: 0,
  experience: 0, brain: 0, streak: 0, rarity: 0, lastPetAt: 0, careDay: -1,
  feedsToday: 0, playsToday: 0, poopsToday: 0, rewardDay: -1, decayApplied: 0 });
export function projectCare(state: CareState, now: number): CareState {
  const next = { ...state }, day = Math.floor(now / DAY);
  if (next.careDay !== day) Object.assign(next, { careDay: day, feedsToday: 0, playsToday: 0, poopsToday: 0 });
  if (next.rewardDay >= 0 && now - next.lastPetAt > DAY) {
    const missed = Math.ceil((now - next.lastPetAt - DAY) / DAY);
    next.kinship = Math.max(0, next.kinship - Math.max(0, missed - next.decayApplied));
    next.decayApplied = missed; next.streak = 0; next.rarity = 0;
  }
  return next;
}
export function applyCare(state: CareState, action: CareAction, now: number): CareState {
  const next = projectCare(state, now), day = Math.floor(now / DAY);
  if (action === 'pet') {
    if (next.rewardDay !== day) { next.kinship++; next.streak++; next.rewardDay = day; }
    // A broken bond can restart the same day, without granting a second daily reward.
    if (!next.streak) next.streak = 1;
    next.lastPetAt = now; next.decayApplied = 0; next.rarity = Math.floor(next.streak / 7);
  } else if (action === 'feed') {
    if (next.feedsToday >= 5) throw new Error('All five meals are served. More at midnight UTC.');
    next.feedsToday++; next.strength++; next.stamina += 5;
  } else if (action === 'poop') {
    if (next.poopsToday >= 3) throw new Error('Three healthy breaks today. More at midnight UTC.');
    next.poopsToday++; next.health++;
  } else {
    if (next.playsToday >= 3) throw new Error('All three rewarded runs are complete today.');
    next.playsToday++; next.experience += 10;
  }
  return next;
}
export function readPreview(key: string): CareState {
  try {
    const value = JSON.parse(localStorage.getItem(`rarepet:preview:v1:${key}`) || 'null');
    if (value && Object.keys(blankCare()).every(k => typeof value[k] === 'number' && Number.isSafeInteger(value[k]) && value[k] >= -1)) return value;
  } catch { /* A unavailable or malformed device cache starts a fresh preview. */ }
  return blankCare();
}
export function savePreview(key: string, value: CareState) {
  try { localStorage.setItem(`rarepet:preview:v1:${key}`, JSON.stringify(value)); } catch { /* Care remains usable for this session. */ }
}
export function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600).toString().padStart(2, '0')}:${Math.floor(s % 3600 / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}
