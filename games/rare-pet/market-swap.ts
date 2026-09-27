import { Quoter, computePoolId, dopplerHookInitializerAbi, getAddresses } from '@whetstone-research/doppler-sdk/evm';
import { createWalletClient, custom, decodeFunctionData, encodeAbiParameters, encodeFunctionData, formatUnits, isAddress, keccak256, parseAbi, parseAbiParameters, parseEventLogs, parseUnits, zeroAddress,
  type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { RARE_MARKET_ROUTERS, type RareMarketToken } from './market-catalog.ts';
import { marketAssetQuote, type MarketAsset } from './market-assets.ts';
import { buildMarketRouteCall, readMarketRoute, recheckMarketRoute, type MarketRoute, type MarketRoutingDependencies } from './market-routing.ts';
import { RARE_LAUNCH_DOPPLER, RARE_LAUNCH_ROUTER_ABI } from './launch-doppler.ts';
import { LAUNCH_QUOTE_ASSETS } from './launch-quotes.ts';
import { RARE_WALLET_ABI } from './rare-wallet-transfer.ts';
import { getRareWalletTransfer } from './rare-wallet-transactions.ts';
import { getLaunchClaim } from './launch-claim-record.ts';
import { getRareLaunchTransaction } from './launch-transactions.ts';
import type { PetIdentity, PetWalletSession } from './wallet';

/** Doppler's documented Robinhood route is Universal Router 2.1.1, not a substituted router.
 * https://docs.doppler.lol/reference/quotes-and-swaps
 * Runtime and poolManager bindings independently read at mainnet block 73523701. */
export const MARKET_SWAP_DEPLOYMENT = Object.freeze({
  chainId: 4663, version: '2.1.1',
  router: '0x8876789976decbfcbbbe364623c63652db8c0904' as Address,
  quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94' as Address,
  poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951' as Address,
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
  weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73' as Address,
});
const CODE_HASHES = [
  [MARKET_SWAP_DEPLOYMENT.router, '0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde'],
  [MARKET_SWAP_DEPLOYMENT.quoter, '0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6'],
  [MARKET_SWAP_DEPLOYMENT.poolManager, '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626'],
  [MARKET_SWAP_DEPLOYMENT.permit2, '0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca'],
  [RARE_LAUNCH_DOPPLER.initializer, '0xc41a91106002f15bf70ae266824317f3f3ac638ac72ca5253bae395fa47ee631'],
] as const;
export const MARKET_ERC20_ABI = parseAbi(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)', 'function decimals() view returns(uint8)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
export const MARKET_PERMIT2_ABI = parseAbi(['function allowance(address,address,address) view returns(uint160 amount,uint48 expiration,uint48 nonce)',
  'function approve(address token,address spender,uint160 amount,uint48 expiration)']);
export const MARKET_ROUTER_ABI = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable', 'function poolManager() view returns(address)']);
const V3_SWAP_EVENT = parseAbi(['event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']);
const SWAP_EVENT = parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
type Client = Pick<PublicClient, 'getChainId'|'getBlockNumber'|'getBlock'|'getCode'|'readContract'|'simulateContract'|'getTransaction'|'waitForTransactionReceipt'|'getTransactionReceipt'>;
type Signer = Pick<WalletClient, 'chain'|'getChainId'|'getAddresses'|'writeContract'>;
export type MarketSwapDependencies = { client: Client; signer?: Signer; now?: () => number; verifyInfrastructure?: (client: Client, blockNumber: bigint) => Promise<void>;
  verifyIdentity?: (pet: PetIdentity, owner: Address) => Promise<PetIdentity>;
  fetcher?: typeof fetch; verifyRoutingInfrastructure?: MarketRoutingDependencies['verifyInfrastructure'] };
export type MarketActor = Readonly<{kind:'owner';account:Address}|{kind:'friend';pet:PetIdentity}>;
export function marketActorOwner(actor:MarketActor):Address {
  if(actor.kind==='owner'){address(actor.account);return actor.account;}
  if(actor.kind!=='friend')throw new Error('Choose an owner wallet or Rare Wallet.');
  address(actor.pet?.owner);return actor.pet.owner;
}
export function marketActorWallet(actor:MarketActor):Address {
  if(actor.kind==='owner')return marketActorOwner(actor);
  marketActorOwner(actor);address(actor.pet.walletAddress);
  if(actor.pet.chainId!==4663||!['genesis','generations'].includes(actor.pet.collection)||!/^\d+$/.test(actor.pet.tokenId)||BigInt(actor.pet.tokenId)<=0n
    ||actor.pet.collection==='generations'&&!(actor.pet.generation&&actor.pet.generation>0))throw new Error('Choose a Genesis or hardwired Generations Rare Wallet.');
  return actor.pet.walletAddress;
}
export type MarketSelection = RareMarketToken | MarketAsset;
type Currency = Readonly<{ address: Address; symbol: string; decimals: number }>;
export type MarketSwapQuote = Readonly<{
  actor: MarketActor|null;
  market: MarketSelection; route: MarketRoute|null; side: 'buy'|'sell'; tokenIn: Currency; tokenOut: Currency; amountIn: bigint; amountOut: bigint; minimumAmountOut: bigint;
  slippageBps: number; account: Address|null; balance: bigint|null; tokenAllowance: bigint|null; routerAllowance: bigint|null;
  routerAllowanceExpiresAt: number|null; approval: 'token'|'router'|null; quotedAt: number; expiresAt: number; blockNumber: bigint;
}>;
export type MarketTransaction = Readonly<{
  requestId: string;
  owner: Address; mode: 'owner'|'friend';
  kind: 'token-approval'|'router-approval'|'swap'; status: 'awaiting-wallet'|'pending'|'unverified'|'confirmed'|'failed'; hash: Hex|null;
  account: Address; tokenIn: Currency; tokenOut: Currency; amountIn: bigint; minimumAmountOut: bigint; side: 'buy'|'sell'; error?: string;
  target: Address; data: Hex; poolId: Hex|null; route: MarketRoute|null; createdAt: number;
}>;
type SessionOptions = { session: PetWalletSession; account: Address; actor?:MarketActor; revision: number; quote: MarketSwapQuote; onHash: (hash: Hex) => void; assertActive?: () => void };
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const validHash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v);
const issued = new WeakSet<MarketSwapQuote>();
const nowOf = (deps: MarketSwapDependencies) => (deps.now ?? Date.now)();
function address(value: unknown): asserts value is Address { if (typeof value !== 'string' || !isAddress(value) || equal(value, zeroAddress)) throw new Error('A valid wallet or token address is required.'); }
function userRejected(error: unknown) {
  const seen=new Set<unknown>();
  for(let depth=0;depth<8&&error&&typeof error==='object'&&!seen.has(error);depth++){
    seen.add(error);const e=error as {code?:unknown;name?:unknown;cause?:unknown};
    if(e.code===4001||e.name==='UserRejectedRequestError')return true;error=e.cause;
  }
  return false;
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
async function defaults(): Promise<MarketSwapDependencies> { return { client: (await import('./wallet')).createPetPublicClient() }; }

export function parseMarketAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || typeof value !== 'string' || value.length > 100
    || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) throw new Error(`Enter a positive amount with at most ${decimals} decimal places.`);
  const amount = parseUnits(value, decimals);
  if (amount <= 0n || amount >= 1n << 128n) throw new Error('The amount is outside the supported trade range.');
  return amount;
}
export function marketMinimumOutput(amount: bigint, slippageBps: number): bigint {
  if (typeof amount !== 'bigint' || amount <= 0n || amount >= 1n << 128n || !Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500) throw new Error('Choose slippage between 0.1% and 5%.');
  const minimum = amount * BigInt(10_000 - slippageBps) / 10_000n;
  if (!minimum) throw new Error('This amount is too small for a protected trade.');
  return minimum;
}
function validateMarket(market: RareMarketToken) {
  address(market.asset); address(market.quote?.address);
  const quote = LAUNCH_QUOTE_ASSETS.find(q => equal(q.address, market.quote.address));
  if (!quote || quote.decimals !== market.quote.decimals || quote.symbol !== market.quote.symbol || market.decimals !== 18
    || !RARE_MARKET_ROUTERS.some(r => equal(r.address, market.router)) || equal(market.asset, market.quote.address)
    || ![3000,10000,20000].includes(market.fee)) throw new Error('Choose a verified Rare Launchpad market.');
  const key = market.poolKey, currencies = [market.asset, quote.address].sort((a,b) => BigInt(a) < BigInt(b) ? -1 : 1);
  if (!key || !equal(key.currency0, currencies[0]) || !equal(key.currency1, currencies[1]) || key.fee !== market.fee || key.tickSpacing !== 200
    || !equal(key.hooks, RARE_LAUNCH_DOPPLER.initializer) || !equal(computePoolId(key), market.poolId)) throw new Error('This market has an unverified pool.');
}
function selection(market:MarketSelection):{launch:RareMarketToken|null;asset:Currency;quote:Currency} {
  if(!('source' in market)){validateMarket(market);return {launch:market,asset:{address:market.asset,symbol:market.symbol,decimals:18},quote:market.quote};}
  const quote=marketAssetQuote(market);
  if(market.source==='launch'){
    validateMarket(market.launch);
    if(!equal(market.address,market.launch.asset)||market.decimals!==18||market.symbol!==market.launch.symbol)throw new Error('The selected launch metadata changed.');
    return {launch:market.launch,asset:{address:market.address,symbol:market.symbol,decimals:18},quote};
  }
  const canonical=LAUNCH_QUOTE_ASSETS.find(q=>equal(q.address,market.address));
  if(!canonical||market.decimals!==canonical.decimals||market.symbol!==canonical.symbol
    ||market.quoteAsset.decimals!==canonical.decimals||market.quoteAsset.symbol!==canonical.symbol)throw new Error('Choose an asset from the canonical ecosystem directory.');
  return {launch:null,asset:canonical,quote};
}
async function verifiedSelection(market:MarketSelection,deps:MarketSwapDependencies,blockNumber:bigint){
  const selected=selection(market);
  if(selected.launch){await verifiedMarket(selected.launch,deps,blockNumber);return selected;}
  const decimals=await Promise.all([selected.asset,selected.quote].map(t=>deps.client.readContract({address:t.address,abi:MARKET_ERC20_ABI,functionName:'decimals',blockNumber})));
  if(decimals[0]!==selected.asset.decimals||decimals[1]!==selected.quote.decimals)throw new Error('The ecosystem token decimals do not match the canonical catalog.');
  return selected;
}
async function infrastructure(client: Client, blockNumber: bigint) {
  const sdk = getAddresses(4663);
  if (!equal(sdk.universalRouter, MARKET_SWAP_DEPLOYMENT.router) || !equal(sdk.uniswapV4Quoter!, MARKET_SWAP_DEPLOYMENT.quoter)
    || !equal(sdk.permit2, MARKET_SWAP_DEPLOYMENT.permit2) || !equal(sdk.poolManager, MARKET_SWAP_DEPLOYMENT.poolManager) || !equal(sdk.weth, MARKET_SWAP_DEPLOYMENT.weth)) throw new Error('The supported router configuration changed. Trading is unavailable.');
  await Promise.all(CODE_HASHES.map(async ([contract, hash]) => {
    const code = await client.getCode({ address: contract, blockNumber });
    if (!code || keccak256(code) !== hash) throw new Error('Swap infrastructure does not match the verified deployment.');
  }));
  await Promise.all([MARKET_SWAP_DEPLOYMENT.router,MARKET_SWAP_DEPLOYMENT.quoter,RARE_LAUNCH_DOPPLER.initializer].map(async contract => {
    const manager = await client.readContract({ address: contract, abi: MARKET_ROUTER_ABI, functionName: 'poolManager', blockNumber });
    if (!equal(manager, MARKET_SWAP_DEPLOYMENT.poolManager)) throw new Error('The swap router is connected to a different pool manager.');
  }));
}
async function verifiedMarket(market: RareMarketToken, deps: MarketSwapDependencies, blockNumber: bigint) {
  validateMarket(market);
  const router = RARE_MARKET_ROUTERS.find(r => equal(r.address,market.router))!;
  const [code, launched, state, decimals] = await Promise.all([
    deps.client.getCode({ address: market.router, blockNumber }),
    deps.client.readContract({ address: market.router, abi: RARE_LAUNCH_ROUTER_ABI, functionName: 'launchedAsset', args: [market.asset], blockNumber }),
    deps.client.readContract({ address: RARE_LAUNCH_DOPPLER.initializer, abi: dopplerHookInitializerAbi, functionName: 'getState', args: [market.asset], blockNumber }),
    deps.client.readContract({ address: market.asset, abi: MARKET_ERC20_ABI, functionName: 'decimals', blockNumber }),
  ]);
  if (!code || keccak256(code) !== router.runtimeCodeHash || !launched || state[4] !== 2 || decimals !== 18
    || !equal(state[0],market.quote.address) || !equal(computePoolId(state[5]),market.poolId)) throw new Error('This token is no longer a verified tradable Rare Launchpad market.');
  await (deps.verifyInfrastructure ?? infrastructure)(deps.client, blockNumber);
}
async function snapshot(deps: MarketSwapDependencies) {
  if (await deps.client.getChainId() !== 4663) throw new Error('Trading requires Robinhood mainnet (4663).');
  const block = await deps.client.getBlock();
  if (!validHash(block.hash) || typeof block.number !== 'bigint' || block.timestamp <= 0n || Math.abs(Number(block.timestamp)*1000-nowOf(deps)) > 120_000) throw new Error('A recent mainnet block could not be verified.');
  return block;
}
async function verifiedActor(actor:MarketActor,deps:MarketSwapDependencies,assert:()=>void=()=>{}) {
  const owner=marketActorOwner(actor),wallet=marketActorWallet(actor);assert();
  if(actor.kind==='owner')return;
  const pet=actor.pet;
  const verify=deps.verifyIdentity??(async(p:PetIdentity,a:Address)=>(await import('./wallet')).verifyPet(p.collection,p.tokenId,a));
  const fresh=await verify(pet,owner);assert();
  if(fresh.chainId!==4663||fresh.collection!==pet.collection||!equal(fresh.contract,pet.contract)||fresh.tokenId!==pet.tokenId
    ||!equal(fresh.owner,owner)||!fresh.walletAddress||!equal(fresh.walletAddress,wallet))throw new Error('This Friend’s ownership or canonical Rare Wallet changed. Select it again.');
  const block=await snapshot(deps);assert();
  const [code,currentOwner,binding]=await Promise.all([
    deps.client.getCode({address:wallet,blockNumber:block.number}),
    deps.client.readContract({address:wallet,abi:RARE_WALLET_ABI,functionName:'owner',blockNumber:block.number}),
    deps.client.readContract({address:wallet,abi:RARE_WALLET_ABI,functionName:'token',blockNumber:block.number}),
  ]);assert();
  if(!code||code==='0x'||!equal(currentOwner,owner)||binding[0]!==4663n||!equal(binding[1],pet.contract)||binding[2]!==BigInt(pet.tokenId)
    ||(await deps.client.getBlock({blockNumber:block.number})).hash!==block.hash)throw new Error('The Rare Wallet’s owner or NFT binding could not be verified.');
  assert();
}
function sameActor(a:MarketActor,b:MarketActor){
  return a.kind===b.kind&&equal(marketActorOwner(a),marketActorOwner(b))&&equal(marketActorWallet(a),marketActorWallet(b))
    &&(a.kind!=='friend'||b.kind==='friend'&&a.pet.collection===b.pet.collection&&equal(a.pet.contract,b.pet.contract)&&a.pet.tokenId===b.pet.tokenId);
}
function assertOtherTransactions(actor:MarketActor){
  const wallet=marketActorWallet(actor),pending=(r:{status:string}|null)=>!!r&&['awaiting-wallet','pending','unverified'].includes(r.status);
  if(actor.kind==='friend'&&pending(getRareWalletTransfer(wallet)))throw new Error('Resolve this Rare Wallet’s pending transfer before trading.');
  if(pending(getLaunchClaim(wallet)))throw new Error('Resolve this wallet’s pending trading-fee claim before trading.');
  if(pending(getRareLaunchTransaction(wallet)))throw new Error('Resolve this wallet’s pending launch before trading.');
}
export function assertMarketActorIdle(actor:MarketActor){
  if(unresolved(getMarketTransaction(marketActorWallet(actor))))throw new Error('Resolve your pending market transaction before another wallet request.');
  assertOtherTransactions(actor);
}
export async function readMarketBalances(market: MarketSelection, account: Address, injected?: MarketSwapDependencies, actor?:MarketActor): Promise<{asset:bigint;quote:bigint}> {
  if(actor&&!equal(marketActorWallet(actor),account))throw new Error('The balance wallet does not match the selected trading wallet.');
  address(account); const deps = injected ?? await defaults(), block = await snapshot(deps); const selected=await verifiedSelection(market,deps,block.number);
  if(actor)await verifiedActor(actor,deps);
  const [asset,quote] = await Promise.all([selected.asset.address,selected.quote.address].map(token => deps.client.readContract({address:token,abi:MARKET_ERC20_ABI,functionName:'balanceOf',args:[account],blockNumber:block.number})));
  return {asset,quote};
}
type QuoteInput={market:MarketSelection;side:'buy'|'sell';amount:string;slippageBps:number;account?:Address;actor?:MarketActor};
export function readMarketSwapQuote(input:QuoteInput,injected?:MarketSwapDependencies):Promise<MarketSwapQuote>{return quoteMarket(input,injected);}
async function quoteMarket(input:QuoteInput,injected?:MarketSwapDependencies,reviewedRoute?:MarketRoute|null):Promise<MarketSwapQuote>{
  const market = structuredClone(input.market), selected=selection(market);
  if (input.side !== 'buy' && input.side !== 'sell') throw new Error('Choose Buy or Sell.');
  const actor=input.actor?freeze(structuredClone(input.actor)):input.account?freeze({kind:'owner' as const,account:input.account}):null;
  const account=actor?marketActorWallet(actor):undefined;
  if(input.account&&account&&!equal(input.account,account))throw new Error('The quote wallet does not match the selected trading wallet.');
  if (account) address(account);
  const currencies: Currency[] = [selected.asset,selected.quote];
  const tokenIn = currencies[input.side === 'buy' ? 1 : 0], tokenOut = currencies[input.side === 'buy' ? 0 : 1];
  const amountIn = parseMarketAmount(input.amount,tokenIn.decimals), deps=injected ?? await defaults(), block = await snapshot(deps);
  marketMinimumOutput(10000n,input.slippageBps); await verifiedSelection(market,deps,block.number);
  if(actor)await verifiedActor(actor,deps);
  const quoter = new Quoter({simulateContract:(args: Record<string,unknown>)=>deps.client.simulateContract({...args,blockNumber:block.number} as never)} as unknown as PublicClient,4663);
  const [quoted,balance,tokenAllowance,permit] = await Promise.all([
    selected.launch ? quoter.quoteExactInputV4({poolKey:selected.launch.poolKey,zeroForOne:equal(tokenIn.address,selected.launch.poolKey.currency0),exactAmount:amountIn,hookData:'0x'}).then(q=>({...q,route:null}))
      : reviewedRoute ? recheckMarketRoute(reviewedRoute,amountIn,block.number,deps.client,deps.verifyRoutingInfrastructure)
      : readMarketRoute({tokenIn:tokenIn.address,tokenOut:tokenOut.address,amountIn,account:account??'0x0000000000000000000000000000000000000001',blockNumber:block.number},{client:deps.client,fetcher:deps.fetcher,verifyInfrastructure:deps.verifyRoutingInfrastructure}),
    account ? deps.client.readContract({address:tokenIn.address,abi:MARKET_ERC20_ABI,functionName:'balanceOf',args:[account],blockNumber:block.number}) : null,
    account ? deps.client.readContract({address:tokenIn.address,abi:MARKET_ERC20_ABI,functionName:'allowance',args:[account,MARKET_SWAP_DEPLOYMENT.permit2],blockNumber:block.number}) : null,
    account ? deps.client.readContract({address:MARKET_SWAP_DEPLOYMENT.permit2,abi:MARKET_PERMIT2_ABI,functionName:'allowance',args:[account,tokenIn.address,MARKET_SWAP_DEPLOYMENT.router],blockNumber:block.number}) : null,
  ]);
  if ((await deps.client.getBlock({blockNumber:block.number})).hash !== block.hash || await deps.client.getChainId() !== 4663) throw new Error('The quote block changed. Get a fresh quote.');
  const quotedAt=nowOf(deps), minimumAmountOut=marketMinimumOutput(quoted.amountOut,input.slippageBps);
  const approval = tokenAllowance !== null && tokenAllowance < amountIn ? 'token' : permit && (permit[0] < amountIn || permit[1] < Number(block.timestamp)+120) ? 'router' : null;
  const quote: MarketSwapQuote = freeze({actor,market,route:quoted.route,side:input.side,tokenIn,tokenOut,amountIn,amountOut:quoted.amountOut,minimumAmountOut,slippageBps:input.slippageBps,
    account:account??null,balance,tokenAllowance,routerAllowance:permit?.[0]??null,routerAllowanceExpiresAt:permit?.[1]??null,approval,quotedAt,expiresAt:quotedAt+60_000,blockNumber:block.number});
  issued.add(quote); return quote;
}

