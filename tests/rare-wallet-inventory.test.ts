import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { encodeAbiParameters, keccak256, padHex, toHex } from 'viem';

const compiled = await build({ stdin: { contents: "export * from './rare-wallet-inventory'; export { HoldingNotOwnedError } from './rare-wallet-holdings';", resolveDir: fileURLToPath(new URL('../games/rare-pet', import.meta.url)), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { createRareWalletInventoryReader, HoldingNotOwnedError } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const NFT = '0x4444444444444444444444444444444444444444';
const MULTI = '0x5555555555555555555555555555555555555555';
const EMPTY = '0x6666666666666666666666666666666666666666';
const sig = (value: string) => keccak256(toHex(value));
const transfer = sig('Transfer(address,address,uint256)');
const single = sig('TransferSingle(address,address,address,uint256,uint256)');
const batch = sig('TransferBatch(address,address,address,uint256[],uint256[])');
const topic = (value: string) => padHex(value as `0x${string}`, { size: 32 });
const u = (value: bigint) => padHex(toHex(value), { size: 32 });
const base = { blockNumber: '0x32', removed: false };
const tokenLog = (contract = TOKEN) => ({ ...base, address: contract, topics: [transfer, topic(OTHER), topic(WALLET)], data: u(99n) });
const nftLog = (id = 0n) => ({ ...base, address: NFT, topics: [transfer, topic(OTHER), topic(WALLET), u(id)], data: '0x' });
const singleLog = (id = 0n) => ({ ...base, address: MULTI, topics: [single, topic(OTHER), topic(OTHER), topic(WALLET)], data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [id, 3n]) });
const batchLog = () => ({ ...base, address: MULTI, topics: [batch, topic(OTHER), topic(OTHER), topic(WALLET)], data: encodeAbiParameters([{ type: 'uint256[]' }, { type: 'uint256[]' }], [[0n, 9n, 10n], [3n, 2n, 0n]]) });
function holdings(calls: unknown[][] = []) {
  return {
    readTokenHolding: async (wallet: string, contract: string, signal: unknown, block: bigint) => {
      calls.push(['token', wallet, contract, block]);
      return { kind: 'erc20', contract, balance: contract === EMPTY ? 0n : 1000000000000000001n, decimals: 18, name: 'Rare', symbol: 'RF', imageUrl: null, source: 'rpc', blockNumber: block };
    },
    readNftHolding: async (wallet: string, contract: string, tokenId: string, kind: string, signal: unknown, block: bigint) => {
      calls.push(['nft', wallet, contract, tokenId, kind, block]);
      if (tokenId === '1') throw new HoldingNotOwnedError('Moved away');
      return { kind, contract, tokenId, balance: kind === 'erc721' ? 1n : 3n, name: `#${tokenId}`, collectionName: 'Rare', imageUrl: null, source: 'rpc', blockNumber: block };
    },
  };
}
function client(getLogs: (filter: any) => Promise<unknown> = async () => []) {
  return { getChainId: async () => 4663, getBlockNumber: async () => 100n, getLogs };
}

test('discovers all three standards globally, retains id zero, deduplicates batch IDs, validates every asset at one block', async () => {
  const filters: any[] = [], checked: unknown[][] = [], progress: any[] = [];
  const read = createRareWalletInventoryReader({ client: client(async filter => {
    filters.push(filter); return Array.isArray(filter.topics[0]) ? [singleLog(), batchLog()] : [tokenLog(), tokenLog(), tokenLog(EMPTY), nftLog(), nftLog(1n)];
  }), holdings: holdings(checked) });
  const result = await read(WALLET, undefined, { onProgress: (value: unknown) => progress.push(value) });
  assert.equal(filters.length, 2); assert.equal(result.complete, true); assert.equal(result.cursor, null);
  assert.deepEqual(filters[0], { fromBlock: '0x0', toBlock: '0x64', topics: [transfer, null, topic(WALLET)] });
  assert.deepEqual(filters[1].topics, [[single, batch], null, null, topic(WALLET)]);
  assert(!('address' in filters[0]), 'discovery is global, not limited to known contracts');
  assert.equal(result.tokens.length, 1); assert.equal(result.tokens[0].balance, 1000000000000000001n);
  assert.deepEqual(result.nfts.map((item: any) => [item.kind, item.tokenId]), [['erc721', '0'], ['erc1155', '0'], ['erc1155', '9']]);
  assert.equal(checked.length, 6); assert(checked.every(call => call[1] === WALLET && call.at(-1) === 100n));
  assert.deepEqual(result.warnings, []); assert.equal(progress.at(-1).scannedBlocks, 202n);
});

test('bounded pages keep one snapshot and return cumulative holdings, never a misleading complete empty list', async () => {
  let blockReads = 0;
  const mock = client(async filter => Array.isArray(filter.topics[0]) ? [singleLog()] : [tokenLog(), nftLog()]);
  mock.getBlockNumber = async () => { blockReads++; return 100n; };
  const read = createRareWalletInventoryReader({ client: mock, holdings: holdings(), maxLogRequests: 1, maxBalanceChecks: 1 });
  const first = await read(WALLET);
  assert.equal(first.complete, false); assert(first.cursor); assert.equal(first.tokens.length, 1); assert.equal(first.nfts.length, 0);
  assert.match(first.warnings.join(' '), /incomplete/);
  const second = await read(WALLET, undefined, { cursor: first.cursor });
  assert.equal(second.complete, false); assert.equal(second.tokens.length, 1); assert.equal(second.nfts.length, 1);
  const third = await read(WALLET, undefined, { cursor: second.cursor });
  assert.equal(third.complete, true); assert.equal(third.tokens.length, 1); assert.equal(third.nfts.length, 2);
  assert.equal(blockReads, 1);
  await assert.rejects(read(OTHER, undefined, { cursor: first.cursor }), /does not match/);
  await assert.rejects(read(WALLET, undefined, { cursor: { ...first.cursor } }), /does not match/);
});

test('range limits split without losing blocks; partial continuation completes the full inclusive history', async () => {
  const successful: any[] = [];
  const mock = client(async filter => {
    if (BigInt(filter.toBlock) - BigInt(filter.fromBlock) >= 1000n) throw new Error('range limit');
    successful.push(filter); return [];
  });
  mock.getBlockNumber = async () => 3000n;
  const read = createRareWalletInventoryReader({ client: mock, holdings: holdings(), maxLogRequests: 3 });
  let result = await read(WALLET), pages = 1;
  assert.equal(result.complete, false); assert(result.cursor);
  while (result.cursor && pages++ < 15) result = await read(WALLET, undefined, { cursor: result.cursor });
  assert.equal(result.complete, true); assert(pages > 1);
  for (const kind of [false, true]) {
    const ranges = successful.filter(query => Array.isArray(query.topics[0]) === kind).map(query => [BigInt(query.fromBlock), BigInt(query.toBlock)]).sort(([a], [b]) => Number(a - b));
    assert.equal(ranges[0][0], 0n); assert.equal(ranges.at(-1)[1], 3000n);
    for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i][0], ranges[i - 1][1] + 1n);
  }
});

