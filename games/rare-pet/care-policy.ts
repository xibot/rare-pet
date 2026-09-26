export const CARE_ACTIONS = ['pet', 'feed', 'play', 'poop'] as const;
export type CareAction = (typeof CARE_ACTIONS)[number];
export type ActionRule = { points: number; secondaryPoints: number; cooldown: number; dailyLimit: number; enabled: boolean };
export type CareRules = {
  actions: Record<CareAction, ActionRule>;
  petGrace: number; decayInterval: number; decayPoints: number; rarityEvery: number; rarityPoints: number;
  playSigner: string;
};
export const DEFAULT_CARE_RULES: CareRules = {
  actions: {
    pet: { points: 1, secondaryPoints: 0, cooldown: 86_400, dailyLimit: 1, enabled: true },
    feed: { points: 1, secondaryPoints: 5, cooldown: 14_400, dailyLimit: 6, enabled: true },
    play: { points: 10, secondaryPoints: 0, cooldown: 0, dailyLimit: 3, enabled: true },
    poop: { points: 1, secondaryPoints: 0, cooldown: 14_400, dailyLimit: 6, enabled: true },
  },
  petGrace: 86_400, decayInterval: 86_400, decayPoints: 1, rarityEvery: 7, rarityPoints: 1,
  playSigner: '0x0000000000000000000000000000000000000000',
};
export function shortInterval(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}H`;
  if (seconds % 60 === 0) return `${seconds / 60}M`;
  return `${seconds}S`;
}
export function actionSchedule(action: CareAction, rules = DEFAULT_CARE_RULES): string {
  const rule = rules.actions[action];
  if (!rule.enabled) return 'PAUSED';
  if (!rule.cooldown) return `${rule.dailyLimit} IN 24H`;
  // Show both constraints when the rolling cap could bind before the cooldown.
  const cooldown = `1 EVERY ${shortInterval(rule.cooldown)}`;
  return rule.dailyLimit < Math.ceil(86_400 / rule.cooldown) ? `${cooldown} · ${rule.dailyLimit}/24H` : cooldown;
}
export function actionGain(action: CareAction, rules = DEFAULT_CARE_RULES): string {
  const rule = rules.actions[action];
  if (action === 'feed') return `+${rule.points} strength · +${rule.secondaryPoints} stamina`;
  if (action === 'play') return `+${rule.points} XP / completed run`;
  return `+${rule.points} ${action === 'pet' ? 'kinship' : 'health'}`;
}
export function careNumber(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if ((typeof value !== 'number' && typeof value !== 'bigint') || value < 0 || value > maximum || !Number.isSafeInteger(Number(value))) {
    throw new Error('The care contract returned an unsupported numeric value.');
  }
  return Number(value);
}
/** Reject incompatible contracts instead of silently falling back to preview defaults. */
export function decodeCareRules(value: unknown): CareRules {
  if (!value || typeof value !== 'object') throw new Error('The care contract returned incompatible rules.');
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.actions) || raw.actions.length !== 4) throw new Error('The care contract returned incompatible action rules.');
  const actions = Object.fromEntries(raw.actions.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid care action rule.');
    const r = item as Record<string, unknown>;
    const rule = { points: careNumber(r.points, 1_000_000), secondaryPoints: careNumber(r.secondaryPoints, 1_000_000),
      cooldown: careNumber(r.cooldown, 30 * 86_400), dailyLimit: careNumber(r.dailyLimit, 32), enabled: r.enabled };
    if (typeof rule.enabled !== 'boolean' || rule.dailyLimit < 1 || (index !== 1 && rule.secondaryPoints !== 0)) throw new Error('Unsupported care action policy.');
    return [CARE_ACTIONS[index], rule as ActionRule];
  })) as Record<CareAction, ActionRule>;
  if (actions.pet.cooldown !== 86_400 || actions.pet.dailyLimit !== 1) throw new Error('Pet must stay fixed at once every 24 hours.');
  const rules = { actions, petGrace: careNumber(raw.petGrace, 30 * 86_400), decayInterval: careNumber(raw.decayInterval, 30 * 86_400),
    decayPoints: careNumber(raw.decayPoints, 1_000_000), rarityEvery: careNumber(raw.rarityEvery, 65_535), rarityPoints: careNumber(raw.rarityPoints, 1_000_000),
    playSigner: raw.playSigner };
  if (!rules.decayInterval || !rules.rarityEvery || typeof rules.playSigner !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(rules.playSigner)) throw new Error('Unsupported care policy.');
  return rules as CareRules;
}
