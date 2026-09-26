/** Local deployment handoff. The server cannot sign or broadcast; wallet approval happens in the user's browser. */
import { build } from 'esbuild';
import { encodeDeployData, keccak256 } from 'viem';
import { validateDeploymentConfig, QUOTES } from '../../contracts/rare-launchpad/script/prepare-deployment.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = dirname(fileURLToPath(import.meta.url));
const review = JSON.parse(await readFile(resolve(process.argv[2] || 'contracts/rare-launchpad/deployment-review.json'), 'utf8'));
if (review.status !== 'UNSIGNED — no transaction sent' || review.config.chainId !== 4663 || review.config.friendFeeBps !== 8500 || !review.unsignedTransaction?.data?.startsWith('0x')) throw new Error('Use the generated, reviewed RarePet deployment file.');
const config = validateDeploymentConfig(review.config);
const contractRoot = resolve(directory,'../../contracts/rare-launchpad');
const artifact = JSON.parse(await readFile(resolve(contractRoot,'out/RarePetLaunchRouter.sol/RarePetLaunchRouter.json'),'utf8'));
const sourceHash = keccak256(new Uint8Array(await readFile(resolve(contractRoot,'src/RarePetLaunchRouter.sol'))));
const data = encodeDeployData({ abi:artifact.abi, bytecode:artifact.bytecode.object, args:[config.treasury,BigInt(config.totalSupply),config.friendFeeBps,QUOTES.map(quote=>quote.address)] });
if (review.sourceHash !== sourceHash || artifact.metadata?.sources?.['src/RarePetLaunchRouter.sol']?.keccak256 !== sourceHash || review.creationBytecodeHash !== keccak256(artifact.bytecode.object) || review.unsignedTransaction.data !== data || review.unsignedTransaction.from !== config.deployer || review.unsignedTransaction.chainId !== 4663 || review.unsignedTransaction.value !== '0x0' || JSON.stringify(review.quotes.map(({symbol,address})=>({symbol,address}))) !== JSON.stringify(QUOTES)) throw new Error('The displayed review does not match current source, bytecode or constructor configuration. Regenerate it before signing.');
const result = await build({ entryPoints: [resolve(directory,'wallet.ts')], bundle: true, write: false, platform: 'browser', format: 'esm', target:'es2022', minify:true, define:{ __REVIEW__:JSON.stringify(review) } });
const html = await readFile(resolve(directory,'index.html'));
const server = createServer((req,res) => {
  if (!['127.0.0.1:4180','localhost:4180'].includes(req.headers.host) || !['GET','HEAD'].includes(req.method)) { res.writeHead(403).end(); return; }
  const pathname = new URL(req.url,'http://localhost:4180').pathname;
  const body = pathname === '/' ? html : pathname === '/wallet.js' ? result.outputFiles[0].contents : pathname === '/review.json' ? JSON.stringify(review,null,2) : null;
  if (!body) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'Content-Type':pathname === '/' ? 'text/html' : pathname.endsWith('.js') ? 'text/javascript' : 'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src https://rpc.mainnet.chain.robinhood.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
  res.end(req.method === 'HEAD' ? undefined : body);
});
server.listen(4180,'127.0.0.1',()=>console.log('Rare Launchpad deployment review: http://localhost:4180 — connect your browser wallet to review and sign.'));
