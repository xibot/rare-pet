/** Read-only deployment preparation. No signer, key, wallet client, transaction send, or broadcast. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createPublicClient, encodeDeployData, formatEther, getAddress, http, isAddress, keccak256, parseAbi, getContractAddress, zeroAddress } from 'viem';

import { readDeploymentCatalog, rehearsalMatches, PREVIOUS_ROUTER, validatePreviousManifest } from './deployment-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const AIRLOCK = getAddress('0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862');
const MODULES = Object.freeze([
  ['tokenFactory', '0x1b37d3a72082029c44b35b604ea473617580b69a', 1],
  ['governance', '0x85f37f74ef2478a770318bc810177a9835911ad7', 2],
  ['initializer', '0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544', 3],
  ['migrator', '0xba2f330edb16cd8056f5988d8ce19bbc63475a0e', 4],
]);
const catalogSnapshot = readDeploymentCatalog();
export const QUOTES = catalogSnapshot.quotes;
export const CATALOG_HASH = catalogSnapshot.catalogHash;
const ABI = parseAbi(['function owner() view returns (address)', 'function getModuleState(address) view returns (uint8)', 'function decimals() view returns (uint8)']);

export function validateDeploymentConfig(input) {
  if (!input || input.chainId !== 4663 || input.totalSupply !== '1000000000000000000000000000') throw new Error('Explicit Robinhood chainId 4663 and 1 billion tokens at 18 decimals are required.');
  for (const name of ['deployer', 'treasury']) if (typeof input[name] !== 'string' || !isAddress(input[name]) || getAddress(input[name]) === zeroAddress) throw new Error(`Provide the reviewed ${name} public address.`);
  if (input.friendFeeBps !== 8500) throw new Error('The confirmed fee policy is friendFeeBps 8500: 85% creator, 10% treasury, 5% Doppler.');
  const keys = new Set(['chainId', 'deployer', 'treasury', 'friendFeeBps', 'totalSupply']);
  if (Object.keys(input).some(key => !keys.has(key))) throw new Error('Only the five documented public configuration fields are accepted. Do not provide private keys.');
  return { chainId: 4663, deployer: getAddress(input.deployer), treasury: getAddress(input.treasury), friendFeeBps: input.friendFeeBps, totalSupply: input.totalSupply };
}

async function verifyPreviousDeployment(client, manifestPath, config, artifact, sourceHash, blockNumber) {
  const raw = await readFile(resolve(manifestPath), 'utf8');
  const manifest = validatePreviousManifest(JSON.parse(raw), { sourceHash, creationBytecodeHash: keccak256(artifact.bytecode.object), treasury: config.treasury, totalSupply: config.totalSupply });
  const [code, receipt, tx] = await Promise.all([
    client.getCode({ address: PREVIOUS_ROUTER, blockNumber }),
    client.getTransactionReceipt({ hash: manifest.transactionHash }), client.getTransaction({ hash: manifest.transactionHash }),
  ]);
  const equal = (a, b) => a?.toLowerCase() === b?.toLowerCase();
  if (!code || keccak256(code) !== manifest.integrity.runtimeCodeHash || receipt.status !== 'success' || !equal(receipt.contractAddress, PREVIOUS_ROUTER)
    || receipt.blockNumber !== BigInt(manifest.deployedAt.blockNumber) || receipt.blockHash !== manifest.deployedAt.blockHash
    || tx.to !== null || !equal(tx.from, manifest.deployer) || tx.value !== 0n || tx.chainId !== 4663 || tx.blockHash !== receipt.blockHash || keccak256(tx.input) !== manifest.integrity.deploymentDataHash) throw new Error('The previous deployment receipt, creation data or runtime no longer matches its manifest.');
  if ((await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) throw new Error('The previous deployment receipt is no longer canonical.');
  let normalized = code.slice(2);
  for (const offsets of Object.values(artifact.deployedBytecode.immutableReferences)) for (const { start, length } of offsets) normalized = normalized.slice(0, start * 2) + '0'.repeat(length * 2) + normalized.slice((start + length) * 2);
  if (`0x${normalized}` !== artifact.deployedBytecode.object) throw new Error('The previous router implementation differs from the reviewed source.');
  const read = (functionName, args) => client.readContract({ address: PREVIOUS_ROUTER, abi: artifact.abi, functionName, args, blockNumber });
  await Promise.all(Object.entries(manifest.configuration.getters).map(async ([name, expected]) => {
    const actual = await read(name);
    if (typeof actual === 'string' ? !equal(actual, expected) : String(actual) !== String(expected)) throw new Error(`Previous router getter changed: ${name}`);
  }));
  const quotes = await read('quoteTokens');
  if (quotes.length !== manifest.configuration.quotes.length || quotes.some((quote, i) => !equal(quote, manifest.configuration.quotes[i].address))) throw new Error('The previous router quote catalog differs from its manifest.');
  for (let offset = 0; offset < quotes.length; offset += 24) {
    const allowed = await Promise.all(quotes.slice(offset, offset + 24).map(quote => read('allowedQuote', [quote])));
    if (allowed.some(value => value !== true)) throw new Error('The previous router has a mismatched quote flag.');
  }
  const events = artifact.abi.filter(item => item.type === 'event' && ['LaunchRecorded', 'SelfLaunchRecorded'].includes(item.name));
  const logs = await client.getLogs({ address: PREVIOUS_ROUTER, events, fromBlock: receipt.blockNumber, toBlock: blockNumber, strict: true });
  const friendLaunches = logs.filter(log => log.eventName === 'LaunchRecorded').length;
  const selfLaunches = logs.filter(log => log.eventName === 'SelfLaunchRecorded').length;
  if (friendLaunches > 0) throw new Error('The previous router has RF launches. Review Brain and cooldown migration before preparing a replacement with an empty ledger.');
  return { address: PREVIOUS_ROUTER, transactionHash: manifest.transactionHash, manifestPath: resolve(manifestPath), manifestSha256: createHash('sha256').update(raw).digest('hex'),
    runtimeCodeHash: keccak256(code), sourceHash, blockNumber: String(blockNumber), quoteCount: quotes.length, friendLaunches, selfLaunches,
    ledgerPolicy: 'No RF launches found at this read. The replacement starts with an empty launch ledger; recheck the previous router before activation. Historical tokens and fee rights remain on Doppler.' };
}

async function prepare(configPath, outputPath, previousManifestPath) {
  const config = validateDeploymentConfig(JSON.parse(await readFile(resolve(configPath), 'utf8')));
  const artifact = JSON.parse(await readFile(resolve(root, 'out/RarePetLaunchRouter.sol/RarePetLaunchRouter.json'), 'utf8'));
  if (!artifact.bytecode?.object || artifact.bytecode.object === '0x') throw new Error('Build the router first with forge build.');
  const sourceHash = keccak256(new Uint8Array(await readFile(resolve(root, 'src/RarePetLaunchRouter.sol'))));
  if (artifact.metadata?.sources?.['src/RarePetLaunchRouter.sol']?.keccak256 !== sourceHash) throw new Error('Compiled bytecode does not match the current source. Run forge build again.');
  const settings = artifact.metadata?.settings;
  if (artifact.metadata?.compiler?.version !== '0.8.30+commit.73712a01' || settings?.viaIR !== true || settings?.evmVersion !== 'cancun' || settings?.optimizer?.enabled !== true || settings?.optimizer?.runs !== 200 || settings?.metadata?.bytecodeHash !== 'none') throw new Error('Compiler settings differ from the reviewed configuration.');
  const client = createPublicClient({ transport: http(RPC, { batch: { batchSize: 30, wait: 20 }, timeout: 20000, retryCount: 2, retryDelay: 2000 }) });
  if (await client.getChainId() !== 4663) throw new Error('RPC did not report Robinhood mainnet.');
  const block = await client.getBlock(); if (!block.hash) throw new Error('Could not pin the verification block.');
  const blockNumber = block.number;
  const [treasuryCode, treasuryBalance, deployerNonce] = await Promise.all([
    client.getCode({ address: config.treasury, blockNumber }), client.getBalance({ address: config.treasury, blockNumber }), client.getTransactionCount({ address: config.deployer, blockNumber }),
  ]);
  const prospectiveRouter = getContractAddress({ from: config.deployer, nonce: BigInt(deployerNonce) });
  const [prospectiveCode, previousCode] = await Promise.all([client.getCode({ address: prospectiveRouter, blockNumber }), client.getCode({ address: PREVIOUS_ROUTER, blockNumber })]);
  if (prospectiveCode && prospectiveCode !== '0x') throw new Error('The reviewed prospective router already has code. Review that deployment before preparing another.');
  if (previousCode && previousCode !== '0x' && !previousManifestPath) throw new Error('The previous router is deployed. Pass its reviewed deployment manifest explicitly to prepare a replacement.');
  if (previousManifestPath && (!previousCode || previousCode === '0x')) throw new Error('The reviewed previous router is not deployed on this chain.');
  const previousDeployment = previousManifestPath ? await verifyPreviousDeployment(client, previousManifestPath, config, artifact, sourceHash, blockNumber) : null;
  const codeAt = async address => {
    const code = await client.getCode({ address, blockNumber }); if (!code || code === '0x') throw new Error(`Missing contract at ${address}`);
    return keccak256(code);
  };
  const airlockCodeHash = await codeAt(AIRLOCK);
  const protocolBeneficiary = await client.readContract({ address: AIRLOCK, abi: ABI, functionName: 'owner', blockNumber });
  if (protocolBeneficiary === zeroAddress || getAddress(protocolBeneficiary) === config.treasury) throw new Error('Protocol and treasury must be distinct nonzero addresses.');
  const modules = [];
  for (const [name, raw, expectedState] of MODULES) {
    const address = getAddress(raw); const codeHash = await codeAt(address);
    const state = await client.readContract({ address: AIRLOCK, abi: ABI, functionName: 'getModuleState', args: [address], blockNumber });
    if (state !== expectedState) throw new Error(`Doppler no longer approves ${name}.`);
    modules.push({ name, address, codeHash, state });
  }
  const quotes = [];
  for (let offset = 0; offset < QUOTES.length; offset += 8) {
    const rows = await Promise.all(QUOTES.slice(offset, offset + 8).map(async quote => {
      const [codeHash, decimals] = await Promise.all([
        codeAt(quote.address), client.readContract({ address: quote.address, abi: ABI, functionName: 'decimals', blockNumber }),
      ]);
      const expectedDecimals = catalogSnapshot.catalog.assets.find(asset => asset.address.toLowerCase() === quote.address.toLowerCase())?.decimals;
      if (decimals !== expectedDecimals) throw new Error(`${quote.symbol} changed decimals; review the pool model.`);
      return { ...quote, codeHash, decimals };
    }));
    quotes.push(...rows);
    if (quotes.length % 40 === 0 || quotes.length === QUOTES.length) console.log(`Verified ${quotes.length}/${QUOTES.length} quote contracts at block ${blockNumber}.`);
  }
  const args = [config.treasury, BigInt(config.totalSupply), config.friendFeeBps, QUOTES.map(quote => quote.address)];
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const deploymentDataHash = keccak256(data);
  const gas = await client.estimateGas({ account: config.deployer, data, value: 0n, blockNumber });
  const gasPrice = await client.getGasPrice();
  let validation = { fullRouterSimulation: 'not yet recorded', method: 'eth_call stateOverride' };
  try {
    const raw = await readFile(resolve(root, 'state-override-review.json'), 'utf8'), rehearsal = JSON.parse(raw);
    if (rehearsalMatches(rehearsal, { config, quotes, creationBytecodeHash: keccak256(artifact.bytecode.object), deploymentDataHash, catalogHash: CATALOG_HASH, unsignedTransaction: { data }, deploymentAddressRead: { prospectiveRouter, deployerNonce } })) validation = {
      fullRouterSimulation: 'passed', deploymentDataHash, catalogHash: CATALOG_HASH, method: 'eth_call stateOverride', blockNumber: rehearsal.blockNumber, blockHash: rehearsal.blockHash,
      artifactPath: 'contracts/rare-launchpad/state-override-review.json', artifactSha256: createHash('sha256').update(raw).digest('hex'),
      limitation: 'Real Friend and self launch routes simulated against mainnet. No state persisted and no transaction was sent.',
    };
  } catch { /* A constructor-only preparation remains explicitly unverified for the complete route. */ }
  const current = await client.getBlock({ blockNumber });
  if (current.hash !== block.hash || await client.getChainId() !== 4663) throw new Error('Verification block changed; retry.');
  const review = {
    status: 'UNSIGNED — no transaction sent', createdAt: new Date().toISOString(), config,
    verifiedAt: { chainId: 4663, blockNumber: String(blockNumber), blockHash: block.hash },
    feePercent: { friendWallet: config.friendFeeBps / 100, treasury: (9500 - config.friendFeeBps) / 100, doppler: 5 },
    protocolBeneficiary, airlock: { address: AIRLOCK, codeHash: airlockCodeHash }, modules, quotes,
    supplyPolicy: '100% assigned to the pool; zero vesting or insider allocations. Pool rounding dust follows canonical Doppler NoOp governance burn.',
    compiler: { version: '0.8.30', optimizerRuns: 200, viaIR: true, evmVersion: 'cancun' },
    sourceHash, creationBytecodeHash: keccak256(artifact.bytecode.object), deploymentDataHash, catalogHash: CATALOG_HASH,
    quoteCatalog: { path: 'games/rare-pet/launch-quote-catalog.json', count: quotes.length, activeStocks: catalogSnapshot.catalog.coverage.activeStocks, generatedAt: catalogSnapshot.catalog.generatedAt },
    deploymentAddressRead: { prospectiveRouter, deployerNonce, code: prospectiveCode ?? '0x' }, previousDeployment,
    validation,
    networkFeeEstimate: { gasPriceWei: String(gasPrice), estimatedWei: String(gas * gasPrice), estimatedETH: formatEther(gas * gasPrice), caveat: 'Current RPC estimate only. Wallet/network pricing and the final gas used determine the actual fee.' },
    treasuryRead: { address: config.treasury, code: treasuryCode ?? '0x', balanceWei: String(treasuryBalance), ownership: 'User-supplied address; no ownership claim inferred from this public read.' },
    unsignedTransaction: { chainId: 4663, from: config.deployer, nonce: `0x${deployerNonce.toString(16)}`, data, value: '0x0', gas: `0x${((gas * 120n + 99n) / 100n).toString(16)}`, gasEstimate: String(gas) },
    remaining: ['Review fee policy, treasury, quote registry status, bytecode and gas.', 'Obtain deployment authorization and sign with the reviewed wallet.', 'Verify deployed source and all immutable getters before configuring the app.'],
  };
  const output = resolve(outputPath); await writeFile(output, `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
  console.log(`Unsigned deployment review saved: ${output}\nVerified block ${blockNumber}; estimated gas ${gas}. No transaction was sent.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) { console.error('Usage: node contracts/rare-launchpad/script/prepare-deployment.mjs <reviewed-public-config.json> [new-output.json] [previous-deployment-manifest.json]'); process.exitCode = 1; }
  else prepare(process.argv[2], process.argv[3] ?? resolve(root, 'deployment-review.json'), process.argv[4]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
