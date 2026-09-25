import assert from "node:assert/strict";
import test from "node:test";
import {
  collectCoin,
  collectionRewardMultiplier,
  createEconomy,
  enterRun,
  entryFeeFor,
  ENTRY_FEE,
  formatRF,
  formatToken,
  HALVING_INTERVAL,
  INITIAL_COIN_REWARD,
  INITIAL_RF_BALANCE,
  nextCoinReward,
  rewardAt,
  RF_UNIT,
  TOKEN_CAP,
  TOKEN_UNIT,
} from "../games/rare-rush/economy.ts";

test("reward halves at the exact next-pickup boundary", () => {
  assert.equal(rewardAt(0), 10n * TOKEN_UNIT);
  assert.equal(rewardAt(9_999), 10n * TOKEN_UNIT);
  assert.equal(rewardAt(10_000), 5n * TOKEN_UNIT);
  assert.equal(rewardAt(20_000), 2_500_000n);
  assert.equal(rewardAt(30_000), 1_250_000n);
  const economy = createEconomy(9_999);
  assert.equal(collectCoin(economy), 10n * TOKEN_UNIT);
  assert.equal(collectCoin(economy), 5n * TOKEN_UNIT);
  assert.equal(economy.balance, 15n * TOKEN_UNIT);
});

test("historical scenarios reproduce normal-rate issuance without crediting historical earnings", () => {
  for (const count of [0, 10_000, 30_000, 100_000]) {
    const replay = createEconomy();
    for (let i = 0; i < count; i += 1) collectCoin(replay);
    const scenario = createEconomy(count);
    assert.equal(scenario.issued, replay.issued);
    assert.equal(scenario.collected, count);
    assert.equal(scenario.balance, 0n);
    assert.equal(scenario.rfBalance, INITIAL_RF_BALANCE);
    assert.equal(scenario.prizePool, 0n);
    assert.equal(scenario.runs, 0);
  }
});

test("difficulty multipliers use exact integer fractions and floor microtoken remainders", () => {
  assert.equal(rewardAt(0, 'easy'), 7_500_000n);
  assert.equal(rewardAt(0, 'normal'), 10_000_000n);
  assert.equal(rewardAt(0, 'degen'), 20_000_000n);
  assert.equal(rewardAt(200_000, 'normal'), 9n);
  assert.equal(rewardAt(200_000, 'easy'), 6n);
  assert.equal(rewardAt(200_000, 'degen'), 18n);
  assert.equal(rewardAt(220_000, 'easy'), 1n);
  assert.equal(rewardAt(230_000, 'easy'), 0n);
  assert.equal(rewardAt(230_000, 'degen'), 2n);
});

test("every difficulty halves at the same actual pickup boundaries", () => {
  const rates = { easy: 7_500_000n, normal: 10_000_000n, degen: 20_000_000n };
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    assert.equal(rewardAt(9_999, mode), rates[mode]);
    assert.equal(rewardAt(10_000, mode), rates[mode] / 2n);
    assert.equal(rewardAt(19_999, mode), rates[mode] / 2n);
    assert.equal(rewardAt(20_000, mode), rates[mode] / 4n);
    const economy = createEconomy(9_999);
    assert.equal(collectCoin(economy, mode), rates[mode]);
    assert.equal(collectCoin(economy, mode), rates[mode] / 2n);
    assert.equal(economy.collected, 10_001);
  }
});

test("mixed difficulties across runs share one cap and clip the final displayed award", () => {
  const economy = createEconomy();
  economy.issued = TOKEN_CAP - 26_000_001n;
  assert.equal(enterRun(economy), true);
  assert.equal(collectCoin(economy, 'easy'), 7_500_000n);
  assert.equal(collectCoin(economy, 'normal'), 10_000_000n);
  assert.equal(enterRun(economy), true);
  assert.equal(rewardAt(economy.collected, 'degen'), 20_000_000n);
  assert.equal(nextCoinReward(economy, 'degen'), 8_500_001n);
  assert.equal(collectCoin(economy, 'degen'), 8_500_001n);
  assert.equal(economy.issued, TOKEN_CAP);
  assert.equal(economy.balance, 26_000_001n);
  assert.equal(economy.collected, 3);
  assert.equal(economy.prizePool, 2n * ENTRY_FEE);
  assert.equal(economy.rfBalance, INITIAL_RF_BALANCE - 2n * ENTRY_FEE);

  economy.balance = 0n;
  assert.equal(enterRun(economy), true);
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    assert.equal(nextCoinReward(economy, mode), 0n);
    assert.equal(collectCoin(economy, mode), 0n);
  }
  assert.equal(economy.issued, TOKEN_CAP);
  assert.equal(economy.balance, 0n);
  assert.equal(economy.collected, 6);
});

