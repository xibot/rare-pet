import { encodeFunctionResult, getAddress, isAddress, zeroAddress } from 'viem';

export const CHAIN_ID = 4663;
export const RULE_DELAY_SECONDS = 86_400;
export const COLLECTIONS = [
  '0x116EaA62241751E0c98dA43d458600c6C17cD361',
  '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D',
];

// Constructor defaults for the reviewed V1 ledger. Updating this declaration
// requires matching constructor tests and a newly compiled deployment review.
export const INITIAL_CARE_RULES = {
  actions: [
    { points: 1, secondaryPoints: 0, cooldown: 86_400, dailyLimit: 1, enabled: true },
    { points: 1, secondaryPoints: 5, cooldown: 14_400, dailyLimit: 6, enabled: true },
    { points: 10, secondaryPoints: 0, cooldown: 0, dailyLimit: 3, enabled: true },
    { points: 1, secondaryPoints: 0, cooldown: 14_400, dailyLimit: 6, enabled: true },
  ],
  petGrace: 86_400,
  decayInterval: 86_400,
  decayPoints: 1,
  rarityEvery: 7,
  rarityPoints: 1,
  playSigner: zeroAddress,
};

/** Compare the contract tuple, independent of JSON key order and number/bigint representation. */
export function careRulesMatch(abi, actual, expected) {
  try {
    const encode = result => encodeFunctionResult({ abi, functionName: 'currentRules', result });
    return encode(actual) === encode(expected);
  } catch {
    return false;
  }
}

export function validateInitialRules(abi, rules) {
  if (!careRulesMatch(abi, rules, INITIAL_CARE_RULES)) {
    throw new Error('The reviewed initial rules differ from the V1 constructor defaults.');
  }
  return rules;
}

export function assertReviewNonce(reviewed, latest, pending) {
  if (!Number.isSafeInteger(reviewed) || reviewed < 0 || reviewed !== latest || reviewed !== pending) {
    throw new Error('The deployer nonce changed or another transaction is pending. Prepare a fresh review.');
  }
}

export function validateDeploymentConfig(input) {
  const keys = ['chainId', 'admin', 'deployer', 'playSigner'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== keys.length || !keys.every(key => Object.hasOwn(input, key))) {
    throw new Error('Care deployment config must contain only chainId, admin, deployer and playSigner.');
  }
  if (input.chainId !== CHAIN_ID) throw new Error('Care is restricted to Robinhood Chain 4663.');
  for (const key of ['admin', 'deployer', 'playSigner']) {
    if (typeof input[key] !== 'string' || !isAddress(input[key])) throw new Error(`Invalid ${key} address.`);
  }
  const result = { chainId: CHAIN_ID, admin: getAddress(input.admin), deployer: getAddress(input.deployer), playSigner: getAddress(input.playSigner) };
  if (result.admin === zeroAddress || result.deployer === zeroAddress) throw new Error('Admin and deployer must be nonzero.');
  // The current application has no authoritative Rare Rush completion service.
  // A future reviewed service can activate its public signer through the onchain rule timelock.
  if (result.playSigner !== zeroAddress) throw new Error('Deploy with Play rewards disabled until the completion service is implemented and reviewed. The signer can be activated later through the rule timelock.');
  return result;
}
