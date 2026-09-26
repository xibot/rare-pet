import { BaseError, ContractFunctionRevertedError, isAddress, parseAbi, zeroAddress, type Address, type PublicClient } from 'viem';
import { createPetPublicClient, PET_DEPLOYMENT } from './wallet';

export type HoldingSource = 'blockscout' | 'rpc';
export type TokenHolding = Readonly<{
  kind: 'erc20'; contract: Address; name: string; symbol: string;
  /** Null means the indexer has not supplied a balance, never zero. */
  balance: bigint | null; decimals: number | null; imageUrl: string | null;
  source: HoldingSource; blockNumber?: bigint;
}>;
export type NftHolding = Readonly<{
  kind: 'erc721' | 'erc1155'; contract: Address; tokenId: string; name: string; collectionName: string;
  balance: bigint | null; imageUrl: string | null; source: HoldingSource; blockNumber?: bigint;
}>;
export type NativeHolding = Readonly<{
  kind: 'native'; symbol: 'ETH'; name: 'Ether'; balance: bigint; decimals: 18; blockNumber: bigint; source: 'rpc';
}>;
export type HoldingsCursor = Readonly<{
  wallet: Address; kind: 'tokens' | 'nft'; params: Readonly<Record<string, string>>; page: number;
}>;
export type HoldingsPage<T> = Readonly<{
  items: readonly T[]; nextCursor: HoldingsCursor | null; warnings: readonly string[]; source: 'blockscout';
}>;
/** A successful read proved a historical NFT candidate is no longer held. */
export class HoldingNotOwnedError extends Error {
  constructor() { super('This NFT is not held by this Rare Friend’s wallet.'); this.name = 'HoldingNotOwnedError'; }
}
type ReadClient = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBalance' | 'readContract' | 'getCode'>;
type Options = { fetcher?: typeof fetch; client?: ReadClient; timeoutMs?: number };
const UINT256_MAX = (1n << 256n) - 1n;
const MAX_PAGE_ITEMS = 100, MAX_PAGES = 50, MAX_RESPONSE_BYTES = 2_000_000;
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const ERC20 = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);
const NFT = parseAbi([
  'error ERC721NonexistentToken(uint256 tokenId)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner,uint256 tokenId) view returns (uint256)',
  'function name() view returns (string)',
]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function address(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || equal(value, zeroAddress)) throw new Error('Enter a valid nonzero contract or Rare Friend wallet address.');
  return value as Address;
}
function uint(value: unknown): bigint {
  if (typeof value === 'bigint' && value >= 0n && value <= UINT256_MAX) return value;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error('Invalid whole-number asset amount.');
  const result = BigInt(value);
  if (result > UINT256_MAX) throw new Error('Asset amount exceeds uint256.');
  return result;
}
function optionalUint(value: unknown): bigint | null { return value == null ? null : uint(value); }
function text(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 120) || fallback;
}
function decimals(value: unknown): number | null {
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,2})$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
}

/** Only use as an <img src>, never HTML, iframe, object, or a navigable metadata link. */
export function safeHoldingImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) return null;
  let source = value;
  if (source.startsWith('ipfs://')) {
    const path = source.slice(7).replace(/^ipfs\//, '');
    if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(\/[^?#]*)?$/.test(path) || path.split('/').some(part => part === '..' || part === '.')) return null;
    source = `https://ipfs.io/ipfs/${path}`;
  }
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname) ||
        /\.(local|localhost|internal)$/i.test(url.hostname) || url.hostname.startsWith('[')) return null;
    return url.href;
  } catch { return null; }
}

/** Exact string formatting; unknown decimals stay explicitly in base units. */
export function formatHoldingBalance(balance: bigint | null, scale: number | null): string {
  if (balance === null) return 'Pending balance';
  uint(balance);
  if (scale === null || decimals(scale) === null) return `${balance} base units`;
  if (scale === 0) return String(balance);
  const digits = balance.toString().padStart(scale + 1, '0');
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return digits.slice(0, -scale) + (fraction ? `.${fraction}` : '');
}

