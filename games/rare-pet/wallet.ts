import { createFriendWalletSession } from '@rarefriends/friendsdk/wallet';
import {
  decodeGenerationSprites, FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST, spriteFrame,
} from '@rarefriends/friendsdk/sprites';
import { createPublicClient, defineChain, http, isAddress, parseAbi, parseAbiItem, zeroAddress, type Address } from 'viem';
import { GENESIS_DEPLOYMENT, readGenesisIdentity, readOwnedGenesis, type GenesisClient } from '../rare-rush/genesis/identity';

export type PetCollection = 'genesis' | 'generations';
/** A read-only snapshot. Reverify before entering the dashboard; the care contract enforces ownership. */
export type PetIdentity = Readonly<{
  collection: PetCollection;
  chainId: 4663;
  contract: Address;
  tokenId: string;
  label: string;
  image: string;
  owner: Address;
  /** A generation-0 Friend has no verified hardwired wallet yet. */
  walletAddress: Address | null;
  blockNumber: string;
  generation: number | null;
  rushEligible: boolean;
}>;

export const PET_DEPLOYMENT = Object.freeze({
  chainId: 4663 as const,
  rpcUrl: GENESIS_DEPLOYMENT.rpcUrl,
  genesis: GENESIS_DEPLOYMENT.contract,
  generations: GENERATION_SPRITE_MANIFEST.generations,
  explorer: 'https://robinhoodchain.blockscout.com',
});
export const RARE_PET_CHAIN = defineChain({
  id: PET_DEPLOYMENT.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [PET_DEPLOYMENT.rpcUrl] } },
  blockExplorers: { default: { name: 'Blockscout', url: PET_DEPLOYMENT.explorer } },
});

/** FriendSDK owns provider discovery, connection, network changes and invalidation. */
export const createPetWalletSession = createFriendWalletSession;
export type PetWalletSession = ReturnType<typeof createPetWalletSession>;
export type PetReadClient = GenesisClient;

/** Public reads only. This client never receives a wallet provider or signer. */
export function createPetPublicClient(signal?: AbortSignal) {
  return createPublicClient({
    chain: RARE_PET_CHAIN, cacheTime: 0,
    transport: http(PET_DEPLOYMENT.rpcUrl, { retryCount: 0, timeout: 12_000, fetchOptions: { signal } }),
  });
}

export class PetDiscoveryError extends Error {
  readonly partialPets: readonly PetIdentity[];
  readonly failedCollections: readonly PetCollection[];
  constructor(partialPets: readonly PetIdentity[], failedCollections: readonly PetCollection[]) {
    const names = failedCollections.map(collection => collection === 'genesis' ? 'Genesis' : 'Generations').join(' and ');
    super(`Could not fully load your ${names}. Retry, or enter a token number to verify ownership directly.`);
    this.name = 'PetDiscoveryError';
    this.partialPets = Object.freeze([...partialPets]);
    this.failedCollections = Object.freeze([...failedCollections]);
  }
}

const GENERATIONS_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function generation(uint256 tokenId) view returns (uint8)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
]);
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const MAX_OWNED_FRIENDS = 10_000;
const MAX_TRANSFER_LOGS = 100_000;
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nonzeroAddress = (value: unknown): value is Address =>
  typeof value === 'string' && isAddress(value) && !equal(value, zeroAddress);
const validId = (value: unknown): value is bigint => typeof value === 'bigint' && value > 0n && value < 1n << 256n;

function accountAddress(account: Address) {
  if (!nonzeroAddress(account)) throw new Error('Connect a valid wallet before choosing a Rare Friend.');
  return account;
}

function tokenNumber(value: string | bigint) {
  if (typeof value === 'string' && !/^[1-9][0-9]{0,77}$/.test(value)) throw new Error('Enter a valid Rare Friend token number.');
  const id = typeof value === 'bigint' ? value : BigInt(value);
  if (!validId(id)) throw new Error('Enter a positive Rare Friend token number that fits uint256.');
  return id;
}

async function checkChain(client: PetReadClient, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (await client.getChainId() !== PET_DEPLOYMENT.chainId) throw new Error('Use Robinhood mainnet (4663) to verify your Rare Friend.');
  signal?.throwIfAborted();
}

async function freshBlock(client: PetReadClient, signal?: AbortSignal) {
  await checkChain(client, signal);
  const block = await client.getBlockNumber({ cacheTime: 0 });
  signal?.throwIfAborted();
  if (typeof block !== 'bigint' || block < 0n) throw new Error('Could not read the latest Robinhood block. Please retry.');
  return block;
}

