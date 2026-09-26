import {
  DopplerSDK, MulticurveBuilder, airlockAbi, dopplerHookInitializerAbi, computePoolId,
  type CreateMulticurveParams, type PreparedMulticurveCreate, type CreateParams,
} from '@whetstone-research/doppler-sdk/evm';
import {
  createWalletClient, custom, encodeAbiParameters, encodeFunctionData, decodeAbiParameters,
  isAddress, keccak256, parseUnits, parseAbi, parseEventLogs, stringToHex, zeroAddress,
  type Address, type Hex, type PublicClient, type TransactionReceipt, type WalletClient,
} from 'viem';
import type { PetIdentity, PetWalletSession } from './wallet';
import { launchTreasury } from './config.ts';
import { LAUNCH_QUOTE_ASSETS, getLaunchQuoteAsset, readLaunchQuotePrice, type LaunchQuotePrice, type LaunchQuoteId } from './launch-quotes.ts';
import { RARE_WALLET_ABI } from './rare-wallet-transfer.ts';

/** Official Doppler bda077cf deployment, independently read on Robinhood block 72704138. */
export const RARE_LAUNCH_DOPPLER = Object.freeze({
  chainId: 4663 as const,
  airlock: '0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862' as Address,
  initializer: '0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544' as Address,
  tokenFactory: '0x1b37d3a72082029c44b35b604ea473617580b69a' as Address,
  governance: '0x85f37f74ef2478a770318bc810177a9835911ad7' as Address,
  migrator: '0xba2f330edb16cd8056f5988d8ce19bbc63475a0e' as Address,
  dead: '0x000000000000000000000000000000000000dEaD' as Address,
  migrationDead: '0xdeaDDeADDEaDdeaDdEAddEADDEAdDeadDEADDEaD' as Address,
});
export const RARE_LAUNCH_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const RARE_LAUNCH_START_USD = 10_000;
export const RARE_LAUNCH_FEES = Object.freeze([3000, 10000, 20000] as const);
const WAD = 10n ** 18n;
const PROTOCOL_SHARES = WAD / 20n;
const TICK_SPACING = 200;
const CURVE = '(int24 tickLower,int24 tickUpper,uint16 numPositions,uint256 shares)';
export const RARE_LAUNCH_ROUTER_ABI = parseAbi([
  `function launch((string name,string symbol,string tokenURI,address quote,uint24 fee,${CURVE}[] curves,int24 farTick,bytes32 salt) request) returns(address asset)`,
  `function launchAsSelf((string name,string symbol,string tokenURI,address quote,uint24 fee,${CURVE}[] curves,int24 farTick,bytes32 salt) request) returns(address asset)`,
  'function selfLaunchCount(address creator) view returns(uint256)',
  'event SelfLaunchRecorded(address indexed creator,address indexed asset,address quote,uint24 fee,bytes32 metadataHash,uint256 timestamp)',
  'function CHAIN_ID() view returns(uint256)', 'function AIRLOCK() view returns(address)',
  'function TOKEN_FACTORY() view returns(address)', 'function INITIALIZER() view returns(address)',
  'function GOVERNANCE() view returns(address)', 'function MIGRATOR() view returns(address)',
  'function treasury() view returns(address)', 'function totalSupply() view returns(uint256)',
  'function friendShares() view returns(uint96)', 'function treasuryShares() view returns(uint96)',
  'function quoteTokens() view returns(address[])', 'function allowedQuote(address) view returns(bool)',
  'function getLaunch(address collection,uint256 tokenId) view returns((uint256 brain,uint256 lastLaunchAt,bool hasLaunched))',
  'function launchedAsset(address asset) view returns(bool)',
  'event LaunchRecorded(address indexed collection,uint256 indexed tokenId,address indexed asset,address friendWallet,address owner,address quote,uint24 fee,bytes32 metadataHash,uint256 timestamp)',
]);
const READ_ABI = parseAbi([
  'function owner() view returns(address)', 'function getModuleState(address) view returns(uint8)',
  'function getShares(bytes32,address) view returns(uint256)',
  'function getCumulatedFees0(bytes32) view returns(uint256)', 'function getCumulatedFees1(bytes32) view returns(uint256)',
  'function getLastCumulatedFees0(bytes32,address) view returns(uint256)', 'function getLastCumulatedFees1(bytes32,address) view returns(uint256)',
  'function collectFees(bytes32) returns(uint128,uint128)',
  'event Release(bytes32 indexed poolId,address indexed beneficiary,uint256 fees0,uint256 fees1)',
]);
export type RareLaunchFee = typeof RARE_LAUNCH_FEES[number];
export type RareLaunchDraft = Readonly<{ name: string; symbol: string; tokenURI: string; quote: LaunchQuotePrice; fee: RareLaunchFee; salt: Hex }>;
export type RareLaunchConfig = Readonly<{
  router: Address; treasury: Address; protocol: Address; friendShares: bigint; treasuryShares: bigint;
  protocolShares: bigint; totalSupply: bigint; quoteTokens: readonly Address[];
  brain: bigint; lastLaunchAt: bigint; hasLaunched: boolean; readyAt: bigint;
  blockNumber: bigint; timestamp: bigint;
}>;
export type RareLaunchRequest = Readonly<{
  name: string; symbol: string; tokenURI: string; quote: Address; fee: RareLaunchFee;
  curves: readonly Readonly<{ tickLower: number; tickUpper: number; numPositions: number; shares: bigint }>[];
  farTick: number; salt: Hex;
}>;
export type RareLaunchReview = Readonly<{
  name: string; symbol: string; tokenURI: string; wallet: Address; router: Address;
  supply: bigint; startMarketCapUSD: number; approximateStartMarketCapUSD: number;
  quote: LaunchQuotePrice; fee: RareLaunchFee; treasury: Address; protocol: Address;
  friendShares: bigint; treasuryShares: bigint; protocolShares: bigint;
}>;
export type PreparedRareLaunch = Readonly<{
  mode: 'friend'; pet: PetIdentity; revision: number; config: RareLaunchConfig; draft: RareLaunchDraft;
  review: RareLaunchReview; request: RareLaunchRequest; doppler: PreparedMulticurveCreate<4663>;
  data: Hex; gasEstimate: bigint | null; preparedAt: number;
}>;
export type PreparedRareSelfLaunch = Readonly<Omit<PreparedRareLaunch, 'pet' | 'mode'> & { mode: 'self'; account: Address }>;
export type PreparedRareLaunchTransaction = PreparedRareLaunch | PreparedRareSelfLaunch;
type ReadClient = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract' | 'simulateContract' | 'estimateContractGas' | 'waitForTransactionReceipt' | 'getTransaction' | 'getLogs'>;
type Signer = Pick<WalletClient, 'chain' | 'getChainId' | 'getAddresses' | 'writeContract'>;
export type RareLaunchDependencies = Readonly<{
  client: ReadClient;
  verifyIdentity: (pet: PetIdentity, owner: Address) => Promise<PetIdentity>;
  signer?: Signer;
  prepare?: (params: CreateMulticurveParams<4663>, router: Address) => Promise<PreparedMulticurveCreate<4663>>;
  now?: () => number;
  refreshQuote?: (id: LaunchQuoteId) => Promise<LaunchQuotePrice>;
}>;
type SessionOptions = Readonly<{ session: PetWalletSession; pet: PetIdentity; revision: number; assertActive?: () => void; onWalletRequest?: () => void }>;
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const active = new WeakSet<PetWalletSession>();
function address(value: unknown, name: string): asserts value is Address {
  if (typeof value !== 'string' || !isAddress(value) || equal(value, zeroAddress)) throw new Error(`A valid ${name} address is required.`);
}
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
export function createRareLaunchSalt(): Hex {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
function validateLaunchDraft(draft: RareLaunchDraft, now = Date.now(), currentCatalog = true) {
  const bytes = new TextEncoder();
  if (draft.name !== draft.name.trim() || bytes.encode(draft.name).length < 1 || bytes.encode(draft.name).length > 64 || /[\u0000-\u001f\u007f]/u.test(draft.name)) throw new Error('Use a token name of 1–64 bytes without control characters.');
  if (!/^[A-Z0-9]{1,12}$/.test(draft.symbol)) throw new Error('Use 1–12 uppercase letters or digits for the ticker.');
  if (bytes.encode(draft.tokenURI).length > 4096 || !/^(?:ipfs:\/\/[^\s]+|data:application\/json;base64,[A-Za-z0-9+/]+={0,2})$/.test(draft.tokenURI)) throw new Error('Upload valid permanent launch metadata first.');
  if (!RARE_LAUNCH_FEES.includes(draft.fee)) throw new Error('Choose one of the supported trading fees.');
  if (!/^0x[0-9a-fA-F]{64}$/.test(draft.salt)) throw new Error('The launch salt must be exactly 32 bytes.');
  const quote = draft.quote;
  if (!['chainlink', 'robinhood'].includes(quote.source) || quote.asset.chainId !== 4663 || quote.asset.decimals !== 18
    || ![quote.expiresAt, quote.readAt, quote.updatedAt, quote.heartbeatSeconds].every(Number.isSafeInteger)
    || quote.heartbeatSeconds <= 0 || quote.heartbeatSeconds > 86400 || quote.readAt <= 0 || quote.updatedAt <= 0
    || quote.expiresAt * 1000 <= now || quote.readAt * 1000 > now + 30000 || quote.updatedAt > quote.readAt + 30
    || quote.expiresAt > quote.readAt + 120 || quote.expiresAt > quote.updatedAt + quote.heartbeatSeconds
    || typeof quote.blockNumber !== 'bigint' || quote.blockNumber < 0n || typeof quote.usdPriceE18 !== 'bigint' || quote.usdPriceE18 <= 0n) throw new Error('Refresh the pair’s verified USD quote before launching.');
  address(quote.asset.address, 'quote token');
  if (quote.source === 'chainlink') {
    address(quote.feedAddress, 'price feed'); address(quote.asset.feedAddress, 'asset price feed');
    if (!equal(quote.feedAddress, quote.asset.feedAddress)) throw new Error('The quoted pair does not match its price feed.');
  } else if (quote.feedAddress !== null || quote.asset.feedAddress !== null || quote.asset.kind !== 'stock') throw new Error('The issuer quote must identify an official stock without a Chainlink feed.');
  if (currentCatalog) {
    const trusted = getLaunchQuoteAsset(quote.asset.id);
    const sameFeed = trusted.feedAddress === null ? quote.feedAddress === null : quote.feedAddress !== null && equal(trusted.feedAddress, quote.feedAddress);
    if (!equal(trusted.address, quote.asset.address) || !sameFeed || trusted.priceSource !== quote.source || trusted.priceSource !== quote.asset.priceSource
      || trusted.assetId !== quote.asset.assetId || trusted.symbol !== quote.asset.symbol || trusted.name !== quote.asset.name || trusted.kind !== quote.asset.kind) throw new Error('The quoted pair does not match the supported catalog.');
  }
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(quote.usdPrice) || parseUnits(quote.usdPrice, 18) !== quote.usdPriceE18) throw new Error('The quoted oracle price is invalid.');
  const price = Number(quote.usdPrice);
  if (!Number.isFinite(price) || price <= 0 || price > 1e12) throw new Error('The pair’s USD quote is outside the supported range.');
}

