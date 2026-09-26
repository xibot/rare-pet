import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DopplerSDK, airlockAbi, computePoolId, type PreparedMulticurveCreate } from '@whetstone-research/doppler-sdk/evm';
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, formatUnits, parseAbi, parseUnits, keccak256, stringToHex, zeroAddress, type Address, type Hex, type PublicClient, type TransactionReceipt } from 'viem';
import { buildRareLaunchParams, validateRareLaunchDraft, prepareRareLaunch, sendRareLaunch, confirmRareLaunch, readRareLaunchFees, claimRareLaunchFees,
  RARE_LAUNCH_DOPPLER as D, RARE_LAUNCH_ROUTER_ABI, RARE_LAUNCH_SUPPLY, type RareLaunchConfig, type RareLaunchDraft, type RareLaunchDependencies } from '../games/rare-pet/launch-doppler.ts';
import { LAUNCH_QUOTE_ASSETS, getLaunchQuoteAsset, type LaunchQuoteAsset } from '../games/rare-pet/launch-quotes.ts';
import { RARE_WALLET_ABI } from '../games/rare-pet/rare-wallet-transfer.ts';
import type { PetIdentity, PetWalletSession } from '../games/rare-pet/wallet.ts';
import originalDeployment from '../contracts/rare-launchpad/deployments/4663.json' with { type: 'json' };
const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const WALLET = '0x2222222222222222222222222222222222222222' as Address;
const ROUTER = '0x3333333333333333333333333333333333333333' as Address;
const TREASURY = '0xCa88efc94b567A5185FEA63599aD895c3e514FBc' as Address;
const PROTOCOL = '0x5555555555555555555555555555555555555555' as Address;
const ASSET = '0x6666666666666666666666666666666666666666' as Address;
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as Address;
const COLLECTION = '0x116EaA62241751E0c98dA43d458600c6C17cD361' as Address;
const HASH = `0x${'a'.repeat(64)}` as Hex, BLOCK = `0x${'b'.repeat(64)}` as Hex, SALT = `0x${'c'.repeat(64)}` as Hex;
const NOW = 1_800_000_000_000;
const oldRouter = originalDeployment.address as Address;
const oldQuotes = originalDeployment.configuration.quotes.map(quote => quote.address as Address);
const oldCode = readFileSync(new URL('./fixtures/launch-router-v1-runtime.txt', import.meta.url), 'utf8').trim() as Hex;
const pet: PetIdentity = { collection: 'genesis', chainId: 4663, contract: COLLECTION, tokenId: '2', label: 'Genesis #2', image: '', owner: OWNER, walletAddress: WALLET, blockNumber: '20', generation: null, rushEligible: true };
const draft: RareLaunchDraft = { name: 'Rare Cat', symbol: 'RCAT', tokenURI: 'data:application/json;base64,e30=', fee: 3000, salt: SALT,
  quote: { asset: getLaunchQuoteAsset('weth'),
    usdPrice: '2000', usdPriceE18: 2000n * 10n ** 18n, blockNumber: 20n, updatedAt: NOW / 1000 - 300, readAt: NOW / 1000,
    expiresAt: NOW / 1000 + 120, heartbeatSeconds: 86400, source: 'chainlink', feedAddress: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9', sequencerVerified: false } };
const config: RareLaunchConfig = { router: ROUTER, treasury: TREASURY, protocol: PROTOCOL, totalSupply: RARE_LAUNCH_SUPPLY,
  friendShares: 850n * 10n ** 15n, treasuryShares: 100n * 10n ** 15n, protocolShares: 50n * 10n ** 15n,
  quoteTokens: LAUNCH_QUOTE_ASSETS.map(asset => asset.address), brain: 0n, lastLaunchAt: 0n, hasLaunched: false, readyAt: 0n, blockNumber: 20n, timestamp: BigInt(NOW / 1000) };
function fixture(selectedDraft = draft, launchedAsset: Address = ASSET) {
  const draft = selectedDraft, ASSET = launchedAsset, WETH = selectedDraft.quote.asset.address;
  const state = { revision: 4, status: 'connected', chainId: 4663, account: OWNER };
  const provider = {};
  const session = { getSnapshot: () => state, getProvider: () => provider } as unknown as PetWalletSession;
  const changes = { chain: 4663, fresh: pet, code: '0x1234', owner: OWNER, binding: [4663n, COLLECTION, 2n],
    module: true, config: { ...config }, now: NOW, afterPrepare: () => {}, afterSimulation: () => {}, afterVerify: () => {},
    simulationError: null as Error | null, receiptError: null as Error | null, receiptStatus: 'success',
    self: false, missingEvent: false, wrongAsset: false, txInput: undefined as Hex | undefined, blockHash: BLOCK, pending0: 10n, pending1: 20n, claimed: false };
  const writes: Record<string, unknown>[] = [], hashes: Hex[] = [];
  let call: Record<string, unknown>, prepared: PreparedMulticurveCreate<4663>;
  const tokenIsCurrency0 = BigInt(ASSET) < BigInt(WETH);
  const poolKey = { currency0: tokenIsCurrency0 ? ASSET : WETH, currency1: tokenIsCurrency0 ? WETH : ASSET, fee: 3000, tickSpacing: 200, hooks: D.initializer };
  const poolId = computePoolId(poolKey);
  const client = {
    async getChainId() { return changes.chain; }, async getBlockNumber() { return 20n; },
    async getBlock() { return { hash: changes.blockHash, timestamp: BigInt(changes.now / 1000) }; },
    async getCode() { return changes.code; },
    async readContract({ functionName, address }: { functionName: string; address: Address }) {
      if (functionName === 'owner') return address.toLowerCase() === D.airlock.toLowerCase() ? PROTOCOL : changes.owner;
      if (functionName === 'token') return changes.binding;
      const names: Record<string, unknown> = { CHAIN_ID: 4663n, AIRLOCK: D.airlock, TOKEN_FACTORY: D.tokenFactory, INITIALIZER: D.initializer, GOVERNANCE: D.governance, MIGRATOR: D.migrator,
        treasury: changes.config.treasury, totalSupply: changes.config.totalSupply, friendShares: changes.config.friendShares, treasuryShares: changes.config.treasuryShares, quoteTokens: changes.config.quoteTokens,
        launchedAsset: true, getState: [WETH, RARE_LAUNCH_SUPPLY, zeroAddress, '0x', 2, poolKey, 100000], getShares: config.friendShares,
        getCumulatedFees0: 100n, getCumulatedFees1: 200n, getLastCumulatedFees0: 40n, getLastCumulatedFees1: 60n };
      if (functionName === 'selfLaunchCount') return writes.length ? 1n : 0n;
      if (functionName === 'getLaunch') return writes.length ? { brain: 1n, hasLaunched: true, lastLaunchAt: BigInt(changes.now / 1000) } : changes.config;
      if (functionName === 'getModuleState') return changes.module ? [D.tokenFactory, D.governance, D.initializer, D.migrator].indexOf(address as never) + 1 : 0;
      if (functionName in names) return names[functionName];
      throw new Error(`unexpected read ${functionName}`);
    },
    async simulateContract(args: Record<string, unknown>) {
      if (changes.simulationError) throw changes.simulationError;
      changes.afterSimulation();
      if (args.functionName === 'launchAsSelf') { call = args; return { result: ASSET }; }
      if (args.functionName === 'collectFees') return { result: [changes.pending0, changes.pending1] };
      call = args; return { result: encodeAbiParameters([{ type: 'address' }], [ASSET]), request: args };
    },
    async estimateContractGas() { return 2_000_000n; },
    async getTransaction() { return { hash: HASH, to: call?.address ?? WALLET, from: OWNER, value: 0n, input: changes.txInput ?? (call!.data as Hex), blockNumber: 21n, blockHash: BLOCK }; },
    async waitForTransactionReceipt() {
      if (changes.receiptError) throw changes.receiptError;
      const base = { address: ROUTER, blockHash: BLOCK, blockNumber: 21n, logIndex: 0, transactionHash: HASH, transactionIndex: 0, removed: false };
      const asset = changes.wrongAsset ? TREASURY : ASSET;
      const logs = changes.missingEvent ? [] : [
        { ...base, topics: encodeEventTopics({ abi: RARE_LAUNCH_ROUTER_ABI, eventName: 'LaunchRecorded', args: { collection: COLLECTION, tokenId: 2n, asset } }),
          data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'bytes32' }, { type: 'uint256' }], [WALLET, OWNER, WETH, 3000, keccak256(stringToHex(draft.tokenURI)), BigInt(changes.now / 1000)]) },
        { ...base, address: D.airlock, logIndex: 1, topics: encodeEventTopics({ abi: airlockAbi, eventName: 'Create', args: { numeraire: WETH } }),
          data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [ASSET, D.initializer, ASSET]) },
      ];
      if (changes.self && logs.length) logs[0] = { ...base, topics: encodeEventTopics({ abi: RARE_LAUNCH_ROUTER_ABI, eventName: 'SelfLaunchRecorded', args: { creator: OWNER, asset } }), data: encodeAbiParameters([{ type: 'address' }, { type: 'uint24' }, { type: 'bytes32' }, { type: 'uint256' }], [WETH, 3000, keccak256(stringToHex(draft.tokenURI)), BigInt(changes.now / 1000)]) };
      return { transactionHash: HASH, status: changes.receiptStatus, blockHash: BLOCK, blockNumber: 21n, logs } as TransactionReceipt;
    },
  };
  // getModuleState is queried on Airlock; its argument determines the module.
  const read = client.readContract.bind(client);
  client.readContract = async (args: { functionName: string; address: Address; args?: Address[] }) => {
    if (args.functionName === 'getModuleState') return changes.module ? [D.tokenFactory, D.governance, D.initializer, D.migrator].findIndex(a => a.toLowerCase() === args.args?.[0]?.toLowerCase()) + 1 : 0;
    return read(args);
  };
  const deps = {
    client, now: () => changes.now, refreshQuote: async () => draft.quote,
    async verifyIdentity() { changes.afterVerify(); return changes.fresh; },
    signer: { chain: { id: 4663 }, async getChainId() { return changes.chain; }, async getAddresses() { return [state.account]; }, async writeContract(args: Record<string, unknown>) {
      writes.push(args); call = { ...args, data: (await import('viem')).encodeFunctionData({ abi: args.abi as never, functionName: args.functionName as never, args: args.args as never }) }; return HASH;
    } },
    async prepare(params: Parameters<DopplerSDK<4663>['factory']['encodeCreateMulticurveParams']>[0]) {
      const sdk = new DopplerSDK<4663>({ chainId: 4663, publicClient: client as unknown as PublicClient });
      const createParams = sdk.factory.encodeCreateMulticurveParams(params);
      const { encodeFunctionData } = await import('viem');
      prepared = { chainId: 4663, account: ROUTER, airlock: D.airlock, createParams,
        transaction: { to: D.airlock, value: 0n, data: encodeFunctionData({ abi: airlockAbi, functionName: 'create', args: [createParams] }) }, gasEstimate: { status: 'estimated', gas: 1500000n },
        prediction: { tokenAddress: ASSET, poolOrHookAddress: ASSET, governanceAddress: D.dead, timelockAddress: D.dead, migrationPoolAddress: D.migrationDead, poolKey, poolId, tokenIsCurrency0 } };
      changes.afterPrepare(); return prepared;
    },
  } as unknown as RareLaunchDependencies;
  const options = { session, pet, revision: 4, router: ROUTER, draft, onHash: (hash: Hex) => hashes.push(hash) };
  return { options, deps, state, changes, writes, hashes, client, poolId };
}