/** Fixed standard 2.1.1 commands, matched byte-for-byte against the official SDK in tests.
 * No custom router: execute V4_SWAP(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL).
 * TAKE_ALL pays msg.sender; SETTLE_ALL caps the owner's total input. */
export function buildMarketSwapCall(quote: MarketSwapQuote, deadline: bigint) {
  const selected=selection(quote.market);
  if (quote.amountIn <= 0n || quote.amountIn >= 1n<<128n || quote.minimumAmountOut !== marketMinimumOutput(quote.amountOut,quote.slippageBps) || deadline<=0n) throw new Error('Invalid trade bounds.');
  if(!selected.launch){
    if(!quote.route||!equal(quote.route.tokenIn,quote.tokenIn.address)||!equal(quote.route.tokenOut,quote.tokenOut.address))throw new Error('The route does not match the reviewed currencies.');
    return buildMarketRouteCall({route:quote.route,amountIn:quote.amountIn,minimumAmountOut:quote.minimumAmountOut,deadline});
  }
  const market=selected.launch;
  const swap = encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)'), [{
    poolKey:market.poolKey,zeroForOne:equal(quote.tokenIn.address,market.poolKey.currency0),amountIn:quote.amountIn,
    amountOutMinimum:quote.minimumAmountOut,minHopPriceX36:0n,hookData:'0x',
  }]);
  const settle=encodeAbiParameters(parseAbiParameters('address,uint256'),[quote.tokenIn.address,quote.amountIn]);
  const take=encodeAbiParameters(parseAbiParameters('address,uint256'),[quote.tokenOut.address,quote.minimumAmountOut]);
  const actions=encodeAbiParameters(parseAbiParameters('bytes,bytes[]'),['0x060c0f',[swap,settle,take]]);
  const args=['0x10' as Hex,[actions],deadline] as const;
  return {address:MARKET_SWAP_DEPLOYMENT.router,abi:MARKET_ROUTER_ABI,functionName:'execute' as const,args,value:0n,
    data:encodeFunctionData({abi:MARKET_ROUTER_ABI,functionName:'execute',args})};
}