export function validateRareLaunchDraft(draft: RareLaunchDraft, now = Date.now()) { validateLaunchDraft(draft, now, true); }

/** One shared catalog is the expected immutable router policy; history limits are unrelated. */
export function verifyRareLaunchQuoteCatalog(quoteTokens: readonly Address[], currentCatalog = true) {
  if (!Array.isArray(quoteTokens) || quoteTokens.length === 0 || quoteTokens.length > 2048) throw new Error('The router quote catalog is invalid.');
  const unique = new Set<string>();
  for (const token of quoteTokens) { address(token, 'quote token'); unique.add(token.toLowerCase()); }
  if (unique.size !== quoteTokens.length) throw new Error('The router quote catalog contains duplicate tokens.');
  if (currentCatalog && (unique.size !== LAUNCH_QUOTE_ASSETS.length || LAUNCH_QUOTE_ASSETS.some(asset => !unique.has(asset.address.toLowerCase())))) throw new Error('The launch router does not support the complete verified quote catalog.');
}

/** Pure preparation: no deploy, approval, premint, signer or hidden developer buy. */
function buildParticipantParams(input: { pet: Pick<PetIdentity, 'walletAddress' | 'contract' | 'tokenId'>; config: RareLaunchConfig; draft: RareLaunchDraft; now?: number }, currentCatalog = true) {
  const { pet, config, draft } = input;
  validateLaunchDraft(draft, input.now, currentCatalog);
  verifyRareLaunchQuoteCatalog(config.quoteTokens, currentCatalog);
  address(pet.walletAddress, 'Rare Wallet'); address(config.router, 'launch router'); address(config.treasury, 'treasury'); address(config.protocol, 'Doppler protocol');
  if (!equal(config.treasury, launchTreasury)) throw new Error('The launch router does not use the confirmed RarePet treasury.');
  if (config.totalSupply !== RARE_LAUNCH_SUPPLY || config.protocolShares !== PROTOCOL_SHARES || ![850n * 10n ** 15n].includes(config.friendShares) || config.friendShares + config.treasuryShares + config.protocolShares !== WAD) throw new Error('The deployed router does not match the reviewed launch policy.');
  if (!config.quoteTokens.some(a => equal(a, draft.quote.asset.address))) throw new Error('This pair is not enabled in the launch router.');
  const feeRecipients = [
    { beneficiary: pet.walletAddress, shares: config.friendShares },
    { beneficiary: config.treasury, shares: config.treasuryShares },
    { beneficiary: config.protocol, shares: config.protocolShares },
  ].sort((a, b) => a.beneficiary.toLowerCase().localeCompare(b.beneficiary.toLowerCase()));
  const beneficiaries: typeof feeRecipients = [];
  for (const entry of feeRecipients) { const previous = beneficiaries.at(-1); if (previous && equal(previous.beneficiary, entry.beneficiary)) previous.shares += entry.shares; else beneficiaries.push({ ...entry }); }
  const salt = keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
    [4663n, config.router, pet.walletAddress, pet.contract, BigInt(pet.tokenId), config.brain + 1n, draft.salt],
  ));
  const params = new MulticurveBuilder(4663)
    .tokenConfig({ type: 'dopplerERC20V1', name: draft.name, symbol: draft.symbol, tokenURI: draft.tokenURI })
    .saleConfig({ initialSupply: RARE_LAUNCH_SUPPLY, numTokensToSell: RARE_LAUNCH_SUPPLY, numeraire: draft.quote.asset.address })
    .withCurves({ numerairePrice: Number(draft.quote.usdPrice), tokenDecimals: 18, numeraireDecimals: 18,
      fee: draft.fee, tickSpacing: TICK_SPACING, beneficiaries,
      curves: [
        { marketCap: { start: 10_000, end: 100_000 }, numPositions: 10, shares: WAD / 2n },
        { marketCap: { start: 100_000, end: 1_000_000 }, numPositions: 10, shares: WAD / 4n },
        { marketCap: { start: 1_000_000, end: 100_000_000 }, numPositions: 10, shares: WAD * 24n / 100n },
        { marketCap: { start: 100_000_000, end: 'max' }, numPositions: 10, shares: WAD / 100n },
      ],
    }).withGovernance({ type: 'noOp' }).withMigration({ type: 'noOp' })
    .withUserAddress(pet.walletAddress).withIntegrator(config.treasury).withSalt(salt)
    .withDopplerHookInitializer(RARE_LAUNCH_DOPPLER.initializer)
    .withTokenFactory(RARE_LAUNCH_DOPPLER.tokenFactory).withGovernanceFactory(RARE_LAUNCH_DOPPLER.governance)
    .withNoOpMigrator(RARE_LAUNCH_DOPPLER.migrator).build();
  const farTick = Math.max(...params.pool.curves.map(c => c.tickUpper)) - TICK_SPACING;
  const request: RareLaunchRequest = { name: draft.name, symbol: draft.symbol, tokenURI: draft.tokenURI, quote: draft.quote.asset.address, fee: draft.fee, curves: params.pool.curves, farTick, salt: draft.salt };
  const initialTick = Math.min(...params.pool.curves.map(c => c.tickLower));
  const review: RareLaunchReview = { name: draft.name, symbol: draft.symbol, tokenURI: draft.tokenURI, wallet: pet.walletAddress, router: config.router, supply: RARE_LAUNCH_SUPPLY,
    startMarketCapUSD: RARE_LAUNCH_START_USD, approximateStartMarketCapUSD: 1.0001 ** initialTick * 1e9 * Number(draft.quote.usdPrice), quote: draft.quote, fee: draft.fee,
    treasury: config.treasury, protocol: config.protocol, friendShares: config.friendShares, treasuryShares: config.treasuryShares, protocolShares: config.protocolShares };
  return immutable({ params, request, review });
}

