/** Read-only deployment preparation. No signer, key, wallet client, transaction send, or broadcast. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createPublicClient, encodeDeployData, formatEther, getAddress, http, isAddress, keccak256, parseAbi, getContractAddress, zeroAddress } from 'viem';

import { readDeploymentCatalog, rehearsalMatches } from './deployment-policy.mjs';

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

async function prepare(configPath, outputPath) {
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
  const oldProspectiveRouter = getAddress('0x8c46baA63079B8648b1cd5689058E0AAB33DF063');
  const [prospectiveCode, oldProspectiveCode] = await Promise.all([client.getCode({ address: prospectiveRouter, blockNumber }), client.getCode({ address: oldProspectiveRouter, blockNumber })]);
  if ((prospectiveCode && prospectiveCode !== '0x') || (oldProspectiveCode && oldProspectiveCode !== '0x')) throw new Error('A prospective router has already deployed. Review existing deployment before preparing another.');
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
      if (decimals !== 18) throw new Error(`${quote.symbol} changed decimals; review the pool model.`);
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
    if (rehearsalMatches(rehearsal, { config, quotes, creationBytecodeHash: keccak256(artifact.bytecode.object), deploymentDataHash, catalogHash: CATALOG_HASH, unsignedTransaction: { data } })) validation = {
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
    deploymentAddressRead: { prospectiveRouter, deployerNonce, code: prospectiveCode ?? '0x', previousProspectiveRouter: oldProspectiveRouter, previousCode: oldProspectiveCode ?? '0x' },
    validation,
    networkFeeEstimate: { gasPriceWei: String(gasPrice), estimatedWei: String(gas * gasPrice), estimatedETH: formatEther(gas * gasPrice), caveat: 'Current RPC estimate only. Wallet/network pricing and the final gas used determine the actual fee.' },
    treasuryRead: { address: config.treasury, code: treasuryCode ?? '0x', balanceWei: String(treasuryBalance), ownership: 'User-supplied address; no ownership claim inferred from this public read.' },
    unsignedTransaction: { chainId: 4663, from: config.deployer, data, value: '0x0', gas: `0x${((gas * 120n + 99n) / 100n).toString(16)}`, gasEstimate: String(gas) },
    remaining: ['Review fee policy, treasury, quote registry status, bytecode and gas.', 'Obtain deployment authorization and sign with the reviewed wallet.', 'Verify deployed source and all immutable getters before configuring the app.'],
  };
  const output = resolve(outputPath); await writeFile(output, `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
  console.log(`Unsigned deployment review saved: ${output}\nVerified block ${blockNumber}; estimated gas ${gas}. No transaction was sent.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) { console.error('Usage: node contracts/rare-launchpad/script/prepare-deployment.mjs <reviewed-public-config.json> [output.json]'); process.exitCode = 1; }
  else prepare(process.argv[2], process.argv[3] ?? resolve(root, 'deployment-review.json')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