test('fair launch has no premint/vesting/governance and includes full exact fee split', () => {
  const b = buildRareLaunchParams({ pet, config, draft, now: NOW });
  assert.equal(b.params.sale.numTokensToSell, RARE_LAUNCH_SUPPLY);
  assert.equal(b.params.sale.initialSupply, RARE_LAUNCH_SUPPLY);
  assert.equal(b.params.token.type, 'dopplerERC20V1'); assert.equal(b.params.vesting, undefined); assert.equal(b.params.devBuy, undefined);
  assert.equal(b.params.governance.type, 'noOp'); assert.equal(b.params.migration.type, 'noOp');
  assert.equal(b.params.pool.curves.reduce((sum, x) => sum + x.shares, 0n), 10n ** 18n);
  assert.equal(b.params.pool.beneficiaries!.reduce((sum, x) => sum + x.shares, 0n), 10n ** 18n);
  assert.deepEqual(b.params.pool.beneficiaries!.map(x => x.shares), [config.friendShares, config.protocolShares, config.treasuryShares]);
  assert.ok(b.review.approximateStartMarketCapUSD > 9700 && b.review.approximateStartMarketCapUSD < 10300);
  assert.equal(b.request.farTick, Math.max(...b.request.curves.map(c => c.tickUpper)) - 200);
  assert.ok(Object.isFrozen(b.request.curves));
});
test('derived salt binds canonical identity, router and next launch count', () => {
  const first = buildRareLaunchParams({ pet, config, draft, now: NOW });
  assert.notEqual(first.params.salt, draft.salt);
  for (const changed of [{ ...config, brain: 1n }, { ...config, router: ASSET }]) assert.notEqual(buildRareLaunchParams({ pet, config: changed, draft, now: NOW }).params.salt, first.params.salt);
});
test('rejects stale quotes, arbitrary fee/name/metadata and gross 90/10 allocations', () => {
  for (const changed of [{ ...draft, fee: 500 }, { ...draft, symbol: 'bad' }, { ...draft, tokenURI: 'https://mutable.example/a' }, { ...draft, name: 'bad\nname' }, { ...draft, quote: { ...draft.quote, expiresAt: NOW / 1000 } }]) assert.throws(() => validateRareLaunchDraft(changed as RareLaunchDraft, NOW));
  assert.throws(() => buildRareLaunchParams({ pet, config: { ...config, friendShares: 9n * 10n ** 17n, treasuryShares: 1n * 10n ** 17n }, draft, now: NOW }), /policy/);
});
test('SDK token factory data encodes zero allocation and no balance controller', () => {
  const f = fixture(), b = buildRareLaunchParams({ pet, config, draft, now: NOW });
  const p = new DopplerSDK<4663>({ chainId: 4663, publicClient: f.deps.client as PublicClient }).factory.encodeCreateMulticurveParams(b.params);
  const values = decodeAbiParameters([{ type: 'string' }, { type: 'string' }, { type: 'tuple[]', components: [{ type: 'uint64' }, { type: 'uint64' }] }, { type: 'address[]' }, { type: 'uint256[]' }, { type: 'uint256[]' }, { type: 'string' }, { type: 'uint256' }, { type: 'uint48' }, { type: 'address' }, { type: 'address[]' }], p.tokenFactoryData);
  assert.deepEqual(values.slice(2, 6), [[], [], [], []]); assert.deepEqual(values.slice(7), [0n, 0, zeroAddress, []]);
});
test('prepare is read-only and exact owner → RF → router launch', async () => {
  const f = fixture(); const p = await prepareRareLaunch(f.options, f.deps);
  assert.equal(f.writes.length, 0);
  const outer = decodeFunctionData({ abi: RARE_WALLET_ABI, data: p.data });
  assert.equal(outer.functionName, 'execute'); assert.deepEqual([outer.args![0], outer.args![1], outer.args![3]], [ROUTER, 0n, 0]);
  const inner = decodeFunctionData({ abi: RARE_LAUNCH_ROUTER_ABI, data: outer.args![2] as Hex }); assert.equal(inner.functionName, 'launch');
});
test('prepare rejects wrong chain, unauthorized owner, undeployed router and nonwhitelisted modules', async () => {
  for (const mutate of [ (f: ReturnType<typeof fixture>) => { f.changes.chain = 1; }, (f: ReturnType<typeof fixture>) => { f.changes.owner = TREASURY; },
    (f: ReturnType<typeof fixture>) => { f.changes.code = '0x'; }, (f: ReturnType<typeof fixture>) => { f.changes.module = false; } ]) {
    const f = fixture(); mutate(f); await assert.rejects(prepareRareLaunch(f.options, f.deps)); assert.equal(f.writes.length, 0);
  }
});
test('account changes during prepare stop before review', async () => {
  const f = fixture(); f.changes.afterPrepare = () => { f.state.revision++; };
  await assert.rejects(prepareRareLaunch(f.options, f.deps), /changed/); assert.equal(f.writes.length, 0);
});
test('send verifies exact matching router and Airlock events plus permanent pool', async () => {
  const f = fixture(), p = await prepareRareLaunch(f.options, f.deps);
  const result = await sendRareLaunch({ ...f.options, prepared: p }, f.deps);
  assert.equal(result.asset, ASSET); assert.equal(result.brain, 1n); assert.deepEqual(f.hashes, [HASH]); assert.equal(f.writes.length, 1);
});
test('a changed fee config, expired review or failed simulation never prompts wallet', async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.changes.config.treasury = OWNER; }, (f: ReturnType<typeof fixture>) => { f.changes.now += 121000; }, (f: ReturnType<typeof fixture>) => { f.changes.simulationError = new Error('execution reverted'); }]) {
    const f = fixture(), p = await prepareRareLaunch(f.options, f.deps); mutate(f);
    await assert.rejects(sendRareLaunch({ ...f.options, prepared: p }, f.deps)); assert.equal(f.writes.length, 0);
  }
});
test('session change during final simulation prevents signature', async () => {
  const f = fixture(), p = await prepareRareLaunch(f.options, f.deps); f.changes.afterSimulation = () => { f.state.revision++; };
  await assert.rejects(sendRareLaunch({ ...f.options, prepared: p }, f.deps), /changed/); assert.equal(f.writes.length, 0);
});
test('unknown receipt preserves submitted hash and recovery never resubmits', async () => {
  const f = fixture(), p = await prepareRareLaunch(f.options, f.deps); f.changes.receiptError = new Error('offline');
  await assert.rejects(sendRareLaunch({ ...f.options, prepared: p }, f.deps), (error: unknown) => (error as { transactionHash?: string }).transactionHash === HASH);
  f.changes.receiptError = null; await confirmRareLaunch(HASH, p, f.deps); assert.equal(f.writes.length, 1);
});
test('unrelated successful receipts and calldata replacements cannot claim launch success', async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.changes.missingEvent = true; }, (f: ReturnType<typeof fixture>) => { f.changes.wrongAsset = true; }, (f: ReturnType<typeof fixture>) => { f.changes.txInput = '0x'; }, (f: ReturnType<typeof fixture>) => { f.changes.receiptStatus = 'reverted'; }]) {
    const f = fixture(), p = await prepareRareLaunch(f.options, f.deps); mutate(f);
    await assert.rejects(sendRareLaunch({ ...f.options, prepared: p }, f.deps)); assert.equal(f.writes.length, 1); assert.deepEqual(f.hashes, [HASH]);
  }
});
test('pending fee amounts include uncollected fees and beneficiary checkpoints exactly', async () => {
  const f = fixture(); const fees = await readRareLaunchFees({ asset: ASSET, wallet: WALLET }, f.deps);
  assert.equal(fees.amount0, (100n + 10n - 40n) * config.friendShares / 10n ** 18n);
  assert.equal(fees.amount1, (200n + 20n - 60n) * config.friendShares / 10n ** 18n);
  assert.equal(f.writes.length, 0);
});
test('claim rejects stale session after readonly fees and never sends owner assets', async () => {
  const f = fixture(); f.changes.afterSimulation = () => { f.state.revision++; };
  await assert.rejects(claimRareLaunchFees({ ...f.options, asset: ASSET }, f.deps), /changed/); assert.equal(f.writes.length, 0);
});

