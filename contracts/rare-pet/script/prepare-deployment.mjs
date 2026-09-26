/** Read-only creation review. Never loads a private key, signs, or broadcasts. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, http, encodeDeployData, getContractAddress, keccak256, formatEther } from 'viem';
import { validateDeploymentConfig, validateInitialRules, assertReviewNonce, COLLECTIONS, RULE_DELAY_SECONDS } from './deployment-policy.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = process.env.RARE_CARE_RPC || 'https://rpc.mainnet.chain.robinhood.com';

export async function prepareCareDeployment(configPath, outputPath) {
  const config = validateDeploymentConfig(JSON.parse(await readFile(resolve(configPath), 'utf8')));
  const artifact = JSON.parse(await readFile(resolve(root, 'out/RarePetCare.sol/RarePetCare.json'), 'utf8'));
  const initialRules = validateInitialRules(artifact.abi, JSON.parse(await readFile(resolve(root, 'rules.example.json'), 'utf8')));
  const source = await readFile(resolve(root, 'src/RarePetCare.sol'));
  const sourceHash = keccak256(new Uint8Array(source));
  const settings = artifact.metadata?.settings;
  if (artifact.metadata?.sources?.['src/RarePetCare.sol']?.keccak256 !== sourceHash) throw new Error('Compiled source is stale. Rebuild RarePetCare.');
  if (artifact.metadata?.compiler?.version !== '0.8.30+commit.73712a01' || settings?.viaIR !== true
    || settings?.evmVersion !== 'cancun' || settings?.optimizer?.enabled !== true || settings?.optimizer?.runs !== 200
    || settings?.metadata?.bytecodeHash !== 'ipfs') throw new Error('Unexpected care compiler settings.');
  if (!artifact.bytecode?.object || artifact.bytecode.object === '0x') throw new Error('Missing creation bytecode.');
  const client = createPublicClient({ transport: http(RPC, { timeout: 30_000, retryCount: 2 }) });
  if (await client.getChainId() !== config.chainId) throw new Error('RPC returned the wrong chain.');
  const block = await client.getBlock();
  if (!block.hash) throw new Error('Could not pin the review block.');
  const nonce = await client.getTransactionCount({ address: config.deployer, blockNumber: block.number });
  assertReviewNonce(nonce, nonce, await client.getTransactionCount({ address: config.deployer, blockTag: 'pending' }));
  const prospectiveAddress = getContractAddress({ from: config.deployer, nonce: BigInt(nonce) });
  const code = await client.getCode({ address: prospectiveAddress, blockNumber: block.number });
  if (code && code !== '0x') throw new Error('Prospective address already has code.');
  const collections = await Promise.all(COLLECTIONS.map(async address => {
    const code = await client.getCode({ address, blockNumber: block.number });
    if (!code || code === '0x') throw new Error(`Canonical collection missing: ${address}`);
    return { address, codeHash: keccak256(code) };
  }));
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [config.admin, config.playSigner] });
  const [call, gas, gasPrice, balance] = await Promise.all([
    client.call({ account: config.deployer, data, value: 0n, blockNumber: block.number }),
    client.estimateGas({ account: config.deployer, data, value: 0n, blockNumber: block.number }),
    client.getGasPrice(), client.getBalance({ address: config.deployer, blockNumber: block.number }),
  ]);
  if (!call.data || call.data === '0x') throw new Error('Constructor simulation did not return runtime code.');
  if (call.data !== artifact.deployedBytecode.object) throw new Error('Constructor runtime differs from the compiled care contract.');
  if ((call.data.length - 2) / 2 > 24_576) throw new Error('Runtime exceeds the EVM contract size limit.');
  if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Review block changed. Retry.');
  const [latestNonce, pendingNonce] = await Promise.all([
    client.getTransactionCount({ address: config.deployer, blockTag: 'latest' }),
    client.getTransactionCount({ address: config.deployer, blockTag: 'pending' }),
  ]);
  assertReviewNonce(nonce, latestNonce, pendingNonce);
  const review = {
    version: 1, status: 'UNSIGNED — no transaction sent', contract: 'RarePetCare', createdAt: new Date().toISOString(), config, initialRules,
    verifiedAt: { chainId: config.chainId, blockNumber: String(block.number), blockHash: block.hash },
    policy: { ruleDelaySeconds: RULE_DELAY_SECONDS, lifetimeRecords: 'Append-only; no admin edit/reset/import, proxy or delegatecall.',
      play: 'Rewards disabled until a reviewed completion service is activated through the timelock.',
      launch: 'Separate existing Doppler V1 router; +1 Brain and 24-hour cooldown unchanged.' },
    compiler: artifact.metadata.compiler, settings, sourceHash, creationBytecodeHash: keccak256(artifact.bytecode.object),
    deploymentDataHash: keccak256(data), expectedRuntimeCodeHash: keccak256(call.data), expectedRuntime: call.data,
    collections, prospectiveAddress, deployerNonce: nonce,
    networkFeeEstimate: { gas: String(gas), gasPriceWei: String(gasPrice), estimatedETH: formatEther(gas * gasPrice), balanceETH: formatEther(balance) },
    unsignedTransaction: { chainId: config.chainId, from: config.deployer, nonce: `0x${nonce.toString(16)}`, data, value: '0x0', gas: `0x${((gas * 120n + 99n) / 100n).toString(16)}` },
    remaining: ['Review admin and permanent ledger/rule policy.', 'Sign deployment in the reviewed wallet only when ready.', 'Verify receipt, runtime, admin, initial rules and source before configuring RAREPET_CONTRACT_ADDRESS.'],
  };
  await writeFile(resolve(outputPath), `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: review.status, prospectiveAddress, admin: config.admin, blockNumber: String(block.number), estimatedGas: String(gas), estimatedETH: review.networkFeeEstimate.estimatedETH, output: resolve(outputPath) }));
  return review;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node contracts/rare-pet/script/prepare-deployment.mjs <reviewed-config.json> <new-review.json>'); process.exitCode = 1; }
  else prepareCareDeployment(process.argv[2], process.argv[3]).catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
}
