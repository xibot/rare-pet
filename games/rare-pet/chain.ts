import { createWalletClient, custom, parseAbi, parseEventLogs, type Address, type Hex, type PublicClient, type TransactionReceipt } from 'viem';
import type { FriendWalletSession } from '@rarefriends/friendsdk/wallet';
import { createPetPublicClient, RARE_PET_CHAIN, verifyPet, type PetIdentity } from './wallet';
import { careContract } from './config';
import { blankCare, type CareState } from './care';
import { CARE_ACTIONS, careNumber, decodeCareRules } from './care-policy';

export const careAbi = parseAbi([
  'error ActionNotReady(uint256 readyAt)',
  'function CHAIN_ID() view returns (uint256)',
  'function currentRuleVersion() view returns (uint256)',
  'function rules(uint256 version) view returns (((uint32 points,uint32 secondaryPoints,uint32 cooldown,uint8 dailyLimit,bool enabled)[4] actions,uint32 petGrace,uint32 decayInterval,uint32 decayPoints,uint16 rarityEvery,uint32 rarityPoints,address playSigner) policy)',
  'function actionAvailability(address collection,uint256 tokenId,uint8 action) view returns (uint256 remaining,uint256 readyAt,bool enabled)',
  'function getPet(address collection,uint256 tokenId) view returns ((uint256 kinship,uint256 strength,uint256 stamina,uint256 health,uint256 experience,uint256 brain,uint256 streak,uint256 rarity,uint256 lastPetAt,uint256 lastFeedAt,uint256 lastPoopAt,uint256 lastLaunchAt,uint256[] playTimes,uint256 playCount,uint256 decayApplied,bool hasPet,bool hasFed,bool hasPooped,bool hasLaunched) care)',
  'function getPetSchedule(address collection,uint256 tokenId) view returns ((uint256 nextAvailableAt,uint256 graceDeadline,uint256 decayInterval,uint256 decayPoints,uint256 nextRarityAt,uint256 nextRarityPoints) schedule)',
  'function getLifetime(address collection,uint256 tokenId) view returns ((uint256 kinship,uint256 strength,uint256 stamina,uint256 health,uint256 experience,uint256 rarity,uint256 bestStreak,uint256[4] actionCounts) lifetime)',
  'function actionCount(address collection,uint256 tokenId) view returns (uint256)',
  'function actionRecord(address collection,uint256 tokenId,uint256 sequence) view returns ((uint8 action,uint256 timestamp,address owner,uint256 ruleVersion,uint256 points,uint256 secondaryPoints,uint256 rarityPoints) record)',
  'function pet(address collection,uint256 tokenId)',
  'function feed(address collection,uint256 tokenId)',
  'function poop(address collection,uint256 tokenId)',
  'function pet(address collection,uint256 tokenId,uint256 expectedRuleVersion)',
  'function feed(address collection,uint256 tokenId,uint256 expectedRuleVersion)',
  'function poop(address collection,uint256 tokenId,uint256 expectedRuleVersion)',
  'event CaredFor(address indexed collection,uint256 indexed tokenId,address indexed owner,uint8 action,uint256 timestamp)',
]);
const client = createPetPublicClient();
type CareReadClient = Pick<PublicClient, 'getBlock' | 'getCode' | 'readContract'>;
type OnchainCareAction = 'pet' | 'feed' | 'poop';
const actionCode = { pet: 0, feed: 1, poop: 3 } as const;
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export class CareTransactionError extends Error {
  constructor(
    public readonly code: 'unconfirmed' | 'reverted' | 'replaced' | 'unverified' | 'read-failed' | 'reorg',
    public readonly transactionHash: Hex,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CareTransactionError';
  }
}