test('history uses only exact canonical Friend events and detects truncated RPC results', async () => {
  const { readRareLaunchHistory } = await import('../games/rare-pet/launch-doppler.ts');
  const f = fixture(); f.changes.config.brain = 1n;
  (f.deps.client as unknown as { getLogs: (args: unknown) => Promise<unknown[]> }).getLogs = async () => {
    const receipt = await f.client.waitForTransactionReceipt();
    return [{ ...receipt.logs[0], args: { collection: COLLECTION, tokenId: 2n, asset: ASSET, friendWallet: WALLET, owner: OWNER, quote: WETH, fee: 3000, metadataHash: HASH, timestamp: BigInt(NOW / 1000) }, blockNumber: 20n }];
  };
  const result = await readRareLaunchHistory({ router: ROUTER, pet }, f.deps); assert.equal(result.items[0].asset, ASSET);
  (f.deps.client as unknown as { getLogs: () => Promise<unknown[]> }).getLogs = async () => [];
  await assert.rejects(readRareLaunchHistory({ router: ROUTER, pet }, f.deps), /incomplete/);
});
test('pending launch persistence restores exact proof without issuing any new call', async () => {
  const { createRareLaunchTransactionStore } = await import('../games/rare-pet/launch-transactions.ts');
  const f = fixture(), prepared = await prepareRareLaunch(f.options, f.deps);
  const values = new Map<string, string>(); const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const first = createRareLaunchTransactionStore({ storage }); first.setRareLaunchTransaction(WALLET, { hash: HASH, status: 'pending', prepared });
  let recovered = 0;
  const second = createRareLaunchTransactionStore({ storage, confirm: async (hash, saved) => { recovered++; assert.equal(hash, HASH); assert.equal(saved.data, prepared.data); return { hash, asset: ASSET, poolId: prepared.doppler.prediction.poolId, timestamp: BigInt(NOW / 1000), brain: 1n }; } });
  assert.equal(second.getRareLaunchTransaction(WALLET)?.prepared.config.friendShares, config.friendShares);
  await second.refreshRareLaunchTransaction(WALLET); assert.equal(second.getRareLaunchTransaction(WALLET)?.status, 'confirmed'); assert.equal(recovered, 1); assert.equal(f.writes.length, 0);
  second.setRareLaunchTransaction(WALLET, { hash: HASH, status: 'unverified', prepared, error: 'old waiter timed out' });
  assert.equal(second.getRareLaunchTransaction(WALLET)?.status, 'confirmed');
});
test('reloaded awaiting-wallet launch stays blocked until explicitly checked', async () => {
  const { createRareLaunchTransactionStore } = await import('../games/rare-pet/launch-transactions.ts');
  const f = fixture(), prepared = await prepareRareLaunch(f.options, f.deps);
  let raw = ''; const storage = { getItem: () => raw, setItem: (_k: string, v: string) => { raw = v; }, removeItem: () => { raw = ''; } };
  createRareLaunchTransactionStore({ storage }).setRareLaunchTransaction(WALLET, { hash: null, status: 'awaiting-wallet', prepared });
  const store = createRareLaunchTransactionStore({ storage }); assert.equal(store.getRareLaunchTransaction(WALLET)?.status, 'unverified');
});
test('stored payloads reject changed calldata, wrong wallet, chain and malformed bigints', async () => {
  const { createRareLaunchTransactionStore } = await import('../games/rare-pet/launch-transactions.ts');
  const f = fixture(), prepared = await prepareRareLaunch(f.options, f.deps);
  let raw = ''; const storage = { getItem: () => raw, setItem: (_k: string, v: string) => { raw = v; }, removeItem: () => { raw = ''; } };
  createRareLaunchTransactionStore({ storage }).setRareLaunchTransaction(WALLET, { hash: HASH, status: 'pending', prepared });
  const valid = raw;
  for (const mutate of [ (p: any) => { p.chainId = 1; }, (p: any) => { p.records[0].wallet = OWNER; }, (p: any) => { p.records[0].prepared.data = '0x'; }, (p: any) => { p.records[0].prepared.config.brain = { $bigint: '1e6' }; } ]) {
    const p = JSON.parse(valid); mutate(p); raw = JSON.stringify(p); assert.equal(createRareLaunchTransactionStore({ storage }).getRareLaunchTransaction(WALLET), null);
  }
});
test('late recovery cannot overwrite a newly reviewed launch or an explicit dismissal', async () => {
  const { createRareLaunchTransactionStore } = await import('../games/rare-pet/launch-transactions.ts');
  const f = fixture(), prepared = await prepareRareLaunch(f.options, f.deps);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = createRareLaunchTransactionStore({ storage: null, confirm: async hash => { await gate; return { hash, asset: ASSET, poolId: prepared.doppler.prediction.poolId, timestamp: 1n, brain: 1n }; } });
  store.setRareLaunchTransaction(WALLET, { hash: HASH, status: 'pending', prepared }); const work = store.refreshRareLaunchTransaction(WALLET);
  store.setRareLaunchTransaction(WALLET, null); release(); await work; assert.equal(store.getRareLaunchTransaction(WALLET), null);
});