async function generationAt(client: PetReadClient, id: bigint, account: Address, blockNumber: bigint, signal?: AbortSignal): Promise<PetIdentity> {
  const contract = PET_DEPLOYMENT.generations;
  const [owner, generation] = await Promise.all([
    client.readContract({ address: contract, abi: GENERATIONS_ABI, functionName: 'ownerOf', args: [id], blockNumber }),
    client.readContract({ address: contract, abi: GENERATIONS_ABI, functionName: 'generation', args: [id], blockNumber }),
  ]);
  signal?.throwIfAborted();
  if (!nonzeroAddress(owner) || !equal(owner, account)) throw new Error('This Generations Friend is not owned by your connected wallet.');
  if (!Number.isInteger(generation) || generation < 0 || generation > 255) throw new Error('Could not verify this Friend’s generation.');
  // RarePet accepts all owned Generations. The separate Rare Rush host requires generation 1+.
  let walletAddress: Address | null = null;
  if (generation >= 1) {
    const canonicalWallet = await client.readContract({ address: contract, abi: GENERATIONS_ABI,
      functionName: 'tokenBoundAccount', args: [id], blockNumber });
    signal?.throwIfAborted();
    if (!nonzeroAddress(canonicalWallet)) throw new Error('Could not verify this Friend’s canonical wallet.');
    walletAddress = canonicalWallet;
  }

  const registry = GENERATION_SPRITE_MANIFEST.registry;
  const [familyId, seed] = await Promise.all([
    client.readContract({ address: registry, abi: FAMILIES_REGISTRY_ABI, functionName: 'familyOf', args: [id], blockNumber }),
    client.readContract({ address: registry, abi: FAMILIES_REGISTRY_ABI, functionName: 'seedOf', args: [id], blockNumber }),
  ]);
  signal?.throwIfAborted();
  const frames = await client.readContract({ address: registry, abi: FAMILIES_REGISTRY_ABI,
    functionName: 'frames', args: [familyId, seed], blockNumber });
  signal?.throwIfAborted();
  const sprites = decodeGenerationSprites(id, familyId, seed, frames);
  // Preserve the canonical SDK front frame, including Colossus's horizontal fallback.
  // Coordinates come only from validated bitmaps; no RPC strings enter SVG markup.
  const rows = spriteFrame(sprites, 'down', false, 0).frame.rows;
  const path: string[] = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (rows[y][x] === '#') path.push(`M${x} ${y}h1v1h-1z`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><path fill="#000" d="${path.join('')}"/></svg>`;
  return Object.freeze({ collection: 'generations', chainId: 4663, contract, tokenId: String(id),
    label: `Generations #${id}`, image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    owner, walletAddress, blockNumber: String(blockNumber), generation, rushEligible: generation >= 1 });
}

/** Account-filtered transfer history only. Incomplete discovery is an error, never an empty balance. */
async function ownedGenerations(client: PetReadClient, account: Address, signal?: AbortSignal): Promise<PetIdentity[]> {
  const blockNumber = await freshBlock(client, signal);
  const balance = await client.readContract({ address: PET_DEPLOYMENT.generations, abi: GENERATIONS_ABI,
    functionName: 'balanceOf', args: [account], blockNumber });
  signal?.throwIfAborted();
  if (typeof balance !== 'bigint' || balance < 0n || balance > BigInt(MAX_OWNED_FRIENDS)) throw new Error('Could not verify your Generations balance.');
  if (balance === 0n) { await checkChain(client, signal); return []; }
  const query = { address: PET_DEPLOYMENT.generations, event: TRANSFER, fromBlock: 0n, toBlock: blockNumber, strict: true } as const;
  const [received, sent] = await Promise.all([
    client.getLogs({ ...query, args: { to: account } }),
    client.getLogs({ ...query, args: { from: account } }),
  ]);
  signal?.throwIfAborted();
  if (received.length + sent.length > MAX_TRANSFER_LOGS) throw new Error('Your Friend transfer history exceeds the discovery limit. Verify a token number directly.');
  const events = new Map<string, typeof received[number]>();
  for (const log of [...received, ...sent]) {
    const { from, to, tokenId } = log.args;
    if (!isAddress(log.address) || !equal(log.address, PET_DEPLOYMENT.generations) || log.removed ||
        typeof log.blockNumber !== 'bigint' || log.blockNumber < 0n || log.blockNumber > blockNumber ||
        log.logIndex === null || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 ||
        !isAddress(from) || !isAddress(to) || !validId(tokenId) || (!equal(from, account) && !equal(to, account))) {
      throw new Error('Could not verify the owner-filtered Friend transfer history.');
    }
    const key = `${log.blockNumber}:${log.logIndex}`;
    const previous = events.get(key);
    if (previous && (previous.args.tokenId !== tokenId || !equal(previous.args.from, from) || !equal(previous.args.to, to))) {
      throw new Error('Friend transfer history is inconsistent. Please retry.');
    }
    events.set(key, log);
  }
  const ordered = [...events.values()].sort((a, b) =>
    a.blockNumber! === b.blockNumber! ? a.logIndex! - b.logIndex! : a.blockNumber! < b.blockNumber! ? -1 : 1);
  const held = new Set<bigint>();
  for (const log of ordered) {
    if (equal(log.args.to, account)) held.add(log.args.tokenId);
    else held.delete(log.args.tokenId);
  }
  if (BigInt(held.size) !== balance) throw new Error('Friend transfer history is incomplete. Verify a token number directly.');
  const pets: PetIdentity[] = [];
  const ids = [...held].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  for (let offset = 0; offset < ids.length; offset += 4) {
    signal?.throwIfAborted();
    pets.push(...await Promise.all(ids.slice(offset, offset + 4).map(id => generationAt(client, id, account, blockNumber, signal))));
  }
  await checkChain(client, signal);
  return pets;
}

/** Injectable public-read boundary for verification tests and alternate complete-history RPCs. */
export function createPetIdentityReader(client: PetReadClient) {
  async function verifyPet(collection: PetCollection, tokenId: string | bigint, account: Address, signal?: AbortSignal): Promise<PetIdentity> {
    accountAddress(account);
    const id = tokenNumber(tokenId);
    signal?.throwIfAborted();
    if (collection === 'genesis') {
      const identity = await readGenesisIdentity(client, id, account, { signal });
      signal?.throwIfAborted();
      return Object.freeze({ ...identity, generation: null, rushEligible: true });
    }
    if (collection !== 'generations') throw new Error('Choose Genesis or Generations.');
    const identity = await generationAt(client, id, account, await freshBlock(client, signal), signal);
    await checkChain(client, signal);
    return identity;
  }

  async function listOwnedPets(account: Address, signal?: AbortSignal): Promise<PetIdentity[]> {
    accountAddress(account);
    signal?.throwIfAborted();
    const collections: readonly PetCollection[] = ['genesis', 'generations'];
    const results = await Promise.allSettled([
      (async () => {
        const owned = await readOwnedGenesis(client, account, { signal });
        const pets: PetIdentity[] = [];
        for (let offset = 0; offset < owned.friends.length; offset += 4) {
          signal?.throwIfAborted();
          pets.push(...await Promise.all(owned.friends.slice(offset, offset + 4).map(friend => verifyPet('genesis', friend.id, account, signal))));
        }
        return pets;
      })(),
      ownedGenerations(client, account, signal),
    ]);
    signal?.throwIfAborted();
    const pets: PetIdentity[] = [];
    const failed: PetCollection[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') pets.push(...result.value);
      else failed.push(collections[index]);
    });
    if (failed.length) throw new PetDiscoveryError(pets, failed);
    return pets;
  }
  return Object.freeze({ listOwnedPets, verifyPet });
}

/** Abort both transport work and the logical operation when the picker is replaced. */
async function readWithDeadline<T>(read: (client: PetReadClient, signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(outer?.reason);
  outer?.addEventListener('abort', cancel, { once: true });
  if (outer?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new Error('Ownership verification timed out. Retry, or verify a token number directly.')), 35_000);
  try {
    controller.signal.throwIfAborted();
    return await read(createPetPublicClient(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', cancel);
  }
}

export function listOwnedPets(account: Address, signal?: AbortSignal): Promise<PetIdentity[]> {
  return readWithDeadline((client, activeSignal) => createPetIdentityReader(client).listOwnedPets(account, activeSignal), signal);
}

/** Manual entry is ownership verification, not an override of it. No wallet signature is requested. */
export function verifyPet(collection: PetCollection, tokenId: string | bigint, account: Address, signal?: AbortSignal): Promise<PetIdentity> {
  return readWithDeadline((client, activeSignal) => createPetIdentityReader(client).verifyPet(collection, tokenId, account, activeSignal), signal);
}
