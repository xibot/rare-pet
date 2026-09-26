/** Exact deployed runtime under eth_call state overrides. Read-only: no signer or broadcast. */
import { readFile, writeFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createPublicClient, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, getContractAddress, http, keccak256, encodeDeployData, parseAbi, toHex } from 'viem';

import { readDeploymentCatalog, RAREFRIENDS_QUOTE, reviewedDeploymentAddress } from './deployment-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(root, '../..');
const appSources = ['games/rare-pet/launch-doppler.ts', 'games/rare-pet/launch-quotes.ts', 'games/rare-pet/config.ts', 'package-lock.json'];
async function appSourceHashes() {
  return Object.fromEntries(await Promise.all(appSources.map(async path => [path, createHash('sha256').update(await readFile(resolve(appRoot, path))).digest('hex')])));
}
const sourceHashes = await appSourceHashes();
const reviewPath = resolve(process.argv[2] || resolve(root, 'deployment-review.json'));
const outputPath = resolve(process.argv[3] || resolve(root, 'state-override-review.json'));
const reviewRaw = await readFile(reviewPath, 'utf8');
const review = JSON.parse(reviewRaw);
const reviewedRouter = reviewedDeploymentAddress(review);
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
if (router.toLowerCase() !== reviewedRouter.toLowerCase() || nonce !== review.deploymentAddressRead.deployerNonce) throw new Error('The deployer nonce changed. Prepare a fresh review before rehearsal.');
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
const stockAddress = snapshot.catalog.assets.filter(asset => asset.kind === 'stock').at(-1)?.address;
const stockQuote = review.quotes.find(quote => quote.address.toLowerCase() === stockAddress?.toLowerCase());
if (!stockQuote) throw new Error('The reviewed catalog has no tail stock.');
const stockRequest = { ...request, quote: stockQuote.address, symbol: 'RFSTOCK', salt: toHex(43n, { size: 32 }) };
const stockResult = await client.call({ account: review.config.deployer, to: router, data: encodeFunctionData({ abi: artifact.abi, functionName: 'launchAsSelf', args: [stockRequest] }), value: 0n, blockNumber, stateOverride });
if (!stockResult.data) throw new Error('Tail stock launch returned no result.');
const [stockAsset] = decodeAbiParameters([{ type: 'address' }], stockResult.data);
const rfQuote = review.quotes.find(quote => quote.address.toLowerCase() === RAREFRIENDS_QUOTE.toLowerCase());
if (!rfQuote) throw new Error('The reviewed catalog is missing canonical RAREFRIENDS.');
const rfRequest = { ...request, quote: rfQuote.address, symbol: 'RFPAIR', salt: toHex(44n, { size: 32 }) };
const rfFriendData = encodeFunctionData({ abi: artifact.abi, functionName: 'launch', args: [rfRequest] });
const rfOuter = encodeFunctionData({ abi: accountABI, functionName: 'execute', args: [router, 0n, rfFriendData, 0] });
const rfFriendResult = await client.call({ account: owner, to: wallet, data: rfOuter, value: 0n, blockNumber, stateOverride });
if (!rfFriendResult.data) throw new Error('RAREFRIENDS paired RF launch returned no result.');
const [rfNested] = decodeAbiParameters([{ type: 'bytes' }], rfFriendResult.data);
const [rfFriendAsset] = decodeAbiParameters([{ type: 'address' }], rfNested);
const rfSelfResult = await client.call({ account: review.config.deployer, to: router, data: encodeFunctionData({ abi: artifact.abi, functionName: 'launchAsSelf', args: [rfRequest] }), value: 0n, blockNumber, stateOverride });
if (!rfSelfResult.data) throw new Error('RAREFRIENDS paired self launch returned no result.');
const [rfSelfAsset] = decodeAbiParameters([{ type: 'address' }], rfSelfResult.data);
if (rfFriendAsset.toLowerCase() === rfSelfAsset.toLowerCase()) throw new Error('RAREFRIENDS paired salt namespaces collided.');