test('self launch uses its EOA as beneficiary and calls router directly without any NFT', async () => {
  const { prepareRareSelfLaunch, sendRareSelfLaunch } = await import('../games/rare-pet/launch-doppler.ts');
  const f = fixture(); f.changes.self = true; f.changes.fresh = { ...pet, owner: TREASURY };
  const options = { session: f.options.session, account: OWNER, revision: 4, router: ROUTER, draft, onHash: f.options.onHash };
  const prepared = await prepareRareSelfLaunch(options, f.deps); assert.equal(prepared.mode, 'self'); assert.ok(!('pet' in prepared));
  assert.equal(decodeFunctionData({ abi: RARE_LAUNCH_ROUTER_ABI, data: prepared.data }).functionName, 'launchAsSelf');
  assert.equal(prepared.review.wallet, OWNER); assert.equal(prepared.config.readyAt, 0n);
  const result = await sendRareSelfLaunch({ ...options, prepared }, f.deps); assert.equal(result.launchCount, 1n); assert.ok(!('brain' in result));
  assert.equal(f.writes[0].address, ROUTER); assert.equal(f.writes[0].functionName, 'launchAsSelf');
});
test('self launch changing accounts or oracle price requires a new review', async () => {
  const { prepareRareSelfLaunch, sendRareSelfLaunch } = await import('../games/rare-pet/launch-doppler.ts');
  const f = fixture(); f.changes.self = true;
  const options = { session: f.options.session, account: OWNER, revision: 4, router: ROUTER, draft, onHash: f.options.onHash };
  const prepared = await prepareRareSelfLaunch(options, f.deps);
  const deps = { ...f.deps, refreshQuote: async () => ({ ...draft.quote, usdPrice: '2100', usdPriceE18: 2100n * 10n ** 18n }) };
  await assert.rejects(sendRareSelfLaunch({ ...options, prepared }, deps), /price changed/); assert.equal(f.writes.length, 0);
  f.state.account = TREASURY;
  await assert.rejects(sendRareSelfLaunch({ ...options, prepared }, f.deps), /changed/); assert.equal(f.writes.length, 0);
});
test('self fee recipients merge safely when creator equals treasury and use only85/10/5 policy', async () => {
  const { buildRareSelfLaunchParams } = await import('../games/rare-pet/launch-doppler.ts');
  const b = buildRareSelfLaunchParams({ account: TREASURY, config, draft, now: NOW });
  assert.deepEqual(b.params.pool.beneficiaries, [{ beneficiary: PROTOCOL, shares: 50n * 10n ** 15n }, { beneficiary: TREASURY, shares: 950n * 10n ** 15n }]);
  assert.throws(() => buildRareSelfLaunchParams({ account: OWNER, config: { ...config, friendShares: 855n * 10n ** 15n, treasuryShares: 95n * 10n ** 15n }, draft, now: NOW }), /policy/);
});
test('self launch persists as self and cannot restore under another creator account', async () => {
  const { prepareRareSelfLaunch } = await import('../games/rare-pet/launch-doppler.ts');
  const { createRareLaunchTransactionStore } = await import('../games/rare-pet/launch-transactions.ts');
  const f = fixture(); f.changes.self = true;
  const prepared = await prepareRareSelfLaunch({ session: f.options.session, account: OWNER, revision: 4, router: ROUTER, draft }, f.deps);
  let raw = ''; const storage = { getItem: () => raw, setItem: (_k: string, v: string) => { raw = v; }, removeItem: () => { raw = ''; } };
  createRareLaunchTransactionStore({ storage }).setRareLaunchTransaction(OWNER, { hash: HASH, status: 'pending', prepared });
  const restored = createRareLaunchTransactionStore({ storage }); assert.equal(restored.getRareLaunchTransaction(OWNER)?.prepared.mode, 'self'); assert.equal(restored.getRareLaunchTransaction(WALLET), null);
});

