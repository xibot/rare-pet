/** Exact deployed runtime under eth_call state overrides. Read-only: no signer or broadcast. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPublicClient, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, getContractAddress, http, keccak256, encodeDeployData, parseAbi, toHex } from 'viem';

import { readDeploymentCatalog } from './deployment-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reviewPath = resolve(process.argv[2] || resolve(root, 'deployment-review.json'));
const outputPath = resolve(process.argv[3] || resolve(root, 'state-override-review.json'));
const reviewRaw = await readFile(reviewPath, 'utf8');
const review = JSON.parse(reviewRaw);
const artifact = JSON.parse(await readFile(resolve(root, 'out/RarePetLaunchRouter.sol/RarePetLaunchRouter.json'), 'utf8'));
const snapshot = readDeploymentCatalog();
const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [review.config.treasury, BigInt(review.config.totalSupply), review.config.friendFeeBps, snapshot.quotes.map(quote => quote.address)] });
if (keccak256(artifact.bytecode.object) !== review.creationBytecodeHash || review.unsignedTransaction.data !== data || review.deploymentDataHash !== keccak256(data) || snapshot.catalogHash !== review.catalogHash || JSON.stringify(review.quotes.map(({symbol,address})=>({symbol,address}))) !== JSON.stringify(snapshot.quotes)) throw new Error('Rebuild deployment review for the current bytecode, exact constructor arguments and quote catalog.');
const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 20000, retryCount: 0 }), cacheTime: 0 });
if (await client.getChainId() !== 4663) throw new Error('Wrong chain.');
const block = await client.getBlock();
const blockNumber = block.number;
const nonce = await client.getTransactionCount({ address: review.config.deployer, blockNumber });
const router = getContractAddress({ from: review.config.deployer, nonce: BigInt(nonce) });
const currentCode = await client.getCode({ address: router, blockNumber });
if (currentCode && currentCode !== '0x') throw new Error('The prospective deployment address already has code.');
// EVM CREATE eth_call returns constructor-produced runtime, including the exact immutable values.
const creation = await client.call({ account: review.config.deployer, data: review.unsignedTransaction.data, blockNumber });
if (!creation.data || creation.data.length !== artifact.deployedBytecode.object.length) throw new Error('Creation simulation did not return the expected runtime.');
const quote = review.quotes.find(q => q.symbol === 'WETH').address;
// Constructor storage does not persist in eth_call. Reproduce its exact immutable allowlist
// and array slots; all other router storage remains empty and all dependencies remain real.
const arrayBase = BigInt(keccak256(toHex(1n, { size: 32 })));
const stateDiff = [{ slot: toHex(1n, { size: 32 }), value: toHex(BigInt(review.quotes.length), { size: 32 }) }];
for (let i = 0; i < review.quotes.length; i++) {
  const address = review.quotes[i].address;
  stateDiff.push({ slot: keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [address, 0n])), value: toHex(1n, { size: 32 }) });
  stateDiff.push({ slot: toHex(arrayBase + BigInt(i), { size: 32 }), value: toHex(BigInt(address), { size: 32 }) });
}
const stateOverride = [{ address: router, code: creation.data, stateDiff }];
const listed = await client.readContract({ address: router, abi: artifact.abi, functionName: 'quoteTokens', blockNumber, stateOverride });
if (listed.map(a=>a.toLowerCase()).join() !== review.quotes.map(q=>q.address.toLowerCase()).join()) throw new Error('Rehearsal allowlist storage differs from the exact constructor catalog.');
const genesis = getAddress('0x116eaa62241751e0c98da43d458600c6c17cd361');
const collectionABI = parseAbi(['function ownerOf(uint256) view returns(address)', 'function tokenBoundAccount(uint256) view returns(address)']);
const accountABI = parseAbi(['function owner() view returns(address)', 'function token() view returns(uint256,address,uint256)', 'function execute(address,uint256,bytes,uint8) payable returns(bytes)']);
const owner = await client.readContract({ address: genesis, abi: collectionABI, functionName: 'ownerOf', args: [2n], blockNumber });
const wallet = await client.readContract({ address: genesis, abi: collectionABI, functionName: 'tokenBoundAccount', args: [2n], blockNumber });
const accountOwner = await client.readContract({ address: wallet, abi: accountABI, functionName: 'owner', blockNumber });
const binding = await client.readContract({ address: wallet, abi: accountABI, functionName: 'token', blockNumber });
if (owner.toLowerCase() !== accountOwner.toLowerCase() || binding[0] !== 4663n || binding[1].toLowerCase() !== genesis.toLowerCase() || binding[2] !== 2n) throw new Error('Canonical Friend binding mismatch.');
const request = {
  name: 'RarePet runtime rehearsal', symbol: 'RFTEST', tokenURI: 'data:application/json;base64,e30=', quote, fee: 10000,
  curves: [{ tickLower: -10000, tickUpper: 10000, numPositions: 20, shares: 10n ** 18n }],
  farTick: 9800, salt: toHex(42n, { size: 32 }),
};
const friendData = encodeFunctionData({ abi: artifact.abi, functionName: 'launch', args: [request] });
const outer = encodeFunctionData({ abi: accountABI, functionName: 'execute', args: [router, 0n, friendData, 0] });
const friendResult = await client.call({ account: owner, to: wallet, data: outer, value: 0n, blockNumber, stateOverride });
if (!friendResult.data) throw new Error('RF launch returned no result.');
const [nested] = decodeAbiParameters([{ type: 'bytes' }], friendResult.data);
const [friendAsset] = decodeAbiParameters([{ type: 'address' }], nested);
const selfData = encodeFunctionData({ abi: artifact.abi, functionName: 'launchAsSelf', args: [request] });
const selfResult = await client.call({ account: review.config.deployer, to: router, data: selfData, value: 0n, blockNumber, stateOverride });
if (!selfResult.data) throw new Error('Self launch returned no result.');
const [selfAsset] = decodeAbiParameters([{ type: 'address' }], selfResult.data);
if (friendAsset.toLowerCase() === selfAsset.toLowerCase()) throw new Error('Self and Friend salt namespaces collided.');
const stockQuote = review.quotes.at(-1);
const stockRequest = { ...request, quote: stockQuote.address, symbol: 'RFSTOCK', salt: toHex(43n, { size: 32 }) };
const stockResult = await client.call({ account: review.config.deployer, to: router, data: encodeFunctionData({ abi: artifact.abi, functionName: 'launchAsSelf', args: [stockRequest] }), value: 0n, blockNumber, stateOverride });
if (!stockResult.data) throw new Error('Tail stock launch returned no result.');
const [stockAsset] = decodeAbiParameters([{ type: 'address' }], stockResult.data);
const again = await client.getBlock({ blockNumber });
if (again.hash !== block.hash || await client.getChainId() !== 4663) throw new Error('The rehearsal block changed.');
const result = {
  status: 'READ-ONLY eth_call PASSED — no contracts deployed or transactions sent',
  blockNumber: String(blockNumber), blockHash: block.hash, prospectiveRouter: router, deployerNonceAtRead: nonce,
  creationBytecodeHash: review.creationBytecodeHash, deploymentDataHash: review.deploymentDataHash, catalogHash: review.catalogHash, quoteCount: review.quotes.length, deployer: review.config.deployer, runtimeCodeHash: keccak256(creation.data),
  override: 'Only the prospective router runtime and its exact full constructor quote allowlist storage; all RF and Doppler contracts use actual pinned mainnet state.',
  friend: { collection: genesis, tokenId: '2', owner, wallet, simulatedAsset: friendAsset },
  self: { creator: review.config.deployer, simulatedAsset: selfAsset, creatorEqualsTreasury: review.config.deployer.toLowerCase() === review.config.treasury.toLowerCase() },
  tailStock: { symbol: stockQuote.symbol, quote: stockQuote.address, simulatedAsset: stockAsset },
  limitations: 'This is an eth_call state-override rehearsal, not deployment or proof of persisted storage. Constructor execution was separately simulated; local tests cover cooldown and Brain persistence.',
};
if (await readFile(reviewPath, 'utf8') !== reviewRaw || readDeploymentCatalog().catalogHash !== review.catalogHash) throw new Error('Review or catalog changed during rehearsal. Prepare a fresh review.');
const proofRaw = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(outputPath, proofRaw, { flag: 'wx' });
review.validation = {
  fullRouterSimulation: 'passed', method: 'eth_call stateOverride', deploymentDataHash: review.deploymentDataHash, catalogHash: review.catalogHash,
  blockNumber: result.blockNumber, blockHash: result.blockHash, artifactPath: relative(resolve(root, '../..'), outputPath),
  artifactSha256: createHash('sha256').update(proofRaw).digest('hex'),
  limitation: 'Exact constructor plus real RF and self routes and the final catalog stock simulated against mainnet. No state persisted or transaction was sent.',
};
const temporary = `${reviewPath}.tmp`;
await writeFile(temporary, `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, reviewPath);
console.log(JSON.stringify(result, null, 2));
