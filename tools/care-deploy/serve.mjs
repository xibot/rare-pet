/** Local review handoff only. The server has no signing key or transaction endpoint. */
import { build } from 'esbuild';
import { encodeDeployData, keccak256, getContractAddress } from 'viem';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDeploymentConfig, validateInitialRules, COLLECTIONS } from '../../contracts/rare-pet/script/deployment-policy.mjs';

const directory=dirname(fileURLToPath(import.meta.url));
const root=resolve(directory,'../../contracts/rare-pet');
const reviewPath=resolve(process.argv[2]||'contracts/rare-pet/deployment-review-mainnet-v1.json');
const paths={review:reviewPath,source:resolve(root,'src/RarePetCare.sol'),artifact:resolve(root,'out/RarePetCare.sol/RarePetCare.json'),rules:resolve(root,'rules.example.json'),
  controller:resolve(directory,'deployment.ts'),wallet:resolve(directory,'wallet.ts'),page:resolve(directory,'index.html')};
const saved=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,path])=>[key,await readFile(path,'utf8')])));
const review=JSON.parse(saved.review),artifact=JSON.parse(saved.artifact),config=validateDeploymentConfig(review.config);
const sourceHash=keccak256(new TextEncoder().encode(saved.source));
validateInitialRules(artifact.abi,review.initialRules);validateInitialRules(artifact.abi,JSON.parse(saved.rules));
const data=encodeDeployData({abi:artifact.abi,bytecode:artifact.bytecode.object,args:[config.admin,config.playSigner]});
if(review.status!=='UNSIGNED — no transaction sent'||review.contract!=='RarePetCare'||review.sourceHash!==sourceHash
  ||artifact.metadata?.sources?.['src/RarePetCare.sol']?.keccak256!==sourceHash||artifact.metadata?.compiler?.version!=='0.8.30+commit.73712a01'
  ||artifact.metadata?.settings?.viaIR!==true||artifact.metadata?.settings?.metadata?.bytecodeHash!=='ipfs'
  ||review.unsignedTransaction.data!==data||review.deploymentDataHash!==keccak256(data)||review.creationBytecodeHash!==keccak256(artifact.bytecode.object)
  ||review.expectedRuntime!==artifact.deployedBytecode.object||review.expectedRuntimeCodeHash!==keccak256(artifact.deployedBytecode.object)
  ||review.unsignedTransaction.from!==config.deployer||review.unsignedTransaction.chainId!==4663||review.unsignedTransaction.value!=='0x0'
  ||!Number.isSafeInteger(review.deployerNonce)||review.deployerNonce<0||BigInt(review.unsignedTransaction.nonce)!==BigInt(review.deployerNonce)
  ||getContractAddress({from:config.deployer,nonce:BigInt(review.deployerNonce)})!==review.prospectiveAddress
  ||JSON.stringify(review.collections.map(item=>item.address))!==JSON.stringify(COLLECTIONS))throw new Error('Review does not match the compiled care contract, nonce, runtime or constructor. Regenerate it before signing.');
const {compilationTarget,...settings}=artifact.metadata.settings;
const standardInput={language:'Solidity',sources:{'src/RarePetCare.sol':{content:saved.source}},settings:{...settings,outputSelection:{'*':{'*':['abi','evm.bytecode','evm.deployedBytecode','metadata']}}}};
const bundle=await build({entryPoints:[resolve(directory,'wallet.ts')],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',minify:true,define:{__REVIEW__:JSON.stringify(review)}});
const html=await readFile(resolve(directory,'index.html'));
if(process.argv.includes('--check')){console.log(`Care handoff verified: ${review.prospectiveAddress}; nonce ${review.deployerNonce}; admin ${config.admin}; PLAY XP disabled. No transaction sent.`);process.exit(0);}
const server=createServer(async(req,res)=>{
  if(!['localhost:4180','127.0.0.1:4180'].includes(req.headers.host)||!['GET','HEAD'].includes(req.method)){res.writeHead(403).end();return;}
  try{
    for(const [key,path]of Object.entries(paths))if(await readFile(path,'utf8')!==saved[key]){res.writeHead(409).end('Review or source changed. Open a newly verified handoff.');return;}
  }catch{res.writeHead(503).end('Review is unavailable.');return;}
  const path=new URL(req.url,'http://localhost:4180').pathname;
  const body=path==='/'?html:path==='/wallet.js'?bundle.outputFiles[0].contents:path==='/review.json'?JSON.stringify(review,null,2):path==='/standard-input.json'?JSON.stringify(standardInput,null,2):null;
  if(!body){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':path==='/'?'text/html':path.endsWith('.js')?'text/javascript':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' https://rpc.mainnet.chain.robinhood.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(req.method==='HEAD'?undefined:body);
});
server.listen(4180,'127.0.0.1',()=>console.log('RarePet Care deployment review: http://localhost:4180 — user wallet signature required. No transaction sent.'));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
