/** Verify a user-signed care deployment. This script is read-only. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, http, encodeDeployData, getContractAddress, keccak256 } from 'viem';
import { validateDeploymentConfig, validateInitialRules, careRulesMatch } from './deployment-policy.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = process.env.RARE_CARE_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
export async function verifyCareDeployment(hash, reviewPath, outputPath) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('A deployment transaction hash is required.');
  const review = JSON.parse(await readFile(resolve(reviewPath), 'utf8'));
  const config = validateDeploymentConfig(review.config);
  const artifact = JSON.parse(await readFile(resolve(root, 'out/RarePetCare.sol/RarePetCare.json'), 'utf8'));
  validateInitialRules(artifact.abi, review.initialRules);
  const sourceHash = keccak256(new Uint8Array(await readFile(resolve(root, 'src/RarePetCare.sol'))));
  if (review.sourceHash !== sourceHash || artifact.metadata?.sources?.['src/RarePetCare.sol']?.keccak256 !== sourceHash
    || keccak256(artifact.bytecode.object) !== review.creationBytecodeHash) throw new Error('Review/build/source mismatch.');
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [config.admin, config.playSigner] });
  if (keccak256(data) !== review.deploymentDataHash || data !== review.unsignedTransaction?.data) throw new Error('Constructor review does not match the current build.');
  const client = createPublicClient({ transport: http(RPC, { timeout: 30_000, retryCount: 2 }) });
  if (await client.getChainId() !== 4663) throw new Error('Wrong chain.');
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || !same(tx.blockHash, receipt.blockHash)
    || tx.blockNumber !== receipt.blockNumber) throw new Error('Transaction and receipt identities differ.');
  if (receipt.status !== 'success' || tx.to !== null || tx.value !== 0n || !same(tx.from, config.deployer)
    || tx.nonce !== review.deployerNonce || tx.input !== data || tx.chainId !== 4663) throw new Error('Deployment transaction differs from its unsigned review.');
  const address = getContractAddress({ from: config.deployer, nonce: BigInt(review.deployerNonce) });
  if (!same(address, receipt.contractAddress) || !same(address, review.prospectiveAddress)) throw new Error('Unexpected deployed address.');
  const block = await client.getBlock();
  const deployedCode = await client.getCode({ address, blockNumber: block.number });
  if (!deployedCode || keccak256(deployedCode) !== review.expectedRuntimeCodeHash
    || deployedCode !== review.expectedRuntime || deployedCode !== artifact.deployedBytecode.object) throw new Error('Deployed runtime differs from the current build or constructor simulation.');
  const read = functionName => client.readContract({ address, abi: artifact.abi, functionName, blockNumber: block.number });
  const [admin, version, rules, delay, chainId, genesis, generations] = await Promise.all(
    ['admin', 'currentRuleVersion', 'currentRules', 'RULE_DELAY', 'CHAIN_ID', 'GENESIS', 'GENERATIONS'].map(read));
  if (!same(admin, config.admin) || version !== 1n || delay !== 86400n || chainId !== 4663n
    || !same(genesis, '0x116EaA62241751E0c98dA43d458600c6C17cD361')
    || !same(generations, '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D')) throw new Error('Initial identity/admin/rule configuration differs.');
  const expected = validateInitialRules(artifact.abi, JSON.parse(await readFile(resolve(root, 'rules.example.json'), 'utf8')));
  if (!careRulesMatch(artifact.abi, rules, expected)) throw new Error('Initial rules differ from the reviewed defaults.');
  const receiptBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (!same(receiptBlock.hash, receipt.blockHash) || (await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Chain confirmation changed during verification.');
  const manifest = { version: 1, status: 'DEPLOYED — receipt, runtime, authority and initial rules verified',
    chainId: 4663, address, transactionHash: hash, deployer: config.deployer,
    verifiedAt: new Date().toISOString(), checkedBlock: String(block.number), checkedBlockHash: block.hash,
    receipt: { blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash, gasUsed: String(receipt.gasUsed) },
    sourceHash, runtimeCodeHash: keccak256(deployedCode), source: 'src/RarePetCare.sol', compiler: artifact.metadata.compiler,
    admin, ruleDelaySeconds: String(delay), currentRuleVersion: String(version), rules,
    sourceVerification: { status: 'pending', explorer: `https://robinhoodchain.blockscout.com/address/${address}?tab=contract` },
    scope: 'Read-only source/configuration checks, not a security audit. No care or rule-change transaction sent.' };
  await writeFile(resolve(outputPath), json(manifest) + '\n', { flag: 'wx' });
  console.log(json({ status: manifest.status, address, output: resolve(outputPath) }));
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 5) { console.error('Usage: node contracts/rare-pet/script/verify-deployment.mjs <tx-hash> <review.json> <new-manifest.json>'); process.exitCode = 1; }
  else verifyCareDeployment(...process.argv.slice(2)).catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
}
