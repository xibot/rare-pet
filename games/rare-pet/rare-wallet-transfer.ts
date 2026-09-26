import {
  createWalletClient, custom, encodeFunctionData, isAddress, parseAbi, parseEventLogs, zeroAddress,
  type Address, type Hex, type PublicClient, type TransactionReceipt, type WalletClient,
} from 'viem';
import type { PetIdentity, PetWalletSession } from './wallet';

/** FriendSDK's canonical account interface, independently checked on Genesis and Generations. */
export const RARE_WALLET_ABI = parseAbi([
  'function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes result)',
  'function owner() view returns (address)',
  'function token() view returns (uint256 chainId,address tokenContract,uint256 tokenId)',
]);
const ERC20 = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to,uint256 amount) returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const ERC721 = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function safeTransferFrom(address from,address to,uint256 tokenId)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
]);
const ERC1155 = parseAbi([
  'function balanceOf(address owner,uint256 tokenId) view returns (uint256)',
  'function safeTransferFrom(address from,address to,uint256 tokenId,uint256 amount,bytes data)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
]);
export type RareWalletTransferIntent = Readonly<
  | { kind: 'native'; to: Address; amount: bigint }
  | { kind: 'erc20'; contract: Address; to: Address; amount: bigint }
  | { kind: 'erc721'; contract: Address; to: Address; tokenId: bigint }
  | { kind: 'erc1155'; contract: Address; to: Address; tokenId: bigint; amount: bigint }
>;
export type RareWalletTransferOptions = Readonly<{
  session: PetWalletSession;
  pet: PetIdentity;
  revision: number;
  intent: RareWalletTransferIntent;
  onHash: (hash: Hex) => void;
  assertActive?: () => void;
}>;
type ReadClient = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'getBalance' | 'readContract' | 'simulateContract' | 'waitForTransactionReceipt' | 'getTransaction'>;
type Signer = Pick<WalletClient, 'chain' | 'getChainId' | 'getAddresses' | 'writeContract'>;
/** Injection is for deterministic tests; production always uses the pinned Robinhood client. */
export type RareWalletTransferDependencies = Readonly<{
  client: ReadClient;
  verifyIdentity: (pet: PetIdentity, account: Address) => Promise<PetIdentity>;
  signer: Signer;
}>;
export class RareWalletTransferError extends Error {
  readonly code: 'unconfirmed' | 'replaced' | 'reverted' | 'unverified' | 'reorg';
  readonly transactionHash: Hex;
  constructor(code: RareWalletTransferError['code'], hash: Hex, message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'RareWalletTransferError'; this.code = code; this.transactionHash = hash;
  }
}
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const UINT_MAX = (1n << 256n) - 1n;
const activeSessions = new WeakSet<PetWalletSession>();
function address(value: unknown, label: string): asserts value is Address {
  if (typeof value !== 'string' || !isAddress(value) || equal(value, zeroAddress)) throw new Error(`Enter a valid ${label} address.`);
}
function uint(value: bigint, label: string, positive = true) {
  if (typeof value !== 'bigint' || value < (positive ? 1n : 0n) || value > UINT_MAX) throw new Error(`Enter a valid ${label}.`);
}

/** Never rounds input: excess precision, exponent notation and zero transfers are rejected. */
export function parseRareWalletAmount(input: string, decimals: number): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('This token has unsupported decimal metadata.');
  const value = input.trim();
  if (value.length > 340 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) throw new Error('Enter an amount using digits and a decimal point.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`This asset supports at most ${decimals} decimal places.`);
  const amount = BigInt(whole + fraction.padEnd(decimals, '0'));
  uint(amount, 'positive amount');
  return amount;
}

/** Fixed CALLs only: no approvals, arbitrary calldata, delegatecalls or owner-wallet asset sends. */
export function buildRareWalletTransfer(wallet: Address, input: RareWalletTransferIntent) {
  address(wallet, 'Rare Wallet'); address(input.to, 'recipient');
  if (equal(input.to, wallet)) throw new Error('Choose a recipient other than this Rare Wallet.');
  const intent = Object.freeze({ ...input });
  if (intent.kind !== 'native') {
    address(intent.contract, 'asset contract');
    if (equal(intent.contract, wallet) || equal(intent.contract, intent.to)) throw new Error('The recipient cannot be the asset contract or this Rare Wallet.');
  }
  if ('amount' in intent) uint(intent.amount, 'positive amount');
  if ('tokenId' in intent) uint(intent.tokenId, 'NFT token ID', false);
  let target: Address, value = 0n, data: Hex;
  switch (intent.kind) {
    case 'native': target = intent.to; value = intent.amount; data = '0x'; break;
    case 'erc20': target = intent.contract; data = encodeFunctionData({ abi: ERC20, functionName: 'transfer', args: [intent.to, intent.amount] }); break;
    case 'erc721': target = intent.contract; data = encodeFunctionData({ abi: ERC721, functionName: 'safeTransferFrom', args: [wallet, intent.to, intent.tokenId] }); break;
    case 'erc1155': target = intent.contract; data = encodeFunctionData({ abi: ERC1155, functionName: 'safeTransferFrom', args: [wallet, intent.to, intent.tokenId, intent.amount, '0x'] }); break;
    default: throw new Error('Choose ETH, an ERC-20 token, or an ERC-721/ERC-1155 NFT.');
  }
  const args = [target, value, data, 0] as const;
  return Object.freeze({ intent, args, data: encodeFunctionData({ abi: RARE_WALLET_ABI, functionName: 'execute', args }) });
}