const STORE_KEY='rarepet:market-transactions:v1', records=new Map<string,MarketTransaction>(), listeners=new Set<()=>void>();
let loaded=false;
const unresolved=(r:MarketTransaction|undefined|null)=>!!r && ['awaiting-wallet','pending','unverified'].includes(r.status);
function load() {
  if(loaded)return; loaded=true;
  try {
    const raw=globalThis.sessionStorage?.getItem(STORE_KEY); if(!raw || raw.length>2_000_000)return;
    const parsed=JSON.parse(raw,(_key,value)=>value && typeof value==='object' && Object.keys(value).length===1 && typeof value.$bigint==='string' && /^[0-9]{1,78}$/.test(value.$bigint)?BigInt(value.$bigint):value);
    if(!Array.isArray(parsed)||parsed.length>32)return;
    for(const r of parsed) {try {
      r.owner??=r.account;r.mode??='owner';r.route??=null;
      address(r.account);address(r.target);address(r.tokenIn.address);address(r.tokenOut.address);
      address(r.owner);
      if(typeof r.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.requestId)
        ||!['owner','friend'].includes(r.mode)||r.mode==='owner'&&!equal(r.owner,r.account)||r.mode==='friend'&&r.data!=='0x'&&!equal(r.target,r.account)
        ||![r.tokenIn,r.tokenOut].every(t=>typeof t.symbol==='string'&&t.symbol.length<=32&&!/[\u0000-\u001f\u007f]/.test(t.symbol)&&Number.isInteger(t.decimals)&&t.decimals>=0&&t.decimals<=18)
        ||!['token-approval','router-approval','swap'].includes(r.kind)||!['awaiting-wallet','pending','unverified','confirmed','failed'].includes(r.status)
        || r.hash!==null&&!validHash(r.hash)||r.route===null&&!validHash(r.poolId)||r.route!==null&&r.poolId!==null||!/^0x(?:[0-9a-f]{2})*$/i.test(r.data)||r.data.length>20000
        || r.status==='confirmed'&&!r.hash
        || typeof r.amountIn!=='bigint'||r.amountIn<=0n||r.amountIn>=1n<<128n||typeof r.minimumAmountOut!=='bigint'||r.minimumAmountOut<=0n
        ||!Number.isSafeInteger(r.createdAt)||!['buy','sell'].includes(r.side))continue;
      if(r.route){if(!equal(r.route.tokenIn,r.tokenIn.address)||!equal(r.route.tokenOut,r.tokenOut.address))continue;buildMarketRouteCall({route:r.route,amountIn:r.amountIn,minimumAmountOut:r.minimumAmountOut,deadline:1n});}
      records.set(r.account.toLowerCase(),freeze({...r,status:r.status==='awaiting-wallet'?'unverified':r.status,
        error:r.status==='awaiting-wallet'?'The wallet request ended without a hash. Check wallet activity before another trade.':undefined}));
    }catch{/* Saved data never authorizes signing. */}}
  }catch{/* Current-tab transaction tracking remains available. */}
}
function save(record:MarketTransaction) {
  load();const previous=records.get(record.account.toLowerCase());
  if(previous&&previous.requestId!==record.requestId&&record.status!=='awaiting-wallet')return;
  if(previous?.requestId===record.requestId&&!unresolved(previous)&&unresolved(record))return;
  record={...record,error:record.error?.slice(0,1000).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'')};
  records.set(record.account.toLowerCase(),freeze(record));
  if(records.size>32) {for(const [key,r] of records)if(!unresolved(r)&&!equal(key,record.account)){records.delete(key);break;}}
  try{globalThis.sessionStorage?.setItem(STORE_KEY,JSON.stringify([...records.values()],(_k,v)=>typeof v==='bigint'?{$bigint:v.toString()}:v));}catch{/* Do not lose in-memory proof. */}
  for(const listener of listeners)listener();
}
export function getMarketTransaction(account:Address|null|undefined):MarketTransaction|null {load();return account?records.get(account.toLowerCase())??null:null;}
export function subscribeMarketTransactions(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
class MarketTransactionError extends Error {
  readonly status:'failed'|'pending'|'unverified';
  constructor(status:'failed'|'pending'|'unverified',message:string){super(message);this.status=status;}
}
async function confirm(record:MarketTransaction,deps:MarketSwapDependencies,wait:boolean) {
  if(!record.hash)throw new MarketTransactionError('unverified','No transaction hash is available. Check your wallet activity; do not repeat the trade.');
  if(await deps.client.getChainId()!==4663)throw new MarketTransactionError('unverified','Reconnect to Robinhood mainnet to check this transaction.');
  let receipt;try{receipt=wait?await deps.client.waitForTransactionReceipt({hash:record.hash,confirmations:1,timeout:120_000}):await deps.client.getTransactionReceipt({hash:record.hash});}
  catch{throw new MarketTransactionError('pending','The transaction is still awaiting verification. Check its status before another trade.');}
  // Viem follows a speed-up/cancellation while waiting. Verify the mined replacement's
  // sender and nonce, then apply the same exact-call proof or explicitly mark it replaced.
  if(!equal(receipt.transactionHash,record.hash)){
    const [original,replacement,canonical]=await Promise.all([deps.client.getTransaction({hash:record.hash}),deps.client.getTransaction({hash:receipt.transactionHash}),deps.client.getBlock({blockNumber:receipt.blockNumber})]);
    if(!equal(original.from,record.owner)||!equal(replacement.from,record.owner)||original.nonce!==replacement.nonce
      ||replacement.chainId!==4663||canonical.hash!==receipt.blockHash||replacement.blockHash!==receipt.blockHash)throw new MarketTransactionError('unverified','The replacement transaction could not be verified.');
    record={...record,hash:receipt.transactionHash};save(record);
    if(!replacement.to||!equal(replacement.to,record.target)||replacement.input!==record.data||replacement.value!==0n)throw new MarketTransactionError('failed','The reviewed transaction was replaced or cancelled in your wallet.');
  }
  const tx=await deps.client.getTransaction({hash:record.hash!}),block=await deps.client.getBlock({blockNumber:receipt.blockNumber});
  if(!equal(receipt.transactionHash,record.hash!)||!equal(tx.hash,record.hash!)||!tx.to||!equal(tx.to,record.target)||!equal(tx.from,record.owner)
    ||tx.input!==record.data||tx.value!==0n||tx.chainId!==4663||tx.blockHash!==receipt.blockHash||block.hash!==receipt.blockHash
    ||!receipt.to||!equal(receipt.to,record.target)||!equal(receipt.from,record.owner))throw new MarketTransactionError('unverified','This receipt does not match the reviewed transaction. Inspect it before trading again.');
  if(receipt.status!=='success')throw new MarketTransactionError('failed','The transaction reverted. No trade was completed.');
  let innerTarget=record.target,innerData=record.data;
  if(record.mode==='friend'){
    const wrapped=decodeFunctionData({abi:RARE_WALLET_ABI,data:record.data});
    if(!equal(record.target,record.account)||wrapped.functionName!=='execute'||wrapped.args[1]!==0n||wrapped.args[3]!==0)throw new MarketTransactionError('unverified','This receipt is not the reviewed Rare Wallet CALL.');
    innerTarget=wrapped.args[0];innerData=wrapped.args[2];
  }
  const expectedTarget=record.kind==='token-approval'?record.tokenIn.address:record.kind==='router-approval'?MARKET_SWAP_DEPLOYMENT.permit2:MARKET_SWAP_DEPLOYMENT.router;
  if(!equal(innerTarget,expectedTarget))throw new MarketTransactionError('unverified','The execution target does not match the reviewed trading action.');
  if(record.kind==='token-approval'){
    const call=decodeFunctionData({abi:MARKET_ERC20_ABI,data:innerData});
    if(call.functionName!=='approve'||!equal(call.args[0],MARKET_SWAP_DEPLOYMENT.permit2)||call.args[1]!==record.amountIn)throw new MarketTransactionError('unverified','The token approval is not the reviewed exact amount.');
    const allowed=await deps.client.readContract({address:record.tokenIn.address,abi:MARKET_ERC20_ABI,functionName:'allowance',args:[record.account,MARKET_SWAP_DEPLOYMENT.permit2],blockNumber:receipt.blockNumber});
    if(allowed!==record.amountIn)throw new MarketTransactionError('unverified','The exact token allowance could not be verified. Refresh its transaction status.');
  }else if(record.kind==='router-approval'){
    const call=decodeFunctionData({abi:MARKET_PERMIT2_ABI,data:innerData});
    const allowed=await deps.client.readContract({address:MARKET_SWAP_DEPLOYMENT.permit2,abi:MARKET_PERMIT2_ABI,functionName:'allowance',args:[record.account,record.tokenIn.address,MARKET_SWAP_DEPLOYMENT.router],blockNumber:receipt.blockNumber});
    if(call.functionName!=='approve'||!equal(call.args[0],record.tokenIn.address)||!equal(call.args[1],MARKET_SWAP_DEPLOYMENT.router)||call.args[2]!==record.amountIn
      ||allowed[0]!==record.amountIn||allowed[1]!==call.args[3])throw new MarketTransactionError('unverified','The exact trading allowance could not be verified.');
  }
  if(record.kind==='swap'){
    if(record.route?.version===3){
      for(const [index,leg] of record.route.legs.entries()){
        if(leg.version!==3)throw new MarketTransactionError('unverified','The reviewed route contains an unexpected protocol.');
        const swaps=parseEventLogs({abi:V3_SWAP_EVENT,eventName:'Swap',strict:true,logs:receipt.logs.filter(log=>equal(log.address,leg.poolAddress))});
        const last=index===record.route.legs.length-1,recipient=last?record.account:MARKET_SWAP_DEPLOYMENT.router;
        if(swaps.length!==1||!equal(swaps[0].args.sender,MARKET_SWAP_DEPLOYMENT.router)||!equal(swaps[0].args.recipient,recipient))throw new MarketTransactionError('unverified','The expected V3 swap sender or recipient was not found in the receipt.');
        const event=swaps[0].args,zeroForOne=BigInt(leg.tokenIn)<BigInt(leg.tokenOut),paid=zeroForOne?event.amount0:event.amount1,received=-(zeroForOne?event.amount1:event.amount0);
        if(paid<=0n||received<=0n||index===0&&paid!==record.amountIn||last&&received<record.minimumAmountOut)throw new MarketTransactionError('unverified','The V3 pool amounts do not match the reviewed trade.');
      }
    }else{
      const swaps=parseEventLogs({abi:SWAP_EVENT,eventName:'Swap',strict:true,logs:receipt.logs.filter(log=>equal(log.address,MARKET_SWAP_DEPLOYMENT.poolManager))});
      const pools=record.route?record.route.legs.map(leg=>leg.version===4?leg.poolId:null):[record.poolId];
      if(pools.some(pool=>!pool||swaps.filter(log=>equal(log.args.id,pool)&&equal(log.args.sender,MARKET_SWAP_DEPLOYMENT.router)).length!==1))throw new MarketTransactionError('unverified','The expected pool swap was not found in the receipt.');
    }
    const transfers=parseEventLogs({abi:MARKET_ERC20_ABI,eventName:'Transfer',strict:true,logs:receipt.logs.filter(log=>equal(log.address,record.tokenIn.address)||equal(log.address,record.tokenOut.address))});
    const paid=transfers.filter(log=>equal(log.address,record.tokenIn.address)&&equal(log.args.from,record.account)).reduce((a,l)=>a+l.args.value,0n);
    const received=transfers.filter(log=>equal(log.address,record.tokenOut.address)&&equal(log.args.to,record.account)).reduce((a,l)=>a+l.args.value,0n);
    if(paid!==record.amountIn||received<record.minimumAmountOut)throw new MarketTransactionError('unverified','The receipt does not prove the reviewed input and minimum output.');
  }
  if((await deps.client.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash||await deps.client.getChainId()!==4663)throw new MarketTransactionError('unverified','The confirmation block changed. Check the transaction again.');
  return receipt;
}
export async function refreshMarketTransaction(account:Address,injected?:MarketSwapDependencies) {
  const record=getMarketTransaction(account);if(!record||record.status==='awaiting-wallet')return record;
  try{const receipt=await confirm(record,injected??await defaults(),false);const latest=getMarketTransaction(account);if(latest?.requestId===record.requestId)save({...latest,hash:receipt.transactionHash,status:'confirmed',error:undefined});}
  catch(error){const latest=getMarketTransaction(account);if(latest?.requestId===record.requestId)save({...latest,status:error instanceof MarketTransactionError?error.status:'unverified',error:error instanceof Error?error.message:'Could not verify this transaction.'});}
  return getMarketTransaction(account);
}
async function send(options:SessionOptions,kind:'approval'|'swap',injected?:MarketSwapDependencies) {
  const {account,session,quote}=options;address(account);
  const actor=freeze(structuredClone(options.actor??{kind:'owner' as const,account})),wallet=marketActorWallet(actor);
  if(!equal(marketActorOwner(actor),account))throw new Error('The connected signer does not control the selected trading wallet.');
  assertMarketActorIdle(actor);
  if(!issued.has(quote)||!quote.account||!equal(quote.account,wallet)||!quote.actor||!sameActor(quote.actor,actor))throw new Error('Get a new quote with your connected wallet and selected trading account.');
  const provider=session.getProvider();if(!provider)throw new Error('Reconnect your wallet.');
  const assert=()=>{options.assertActive?.();const state=session.getSnapshot();if(state.status!=='connected'||state.revision!==options.revision||state.chainId!==4663||!state.account||!equal(state.account,account)||session.getProvider()!==provider)throw new Error('Your wallet changed. Get a new quote.');};
  assert();
  if(records.size>=32&&!records.has(wallet.toLowerCase())&&![...records.values()].some(r=>!unresolved(r)))throw new Error('Too many unresolved market transactions. Resolve an existing transaction first.');
  // Reserve before the first asynchronous step so double clicks and a reopened modal cannot duplicate requests.
  const reservation:MarketTransaction={requestId:crypto.randomUUID(),owner:account,mode:actor.kind,kind:kind==='swap'?'swap':quote.approval==='token'?'token-approval':'router-approval',status:'awaiting-wallet',hash:null,account:wallet,
    tokenIn:quote.tokenIn,tokenOut:quote.tokenOut,amountIn:quote.amountIn,minimumAmountOut:quote.minimumAmountOut,side:quote.side,target:MARKET_SWAP_DEPLOYMENT.router,data:'0x',poolId:selection(quote.market).launch?.poolId??null,route:quote.route,createdAt:Date.now()};
  save(reservation);let record=reservation,walletRequested=false;
  try{
    const deps=injected??await defaults();assert();
    const assertFresh=()=>{assert();if(nowOf(deps)>quote.expiresAt)throw new Error('Your quote expired. Get a fresh quote before confirming.');};assertFresh();
    let signer=deps.signer;
    if(!signer){const {RARE_PET_CHAIN}=await import('./wallet');assertFresh();signer=createWalletClient({account,chain:RARE_PET_CHAIN,transport:custom(provider)});}
    const assertSigner=async()=>{assertFresh();const [chain,accounts,publicChain]=await Promise.all([signer!.getChainId(),signer!.getAddresses(),deps.client.getChainId()]);assertFresh();if(chain!==4663||publicChain!==4663||signer!.chain?.id!==4663||!accounts[0]||!equal(accounts[0],account))throw new Error('Use the reviewed wallet on Robinhood mainnet.');};
    await assertSigner();await verifiedActor(actor,deps,assertFresh);
    const fresh=await quoteMarket({market:quote.market,side:quote.side,amount:formatUnits(quote.amountIn,quote.tokenIn.decimals),slippageBps:quote.slippageBps,account:wallet,actor},deps,quote.route);assertFresh();
    if(fresh.balance===null||fresh.balance<quote.amountIn)throw new Error(`Insufficient ${quote.tokenIn.symbol} balance in ${actor.kind==='friend'?'this Rare Wallet':'your connected wallet'}.`);
    const timestamp=Math.floor(nowOf(deps)/1000), deadline=BigInt(timestamp+120);
    let call;
    if(kind==='approval'){
      if(!quote.approval||fresh.approval!==quote.approval)throw new Error('Allowance changed. Refresh the quote before approving.');
      if(quote.approval==='token'){
        const args=[MARKET_SWAP_DEPLOYMENT.permit2,quote.amountIn] as const;
        call={address:quote.tokenIn.address,abi:MARKET_ERC20_ABI,functionName:'approve' as const,args,value:0n,data:encodeFunctionData({abi:MARKET_ERC20_ABI,functionName:'approve',args})};
      }else{
        const args=[quote.tokenIn.address,MARKET_SWAP_DEPLOYMENT.router,quote.amountIn,timestamp+1200] as const;
        call={address:MARKET_SWAP_DEPLOYMENT.permit2,abi:MARKET_PERMIT2_ABI,functionName:'approve' as const,args,value:0n,data:encodeFunctionData({abi:MARKET_PERMIT2_ABI,functionName:'approve',args})};
      }
    }else{
      if(quote.approval||fresh.approval)throw new Error('Complete the exact token approvals first.');
      if(fresh.amountOut<quote.minimumAmountOut)throw new Error('Price moved beyond your reviewed minimum. Get a fresh quote.');
      call=buildMarketSwapCall(quote,deadline);
    }
    const execution=actor.kind==='friend'?(()=>{
      const args=[call.address,call.value,call.data,0] as const;
      return {address:wallet,abi:RARE_WALLET_ABI,functionName:'execute' as const,args,value:0n,data:encodeFunctionData({abi:RARE_WALLET_ABI,functionName:'execute',args})};
    })():call;
    const simulated=await deps.client.simulateContract({account,...execution} as never);assertFresh();
    if(kind==='approval'&&quote.approval==='token'&&(actor.kind==='friend'?!/^0x0{63}1$/.test(String(simulated.result)):simulated.result!==true))throw new Error('The token did not confirm its approval simulation.');
    await verifiedActor(actor,deps,assertFresh);assertOtherTransactions(actor);await assertSigner();
    record={...record,target:execution.address,data:execution.data};save(record);walletRequested=true;
    const hash=await signer.writeContract({account,chain:signer.chain,...execution} as never);
    if(!validHash(hash))throw new Error('The wallet did not return a valid transaction hash. Check wallet activity before retrying.');
    record={...record,hash,status:'pending'};save(record);try{options.onHash(hash);}catch{/* UI callbacks cannot interrupt receipt tracking. */}
    const receipt=await confirm(record,deps,true);save({...record,hash:receipt.transactionHash,status:'confirmed'});return receipt;
  }catch(error){
    const status=error instanceof MarketTransactionError?error.status:!walletRequested||!record.hash&&userRejected(error)?'failed':'unverified';
    const latest=getMarketTransaction(wallet);if(latest?.requestId===record.requestId)record=latest;
    save({...record,status,error:error instanceof Error?error.message:'The wallet request could not be verified.'});throw error;
  }
}
export function sendMarketApproval(options:SessionOptions,injected?:MarketSwapDependencies){return send(options,'approval',injected);}
export function sendMarketSwap(options:SessionOptions,injected?:MarketSwapDependencies){return send(options,'swap',injected);}