test("base-reward exhaustion remains exhausted in every mode", () => {
  const economy = createEconomy(240_000);
  const issued = economy.issued;
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    assert.equal(rewardAt(240_000, mode), 0n);
    assert.equal(rewardAt(Number.MAX_SAFE_INTEGER, mode), 0n);
    assert.equal(nextCoinReward(economy, mode), 0n);
    assert.equal(collectCoin(economy, mode), 0n);
  }
  assert.equal(economy.collected, 240_003);
  assert.equal(economy.issued, issued);
  assert.equal(economy.balance, 0n);
});

test("invalid difficulty fails before changing accounting, even after exhaustion", () => {
  for (const count of [0, 240_000]) {
    const economy = createEconomy(count);
    const before = { ...economy };
    for (const invalid of ['hard', '', 'toString', '__proto__', null, 1]) {
      assert.throws(() => rewardAt(count, invalid as never), RangeError);
      assert.throws(() => nextCoinReward(economy, invalid as never), RangeError);
      assert.throws(() => collectCoin(economy, invalid as never), RangeError);
      assert.deepEqual(economy, before);
    }
  }
});

test("previewing rewards is read-only and each collected coin advances the counter once", () => {
  const economy = createEconomy(9_998);
  const initialIssued = economy.issued;
  const modes = ['easy', 'degen', 'normal', 'easy'] as const;
  const expected = [7_500_000n, 20_000_000n, 5_000_000n, 3_750_000n];
  for (let i = 0; i < modes.length; i += 1) {
    const before = { ...economy };
    assert.equal(nextCoinReward(economy, modes[i]), expected[i]);
    assert.equal(nextCoinReward(economy, modes[i]), expected[i]);
    assert.deepEqual(economy, before);
    assert.equal(collectCoin(economy, modes[i]), expected[i]);
    assert.equal(economy.collected, 9_999 + i);
  }
  assert.equal(economy.balance, 36_250_000n);
  assert.equal(economy.issued - initialIssued, economy.balance);
});

test("omitting difficulty preserves normal-mode API behavior", () => {
  for (const count of [0, 9_999, 10_000, 230_000, 240_000]) {
    assert.equal(rewardAt(count), rewardAt(count, 'normal'));
    const implicit = createEconomy(count);
    const explicit = createEconomy(count);
    assert.equal(nextCoinReward(implicit), nextCoinReward(explicit, 'normal'));
    assert.equal(collectCoin(implicit), collectCoin(explicit, 'normal'));
    assert.deepEqual(implicit, explicit);
  }
});

test("bonus coins award ten times the token rate in each difficulty", () => {
  const expected = { easy: 75_000_000n, normal: 100_000_000n, degen: 200_000_000n };
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    const economy = createEconomy();
    const before = { ...economy };
    assert.equal(rewardAt(0, mode, 10), expected[mode]);
    assert.equal(nextCoinReward(economy, mode, 10), expected[mode]);
    assert.deepEqual(economy, before);
    assert.equal(collectCoin(economy, mode, 10), expected[mode]);
    assert.equal(economy.balance, expected[mode]);
    assert.equal(economy.issued, expected[mode]);
    assert.equal(economy.collected, 1);
  }
});

test("a bonus coin advances the halving boundary by one pickup", () => {
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    const economy = createEconomy(9_999);
    const initialRate = rewardAt(9_999, mode);
    assert.equal(collectCoin(economy, mode, 10), initialRate * 10n);
    assert.equal(economy.collected, 10_000);
    assert.equal(nextCoinReward(economy, mode, 10), initialRate * 5n);
    assert.equal(collectCoin(economy, mode, 10), initialRate * 5n);
    assert.equal(economy.collected, 10_001);
    assert.equal(economy.balance, initialRate * 15n);
  }
});

test("bonus multiplication follows difficulty rounding without reviving exhausted rewards", () => {
  // The normal rate is 9 microtokens. Easy rounds 9 × 3 / 4 down to 6,
  // then the surprise coin awards 60, not floor(9 × 3 × 10 / 4) = 67.
  assert.equal(rewardAt(200_000, 'easy', 10), 60n);
  assert.equal(rewardAt(200_000, 'normal', 10), 90n);
  assert.equal(rewardAt(200_000, 'degen', 10), 180n);
  assert.equal(rewardAt(230_000, 'easy', 10), 0n);
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    const exhausted = createEconomy(240_000);
    const issued = exhausted.issued;
    assert.equal(nextCoinReward(exhausted, mode, 10), 0n);
    assert.equal(collectCoin(exhausted, mode, 10), 0n);
    assert.equal(exhausted.issued, issued);
    assert.equal(exhausted.balance, 0n);
    assert.equal(exhausted.collected, 240_001);
  }
});

