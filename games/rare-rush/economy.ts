/** Session-only playtest accounting. No transactions, minting, or persistence. */
import { difficultySettings, type Difficulty } from './difficulty.ts';

export const TOKEN_UNIT = 1_000_000n;
export const RF_UNIT = 10n ** 18n;
export const HALVING_INTERVAL = 10_000;
export const INITIAL_COIN_REWARD = 10n * TOKEN_UNIT;
export const TOKEN_CAP = 200_000n * TOKEN_UNIT;
export const ENTRY_FEE = RF_UNIT;
export const INITIAL_RF_BALANCE = 100n * RF_UNIT;

export type PlayerCollection = 'generations' | 'genesis';

export function collectionRewardMultiplier(collection: PlayerCollection): bigint {
  if (collection === 'generations') return 1n;
  if (collection === 'genesis') return 100n;
  throw new RangeError('Player collection must be generations or genesis.');
}

export function entryFeeFor(collection: PlayerCollection): bigint {
  // Validate even when no fee or reward would otherwise be due.
  collectionRewardMultiplier(collection);
  return collection === 'genesis' ? 0n : ENTRY_FEE;
}

// The integer reward becomes zero after all 24 significant bits are shifted out.
const REWARDED_EPOCHS = INITIAL_COIN_REWARD.toString(2).length;

export type Economy = {
  /** Historical scenario pickups plus pickups collected in this session. */
  collected: number;
  /** Lifetime simulated issuance, including the selected scenario's history. */
  issued: bigint;
  /** Tokens earned in the current session only. */
  balance: bigint;
  /** Simulated RF credit. These are not the connected wallet's funds. */
  rfBalance: bigint;
  prizePool: bigint;
  runs: number;
};

function assertCoinCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Coin count must be a non-negative safe integer.");
  }
}

/** Floor difficulty rewards to microtokens, then apply coin and collection multipliers. */
export function rewardAt(collected: number, difficulty: Difficulty = 'normal', rewardMultiplier: 1 | 10 = 1, collection: PlayerCollection = 'generations'): bigint {
  assertCoinCount(collected);
  const settings = difficultySettings(difficulty);
  const collectionMultiplier = collectionRewardMultiplier(collection);
  if (rewardMultiplier !== 1 && rewardMultiplier !== 10) {
    throw new RangeError('Coin reward multiplier must be 1 or 10.');
  }
  const epoch = Math.floor(collected / HALVING_INTERVAL);
  const base = epoch >= REWARDED_EPOCHS
    ? 0n
    : INITIAL_COIN_REWARD >> BigInt(epoch);
  const difficultyReward = base * BigInt(settings.rewardNumerator) / BigInt(settings.rewardDenominator);
  return difficultyReward * BigInt(rewardMultiplier) * collectionMultiplier;
}

/**
 * Start a fresh simulation at a chosen historical pickup count.
 * Changing scenarios explicitly resets earnings, RF credit, the pool, and runs.
 * Historical pickups always use normal rewards; difficulty affects future coins.
 */
export function createEconomy(startCoins = 0): Economy {
  assertCoinCount(startCoins);
  let remaining = startCoins;
  let issued = 0n;
  for (let epoch = 0; epoch < REWARDED_EPOCHS && remaining > 0; epoch += 1) {
    const coins = Math.min(remaining, HALVING_INTERVAL);
    issued += BigInt(coins) * (INITIAL_COIN_REWARD >> BigInt(epoch));
    remaining -= coins;
  }
  return {
    collected: startCoins,
    issued,
    balance: 0n,
    rfBalance: INITIAL_RF_BALANCE,
    prizePool: 0n,
    runs: 0,
  };
}

/** Genesis enters free; Generations moves one simulated RF into the simulated pool. */
export function enterRun(economy: Economy, collection: PlayerCollection = 'generations'): boolean {
  const fee = entryFeeFor(collection);
  if (economy.rfBalance < fee) return false;
  economy.rfBalance -= fee;
  economy.prizePool += fee;
  economy.runs += 1;
  return true;
}

/** Next award, including difficulty, coin/collection bonuses and shared supply. No mutation. */
export function nextCoinReward(economy: Economy, difficulty: Difficulty = 'normal', rewardMultiplier: 1 | 10 = 1, collection: PlayerCollection = 'generations'): bigint {
  const rate = rewardAt(economy.collected, difficulty, rewardMultiplier, collection);
  const remaining = TOKEN_CAP > economy.issued ? TOKEN_CAP - economy.issued : 0n;
  return rate < remaining ? rate : remaining;
}

/** Award a pickup once, including bonus pickups; issuance stays separate from holdings. */
export function collectCoin(economy: Economy, difficulty: Difficulty = 'normal', rewardMultiplier: 1 | 10 = 1, collection: PlayerCollection = 'generations'): bigint {
  const awarded = nextCoinReward(economy, difficulty, rewardMultiplier, collection);
  if (economy.collected === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("The simulated pickup counter is exhausted.");
  }
  economy.collected += 1;
  economy.issued += awarded;
  economy.balance += awarded;
  return awarded;
}

/** Floor displayed amounts to two decimals so formatting never overstates credit. */
function formatUnits(amount: bigint, unit: bigint): string {
  if (amount < 0n) throw new RangeError("Displayed balances cannot be negative.");
  if (amount > 0n && amount * 100n < unit) return "<0.01";
  const whole = (amount / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = ((amount % unit) * 100n / unit)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function formatToken(amount: bigint): string {
  return formatUnits(amount, TOKEN_UNIT);
}

export function formatRF(amount: bigint): string {
  return formatUnits(amount, RF_UNIT);
}