export function buildRareLaunchParams(input: { pet: PetIdentity; config: RareLaunchConfig; draft: RareLaunchDraft; now?: number }) { return buildParticipantParams(input); }
export function buildRareSelfLaunchParams(input: { account: Address; config: RareLaunchConfig; draft: RareLaunchDraft; now?: number }) { return buildParticipantParams({ ...input, pet: { walletAddress: input.account, contract: zeroAddress, tokenId: '0' } }); }

async function defaultDependencies(): Promise<RareLaunchDependencies> {
  const { createPetPublicClient, verifyPet } = await import('./wallet');
  return { client: createPetPublicClient(), verifyIdentity: (pet, owner) => verifyPet(pet.collection, pet.tokenId, owner) };
}
async function readLaunchConfig(router: Address, identity: { account: Address; pet?: PetIdentity }, injected?: Pick<RareLaunchDependencies, 'client'>): Promise<RareLaunchConfig> {
  address(router, 'deployed launch router'); address(identity.account, 'launch creator');
  const pet = identity.pet;
  const { client } = injected ?? await defaultDependencies();
  if (await client.getChainId() !== 4663) throw new Error('Launches require Robinhood mainnet (4663).');
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [block, code] = await Promise.all([client.getBlock({ blockNumber }), client.getCode({ address: router, blockNumber })]);
  if (!block.hash || !code || code === '0x') throw new Error('The Rare Launchpad router is not deployed on Robinhood yet.');
  const read = <N extends 'CHAIN_ID' | 'AIRLOCK' | 'TOKEN_FACTORY' | 'INITIALIZER' | 'GOVERNANCE' | 'MIGRATOR' | 'treasury' | 'totalSupply' | 'friendShares' | 'treasuryShares' | 'quoteTokens'>(functionName: N) => client.readContract({ address: router, abi: RARE_LAUNCH_ROUTER_ABI, functionName, blockNumber });
  const [chain, airlock, tokenFactory, initializer, governance, migrator, treasury, totalSupply, friendShares, treasuryShares, quoteTokens, state, protocol] = await Promise.all([
    read('CHAIN_ID'), read('AIRLOCK'), read('TOKEN_FACTORY'), read('INITIALIZER'), read('GOVERNANCE'), read('MIGRATOR'),
    read('treasury'), read('totalSupply'), read('friendShares'), read('treasuryShares'), read('quoteTokens'),
    pet ? client.readContract({ address: router, abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'getLaunch', args: [pet.contract, BigInt(pet.tokenId)], blockNumber })
      : client.readContract({ address: router, abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'selfLaunchCount', args: [identity.account], blockNumber }).then(brain => ({ brain, lastLaunchAt: 0n, hasLaunched: false })),
    client.readContract({ address: RARE_LAUNCH_DOPPLER.airlock, abi: READ_ABI, functionName: 'owner', blockNumber }),
  ]);
  if (chain !== 4663n || !equal(airlock, RARE_LAUNCH_DOPPLER.airlock) || !equal(tokenFactory, RARE_LAUNCH_DOPPLER.tokenFactory) || !equal(initializer, RARE_LAUNCH_DOPPLER.initializer) || !equal(governance, RARE_LAUNCH_DOPPLER.governance) || !equal(migrator, RARE_LAUNCH_DOPPLER.migrator)) throw new Error('The launch router does not use the verified Doppler modules.');
  const states = await Promise.all([[tokenFactory, 1], [governance, 2], [initializer, 3], [migrator, 4]].map(async ([module, expected]) => {
    const actual = await client.readContract({ address: airlock, abi: READ_ABI, functionName: 'getModuleState', args: [module as Address], blockNumber });
    return actual === expected;
  }));
  if (states.some(value => !value)) throw new Error('A required Doppler module is no longer enabled.');
  verifyRareLaunchQuoteCatalog(quoteTokens);
  address(treasury, 'treasury'); address(protocol, 'Doppler protocol');
  if (!equal(treasury, launchTreasury)) throw new Error('The launch router does not use the confirmed RarePet treasury.');
  if (totalSupply !== RARE_LAUNCH_SUPPLY || ![850n * 10n ** 15n].includes(friendShares) || friendShares + treasuryShares + PROTOCOL_SHARES !== WAD) throw new Error('The launch router has an unsupported supply or fee split.');
  const current = await client.getBlock({ blockNumber });
  if (await client.getChainId() !== 4663 || current.hash !== block.hash) throw new Error('The launch configuration changed while verifying its block. Retry.');
  return immutable({ router, treasury, protocol, totalSupply, friendShares, treasuryShares, protocolShares: PROTOCOL_SHARES,
    quoteTokens, brain: state.brain, lastLaunchAt: state.lastLaunchAt, hasLaunched: state.hasLaunched,
    readyAt: state.hasLaunched ? state.lastLaunchAt + 86400n : 0n, blockNumber, timestamp: block.timestamp });
}
export async function readRareLaunchConfig(router: Address, pet: PetIdentity, injected?: Pick<RareLaunchDependencies, 'client'>) { address(pet.walletAddress, 'Rare Wallet'); return readLaunchConfig(router, { account: pet.walletAddress, pet }, injected); }
export async function readRareSelfLaunchConfig(router: Address, account: Address, injected?: Pick<RareLaunchDependencies, 'client'>) { return readLaunchConfig(router, { account }, injected); }