test("the cap clips the multiplied bonus reward before issuing any tokens", () => {
  const economy = createEconomy();
  economy.issued = TOKEN_CAP - 35_000_007n;
  assert.equal(rewardAt(0, 'normal', 10), 100_000_000n);
  assert.equal(nextCoinReward(economy, 'normal', 10), 35_000_007n);
  assert.equal(collectCoin(economy, 'normal', 10), 35_000_007n);
  assert.equal(economy.issued, TOKEN_CAP);
  assert.equal(economy.balance, 35_000_007n);
  economy.balance = 0n;
  assert.equal(nextCoinReward(economy, 'degen', 10), 0n);
  assert.equal(collectCoin(economy, 'degen', 10), 0n);
  assert.equal(economy.issued, TOKEN_CAP);
  assert.equal(economy.balance, 0n);
  assert.equal(economy.collected, 2);
});

test("mixed ordinary and bonus coins conserve new issuance across runs", () => {
  const economy = createEconomy(9_998);
  const initialIssued = economy.issued;
  assert.equal(enterRun(economy), true);
  assert.equal(collectCoin(economy, 'easy', 1), 7_500_000n);
  assert.equal(collectCoin(economy, 'normal', 10), 100_000_000n);
  assert.equal(economy.collected, 10_000);
  assert.equal(enterRun(economy), true);
  assert.equal(collectCoin(economy, 'degen', 1), 10_000_000n);
  assert.equal(collectCoin(economy, 'easy', 10), 37_500_000n);
  assert.equal(economy.collected, 10_002);
  assert.equal(economy.balance, 155_000_000n);
  assert.equal(economy.issued - initialIssued, economy.balance);
  assert.equal(economy.prizePool, 2n * ENTRY_FEE);
});

test("invalid bonus multipliers fail without changing any accounting", () => {
  for (const count of [0, 240_000]) {
    const economy = createEconomy(count);
    const before = { ...economy };
    for (const invalid of [0, -1, 2, 9, 11, 1.5, Infinity, NaN, '10', null, 10n]) {
      assert.throws(() => rewardAt(count, 'normal', invalid as never), RangeError);
      assert.throws(() => nextCoinReward(economy, 'normal', invalid as never), RangeError);
      assert.throws(() => collectCoin(economy, 'normal', invalid as never), RangeError);
      assert.deepEqual(economy, before);
    }
  }
});

test("an omitted bonus multiplier preserves existing difficulty API behavior", () => {
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    for (const count of [0, 9_999, 10_000, 230_000, 240_000]) {
      assert.equal(rewardAt(count, mode), rewardAt(count, mode, 1));
      const implicit = createEconomy(count), explicit = createEconomy(count);
      assert.equal(nextCoinReward(implicit, mode), nextCoinReward(explicit, mode, 1));
      assert.equal(collectCoin(implicit, mode), collectCoin(explicit, mode, 1));
      assert.deepEqual(implicit, explicit);
    }
  }
});

test("entry fees conserve simulated RF and cannot overspend", () => {
  const economy = createEconomy();
  for (let i = 1; i <= 100; i += 1) {
    assert.equal(enterRun(economy), true);
    assert.equal(economy.rfBalance + economy.prizePool, INITIAL_RF_BALANCE);
    assert.equal(economy.prizePool, BigInt(i) * ENTRY_FEE);
    assert.equal(economy.runs, i);
  }
  const before = { ...economy };
  assert.equal(enterRun(economy), false);
  assert.deepEqual(economy, before);
  assert.equal(economy.rfBalance, 0n);
});

test("fractional insufficient RF credit is unchanged on rejection", () => {
  const economy = createEconomy();
  economy.rfBalance = ENTRY_FEE - 1n;
  const before = { ...economy };
  assert.equal(enterRun(economy), false);
  assert.deepEqual(economy, before);
});

