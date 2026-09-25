import { createPublicClient, createWalletClient, custom, http, parseAbi, parseEventLogs, type Address, type Hex, type TransactionReceipt } from 'viem';
import type { FriendWalletSession } from '@rarefriends/friendsdk/wallet';
import { RARE_PET_CHAIN, verifyPet, type PetIdentity } from './wallet';
import { careContract } from './config';
import { blankCare, type CareState } from './care';

export const careAbi = parseAbi([
  'error ActionNotReady(uint256 readyAt)',
  'function getPet(address collection,uint256 tokenId) view returns ((uint256 kinship,uint256 strength,uint256 stamina,uint256 health,uint256 experience,uint256 brain,uint256 streak,uint256 rarity,uint256 lastPetAt,uint256 lastFeedAt,uint256 lastPoopAt,uint256 lastLaunchAt,uint256[3] playTimes,uint256 playCount,uint256 decayApplied,bool hasPet,bool hasFed,bool hasPooped,bool hasLaunched) care)',
  'function pet(address collection,uint256 tokenId)',
  'function feed(address collection,uint256 tokenId)',
  'function poop(address collection,uint256 tokenId)',
  'event CaredFor(address indexed collection,uint256 indexed tokenId,address indexed owner,uint8 action,uint256 timestamp)',
]);
const client = createPublicClient({ chain: RARE_PET_CHAIN, transport: http(undefined, { timeout: 12_000, retryCount: 1 }) });
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

export async function readCare(pet: PetIdentity, blockNumber?: bigint): Promise<CareState> {
  if (!careContract) throw new Error('Onchain care is not deployed yet. You can explore the preview.');
  if (!await client.getCode({ address: careContract, blockNumber })) throw new Error('The RarePet care contract is unavailable on Robinhood.');
  const value = await client.readContract({ address: careContract, abi: careAbi, functionName: 'getPet', args: [pet.contract, BigInt(pet.tokenId)], blockNumber });
  const { hasPet, hasFed, hasPooped, hasLaunched, playTimes, playCount, ...scalar } = value;
  const number = (n: bigint): number => {
    if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Care data exceeds the supported display range.');
    return Number(n);
  };
  if (playCount > 3n) throw new Error('The care contract returned an invalid play history.');
  const data = Object.fromEntries(Object.entries(scalar).map(([key, n]) => [key, number(n)]));
  return { ...blankCare(), ...data,
    lastPetAt: hasPet ? number(value.lastPetAt) : -1,
    lastFeedAt: hasFed ? number(value.lastFeedAt) : -1,
    lastPoopAt: hasPooped ? number(value.lastPoopAt) : -1,
    lastLaunchAt: hasLaunched ? number(value.lastLaunchAt) : -1,
    playTimes: playTimes.slice(0, number(playCount)).map(number),
  };
}
export async function writeCare(session: FriendWalletSession, pet: PetIdentity, action: OnchainCareAction, revision: number, onHash: (hash: string) => void, assertActive: () => void = () => {}) {
  if (!careContract) throw new Error('Onchain care is not deployed yet.');
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
  if (!await client.getCode({ address: careContract })) throw new Error('RarePet care is unavailable on this network.');
  const { request } = await client.simulateContract({ account, address: careContract, abi: careAbi, functionName: action, args: [pet.contract, BigInt(pet.tokenId)] });
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