async function verifiedSession(options: SessionOptions, deps: RareLaunchDependencies, requireSigner: boolean) {
  const { session, pet, revision } = options;
  address(pet.walletAddress, 'Rare Wallet'); address(pet.owner, 'owner');
  if (pet.chainId !== 4663 || pet.collection === 'generations' && !(pet.generation && pet.generation > 0)) throw new Error('Choose a Genesis or hardwired Generations Friend.');
  const wallet = pet.walletAddress, provider = session.getProvider();
  if (!provider) throw new Error('Reconnect your wallet.');
  const assert = () => {
    options.assertActive?.();
    const state = session.getSnapshot();
    if (state.revision !== revision || state.status !== 'connected' || state.chainId !== 4663 || !state.account || !equal(state.account, pet.owner) || session.getProvider() !== provider) throw new Error('Your wallet or selected Friend changed. Open Launch again.');
  };
  assert();
  if (await deps.client.getChainId() !== 4663) throw new Error('Use Robinhood mainnet (4663).');
  const fresh = await deps.verifyIdentity(pet, pet.owner); assert();
  if (fresh.chainId !== 4663 || fresh.collection !== pet.collection || !equal(fresh.contract, pet.contract) || fresh.tokenId !== pet.tokenId || !equal(fresh.owner, pet.owner) || !fresh.walletAddress || !equal(fresh.walletAddress, wallet)) throw new Error('Friend ownership or its canonical wallet changed.');
  const [code, owner, binding] = await Promise.all([
    deps.client.getCode({ address: wallet }), deps.client.readContract({ address: wallet, abi: RARE_WALLET_ABI, functionName: 'owner' }),
    deps.client.readContract({ address: wallet, abi: RARE_WALLET_ABI, functionName: 'token' }),
  ]); assert();
  if (!code || code === '0x' || !equal(owner, pet.owner) || binding[0] !== 4663n || !equal(binding[1], pet.contract) || binding[2] !== BigInt(pet.tokenId)) throw new Error('The Rare Wallet’s owner or NFT binding could not be verified.');
  let signer = deps.signer;
  if (requireSigner && !signer) {
    const { RARE_PET_CHAIN } = await import('./wallet'); assert();
    signer = createWalletClient({ account: pet.owner, chain: RARE_PET_CHAIN, transport: custom(provider) });
  }
  const assertSigner = async () => {
    assert();
    if (signer) {
      const [chain, addresses, publicChain] = await Promise.all([signer.getChainId(), signer.getAddresses(), deps.client.getChainId()]); assert();
      if (chain !== 4663 || publicChain !== 4663 || signer.chain?.id !== 4663 || !addresses[0] || !equal(addresses[0], pet.owner)) throw new Error('Use the selected owner wallet on Robinhood mainnet.');
    }
  };
  await assertSigner();
  return { wallet, assert, assertSigner, signer };
}
function launchCall(wallet: Address, router: Address, request: RareLaunchRequest) {
  const inner = encodeFunctionData({ abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'launch', args: [request] });
  const args = [router, 0n, inner, 0] as const;
  return { address: wallet, abi: RARE_WALLET_ABI, functionName: 'execute' as const, args, value: 0n,
    data: encodeFunctionData({ abi: RARE_WALLET_ABI, functionName: 'execute', args }) };
}
function sameConfig(a: RareLaunchConfig, b: RareLaunchConfig) {
  return equal(a.router, b.router) && equal(a.treasury, b.treasury) && equal(a.protocol, b.protocol) && a.friendShares === b.friendShares && a.treasuryShares === b.treasuryShares && a.totalSupply === b.totalSupply && a.brain === b.brain && a.lastLaunchAt === b.lastLaunchAt && a.hasLaunched === b.hasLaunched;
}
function verifyPreparedDoppler(prepared: PreparedMulticurveCreate<4663>, params: CreateMulticurveParams<4663>, router: Address, client: ReadClient) {
  const expected: CreateParams = new DopplerSDK<4663>({ chainId: 4663, publicClient: client as PublicClient }).factory.encodeCreateMulticurveParams(params);
  const data = encodeFunctionData({ abi: airlockAbi, functionName: 'create', args: [expected] });
  if (prepared.chainId !== 4663 || !equal(prepared.account, router) || !equal(prepared.airlock, RARE_LAUNCH_DOPPLER.airlock) || !equal(prepared.transaction.to, RARE_LAUNCH_DOPPLER.airlock) || prepared.transaction.value !== 0n || !equal(prepared.transaction.data, data) || prepared.approvalTransaction || prepared.devBuy) throw new Error('Doppler prepared unexpected launch calldata.');
  const ownData = encodeFunctionData({ abi: airlockAbi, functionName: 'create', args: [prepared.createParams] });
  if (!equal(ownData, data) || !equal(prepared.prediction.tokenAddress, prepared.prediction.poolOrHookAddress) || !equal(prepared.prediction.governanceAddress, RARE_LAUNCH_DOPPLER.dead) || !equal(prepared.prediction.timelockAddress, RARE_LAUNCH_DOPPLER.dead) || !prepared.prediction.migrationPoolAddress || !equal(prepared.prediction.migrationPoolAddress, RARE_LAUNCH_DOPPLER.migrationDead) || !equal(prepared.prediction.poolKey.hooks, RARE_LAUNCH_DOPPLER.initializer) || prepared.prediction.poolKey.fee !== params.pool.fee || prepared.prediction.poolKey.tickSpacing !== TICK_SPACING || !equal(computePoolId(prepared.prediction.poolKey), prepared.prediction.poolId)) throw new Error('Doppler predicted an unexpected market.');
  address(prepared.prediction.tokenAddress, 'predicted token');
  const currencies = [prepared.prediction.poolKey.currency0, prepared.prediction.poolKey.currency1].map(a => a.toLowerCase()).sort();
  if (currencies.join() !== [prepared.prediction.tokenAddress, params.sale.numeraire].map(a => a.toLowerCase()).sort().join()) throw new Error('Doppler predicted the wrong trading pair.');
}
export async function prepareRareLaunch(options: SessionOptions & { router: Address; draft: RareLaunchDraft }, injected?: RareLaunchDependencies): Promise<PreparedRareLaunch> {
  const deps = injected ?? await defaultDependencies();
  const frozen = { ...options, pet: immutable(structuredClone(options.pet)), draft: immutable(structuredClone(options.draft)) };
  const connection = await verifiedSession(frozen, deps, false);
  const config = await readRareLaunchConfig(options.router, frozen.pet, deps); connection.assert();
  if (config.readyAt > config.timestamp) throw new Error(`This Friend can launch again at ${new Date(Number(config.readyAt) * 1000).toLocaleString()}.`);
  const built = buildRareLaunchParams({ pet: frozen.pet, config, draft: frozen.draft, now: deps.now?.() });
  const prepared = deps.prepare
    ? await deps.prepare(built.params, config.router)
    : await new DopplerSDK<4663>({ chainId: 4663, publicClient: deps.client as PublicClient }).factory.prepareCreateMulticurve(built.params, { account: config.router });
  connection.assert(); validateRareLaunchDraft(frozen.draft, deps.now?.());
  verifyPreparedDoppler(prepared, built.params, config.router, deps.client);
  const call = launchCall(connection.wallet, config.router, built.request);
  const simulation = await deps.client.simulateContract({ account: frozen.pet.owner, ...call }); connection.assert();
  const [simulatedAsset] = decodeAbiParameters([{ type: 'address' }], simulation.result);
  if (!equal(simulatedAsset, prepared.prediction.tokenAddress)) throw new Error('The router simulation does not match the predicted launch.');
  let gasEstimate: bigint | null = null;
  try { gasEstimate = await deps.client.estimateContractGas({ account: frozen.pet.owner, ...call }); } catch { /* The full exact execution simulation above is mandatory. */ }
  connection.assert(); validateRareLaunchDraft(frozen.draft, deps.now?.());
  return immutable({ mode: 'friend' as const, pet: frozen.pet, revision: frozen.revision, config, draft: frozen.draft, request: built.request, review: built.review, doppler: structuredClone(prepared), data: call.data, gasEstimate, preparedAt: (deps.now ?? Date.now)() });
}

