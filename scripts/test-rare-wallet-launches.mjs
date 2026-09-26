import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Exercise real wallet/history React components and persistent stores with injected domain reads.
// Real protocol simulations, owner authorization and exact receipt proofs are tested separately.
// No wallet extension, external RPC, upload or transaction can run from this isolated page.
const outdir = await mkdtemp(path.join(tmpdir(), 'rare-wallet-launches-'));
const artifacts = path.resolve('artifacts/rare-wallet-launches');
await mkdir(artifacts, { recursive: true });
const project = process.cwd(), router = '0x7777777777777777777777777777777777777777';
const owner = '0x1111111111111111111111111111111111111111';
const wallet = '0x2222222222222222222222222222222222222222';
const otherWallet = '0x3333333333333333333333333333333333333333';
const token = '0x4444444444444444444444444444444444444444';
const otherToken = '0x5555555555555555555555555555555555555555';
const hash = `0x${'ab'.repeat(32)}`;
const modules = {
  wallet: `export const PET_DEPLOYMENT={chainId:4663,explorer:'https://robinhoodchain.blockscout.com'}; export const RARE_PET_CHAIN={id:4663}; export function createPetPublicClient(){throw new Error('Real RPC forbidden');} export function verifyPet(){throw new Error('Real identity RPC forbidden');}`,
  'rare-wallet-holdings': `import {formatUnits} from 'viem'; export function formatHoldingBalance(amount,decimals){return amount===null?'Unavailable':formatUnits(amount,decimals??0)} export async function readNativeBalance(wallet){window.test.reads.push({kind:'balance',wallet});return {kind:'native',symbol:'ETH',name:'Ether',balance:10n**18n,decimals:18,blockNumber:20n,source:'rpc'}} export function readTokenHolding(){throw new Error('No import fixture')} export function readNftHolding(){throw new Error('No import fixture')}`,
  'rare-wallet-inventory': `export async function readRareWalletInventory(wallet){window.test.reads.push({kind:'inventory',wallet});return {tokens:[],nfts:[],warnings:[],complete:true,cursor:null}}`,
  'launch-doppler': `
    export class RareLaunchTransactionError extends Error {constructor(code,message){super(message);this.code=code}}
    export async function readRareLaunchHistory({pet}) {
      const wallet=pet.walletAddress; window.test.reads.push({kind:'history',wallet});
      if(window.test.holdHistory) await new Promise(resolve=>window.test.releaseHistory=resolve);
      return {items:[{asset:wallet==='${wallet}'?'${token}':'${otherToken}',hash:'${hash}',timestamp:1800000000n,quote:'0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',fee:10000}],blockNumber:20n,incomplete:false};
    }
    export function readRareSelfLaunchHistory(){throw new Error('Owner launch history leaked into RF wallet')}
    export async function readRareLaunchFees({asset,wallet}) {
      window.test.reads.push({kind:'fees',wallet,asset});
      if(window.test.holdFees) await new Promise(resolve=>window.test.releaseFees=resolve);
      return {asset,wallet,amount0:2n*10n**18n,amount1:3n*10n**18n,token0:asset,token1:'0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'};
    }
    export async function claimRareLaunchFees(options) {
      options.assertActive(); window.test.claims.push({wallet:options.pet.walletAddress,owner:options.pet.owner,asset:options.asset});
      options.onWalletRequest(); if(window.test.holdProvider) await new Promise(resolve=>window.test.releaseProvider=resolve);
      options.onHash('${hash}'); if(window.test.holdReceipt) await new Promise(resolve=>window.test.releaseReceipt=resolve);
      return {hash:'${hash}'};
    }
    export function claimRareSelfLaunchFees(){throw new Error('Fee claim must execute from the RF wallet')}
    export async function confirmRareLaunchFeeClaim(input){window.test.rechecks.push(input);if(input.mode!=='friend'||input.wallet!=='${wallet}'||input.owner!=='${owner}')throw new Error('Wrong recovery identity');return {hash:input.hash}}
  `,
};
const entry = `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {RareWalletDialog} from './games/rare-pet/RareWalletDialog';
  import {LaunchHistory} from './games/rare-pet/LaunchHistory';
  import './games/rare-pet/launch.css';
  import {setLaunchClaim} from './games/rare-pet/launch-claim-record';
  import {setRareWalletTransfer} from './games/rare-pet/rare-wallet-transactions';
  const root=createRoot(document.getElementById('root'));let revision=1,instance=0;
  const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="white"/></svg>');
  const provider={request(){throw new Error('No real signing provider')}};
  const session={getSnapshot:()=>({status:'connected',account:'${owner}',chainId:4663,revision}),getProvider:()=>provider};
  const friend=i=>({collection:'genesis',chainId:4663,contract:'0x116EaA62241751E0c98dA43d458600c6C17cD361',tokenId:String(i),label:'Genesis #'+i,image,owner:'${owner}',walletAddress:i===1?'${wallet}':'${otherWallet}',generation:null,blockNumber:'20',rushEligible:true});
  window.test={reads:[],claims:[],rechecks:[],holdHistory:false,holdFees:false,holdProvider:false,holdReceipt:false,
    open(mode='friend1'){const pet=mode==='preview'?null:friend(mode==='friend1'?1:2);root.render(<RareWalletDialog key={++instance} friend={pet??friend(1)} pet={pet} session={session} revision={revision} bodyId="classic" close={()=>root.render(null)} chooseFriend={()=>root.render(null)}/>);},
    openWhite(){root.render(<div className="launch-content" style={{background:'#fff'}}><LaunchHistory mode="friend" creator="${wallet}" pet={friend(1)} session={session} revision={revision} router="${router}" refresh={null}/></div>)},
    invalidate(){revision++;root.render(null)},
    blockTransfer(){setRareWalletTransfer('${wallet}',{owner:'${owner}',intent:{kind:'native',to:'${otherWallet}',amount:1n},hash:'${hash}',status:'pending'})},
    clearTransfer(){setRareWalletTransfer('${wallet}',null)},
    clearClaim(){setLaunchClaim('${wallet}',null)},
  }; window.test.open('preview');
`;
let server, browser;
try {
  await build({ absWorkingDir: project, stdin: { contents: entry, resolveDir: project, sourcefile: 'wallet-launch-harness.tsx', loader: 'tsx' }, outfile: path.join(outdir, 'index.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', loader: { '.woff2': 'file' }, define: { 'process.env.NODE_ENV': '"production"', __RAREPET_CONTRACT__: '""', __RAREPET_LAUNCHPAD__: JSON.stringify(router), __RAREPET_LAUNCH_STORAGE__: 'false' }, plugins: [{ name: 'injected-read-boundaries', setup(build) {
    build.onResolve({ filter: /^\.\/((?:launch-doppler|wallet|rare-wallet-holdings|rare-wallet-inventory))(?:\.ts)?$/ }, args => ({ path: args.path.replace(/^\.\//, '').replace(/\.ts$/, ''), namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: modules[args.path], loader: 'js', resolveDir: project }));
  } }], logLevel: 'silent' });
  await writeFile(path.join(outdir, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/index.css"><style>:root{--rush-font-mono:monospace;--rush-font-display:monospace}body{background:#000}.pet-dialog{border:2px solid white;padding:0}.dialog-heading{display:flex;align-items:center;justify-content:space-between;padding:12px}.dialog-heading svg{width:18px}</style></head><body><div id="root"></div><script type="module" src="/index.js"></script></body></html>');
  server = createServer(async (req,res) => {const name=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','index.js','index.css'].includes(name)){res.writeHead(404).end();return}res.setHeader('content-type',name.endsWith('js')?'application/javascript':name.endsWith('css')?'text/css':'text/html');res.end(await readFile(path.join(outdir,name)))});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)}); const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'chrome',headless:true}); const context=await browser.newContext({viewport:{width:1000,height:900},permissions:['clipboard-read','clipboard-write']});
  const errors=[], external=[]; const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*', route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort()});
  const dialog=()=>page.getByRole('dialog',{name:'RARE WALLET',exact:true});
  await page.goto(origin);await dialog().getByRole('heading',{name:'TOKENS LAUNCHED',exact:true}).waitFor();
  assert.match(await dialog().innerText(),/Preview only/);assert.equal((await page.evaluate(()=>window.test.reads)).length,0);assert.equal(await dialog().getByRole('button',{name:'CHECK FEES',exact:true}).count(),0);
  await page.evaluate(()=>window.test.open());await dialog().getByText(token,{exact:true}).waitFor();
  assert.equal(await dialog().locator('.launch-token-ca code').innerText(),token);assert.equal(await dialog().getByRole('link',{name:'VIEW TOKEN ↗',exact:true}).getAttribute('href'),`https://robinhoodchain.blockscout.com/token/${token}`);
  await dialog().getByRole('button',{name:`Copy contract address ${token}`,exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),token);
  await page.evaluate(()=>window.test.blockTransfer());assert.equal(await dialog().getByRole('button',{name:'CHECK FEES',exact:true}).isDisabled(),true);await page.evaluate(()=>window.test.clearTransfer());
  await dialog().getByRole('button',{name:'CHECK FEES',exact:true}).click();await dialog().getByRole('heading',{name:'Review fee claim',exact:true}).waitFor();
  const claimReview=await dialog().locator('.launch-claim-review').innerText();assert(claimReview.includes(wallet));assert(claimReview.includes('owner wallet pays the ETH network fee'));assert(!claimReview.includes(`creator wallet: ${owner}`));
  await page.evaluate(()=>{window.test.holdProvider=true;window.test.holdReceipt=true});
  await dialog().getByRole('button',{name:'CLAIM TO RARE WALLET ↗',exact:true}).click();
  await page.waitForFunction(()=>window.test.claims.length===1);
  assert.equal(await dialog().getByRole('button',{name:'Close Rare Wallet'}).isDisabled(),true);assert.equal(await dialog().getByRole('button',{name:/^SEND TOKENS/}).isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.test.claims[0]),{wallet,owner,asset:token});
  await page.evaluate(()=>window.test.releaseProvider());await dialog().getByRole('link',{name:'VIEW FEE CLAIM ↗',exact:true}).waitFor();
  assert.equal(await dialog().getByRole('button',{name:'Close Rare Wallet'}).isEnabled(),true);
  await dialog().getByRole('button',{name:'Close Rare Wallet'}).click();await page.evaluate(()=>window.test.open('friend2'));await dialog().getByText(otherToken,{exact:true}).waitFor();
  assert.equal(await dialog().getByText(token,{exact:true}).count(),0);assert.equal(await dialog().getByRole('link',{name:'VIEW FEE CLAIM ↗',exact:true}).count(),0);assert.equal(await dialog().getByRole('button',{name:/^SEND TOKENS/}).isEnabled(),true);
  await page.reload();await page.evaluate(()=>window.test.open());await dialog().getByRole('button',{name:'RECHECK CLAIM',exact:true}).waitFor();
  assert.equal(await dialog().getByRole('button',{name:/^SEND TOKENS/}).isDisabled(),true);const readsBefore=await page.evaluate(()=>window.test.reads.filter(x=>x.kind==='inventory').length);
  await dialog().getByRole('button',{name:'RECHECK CLAIM',exact:true}).click();await dialog().getByText('Last fee claim confirmed.',{exact:true}).waitFor();
  await page.waitForFunction(before=>window.test.reads.filter(x=>x.kind==='inventory').length>before,readsBefore);
  assert.equal(await page.evaluate(()=>window.test.claims.length),0,'recovery cannot prompt or resend');assert.equal(await page.evaluate(()=>window.test.rechecks.length),1);
  assert.equal(await dialog().getByRole('button',{name:/^SEND TOKENS/}).isEnabled(),true);
  // A stale history or fee read must never populate a different selected Friend.
  await page.evaluate(()=>{window.test.clearClaim();window.test.holdHistory=true;window.test.open()});await page.waitForFunction(()=>!!window.test.releaseHistory);
  await page.evaluate(()=>{window.test.holdHistory=false;window.test.open('friend2')});await dialog().getByText(otherToken,{exact:true}).waitFor();await page.evaluate(()=>window.test.releaseHistory());
  assert.equal(await dialog().getByText(token,{exact:true}).count(),0);
  await page.evaluate(()=>{window.test.holdFees=true;window.test.open()});await dialog().getByRole('button',{name:'CHECK FEES',exact:true}).click();await page.waitForFunction(()=>!!window.test.releaseFees);
  await page.evaluate(()=>{window.test.invalidate();window.test.holdFees=false;window.test.open('friend2')});await dialog().getByText(otherToken,{exact:true}).waitFor();await page.evaluate(()=>window.test.releaseFees());
  assert.equal(await dialog().getByRole('heading',{name:'Review fee claim',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.test.claims.length),0);
  await page.setViewportSize({width:320,height:844});await page.evaluate(()=>window.test.open());await dialog().getByText(token,{exact:true}).waitFor();
  await dialog().getByRole('button',{name:'CHECK FEES',exact:true}).click();await dialog().getByRole('heading',{name:'Review fee claim',exact:true}).waitFor();
  assert.equal(await dialog().evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'Populated wallet and claim review fit320px');
  assert.equal(await dialog().locator('.rw-content').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'Full CA fits wallet content');
  await dialog().locator('.rw-launched-tokens').screenshot({path:path.join(artifacts,'wallet-tokens-and-claim-320.png')});
  await page.evaluate(()=>window.test.openWhite());const white=page.locator('.launch-content');await white.getByText(token,{exact:true}).waitFor();
  await white.getByRole('button',{name:'CHECK FEES',exact:true}).click();await white.getByRole('heading',{name:'Review fee claim',exact:true}).waitFor();
  assert.equal(await white.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'Shared white Launchpad history and claim fit320px');
  assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth),false,'White Launchpad has no page overflow');
  await white.screenshot({path:path.join(artifacts,'white-launch-history-320.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();
  console.log('Rare Wallet launched tokens: full CA/copy/explorer, RF-only claims, transfer/request locks, pending close+reload recovery, holdings refresh, preview zero reads and stale identity isolation passed. No real RPC or signatures.');
} finally {await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());await rm(outdir,{recursive:true,force:true})}
