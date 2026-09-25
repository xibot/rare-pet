import { isAddress, parseAbi, parseAbiItem, zeroAddress, type Address, type PublicClient } from 'viem';

/** Canonical Robinhood deployment published at rarefriends.com/docs/contracts. */
export const GENESIS_DEPLOYMENT = Object.freeze({
  chainId: 4663 as const,
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  contract: '0x116EaA62241751E0c98dA43d458600c6C17cD361' as Address,
});

export type GenesisClient = Pick<PublicClient, 'getLogs' | 'readContract' | 'getBlockNumber' | 'getChainId'>;
type ReadOptions = Readonly<{ signal?: AbortSignal }>;
type GenesisFriend = Readonly<{ id: bigint; label: string; walletAddress: Address }>;
export type GenesisIdentity = Readonly<{
  collection: 'genesis'; chainId: 4663; contract: Address; tokenId: string; label: string;
  image: string; owner: Address; walletAddress: Address; blockNumber: string;
}>;

const ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
]);
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const MAX_OWNED_GENESIS = 1024;
const MAX_TRANSFER_LOGS = 100_000;
const MAX_JSON_BYTES = 500_000;
const MAX_SVG_BYTES = 200_000;
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const validAddress = (value: unknown): value is Address =>
  typeof value === 'string' && isAddress(value) && !equal(value, zeroAddress);
const validId = (value: unknown): value is bigint =>
  typeof value === 'bigint' && value > 0n && value < (1n << 256n);

class GenesisReadError extends Error {}
function fail(message: string): never { throw new GenesisReadError(message); }
const active = (options: ReadOptions) => options.signal?.throwIfAborted();

async function safeRead<T>(options: ReadOptions, read: () => Promise<T>): Promise<T> {
  try {
    active(options);
    return await read();
  } catch (error) {
    active(options);
    if (error instanceof GenesisReadError) throw error;
    throw new GenesisReadError('Could not verify your Genesis on Robinhood. Please retry.');
  }
}

function validateAccount(account: Address) {
  if (!validAddress(account)) fail('Connect a valid wallet to load your Genesis Friends.');
}

function validateId(id: bigint) {
  if (!validId(id)) fail('Choose a valid Genesis token.');
}

async function checkChain(client: GenesisClient, options: ReadOptions) {
  active(options);
  const chain = await client.getChainId();
  active(options);
  if (chain !== GENESIS_DEPLOYMENT.chainId) fail('Switch your wallet to Robinhood mainnet (4663) to play with Genesis.');
}

async function freshBlock(client: GenesisClient, options: ReadOptions) {
  await checkChain(client, options);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  active(options);
  if (typeof blockNumber !== 'bigint' || blockNumber < 0n) fail('Could not read the latest Robinhood block. Please retry.');
  return blockNumber;
}

async function verifyAtBlock(client: GenesisClient, id: bigint, account: Address, blockNumber: bigint, options: ReadOptions) {
  const owner = await client.readContract({ address: GENESIS_DEPLOYMENT.contract, abi: ABI,
    functionName: 'ownerOf', args: [id], blockNumber });
  active(options);
  if (!validAddress(owner) || !equal(owner, account)) fail('This Genesis is no longer owned by your connected wallet. Choose another Friend.');
  const walletAddress = await client.readContract({ address: GENESIS_DEPLOYMENT.contract, abi: ABI,
    functionName: 'tokenBoundAccount', args: [id], blockNumber });
  active(options);
  if (!validAddress(walletAddress)) fail('Could not verify this Genesis Friend’s canonical wallet. Please retry.');
  return Object.freeze({ id, owner, walletAddress, blockNumber });
}

