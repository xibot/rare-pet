/** Read-only verification of an existing deployment; no signer or transaction submission. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256, getAddress, formatEther, parseAbi, zeroAddress } from 'viem';
import { readDeploymentCatalog, rehearsalMatches } from './deployment-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = process.argv[2];
if (!/^0x[0-9a-f]{64}$/i.test(hash ?? '')) throw new Error('Provide the public deployment transaction hash.');
const address = getAddress('0x8c46baA63079B8648b1cd5689058E0AAB33DF063');
const review = JSON.parse(await readFile(resolve(root, 'deployment-review.json'), 'utf8'));
const proof = JSON.parse(await readFile(resolve(root, 'state-override-review.json'), 'utf8'));
const artifact = JSON.parse(await readFile(resolve(root, 'out/RarePetLaunchRouter.sol/RarePetLaunchRouter.json'), 'utf8'));
const snapshot = readDeploymentCatalog();
const sourceHash = keccak256(new Uint8Array(await readFile(resolve(root, 'src/RarePetLaunchRouter.sol'))));
if (!rehearsalMatches(proof, review) || snapshot.catalogHash !== review.catalogHash || sourceHash !== review.sourceHash || artifact.metadata.sources['src/RarePetLaunchRouter.sol'].keccak256 !== sourceHash) throw new Error('Source, catalog or review binding mismatch.');
const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com', { batch: { batchSize: 30, wait: 20 }, timeout: 20000, retryCount: 1 }), cacheTime: 0 });
if (await client.getChainId() !== 4663) throw new Error('Wrong chain.');
const block = await client.getBlock(); const blockNumber = block.number;
const [tx, receipt, code] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash }), client.getCode({ address, blockNumber })]);
const equal = (a, b) => a.toLowerCase() === b.toLowerCase();
if (receipt.status !== 'success' || !receipt.contractAddress || !equal(receipt.contractAddress, address) || !equal(tx.from, review.config.deployer) || tx.to !== null || tx.nonce !== 0 || tx.value !== 0n || tx.chainId !== 4663 || tx.blockHash !== receipt.blockHash || tx.input !== review.unsignedTransaction.data || keccak256(tx.input) !== review.deploymentDataHash) throw new Error('Deployment transaction or receipt does not match the reviewed exact constructor.');
if (!code || code === '0x' || keccak256(code) !== proof.runtimeCodeHash) throw new Error('Runtime differs from the exact reviewed constructor-produced runtime.');
// Independently compare every non-immutable byte with the local compiler output.
let normalized = code.slice(2);
for (const offsets of Object.values(artifact.deployedBytecode.immutableReferences)) for (const { start, length } of offsets) normalized = normalized.slice(0, start * 2) + '0'.repeat(length * 2) + normalized.slice((start + length) * 2);
if (`0x${normalized}` !== artifact.deployedBytecode.object) throw new Error('Normalized deployed runtime differs from local compiled bytecode.');
const read = (functionName, args) => client.readContract({ address, abi: artifact.abi, functionName, args, blockNumber });
const expected = {
  CHAIN_ID: 4663n, COOLDOWN: 86400n, TICK_SPACING: 200, WAD: 10n ** 18n,
  treasury: review.config.treasury, totalSupply: BigInt(review.config.totalSupply), friendShares: 850000000000000000n,
  treasuryShares: 100000000000000000n, PROTOCOL_SHARES: 50000000000000000n,
  GENESIS: '0x116EaA62241751E0c98dA43d458600c6C17cD361', GENERATIONS: '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D',
  AIRLOCK: review.airlock.address, TOKEN_FACTORY: review.modules.find(m=>m.name==='tokenFactory').address,
  INITIALIZER: review.modules.find(m=>m.name==='initializer').address, GOVERNANCE: review.modules.find(m=>m.name==='governance').address,
  MIGRATOR: review.modules.find(m=>m.name==='migrator').address,
};
const getters = {};
await Promise.all(Object.entries(expected).map(async ([key, value]) => {
  const result = await read(key);
  if (typeof value === 'string' ? !equal(result, value) : result !== value) throw new Error(`Getter mismatch: ${key}`);
  getters[key] = typeof result === 'bigint' ? result.toString() : result;
}));
const quotes = await read('quoteTokens');
if (quotes.length !== snapshot.quotes.length || quotes.some((quote, i)=>!equal(quote, snapshot.quotes[i].address))) throw new Error('Deployed quote list differs in length, order or identity.');
for (let i = 0; i < quotes.length; i += 24) {
  const allowed = await Promise.all(quotes.slice(i, i + 24).map(quote=>read('allowedQuote', [quote])));
  if (allowed.some(value=>value!==true)) throw new Error('A catalog entry is not allowed.');
}
if (await read('allowedQuote', [zeroAddress])) throw new Error('Zero-address quote unexpectedly allowed.');
const airlockAbi = parseAbi(['function getModuleState(address) view returns(uint8)', 'function owner() view returns(address)']);
const protocol = await client.readContract({ address: review.airlock.address, abi: airlockAbi, functionName: 'owner', blockNumber });
const modules = await Promise.all(review.modules.map(async module => {
  const [state, moduleCode] = await Promise.all([client.readContract({ address: review.airlock.address, abi: airlockAbi, functionName: 'getModuleState', args: [module.address], blockNumber }), client.getCode({ address: module.address, blockNumber })]);
  if (state !== module.state || !moduleCode || keccak256(moduleCode) !== module.codeHash) throw new Error(`Doppler module approval or bytecode changed: ${module.name}`);
  return { ...module, state };
}));
const sampleCreator = proof.friend.wallet;
const beneficiaries = await read('feeBeneficiaries', [sampleCreator]);
const desired = new Map([[sampleCreator.toLowerCase(),850000000000000000n],[review.config.treasury.toLowerCase(),100000000000000000n],[protocol.toLowerCase(),50000000000000000n]]);
if (beneficiaries.length !== 3 || beneficiaries.some(b=>desired.get(b.beneficiary.toLowerCase()) !== b.shares)) throw new Error('Fee beneficiaries mismatch.');
const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
const again = await client.getBlock({ blockNumber });
if (canonical.hash !== receipt.blockHash || again.hash !== block.hash || await client.getChainId() !== 4663) throw new Error('Verification chain or block changed.');
const manifest = {
  version: 1, status: 'DEPLOYED — transaction, runtime and configuration independently verified', chainId: 4663, address,
  transactionHash: hash, deployer: tx.from, deployedAt: { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, timestamp: new Date(Number(canonical.timestamp) * 1000).toISOString() },
  verifiedAt: { blockNumber: blockNumber.toString(), blockHash: block.hash, timestamp: new Date().toISOString() },
  receipt: { status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), networkFeeETH: formatEther(receipt.gasUsed * receipt.effectiveGasPrice), confirmationsAtVerification: (blockNumber - receipt.blockNumber + 1n).toString() },
  source: { path: 'src/RarePetLaunchRouter.sol', contract: 'RarePetLaunchRouter', sourceHash, compiler: artifact.metadata.compiler, settings: artifact.metadata.settings },
  integrity: { deploymentDataHash: review.deploymentDataHash, creationBytecodeHash: review.creationBytecodeHash, runtimeCodeHash: keccak256(code), compiledRuntimeMatchesAfterImmutableNormalization: true, exactReviewedConstructorRuntimeMatches: true, catalogSha256: snapshot.catalogHash },
  configuration: { treasury: review.config.treasury, totalSupply: review.config.totalSupply, feePercent: { creator: 85, treasury: 10, protocol: 5 }, getters, protocolBeneficiaryAtVerification: protocol, modules, quoteCount: quotes.length, quotes: snapshot.quotes },
  sourceVerification: { status: 'pending', explorer: `https://robinhoodchain.blockscout.com/address/${address}?tab=contract` },
  scope: 'Read-only post-deployment verification. No launch or fee-claim transaction was sent. Verification is not an audit of local or upstream contracts.',
};
const output = resolve(root, 'deployments/4663.json'); await mkdir(dirname(output), {recursive:true});
await writeFile(output, `${JSON.stringify(manifest,null,2)}\n`, {flag:'wx'});
console.log(JSON.stringify({address,transactionHash:hash,deployedAt:manifest.deployedAt,verifiedAt:manifest.verifiedAt,quotes:quotes.length,fee:manifest.receipt.networkFeeETH,output},null,2));