export class RareLaunchTransactionError extends Error {
  readonly transactionHash: Hex;
  readonly code: 'unconfirmed' | 'reverted' | 'replaced' | 'unverified' | 'reorg';
  constructor(code: RareLaunchTransactionError['code'], hash: Hex, message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'RareLaunchTransactionError'; this.code = code; this.transactionHash = hash;
  }
}
function receiptStatus(receipt: TransactionReceipt, hash: Hex) {
  if (!equal(receipt.transactionHash, hash)) throw new RareLaunchTransactionError('replaced', hash, 'The transaction was replaced. Inspect it before retrying.');
  if (receipt.status !== 'success') throw new RareLaunchTransactionError('reverted', hash, 'The transaction reverted. No launch or claim was confirmed.');
}
export function verifyRareLaunchReceipt(receipt: TransactionReceipt, hash: Hex, prepared: PreparedRareLaunch) {
  receiptStatus(receipt, hash);
  const { pet, config, draft, doppler } = prepared;
  const records = parseEventLogs({ abi: RARE_LAUNCH_ROUTER_ABI, eventName: 'LaunchRecorded', strict: true,
    logs: receipt.logs.filter(log => equal(log.address, config.router)) });
  const matches = records.filter(({ args }) => equal(args.collection, pet.contract) && args.tokenId === BigInt(pet.tokenId)
    && equal(args.asset, doppler.prediction.tokenAddress) && equal(args.friendWallet, pet.walletAddress!) && equal(args.owner, pet.owner)
    && equal(args.quote, draft.quote.asset.address) && args.fee === draft.fee && equal(args.metadataHash, keccak256(stringToHex(draft.tokenURI))));
  const creates = parseEventLogs({ abi: airlockAbi, eventName: 'Create', strict: true,
    logs: receipt.logs.filter(log => equal(log.address, RARE_LAUNCH_DOPPLER.airlock)) });
  if (matches.length !== 1 || !creates.some(({ args }) => equal(args.asset, doppler.prediction.tokenAddress)
    && equal(args.numeraire, draft.quote.asset.address) && equal(args.initializer, RARE_LAUNCH_DOPPLER.initializer)
    && equal(args.poolOrHook, doppler.prediction.poolOrHookAddress))) throw new RareLaunchTransactionError('unverified', hash, 'The exact RarePet launch and Doppler market could not be verified. Inspect the transaction before retrying.');
  return matches[0].args;
}
async function verifyMinedCall(client: ReadClient, receipt: TransactionReceipt, hash: Hex, owner: Address, wallet: Address, data: Hex) {
  const [tx, block, chain] = await Promise.all([client.getTransaction({ hash }), client.getBlock({ blockNumber: receipt.blockNumber }), client.getChainId()]);
  if (chain !== 4663 || !block.hash || !equal(block.hash, receipt.blockHash)) throw new RareLaunchTransactionError('reorg', hash, 'The receipt block is no longer verified on Robinhood. Inspect it before retrying.');
  if (!equal(tx.hash, hash) || !tx.to || !equal(tx.to, wallet) || !equal(tx.from, owner) || tx.value !== 0n || !equal(tx.input, data) || tx.blockNumber !== receipt.blockNumber || !tx.blockHash || !equal(tx.blockHash, receipt.blockHash)) throw new RareLaunchTransactionError('unverified', hash, 'The mined transaction does not match the reviewed Rare Wallet call.');
}
/** Read-only receipt recovery; it never resubmits a launch. */
export async function confirmRareLaunch(hash: Hex, prepared: PreparedRareLaunch, injected?: Pick<RareLaunchDependencies, 'client'>) {
  const { client } = injected ?? await defaultDependencies();
  let receipt: TransactionReceipt;
  try { receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 }); }
  catch (cause) { throw new RareLaunchTransactionError('unconfirmed', hash, 'Launch submitted; confirmation is still unknown. Recheck the transaction before starting another launch.', { cause }); }
  await verifyMinedCall(client, receipt, hash, prepared.pet.owner, prepared.pet.walletAddress!, prepared.data);
  const event = verifyRareLaunchReceipt(receipt, hash, prepared);
  try {
    const [recorded, state, pool] = await Promise.all([
      client.readContract({ address: prepared.config.router, abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'launchedAsset', args: [event.asset], blockNumber: receipt.blockNumber }),
      client.readContract({ address: prepared.config.router, abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'getLaunch', args: [prepared.pet.contract, BigInt(prepared.pet.tokenId)], blockNumber: receipt.blockNumber }),
      client.readContract({ address: RARE_LAUNCH_DOPPLER.initializer, abi: dopplerHookInitializerAbi, functionName: 'getState', args: [event.asset], blockNumber: receipt.blockNumber }),
    ]);
    if (!recorded || !state.hasLaunched || state.brain < prepared.config.brain + 1n || state.lastLaunchAt < event.timestamp || pool[4] !== 2 || !equal(pool[0], prepared.draft.quote.asset.address) || pool[1] !== RARE_LAUNCH_SUPPLY || !equal(pool[2], zeroAddress) || !equal(computePoolId(pool[5]), prepared.doppler.prediction.poolId)) throw new Error('Launch ledger or permanent pool mismatch.');
  } catch (cause) { throw new RareLaunchTransactionError('unverified', hash, 'The transaction was mined, but its launch ledger and pool state could not be verified. Do not repeat it to refresh.', { cause }); }
  await verifyMinedCall(client, receipt, hash, prepared.pet.owner, prepared.pet.walletAddress!, prepared.data);
  return immutable({ hash, asset: event.asset, poolId: prepared.doppler.prediction.poolId, timestamp: event.timestamp, brain: prepared.config.brain + 1n });
}
export async function sendRareLaunch(options: SessionOptions & { prepared: PreparedRareLaunch; onHash: (hash: Hex) => void }, injected?: RareLaunchDependencies) {
  if (active.has(options.session)) throw new Error('A Rare Launchpad transaction is already pending.');
  active.add(options.session);
  try {
    const deps = injected ?? await defaultDependencies();
    const prepared = immutable(structuredClone(options.prepared));
    if (prepared.revision !== options.revision || prepared.pet.tokenId !== options.pet.tokenId || !equal(prepared.pet.contract, options.pet.contract) || !equal(prepared.pet.owner, options.pet.owner) || !prepared.pet.walletAddress || !options.pet.walletAddress || !equal(prepared.pet.walletAddress, options.pet.walletAddress)) throw new Error('The reviewed launch belongs to another wallet or Friend.');
    const connection = await verifiedSession(options, deps, true);
    const current = await readRareLaunchConfig(prepared.config.router, prepared.pet, deps); connection.assert();
    if (!sameConfig(prepared.config, current) || current.readyAt > current.timestamp) throw new Error('The launch configuration or daily limit changed. Prepare a new review.');
    const built = buildRareLaunchParams({ pet: prepared.pet, config: current, draft: prepared.draft, now: deps.now?.() });
    const call = launchCall(connection.wallet, current.router, built.request);
    if (!equal(call.data, prepared.data)) throw new Error('The launch calldata changed after review.');
    verifyPreparedDoppler(prepared.doppler, built.params, current.router, deps.client);
    const simulation = await deps.client.simulateContract({ account: prepared.pet.owner, ...call }); connection.assert();
    const [asset] = decodeAbiParameters([{ type: 'address' }], simulation.result);
    if (!equal(asset, prepared.doppler.prediction.tokenAddress)) throw new Error('The launch prediction changed. Prepare a new review.');
    await validateCurrentQuote(prepared.draft, deps);
    await connection.assertSigner(); validateRareLaunchDraft(prepared.draft, deps.now?.()); connection.assert();
    options.onWalletRequest?.();
    const hash = await connection.signer!.writeContract({ account: prepared.pet.owner, chain: connection.signer!.chain, address: call.address, abi: call.abi, functionName: call.functionName, args: call.args, value: 0n });
    options.onHash(hash);
    return await confirmRareLaunch(hash, prepared, deps);
  } finally { active.delete(options.session); }
}

export type RareLaunchPendingFees = Readonly<{
  asset: Address; wallet: Address; poolId: Hex; shares: bigint; blockNumber: bigint;
  token0: Address; token1: Address; amount0: bigint; amount1: bigint;
}>;
/** Exact beneficiary earnings, including uncollected fees, simulated at one pinned block. */
export async function readRareLaunchFees(input: { asset: Address; wallet: Address }, injected?: Pick<RareLaunchDependencies, 'client'>): Promise<RareLaunchPendingFees> {
  address(input.asset, 'launched token'); address(input.wallet, 'Rare Wallet');
  const { client } = injected ?? await defaultDependencies();
  if (await client.getChainId() !== 4663) throw new Error('Fee claims require Robinhood mainnet.');
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const block = await client.getBlock({ blockNumber });
  const state = await client.readContract({ address: RARE_LAUNCH_DOPPLER.initializer, abi: dopplerHookInitializerAbi, functionName: 'getState', args: [input.asset], blockNumber });
  if (state[4] !== 2 || !equal(state[5].hooks, RARE_LAUNCH_DOPPLER.initializer) || ![state[5].currency0, state[5].currency1].some(a => equal(a, input.asset))) throw new Error('This token does not have a locked Doppler multicurve pool.');
  const poolId = computePoolId(state[5]);
  const read = (functionName: 'getCumulatedFees0' | 'getCumulatedFees1') => client.readContract({ address: RARE_LAUNCH_DOPPLER.initializer, abi: READ_ABI, functionName, args: [poolId], blockNumber });
  const readFor = (functionName: 'getShares' | 'getLastCumulatedFees0' | 'getLastCumulatedFees1') => client.readContract({ address: RARE_LAUNCH_DOPPLER.initializer, abi: READ_ABI, functionName, args: [poolId, input.wallet], blockNumber });
  const [shares, cum0, cum1, last0, last1, simulation] = await Promise.all([
    readFor('getShares'), read('getCumulatedFees0'), read('getCumulatedFees1'), readFor('getLastCumulatedFees0'), readFor('getLastCumulatedFees1'),
    client.simulateContract({ address: RARE_LAUNCH_DOPPLER.initializer, abi: READ_ABI, functionName: 'collectFees', args: [poolId], account: input.wallet, blockNumber }),
  ]);
  if (shares <= 0n || shares > WAD || last0 > cum0 || last1 > cum1) throw new Error('This Rare Wallet has no valid fee allocation for that pool.');
  const current = await client.getBlock({ blockNumber });
  if (!block.hash || current.hash !== block.hash || await client.getChainId() !== 4663) throw new Error('The fee read block changed. Refresh fees.');
  return immutable({ asset: input.asset, wallet: input.wallet, poolId, shares, blockNumber, token0: state[5].currency0, token1: state[5].currency1,
    amount0: (cum0 + simulation.result[0] - last0) * shares / WAD,
    amount1: (cum1 + simulation.result[1] - last1) * shares / WAD });
}
export async function claimRareLaunchFees(options: SessionOptions & { asset: Address; onHash: (hash: Hex) => void }, injected?: RareLaunchDependencies) {
  if (active.has(options.session)) throw new Error('A Rare Launchpad transaction is already pending.');
  active.add(options.session);
  try {
    const deps = injected ?? await defaultDependencies();
    const connection = await verifiedSession(options, deps, true);
    const fees = await readRareLaunchFees({ asset: options.asset, wallet: connection.wallet }, deps); connection.assert();
    if (fees.amount0 === 0n && fees.amount1 === 0n) throw new Error('There are no fees available to claim yet.');
    const inner = encodeFunctionData({ abi: READ_ABI, functionName: 'collectFees', args: [fees.poolId] });
    const args = [RARE_LAUNCH_DOPPLER.initializer, 0n, inner, 0] as const;
    const data = encodeFunctionData({ abi: RARE_WALLET_ABI, functionName: 'execute', args });
    await deps.client.simulateContract({ account: options.pet.owner, address: connection.wallet, abi: RARE_WALLET_ABI, functionName: 'execute', args, value: 0n });
    await connection.assertSigner(); connection.assert();
    options.onWalletRequest?.();
    const hash = await connection.signer!.writeContract({ account: options.pet.owner, chain: connection.signer!.chain, address: connection.wallet, abi: RARE_WALLET_ABI, functionName: 'execute', args, value: 0n });
    options.onHash(hash);
    let receipt: TransactionReceipt;
    try { receipt = await deps.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 }); }
    catch (cause) { throw new RareLaunchTransactionError('unconfirmed', hash, 'Claim submitted; its confirmation is still unknown. Inspect it before retrying.', { cause }); }
    await verifyMinedCall(deps.client, receipt, hash, options.pet.owner, connection.wallet, data);
    receiptStatus(receipt, hash);
    const releases = parseEventLogs({ abi: READ_ABI, eventName: 'Release', strict: true, logs: receipt.logs.filter(log => equal(log.address, RARE_LAUNCH_DOPPLER.initializer)) })
      .filter(({ args: event }) => equal(event.poolId, fees.poolId) && equal(event.beneficiary, connection.wallet));
    if (releases.length !== 1) throw new RareLaunchTransactionError('unverified', hash, 'The beneficiary fee release could not be verified. Inspect the claim before retrying.');
    return { hash, poolId: fees.poolId, amount0: releases[0].args.fees0, amount1: releases[0].args.fees1, token0: fees.token0, token1: fees.token1 };
  } finally { active.delete(options.session); }
}