test('fee claim recovery verifies exact direct and RF calls, never a third-party release', async () => {
  const { confirmRareLaunchFeeClaim } = await import('../games/rare-pet/launch-doppler.ts');
  const feeAbi = parseAbi(['function collectFees(bytes32) returns(uint128,uint128)', 'event Release(bytes32 indexed poolId,address indexed beneficiary,uint256 fees0,uint256 fees1)']);
  for (const mode of ['friend', 'self'] as const) {
    const f = fixture(), beneficiary = mode === 'friend' ? WALLET : OWNER;
    const inner = encodeFunctionData({ abi: feeAbi, functionName: 'collectFees', args: [f.poolId] });
    const data = mode === 'self' ? inner : encodeFunctionData({ abi: RARE_WALLET_ABI, functionName: 'execute', args: [D.initializer, 0n, inner, 0] });
    f.client.getTransaction = async () => ({ hash: HASH, to: mode === 'self' ? D.initializer : WALLET, from: OWNER, value: 0n, input: data, blockNumber: 21n, blockHash: BLOCK });
    let releasedTo = beneficiary;
    f.client.waitForTransactionReceipt = async () => ({ transactionHash: HASH, status: 'success', blockHash: BLOCK, blockNumber: 21n,
      logs: [{ address: D.initializer, topics: encodeEventTopics({ abi: feeAbi, eventName: 'Release', args: { poolId: f.poolId, beneficiary: releasedTo } }), data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [42n, 71n]) }] } as TransactionReceipt);
    const proof = { hash: HASH, asset: ASSET, wallet: beneficiary, owner: OWNER, mode };
    const result = await confirmRareLaunchFeeClaim(proof, f.deps); assert.equal(result.amount0, 42n); assert.equal(result.amount1, 71n); assert.equal(f.writes.length, 0);
    releasedTo = TREASURY; await assert.rejects(confirmRareLaunchFeeClaim(proof, f.deps), (error: unknown) => (error as { code?: string }).code === 'unverified');
  }
});
test('a reverted unrelated transaction cannot clear the real pending launch', async () => {
  const f = fixture(), prepared = await prepareRareLaunch(f.options, f.deps); f.changes.receiptStatus = 'reverted'; f.changes.txInput = '0x';
  await assert.rejects(sendRareLaunch({ ...f.options, prepared }, f.deps), (error: unknown) => (error as { code?: string }).code === 'unverified');
});
test('read-only recovery rejects a receipt whose block was reorganized', async () => {
  const f = fixture(), prepared = await prepareRareLaunch(f.options, f.deps); f.changes.blockHash = HASH;
  await assert.rejects(sendRareLaunch({ ...f.options, prepared }, f.deps), (error: unknown) => (error as { code?: string }).code === 'reorg');
});

test('wallet-request callback distinguishes preprompt validation failures from ambiguous provider failures', async () => {
  const f = fixture(), prepared = await prepareRareLaunch(f.options, f.deps);
  let requested = 0;
  f.changes.simulationError = new Error('simulation reverted');
  await assert.rejects(sendRareLaunch({ ...f.options, prepared, onWalletRequest: () => { requested++; } }, f.deps)); assert.equal(requested, 0);
  f.changes.simulationError = null;
  const deps = { ...f.deps, signer: { ...f.deps.signer!, writeContract: async () => { throw new Error('wallet transport lost after request'); } } } as RareLaunchDependencies;
  await assert.rejects(sendRareLaunch({ ...f.options, prepared, onWalletRequest: () => { requested++; } }, deps)); assert.equal(requested, 1);
});
test('self launch only marks wallet request after verified quote and exact simulation', async () => {
  const { prepareRareSelfLaunch, sendRareSelfLaunch } = await import('../games/rare-pet/launch-doppler.ts');
  const f = fixture(); f.changes.self = true;
  const options = { session: f.options.session, account: OWNER, revision: 4, router: ROUTER, draft, onHash: f.options.onHash };
  const prepared = await prepareRareSelfLaunch(options, f.deps); let requested = 0;
  f.changes.simulationError = new Error('notready');
  await assert.rejects(sendRareSelfLaunch({ ...options, prepared, onWalletRequest: () => { requested++; } }, f.deps)); assert.equal(requested, 0);
  f.changes.simulationError = null;
  await sendRareSelfLaunch({ ...options, prepared, onWalletRequest: () => { requested++; } }, f.deps); assert.equal(requested, 1);
});

test('fee claims mark the provider-request boundary in both creator modes', async () => {
  const { claimRareSelfLaunchFees } = await import('../games/rare-pet/launch-doppler.ts');
  for (const mode of ['friend', 'self'] as const) {
    const f = fixture(); let requested = 0;
    const deps = { ...f.deps, signer: { ...f.deps.signer!, writeContract: async () => { throw new Error('provider response unknown'); } } } as RareLaunchDependencies;
    const common = { session: f.options.session, revision: 4, asset: ASSET, onHash: f.options.onHash, onWalletRequest: () => { requested++; } };
    await assert.rejects(mode === 'self' ? claimRareSelfLaunchFees({ ...common, account: OWNER }, deps) : claimRareLaunchFees({ ...common, pet }, deps), /provider response unknown/);
    assert.equal(requested, 1); assert.equal(f.writes.length, 0);
  }
});

test('late original waiter cannot replace a newer pending launch for the same creator', async () => {
  const { createRareLaunchTransactionStore } = await import('../games/rare-pet/launch-transactions.ts');
  const f = fixture(), first = await prepareRareLaunch(f.options, f.deps);
  const next = await prepareRareLaunch({ ...f.options, draft: { ...draft, salt: HASH } }, f.deps);
  const store = createRareLaunchTransactionStore({ storage: null });
  store.setRareLaunchTransaction(WALLET, { hash: HASH, status: 'confirmed', prepared: first });
  store.setRareLaunchTransaction(WALLET, { hash: null, status: 'awaiting-wallet', prepared: next });
  store.setRareLaunchTransaction(WALLET, { hash: HASH, status: 'unverified', prepared: first, error: 'old waiter timed out' });
  assert.equal(store.getRareLaunchTransaction(WALLET)?.prepared.data, next.data);
  assert.equal(store.getRareLaunchTransaction(WALLET)?.status, 'awaiting-wallet');
  assert.throws(() => store.setRareLaunchTransaction(WALLET, { hash: null, status: 'awaiting-wallet', prepared: first }), /unresolved/);
});

test('both creator modes require the user-confirmed treasury even with an otherwise valid85/10/5 router', async () => {
  const { readRareLaunchConfig, readRareSelfLaunchConfig, buildRareSelfLaunchParams } = await import('../games/rare-pet/launch-doppler.ts');
  const f = fixture();
  assert.equal((await readRareLaunchConfig(ROUTER, pet, f.deps)).treasury, TREASURY);
  assert.equal((await readRareSelfLaunchConfig(ROUTER, OWNER, f.deps)).treasury, TREASURY);
  f.changes.config.treasury = '0x4444444444444444444444444444444444444444';
  await assert.rejects(readRareLaunchConfig(ROUTER, pet, f.deps), /confirmed RarePet treasury/);
  await assert.rejects(readRareSelfLaunchConfig(ROUTER, OWNER, f.deps), /confirmed RarePet treasury/);
  assert.throws(() => buildRareLaunchParams({ pet, config: f.changes.config, draft, now: NOW }), /confirmed RarePet treasury/);
  assert.throws(() => buildRareSelfLaunchParams({ account: OWNER, config: f.changes.config, draft, now: NOW }), /confirmed RarePet treasury/);
  assert.equal(f.writes.length, 0);
});