function tokenRow(value: unknown): TokenHolding {
  if (!record(value) || !record(value.token) || value.token.type !== 'ERC-20') throw new Error('Unsupported token row.');
  const token = value.token;
  return { kind: 'erc20', contract: address(token.address_hash ?? token.address),
    name: text(token.name, 'Unnamed token'), symbol: text(token.symbol, 'TOKEN'),
    balance: optionalUint(value.value), decimals: decimals(token.decimals), imageUrl: safeHoldingImage(token.icon_url), source: 'blockscout' };
}
function nftRow(value: unknown, wallet: Address): NftHolding {
  if (!record(value) || !record(value.token)) throw new Error('Unsupported NFT row.');
  const token = value.token, type = value.token_type ?? token.type;
  if (type !== 'ERC-721' && type !== 'ERC-1155') throw new Error('Unsupported NFT standard.');
  const holder = value.holder_address_hash ?? (record(value.owner) ? value.owner.hash : null);
  if (holder && !equal(address(holder), wallet)) throw new Error('NFT row belongs to a different wallet.');
  const id = String(uint(value.id));
  const metadata = record(value.metadata) ? value.metadata : {};
  const balance = optionalUint(value.value);
  if (type === 'ERC-721' && balance !== null && balance !== 0n && balance !== 1n) throw new Error('Invalid NFT amount.');
  return { kind: type === 'ERC-721' ? 'erc721' : 'erc1155', contract: address(token.address_hash ?? token.address), tokenId: id,
    name: text(metadata.name, `#${id}`), collectionName: text(token.name, 'Unnamed collection'), balance,
    imageUrl: safeHoldingImage(value.image_url) ?? safeHoldingImage(metadata.image) ?? safeHoldingImage(metadata.image_url), source: 'blockscout' };
}
function cursorParams(value: unknown): Record<string, string> | null {
  if (value === null) return null;
  if (!record(value)) throw new Error('Holdings pagination is incomplete. Retry discovery.');
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 20) throw new Error('Holdings pagination is invalid. Retry discovery.');
  const params: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || ['type', 'address', 'address_hash', 'apikey', 'api_key'].includes(key)) throw new Error('Holdings pagination contains unsupported parameters.');
    if (item === null) continue;
    if (typeof item !== 'string' && !(typeof item === 'number' && Number.isSafeInteger(item)) && typeof item !== 'boolean') throw new Error('Holdings pagination is invalid.');
    const string = String(item);
    if (string.length > 2048) throw new Error('Holdings pagination is too large.');
    params[key] = string;
  }
  if (!Object.keys(params).length) throw new Error('Holdings pagination has no continuation.');
  return params;
}
function fingerprint(params: Readonly<Record<string, string>>) { return JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))); }

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) throw new Error(`Asset discovery is unavailable (explorer ${response.status}). Add an asset by contract address or view the wallet in Blockscout.`);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The explorer did not return holdings. Add an asset by contract address or retry later.');
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_RESPONSE_BYTES || !response.body) throw new Error('The explorer response is unavailable or too large.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) throw new Error('The explorer response is too large.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) { all.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder().decode(all)); }
  catch { throw new Error('The explorer returned unreadable holdings. Retry discovery.'); }
}