test('a provider cap triggers range splitting instead of trusting potentially truncated results', async () => {
  const mock = client(async filter => BigInt(filter.toBlock) - BigInt(filter.fromBlock) > 1000n ? Array.from({ length: 5000 }, () => tokenLog()) : []);
  mock.getBlockNumber = async () => 2000n;
  const read = createRareWalletInventoryReader({ client: mock, holdings: holdings(), maxLogRequests: 2 });
  const result = await read(WALLET);
  assert.equal(result.complete, false); assert(result.cursor); assert.equal(result.tokens.length, 0);
});

test('timeouts and aborts do not become empty successful inventory', async () => {
  const read = createRareWalletInventoryReader({ client: client(async () => new Promise(() => {})), holdings: holdings(), logTimeoutMs: 15 });
  const timedOut = await read(WALLET);
  assert.equal(timedOut.complete, false); assert(timedOut.cursor); assert.match(timedOut.warnings.join(' '), /incomplete/);
  const controller = new AbortController();
  const pending = read(WALLET, controller.signal);
  setTimeout(() => controller.abort(new Error('wallet changed')), 2);
  await assert.rejects(pending, /wallet changed/);
});

test('malformed, wrong-recipient, removed, future-block, and inconsistent batch logs remain explicit gaps', async () => {
  const bad = [null, { ...tokenLog(), removed: true }, { ...tokenLog(), blockNumber: '0x65' }, { ...tokenLog(), topics: [transfer, topic(OTHER), topic(OTHER)] }];
  const malformedBatch = { ...batchLog(), data: encodeAbiParameters([{ type: 'uint256[]' }, { type: 'uint256[]' }], [[0n, 1n], [1n]]) };
  const read = createRareWalletInventoryReader({ client: client(async filter => Array.isArray(filter.topics[0]) ? [malformedBatch] : bad), holdings: holdings() });
  const result = await read(WALLET);
  assert.equal(result.complete, false); assert.equal(result.cursor, null); assert.equal(result.tokens.length, 0);
  assert.match(result.warnings.join(' '), /5 transfer logs could not be decoded/);
});

