/** Shared playtest settings; rewards remain simulated and subject to the global cap. */
export const DIFFICULTIES = {
  easy: {
    label: 'Easy', seconds: 120, rewardNumerator: 3, rewardDenominator: 4,
    rewardLabel: '0.75×', startSpeed: 215, maxSpeed: 255,
    description: 'Roomy jumps · gentle coin trails',
  },
  normal: {
    label: 'Normal', seconds: 90, rewardNumerator: 1, rewardDenominator: 1,
    rewardLabel: '1×', startSpeed: 255, maxSpeed: 305,
    description: 'Mixed obstacles · scattered coins',
  },
  degen: {
    label: 'Degen', seconds: 60, rewardNumerator: 2, rewardDenominator: 1,
    rewardLabel: '2×', startSpeed: 295, maxSpeed: 355,
    description: 'Tight combos · wild coin routes',
  },
} as const;

export type Difficulty = keyof typeof DIFFICULTIES;
export const DIFFICULTY_ORDER = ['easy', 'normal', 'degen'] as const;

export function difficultySettings(difficulty: Difficulty) {
  const setting = Object.prototype.hasOwnProperty.call(DIFFICULTIES, difficulty) ? DIFFICULTIES[difficulty] : undefined;
  if (!setting) throw new RangeError('Unknown difficulty. Choose easy, normal, or degen.');
  return setting;
}