export type RareLaunchHistoryItem = Readonly<{ asset: Address; hash: Hex; timestamp: bigint; quote: Address; fee: number }>;
/** Only this router's indexed collection/id events; failure is never an empty history. */
export async function readRareLaunchHistory(input: { router: Address; pet: PetIdentity; signal?: AbortSignal }, injected?: Pick<RareLaunchDependencies, 'client'>) {
  address(input.router, 'launch router'); address(input.pet.walletAddress, 'Rare Wallet');
  const { client } = injected ?? await defaultDependencies();
  input.signal?.throwIfAborted();
  const config = await readRareLaunchConfig(input.router, input.pet, { client });
  input.signal?.throwIfAborted();
  const block = await client.getBlock({ blockNumber: config.blockNumber });
  const event = RARE_LAUNCH_ROUTER_ABI.find(item => item.type === 'event' && item.name === 'LaunchRecorded')!;
  const logs = await client.getLogs({ address: input.router, event, args: { collection: input.pet.contract, tokenId: BigInt(input.pet.tokenId) }, fromBlock: 0n, toBlock: config.blockNumber, strict: true });
  input.signal?.throwIfAborted();
  if (logs.length > 500) throw new Error('This Friend’s launch history exceeds the supported limit. Use the chain explorer for its complete history.');
  const items: RareLaunchHistoryItem[] = [], seen = new Set<string>();
  for (const log of logs) {
    const a = log.args;
    if (!equal(log.address, input.router) || log.removed || log.blockNumber === null || log.blockNumber > config.blockNumber || !log.transactionHash || log.logIndex === null
      || !equal(a.collection, input.pet.contract) || a.tokenId !== BigInt(input.pet.tokenId) || !equal(a.friendWallet, input.pet.walletAddress)
      || !isAddress(a.asset) || equal(a.asset, zeroAddress) || !config.quoteTokens.some(q => equal(q, a.quote)) || !RARE_LAUNCH_FEES.includes(a.fee as RareLaunchFee)
      || a.timestamp <= 0n || a.timestamp > config.timestamp) throw new Error('The launch history contains an invalid event. Retry its chain read.');
    const key = a.asset.toLowerCase();
    if (seen.has(key)) throw new Error('The launch history contains a duplicate asset.');
    seen.add(key); items.push({ asset: a.asset, hash: log.transactionHash, timestamp: a.timestamp, quote: a.quote, fee: a.fee });
  }
  if (BigInt(items.length) !== config.brain) throw new Error('The launch history is incomplete. Retry or inspect the chain explorer.');
  const current = await client.getBlock({ blockNumber: config.blockNumber });
  if (current.hash !== block.hash || await client.getChainId() !== 4663) throw new Error('The launch history block changed. Retry.');
  input.signal?.throwIfAborted();
  return immutable({ items: items.sort((a, b) => a.timestamp === b.timestamp ? 0 : a.timestamp > b.timestamp ? -1 : 1), blockNumber: config.blockNumber, incomplete: false as const });
}

/** Strict storage boundary: recompute every reviewed instruction without making network calls. */
export function validateStoredRareLaunch(wallet: Address, value: unknown): PreparedRareLaunch {
  if (!value || typeof value !== 'object') throw new Error('Invalid stored launch.');
  const p = value as PreparedRareLaunch;
  address(wallet, 'Rare Wallet'); address(p.pet?.owner, 'owner'); address(p.pet?.contract, 'collection'); address(p.pet?.walletAddress, 'Rare Wallet');
  if (p.mode !== 'friend' || !equal(p.pet.walletAddress, wallet) || p.pet.chainId !== 4663 || !/^[1-9][0-9]{0,77}$/.test(p.pet.tokenId)
    || (p.pet.collection !== 'genesis' && p.pet.collection !== 'generations') || !Number.isSafeInteger(p.revision)
    || !Number.isSafeInteger(p.preparedAt) || !/^0x[0-9a-fA-F]+$/.test(p.data) || p.data.length > 60000) throw new Error('Stored launch identity is invalid.');
  const expectedCollection = p.pet.collection === 'genesis' ? '0x116EaA62241751E0c98dA43d458600c6C17cD361' : '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D';
  if (!equal(p.pet.contract, expectedCollection) || p.pet.collection === 'generations' && !(p.pet.generation && p.pet.generation > 0)) throw new Error('Stored collection binding is invalid.');
  if (typeof p.config?.brain !== 'bigint' || p.config.brain < 0n || typeof p.config.lastLaunchAt !== 'bigint' || p.config.lastLaunchAt < 0n) throw new Error('Stored launch ledger is invalid.');
  // Old catalog snapshots are valid recovery evidence, but sendRareLaunch always uses today's catalog.
  const built = buildParticipantParams({ pet: p.pet, config: p.config, draft: p.draft, now: p.preparedAt }, false);
  const expected = launchCall(wallet, p.config.router, built.request);
  if (!equal(expected.data, p.data) || !equal(launchCall(wallet, p.config.router, p.request).data, expected.data)) throw new Error('Stored launch calldata was altered.');
  // Encoding is pure; this SDK client is never used for a network call here.
  verifyPreparedDoppler(p.doppler, built.params, p.config.router, {} as ReadClient);
  return immutable({ ...p, review: built.review, request: built.request });
}