/** Injectable reads for tests; each operation has a deadline and respects modal cancellation. */
export function createRareWalletHoldingsReader(options: Options = {}) {
  async function timed<T>(outer: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const cancel = () => controller.abort(outer?.reason);
    outer?.addEventListener('abort', cancel, { once: true });
    if (outer?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new Error('Wallet holdings timed out. Retry or add an asset by contract address.')), options.timeoutMs ?? 18_000);
    let listener: (() => void) | undefined;
    try {
      controller.signal.throwIfAborted();
      const aborted = new Promise<never>((_, reject) => {
        listener = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', listener, { once: true });
      });
      return await Promise.race([operation(controller.signal), aborted]);
    } finally {
      clearTimeout(timer); outer?.removeEventListener('abort', cancel);
      if (listener) controller.signal.removeEventListener('abort', listener);
    }
  }
  async function rpc<T>(outer: AbortSignal | undefined, operation: (client: ReadClient, block: bigint, signal: AbortSignal) => Promise<T>, blockNumber?: bigint) {
    return timed(outer, async signal => {
      const client = options.client ?? createPetPublicClient(signal);
      if (await client.getChainId() !== PET_DEPLOYMENT.chainId) throw new Error('Wallet holdings require Robinhood Chain (4663).');
      signal.throwIfAborted();
      const block = blockNumber ?? await client.getBlockNumber({ cacheTime: 0 });
      uint(block);
      const result = await operation(client, block, signal);
      signal.throwIfAborted();
      return result;
    });
  }
  async function page<T>(wallet: Address, kind: 'tokens' | 'nft', cursor: HoldingsCursor | null | undefined, outer: AbortSignal | undefined, parse: (value: unknown) => T): Promise<HoldingsPage<T>> {
    wallet = address(wallet);
    if (cursor && (!equal(cursor.wallet, wallet) || cursor.kind !== kind || !Number.isSafeInteger(cursor.page) || cursor.page < 1 || cursor.page >= MAX_PAGES)) throw new Error('This holdings cursor does not match the wallet or exceeds the discovery limit.');
    const supplied = cursor ? cursorParams(cursor.params)! : null;
    return timed(outer, async signal => {
      const url = new URL(`${EXPLORER}/api/v2/addresses/${wallet}/${kind}`);
      url.searchParams.set('type', kind === 'tokens' ? 'ERC-20' : 'ERC-721,ERC-1155');
      for (const [key, value] of Object.entries(supplied ?? {})) url.searchParams.set(key, value);
      let response: Response;
      try { response = await (options.fetcher ?? fetch)(url.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } }); }
      catch (cause) { signal.throwIfAborted(); throw new Error('Asset discovery could not reach the explorer. Add an asset by contract address or retry later.', { cause }); }
      const body = await responseJson(response, signal);
      signal.throwIfAborted();
      if (!record(body) || !Array.isArray(body.items) || body.items.length > MAX_PAGE_ITEMS || !Object.hasOwn(body, 'next_page_params')) throw new Error('The explorer returned an incomplete holdings page. Retry discovery.');
      const next = cursorParams(body.next_page_params), warnings: string[] = [];
      const items: T[] = [];
      let invalid = 0;
      for (const row of body.items) { try { items.push(parse(row)); } catch { invalid++; } }
      if (invalid) warnings.push(`${invalid} asset ${invalid === 1 ? 'row could' : 'rows could'} not be read. The list is incomplete; inspect the wallet in Blockscout.`);
      if (next && supplied && fingerprint(next) === fingerprint(supplied)) throw new Error('The explorer repeated its holdings page. Retry discovery.');
      const pageNumber = (cursor?.page ?? 0) + 1;
      if (next && pageNumber >= MAX_PAGES) warnings.push('The discovery limit was reached. More assets may remain in the wallet; inspect Blockscout or add an asset by contract address.');
      return { items, source: 'blockscout', warnings,
        nextCursor: next && pageNumber < MAX_PAGES ? { wallet, kind, params: next, page: pageNumber } : null };
    });
  }
  async function readNativeBalance(wallet: Address, signal?: AbortSignal): Promise<NativeHolding> {
    wallet = address(wallet);
    return rpc(signal, async (client, block) => ({ kind: 'native', symbol: 'ETH', name: 'Ether', decimals: 18,
      balance: uint(await client.getBalance({ address: wallet, blockNumber: block })), blockNumber: block, source: 'rpc' }));
  }
  async function readTokenHolding(wallet: Address, contract: Address, signal?: AbortSignal, blockNumber?: bigint): Promise<TokenHolding> {
    wallet = address(wallet); contract = address(contract);
    return rpc(signal, async (client, block, active) => {
      const code = await client.getCode({ address: contract, blockNumber: block });
      if (!code || code === '0x') throw new Error('There is no token contract at this address on Robinhood.');
      active.throwIfAborted();
      const query = { address: contract, abi: ERC20, blockNumber: block } as const;
      const balance = uint(await client.readContract({ ...query, functionName: 'balanceOf', args: [wallet] }));
      const [name, symbol, scale] = await Promise.allSettled([
        client.readContract({ ...query, functionName: 'name' }), client.readContract({ ...query, functionName: 'symbol' }), client.readContract({ ...query, functionName: 'decimals' }),
      ]);
      active.throwIfAborted();
      return { kind: 'erc20', contract, balance, name: text(name.status === 'fulfilled' ? name.value : null, 'Unnamed token'),
        symbol: text(symbol.status === 'fulfilled' ? symbol.value : null, 'TOKEN'), decimals: decimals(scale.status === 'fulfilled' ? scale.value : null),
        imageUrl: null, source: 'rpc', blockNumber: block };
    }, blockNumber);
  }
  async function readNftHolding(wallet: Address, contract: Address, tokenId: string, kind: 'erc721' | 'erc1155', signal?: AbortSignal, blockNumber?: bigint): Promise<NftHolding> {
    wallet = address(wallet); contract = address(contract);
    const id = uint(tokenId);
    if (kind !== 'erc721' && kind !== 'erc1155') throw new Error('Choose ERC-721 or ERC-1155.');
    return rpc(signal, async (client, block, active) => {
      const code = await client.getCode({ address: contract, blockNumber: block });
      if (!code || code === '0x') throw new Error('There is no NFT contract at this address on Robinhood.');
      const query = { address: contract, abi: NFT, blockNumber: block } as const;
      const supported = await client.readContract({ ...query, functionName: 'supportsInterface', args: [kind === 'erc721' ? '0x80ac58cd' : '0xd9b67a26'] });
      if (supported !== true) throw new Error('This contract does not support the selected NFT standard.');
      active.throwIfAborted();
      let balance: bigint;
      if (kind === 'erc721') {
        let result: unknown;
        try { result = await client.readContract({ ...query, functionName: 'ownerOf', args: [id] }); }
        catch (cause) {
          // Burned historical NFTs are absent holdings only when the standard error
          // proves this exact ID does not exist. Generic reverts remain read failures.
          const reverted = cause instanceof BaseError ? cause.walk(error => error instanceof ContractFunctionRevertedError) : null;
          if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === 'ERC721NonexistentToken' && reverted.data.args?.[0] === id) throw new HoldingNotOwnedError();
          throw cause;
        }
        const owner = address(result);
        if (!equal(owner, wallet)) throw new HoldingNotOwnedError();
        balance = 1n;
      } else {
        balance = uint(await client.readContract({ ...query, functionName: 'balanceOf', args: [wallet, id] }));
        if (balance === 0n) throw new HoldingNotOwnedError();
      }
      const name = await client.readContract({ ...query, functionName: 'name' }).catch(() => null);
      active.throwIfAborted();
      return { kind, contract, tokenId: String(id), balance, name: `#${id}`, collectionName: text(name, 'Unnamed collection'), imageUrl: null, source: 'rpc', blockNumber: block };
    }, blockNumber);
  }
  return { readNativeBalance, readTokenHolding, readNftHolding,
    readTokenPage: (wallet: Address, cursor?: HoldingsCursor | null, signal?: AbortSignal) => page(wallet, 'tokens', cursor, signal, tokenRow),
    readNftPage: (wallet: Address, cursor?: HoldingsCursor | null, signal?: AbortSignal) => page(wallet, 'nft', cursor, signal, value => nftRow(value, wallet)),
  };
}
export const { readNativeBalance, readTokenPage, readNftPage, readTokenHolding, readNftHolding } = createRareWalletHoldingsReader();
