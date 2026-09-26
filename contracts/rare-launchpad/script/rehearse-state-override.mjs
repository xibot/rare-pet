/** Exact deployed runtime under eth_call state overrides. Read-only: no signer or broadcast. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, getContractAddress, http, keccak256, parseAbi, toHex } from 'viem';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const review = JSON.parse(await readFile(resolve(root, 'deployment-review.json'), 'utf8'));
const artifact = JSON.parse(await readFile(resolve(root, 'out/RarePetLaunchRouter.sol/RarePetLaunchRouter.json'), 'utf8'));
if (keccak256(artifact.bytecode.object) !== review.creationBytecodeHash) throw new Error('Rebuild deployment review for the current bytecode.');
const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 20000, retryCount: 0 }), cacheTime: 0 });
if (await client.getChainId() !== 4663) throw new Error('Wrong chain.');
const block = await client.getBlock();
const blockNumber = block.number;
const nonce = await client.getTransactionCount({ address: review.config.deployer, blockNumber });
const router = getContractAddress({ from: review.config.deployer, nonce: BigInt(nonce) });
if (await client.getCode({ address: router, blockNumber })) throw new Error('The prospective deployment address already has code.');
// EVM CREATE eth_call returns constructor-produced runtime, including the exact immutable values.
const creation = await client.call({ account: review.config.deployer, data: review.unsignedTransaction.data, blockNumber });
if (!creation.data || creation.data.length !== artifact.deployedBytecode.object.length) throw new Error('Creation simulation did not return the expected runtime.');
const quote = review.quotes.find(q => q.symbol === 'WETH').address;
const allowedQuoteSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [quote, 0n]));
const stateOverride = [{ address: router, code: creation.data, stateDiff: [{ slot: allowedQuoteSlot, value: toHex(1n, { size: 32 }) }] }];
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
const again = await client.getBlock({ blockNumber });
if (again.hash !== block.hash || await client.getChainId() !== 4663) throw new Error('The rehearsal block changed.');
const result = {
  status: 'READ-ONLY eth_call PASSED — no contracts deployed or transactions sent',
  blockNumber: String(blockNumber), blockHash: block.hash, prospectiveRouter: router, deployerNonceAtRead: nonce,
  creationBytecodeHash: review.creationBytecodeHash, runtimeCodeHash: keccak256(creation.data),
  override: 'Only the prospective router runtime and its WETH allowlist storage slot; all RF and Doppler contracts use actual pinned mainnet state.',
  friend: { collection: genesis, tokenId: '2', owner, wallet, simulatedAsset: friendAsset },
  self: { creator: review.config.deployer, simulatedAsset: selfAsset, creatorEqualsTreasury: true },
  limitations: 'This is an eth_call state-override rehearsal, not deployment or proof of persisted storage. Constructor execution was separately simulated; local tests cover cooldown and Brain persistence.',
};
await writeFile(resolve(root, 'state-override-review.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