/** A wallet cancellation or unrelated successful receipt must never award care. */
export function verifyCareReceipt(receipt: TransactionReceipt, hash: Hex, contract: Address, pet: PetIdentity, action: OnchainCareAction): void {
  if (!equal(receipt.transactionHash, hash)) {
    throw new CareTransactionError('replaced', hash, `Your transaction was replaced by ${receipt.transactionHash}. Inspect its status before retrying; RarePet has not verified the replacement.`);
  }
  if (receipt.status !== 'success') throw new CareTransactionError('reverted', hash, 'Your care transaction reverted. No traits were awarded.');
  const events = parseEventLogs({ abi: careAbi, eventName: 'CaredFor', strict: true,
    logs: receipt.logs.filter(log => equal(log.address, contract)) });
  if (!events.some(event => equal(event.args.collection, pet.contract) && event.args.tokenId === BigInt(pet.tokenId)
      && equal(event.args.owner, pet.owner) && event.args.action === actionCode[action])) {
    throw new CareTransactionError('unverified', hash, 'The transaction succeeded, but its care result could not be verified. Inspect the transaction before retrying.');
  }
}

/** Node verification tools inject an explicit read client instead of resolving a browser URL. */
export async function readCare(pet: PetIdentity, blockNumber?: bigint, readClient: CareReadClient = client): Promise<CareState> {
  if (!careContract) throw new Error('Onchain care is not configured in this build. You can explore the preview.');
  const block = await readClient.getBlock(blockNumber === undefined ? { blockTag: 'latest' } : { blockNumber });
  if (!block.hash || block.number === null) throw new Error('The care snapshot block is not confirmed.');
  const fixed = { address: careContract, abi: careAbi, blockNumber: block.number } as const;
  const args = [pet.contract, BigInt(pet.tokenId)] as const;
  const [code, chainId, version, value, lifetime, count, schedule, availability] = await Promise.all([
    readClient.getCode({ address: careContract, blockNumber: block.number }),
    readClient.readContract({ ...fixed, functionName: 'CHAIN_ID' }),
    readClient.readContract({ ...fixed, functionName: 'currentRuleVersion' }),
    readClient.readContract({ ...fixed, functionName: 'getPet', args }),
    readClient.readContract({ ...fixed, functionName: 'getLifetime', args }),
    readClient.readContract({ ...fixed, functionName: 'actionCount', args }),
    readClient.readContract({ ...fixed, functionName: 'getPetSchedule', args }),
    Promise.all(CARE_ACTIONS.map((_, action) => readClient.readContract({ ...fixed, functionName: 'actionAvailability', args: [...args, action] }))),
  ]);
  if (!code || code === '0x' || chainId !== BigInt(RARE_PET_CHAIN.id) || version === 0n) throw new Error('This is not a compatible RarePet care contract.');
  const rules = decodeCareRules(await readClient.readContract({ ...fixed, functionName: 'rules', args: [version] }));
  const { hasPet, hasFed, hasPooped, hasLaunched, playTimes, playCount, ...scalar } = value;
  const number = (value: unknown) => careNumber(value);
  if (playCount > 32n || playTimes.length !== number(playCount)) throw new Error('The care contract returned an invalid play history.');
  const data = Object.fromEntries(Object.entries(scalar).map(([key, n]) => [key, number(n)]));
  const total = number(count);
  const history = await Promise.all(Array.from({ length: Math.min(total, 8) }, async (_, index) => {
    const sequence = total - Math.min(total, 8) + index + 1;
    const record = await readClient.readContract({ ...fixed, functionName: 'actionRecord', args: [...args, BigInt(sequence)] });
    if (record.action > 3 || record.ruleVersion < 1n || record.ruleVersion > version || record.timestamp > block.timestamp) throw new Error('The care contract returned an invalid action record.');
    return { sequence, action: CARE_ACTIONS[record.action], timestamp: number(record.timestamp), owner: record.owner,
      ruleVersion: number(record.ruleVersion), points: number(record.points), secondaryPoints: number(record.secondaryPoints), rarityPoints: number(record.rarityPoints) };
  }));
  const authoritative = Object.fromEntries(CARE_ACTIONS.map((action, index) => {
    const [remaining, readyAt, enabled] = availability[index];
    if (remaining > BigInt(rules.actions[action].dailyLimit) || (!enabled && remaining > 0n) || (!rules.actions[action].enabled && enabled)) throw new Error('The care contract returned incompatible availability.');
    return [action, { remaining: number(remaining), readyAt: number(readyAt), enabled }];
  })) as NonNullable<CareState['policy']>['availability'];
  const check = await readClient.getBlock({ blockNumber: block.number });
  if (!check.hash || !equal(check.hash, block.hash)) throw new Error('The care snapshot changed. Refresh before taking an action.');
  return { ...blankCare(), ...data,
    lastPetAt: hasPet ? number(value.lastPetAt) : -1,
    lastFeedAt: hasFed ? number(value.lastFeedAt) : -1,
    lastPoopAt: hasPooped ? number(value.lastPoopAt) : -1,
    lastLaunchAt: hasLaunched ? number(value.lastLaunchAt) : -1,
    playTimes: playTimes.slice(0, number(playCount)).map(number),
    lifetime: { kinship: number(lifetime.kinship), strength: number(lifetime.strength), stamina: number(lifetime.stamina),
      health: number(lifetime.health), experience: number(lifetime.experience), rarity: number(lifetime.rarity), bestStreak: number(lifetime.bestStreak),
      actionCounts: Object.fromEntries(CARE_ACTIONS.map((action, index) => [action, number(lifetime.actionCounts[index])])) as NonNullable<CareState['lifetime']>['actionCounts'], complete: true },
    actionCount: total, history,
    policy: { version: number(version), rules, blockNumber: block.number.toString(), blockTimestamp: number(block.timestamp), availability: authoritative,
      petSchedule: { nextAvailableAt: number(schedule.nextAvailableAt), graceDeadline: number(schedule.graceDeadline), decayInterval: number(schedule.decayInterval),
        decayPoints: number(schedule.decayPoints), nextRarityAt: number(schedule.nextRarityAt), nextRarityPoints: number(schedule.nextRarityPoints) } },
  };
}
export async function writeCare(session: FriendWalletSession, pet: PetIdentity, action: OnchainCareAction, revision: number, onHash: (hash: string) => void, assertActive: () => void = () => {}, expectedRuleVersion?: number) {
  if (!careContract) throw new Error('Onchain care is not configured in this build.');
  const assertSession = () => {
    assertActive();
    const state = session.getSnapshot();
    if (state.revision !== revision || state.status !== 'connected' || state.account?.toLowerCase() !== pet.owner.toLowerCase()) throw new Error('Your wallet changed. Select your Friend again.');
    return state.account as Address;
  };
  const account = assertSession(), provider = session.getProvider();
  if (!provider) throw new Error('Reconnect your wallet.');
  await verifyPet(pet.collection, pet.tokenId, account);
  assertSession();
  const current = await readCare(pet);
  assertSession();
  if (expectedRuleVersion !== undefined && current.policy?.version !== expectedRuleVersion) throw new Error('The care rules changed. Review the refreshed reward and timer before trying again.');
  if (!current.policy?.availability[action].enabled || !current.policy.availability[action].remaining) throw new Error('This action is not ready under the current care rules. Refresh your Friend’s timers.');
  const { request } = await client.simulateContract({ account, address: careContract, abi: careAbi, functionName: action, args: [pet.contract, BigInt(pet.tokenId), BigInt(current.policy.version)] });
  assertSession();
  const wallet = createWalletClient({ account, chain: RARE_PET_CHAIN, transport: custom(provider) });
  const hash = await wallet.writeContract(request);
  onHash(hash);
  let receipt: TransactionReceipt;
  try { receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 }); }
  catch (cause) {
    throw new CareTransactionError('unconfirmed', hash, 'Your transaction was sent, but confirmation is still unknown. Inspect its status before retrying.', { cause });
  }
  verifyCareReceipt(receipt, hash, careContract, pet, action);
  assertSession();
  let care: CareState;
  try { care = await readCare(pet, receipt.blockNumber); }
  catch (cause) {
    throw new CareTransactionError('read-failed', hash, 'Your care was confirmed onchain, but updated traits could not be loaded. Refresh the dashboard; do not repeat this action to refresh it.', { cause });
  }
  try {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (!block.hash || !equal(block.hash, receipt.blockHash)) throw new Error('Receipt block changed.');
  } catch (cause) {
    throw new CareTransactionError('reorg', hash, 'The receipt block could not be confirmed on the current chain. Inspect your transaction before retrying.', { cause });
  }
  assertSession();
  return { hash, care };
}
