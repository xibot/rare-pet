import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress, type Address, type Hex, type TransactionReceipt } from 'viem';
import {
  buildRareWalletTransfer, parseRareWalletAmount, RARE_WALLET_ABI,
  RareWalletTransferError, sendRareWalletTransfer, verifyRareWalletTransferReceipt,
  type RareWalletTransferDependencies, type RareWalletTransferIntent, type RareWalletTransferOptions,
} from '../games/rare-pet/rare-wallet-transfer.ts';
import type { PetIdentity, PetWalletSession } from '../games/rare-pet/wallet.ts';

const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const WALLET = '0x2222222222222222222222222222222222222222' as Address;
const TO = '0x3333333333333333333333333333333333333333' as Address;
const ASSET = '0x4444444444444444444444444444444444444444' as Address;
const COLLECTION = '0x116EaA62241751E0c98dA43d458600c6C17cD361' as Address;
const HASH = `0x${'a'.repeat(64)}` as Hex;
const BLOCK = `0x${'b'.repeat(64)}` as Hex;
const OTHER_HASH = `0x${'c'.repeat(64)}` as Hex;
const pet: PetIdentity = { collection: 'genesis', chainId: 4663, contract: COLLECTION, tokenId: '2', label: 'Genesis #2', image: '', owner: OWNER, walletAddress: WALLET, blockNumber: '20', generation: null, rushEligible: true };
const native: RareWalletTransferIntent = { kind: 'native', to: TO, amount: 7n };
const token: RareWalletTransferIntent = { kind: 'erc20', to: TO, contract: ASSET, amount: 7n };
const nft: RareWalletTransferIntent = { kind: 'erc721', to: TO, contract: ASSET, tokenId: 0n };
const multi: RareWalletTransferIntent = { kind: 'erc1155', to: TO, contract: ASSET, tokenId: 0n, amount: 7n };
const transfer20 = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const transfer721 = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const transfer1155 = parseAbi(['event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)']);
function logFor(intent: RareWalletTransferIntent) {
  if (intent.kind === 'native') return [];
  const base = { address: intent.contract, blockHash: BLOCK, blockNumber: 21n, logIndex: 0, transactionHash: HASH, transactionIndex: 0, removed: false };
  if (intent.kind === 'erc20') return [{ ...base, topics: encodeEventTopics({ abi: transfer20, eventName: 'Transfer', args: { from: WALLET, to: intent.to } }), data: encodeAbiParameters([{ type: 'uint256' }], [intent.amount]) }];
  if (intent.kind === 'erc721') return [{ ...base, topics: encodeEventTopics({ abi: transfer721, eventName: 'Transfer', args: { from: WALLET, to: intent.to, tokenId: intent.tokenId } }), data: '0x' }];
  return [{ ...base, topics: encodeEventTopics({ abi: transfer1155, eventName: 'TransferSingle', args: { operator: WALLET, from: WALLET, to: intent.to } }), data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [intent.tokenId, intent.amount]) }];
}
function receiptFor(intent: RareWalletTransferIntent) {
  return { transactionHash: HASH, status: 'success', blockHash: BLOCK, blockNumber: 21n, logs: logFor(intent) } as unknown as TransactionReceipt;
}
function fixture(intent: RareWalletTransferIntent = native) {
  const calls: string[] = [], writes: Record<string, unknown>[] = [], hashes: Hex[] = [];
  const state = { revision: 4, status: 'connected', chainId: 4663, account: OWNER };
  const provider = { request: async () => undefined, on() {}, removeListener() {} };
  const session = { getSnapshot: () => state, getProvider: () => provider } as unknown as PetWalletSession;
  const changes = {
    chain: 4663, signerAccount: OWNER, fresh: pet, code: '0x1234', walletOwner: OWNER,
    binding: [4663n, COLLECTION, 2n], balance: 10n, nftOwner: WALLET,
    simulationResult: '0x', simulationError: null as Error | null, receipt: receiptFor(intent),
    receiptError: null as Error | null, receiptBlock: BLOCK, verificationBlock: BLOCK,
    txData: undefined as Hex | undefined, afterSimulation: () => {}, afterVerify: () => {}, afterWrite: () => {},
    active: true,
  };
  let request: Record<string, unknown>;
  const dependencies = {
    client: {
      async getChainId() { return changes.chain; },
      async getBlockNumber() { return 20n; },
      async getBlock({ blockNumber }: { blockNumber: bigint }) { return { hash: blockNumber === 21n ? changes.receiptBlock : changes.verificationBlock }; },
      async getCode() { return changes.code; },
      async getBalance({ address }: { address: Address }) { assert.equal(address, WALLET); return changes.balance; },
      async readContract(args: { functionName: string; address: Address; args?: unknown[]; blockNumber: bigint }) {
        calls.push(args.functionName); assert.equal(args.blockNumber, 20n);
        if (args.functionName === 'owner') return changes.walletOwner;
        if (args.functionName === 'token') return changes.binding;
        if (args.functionName === 'balanceOf') { assert.equal(args.args?.[0], WALLET); return changes.balance; }
        if (args.functionName === 'ownerOf') return changes.nftOwner;
        throw Error(args.functionName);
      },
      async simulateContract(args: Record<string, unknown>) {
        calls.push('simulate'); request = args; changes.afterSimulation();
        if (changes.simulationError) throw changes.simulationError;
        return { result: changes.simulationResult, request: { ...args, address: TO } };
      },
      async waitForTransactionReceipt() { calls.push('receipt'); if (changes.receiptError) throw changes.receiptError; return changes.receipt; },
      async getTransaction() { return { from: OWNER, to: WALLET, value: 0n, input: changes.txData ?? buildRareWalletTransfer(WALLET, intent).data }; },
    },
    verifyIdentity: async () => { calls.push('verify'); changes.afterVerify(); return changes.fresh; },
    signer: {
      chain: { id: 4663 }, async getChainId() { return changes.chain; }, async getAddresses() { return [changes.signerAccount]; },
      async writeContract(args: Record<string, unknown>) { calls.push('write'); writes.push(args); changes.afterWrite(); return HASH; },
    },
  } as unknown as RareWalletTransferDependencies;
  const options: RareWalletTransferOptions = { session, pet, revision: 4, intent, onHash: hash => hashes.push(hash), assertActive: () => { if (!changes.active) throw Error('Selection changed'); } };
  return { calls, writes, hashes, state, changes, dependencies, options, run: () => sendRareWalletTransfer(options, dependencies), request: () => request! };
}

