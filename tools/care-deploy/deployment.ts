import { encodeFunctionResult, getContractAddress, keccak256, parseAbi, toHex, formatEther, type Address, type Hex, type EIP1193Provider, type PublicClient } from 'viem';

export type Rules = { actions: readonly { points:number; secondaryPoints:number; cooldown:number; dailyLimit:number; enabled:boolean }[];
  petGrace:number; decayInterval:number; decayPoints:number; rarityEvery:number; rarityPoints:number; playSigner:Address };
export type CareReview = { status:string; contract:string; config:{chainId:4663;admin:Address;deployer:Address;playSigner:Address};
  sourceHash:Hex; deploymentDataHash:Hex; expectedRuntime:Hex; expectedRuntimeCodeHash:Hex; prospectiveAddress:Address; deployerNonce:number;
  initialRules:Rules; collections:{address:Address;codeHash:Hex}[]; unsignedTransaction:{chainId:4663;from:Address;data:Hex;value:Hex;nonce:Hex;gas:Hex} };
export const abi = parseAbi([
  'function admin() view returns (address)', 'function currentRuleVersion() view returns (uint256)',
  'function RULE_DELAY() view returns (uint256)', 'function CHAIN_ID() view returns (uint256)',
  'function GENESIS() view returns (address)', 'function GENERATIONS() view returns (address)',
  'function currentRules() view returns (((uint32 points,uint32 secondaryPoints,uint32 cooldown,uint8 dailyLimit,bool enabled)[4] actions,uint32 petGrace,uint32 decayInterval,uint32 decayPoints,uint16 rarityEvery,uint32 rarityPoints,address playSigner) rules)',
]);
const equal = (a:string|null|undefined,b:string|null|undefined) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const fail = (message:string):never => {throw new Error(message);};
const message = (cause:unknown) => cause instanceof Error ? cause.message : 'The deployment check could not complete.';
const zero = '0x0000000000000000000000000000000000000000';
function encodeRules(rules:Rules) {
  if (rules.actions.length !== 4) fail('The care review must contain four action rules.');
  return encodeFunctionResult({abi,functionName:'currentRules',result:{...rules, actions:rules.actions as readonly [Rules['actions'][number],Rules['actions'][number],Rules['actions'][number],Rules['actions'][number]]}});
}
export function validateReview(review:CareReview) {
  if (review.status !== 'UNSIGNED — no transaction sent' || review.contract !== 'RarePetCare' || review.config.chainId !== 4663
    || !Number.isSafeInteger(review.deployerNonce) || review.deployerNonce < 0 || !equal(review.config.playSigner,zero)
    || review.unsignedTransaction.chainId !== 4663 || !equal(review.unsignedTransaction.from,review.config.deployer)
    || BigInt(review.unsignedTransaction.value) !== 0n || BigInt(review.unsignedTransaction.nonce) !== BigInt(review.deployerNonce)
    || keccak256(review.unsignedTransaction.data) !== review.deploymentDataHash || keccak256(review.expectedRuntime) !== review.expectedRuntimeCodeHash
    || !equal(getContractAddress({from:review.config.deployer,nonce:BigInt(review.deployerNonce)}),review.prospectiveAddress)
    || review.initialRules.actions[0]?.cooldown !== 86400 || review.initialRules.actions[0]?.dailyLimit !== 1 || !equal(review.initialRules.playSigner,zero)) fail('Invalid or inconsistent care deployment review.');
  encodeRules(review.initialRules);
}
type Storage = Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
export type DeploymentState = {busy:boolean;account:Address|null;gas:bigint|null;funded:boolean;awaiting:boolean;hash:Hex|null;confirmed:boolean;status:string;estimate:string};
type Dependencies = {review:CareReview;client:PublicClient;storage:Storage;freshReview:()=>Promise<CareReview>;changed:(state:DeploymentState)=>void};
export class CareDeployment {
  readonly review:CareReview;
  readonly storageKey:string;
  readonly state:DeploymentState = {busy:false,account:null,gas:null,funded:false,awaiting:false,hash:null,confirmed:false,status:'No transaction has been sent.',estimate:''};
  private provider:EIP1193Provider|null = null;
  readonly deps:Dependencies;
  constructor(deps:Dependencies) {
    this.deps=deps;
    validateReview(deps.review); this.review = deps.review;
    this.storageKey = `rarepet:care-deployment:4663:${this.review.config.deployer.toLowerCase()}:${this.review.deployerNonce}`;
    this.restore();
  }
  private notify(){this.deps.changed({...this.state});}
  private restore(){
    try {
      const raw = this.deps.storage.getItem(this.storageKey); if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.dataHash !== this.review.deploymentDataHash) fail('Another review used this deployment nonce.');
      if (saved.status === 'pending' && /^0x[0-9a-fA-F]{64}$/.test(saved.hash)) {
        this.state.hash = saved.hash; this.state.status = `Saved transaction: ${saved.hash}. Recheck its confirmation.`;
      } else if (saved.status === 'awaiting-wallet') {
        this.state.awaiting = true; this.state.status = 'A wallet request has an unknown outcome. Inspect wallet activity. Recover its transaction hash, or cancel the request in your wallet before clearing it here.';
      } else fail('Unrecognized saved state.');
    } catch { this.state.awaiting = true; this.state.status = 'Saved deployment state cannot be read. Inspect wallet activity before continuing; do not send a duplicate deployment.'; }
  }
  private async run(action:()=>Promise<void>){
    if(this.state.busy)return;
    this.state.busy=true;this.notify();
    try {await action();}catch(cause){this.state.status=message(cause);}finally{this.state.busy=false;this.notify();}
  }
  async connect(provider:EIP1193Provider){return this.run(async()=>{
    if(this.state.hash||this.state.awaiting)fail('Resolve the existing wallet request first.');
    this.state.account=null;this.state.gas=null;this.provider=provider;
    const accounts=await provider.request({method:'eth_requestAccounts'});
    if(!accounts[0]||!equal(accounts[0],this.review.config.deployer))fail(`Select ${this.review.config.deployer} in your wallet.`);
    await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});
    this.state.account=accounts[0];await this.signer();
    this.state.status='Deployer connected. Check the current network fee.';
  });}
  private async signer(){
    if(!this.provider||!this.state.account)fail('Connect the reviewed deployer wallet.');
    const [accounts,id]=await Promise.all([this.provider!.request({method:'eth_accounts'}),this.provider!.request({method:'eth_chainId'})]);
    if(BigInt(id)!==4663n||!equal(accounts[0],this.review.config.deployer))fail('Use the reviewed deployer on Robinhood Chain.');
  }
  private async fresh(){
    const fresh=await this.deps.freshReview();validateReview(fresh);
    if(JSON.stringify(fresh)!==JSON.stringify(this.review))fail('The local review changed. Open a fresh verified deployment page.');
  }
  private async network(){
    const c=this.deps.client,r=this.review;
    if(await c.getChainId()!==4663)fail('RPC chain mismatch.');
    const block=await c.getBlock();if(!block.hash||block.number===null)fail('Could not pin a deployment check block.');
    const [latest,pending,code,collections]=await Promise.all([
      c.getTransactionCount({address:r.config.deployer,blockNumber:block.number}),
      c.getTransactionCount({address:r.config.deployer,blockTag:'pending'}),
      c.getCode({address:r.prospectiveAddress,blockNumber:block.number}),
      Promise.all(r.collections.map(async collection=>({expected:collection.codeHash,code:await c.getCode({address:collection.address,blockNumber:block.number})}))),
    ]);
    if(latest!==r.deployerNonce||pending!==r.deployerNonce)fail('The deployer nonce changed or another transaction is pending. Prepare a fresh review.');
    if(code&&code!=='0x')fail('The expected address already has code. Inspect that deployment before continuing.');
    if(collections.some(item=>!item.code||item.code==='0x'||keccak256(item.code)!==item.expected))fail('A canonical Rare Friends collection changed. Prepare a fresh review.');
    if(!equal((await c.getBlock({blockNumber:block.number})).hash,block.hash))fail('The deployment check block changed. Check again.');
  }
  private async estimate(){
    await this.fresh();await this.signer();await this.network();
    const c=this.deps.client,r=this.review;
    const request={account:r.config.deployer,data:r.unsignedTransaction.data,value:0n,nonce:r.deployerNonce};
    const [simulation,gas,price,balance]=await Promise.all([c.call(request),c.estimateGas(request),c.getGasPrice(),c.getBalance({address:r.config.deployer})]);
    if(simulation.data!==r.expectedRuntime)fail('Creation simulation returned unexpected runtime. Do not deploy.');
    await this.signer();this.state.gas=gas;this.state.funded=balance>=(gas*120n+99n)/100n*price;
    this.state.estimate=`Estimated ${gas.toLocaleString()} gas · approximately ${formatEther(gas*price)} ETH. Balance: ${formatEther(balance)} ETH. ${this.state.funded?'Your wallet shows the final fee.':'Add ETH on Robinhood Chain, then check again.'}`;
  }
  async checkFee(){return this.run(async()=>{
    if(this.state.hash||this.state.awaiting)fail('Resolve the existing deployment before checking another fee.');
    this.state.gas=null;this.state.funded=false;await this.estimate();this.state.status='Network fee checked. Review the details before deploying.';
  });}
  async deploy(reviewed:boolean){return this.run(async()=>{
    if(!reviewed||this.state.hash||this.state.awaiting)fail('Review the deployment and resolve any earlier request first.');
    await this.estimate();if(!this.state.funded)fail('The deployer needs ETH on Robinhood Chain for the network fee.');
    await this.fresh();await this.network();await this.signer();
    if(this.deps.storage.getItem(this.storageKey)) {this.restore();fail('A deployment request is already saved. Resolve it before sending again.');}
    this.deps.storage.setItem(this.storageKey,JSON.stringify({status:'awaiting-wallet',dataHash:this.review.deploymentDataHash}));
    this.state.awaiting=true;this.state.status='Confirm contract creation in your own wallet.';this.notify();
    let hash:Hex;
    try {
      hash=await this.provider!.request({method:'eth_sendTransaction',params:[{from:this.review.config.deployer,chainId:'0x1237',
        data:this.review.unsignedTransaction.data,value:'0x0',nonce:toHex(this.review.deployerNonce),gas:toHex((this.state.gas!*120n+99n)/100n)}]});
      if(!/^0x[0-9a-fA-F]{64}$/.test(hash))fail('Wallet returned no valid transaction hash. Check wallet activity before proceeding.');
    }catch(cause){
      // Only an explicit EIP-1193 rejection proves that the wallet declined this request.
      if((cause as {code?:number})?.code===4001){this.deps.storage.removeItem(this.storageKey);this.state.awaiting=false;}
      throw cause;
    }
    this.state.hash=hash;this.state.awaiting=false;
    try{this.saveHash(hash);}catch{/* Earlier awaiting marker still blocks duplicate requests after reload. */}
    await this.confirm(hash);
  });}
  private saveHash(hash:Hex){this.deps.storage.setItem(this.storageKey,JSON.stringify({status:'pending',hash,dataHash:this.review.deploymentDataHash}));}
  async recheck(){return this.run(async()=>{if(!this.state.hash)fail('No submitted transaction is saved.');await this.confirm(this.state.hash!);});}
  async recover(hash:string){return this.run(async()=>{
    this.state.confirmed=false;
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash))fail('Enter the full deployment transaction hash from your wallet.');
    const tx=await this.deps.client.getTransaction({hash:hash as Hex});this.validateTransaction(tx);
    this.state.hash=hash as Hex;this.state.awaiting=false;try{this.saveHash(this.state.hash);}catch{}
    await this.confirm(this.state.hash);
  });}
  async clearCancelled(){return this.run(async()=>{
    if(this.state.hash||!this.state.awaiting)fail('A submitted transaction must be verified, not cleared.');
    await this.fresh();await this.network();this.deps.storage.removeItem(this.storageKey);this.state.awaiting=false;this.state.gas=null;
    this.state.status='Cancelled request cleared. Connect the deployer and check the fee again.';
  });}
  private validateTransaction(tx:Awaited<ReturnType<PublicClient['getTransaction']>>){
    const r=this.review;
    if(!equal(tx.from,r.config.deployer)||tx.to!==null||tx.input!==r.unsignedTransaction.data||tx.value!==0n||tx.nonce!==r.deployerNonce||tx.chainId!==4663)fail('The transaction does not match the reviewed care deployment.');
  }
  private async confirm(hash:Hex){
    const c=this.deps.client,r=this.review;
    this.state.confirmed=false;
    this.state.status=`Submitted: ${hash}\nWaiting for confirmation and checking the deployed contract…`;this.notify();
    if(await c.getChainId()!==4663)fail('RPC chain mismatch.');
    const receipt=await c.waitForTransactionReceipt({hash,timeout:120000,confirmations:2});
    const tx=await c.getTransaction({hash});this.validateTransaction(tx);
    if(!equal(tx.hash,hash)||!equal(receipt.transactionHash,hash)||!equal(tx.blockHash,receipt.blockHash)||tx.blockNumber!==receipt.blockNumber)fail('Transaction and receipt identities differ.');
    if(receipt.status!=='success'||!equal(receipt.contractAddress,r.prospectiveAddress))fail('Deployment reverted or produced an unexpected address. Do not activate care.');
    const block=await c.getBlock();if(!block.hash||block.number===null)fail('Could not pin a confirmation block.');
    const common={address:r.prospectiveAddress,abi,blockNumber:block.number};
    const [code,admin,version,delay,chainId,genesis,generations,rules]=await Promise.all([
      c.getCode({address:r.prospectiveAddress,blockNumber:block.number}),
      c.readContract({...common,functionName:'admin'}),c.readContract({...common,functionName:'currentRuleVersion'}),c.readContract({...common,functionName:'RULE_DELAY'}),
      c.readContract({...common,functionName:'CHAIN_ID'}),c.readContract({...common,functionName:'GENESIS'}),c.readContract({...common,functionName:'GENERATIONS'}),c.readContract({...common,functionName:'currentRules'}),
    ]);
    if(code!==r.expectedRuntime||!equal(admin,r.config.admin)||version!==1n||delay!==86400n||chainId!==4663n
      ||!equal(genesis,r.collections[0]?.address)||!equal(generations,r.collections[1]?.address)||encodeRules(rules)!==encodeRules(r.initialRules))fail('Deployed runtime, authority or starting rules differ. Do not activate care.');
    if(!equal((await c.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash)||!equal((await c.getBlock({blockNumber:block.number})).hash,block.hash))fail('Confirmation block changed. Recheck the deployment.');
    this.state.confirmed=true;this.state.status=`Deployment confirmed; runtime, admin and initial rules verified.\nContract: ${r.prospectiveAddress}\nTransaction: ${hash}\nSend this result to Codex for explorer verification and app activation.`;
  }
}
