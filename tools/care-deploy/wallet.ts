import { createPublicClient, http, type EIP1193Provider } from 'viem';
import { CareDeployment, type CareReview, type DeploymentState } from './deployment';
declare const __REVIEW__:CareReview;
const review=__REVIEW__;
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const button=(id:string,disabled:boolean)=>$(''+id).toggleAttribute('disabled',disabled);
const hide=(id:string,hidden:boolean)=>$(id).classList.toggle('hidden',hidden);
function detail(label:string,value:string){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);$('details').append(row);}
detail('NETWORK','Robinhood Chain mainnet · 4663');
detail('DEPLOYER · PAYS NETWORK FEE',review.config.deployer);
detail('CARE ADMINISTRATOR',review.config.admin);
detail('PET · LOCKED','1 action every 24 hours · initial reward +1 Kinship');
detail('FEED · INITIAL RULES','1 every 4 hours · +1 Strength and +5 Stamina · max 6 / rolling 24h');
detail('POOP · INITIAL RULES','1 every 4 hours · +1 Health · max 6 / rolling 24h');
detail('PLAY XP','Disabled at deployment. Future verifier activates through the 24-hour rule delay.');
detail('STREAK · INITIAL RULES','24-hour Pet grace window after cooldown · +1 Rarity every 7 uninterrupted Pets');
detail('LAUNCH · EXISTING CONTRACT','+1 Brain every 24 hours · unchanged by this deployment');
detail('ADMIN CHANGES','24-hour public delay · future rewards and allowed care settings · no history rewrite');
detail('EXPECTED CARE CONTRACT',review.prospectiveAddress);
detail('DEPLOYER NONCE',String(review.deployerNonce));
detail('SOURCE HASH',review.sourceHash);
$('validation').textContent='64 contract tests and the app checks passed. Constructor execution was simulated on Robinhood mainnet. This page rechecks the wallet, nonce, canonical collections, creation runtime and network fee before requesting a signature.';
function render(s:DeploymentState){
  button('connect',s.busy||!!s.hash||s.awaiting);
  button('estimate',s.busy||!s.account||!!s.hash||s.awaiting);
  button('deploy',s.busy||!s.account||!s.gas||!s.funded||!!s.hash||s.awaiting||!$<HTMLInputElement>('reviewed').checked);
  button('clear',s.busy);button('recover',s.busy);button('recheck',s.busy);
  hide('clear',!s.awaiting||!!s.hash);hide('recovery-panel',!s.awaiting||!!s.hash);hide('recheck',!s.hash||s.confirmed);
  $('status').textContent=s.status;$('estimate-value').textContent=s.estimate;
  hide('result',!s.hash);
  if(s.hash){$('result').replaceChildren();const p=document.createElement('p');p.textContent=s.confirmed?'Care contract verified. Send the result below back to Codex for source verification and app activation.':'Transaction saved. If confirmation is interrupted, recheck this same transaction.';const a=document.createElement('a');a.textContent=s.hash;a.href=`https://robinhoodchain.blockscout.com/tx/${s.hash}`;a.target='_blank';a.rel='noreferrer';$('result').append(p,a);}
}
const controller=new CareDeployment({review,client:createPublicClient({transport:http('https://rpc.mainnet.chain.robinhood.com',{timeout:15000,retryCount:0})}),storage:localStorage,changed:render,
  freshReview:async()=>{const response=await fetch('/review.json',{cache:'no-store'});if(!response.ok)throw new Error('Deployment review changed or is unavailable. Reload the verified local page.');return await response.json();}});
$('connect').onclick=()=>{const provider=(window as unknown as {ethereum?:EIP1193Provider}).ethereum;if(!provider){$('status').textContent='Open http://localhost:4180 in the browser with your wallet extension.';return;}void controller.connect(provider);};
$('estimate').onclick=()=>void controller.checkFee();
$('deploy').onclick=async()=>{
  // A browser-wide lock prevents two open handoff tabs from submitting concurrently.
  if(!navigator.locks){$('status').textContent='Use a current Chrome or another browser with Web Locks for safe deployment handoff.';return;}
  await navigator.locks.request(controller.storageKey,{ifAvailable:true},async lock=>{
    if(!lock){$('status').textContent='Another tab is processing this deployment. Continue there.';return;}
    await controller.deploy($<HTMLInputElement>('reviewed').checked);
  });
};
$('recheck').onclick=()=>void controller.recheck();
$('recover').onclick=()=>void controller.recover($<HTMLInputElement>('recovery').value.trim());
$('clear').onclick=()=>void controller.clearCancelled();
$('reviewed').onchange=()=>render(controller.state);
render(controller.state);
