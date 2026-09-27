/** Live care smoke: public reads and eth_call only. No wallet, signing, state overrides or broadcasts. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { BaseError, ContractFunctionRevertedError, createPublicClient, http, isAddress, parseAbi, zeroAddress, type Abi, type Address } from 'viem';
import type { PetIdentity } from '../games/rare-pet/wallet.ts';

const contract = process.argv[2] as Address;
if (!isAddress(contract) || contract.toLowerCase() === zeroAddress) throw new Error('Pass the deployed care contract address as the first argument.');
const output = process.argv[3] ? resolve(process.argv[3]) : null;
const rpc = 'https://rpc.mainnet.chain.robinhood.com';
const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
const requests: { method: string; block?: string }[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).href !== new URL(rpc).href) throw new Error(`Unexpected network destination in read-only care smoke: ${url}`);
  const body = JSON.parse(String(init?.body));
  if (Array.isArray(body) || !allowed.has(body.method)) throw new Error(`Forbidden RPC method in read-only care smoke: ${body.method}`);
  if (body.method === 'eth_call' && body.params.length !== 2) throw new Error('State overrides are forbidden.');
  requests.push({ method: body.method, block: body.method === 'eth_call' || body.method === 'eth_getCode' ? body.params[1] : undefined });
  return originalFetch(input, init);
};

try {
  // Inject the address exactly as the production build does, then execute the
  // actual application reader. Its internal RPC is covered by the same guard.
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../games/rare-pet/chain.ts', import.meta.url))], bundle: true,
    write: false, platform: 'node', format: 'esm', define: { __RAREPET_CONTRACT__: JSON.stringify(contract) }, logLevel: 'silent' });
  const { readCare } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const abi: Abi = JSON.parse(await readFile(new URL('../contracts/rare-pet/RarePetCare.abi.json', import.meta.url), 'utf8'));
  const identityAbi = parseAbi(['function ownerOf(uint256) view returns(address)', 'function generation(uint256) view returns(uint8)']);
  const client = createPublicClient({ cacheTime: 0, transport: http(rpc, { retryCount: 0, timeout: 20_000 }) });
  assert.equal(await client.getChainId(), 4663, 'Expected Robinhood mainnet.');
  const block = await client.getBlock();
  assert.ok(block.number !== null && block.hash, 'Expected a canonical mined block.');
  const fixed = { address: contract, abi, blockNumber: block.number } as const;
  const [genesis, generations, delay, version] = await Promise.all([
    client.readContract({ ...fixed, functionName: 'GENESIS' }),
    client.readContract({ ...fixed, functionName: 'GENERATIONS' }),
    client.readContract({ ...fixed, functionName: 'RULE_DELAY' }),
    client.readContract({ ...fixed, functionName: 'currentRuleVersion' }),
  ]);
  assert.equal(String(genesis).toLowerCase(), '0x116eaa62241751e0c98da43d458600c6c17cd361');
  assert.equal(String(generations).toLowerCase(), '0x14c49e6118f46525de9ab41a51cbaa3c6ebf181d');
  assert.equal(delay, 86400n);
  assert.equal(version, 1n, 'Activation review expects the initial deployed rules.');
  const friends = [];

  async function expectRevert(parameters: Parameters<typeof client.simulateContract>[0], expected: string) {
    let revert: ContractFunctionRevertedError | undefined;
    try { await client.simulateContract(parameters); }
    catch (error) {
      if (error instanceof BaseError) {
        const cause = error.walk(value => value instanceof ContractFunctionRevertedError);
        if (cause instanceof ContractFunctionRevertedError) revert = cause;
      }
      if (!revert) throw error;
    }
    assert.equal(revert?.data?.errorName, expected, `Expected ${expected}; a transport failure is not a successful rejection check.`);
    return expected;
  }

  for (const specimen of [
    { collection: 'genesis', address: genesis as Address, id: 2n },
    { collection: 'generations', address: generations as Address, id: 68356n },
  ] as const) {
    const owner = await client.readContract({ address: specimen.address, abi: identityAbi, functionName: 'ownerOf', args: [specimen.id], blockNumber: block.number });
    assert.ok(isAddress(owner) && owner.toLowerCase() !== zeroAddress, 'The specimen must have a current canonical owner.');
    const generation = specimen.collection === 'generations'
      ? await client.readContract({ address: specimen.address, abi: identityAbi, functionName: 'generation', args: [specimen.id], blockNumber: block.number }) : null;
    const pet: PetIdentity = { collection: specimen.collection, chainId: 4663, contract: specimen.address, tokenId: String(specimen.id),
      label: `${specimen.collection} #${specimen.id}`, image: '', owner, walletAddress: null, blockNumber: String(block.number), generation, rushEligible: generation === null || generation >= 1 };
    const readStart = requests.length;
    const before = await readCare(pet, block.number);
    const readCalls = requests.slice(readStart).filter(request => request.method === 'eth_call' || request.method === 'eth_getCode');
    const expectedBlock = `0x${block.number.toString(16)}`;
    assert.ok(readCalls.length >= 12, 'The real reader must load the policy, traits, lifetime, schedule and availability.');
    for (const request of readCalls) assert.equal(request.block, expectedBlock, 'Every application care read must share the ownership snapshot block.');
    assert.equal(before.policy.blockNumber, String(block.number));
    assert.equal(before.policy.version, 1);
    assert.equal(before.policy.rules.actions.pet.cooldown, 86400);
    assert.equal(before.policy.rules.actions.pet.dailyLimit, 1);
    assert.equal(before.policy.rules.playSigner.toLowerCase(), zeroAddress);
    assert.equal(before.policy.availability.play.enabled, false);
    assert.equal(before.policy.availability.play.remaining, 0);
    const simulationResults = [];
    for (const action of ['pet', 'feed', 'poop'] as const) {
      const parameters = { ...fixed, functionName: action, account: owner, args: [specimen.address, specimen.id, version] };
      const availability = before.policy.availability[action];
      // A specimen that was cared for before this smoke must reject a repeat,
      // rather than silently treating a legitimate cooldown as a failure.
      let result: string;
      if (!availability.enabled) throw new Error(`${action} is unexpectedly disabled at activation.`);
      if (availability.remaining > 0) {
        await client.simulateContract(parameters);
        result = 'owner simulation passed';
      } else result = await expectRevert(parameters, 'ActionNotReady');
      const unauthorized = await expectRevert({ ...parameters, account: zeroAddress }, 'NotOwner');
      const staleVersion = await expectRevert({ ...parameters, args: [specimen.address, specimen.id, 0n] }, 'InvalidRuleVersion');
      simulationResults.push({ action, result, unauthorized, staleVersion, availability });
    }
    const playDisabled = await expectRevert({ ...fixed, functionName: 'play', account: owner,
      args: [specimen.address, specimen.id, `0x${'01'.repeat(32)}`, block.timestamp + 600n, '0x'] }, 'PlayDisabled');
    const after = await readCare(pet, block.number);
    assert.deepEqual(after, before, 'Simulations must leave the care ledger unchanged.');
    const ownerAfter = await client.readContract({ address: specimen.address, abi: identityAbi, functionName: 'ownerOf', args: [specimen.id], blockNumber: block.number });
    assert.equal(ownerAfter.toLowerCase(), owner.toLowerCase());
    friends.push({ collection: specimen.collection, tokenId: String(specimen.id), owner, generation,
      applicationReadCount: readCalls.length, care: before, simulations: simulationResults, playDisabled });
    console.log(JSON.stringify({ stage: 'CARE_FRIEND_PASSED', collection: specimen.collection, tokenId: String(specimen.id), owner,
      blockNumber: String(block.number), historyCount: before.actionCount, simulations: simulationResults, playDisabled }));
  }
  assert.equal((await client.getBlock({ blockNumber: block.number })).hash, block.hash, 'Snapshot block must remain canonical.');
  const proof = { status: 'PASSED — actual app care reader, canonical Genesis/Generations ownership and read-only action simulations', observedAt: new Date().toISOString(),
    contract, chainId: 4663, blockNumber: String(block.number), blockHash: block.hash, blockTimestamp: String(block.timestamp),
    stateOverrides: false, signer: false, broadcast: false, rpcMethods: [...new Set(requests.map(request => request.method))].sort(),
    ruleDelay: String(delay), ruleVersion: String(version), friends };
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' }); }
  console.log(JSON.stringify({ status: proof.status, contract, blockNumber: proof.blockNumber, rpcMethods: proof.rpcMethods, output }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