// The legacy rows above exercise module compatibility with a synthetic one-curve
// request. New decimal-sensitive pairs use the actual app builder and price reader.
const bundleDirectory = await mkdtemp(resolve(root, 'out/rehearsal-app-'));
let app;
try {
  const bundlePath = resolve(bundleDirectory, 'app.mjs');
  await build({ stdin: { contents: `export { buildRareLaunchParams, buildRareSelfLaunchParams, readRareLaunchConfig, readRareSelfLaunchConfig, RARE_LAUNCH_FEES } from './games/rare-pet/launch-doppler.ts'; export { createLaunchQuoteReader } from './games/rare-pet/launch-quotes.ts';`, resolveDir: appRoot, loader: 'ts' }, outfile: bundlePath, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' });
  app = await import(pathToFileURL(bundlePath).href);
} finally { await rm(bundleDirectory, { recursive: true, force: true }); }
const pinnedClient = {
  ...client,
  getBlockNumber: async () => blockNumber,
  getBlock: () => client.getBlock({ blockNumber }),
  getCode: args => args.address.toLowerCase() === router.toLowerCase() ? Promise.resolve(creation.data) : client.getCode({ ...args, blockNumber }),
  readContract: args => client.readContract({ ...args, blockNumber, stateOverride }),
};
const pet = { chainId: 4663, collection: 'genesis', contract: genesis, tokenId: '2', owner, walletAddress: wallet };
const friendConfig = await app.readRareLaunchConfig(router, pet, { client: pinnedClient });
const selfConfig = await app.readRareSelfLaunchConfig(router, review.config.deployer, { client: pinnedClient });
const feedDirectoryUrl = 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json';
const feedResponse = await fetch(feedDirectoryUrl, { redirect: 'error', signal: AbortSignal.timeout(20000) });
if (!feedResponse.ok) throw new Error('The official Chainlink directory could not be loaded.');
const feedDirectory = await feedResponse.json();
const atSnapshot = () => Number(block.timestamp) * 1000;
const priceReader = app.createLaunchQuoteReader({ clientFactory: () => pinnedClient, now: atSnapshot,
  fetcher: async () => new Response(JSON.stringify({ chainlink: feedDirectory }), { headers: { 'content-type': 'application/json' } }),
});
async function rehearseAppPair(id, expectedAddress, decimals, saltOffset) {
  const price = await priceReader.readLaunchQuotePrice(id);
  if (price.asset.address.toLowerCase() !== expectedAddress.toLowerCase() || price.asset.decimals !== decimals) throw new Error(`${id} does not match its reviewed token identity.`);
  const simulations = [];
  for (const [index, fee] of app.RARE_LAUNCH_FEES.entries()) {
    const draft = { name: `RarePet ${price.asset.symbol} rehearsal`, symbol: `RF${id.toUpperCase()}`, tokenURI: request.tokenURI, quote: price, fee, salt: toHex(BigInt(saltOffset + index), { size: 32 }) };
    const friendBuilt = app.buildRareLaunchParams({ pet, config: friendConfig, draft, now: atSnapshot() });
    const selfBuilt = app.buildRareSelfLaunchParams({ account: review.config.deployer, config: selfConfig, draft, now: atSnapshot() });
    const curves = friendBuilt.request.curves;
    const initialTick = Math.min(...curves.map(curve => curve.tickLower));
    const normalizedInitialMarketCapUSD = 1.0001 ** initialTick * 10 ** (18 - decimals) * 1e9 * Number(price.usdPrice);
    const expectedShares = [50n, 25n, 24n, 1n].map(percent => percent * 10n ** 16n);
    if (curves.length !== 4 || curves.some((curve, i) => curve.numPositions !== 10 || curve.shares !== expectedShares[i])
      || normalizedInitialMarketCapUSD !== friendBuilt.review.approximateStartMarketCapUSD
      || normalizedInitialMarketCapUSD !== selfBuilt.review.approximateStartMarketCapUSD
      || Math.abs(normalizedInitialMarketCapUSD / 10000 - 1) > 1.0001 ** 200 - 1 + 1e-9) throw new Error(`${id} app preset or normalized starting valuation changed.`);
    const inner = encodeFunctionData({ abi: artifact.abi, functionName: 'launch', args: [friendBuilt.request] });
    const friendCall = await client.call({ account: owner, to: wallet, data: encodeFunctionData({ abi: accountABI, functionName: 'execute', args: [router, 0n, inner, 0] }), value: 0n, blockNumber, stateOverride });
    if (!friendCall.data) throw new Error(`${id} RF app launch returned no result.`);
    const [innerResult] = decodeAbiParameters([{ type: 'bytes' }], friendCall.data);
    const [pairedFriendAsset] = decodeAbiParameters([{ type: 'address' }], innerResult);
    const selfCall = await client.call({ account: review.config.deployer, to: router, data: encodeFunctionData({ abi: artifact.abi, functionName: 'launchAsSelf', args: [selfBuilt.request] }), value: 0n, blockNumber, stateOverride });
    if (!selfCall.data) throw new Error(`${id} self app launch returned no result.`);
    const [pairedSelfAsset] = decodeAbiParameters([{ type: 'address' }], selfCall.data);
    if (pairedFriendAsset.toLowerCase() === pairedSelfAsset.toLowerCase()) throw new Error(`${id} app launch namespaces collided.`);
    simulations.push({ fee, friendAsset: pairedFriendAsset, selfAsset: pairedSelfAsset, initialTick, normalizedInitialMarketCapUSD,
      curves: curves.map(curve => ({ ...curve, shares: String(curve.shares) })), farTick: friendBuilt.request.farTick, curveCount: 4, positionCount: 40 });
  }
  return { symbol: price.asset.symbol, quote: price.asset.address, decimals, friendAsset: simulations[0].friendAsset, selfAsset: simulations[0].selfAsset,
    feesTested: [...app.RARE_LAUNCH_FEES], quoteUsdPrice: price.usdPrice, priceSource: price.source, priceFeed: price.feedAddress,
    feedUpdatedAt: price.updatedAt, quoteBlockNumber: String(price.blockNumber), targetStartMarketCapUSD: 10000, simulations };
}
const usdg = await rehearseAppPair('usdg', '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', 6, 100);
const cbbtc = await rehearseAppPair('cbbtc', '0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4', 8, 200);
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
  rarefriends: { symbol: rfQuote.symbol, quote: rfQuote.address, friendAsset: rfFriendAsset, selfAsset: rfSelfAsset },
  usdg, cbbtc,
  appPreset: { sourceHashes, priceDirectory: feedDirectoryUrl, priceDirectorySha256: createHash('sha256').update(JSON.stringify(feedDirectory)).digest('hex'),
    coverage: 'USDG and cbBTC use the actual app builder and quote reader, four curves and forty positions, all three fees, RF and self modes. WETH, RAREFRIENDS and tail stock rows use a synthetic one-curve compatibility request.' },
  limitations: 'This is an eth_call state-override rehearsal, not deployment or proof of persisted storage. Constructor execution was separately simulated; local tests cover cooldown and Brain persistence.',
};
if (await readFile(reviewPath, 'utf8') !== reviewRaw || readDeploymentCatalog().catalogHash !== review.catalogHash || JSON.stringify(await appSourceHashes()) !== JSON.stringify(sourceHashes)) throw new Error('Review, catalog or app source changed during rehearsal. Prepare a fresh review.');
const proofRaw = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(outputPath, proofRaw, { flag: 'wx' });
review.validation = {
  fullRouterSimulation: 'passed', method: 'eth_call stateOverride', deploymentDataHash: review.deploymentDataHash, catalogHash: review.catalogHash,
  blockNumber: result.blockNumber, blockHash: result.blockHash, artifactPath: relative(resolve(root, '../..'), outputPath),
  artifactSha256: createHash('sha256').update(proofRaw).digest('hex'),
  limitation: 'Exact constructor and actual app USDG/cbBTC presets in RF/self modes at all three fees, plus synthetic WETH/RAREFRIENDS/tail-stock compatibility requests, simulated against pinned mainnet. No state persisted or transaction was sent.',
};
const temporary = `${reviewPath}.tmp`;
await writeFile(temporary, `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, reviewPath);
console.log(JSON.stringify(result, null, 2));
