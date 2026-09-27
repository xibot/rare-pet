import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { computePoolId } from '@whetstone-research/doppler-sdk/evm';
import { encodeFunctionData, encodePacked, zeroAddress, type Address, type Hex } from 'viem';
import { LAUNCH_QUOTE_ASSETS, getLaunchQuoteAsset } from '../games/rare-pet/launch-quotes.ts';
import { RARE_FRIENDS_POOL } from '../games/rare-pet/launch-rarefriends-price.ts';
import { buildMarketRouteCall, parseMarketRouteCandidates, readMarketRoute, recheckMarketRoute,
  verifyMarketRoutingInfrastructure, MARKET_ROUTING_DEPLOYMENT as D, type MarketRoute, type MarketRouteLeg, type MarketRoutingClient } from '../games/rare-pet/market-routing.ts';
const require = createRequire(import.meta.url);
const { V4Planner, Actions, URVersion } = require('@uniswap/v4-sdk');
const { RoutePlanner, CommandType } = require('@uniswap/universal-router-sdk');
const WETH=getLaunchQuoteAsset('weth').address, USDG=getLaunchQuoteAsset('usdg').address, BTC=getLaunchQuoteAsset('cbbtc').address;
const STOCK=LAUNCH_QUOTE_ASSETS.find(asset=>asset.symbol==='NVDA')!.address;
const OWNER='0x1111111111111111111111111111111111111111' as Address;
const BLOCK=`0x${'a'.repeat(64)}` as Hex, OTHER_BLOCK=`0x${'b'.repeat(64)}` as Hex;
const pool=(i=0)=>`0x${(100+i).toString(16).padStart(40,'0')}` as Address;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
function route(version:3|4,tokens:Address[]=[WETH,USDG],fee=500):MarketRoute{
  const legs:MarketRouteLeg[]=tokens.slice(1).map((tokenOut,i)=>{
    const tokenIn=tokens[i];
    if(version===3)return {version,tokenIn,tokenOut,fee,poolAddress:pool(i)};
    const [currency0,currency1]=[tokenIn,tokenOut].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
    const poolKey={currency0,currency1,fee,tickSpacing:10,hooks:zeroAddress};
    return {version,tokenIn,tokenOut,fee,poolKey,poolId:computePoolId(poolKey)};
  });
  return {version,tokenIn:tokens[0],tokenOut:tokens.at(-1)!,legs};
}
function raw(r:MarketRoute):any[]{
  const token=(address:Address)=>({address,chainId:4663,decimals:String(LAUNCH_QUOTE_ASSETS.find(a=>same(a.address,address))!.decimals)});
  return [r.legs.map(leg=>({type:`v${leg.version}-pool`,tokenIn:token(leg.tokenIn),tokenOut:token(leg.tokenOut),fee:String(leg.fee),
    ...leg.version===3?{address:leg.poolAddress}:{address:leg.poolId,tickSpacing:String(leg.poolKey.tickSpacing),hooks:leg.poolKey.hooks}}))];
}
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const noInfrastructure=async()=>{};
function fixture(r=route(3)){
  const state={chain:4663,reorg:false,blockCalls:0,wrongPool:false,liquidity:1n,price:1n,out:400n,outByFee:new Map<number,bigint>(),code:'0x00' as Hex};
  const reads:any[]=[],simulations:any[]=[],codeReads:any[]=[];
  const client={
    getChainId:async()=>state.chain,
    getBlock:async()=>({number:20n,hash:state.reorg&&state.blockCalls++?OTHER_BLOCK:BLOCK}),
    getCode:async(args:any)=>{codeReads.push(args);return state.code;},
    readContract:async(args:any)=>{
      reads.push(args);
      if(args.functionName==='getPool')return state.wrongPool?OWNER:(r.legs.find(leg=>same(leg.tokenIn,args.args[0])&&same(leg.tokenOut,args.args[1])) as Extract<MarketRouteLeg,{version:3}>)?.poolAddress??pool();
      if(args.functionName==='getSlot0')return [state.price,0,0,500];
      if(args.functionName==='getLiquidity')return state.liquidity;
      throw new Error(`Unexpected contract read: ${args.functionName}`);
    },
    simulateContract:async(args:any)=>{simulations.push(args);return {result:[state.outByFee.get(args.args[0]?.poolKey?.fee)??state.out,1n]};},
  } as unknown as MarketRoutingClient;
  const input={tokenIn:r.tokenIn,tokenOut:r.tokenOut,amountIn:1000n,account:OWNER,blockNumber:20n};
  const deps={client,verifyInfrastructure:noInfrastructure,fetcher:async()=>json({routes:[raw(r)]}) as any};
  return {state,reads,simulations,codeReads,client,input,deps};
}

