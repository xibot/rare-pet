/** Produce a concrete unsigned governance transaction; no signer or broadcast. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, http, encodeFunctionData, isAddress, getAddress, zeroAddress, keccak256 } from 'viem';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = process.env.RARE_CARE_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const stringify = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);

export function governanceRequest(mode, payload) {
  if (mode === 'schedule') {
    const keys = ['actions', 'petGrace', 'decayInterval', 'decayPoints', 'rarityEvery', 'rarityPoints', 'playSigner'];
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length !== keys.length || !keys.every(key => Object.hasOwn(payload, key))) throw new Error('Provide the complete rule set, including all four actions and the signer.');
    if (!Array.isArray(payload.actions) || payload.actions.length !== 4) throw new Error('Exactly four action rules are required: Pet, Feed, Play, Poop.');
    const actionKeys = ['points', 'secondaryPoints', 'cooldown', 'dailyLimit', 'enabled'];
    for (const rule of payload.actions) {
      if (!rule || typeof rule !== 'object' || Object.keys(rule).length !== actionKeys.length || !actionKeys.every(key => Object.hasOwn(rule, key))) throw new Error('Unexpected action rule fields.');
      for (const key of ['points', 'secondaryPoints', 'cooldown', 'dailyLimit']) if (!Number.isSafeInteger(rule[key]) || rule[key] < 0) throw new Error(`Invalid action ${key}.`);
      if (typeof rule.enabled !== 'boolean') throw new Error('Action enabled must be boolean.');
    }
    if (payload.actions[0].cooldown !== 86_400 || payload.actions[0].dailyLimit !== 1) throw new Error('Pet is locked to one action every 24 hours.');
    for (const key of ['petGrace', 'decayInterval', 'decayPoints', 'rarityEvery', 'rarityPoints']) if (!Number.isSafeInteger(payload[key]) || payload[key] < 0) throw new Error(`Invalid ${key}.`);
    if (!isAddress(payload.playSigner)) throw new Error('Invalid play signer.');
    return { functionName: 'scheduleRules', args: [payload] };
  }
  if (mode === 'nominate-admin') {
    if (!isAddress(payload) || getAddress(payload) === zeroAddress) throw new Error('A nonzero new admin address is required.');
    return { functionName: 'scheduleAdmin', args: [getAddress(payload)] };
  }
  const methods = { cancel: 'cancelRules', execute: 'executeRules', 'cancel-admin': 'cancelAdminTransfer', 'accept-admin': 'acceptAdmin' };
  if (!Object.hasOwn(methods, mode)) throw new Error('Mode must be schedule, cancel, execute, nominate-admin, cancel-admin or accept-admin.');
  const method = methods[mode];
  if (payload !== undefined) throw new Error('This mode does not accept a payload.');
  return { functionName: method, args: [] };
}
export async function prepareRuleChange({ address, sender, mode, payload, output }) {
  if (!isAddress(address) || !isAddress(sender) || getAddress(address) === zeroAddress || getAddress(sender) === zeroAddress) throw new Error('Valid care contract and sender are required.');
  const request = governanceRequest(mode, payload);
  const artifact = JSON.parse(await readFile(resolve(root, 'out/RarePetCare.sol/RarePetCare.json'), 'utf8'));
  const { abi } = artifact;
  const sourceHash = keccak256(new Uint8Array(await readFile(resolve(root, 'src/RarePetCare.sol'))));
  if (artifact.metadata?.sources?.['src/RarePetCare.sol']?.keccak256 !== sourceHash) throw new Error('Rebuild the current care source first.');
  const client = createPublicClient({ transport: http(RPC, { timeout: 30_000, retryCount: 2 }) });
  if (await client.getChainId() !== 4663) throw new Error('Wrong chain.');
  const block = await client.getBlock();
  const at = { address: getAddress(address), abi, blockNumber: block.number };
  const [code, admin, version, currentRules, pending] = await Promise.all([
    client.getCode({ address: getAddress(address), blockNumber: block.number }),
    client.readContract({ ...at, functionName: 'admin' }),
    client.readContract({ ...at, functionName: 'currentRuleVersion' }),
    client.readContract({ ...at, functionName: 'currentRules' }),
    client.readContract({ ...at, functionName: 'pendingRules' }),
  ]);
  if (!code || code === '0x') throw new Error('Care contract is not deployed.');
  if (keccak256(code) !== keccak256(artifact.deployedBytecode.object)) throw new Error('Contract runtime does not match the reviewed RarePetCare build.');
  // Simulation enforces exact contract bounds, current admin/nominee and the timelock.
  await client.simulateContract({ ...at, account: getAddress(sender), ...request });
  const data = encodeFunctionData({ abi, ...request });
  const gas = await client.estimateGas({ account: getAddress(sender), to: getAddress(address), data, value: 0n, blockNumber: block.number });
  if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Review block changed. Retry.');
  const review = { status: 'UNSIGNED — no transaction sent', createdAt: new Date().toISOString(), mode,
    contract: getAddress(address), runtimeCodeHash: keccak256(code), admin, currentRuleVersion: version,
    currentRules, pendingRules: pending, proposed: payload ?? null,
    checkedAt: { chainId: 4663, blockNumber: block.number, blockHash: block.hash },
    simulation: 'passed',
    effect: mode === 'schedule' ? 'Schedules a new rule version after the contract delay. Existing earned points, records and action timers are not rewritten.'
      : mode === 'execute' ? 'Activates the exact scheduled rule version. New action rewards and limits use it; past points and saved timers remain intact.'
      : mode === 'nominate-admin' ? 'Nominates a new admin; the nominee must accept after the public delay.'
      : mode === 'accept-admin' ? 'Accepts admin authority and clears pending rules.' : 'Cancels the selected pending change.',
    unsignedTransaction: { chainId: 4663, from: getAddress(sender), to: getAddress(address), data, value: '0x0', gas: `0x${((gas * 120n + 99n) / 100n).toString(16)}` },
  };
  await writeFile(resolve(output), stringify(review) + '\n', { flag: 'wx' });
  console.log(stringify({ status: review.status, mode, currentRuleVersion: version, output: resolve(output) }));
  return review;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [address, sender, mode, output, input] = process.argv.slice(2);
  if (!address || !sender || !mode || !output) { console.error('Usage: node contracts/rare-pet/script/prepare-rule-change.mjs <contract> <sender> <mode> <new-review.json> [rules.json|new-admin-address]'); process.exitCode = 1; }
  else {
    const payload = mode === 'schedule' && input ? JSON.parse(await readFile(resolve(input), 'utf8')) : input;
    prepareRuleChange({ address, sender, mode, payload, output }).catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
  }
}