test('fresh launch policy requires the exact complete quote catalog independent of history limits', async () => {
  const { readRareLaunchConfig, readRareSelfLaunchConfig, verifyRareLaunchQuoteCatalog } = await import('../games/rare-pet/launch-doppler.ts');
  assert.doesNotThrow(() => verifyRareLaunchQuoteCatalog([...config.quoteTokens].reverse()));
  for (const quoteTokens of [config.quoteTokens.slice(1), [...config.quoteTokens, OWNER], [...config.quoteTokens, config.quoteTokens[0]]]) {
    const f = fixture(); f.changes.config.quoteTokens = quoteTokens;
    assert.throws(() => buildRareLaunchParams({ pet, config: f.changes.config, draft, now: NOW }), /quote catalog/);
    await assert.rejects(readRareLaunchConfig(ROUTER, pet, f.deps), /quote catalog/);
    await assert.rejects(readRareSelfLaunchConfig(ROUTER, OWNER, f.deps), /quote catalog/);
    assert.equal(f.writes.length, 0);
  }
});
test('unlisted quote IDs, swapped token addresses, feeds and symbols never enter a new launch', () => {
  for (const asset of [
    { ...draft.quote.asset, id: 'not-a-listed-asset' }, { ...draft.quote.asset, address: OWNER },
    { ...draft.quote.asset, feedAddress: OWNER }, { ...draft.quote.asset, symbol: 'SPOOF' },
  ]) assert.throws(() => buildRareLaunchParams({ pet, config, draft: { ...draft, quote: { ...draft.quote, asset } } as RareLaunchDraft, now: NOW }));
});
test('catalog changes do not discard pending recovery proof from an older catalog snapshot', async () => {
  const { validateStoredRareLaunch } = await import('../games/rare-pet/launch-doppler.ts');
  const { createRareLaunchTransactionStore } = await import('../games/rare-pet/launch-transactions.ts');
  const f = fixture(), prepared = await prepareRareLaunch(f.options, f.deps);
  const historical = structuredClone(prepared);
  historical.config = { ...historical.config, quoteTokens: [WETH] };
  historical.draft = { ...historical.draft, quote: { ...historical.draft.quote, asset: { ...historical.draft.quote.asset, id: 'retired-catalog-id' } } } as RareLaunchDraft;
  assert.equal(validateStoredRareLaunch(WALLET, historical).data, prepared.data);
  let raw = ''; const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = ''; } };
  createRareLaunchTransactionStore({ storage }).setRareLaunchTransaction(WALLET, { hash: HASH, status: 'pending', prepared: historical });
  assert.equal(createRareLaunchTransactionStore({ storage }).getRareLaunchTransaction(WALLET)?.hash, HASH);
  await assert.rejects(sendRareLaunch({ ...f.options, prepared: historical }, f.deps), /supported/);
  assert.equal(f.writes.length, 0);
});

function draftForQuote(asset: LaunchQuoteAsset): RareLaunchDraft {
  return { ...draft, quote: { ...draft.quote, asset, source: asset.priceSource, feedAddress: asset.feedAddress,
    ...(asset.kind === 'rarefriends' ? { usdPrice:'0.002', usdPriceE18:2000000000000000n,
      pool:{poolId:'0x9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240' as Hex,windowStart:NOW/1000-1800,windowEnd:NOW/1000,windowSeconds:1800 as const,lastSwapAt:NOW/1000-600,wethPerTokenE18:1000000000000n,spotWethPerTokenE18:1000000000000n,permanentWethDepthWei:20n*10n**18n} } : {}),
    updatedAt: NOW / 1000, heartbeatSeconds: asset.priceSource === 'robinhood' ? 90 : 86400,
    expiresAt: NOW / 1000 + (asset.priceSource === 'robinhood' ? 90 : 120) } };
}
test('every catalog asset can build the same zero-allocation permanent-liquidity launch in both modes', async () => {
  const { buildRareSelfLaunchParams } = await import('../games/rare-pet/launch-doppler.ts');
  assert.equal(LAUNCH_QUOTE_ASSETS.filter(a => a.kind === 'stock').length, 195);
  assert.equal(getLaunchQuoteAsset('usdg').decimals, 6);
  assert.equal(getLaunchQuoteAsset('qnt').priceSource, 'robinhood');
  for (const asset of LAUNCH_QUOTE_ASSETS) {
    const selected = draftForQuote(asset);
    const friend = buildRareLaunchParams({ pet, config, draft: selected, now: NOW });
    const self = buildRareSelfLaunchParams({ account: OWNER, config, draft: selected, now: NOW });
    for (const built of [friend, self]) {
      assert.equal(built.params.sale.numeraire, asset.address, asset.symbol);
      assert.equal(built.params.sale.numTokensToSell, RARE_LAUNCH_SUPPLY);
      assert.equal(built.request.curves.reduce((sum, curve) => sum + curve.shares, 0n), 10n ** 18n);
      assert.equal(built.params.devBuy, undefined); assert.equal(built.params.vesting, undefined);
    }
  }
});
test('issuer pricing cannot replace a pinned Chainlink feed or smuggle an unlisted stock identity', () => {
  const qnt = draftForQuote(getLaunchQuoteAsset('qnt'));
  assert.doesNotThrow(() => validateRareLaunchDraft(qnt, NOW));
  for (const quote of [
    { ...qnt.quote, feedAddress: draft.quote.feedAddress },
    { ...qnt.quote, source: 'chainlink' },
    { ...qnt.quote, asset: { ...qnt.quote.asset, assetId: `0x${'0'.repeat(64)}` } },
    { ...qnt.quote, asset: { ...qnt.quote.asset, priceSource: 'chainlink' } },
    { ...qnt.quote, asset: { ...qnt.quote.asset, name: 'Another issuer' } },
    { ...draft.quote, source: 'robinhood', feedAddress: null, asset: { ...draft.quote.asset, feedAddress: null, priceSource: 'robinhood' } },
  ]) assert.throws(() => validateRareLaunchDraft({ ...draft, quote } as RareLaunchDraft, NOW));
});
test('legacy Chainlink recovery survives the added issuer pricing fields', async () => {
  const { validateStoredRareLaunch } = await import('../games/rare-pet/launch-doppler.ts');
  const f = fixture(), prepared = await prepareRareLaunch(f.options, f.deps);
  const historical = structuredClone(prepared);
  const asset = historical.draft.quote.asset as unknown as Record<string, unknown>;
  delete asset.priceSource; delete asset.assetId; delete asset.feedRegistry;
  assert.equal(validateStoredRareLaunch(WALLET, historical).data, prepared.data);
  assert.throws(() => validateRareLaunchDraft(historical.draft, NOW), /catalog/);
});
test('the supported pending-record capacity persists full-catalog reviews with maximum metadata', async () => {
  const { createRareLaunchTransactionStore } = await import('../games/rare-pet/launch-transactions.ts');
  let raw = ''; const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = ''; } };
  const store = createRareLaunchTransactionStore({ storage });
  const wallets: Address[] = [];
  for (let i = 0; i < 32; i++) {
    const wallet = `0x${BigInt(i + 100).toString(16).padStart(40, '0')}` as Address;
    const f = fixture(), friend = { ...pet, walletAddress: wallet };
    f.changes.fresh = friend;
    const prepared = await prepareRareLaunch({ ...f.options, pet: friend, draft: { ...draft, name: 'N'.repeat(64), symbol: 'T'.repeat(12), tokenURI: `data:application/json;base64,${'A'.repeat(4064)}` } }, f.deps);
    store.setRareLaunchTransaction(wallet, { hash: HASH, status: 'pending', prepared }); wallets.push(wallet);
  }
  const restored = createRareLaunchTransactionStore({ storage });
  for (const wallet of wallets) assert.equal(restored.getRareLaunchTransaction(wallet)?.hash, HASH, `lost pending record ${wallet}; stored bytes=${raw.length}`);
});