test("Genesis entry is free even at zero RF and preserves the shared prize pool", () => {
  const economy = createEconomy();
  assert.equal(collectionRewardMultiplier('genesis'), 100n);
  assert.equal(collectionRewardMultiplier('generations'), 1n);
  assert.equal(entryFeeFor('genesis'), 0n);
  assert.equal(entryFeeFor('generations'), ENTRY_FEE);
  assert.equal(enterRun(economy, 'generations'), true);
  const paid = { ...economy };
  assert.equal(enterRun(economy, 'genesis'), true);
  assert.deepEqual(economy, { ...paid, runs: paid.runs + 1 });
  economy.rfBalance = 0n;
  const empty = { ...economy };
  assert.equal(enterRun(economy, 'genesis'), true);
  assert.deepEqual(economy, { ...empty, runs: empty.runs + 1 });
  const beforeRejection = { ...economy };
  assert.equal(enterRun(economy, 'generations'), false);
  assert.deepEqual(economy, beforeRejection);
});

test("Genesis stacks a hundredfold with every difficulty and surprise coin", () => {
  const rates = { easy: 750n * TOKEN_UNIT, normal: 1_000n * TOKEN_UNIT, degen: 2_000n * TOKEN_UNIT };
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    for (const bonus of [1, 10] as const) {
      const economy = createEconomy();
      const before = { ...economy };
      const expected = rates[mode] * BigInt(bonus);
      assert.equal(rewardAt(0, mode, bonus, 'genesis'), expected);
      assert.equal(nextCoinReward(economy, mode, bonus, 'genesis'), expected);
      assert.deepEqual(economy, before);
      assert.equal(collectCoin(economy, mode, bonus, 'genesis'), expected);
      assert.equal(economy.collected, 1);
      assert.equal(economy.balance, expected);
      assert.equal(economy.issued, expected);
    }
  }
});

test("Genesis bonuses cross halving boundaries by one actual pickup", () => {
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    const economy = createEconomy(9_999);
    const issued = economy.issued;
    const rate = rewardAt(9_999, mode, 10, 'genesis');
    assert.equal(collectCoin(economy, mode, 10, 'genesis'), rate);
    assert.equal(economy.collected, 10_000);
    assert.equal(nextCoinReward(economy, mode, 10, 'genesis'), rate / 2n);
    assert.equal(collectCoin(economy, mode, 10, 'genesis'), rate / 2n);
    assert.equal(economy.collected, 10_001);
    assert.equal(economy.balance, rate + rate / 2n);
    assert.equal(economy.issued - issued, economy.balance);
  }
});

test("Genesis multiplication follows difficulty flooring and cannot revive zero rewards", () => {
  assert.equal(rewardAt(200_000, 'easy', 1, 'genesis'), 600n);
  assert.equal(rewardAt(200_000, 'easy', 10, 'genesis'), 6_000n);
  assert.equal(rewardAt(230_000, 'easy', 10, 'genesis'), 0n);
  assert.equal(rewardAt(230_000, 'degen', 10, 'genesis'), 2_000n);
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    const economy = createEconomy(240_000);
    const issued = economy.issued;
    assert.equal(rewardAt(Number.MAX_SAFE_INTEGER, mode, 10, 'genesis'), 0n);
    assert.equal(nextCoinReward(economy, mode, 10, 'genesis'), 0n);
    assert.equal(collectCoin(economy, mode, 10, 'genesis'), 0n);
    assert.equal(economy.collected, 240_001);
    assert.equal(economy.issued, issued);
    assert.equal(economy.balance, 0n);
  }
});

test("both collections share the hard cap after all Genesis and coin multipliers", () => {
  const economy = createEconomy();
  economy.issued = TOKEN_CAP - 1_500n * TOKEN_UNIT - 7n;
  assert.equal(collectCoin(economy, 'normal', 1, 'generations'), 10n * TOKEN_UNIT);
  assert.equal(collectCoin(economy, 'easy', 1, 'genesis'), 750n * TOKEN_UNIT);
  assert.equal(nextCoinReward(economy, 'degen', 10, 'genesis'), 740n * TOKEN_UNIT + 7n);
  assert.equal(collectCoin(economy, 'degen', 10, 'genesis'), 740n * TOKEN_UNIT + 7n);
  assert.equal(economy.issued, TOKEN_CAP);
  assert.equal(economy.balance, 1_500n * TOKEN_UNIT + 7n);
  economy.balance = 0n;
  for (const collection of ['genesis', 'generations'] as const) {
    assert.equal(nextCoinReward(economy, 'degen', 10, collection), 0n);
    assert.equal(collectCoin(economy, 'degen', 10, collection), 0n);
  }
  assert.equal(economy.collected, 5);
  assert.equal(economy.issued, TOKEN_CAP);
  assert.equal(economy.balance, 0n);
});