async function validateCurrentQuote(draft: RareLaunchDraft, deps: RareLaunchDependencies) {
  const fresh = await (deps.refreshQuote ?? readLaunchQuotePrice)(draft.quote.asset.id);
  validateRareLaunchDraft({ ...draft, quote: fresh }, deps.now?.());
  if (fresh.usdPriceE18 !== draft.quote.usdPriceE18 || !equal(fresh.asset.address, draft.quote.asset.address)) throw new Error('The pair’s USD price changed. Prepare a new review before launching.');
}
type SelfSessionOptions = Readonly<{ session: PetWalletSession; account: Address; revision: number; assertActive?: () => void; onWalletRequest?: () => void }>;
async function verifiedSelfSession(options: SelfSessionOptions, deps: RareLaunchDependencies, requireSigner: boolean) {
  address(options.account, 'creator'); const provider = options.session.getProvider();
  if (!provider) throw new Error('Reconnect your wallet.');
  const assert = () => {
    options.assertActive?.(); const state = options.session.getSnapshot();
    if (state.revision !== options.revision || state.status !== 'connected' || state.chainId !== 4663 || !state.account || !equal(state.account, options.account) || options.session.getProvider() !== provider) throw new Error('Your connected wallet changed. Prepare a new launch review.');
  };
  assert(); if (await deps.client.getChainId() !== 4663) throw new Error('Use Robinhood mainnet.'); assert();
  let signer = deps.signer;
  if (requireSigner && !signer) {
    const { RARE_PET_CHAIN } = await import('./wallet'); assert();
    signer = createWalletClient({ account: options.account, chain: RARE_PET_CHAIN, transport: custom(provider) });
  }
  const assertSigner = async () => {
    assert(); if (!signer) return;
    const [chain, accounts, publicChain] = await Promise.all([signer.getChainId(), signer.getAddresses(), deps.client.getChainId()]); assert();
    if (chain !== 4663 || publicChain !== 4663 || signer.chain?.id !== 4663 || !accounts[0] || !equal(accounts[0], options.account)) throw new Error('Use the reviewed creator wallet on Robinhood mainnet.');
  };
  await assertSigner(); return { assert, assertSigner, signer };
}
function selfLaunchCall(router: Address, request: RareLaunchRequest) {
  const args = [request] as const;
  return { address: router, abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'launchAsSelf' as const, args,
    data: encodeFunctionData({ abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'launchAsSelf', args }) };
}
export async function prepareRareSelfLaunch(options: SelfSessionOptions & { router: Address; draft: RareLaunchDraft }, injected?: RareLaunchDependencies): Promise<PreparedRareSelfLaunch> {
  const deps = injected ?? await defaultDependencies(), draft = immutable(structuredClone(options.draft));
  const connection = await verifiedSelfSession(options, deps, false);
  const config = await readRareSelfLaunchConfig(options.router, options.account, deps); connection.assert();
  const built = buildRareSelfLaunchParams({ account: options.account, config, draft, now: deps.now?.() });
  const doppler = deps.prepare ? await deps.prepare(built.params, config.router)
    : await new DopplerSDK<4663>({ chainId: 4663, publicClient: deps.client as PublicClient }).factory.prepareCreateMulticurve(built.params, { account: config.router });
  connection.assert(); validateRareLaunchDraft(draft, deps.now?.()); verifyPreparedDoppler(doppler, built.params, config.router, deps.client);
  const call = selfLaunchCall(config.router, built.request);
  const simulation = await deps.client.simulateContract({ account: options.account, ...call }); connection.assert();
  if (!equal(simulation.result, doppler.prediction.tokenAddress)) throw new Error('Self launch simulation differs from the predicted token.');
  let gasEstimate: bigint | null = null;
  try { gasEstimate = await deps.client.estimateContractGas({ account: options.account, ...call }); } catch { /* Exact simulation is required above. */ }
  connection.assert(); validateRareLaunchDraft(draft, deps.now?.());
  return immutable({ mode: 'self', account: options.account, revision: options.revision, config, draft, review: built.review, request: built.request, doppler: structuredClone(doppler), data: call.data, gasEstimate, preparedAt: (deps.now ?? Date.now)() });
}
export function verifyRareSelfLaunchReceipt(receipt: TransactionReceipt, hash: Hex, prepared: PreparedRareSelfLaunch) {
  receiptStatus(receipt, hash);
  const events = parseEventLogs({ abi: RARE_LAUNCH_ROUTER_ABI, eventName: 'SelfLaunchRecorded', strict: true,
    logs: receipt.logs.filter(log => equal(log.address, prepared.config.router)) });
  const matches = events.filter(({ args }) => equal(args.creator, prepared.account) && equal(args.asset, prepared.doppler.prediction.tokenAddress)
    && equal(args.quote, prepared.draft.quote.asset.address) && args.fee === prepared.draft.fee && equal(args.metadataHash, keccak256(stringToHex(prepared.draft.tokenURI))));
  const creates = parseEventLogs({ abi: airlockAbi, eventName: 'Create', strict: true,
    logs: receipt.logs.filter(log => equal(log.address, RARE_LAUNCH_DOPPLER.airlock)) });
  if (matches.length !== 1 || !creates.some(({ args }) => equal(args.asset, prepared.doppler.prediction.tokenAddress) && equal(args.numeraire, prepared.draft.quote.asset.address)
    && equal(args.initializer, RARE_LAUNCH_DOPPLER.initializer) && equal(args.poolOrHook, prepared.doppler.prediction.poolOrHookAddress))) throw new RareLaunchTransactionError('unverified', hash, 'The exact creator launch and Doppler market could not be verified.');
  return matches[0].args;
}
export async function confirmRareSelfLaunch(hash: Hex, prepared: PreparedRareSelfLaunch, injected?: Pick<RareLaunchDependencies, 'client'>) {
  const { client } = injected ?? await defaultDependencies(); let receipt: TransactionReceipt;
  try { receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 }); }
  catch (cause) { throw new RareLaunchTransactionError('unconfirmed', hash, 'Launch submitted; confirmation is unknown. Recheck before another launch.', { cause }); }
  await verifyMinedCall(client, receipt, hash, prepared.account, prepared.config.router, prepared.data);
  const event = verifyRareSelfLaunchReceipt(receipt, hash, prepared);
  try {
    const [recorded, count, pool] = await Promise.all([
      client.readContract({ address: prepared.config.router, abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'launchedAsset', args: [event.asset], blockNumber: receipt.blockNumber }),
      client.readContract({ address: prepared.config.router, abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'selfLaunchCount', args: [prepared.account], blockNumber: receipt.blockNumber }),
      client.readContract({ address: RARE_LAUNCH_DOPPLER.initializer, abi: dopplerHookInitializerAbi, functionName: 'getState', args: [event.asset], blockNumber: receipt.blockNumber }),
    ]);
    if (!recorded || count < prepared.config.brain + 1n || pool[4] !== 2 || !equal(pool[0], prepared.draft.quote.asset.address) || pool[1] !== RARE_LAUNCH_SUPPLY || !equal(pool[2], zeroAddress) || !equal(computePoolId(pool[5]), prepared.doppler.prediction.poolId)) throw new Error('The creator ledger or permanent pool differs.');
  } catch (cause) { throw new RareLaunchTransactionError('unverified', hash, 'The creator launch was mined but its market state could not be verified.', { cause }); }
  await verifyMinedCall(client, receipt, hash, prepared.account, prepared.config.router, prepared.data);
  return immutable({ hash, asset: event.asset, poolId: prepared.doppler.prediction.poolId, launchCount: prepared.config.brain + 1n });
}
export async function sendRareSelfLaunch(options: SelfSessionOptions & { prepared: PreparedRareSelfLaunch; onHash: (hash: Hex) => void }, injected?: RareLaunchDependencies) {
  if (active.has(options.session)) throw new Error('A launch transaction is already pending.'); active.add(options.session);
  try {
    const deps = injected ?? await defaultDependencies(), prepared = immutable(structuredClone(options.prepared));
    if (prepared.mode !== 'self' || !equal(prepared.account, options.account) || prepared.revision !== options.revision) throw new Error('The review belongs to another creator.');
    const connection = await verifiedSelfSession(options, deps, true);
    const config = await readRareSelfLaunchConfig(prepared.config.router, options.account, deps); connection.assert();
    if (!sameConfig(config, prepared.config)) throw new Error('Creator configuration or launch count changed. Prepare a new review.');
    const built = buildRareSelfLaunchParams({ account: options.account, config, draft: prepared.draft, now: deps.now?.() });
    const call = selfLaunchCall(config.router, built.request);
    if (!equal(call.data, prepared.data)) throw new Error('Creator launch calldata changed after review.');
    verifyPreparedDoppler(prepared.doppler, built.params, config.router, deps.client);
    await validateCurrentQuote(prepared.draft, deps); connection.assert();
    const simulation = await deps.client.simulateContract({ account: options.account, ...call }); connection.assert();
    if (!equal(simulation.result, prepared.doppler.prediction.tokenAddress)) throw new Error('The creator token prediction changed.');
    await connection.assertSigner(); validateRareLaunchDraft(prepared.draft, deps.now?.()); connection.assert();
    options.onWalletRequest?.();
    const hash = await connection.signer!.writeContract({ account: options.account, chain: connection.signer!.chain, address: call.address, abi: call.abi, functionName: call.functionName, args: call.args });
    options.onHash(hash); return await confirmRareSelfLaunch(hash, prepared, deps);
  } finally { active.delete(options.session); }
}
export async function readRareSelfLaunchHistory(input: { router: Address; account: Address; signal?: AbortSignal }, injected?: Pick<RareLaunchDependencies, 'client'>) {
  const { client } = injected ?? await defaultDependencies(); input.signal?.throwIfAborted();
  const config = await readRareSelfLaunchConfig(input.router, input.account, { client });
  const block = await client.getBlock({ blockNumber: config.blockNumber });
  const event = RARE_LAUNCH_ROUTER_ABI.find(item => item.type === 'event' && item.name === 'SelfLaunchRecorded')!;
  const logs = await client.getLogs({ address: input.router, event, args: { creator: input.account }, fromBlock: 0n, toBlock: config.blockNumber, strict: true });
  input.signal?.throwIfAborted();
  if (logs.length > 500) throw new Error('Creator launch history exceeds the supported limit. Use the chain explorer.');
  const items: RareLaunchHistoryItem[] = [], seen = new Set<string>();
  for (const log of logs) {
    const a = log.args;
    if (!equal(log.address, input.router) || log.removed || log.blockNumber === null || log.blockNumber > config.blockNumber || !log.transactionHash || !equal(a.creator, input.account)
      || !isAddress(a.asset) || equal(a.asset, zeroAddress) || !config.quoteTokens.some(q => equal(q, a.quote)) || !RARE_LAUNCH_FEES.includes(a.fee as RareLaunchFee)
      || a.timestamp <= 0n || a.timestamp > config.timestamp || seen.has(a.asset.toLowerCase())) throw new Error('Creator launch history is invalid. Retry.');
    seen.add(a.asset.toLowerCase()); items.push({ asset: a.asset, hash: log.transactionHash, timestamp: a.timestamp, quote: a.quote, fee: a.fee });
  }
  if (BigInt(items.length) !== config.brain) throw new Error('Creator launch history is incomplete. Retry or use the explorer.');
  const current = await client.getBlock({ blockNumber: config.blockNumber });
  if (current.hash !== block.hash || await client.getChainId() !== 4663) throw new Error('Creator launch history block changed.');
  input.signal?.throwIfAborted(); return immutable({ items: items.sort((a, b) => a.timestamp === b.timestamp ? 0 : a.timestamp > b.timestamp ? -1 : 1), blockNumber: config.blockNumber, incomplete: false as const });
}
export async function claimRareSelfLaunchFees(options: SelfSessionOptions & { asset: Address; onHash: (hash: Hex) => void }, injected?: RareLaunchDependencies) {
  if (active.has(options.session)) throw new Error('A launch transaction is already pending.'); active.add(options.session);
  try {
    const deps = injected ?? await defaultDependencies(), connection = await verifiedSelfSession(options, deps, true);
    const fees = await readRareLaunchFees({ asset: options.asset, wallet: options.account }, deps); connection.assert();
    if (fees.amount0 === 0n && fees.amount1 === 0n) throw new Error('No fees are available to claim yet.');
    const args = [fees.poolId] as const;
    const data = encodeFunctionData({ abi: READ_ABI, functionName: 'collectFees', args });
    await deps.client.simulateContract({ account: options.account, address: RARE_LAUNCH_DOPPLER.initializer, abi: READ_ABI, functionName: 'collectFees', args });
    await connection.assertSigner(); connection.assert();
    options.onWalletRequest?.();
    const hash = await connection.signer!.writeContract({ account: options.account, chain: connection.signer!.chain, address: RARE_LAUNCH_DOPPLER.initializer, abi: READ_ABI, functionName: 'collectFees', args });
    options.onHash(hash);
    let receipt: TransactionReceipt;
    try { receipt = await deps.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 }); }
    catch (cause) { throw new RareLaunchTransactionError('unconfirmed', hash, 'Claim sent; confirmation remains unknown. Inspect it before retrying.', { cause }); }
    await verifyMinedCall(deps.client, receipt, hash, options.account, RARE_LAUNCH_DOPPLER.initializer, data); receiptStatus(receipt, hash);
    const releases = parseEventLogs({ abi: READ_ABI, eventName: 'Release', strict: true, logs: receipt.logs.filter(log => equal(log.address, RARE_LAUNCH_DOPPLER.initializer)) })
      .filter(({ args: a }) => equal(a.poolId, fees.poolId) && equal(a.beneficiary, options.account));
    if (releases.length !== 1) throw new RareLaunchTransactionError('unverified', hash, 'The creator fee release could not be verified.');
    return { hash, poolId: fees.poolId, amount0: releases[0].args.fees0, amount1: releases[0].args.fees1, token0: fees.token0, token1: fees.token1 };
  } finally { active.delete(options.session); }
}
export function validateStoredRareSelfLaunch(account: Address, value: unknown): PreparedRareSelfLaunch {
  if (!value || typeof value !== 'object') throw new Error('Invalid stored self launch.');
  const p = value as PreparedRareSelfLaunch; address(account, 'creator'); address(p.account, 'stored creator');
  if (p.mode !== 'self' || !equal(account, p.account) || !Number.isSafeInteger(p.revision) || !Number.isSafeInteger(p.preparedAt)
    || typeof p.config?.brain !== 'bigint' || p.config.brain < 0n || p.config.hasLaunched || p.config.lastLaunchAt !== 0n || p.config.readyAt !== 0n) throw new Error('Stored creator identity is invalid.');
  const built = buildParticipantParams({ pet: { walletAddress: account, contract: zeroAddress, tokenId: '0' }, config: p.config, draft: p.draft, now: p.preparedAt }, false);
  if (!equal(selfLaunchCall(p.config.router, built.request).data, p.data) || !equal(selfLaunchCall(p.config.router, p.request).data, p.data)) throw new Error('Stored creator calldata changed.');
  verifyPreparedDoppler(p.doppler, built.params, p.config.router, {} as ReadClient);
  return immutable({ ...p, request: built.request, review: built.review });
}