test('parses canonical 1–3-hop paths, preserves verified identities and freezes all reviewed fields',()=>{
  for(const version of [3,4] as const)for(const tokens of [[WETH,USDG],[BTC,WETH,USDG],[BTC,WETH,USDG,STOCK]]){
    const r=route(version,tokens),[parsed]=parseMarketRouteCandidates({routes:[raw(r),raw(r)]},r);
    assert.deepEqual(parsed,r);assert.equal(parseMarketRouteCandidates({routes:[raw(r),raw(r)]},r).length,1);
    assert.ok(Object.isFrozen(parsed));assert.ok(Object.isFrozen(parsed.legs));assert.ok(parsed.legs.every(Object.isFrozen));
    if(version===4)assert.ok(parsed.legs.every(leg=>leg.version===4&&Object.isFrozen(leg.poolKey)));
  }
});
test('provider paths cannot introduce splits, mixed protocols, cycles, unrelated tokens or arbitrary hooks',()=>{
  const v3=route(3),v4=route(4),one=raw(v3),two=raw(v4);
  const invalid=[[],[...one,...one],raw(route(3,[WETH,USDG,WETH,USDG])),raw(route(3,[WETH,BTC,USDG,STOCK,WETH])),
    [[...raw(route(3,[WETH,BTC]))[0],...raw(route(4,[BTC,USDG]))[0]]],raw(route(3,[USDG,WETH]))];
  for(const field of ['address','chainId','decimals']){
    const c=structuredClone(one);c[0][0].tokenIn[field]=field==='address'?OWNER:field==='chainId'?1:'6';invalid.push(c);
  }
  for(const mutation of [{address:pool()},{type:'v2-pool'},{hooks:OWNER},{fee:'8388608'},{tickSpacing:'-1'},{address:OTHER_BLOCK}]){
    const c=structuredClone(two);Object.assign(c[0][0],mutation);invalid.push(c);
  }
  for(const candidate of invalid)assert.equal(parseMarketRouteCandidates({routes:[candidate]},v3).length,0,JSON.stringify(candidate));
  assert.throws(()=>parseMarketRouteCandidates({routes:Array(5).fill(one)},v3),/invalid/);
  assert.throws(()=>parseMarketRouteCandidates({routes:[]},{tokenIn:zeroAddress,tokenOut:WETH}),/canonical/);
});
test('provider amounts, fee recipients, calldata and token symbols never enter the reviewed route',()=>{
  const r=route(3),candidate=raw(r);Object.assign(candidate[0][0],{amountIn:'0',amountOut:'99999999999999999999999',calldata:'0xdeadbeef',recipient:OWNER,portionBips:500});
  candidate[0][0].tokenIn.symbol='FAKE';assert.deepEqual(parseMarketRouteCandidates({routes:[candidate]},r),[r]);
});
test('V3 quotes use canonical factory registration and the full packed path at one block',async()=>{
  const r=route(3,[BTC,WETH,USDG]),f=fixture(r),q=await recheckMarketRoute(r,1000n,20n,f.client,noInfrastructure);
  assert.equal(q.amountOut,400n);assert.equal(f.reads.length,2);assert.ok(f.reads.every(x=>x.address===D.v3Factory&&x.blockNumber===20n));
  assert.equal(f.simulations.length,1);assert.equal(f.simulations[0].address,D.v3Quoter);assert.equal(f.simulations[0].functionName,'quoteExactInput');
  assert.equal(f.simulations[0].args[0],encodePacked(['address','uint24','address','uint24','address'],[BTC,500,WETH,500,USDG]));
  f.state.wrongPool=true;await assert.rejects(recheckMarketRoute(r,1000n,20n,f.client,noInfrastructure),/canonical factory/);assert.equal(f.simulations.length,1);
});
test('V4 routes need initialized active pools and re-quote every hop using the prior output',async()=>{
  const r=route(4,[BTC,WETH,USDG]),f=fixture(r);await recheckMarketRoute(r,1000n,20n,f.client,noInfrastructure);
  assert.equal(f.simulations.length,2);assert.equal(f.simulations[0].args[0].exactAmount,1000n);assert.equal(f.simulations[1].args[0].exactAmount,400n);
  for(const s of f.simulations){assert.equal(s.address,D.v4Quoter);assert.equal(s.args[0].hookData,'0x');assert.equal(s.blockNumber,20n);}
  for(const mutation of [{liquidity:0n},{price:0n},{out:0n}]){Object.assign(f.state,{liquidity:1n,price:1n,out:400n},mutation);await assert.rejects(recheckMarketRoute(r,1000n,20n,f.client,noInfrastructure));}
});
test('network changes, reorgs and altered infrastructure are rejected before a usable quote exists',async()=>{
  const r=route(3),f=fixture(r);f.state.chain=1;await assert.rejects(recheckMarketRoute(r,1000n,20n,f.client,noInfrastructure),/mainnet/);
  f.state.chain=4663;f.state.reorg=true;await assert.rejects(recheckMarketRoute(r,1000n,20n,f.client,noInfrastructure),/block changed/);
  await assert.rejects(verifyMarketRoutingInfrastructure(f.client,r,20n),/verified deployment/);assert.equal(f.codeReads[0].blockNumber,20n);
  for(const amount of [0n,-1n,1n<<128n])await assert.rejects(recheckMarketRoute(r,amount,20n,f.client,noInfrastructure),/range/);
});
test('route discovery sends only the reviewed pair/amount/wallet and picks onchain output rather than API output',async()=>{
  const low=route(4,undefined,500),high=route(4,undefined,3000),f=fixture(low);f.state.outByFee.set(500,200n);f.state.outByFee.set(3000,500n);
  const a=raw(low),b=raw(high);a[0][0].amountOut='999999999999';b[0][0].amountOut='1';let request:any;
  const result=await readMarketRoute(f.input,{...f.deps,fetcher:async(url,options)=>{request={url,options};return json({routes:[a,b]});}});
  assert.equal(result.amountOut,500n);assert.equal(result.route.legs[0].fee,3000);
  assert.equal(request.url,'/api/market-routing');assert.equal(request.options.method,'POST');assert.equal(request.options.redirect,'error');assert.equal(request.options.credentials,'omit');
  assert.deepEqual(JSON.parse(request.options.body),{tokenIn:WETH,tokenOut:USDG,amount:'1000',swapper:OWNER});
});
test('canonical RareFriends fallback survives unavailable discovery but never bypasses pool verification',async()=>{
  const f=fixture(route(4,[WETH,RARE_FRIENDS_POOL.token])),deps={...f.deps,fetcher:async()=>new Response('',{status:503})};
  const q=await readMarketRoute(f.input,deps);assert.equal(q.route.legs.length,1);assert.equal(q.route.legs[0].version,4);
  const leg=q.route.legs[0] as Extract<MarketRouteLeg,{version:4}>;assert.equal(leg.poolId,RARE_FRIENDS_POOL.poolId);assert.equal(leg.poolKey.hooks,RARE_FRIENDS_POOL.hook);
  f.state.liquidity=0n;await assert.rejects(readMarketRoute(f.input,deps),/liquidity/);
});
test('no route, invalid JSON, excessive response sizes and unavailable discovery fail honestly',async()=>{
  const f=fixture();for(const response of [json({routes:[]}),new Response('',{status:503}),new Response('not json',{headers:{'content-type':'application/json'}}),json({routes:[],padding:'x'.repeat(200001)})]){
    await assert.rejects(readMarketRoute(f.input,{...f.deps,fetcher:async()=>response}));
  }assert.equal(f.simulations.length,0);
});
test('timeouts bound both fetch and streaming bodies; caller abort never falls back or requotes',async()=>{
  const f=fixture(),hangingFetch:typeof fetch=async(_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason),{once:true}));
  await assert.rejects(readMarketRoute(f.input,{...f.deps,timeoutMs:5,fetcher:hangingFetch}),/timed out/);
  let cancelled=false;const stream=new ReadableStream({cancel:()=>{cancelled=true;}});
  await assert.rejects(readMarketRoute(f.input,{...f.deps,timeoutMs:5,fetcher:async()=>new Response(stream,{headers:{'content-type':'application/json'}})}),/timed out/);assert.ok(cancelled);
  const rf=fixture(route(4,[WETH,RARE_FRIENDS_POOL.token])),controller=new AbortController();
  const promise=readMarketRoute({...rf.input,signal:controller.signal},{...rf.deps,fetcher:hangingFetch});controller.abort(new Error('cancelled by user'));
  await assert.rejects(promise,/cancelled by user/);assert.equal(rf.simulations.length,0);
});
test('V3 and V4 local calls match official Universal Router 2.1.1 SDK byte for byte for both directions and mixed decimals',()=>{
  const amountIn=123456n,minimumAmountOut=120000n,deadline=1800000120n;
  for(const version of [3,4] as const)for(const tokens of [[WETH,USDG],[USDG,WETH],[BTC,WETH,USDG],[USDG,WETH,BTC]]){
    const r=route(version,tokens),actual=buildMarketRouteCall({route:r,amountIn,minimumAmountOut,deadline}),planner=new RoutePlanner();
    if(version===3){
      const path=`0x${r.tokenIn.slice(2)}${r.legs.map(leg=>`${encodePacked(['uint24'],[leg.fee]).slice(2)}${leg.tokenOut.slice(2)}`).join('')}`;
      planner.addCommand(CommandType.V3_SWAP_EXACT_IN,['0x0000000000000000000000000000000000000001',amountIn.toString(),minimumAmountOut.toString(),path,true,[]],false,URVersion.V2_1_1);
    }else{
      const v4=new V4Planner().addAction(Actions.SWAP_EXACT_IN,[{currencyIn:r.tokenIn,path:r.legs.map(leg=>{
        assert.equal(leg.version,4);return {intermediateCurrency:leg.tokenOut,fee:leg.fee.toString(),tickSpacing:leg.poolKey.tickSpacing,hooks:leg.poolKey.hooks,hookData:'0x'};
      }),minHopPriceX36:[],amountIn:amountIn.toString(),amountOutMinimum:minimumAmountOut.toString()}],URVersion.V2_1_1)
        .addAction(Actions.SETTLE_ALL,[r.tokenIn,amountIn.toString()]).addAction(Actions.TAKE_ALL,[r.tokenOut,minimumAmountOut.toString()]);
      planner.addCommand(CommandType.V4_SWAP,[v4.finalize()]);
    }
    assert.equal(actual.data,encodeFunctionData({abi:actual.abi,functionName:'execute',args:[planner.commands,planner.inputs,deadline]}));
    assert.equal(actual.address,D.router);assert.equal(actual.value,0n);
  }
});