test('unverified balances and snapshot mismatch are omitted with a warning; wrong chain prevents scanning', async () => {
  const read = createRareWalletInventoryReader({ client: client(async filter => Array.isArray(filter.topics[0]) ? [] : [tokenLog()]),
    holdings: { ...holdings(), readTokenHolding: async () => ({ kind: 'erc20', balance: 1n, blockNumber: 101n }) } });
  const result = await read(WALLET);
  assert.equal(result.complete, false); assert.equal(result.tokens.length, 0); assert.match(result.warnings.join(' '), /could not be verified/);
  let calls = 0;
  await assert.rejects(createRareWalletInventoryReader({ client: { ...client(async () => { calls++; return []; }), getChainId: async () => 1 } })(WALLET), /Robinhood Chain/);
  assert.equal(calls, 0);
});

test('slow balance reads are time-bounded and remain resumable at the pinned block', async () => {
  let stalled = true;
  const standard = holdings();
  const read = createRareWalletInventoryReader({
    client: client(async filter => Array.isArray(filter.topics[0]) ? [] : [tokenLog(), nftLog()]),
    balanceBudgetMs: 30, balanceTimeoutMs: 15,
    holdings: { ...standard, readNftHolding: (...args: any[]) => stalled ? new Promise(() => {}) : standard.readNftHolding(...args) },
  });
  const started = Date.now(), first = await read(WALLET);
  assert(Date.now() - started < 250, 'a hung balance call must not hold the page open');
  assert.equal(first.tokens.length, 1); assert.equal(first.complete, false); assert(first.cursor);
  assert.match(first.warnings.join(' '), /retry the remaining/);
  stalled = false;
  const second = await read(WALLET, undefined, { cursor: first.cursor });
  assert.equal(second.complete, true); assert.equal(second.tokens.length, 1); assert.equal(second.nfts.length, 1);
});

test('rate-limited assets are retried by continuation instead of being discarded as permanently failed', async () => {
  let limited = true;
  const standard = holdings();
  const read = createRareWalletInventoryReader({ client: client(async filter => Array.isArray(filter.topics[0]) ? [] : [tokenLog()]),
    holdings: { ...standard, readTokenHolding: (...args: any[]) => limited ? Promise.reject(new Error('RPC Request failed: Too Many Requests')) : standard.readTokenHolding(...args) },
  });
  const first = await read(WALLET);
  assert(first.cursor); assert.equal(first.complete, false); assert.equal(first.tokens.length, 0);
  limited = false;
  const second = await read(WALLET, undefined, { cursor: first.cursor });
  assert.equal(second.complete, true); assert.equal(second.tokens.length, 1); assert.deepEqual(second.warnings, []);
});