test('previous deployment stays readable for history but is never a fallback for new launches', async () => {
  const { readRareLaunchHistory, readRareSelfLaunchHistory, readRareLaunchConfig, readRareSelfLaunchConfig } = await import('../games/rare-pet/launch-doppler.ts');
  const { ARCHIVED_LAUNCH_ROUTERS, verifyArchivedLaunchPolicy, launchHistoryRouters } = await import('../games/rare-pet/launch-router-history.ts');
  assert.equal(keccak256(oldCode), originalDeployment.integrity.runtimeCodeHash);
  assert.equal(ARCHIVED_LAUNCH_ROUTERS[0].runtimeCodeHash, originalDeployment.integrity.runtimeCodeHash);
  assert.doesNotThrow(() => verifyArchivedLaunchPolicy(oldRouter, oldCode, [...oldQuotes].reverse()));
  assert.throws(() => verifyArchivedLaunchPolicy(oldRouter, '0x1234', oldQuotes), /previous launch router/);
  assert.throws(() => verifyArchivedLaunchPolicy(oldRouter, oldCode, oldQuotes.slice(1)), /previous launch router/);
  assert.throws(() => verifyArchivedLaunchPolicy(ROUTER, oldCode, oldQuotes), /previous launch router/);
  assert.equal(launchHistoryRouters(oldRouter).length, 1);
  assert.equal(launchHistoryRouters(ROUTER).length, 2);
  const f = fixture(); f.changes.code = oldCode; f.changes.config.quoteTokens = oldQuotes;
  f.deps.client.getBlockNumber = async () => 80_000_000n;
  f.deps.client.getLogs = async () => [];
  assert.equal((await readRareLaunchHistory({router:oldRouter,pet},f.deps)).items.length,0);
  assert.equal((await readRareSelfLaunchHistory({router:oldRouter,account:OWNER},f.deps)).items.length,0);
  await assert.rejects(readRareLaunchConfig(oldRouter,pet,f.deps),/complete verified quote catalog/);
  await assert.rejects(readRareSelfLaunchConfig(oldRouter,OWNER,f.deps),/complete verified quote catalog/);
  await assert.rejects(readRareLaunchHistory({router:ROUTER,pet},f.deps),/complete verified quote catalog/);
  f.changes.code = '0x1234';
  await assert.rejects(readRareLaunchHistory({router:oldRouter,pet},f.deps),/previous launch router/);
  assert.equal(f.writes.length,0);
});

test('history combines both router generations and does not hide a failed or incomplete source', async () => {
  const { readAllRareLaunchHistory } = await import('../games/rare-pet/launch-doppler.ts');
  const f = fixture(), oldAsset = '0x7777777777777777777777777777777777777777' as Address;
  const reads: Address[] = []; let missingLegacy = false, failLegacy = false;
  f.deps.client.getBlockNumber = async () => 80_000_000n;
  f.deps.client.getCode = async ({address}) => address.toLowerCase() === oldRouter.toLowerCase() ? oldCode : '0x1234';
  const read = f.deps.client.readContract.bind(f.deps.client);
  f.deps.client.readContract = (async (args: {address:Address;functionName:string}) => {
    if(args.functionName === 'quoteTokens') return args.address.toLowerCase() === oldRouter.toLowerCase() ? oldQuotes : config.quoteTokens;
    if(args.functionName === 'getLaunch') return {brain:1n,lastLaunchAt:BigInt(NOW/1000),hasLaunched:true};
    if(args.functionName === 'selfLaunchCount') return 1n;
    return read(args as never);
  }) as typeof f.deps.client.readContract;
  f.deps.client.getLogs = (async ({address:router,args}: {address:Address;args:Record<string,unknown>}) => {
    reads.push(router); const legacy=router.toLowerCase()===oldRouter.toLowerCase();
    if(legacy&&failLegacy) throw new Error('Previous router RPC unavailable');
    if(legacy&&missingLegacy) return [];
    return [{address:router,blockNumber:79_000_000n,blockHash:BLOCK,transactionHash:HASH,transactionIndex:0,logIndex:0,removed:false,
      args:{...(args.creator?{creator:OWNER}:{collection:COLLECTION,tokenId:2n,friendWallet:WALLET,owner:OWNER}),asset:legacy?oldAsset:ASSET,quote:WETH,fee:3000,metadataHash:HASH,timestamp:BigInt(NOW/1000-(legacy?100:0))}}];
  }) as typeof f.deps.client.getLogs;
  for(const input of [{router:ROUTER,account:OWNER},{router:ROUTER,account:WALLET,pet}]) {
    const history = await readAllRareLaunchHistory(input,f.deps);
    assert.deepEqual(history.items.map(item=>item.asset),[ASSET,oldAsset]);
  }
  assert.ok(reads.some(address=>address===oldRouter));
  missingLegacy=true;
  await assert.rejects(readAllRareLaunchHistory({router:ROUTER,account:OWNER},f.deps),/incomplete/);
  missingLegacy=false; failLegacy=true;
  await assert.rejects(readAllRareLaunchHistory({router:ROUTER,account:WALLET,pet},f.deps),/RPC unavailable/);
  assert.equal(f.writes.length,0);
});

test('RareFriends pool quotes bind canonical identity, depth and observations; moving average review tolerates at most one percent', async () => {
  const { verifyRareLaunchPriceRefresh } = await import('../games/rare-pet/launch-doppler.ts');
  const rarefriends = getLaunchQuoteAsset('rarefriends');
  const quote = { ...draft.quote, asset: rarefriends, source: 'rarefriends-pool' as const,
    usdPrice:'0.002',usdPriceE18:2000000000000000n,
    pool:{poolId:'0x9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240' as Hex,windowStart:NOW/1000-1800,windowEnd:NOW/1000,windowSeconds:1800 as const,lastSwapAt:NOW/1000-600,wethPerTokenE18:1000000000000n,spotWethPerTokenE18:1000000000000n,permanentWethDepthWei:20n*10n**18n} };
  const rfDraft = {...draft,quote};
  assert.doesNotThrow(()=>validateRareLaunchDraft(rfDraft,NOW));
  assert.equal(buildRareLaunchParams({pet,config,draft:rfDraft,now:NOW}).params.sale.numeraire,rarefriends.address);
  for(const pool of [undefined,{...quote.pool,poolId:HASH},{...quote.pool,lastSwapAt:NOW/1000-3601},{...quote.pool,windowStart:NOW/1000-1700},{...quote.pool,permanentWethDepthWei:9n*10n**18n},{...quote.pool,spotWethPerTokenE18:quote.pool.wethPerTokenE18*121n/100n}]) {
    assert.throws(()=>validateRareLaunchDraft({...rfDraft,quote:{...quote,pool}},NOW),/RareFriends pool price/);
  }
  assert.doesNotThrow(()=>verifyRareLaunchPriceRefresh(quote,{...quote,usdPriceE18:quote.usdPriceE18*101n/100n}));
  assert.doesNotThrow(()=>verifyRareLaunchPriceRefresh(quote,{...quote,usdPriceE18:quote.usdPriceE18*99n/100n}));
  assert.throws(()=>verifyRareLaunchPriceRefresh(quote,{...quote,usdPriceE18:quote.usdPriceE18*101n/100n+1n}),/price changed/);
  assert.throws(()=>verifyRareLaunchPriceRefresh(quote,{...quote,usdPriceE18:quote.usdPriceE18*99n/100n-1n}),/price changed/);
  assert.throws(()=>verifyRareLaunchPriceRefresh(draft.quote,{...draft.quote,usdPriceE18:draft.quote.usdPriceE18+1n}),/price changed/);
});


