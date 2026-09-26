/** Read-only remote state + local Forge execution. Never sends a public transaction. */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rpc = process.env.RARE_LAUNCH_RPC ?? 'https://rpc.mainnet.chain.robinhood.com';
const response = await fetch(rpc, {
  method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(12000),
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
});
const result = await response.json();
if (!response.ok || result.error || !/^0x[0-9a-f]+$/i.test(result.result)) throw new Error('Could not pin the fork block.');
const block = BigInt(result.result).toString();
console.log(`Read-only mainnet fork at block ${block}; no transaction will be broadcast.`);
const args = ['test', '--root', resolve(dirname(fileURLToPath(import.meta.url)), '..'), '--match-contract', 'RarePetLaunchRouterForkTest', '--rpc-url', rpc, '--fork-block-number', block, '--rpc-timeout', '15', '--fork-retries', '1', '-vvv'];
const child = spawnSync(process.argv[2] ?? 'forge', args, {
  stdio: 'inherit', timeout: 90000, env: { ...process.env, RARE_LAUNCH_FORK: 'true', RARE_LAUNCH_FORK_BLOCK: block },
});
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
