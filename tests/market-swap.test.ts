import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { computePoolId } from '@whetstone-research/doppler-sdk/evm';
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, parseAbiParameters, zeroAddress, type Address, type Hex } from 'viem';
import { buildMarketSwapCall, getMarketTransaction, MARKET_ERC20_ABI, MARKET_PERMIT2_ABI, MARKET_ROUTER_ABI, MARKET_SWAP_DEPLOYMENT as D, marketMinimumOutput, parseMarketAmount,
  readMarketBalances, readMarketSwapQuote, refreshMarketTransaction, sendMarketApproval, sendMarketSwap, type MarketSwapDependencies, type MarketSwapQuote } from '../games/rare-pet/market-swap.ts';
import { RARE_LAUNCH_DOPPLER } from '../games/rare-pet/launch-doppler.ts';
import { getLaunchQuoteAsset } from '../games/rare-pet/launch-quotes.ts';
import { RARE_MARKET_ROUTERS, type RareMarketToken } from '../games/rare-pet/market-catalog.ts';
import type { PetWalletSession } from '../games/rare-pet/wallet.ts';
const require = createRequire(import.meta.url);
const { V4Planner, Actions, URVersion } = require('@uniswap/v4-sdk');
const { RoutePlanner, CommandType } = require('@uniswap/universal-router-sdk');
const NOW=1_800_000_000_000, HASH=`0x${'a'.repeat(64)}` as Hex, BLOCK=`0x${'b'.repeat(64)}` as Hex;
const ASSET='0x1111111111111111111111111111111111111111' as Address, POOL=RARE_LAUNCH_DOPPLER.initializer;
const CODE=readFileSync(new URL('./fixtures/launch-router-v1-runtime.txt',import.meta.url),'utf8').trim() as Hex;
const SWAP_ABI=parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
function market(quoteId='weth',asset=ASSET):RareMarketToken{
  const quote=getLaunchQuoteAsset(quoteId),currencies=[asset,quote.address].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),poolKey={currency0:currencies[0],currency1:currencies[1],fee:3000,tickSpacing:200,hooks:POOL};
  return {asset,name:'Rare Test',symbol:'RARE',decimals:18,imageUrl:null,router:RARE_MARKET_ROUTERS[0].address,creator:ASSET,mode:'self',collection:null,tokenId:null,quote,fee:3000,poolKey,poolId:computePoolId(poolKey),hash:HASH,timestamp:1n,blockNumber:1n};
}
let index=100;
function fixture(selected=market()){
  const owner=`0x${(++index).toString(16).padStart(40,'0')}` as Address,provider={},state={account:owner,chainId:4663,status:'connected',revision:1};
  const session={getProvider:()=>provider,getSnapshot:()=>state} as unknown as PetWalletSession;
  const changes={chain:4663,now:NOW,balance:10n**30n,allowance:10n**30n,permit:10n**30n,expiration:NOW/1000+3600,out:1000000n,code:CODE,launched:true,pool:selected.poolKey,poolStatus:2,decimals:18,
    simulationError:null as Error|null,writeError:null as Error|null,waitError:null as Error|null,receiptStatus:'success',missingSwap:false,missingOutput:false,txData:null as Hex|null,
    afterSimulation:()=>{},afterQuote:()=>{},replacement:false,cancelled:false};
  const writes:Record<string,any>[]=[],simulations:Record<string,any>[]=[];let call:Record<string,any>={};
  const block=()=>({number:20n,hash:BLOCK,timestamp:BigInt(Math.floor(changes.now/1000))});
  const tx=(hash=HASH)=>({hash,to:changes.cancelled&&hash!==HASH?owner:call.address,from:owner,input:changes.cancelled&&hash!==HASH?'0x':changes.txData??call.data,value:0n,chainId:4663,nonce:4,blockHash:BLOCK,blockNumber:20n});
  const receipt=()=>{
    const hash=changes.replacement?`0x${'c'.repeat(64)}` as Hex:HASH;
    const base={blockHash:BLOCK,blockNumber:20n,transactionHash:hash,transactionIndex:0,removed:false};
    const decoded=call.functionName==='execute'?decodeFunctionData({abi:MARKET_ROUTER_ABI,data:call.data}):null;
    const logs:any[]=[];
    if(decoded?.functionName==='execute'){
      const [,params]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),decoded.args[1][0]);
      const [tokenIn,amountIn]=decodeAbiParameters(parseAbiParameters('address,uint256'),params[1]);
      const [tokenOut,minOut]=decodeAbiParameters(parseAbiParameters('address,uint256'),params[2]);
      if(!changes.missingSwap)logs.push({...base,address:D.poolManager,logIndex:0,topics:encodeEventTopics({abi:SWAP_ABI,eventName:'Swap',args:{id:selected.poolId,sender:D.router}}),data:encodeAbiParameters(parseAbiParameters('int128,int128,uint160,uint128,int24,uint24'),[-amountIn,changes.out,1n,1n,0,3000])});
      logs.push({...base,address:tokenIn,logIndex:1,topics:encodeEventTopics({abi:MARKET_ERC20_ABI,eventName:'Transfer',args:{from:owner,to:D.poolManager}}),data:encodeAbiParameters(parseAbiParameters('uint256'),[amountIn])});
      if(!changes.missingOutput)logs.push({...base,address:tokenOut,logIndex:2,topics:encodeEventTopics({abi:MARKET_ERC20_ABI,eventName:'Transfer',args:{from:D.poolManager,to:owner}}),data:encodeAbiParameters(parseAbiParameters('uint256'),[minOut])});
    }
    return {...base,status:changes.receiptStatus,to:changes.cancelled&&changes.replacement?owner:call.address,from:owner,logs};
  };
  const client={getChainId:async()=>changes.chain,getBlock:async()=>block(),getBlockNumber:async()=>20n,getCode:async()=>changes.code,
    readContract:async (args:any)=>{
      switch(args.functionName){
        case 'launchedAsset':return changes.launched;
        case 'getState':return [selected.quote.address,1n,zeroAddress,'0x',changes.poolStatus,changes.pool,0];
        case 'decimals':return changes.decimals;
        case 'balanceOf':return changes.balance;
        case 'allowance':return args.address.toLowerCase()===D.permit2.toLowerCase()?[changes.permit,changes.expiration,0]:changes.allowance;
        default:throw new Error(`unexpected read ${args.functionName}`);
      }
    },
    simulateContract:async(args:any)=>{simulations.push(args);if(args.functionName==='quoteExactInputSingle'){changes.afterQuote();return {result:[changes.out,50000n]};}
      if(changes.simulationError)throw changes.simulationError;changes.afterSimulation();return {result:true};},
    getTransaction:async({hash}:any)=>tx(hash),getTransactionReceipt:async()=>{if(changes.waitError)throw changes.waitError;return receipt();},
    waitForTransactionReceipt:async()=>{if(changes.waitError)throw changes.waitError;return receipt();},
  };
  const signer={chain:{id:4663},getChainId:async()=>changes.chain,getAddresses:async()=>[owner],writeContract:async(args:any)=>{
    writes.push(args);call=args;if(changes.writeError)throw changes.writeError;
    if(args.functionName==='approve'&&args.address.toLowerCase()===D.permit2.toLowerCase()){changes.permit=args.args[2];changes.expiration=args.args[3];}
    else if(args.functionName==='approve')changes.allowance=args.args[1];return HASH;
  }};
  const deps={client,signer,now:()=>changes.now,verifyInfrastructure:async()=>{}} as unknown as MarketSwapDependencies;
  const quote=(side:'buy'|'sell'='buy',amount='1')=>readMarketSwapQuote({market:selected,side,amount,slippageBps:50,account:owner},deps);
  const options=(q:MarketSwapQuote)=>({session,account:owner,revision:1,quote:q,onHash:()=>{}});
  return {owner,state,changes,writes,simulations,deps,quote,options,selected};
}
test('decimal parsing rejects excess precision, rounding, exponents, negatives, zero and uint128 overflow',()=>{
  assert.equal(parseMarketAmount('1.123456',6),1123456n);
  for(const value of ['1.0000001','0','0.0000001','1e2','-1',' 1','1.','01','0x2'])assert.throws(()=>parseMarketAmount(value,6));
  assert.throws(()=>parseMarketAmount((1n<<128n).toString(),0));
  assert.equal(marketMinimumOutput(10000n,50),9950n);for(const slip of [0,9,501,10000,0.5])assert.throws(()=>marketMinimumOutput(10000n,slip));
});
test('quotes pin verified pool direction and block; actual ERC20 pair balances and approvals are surfaced',async()=>{
  const f=fixture();f.changes.allowance=0n;const q=await f.quote();assert.equal(q.approval,'token');assert.equal(q.tokenIn.address,f.selected.quote.address);assert.equal(q.tokenOut.address,ASSET);
  assert.equal(q.minimumAmountOut,995000n);assert.equal(q.expiresAt,NOW+60000);assert.equal(q.balance,f.changes.balance);
  const request=f.simulations.find(s=>s.functionName==='quoteExactInputSingle')!;assert.equal(request.blockNumber,20n);assert.equal(request.args[0].zeroForOne,true);
  const sell=await f.quote('sell');assert.equal(sell.tokenIn.address,ASSET);assert.equal(sell.tokenOut.address,f.selected.quote.address);
  assert.deepEqual(await readMarketBalances(f.selected,f.owner,f.deps),{asset:f.changes.balance,quote:f.changes.balance});
});
test('anonymous browsing quotes without asking for a wallet',async()=>{
  const f=fixture();const q=await readMarketSwapQuote({market:f.selected,side:'buy',amount:'1',slippageBps:50},f.deps);assert.equal(q.account,null);assert.equal(q.balance,null);assert.equal(f.writes.length,0);
  await assert.rejects(sendMarketSwap(f.options(q),f.deps),/connected wallet/);
});
test('runtime calldata matches pinned official Universal Router 2.1.1 SDK for both directions and 6/8/18 decimal pairs',async()=>{
  for(const id of ['weth','usdg','cbbtc'])for(const side of ['buy','sell'] as const){
    const f=fixture(market(id)),q=await f.quote(side),deadline=1800000120n;
    const v4=new V4Planner().addAction(Actions.SWAP_EXACT_IN_SINGLE,[{poolKey:q.market.poolKey,zeroForOne:q.tokenIn.address.toLowerCase()===q.market.poolKey.currency0.toLowerCase(),amountIn:q.amountIn.toString(),amountOutMinimum:q.minimumAmountOut.toString(),minHopPriceX36:'0',hookData:'0x'}],URVersion.V2_1_1)
      .addAction(Actions.SETTLE_ALL,[q.tokenIn.address,q.amountIn.toString()]).addAction(Actions.TAKE_ALL,[q.tokenOut.address,q.minimumAmountOut.toString()]);
    const route=new RoutePlanner().addCommand(CommandType.V4_SWAP,[v4.finalize()]);
    const expected=encodeFunctionData({abi:MARKET_ROUTER_ABI,functionName:'execute',args:[route.commands,route.inputs,deadline]});
    const actual=buildMarketSwapCall(q,deadline);assert.equal(actual.data,expected);assert.equal(actual.value,0n);assert.equal(actual.address,D.router);
  }
});
test('rejects wrong network, unregistered tokens, changed pools and unverified runtime before any signing',async()=>{
  for(const change of [{chain:1},{launched:false},{code:'0x00'},{poolStatus:1},{decimals:6}]){const f=fixture();Object.assign(f.changes,change);await assert.rejects(f.quote());assert.equal(f.writes.length,0);}
  const f=fixture();f.changes.pool={...f.selected.poolKey,fee:10000};await assert.rejects(f.quote());
});
test('two separate exact amount approvals then a single simulated swap; no unlimited approval',async()=>{
  const f=fixture();f.changes.allowance=0n;f.changes.permit=0n;
  let q=await f.quote();await sendMarketApproval(f.options(q),f.deps);assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].args,[D.permit2,q.amountIn]);assert.equal(getMarketTransaction(f.owner)?.status,'confirmed');
  q=await f.quote();assert.equal(q.approval,'router');await sendMarketApproval(f.options(q),f.deps);assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1].args,[q.tokenIn.address,D.router,q.amountIn,NOW/1000+1200]);
  q=await f.quote();assert.equal(q.approval,null);await sendMarketSwap(f.options(q),f.deps);assert.equal(f.writes.length,3);assert.equal(getMarketTransaction(f.owner)?.status,'confirmed');
  assert.ok(f.simulations.some(s=>s.functionName==='execute'));
});
test('both buy and sell settle directly to the connected owner and prove exact input/minimum output',async()=>{
  for(const side of ['buy','sell'] as const){const f=fixture();const q=await f.quote(side);const r=await sendMarketSwap(f.options(q),f.deps);assert.equal(r.transactionHash,HASH);assert.equal(f.writes[0].account,f.owner);assert.equal(f.writes[0].address,D.router);}
});
test('forged or expired quote, changed wallet during simulation, allowance and balance failures do not sign',async()=>{
  const forged=fixture(),q0=await forged.quote();await assert.rejects(sendMarketSwap(forged.options({...q0}),forged.deps),/new quote/);
  const stale=fixture(),q1=await stale.quote();stale.changes.now+=60001;await assert.rejects(sendMarketSwap(stale.options(q1),stale.deps),/expired/);assert.equal(stale.writes.length,0);
  const changed=fixture(),q2=await changed.quote();changed.changes.afterSimulation=()=>{changed.state.revision++};await assert.rejects(sendMarketSwap(changed.options(q2),changed.deps),/wallet changed/);assert.equal(changed.writes.length,0);
  const poor=fixture(),q3=await poor.quote();poor.changes.balance=0n;await assert.rejects(sendMarketSwap(poor.options(q3),poor.deps),/Insufficient/);assert.equal(poor.writes.length,0);
  const noAllowance=fixture(),q4=await noAllowance.quote();noAllowance.changes.allowance=0n;await assert.rejects(sendMarketSwap(noAllowance.options(q4),noAllowance.deps),/approvals/);assert.equal(noAllowance.writes.length,0);
});
test('price movement beyond reviewed min and failed router simulation prevent signing',async()=>{
  const f=fixture(),q=await f.quote();f.changes.out=1n;await assert.rejects(sendMarketSwap(f.options(q),f.deps),/too small|Price moved/);assert.equal(f.writes.length,0);
  const g=fixture(),q2=await g.quote();g.changes.simulationError=new Error('pool unavailable');await assert.rejects(sendMarketSwap(g.options(q2),g.deps),/pool unavailable/);assert.equal(g.writes.length,0);
});
test('nested viem wallet rejection is recoverable; ambiguous broadcast remains locked without a hash',async()=>{
  const f=fixture(),q=await f.quote();f.changes.writeError=new Error('TransactionExecutionError',{cause:new Error('wrapper',{cause:Object.assign(new Error('User declined'),{code:4001})})});
  await assert.rejects(sendMarketSwap(f.options(q),f.deps));assert.equal(getMarketTransaction(f.owner)?.status,'failed');
  f.changes.writeError=null;await sendMarketSwap(f.options(q),f.deps);assert.equal(getMarketTransaction(f.owner)?.status,'confirmed');
  const g=fixture(),q2=await g.quote();g.changes.writeError=new Error('provider disconnected');await assert.rejects(sendMarketSwap(g.options(q2),g.deps));assert.equal(getMarketTransaction(g.owner)?.status,'unverified');
  await assert.rejects(sendMarketSwap(g.options(q2),g.deps),/pending/);assert.equal(g.writes.length,1);
});
test('timeout retains hash, duplicate calls stay blocked, receipt refresh never broadcasts',async()=>{
  const f=fixture(),q=await f.quote();f.changes.waitError=new Error('timeout');await assert.rejects(sendMarketSwap(f.options(q),f.deps));assert.equal(getMarketTransaction(f.owner)?.hash,HASH);assert.equal(getMarketTransaction(f.owner)?.status,'pending');
  await assert.rejects(sendMarketSwap(f.options(q),f.deps),/pending/);f.changes.waitError=null;await refreshMarketTransaction(f.owner,f.deps);assert.equal(getMarketTransaction(f.owner)?.status,'confirmed');assert.equal(f.writes.length,1);
});
test('receipt mismatch, missing swap and missing received tokens never report success',async()=>{
  for(const mutation of [{txData:'0x1234'},{missingSwap:true},{missingOutput:true}]){const f=fixture(),q=await f.quote();Object.assign(f.changes,mutation);await assert.rejects(sendMarketSwap(f.options(q),f.deps));assert.equal(getMarketTransaction(f.owner)?.status,'unverified');}
});
test('reverts are final failures, speed-ups preserve exact proof and cancellations release lock',async()=>{
  const f=fixture(),q=await f.quote();f.changes.receiptStatus='reverted';await assert.rejects(sendMarketSwap(f.options(q),f.deps),/reverted/);assert.equal(getMarketTransaction(f.owner)?.status,'failed');
  const g=fixture(),q2=await g.quote();g.changes.replacement=true;await sendMarketSwap(g.options(q2),g.deps);assert.equal(getMarketTransaction(g.owner)?.status,'confirmed');assert.equal(getMarketTransaction(g.owner)?.hash,`0x${'c'.repeat(64)}`);
  const h=fixture(),q3=await h.quote();h.changes.replacement=true;h.changes.cancelled=true;await assert.rejects(sendMarketSwap(h.options(q3),h.deps),/replaced or cancelled/);assert.equal(getMarketTransaction(h.owner)?.status,'failed');
});
test('simultaneous wallet requests reserve before asynchronous preparation',async()=>{
  const f=fixture(),q=await f.quote(),first=sendMarketSwap(f.options(q),f.deps);await assert.rejects(sendMarketSwap(f.options(q),f.deps),/pending/);await first;assert.equal(f.writes.length,1);
});
test('a late original waiter cannot downgrade recovery or replace a newer review',async()=>{
  const f=fixture(),q=await f.quote();let rejectWait!:(error:Error)=>void,notifyHash!:()=>void;
  const hashed=new Promise<void>(resolve=>{notifyHash=resolve;});
  f.deps.client.waitForTransactionReceipt=(()=>new Promise((_resolve,reject)=>{rejectWait=reject;})) as MarketSwapDependencies['client']['waitForTransactionReceipt'];
  const first=sendMarketSwap({...f.options(q),onHash:notifyHash},f.deps);const caught=first.catch(error=>error);
  await hashed;await refreshMarketTransaction(f.owner,f.deps);assert.equal(getMarketTransaction(f.owner)?.status,'confirmed');
  const firstId=getMarketTransaction(f.owner)?.requestId;
  // Start another review while the original RPC waiter is still unresolved.
  const second=sendMarketSwap(f.options(q),f.deps);const caughtSecond=second.catch(error=>error);
  const secondId=getMarketTransaction(f.owner)?.requestId;assert.notEqual(firstId,secondId);
  rejectWait(new Error('old waiter timed out'));await caught;
  assert.equal(getMarketTransaction(f.owner)?.requestId,secondId);
  // The new request may still be preparing; make its waiter terminate and retain its hash.
  for(let i=0;i<20&&getMarketTransaction(f.owner)?.status!=='pending';i++)await new Promise(resolve=>setTimeout(resolve,0));
  rejectWait(new Error('new waiter timed out'));await caughtSecond;assert.equal(getMarketTransaction(f.owner)?.requestId,secondId);assert.equal(getMarketTransaction(f.owner)?.status,'pending');
});
test('pending exact transaction survives a module reload; recovery only checks receipts',async()=>{
  let raw='';Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>raw,setItem:(_k:string,value:string)=>{raw=value;}}});
  const f=fixture(),q=await f.quote();f.changes.waitError=new Error('timeout');await assert.rejects(sendMarketSwap(f.options(q),f.deps));
  const restored=await import(`../games/rare-pet/market-swap.ts?reload=${Date.now()}`);
  assert.equal(restored.getMarketTransaction(f.owner)?.hash,HASH);assert.equal(restored.getMarketTransaction(f.owner)?.status,'pending');
  f.changes.waitError=null;await restored.refreshMarketTransaction(f.owner,f.deps);assert.equal(restored.getMarketTransaction(f.owner)?.status,'confirmed');assert.equal(f.writes.length,1);
  delete (globalThis as Record<string,unknown>).sessionStorage;
});