/** A successful outer transaction is insufficient for tokens that silently return false. */
export function verifyRareWalletTransferReceipt(receipt: TransactionReceipt, hash: Hex, wallet: Address, intent: RareWalletTransferIntent) {
  if (!equal(receipt.transactionHash, hash)) throw new RareWalletTransferError('replaced', hash, `The transaction was replaced by ${receipt.transactionHash}. Inspect its status before retrying.`);
  if (receipt.status !== 'success') throw new RareWalletTransferError('reverted', hash, 'The transfer reverted. No successful transfer was confirmed.');
  if (intent.kind === 'native') return;
  const logs = receipt.logs.filter(log => equal(log.address, intent.contract));
  let matched = false;
  if (intent.kind === 'erc20') matched = parseEventLogs({ abi: ERC20, eventName: 'Transfer', logs, strict: true }).some(({ args }) => equal(args.from, wallet) && equal(args.to, intent.to) && args.value === intent.amount);
  if (intent.kind === 'erc721') matched = parseEventLogs({ abi: ERC721, eventName: 'Transfer', logs, strict: true }).some(({ args }) => equal(args.from, wallet) && equal(args.to, intent.to) && args.tokenId === intent.tokenId);
  if (intent.kind === 'erc1155') matched = parseEventLogs({ abi: ERC1155, eventName: 'TransferSingle', logs, strict: true }).some(({ args }) => equal(args.operator, wallet) && equal(args.from, wallet) && equal(args.to, intent.to) && args.id === intent.tokenId && args.value === intent.amount);
  if (!matched) throw new RareWalletTransferError('unverified', hash, 'The transaction succeeded, but the exact asset transfer could not be verified. Inspect its status before retrying.');
}

/** Shared by initial confirmation and read-only recovery after the modal closes. */
export function verifyRareWalletTransferTransaction(transaction: { to: Address | null; from: Address; value: bigint; input: Hex }, owner: Address, wallet: Address, intent: RareWalletTransferIntent) {
  const expected = buildRareWalletTransfer(wallet, intent);
  if (!transaction.to || !equal(transaction.to, wallet) || !equal(transaction.from, owner) || transaction.value !== 0n || !equal(transaction.input, expected.data)) throw new Error('Transaction does not match the reviewed transfer.');
}