/** Owner-filtered transfer history only; incomplete or inconsistent history never grants access. */
export function readOwnedGenesis(client: GenesisClient, account: Address, options: ReadOptions = {}) {
  return safeRead(options, async () => {
    validateAccount(account);
    const blockNumber = await freshBlock(client, options);
    const balance = await client.readContract({ address: GENESIS_DEPLOYMENT.contract, abi: ABI,
      functionName: 'balanceOf', args: [account], blockNumber });
    active(options);
    if (typeof balance !== 'bigint' || balance < 0n || balance > BigInt(MAX_OWNED_GENESIS)) {
      fail('Could not verify your Genesis balance. Please retry.');
    }
    if (balance === 0n) {
      await checkChain(client, options);
      return Object.freeze({ friends: Object.freeze([] as GenesisFriend[]), blockNumber });
    }
    const query = { address: GENESIS_DEPLOYMENT.contract, event: TRANSFER,
      fromBlock: 0n, toBlock: blockNumber, strict: true } as const;
    const [received, sent] = await Promise.all([
      client.getLogs({ ...query, args: { to: account } }),
      client.getLogs({ ...query, args: { from: account } }),
    ]);
    active(options);
    if (received.length + sent.length > MAX_TRANSFER_LOGS) {
      fail('This wallet’s Genesis history is too large to verify. Please use another RPC provider.');
    }
    const events = new Map<string, typeof received[number]>();
    for (const log of [...received, ...sent]) {
      const { from, to, tokenId } = log.args;
      if (!isAddress(log.address) || !equal(log.address, GENESIS_DEPLOYMENT.contract) || log.removed ||
          typeof log.blockNumber !== 'bigint' || log.blockNumber < 0n || log.blockNumber > blockNumber ||
          !Number.isSafeInteger(log.logIndex) || log.logIndex === null || log.logIndex < 0 ||
          !isAddress(from) || !isAddress(to) || !validId(tokenId) ||
          (!equal(from, account) && !equal(to, account))) {
        fail('Genesis transfer history could not be verified. Please retry.');
      }
      const key = `${log.blockNumber}:${log.logIndex}`;
      const previous = events.get(key);
      if (previous && (previous.args.tokenId !== tokenId || !equal(previous.args.from, from) || !equal(previous.args.to, to))) {
        fail('Genesis transfer history is inconsistent. Please retry.');
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
    if (BigInt(held.size) !== balance) fail('Your Genesis history is incomplete or changed. Please retry with a complete RPC history.');
    const ids = [...held].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const friends: GenesisFriend[] = [];
    for (let offset = 0; offset < ids.length; offset += 8) {
      active(options);
      const group = await Promise.all(ids.slice(offset, offset + 8).map(async id => {
        const verified = await verifyAtBlock(client, id, account, blockNumber, options);
        return Object.freeze({ id, label: `Genesis #${id}`, walletAddress: verified.walletAddress });
      }));
      friends.push(...group);
    }
    await checkChain(client, options);
    return Object.freeze({ friends: Object.freeze(friends), blockNumber });
  });
}

/** A fresh pinned-block check; a previous picker result is never authorization. */
export function readGenesisEligibility(client: GenesisClient, id: bigint, account: Address, options: ReadOptions = {}) {
  return safeRead(options, async () => {
    validateAccount(account);
    validateId(id);
    const blockNumber = await freshBlock(client, options);
    const verified = await verifyAtBlock(client, id, account, blockNumber, options);
    await checkChain(client, options);
    return verified;
  });
}

function decodeData(value: unknown, mime: string, maxBytes: number) {
  const prefix = `data:${mime};base64,`;
  if (typeof value !== 'string' || value.length > maxBytes || !value.startsWith(prefix)) {
    fail('This Genesis artwork has an unsupported format. Please retry.');
  }
  const payload = value.slice(prefix.length);
  if (!payload.length || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    fail('This Genesis artwork could not be decoded. Please retry.');
  }
  const binary = atob(payload);
  if (btoa(binary) !== payload) fail('This Genesis artwork could not be decoded. Please retry.');
  if (binary.length > maxBytes) fail('This Genesis artwork is too large to load.');
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

function readImage(uri: unknown): string {
  const metadata: unknown = JSON.parse(decodeData(uri, 'application/json', MAX_JSON_BYTES));
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) fail('This Genesis metadata could not be verified.');
  const image: unknown = (metadata as Record<string, unknown>).image;
  const svg = decodeData(image, 'image/svg+xml', MAX_SVG_BYTES).trim();
  // SVG is passed only to an <img> src. Never insert token metadata into the DOM as markup.
  // Keep the canonical static artwork self-contained; reject active or external content as well.
  if (!/^<svg\s[^>]*>/.test(svg) || !/<\/svg>$/.test(svg) ||
      /<!|<\?|<(?:script|foreignObject|iframe|image|use|style|animate\w*|set|a)\b/i.test(svg) ||
      /\s(?:on[a-z]+|(?:xlink:)?href)\s*=|url\s*\(/i.test(svg)) {
    fail('This Genesis artwork is not a supported static portrait.');
  }
  return image as string;
}

/** Read-only picker artwork. A portrait is never proof of ownership or permission to play. */
export function readGenesisPortrait(client: GenesisClient, id: bigint, options: ReadOptions = {}): Promise<string> {
  return safeRead(options, async () => {
    validateId(id);
    const blockNumber = await freshBlock(client, options);
    const uri = await client.readContract({ address: GENESIS_DEPLOYMENT.contract, abi: ABI,
      functionName: 'tokenURI', args: [id], blockNumber });
    active(options);
    const image = readImage(uri);
    await checkChain(client, options);
    return image;
  });
}

/** Owner and art are read at one fresh block. This serializable result contains no wallet authority. */
export function readGenesisIdentity(client: GenesisClient, id: bigint, account: Address, options: ReadOptions = {}): Promise<GenesisIdentity> {
  return safeRead(options, async () => {
    validateAccount(account);
    validateId(id);
    const blockNumber = await freshBlock(client, options);
    const verified = await verifyAtBlock(client, id, account, blockNumber, options);
    const uri = await client.readContract({ address: GENESIS_DEPLOYMENT.contract, abi: ABI,
      functionName: 'tokenURI', args: [id], blockNumber });
    active(options);
    const image = readImage(uri);
    await checkChain(client, options);
    return Object.freeze({ collection: 'genesis', chainId: GENESIS_DEPLOYMENT.chainId,
      contract: GENESIS_DEPLOYMENT.contract, tokenId: String(id),
      label: `Genesis #${id}`, image, owner: verified.owner, walletAddress: verified.walletAddress,
      blockNumber: String(blockNumber) });
  });
}