test("unknown collections fail before accounting changes, even when credit or rewards are zero", () => {
  for (const count of [0, 240_000]) {
    const economy = createEconomy(count);
    economy.rfBalance = 0n;
    const before = { ...economy };
    for (const invalid of ['', 'Genesis', 'toString', '__proto__', null, 0, {}, []]) {
      assert.throws(() => collectionRewardMultiplier(invalid as never), RangeError);
      assert.throws(() => entryFeeFor(invalid as never), RangeError);
      assert.throws(() => enterRun(economy, invalid as never), RangeError);
      assert.throws(() => rewardAt(count, 'normal', 10, invalid as never), RangeError);
      assert.throws(() => nextCoinReward(economy, 'normal', 10, invalid as never), RangeError);
      assert.throws(() => collectCoin(economy, 'normal', 10, invalid as never), RangeError);
      assert.deepEqual(economy, before);
    }
  }
});

test("omitting collection preserves all Generations fees and rewards", () => {
  for (const mode of ['easy', 'normal', 'degen'] as const) {
    for (const bonus of [1, 10] as const) {
      for (const count of [0, 9_999, 10_000, 230_000, 240_000]) {
        const implicit = createEconomy(count), explicit = createEconomy(count);
        assert.equal(enterRun(implicit), enterRun(explicit, 'generations'));
        assert.equal(rewardAt(count, mode, bonus), rewardAt(count, mode, bonus, 'generations'));
        assert.equal(nextCoinReward(implicit, mode, bonus), nextCoinReward(explicit, mode, bonus, 'generations'));
        assert.equal(collectCoin(implicit, mode, bonus), collectCoin(explicit, mode, bonus, 'generations'));
        assert.deepEqual(implicit, explicit);
      }
    }
  }
});

test("finite integer halvings bound total issuance and eventually award zero", () => {
  assert.equal(TOKEN_CAP, 2n * BigInt(HALVING_INTERVAL) * INITIAL_COIN_REWARD);
  assert.equal(rewardAt(230_000), 1n);
  assert.equal(rewardAt(239_999), 1n);
  assert.equal(rewardAt(240_000), 0n);
  assert.equal(rewardAt(Number.MAX_SAFE_INTEGER), 0n);
  const exhausted = createEconomy(240_000);
  assert.equal(exhausted.issued, 199_999_920_000n);
  assert.ok(exhausted.issued < TOKEN_CAP);
  const issued = exhausted.issued;
  for (let i = 0; i < 100; i += 1) assert.equal(collectCoin(exhausted), 0n);
  assert.equal(exhausted.issued, issued);
  assert.equal(exhausted.balance, 0n);
  assert.equal(exhausted.collected, 240_100);
  assert.equal(createEconomy(Number.MAX_SAFE_INTEGER).issued, issued);
});

test("the independent lifetime cap clips a final award and never reopens on spending", () => {
  const economy = createEconomy();
  economy.issued = TOKEN_CAP - 7n;
  assert.equal(collectCoin(economy), 7n);
  assert.equal(economy.issued, TOKEN_CAP);
  assert.equal(economy.balance, 7n);
  economy.balance = 0n;
  assert.equal(collectCoin(economy), 0n);
  assert.equal(economy.issued, TOKEN_CAP);
});

test("earned balances equal new issuance across an epoch boundary", () => {
  const economy = createEconomy(19_990);
  const initialIssued = economy.issued;
  let rewards = 0n;
  for (let i = 0; i < 25; i += 1) rewards += collectCoin(economy);
  assert.equal(economy.balance, rewards);
  assert.equal(economy.issued - initialIssued, rewards);
  assert.equal(economy.balance, 87_500_000n);
});

test("invalid pickup counters fail explicitly", () => {
  for (const invalid of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createEconomy(invalid), RangeError);
    assert.throws(() => rewardAt(invalid), RangeError);
  }
  const economy = createEconomy(Number.MAX_SAFE_INTEGER);
  const before = { ...economy };
  assert.throws(() => collectCoin(economy), RangeError);
  assert.deepEqual(economy, before);
});

test("formatting uses bigint precision and does not overstate spendable amounts", () => {
  assert.equal(formatToken(0n), "0");
  assert.equal(formatToken(1n), "<0.01");
  assert.equal(formatToken(10_000n), "0.01");
  assert.equal(formatToken(2_500_000n), "2.5");
  assert.equal(formatToken(9_999_999n), "9.99");
  assert.equal(formatToken(TOKEN_CAP), "200,000");
  assert.equal(formatRF(100n * RF_UNIT), "100");
  assert.equal(formatRF(RF_UNIT / 4n), "0.25");
  assert.throws(() => formatToken(-1n), RangeError);
});