test('quote decimals preserve the $10k curve and pool identity for either launched-token address order', async () => {
  const quotes = LAUNCH_QUOTE_ASSETS.filter(asset => ['weth', 'usdg', 'cbbtc'].includes(asset.kind));
  assert.deepEqual(quotes.map(asset => asset.decimals).sort((a, b) => a - b), [6, 8, 18]);
  for (const quote of quotes) {
    const usdPrice = quote.kind === 'usdg' ? '0.98234567' : quote.kind === 'cbbtc' ? '67345.67890123' : '2345.67890123';
    const selected = draftForQuote(quote);
    const selectedDraft = { ...selected, quote: { ...selected.quote, usdPrice, usdPriceE18: parseUnits(usdPrice, 18) } };
    const built = buildRareLaunchParams({ pet, config, draft: selectedDraft, now: NOW });
    const normalizedTick = Math.min(...built.params.pool.curves.map(curve => curve.tickLower));
    const expectedUnroundedTick = Math.log(10_000 / (1e9 * Number(usdPrice)) * 10 ** (quote.decimals - 18)) / Math.log(1.0001);
    assert.equal(normalizedTick, Math.ceil(expectedUnroundedTick / 200) * 200, quote.symbol);
    assert(built.review.approximateStartMarketCapUSD >= 10_000 - 0.0001 && built.review.approximateStartMarketCapUSD < 10_000 * 1.0001 ** 200 + 0.0001, `${quote.symbol} FDV has incorrect units`);
    for (const launchedAsset of ['0x0000000000000000000000000000000000000001', '0xffffffffffffffffffffffffffffffffffffffff'] as Address[]) {
      const f = fixture(selectedDraft, launchedAsset);
      const prepared = await prepareRareLaunch(f.options, f.deps);
      const tokenIsCurrency0 = BigInt(launchedAsset) < BigInt(quote.address);
      assert.equal(prepared.doppler.prediction.tokenIsCurrency0, tokenIsCurrency0);
      assert.equal(prepared.doppler.prediction.poolKey[tokenIsCurrency0 ? 'currency1' : 'currency0'], quote.address);
      assert.equal(prepared.doppler.prediction.poolKey[tokenIsCurrency0 ? 'currency0' : 'currency1'], launchedAsset);
      assert.deepEqual(prepared.request.curves, built.request.curves);
      // Doppler reverses the normalized quote/token tick when the launched token is currency1.
      const poolTick = tokenIsCurrency0 ? normalizedTick : -normalizedTick;
      const wholeQuotePerToken = (tokenIsCurrency0 ? 1.0001 ** poolTick : 1 / 1.0001 ** poolTick) * 10 ** (18 - quote.decimals);
      assert(Math.abs(wholeQuotePerToken * 1e9 * Number(usdPrice) - built.review.approximateStartMarketCapUSD) < 0.00001);
      assert.equal(f.writes.length, 0);
    }
  }
});

test('quote decimals cannot be changed in a verified draft even to another supported decimal count', () => {
  for (const asset of LAUNCH_QUOTE_ASSETS.filter(asset => ['weth', 'usdg', 'cbbtc'].includes(asset.kind))) {
    const selected = draftForQuote(asset);
    for (const decimals of [6, 8, 18, 0, 255].filter(value => value !== asset.decimals)) {
      assert.throws(() => validateRareLaunchDraft({ ...selected, quote: { ...selected.quote, asset: { ...asset, decimals } } } as RareLaunchDraft, NOW), /catalog|Refresh/);
    }
  }
});

test('fee accounting retains raw quote units for six/eight/eighteen decimals and both pool currency orders', async () => {
  for (const quote of LAUNCH_QUOTE_ASSETS.filter(asset => ['weth', 'usdg', 'cbbtc'].includes(asset.kind))) {
    const selected = draftForQuote(quote);
    for (const launchedAsset of ['0x0000000000000000000000000000000000000001', '0xffffffffffffffffffffffffffffffffffffffff'] as Address[]) {
      const f = fixture(selected, launchedAsset), quoteIsCurrency0 = BigInt(quote.address) < BigInt(launchedAsset);
      const decimals0 = quoteIsCurrency0 ? quote.decimals : 18, decimals1 = quoteIsCurrency0 ? 18 : quote.decimals;
      const cumulative = [parseUnits('10', decimals0), parseUnits('10', decimals1)];
      const checkpoint = [parseUnits('7', decimals0), parseUnits('7', decimals1)];
      f.changes.pending0 = parseUnits('1', decimals0); f.changes.pending1 = parseUnits('1', decimals1);
      const read = f.deps.client.readContract;
      f.deps.client.readContract = (async args => {
        if (args.functionName === 'getCumulatedFees0') return cumulative[0];
        if (args.functionName === 'getCumulatedFees1') return cumulative[1];
        if (args.functionName === 'getLastCumulatedFees0') return checkpoint[0];
        if (args.functionName === 'getLastCumulatedFees1') return checkpoint[1];
        return read(args);
      }) as typeof f.deps.client.readContract;
      const fees = await readRareLaunchFees({ asset: launchedAsset, wallet: WALLET }, f.deps);
      assert.equal(fees[quoteIsCurrency0 ? 'token0' : 'token1'], quote.address);
      assert.equal(fees.amount0, parseUnits('3.4', decimals0));
      assert.equal(fees.amount1, parseUnits('3.4', decimals1));
      assert.equal(formatUnits(fees[quoteIsCurrency0 ? 'amount0' : 'amount1'], quote.decimals), '3.4');
      assert.equal(formatUnits(fees[quoteIsCurrency0 ? 'amount1' : 'amount0'], 18), '3.4');
      assert.equal(f.writes.length, 0);
    }
  }
});


test('preparation rejects reversed pool currencies or an inconsistent token-side prediction', async () => {
  for (const mutation of ['order', 'flag']) {
    const f = fixture(), originalPrepare = f.deps.prepare!;
    f.deps.prepare = async (params, router) => {
      const prepared = await originalPrepare(params, router), prediction = prepared.prediction;
      if (mutation === 'flag') return { ...prepared, prediction: { ...prediction, tokenIsCurrency0: !prediction.tokenIsCurrency0 } };
      const poolKey = { ...prediction.poolKey, currency0: prediction.poolKey.currency1, currency1: prediction.poolKey.currency0 };
      return { ...prepared, prediction: { ...prediction, poolKey, poolId: computePoolId(poolKey) } };
    };
    await assert.rejects(prepareRareLaunch(f.options, f.deps), /currency order/);
    assert.equal(f.writes.length, 0);
  }
});