test('decimal amounts preserve exact base units without floating point or rounding', () => {
  assert.equal(parseRareWalletAmount('1.234567890123456789', 18), 1234567890123456789n);
  assert.equal(parseRareWalletAmount(' 2 ', 0), 2n);
  assert.equal(parseRareWalletAmount('0.000001', 6), 1n);
  for (const value of ['0', '0.0', '-1', '+1', '1e3', '.1', '1.', '1,000', '01', '1.0000001']) assert.throws(() => parseRareWalletAmount(value, 6));
  assert.throws(() => parseRareWalletAmount('2', -1));
  assert.throws(() => parseRareWalletAmount('2', 256));
  assert.throws(() => parseRareWalletAmount((1n << 256n).toString(), 0));
});
test('intents encode only fixed asset sends with operation CALL and no owner-wallet funding', () => {
  const nativeCall = buildRareWalletTransfer(WALLET, native);
  assert.deepEqual(decodeFunctionData({ abi: RARE_WALLET_ABI, data: nativeCall.data }).args, [TO, 7n, '0x', 0]);
  for (const intent of [token, nft, multi]) {
    const built = buildRareWalletTransfer(WALLET, intent);
    assert.equal(built.args[0], ASSET); assert.equal(built.args[1], 0n); assert.equal(built.args[3], 0);
  }
  for (const to of [zeroAddress, WALLET, 'not-an-address']) assert.throws(() => buildRareWalletTransfer(WALLET, { ...native, to: to as Address }));
  assert.throws(() => buildRareWalletTransfer(WALLET, { ...token, to: ASSET }));
  assert.throws(() => buildRareWalletTransfer(WALLET, { ...native, amount: 0n }));
  assert.throws(() => buildRareWalletTransfer(WALLET, { ...nft, tokenId: -1n }));
});
for (const intent of [native, token, nft, multi]) test(`${intent.kind}: fresh ownership, asset checks and simulation precede exact canonical wallet execution`, async () => {
  const f = fixture(intent), result = await f.run();
  assert.equal(result.hash, HASH); assert.equal(f.writes.length, 1); assert.deepEqual(f.hashes, [HASH]);
  assert.equal(f.writes[0].address, WALLET); assert.equal(f.writes[0].account, OWNER); assert.equal(f.writes[0].value, 0n);
  assert.equal(f.writes[0].functionName, 'execute'); assert.deepEqual(f.writes[0].args, buildRareWalletTransfer(WALLET, intent).args);
  assert.ok(f.calls.indexOf('verify') < f.calls.indexOf('simulate')); assert.ok(f.calls.indexOf('simulate') < f.calls.indexOf('write'));
  assert.notEqual(f.writes[0].address, TO, 'ignores a mutated simulation request and sends the reviewed fixed call');
});
test('owned Generations with hardwired generation use the same verified interface', async () => {
  const f = fixture(); const generation = { ...pet, collection: 'generations' as const, generation: 5 };
  f.changes.fresh = generation;
  await sendRareWalletTransfer({ ...f.options, pet: generation }, f.dependencies);
  assert.equal(f.writes.length, 1);
  await assert.rejects(sendRareWalletTransfer({ ...f.options, pet: { ...generation, generation: 0 } }, f.dependencies), /hardwired/);
  assert.equal(f.writes.length, 1);
});
test('wrong account, network, disconnected or revised sessions never request a signature', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.state.account = TO; },
    (f: ReturnType<typeof fixture>) => { f.state.revision++; },
    (f: ReturnType<typeof fixture>) => { f.state.chainId = 1; },
    (f: ReturnType<typeof fixture>) => { f.state.status = 'disconnected'; },
    (f: ReturnType<typeof fixture>) => { f.changes.chain = 1; },
    (f: ReturnType<typeof fixture>) => { f.changes.signerAccount = TO; },
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.run()); assert.equal(f.writes.length, 0); }
});
test('fresh NFT owner, wallet binding, canonical address and deployment are mandatory', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.changes.fresh = { ...pet, owner: TO }; },
    (f: ReturnType<typeof fixture>) => { f.changes.fresh = { ...pet, walletAddress: TO }; },
    (f: ReturnType<typeof fixture>) => { f.changes.walletOwner = TO; },
    (f: ReturnType<typeof fixture>) => { f.changes.binding = [1n, COLLECTION, 2n]; },
    (f: ReturnType<typeof fixture>) => { f.changes.binding = [4663n, ASSET, 2n]; },
    (f: ReturnType<typeof fixture>) => { f.changes.binding = [4663n, COLLECTION, 3n]; },
    (f: ReturnType<typeof fixture>) => { f.changes.code = '0x'; },
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.run()); assert.equal(f.writes.length, 0); }
});
test('account and Friend changes during verification or simulation prevent a stale prompt', async () => {
  const f = fixture(); f.changes.afterVerify = () => f.state.revision++;
  await assert.rejects(f.run(), /changed/); assert.equal(f.writes.length, 0);
  const g = fixture(); g.changes.afterSimulation = () => { g.changes.active = false; };
  await assert.rejects(g.run(), /Selection changed/); assert.equal(g.writes.length, 0);
});
test('insufficient ETH/token/ERC1155 balances and lost NFT ownership never reach simulation or signing', async () => {
  for (const intent of [native, token, multi]) {
    const f = fixture(intent); f.changes.balance = 6n;
    await assert.rejects(f.run(), /enough|many copies/); assert.ok(!f.calls.includes('simulate')); assert.equal(f.writes.length, 0);
  }
  const f = fixture(nft); f.changes.nftOwner = TO;
  await assert.rejects(f.run(), /no longer held/); assert.equal(f.writes.length, 0);
});
test('reverted simulation and false-returning ERC20 are blocked before the wallet prompt', async () => {
  const f = fixture(); f.changes.simulationError = Error('Unauthorized execution');
  await assert.rejects(f.run(), /Unauthorized/); assert.equal(f.writes.length, 0);
  const g = fixture(token); g.changes.simulationResult = `0x${'0'.repeat(64)}`;
  await assert.rejects(g.run(), /token rejected/); assert.equal(g.writes.length, 0);
  const h = fixture(token); h.changes.simulationResult = '0x01';
  await assert.rejects(h.run(), /unsupported response/); assert.equal(h.writes.length, 0);
  const valid = fixture(token); valid.changes.simulationResult = `0x${'0'.repeat(63)}1`;
  await valid.run(); assert.equal(valid.writes.length, 1);
});
test('a verification block reorganization blocks signing even after successful simulation', async () => {
  const f = fixture(); f.changes.afterSimulation = () => { f.changes.verificationBlock = OTHER_HASH; };
  await assert.rejects(f.run(), /verification block changed/); assert.equal(f.writes.length, 0);
});
test('double-clicks cannot request duplicate concurrent transfers', async () => {
  const f = fixture(); let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const dependencies = { ...f.dependencies, verifyIdentity: async () => { await wait; return pet; } };
  const first = sendRareWalletTransfer(f.options, dependencies);
  await assert.rejects(sendRareWalletTransfer(f.options, dependencies), /already pending/);
  release(); await first; assert.equal(f.writes.length, 1);
});
test('reverted, replaced and unknown receipts retain the sent hash for recovery', async () => {
  for (const [code, mutate] of [
    ['reverted', (f: ReturnType<typeof fixture>) => { f.changes.receipt = { ...f.changes.receipt, status: 'reverted' }; }],
    ['replaced', (f: ReturnType<typeof fixture>) => { f.changes.receipt = { ...f.changes.receipt, transactionHash: OTHER_HASH }; }],
    ['unconfirmed', (f: ReturnType<typeof fixture>) => { f.changes.receiptError = Error('Timed out'); }],
  ] as const) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.run(), error => error instanceof RareWalletTransferError && error.code === code && error.transactionHash === HASH);
    assert.deepEqual(f.hashes, [HASH]); assert.equal(f.writes.length, 1);
  }
});
test('exact token events distinguish a real send from false returns or another transfer', () => {
  for (const intent of [token, nft, multi]) {
    const receipt = receiptFor(intent); verifyRareWalletTransferReceipt(receipt, HASH, WALLET, intent);
    assert.throws(() => verifyRareWalletTransferReceipt({ ...receipt, logs: [] }, HASH, WALLET, intent), /could not be verified/);
    assert.throws(() => verifyRareWalletTransferReceipt(receipt, HASH, TO, intent), /could not be verified/);
    const wrong = { ...intent, to: OWNER };
    assert.throws(() => verifyRareWalletTransferReceipt(receipt, HASH, WALLET, wrong), /could not be verified/);
  }
});
test('native transfers require the exact reviewed execution and canonical receipt block', async () => {
  const f = fixture(); f.changes.txData = '0x';
  await assert.rejects(f.run(), error => error instanceof RareWalletTransferError && error.code === 'unverified');
  const g = fixture(); g.changes.receiptBlock = OTHER_HASH;
  await assert.rejects(g.run(), error => error instanceof RareWalletTransferError && error.code === 'reorg');
});
test('a session change after sending does not lose the already-submitted transaction result', async () => {
  const f = fixture(); f.changes.afterWrite = () => { f.state.revision++; };
  const result = await f.run(); assert.equal(result.hash, HASH); assert.deepEqual(f.hashes, [HASH]);
});
test('a UI callback failure still preserves the sent hash and never repeats the transfer', async () => {
  const f = fixture();
  await assert.rejects(sendRareWalletTransfer({ ...f.options, onHash: () => { throw Error('UI unmounted'); } }, f.dependencies), error => error instanceof RareWalletTransferError && error.code === 'unconfirmed' && error.transactionHash === HASH);
  assert.equal(f.writes.length, 1);
});
