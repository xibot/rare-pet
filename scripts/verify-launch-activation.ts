/** Live deployment smoke: only public reads, eth_call and gas estimation. Never creates a signer. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPublicClient, custom, http, isAddress, parseAbi, type Address } from 'viem';
import { createRareLaunchSalt, prepareRareLaunch, prepareRareSelfLaunch, readRareLaunchConfig, readRareSelfLaunchConfig, type RareLaunchDependencies } from '../games/rare-pet/launch-doppler.ts';
import { createLaunchQuoteReader, LAUNCH_QUOTE_ASSETS } from '../games/rare-pet/launch-quotes.ts';
import { launchTreasury } from '../games/rare-pet/config.ts';
import type { PetIdentity, PetWalletSession } from '../games/rare-pet/wallet.ts';

const router = process.argv[2] as Address;
if (!isAddress(router)) throw new Error('Pass the deployed router address as the first argument.');
const output = process.argv[3] ? resolve(process.argv[3]) : null;
const underlying = http('https://rpc.mainnet.chain.robinhood.com', { retryCount: 0, timeout: 20_000 })({});
const permitted = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_getBalance', 'eth_getTransactionCount']);
const methods = new Set<string>();
const client = createPublicClient({ cacheTime: 0, transport: custom({ request: async ({ method, params }) => {
  if (!permitted.has(method)) throw new Error(`Forbidden RPC method in read-only smoke: ${method}`);
  methods.add(method); return underlying.request({ method, params } as never);
} }, { retryCount: 0 }) });
const collection = '0x116EaA62241751E0c98dA43d458600c6C17cD361' as Address;
const identityAbi = parseAbi(['function ownerOf(uint256) view returns(address)', 'function tokenBoundAccount(uint256) view returns(address)', 'function owner() view returns(address)', 'function token() view returns(uint256,address,uint256)']);
async function readFriend(): Promise<PetIdentity> {
  if (await client.getChainId() !== 4663) throw new Error('Expected Robinhood mainnet.');
  const block = await client.getBlock();
  const [owner, walletAddress] = await Promise.all([
    client.readContract({ address: collection, abi: identityAbi, functionName: 'ownerOf', args: [2n], blockNumber: block.number }),
    client.readContract({ address: collection, abi: identityAbi, functionName: 'tokenBoundAccount', args: [2n], blockNumber: block.number }),
  ]);
  const [walletOwner, token] = await Promise.all([
    client.readContract({ address: walletAddress, abi: identityAbi, functionName: 'owner', blockNumber: block.number }),
    client.readContract({ address: walletAddress, abi: identityAbi, functionName: 'token', blockNumber: block.number }),
  ]);
  if (walletOwner.toLowerCase() !== owner.toLowerCase() || token[0] !== 4663n || token[1].toLowerCase() !== collection.toLowerCase() || token[2] !== 2n
    || (await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Canonical Genesis binding changed.');
  return { collection: 'genesis', contract: collection, tokenId: '2', chainId: 4663, owner, walletAddress, label: 'Genesis #2', image: '', generation: null, rushEligible: true, blockNumber: String(block.number) };
}
const pet = await readFriend();
const deps: RareLaunchDependencies = { client, verifyIdentity: async () => readFriend() };
// An immutable identity snapshot for prepare-only APIs. Any accidental provider access throws.
function readOnlySession(account: Address): PetWalletSession {
  const provider = Object.freeze({ request: () => { throw new Error('Signing/provider access is forbidden in activation smoke.'); } });
  return { getSnapshot: () => ({ status: 'connected', revision: 1, chainId: 4663, account }), getProvider: () => provider } as unknown as PetWalletSession;
}
const [friendConfig, selfConfig] = await Promise.all([
  readRareLaunchConfig(router, pet, deps), readRareSelfLaunchConfig(router, launchTreasury, deps),
]);
console.log(JSON.stringify({ stage: 'LIVE_CONFIG_PASSED', router, quoteCount: friendConfig.quoteTokens.length,
  expectedQuotes: LAUNCH_QUOTE_ASSETS.length, treasury: friendConfig.treasury,
  creatorShares: friendConfig.friendShares.toString(), treasuryShares: friendConfig.treasuryShares.toString(), protocolShares: friendConfig.protocolShares.toString(),
  genesisBrain: friendConfig.brain.toString(), genesisReadyAt: friendConfig.readyAt.toString(), selfLaunchCount: selfConfig.brain.toString() }));
const { readLaunchQuotePrice } = createLaunchQuoteReader({ clientFactory: () => client,
  fetcher: async () => {
    const response = await fetch('https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json', { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Official Chainlink registry failed: ${response.status}`);
    return Response.json({ chainlink: await response.json() });
  },
});
function draft(quote: Awaited<ReturnType<typeof readLaunchQuotePrice>>) {
  return { name: 'RarePet activation simulation', symbol: 'RPSIM', fee: 10000 as const, salt: createRareLaunchSalt(), quote,
    tokenURI: `data:application/json;base64,${Buffer.from(JSON.stringify({ name: 'RarePet activation simulation', description: 'Read-only simulation; no token is deployed.', image: 'https://rarepet.app/favicon.svg' })).toString('base64')}` };
}
const quote = await readLaunchQuotePrice('weth');
const [friend, self] = await Promise.all([
  prepareRareLaunch({ session: readOnlySession(pet.owner), pet, revision: 1, router, draft: draft(quote) }, deps),
  prepareRareSelfLaunch({ session: readOnlySession(launchTreasury), account: launchTreasury, revision: 1, router, draft: draft(quote) }, deps),
]);
const [friendAfter, selfAfter] = await Promise.all([readRareLaunchConfig(router, pet, deps), readRareSelfLaunchConfig(router, launchTreasury, deps)]);
if (friendAfter.brain !== friendConfig.brain || friendAfter.lastLaunchAt !== friendConfig.lastLaunchAt || selfAfter.brain !== selfConfig.brain) throw new Error('Launch state changed during smoke. Recheck the live ledger.');
const proof = {
  status: 'PASSED — read-only live router config and exact RF/self prepare simulations', observedAt: new Date().toISOString(), router,
  stateOverrides: false, signer: false, broadcast: false, rpcMethods: [...methods].sort(),
  config: { ...friendConfig, quoteTokens: friendConfig.quoteTokens },
  quote: { symbol: quote.asset.symbol, price: quote.usdPrice, source: quote.source, blockNumber: quote.blockNumber, updatedAt: quote.updatedAt },
  friend: { collection, tokenId: '2', owner: pet.owner, wallet: pet.walletAddress, blockNumber: friend.config.blockNumber,
    brain: friend.config.brain, readyAt: friend.config.readyAt, predictedAsset: friend.doppler.prediction.tokenAddress, poolId: friend.doppler.prediction.poolId, estimatedGas: friend.gasEstimate },
  self: { creator: launchTreasury, creatorEqualsTreasury: true, blockNumber: self.config.blockNumber, launchCount: self.config.brain,
    predictedAsset: self.doppler.prediction.tokenAddress, poolId: self.doppler.prediction.poolId, estimatedGas: self.gasEstimate },
  supply: friend.review.supply, approximateStartMarketCapUSD: friend.review.approximateStartMarketCapUSD,
  metadata: 'Inline simulation-only JSON referencing the existing public RarePet favicon; no uploads or mints.',
};
const serialized = `${JSON.stringify(proof, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}\n`;
if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, serialized, { flag: 'wx' }); }
console.log(JSON.stringify({ ...proof, config: { ...proof.config, quoteTokens: `${proof.config.quoteTokens.length} exact catalog addresses` }, output },
  (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