/** Call only after the owner reviews the selected asset, full recipient and exact amount. */
export async function sendRareWalletTransfer(options: RareWalletTransferOptions, injected?: RareWalletTransferDependencies) {
  const { session, revision } = options;
  if (activeSessions.has(session)) throw new Error('A Rare Wallet transfer is already pending.');
  activeSessions.add(session);
  try {
    const pet = Object.freeze({ ...options.pet });
    address(pet.owner, 'owner'); address(pet.walletAddress, 'Rare Wallet');
    if (pet.chainId !== 4663 || pet.collection === 'generations' && !(pet.generation && pet.generation > 0)) throw new Error('Choose a Genesis or hardwired Generations Friend on Robinhood Chain.');
    const wallet = pet.walletAddress;
    const transfer = buildRareWalletTransfer(wallet, options.intent);
    const provider = session.getProvider();
    if (!provider) throw new Error('Reconnect your wallet.');
    const assertSession = () => {
      options.assertActive?.();
      const current = session.getSnapshot();
      if (current.revision !== revision || current.status !== 'connected' || current.chainId !== 4663 || !current.account || !equal(current.account, pet.owner) || session.getProvider() !== provider) throw new Error('Your wallet or selected Friend changed. Open Rare Wallet again.');
    };
    assertSession();
    const dependencies = injected ?? await (async () => {
      const { createPetPublicClient, verifyPet, RARE_PET_CHAIN } = await import('./wallet');
      return { client: createPetPublicClient(), verifyIdentity: (identity: PetIdentity, account: Address) => verifyPet(identity.collection, identity.tokenId, account), signer: createWalletClient({ account: pet.owner, chain: RARE_PET_CHAIN, transport: custom(provider) }) };
    })();
    const { client, signer } = dependencies;
    const assertSigner = async () => {
      assertSession();
      const [chain, accounts, publicChain] = await Promise.all([signer.getChainId(), signer.getAddresses(), client.getChainId()]);
      assertSession();
      if (chain !== 4663 || publicChain !== 4663 || signer.chain?.id !== 4663 || !accounts[0] || !equal(accounts[0], pet.owner)) throw new Error('Use the selected owner wallet on Robinhood Chain (4663).');
    };
    await assertSigner();
    const fresh = await dependencies.verifyIdentity(pet, pet.owner);
    assertSession();
    if (fresh.chainId !== 4663 || fresh.collection !== pet.collection || !equal(fresh.contract, pet.contract) || fresh.tokenId !== pet.tokenId || !equal(fresh.owner, pet.owner) || !fresh.walletAddress || !equal(fresh.walletAddress, wallet)) throw new Error('This Friend’s ownership or canonical wallet changed. Select it again.');
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const [code, owner, token, block] = await Promise.all([
      client.getCode({ address: wallet, blockNumber }),
      client.readContract({ address: wallet, abi: RARE_WALLET_ABI, functionName: 'owner', blockNumber }),
      client.readContract({ address: wallet, abi: RARE_WALLET_ABI, functionName: 'token', blockNumber }),
      client.getBlock({ blockNumber }),
    ]);
    assertSession();
    if (!code || code === '0x' || !block.hash || !equal(owner, pet.owner) || token[0] !== 4663n || !equal(token[1], pet.contract) || token[2] !== BigInt(pet.tokenId)) throw new Error('This Rare Wallet’s owner or NFT binding could not be verified.');
    const { intent } = transfer;
    if (intent.kind === 'native') {
      if (await client.getBalance({ address: wallet, blockNumber }) < intent.amount) throw new Error('This Rare Wallet does not have enough ETH.');
    } else {
      if (!await client.getCode({ address: intent.contract, blockNumber })) throw new Error('The asset contract is unavailable on Robinhood Chain.');
      if (intent.kind === 'erc20' && await client.readContract({ address: intent.contract, abi: ERC20, functionName: 'balanceOf', args: [wallet], blockNumber }) < intent.amount) throw new Error('This Rare Wallet does not have enough of that token.');
      if (intent.kind === 'erc721' && !equal(await client.readContract({ address: intent.contract, abi: ERC721, functionName: 'ownerOf', args: [intent.tokenId], blockNumber }), wallet)) throw new Error('This NFT is no longer held in this Rare Wallet.');
      if (intent.kind === 'erc1155' && await client.readContract({ address: intent.contract, abi: ERC1155, functionName: 'balanceOf', args: [wallet, intent.tokenId], blockNumber }) < intent.amount) throw new Error('This Rare Wallet does not have that many copies of this NFT.');
    }
    assertSession();
    const execution = { account: pet.owner, address: wallet, abi: RARE_WALLET_ABI, functionName: 'execute' as const, args: transfer.args, value: 0n };
    const simulation = await client.simulateContract(execution);
    // Most ERC-20s return true; some omit return data. False/malformed data never reaches a prompt.
    if (intent.kind === 'erc20' && simulation.result !== '0x' && !/^0x0{63}1$/.test(simulation.result)) throw new Error('The token rejected this transfer or returned an unsupported response.');
    assertSession();
    const currentBlock = await client.getBlock({ blockNumber });
    if (!currentBlock.hash || !equal(currentBlock.hash, block.hash)) throw new Error('The verification block changed. Refresh the wallet before sending.');
    await assertSigner();
    const hash = await signer.writeContract({ ...execution, chain: signer.chain });
    try { options.onHash(hash); }
    catch (cause) { throw new RareWalletTransferError('unconfirmed', hash, 'Your transfer was sent, but the interface could not update its status. Inspect this transaction before retrying.', { cause }); }
    let receipt: TransactionReceipt;
    try { receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 }); }
    catch (cause) { throw new RareWalletTransferError('unconfirmed', hash, 'Your transfer was sent, but confirmation is still unknown. Inspect its status before retrying.', { cause }); }
    verifyRareWalletTransferReceipt(receipt, hash, wallet, intent);
    try {
      const transaction = await client.getTransaction({ hash });
      verifyRareWalletTransferTransaction(transaction, pet.owner, wallet, intent);
    } catch (cause) { throw new RareWalletTransferError('unverified', hash, 'The sent transaction could not be matched to your reviewed transfer. Inspect its status before retrying.', { cause }); }
    try {
      const confirmed = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (!confirmed.hash || !equal(confirmed.hash, receipt.blockHash) || await client.getChainId() !== 4663) throw new Error('Receipt block changed.');
    } catch (cause) { throw new RareWalletTransferError('reorg', hash, 'The transfer receipt could not be confirmed on the current chain. Inspect its status before retrying.', { cause }); }
    return { hash, receipt };
  } finally { activeSessions.delete(session); }
}