/** Minimal persisted claim proof: reconstruct fixed calldata from the verified pool; never sign. */
export async function confirmRareLaunchFeeClaim(input: { hash: Hex; asset: Address; wallet: Address; owner: Address; mode: 'friend' | 'self' }, injected?: Pick<RareLaunchDependencies, 'client'>) {
  const { client } = injected ?? await defaultDependencies();
  address(input.asset, 'launched asset'); address(input.wallet, 'fee beneficiary'); address(input.owner, 'owner');
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.hash) || !['friend', 'self'].includes(input.mode) || input.mode === 'self' && !equal(input.wallet, input.owner)) throw new Error('Invalid fee claim recovery identity.');
  let receipt: TransactionReceipt;
  try { receipt = await client.waitForTransactionReceipt({ hash: input.hash, confirmations: 1, timeout: 120_000 }); }
  catch (cause) { throw new RareLaunchTransactionError('unconfirmed', input.hash, 'The fee claim is not confirmed yet. Check again before claiming.', { cause }); }
  try {
    const state = await client.readContract({ address: RARE_LAUNCH_DOPPLER.initializer, abi: dopplerHookInitializerAbi, functionName: 'getState', args: [input.asset], blockNumber: receipt.blockNumber });
    if (state[4] !== 2 || !equal(state[5].hooks, RARE_LAUNCH_DOPPLER.initializer) || ![state[5].currency0, state[5].currency1].some(a => equal(a, input.asset))) throw new Error('Unverified claim pool.');
    const poolId = computePoolId(state[5]);
    const inner = encodeFunctionData({ abi: READ_ABI, functionName: 'collectFees', args: [poolId] });
    const data = input.mode === 'self' ? inner : encodeFunctionData({ abi: RARE_WALLET_ABI, functionName: 'execute', args: [RARE_LAUNCH_DOPPLER.initializer, 0n, inner, 0] });
    const target = input.mode === 'self' ? RARE_LAUNCH_DOPPLER.initializer : input.wallet;
    await verifyMinedCall(client, receipt, input.hash, input.owner, target, data); receiptStatus(receipt, input.hash);
    const releases = parseEventLogs({ abi: READ_ABI, eventName: 'Release', strict: true, logs: receipt.logs.filter(log => equal(log.address, RARE_LAUNCH_DOPPLER.initializer)) })
      .filter(({ args }) => equal(args.poolId, poolId) && equal(args.beneficiary, input.wallet));
    if (releases.length !== 1) throw new Error('Exact beneficiary Release event is missing.');
    return { hash: input.hash, poolId, amount0: releases[0].args.fees0, amount1: releases[0].args.fees1, token0: state[5].currency0, token1: state[5].currency1 };
  } catch (cause) {
    if (cause instanceof RareLaunchTransactionError) throw cause;
    throw new RareLaunchTransactionError('unverified', input.hash, 'The fee claim could not be fully verified. Inspect the transaction before claiming again.', { cause });
  }
}
