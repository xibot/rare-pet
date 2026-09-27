import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { airlockAbi, computePoolId } from '@whetstone-research/doppler-sdk/evm';
import { encodeAbiParameters, encodeEventTopics, keccak256, parseEventLogs, stringToHex, zeroAddress, type Address, type Hex } from 'viem';
import { createRareMarketCatalog, RARE_MARKET_ROUTERS, safeMarketImageURL, marketMetadataImage, type RareMarketClient } from '../games/rare-pet/market-catalog.ts';
import { RARE_LAUNCH_DOPPLER as D, RARE_LAUNCH_ROUTER_ABI } from '../games/rare-pet/launch-doppler.ts';
import { getLaunchQuoteAsset } from '../games/rare-pet/launch-quotes.ts';

const CURRENT = RARE_MARKET_ROUTERS[0], OLD = RARE_MARKET_ROUTERS[1];
const ASSET = '0x6666666666666666666666666666666666666666' as Address;
const OLD_ASSET = '0x7777777777777777777777777777777777777777' as Address;
const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const WALLET = '0x2222222222222222222222222222222222222222' as Address;
const COLLECTION = '0x116EaA62241751E0c98dA43d458600c6C17cD361' as Address;
const WETH = getLaunchQuoteAsset('weth');
const BLOCK = 73524000n, NOW = 1800000000n;
const hash = (n: bigint | number): Hex => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const image = `https://store.public.blob.vercel-storage.com/rare-launchpad/4663/self/${OWNER.toLowerCase()}/images/${'a'.repeat(64)}.png`;
const URI = `data:application/json;base64,${Buffer.from(JSON.stringify({ image })).toString('base64')}`;
const CODE = readFileSync(new URL('./fixtures/launch-router-v1-runtime.txt', import.meta.url), 'utf8').trim() as Hex;

function launch(mode: 'self' | 'friend', blockNumber = mode === 'self' ? BLOCK - 10n : OLD.fromBlock + 20n) {
  const router = mode === 'self' ? CURRENT.address : OLD.address, asset = mode === 'self' ? ASSET : OLD_ASSET;
  const args = { asset, quote: WETH.address, fee: 3000, metadataHash: keccak256(stringToHex(URI)), timestamp: NOW - (BLOCK - blockNumber) };
  const base = { address: router, blockNumber, blockHash: hash(blockNumber), transactionHash: hash(blockNumber + 1n), transactionIndex: 0, logIndex: 0, removed: false };
  const log = mode === 'self' ? { ...base,
    topics: encodeEventTopics({ abi: RARE_LAUNCH_ROUTER_ABI, eventName: 'SelfLaunchRecorded', args: { creator: OWNER, asset } }),
    data: encodeAbiParameters([{ type: 'address' }, { type: 'uint24' }, { type: 'bytes32' }, { type: 'uint256' }], [args.quote, args.fee, args.metadataHash, args.timestamp]),
  } : { ...base,
    topics: encodeEventTopics({ abi: RARE_LAUNCH_ROUTER_ABI, eventName: 'LaunchRecorded', args: { collection: COLLECTION, tokenId: 2n, asset } }),
    data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'bytes32' }, { type: 'uint256' }], [WALLET, OWNER, args.quote, args.fee, args.metadataHash, args.timestamp]),
  };
  const create = { ...base, logIndex: 1, address: D.airlock,
    topics: encodeEventTopics({ abi: airlockAbi, eventName: 'Create', args: { numeraire: WETH.address } }),
    data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [asset, D.initializer, asset]),
  };
  return { asset, log, event: parseEventLogs({ abi: RARE_LAUNCH_ROUTER_ABI, logs: [log], strict: true })[0],
    receipt: { status: 'success', transactionHash: base.transactionHash, blockNumber, blockHash: base.blockHash, logs: [log, create] } };
}

function fixture() {
  const self = launch('self'), friend = launch('friend');
  const changes = { chain: 4663, code: CODE, snapshotHash: hash(BLOCK), limitRanges: false, rpcFailure: false, listed: true,
    stateStatus: 2, stateFee: 3000, hooks: D.initializer, currency: WETH.address, decimals: 18,
    name: 'Rare Cat', symbol: 'RCAT', uri: URI, latest: BLOCK, busy: false };
  const rows = [self, friend], reads: { functionName: string; blockNumber: bigint }[] = [], ranges: { fromBlock: bigint; toBlock: bigint; address: Address[] }[] = [];
  const client = {
    async getChainId() { return changes.chain; }, async getBlockNumber() { return changes.latest; },
    async getBlock({ blockNumber }: { blockNumber: bigint }) { return { hash: blockNumber === BLOCK ? changes.snapshotHash : hash(blockNumber), timestamp: NOW - (BLOCK - blockNumber) }; },
    async getCode() { return changes.code; },
    async getLogs(input: { fromBlock: bigint; toBlock: bigint; address: Address[] }) {
      ranges.push(input);
      if (changes.rpcFailure) throw new Error('RPC unavailable');
      if (changes.limitRanges && input.toBlock - input.fromBlock >= 10000n) throw new Error('block range exceeds maximum');
      if (changes.busy && input.fromBlock === OLD.fromBlock && input.toBlock === BLOCK) return Array.from({ length: 65 }, () => self.event);
      return rows.filter(row => row.log.blockNumber >= input.fromBlock && row.log.blockNumber <= input.toBlock).map(row => row.event);
    },
    async getTransactionReceipt({ hash: tx }: { hash: Hex }) { return rows.find(row => row.log.transactionHash === tx)!.receipt; },
    async readContract(input: { functionName: string; blockNumber: bigint; address: Address; args?: readonly Address[] }) {
      reads.push(input);
      if (input.functionName === 'launchedAsset') return changes.listed;
      if (input.functionName === 'name') return changes.name;
      if (input.functionName === 'symbol') return changes.symbol;
      if (input.functionName === 'decimals') return changes.decimals;
      if (input.functionName === 'tokenURI') return changes.uri;
      if (input.functionName === 'getState') {
        const currencies = [input.args![0], changes.currency].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
        return [WETH.address, 0n, zeroAddress, '0x', changes.stateStatus,
          { currency0: currencies[0], currency1: currencies[1], fee: changes.stateFee, tickSpacing: 200, hooks: changes.hooks }];
      }
      throw new Error(`Unexpected read ${input.functionName}`);
    },
  };
  return { ...createRareMarketCatalog({ clientFactory: () => client as unknown as RareMarketClient }), changes, rows, self, friend, reads, ranges };
}

test('complete catalog includes self and Friend launches from both exact routers, with canonical pools and sanitized metadata', async () => {
  const f = fixture(), page = await f.readPage();
  assert.equal(page.complete, true); assert.equal(page.cursor, null); assert.equal(page.blockNumber, BLOCK);
  assert.deepEqual(page.items.map(item => [item.asset, item.mode, item.creator]), [[ASSET, 'self', OWNER], [OLD_ASSET, 'friend', WALLET]]);
  assert.equal(page.items[1].collection, COLLECTION); assert.equal(page.items[1].tokenId, '2');
  assert.equal(page.items[0].imageUrl, image); assert.equal(page.items[0].quote.address, WETH.address);
  assert.equal(page.items[0].poolId, computePoolId(page.items[0].poolKey));
  assert.equal(f.ranges.length, 1); assert.equal(f.ranges[0].fromBlock, OLD.fromBlock);
  assert.deepEqual(f.ranges[0].address, RARE_MARKET_ROUTERS.map(router => router.address));
  assert.ok(f.reads.every(read => read.blockNumber === BLOCK));
  assert.ok(Object.isFrozen(page.items[0].poolKey));
});

test('zero launches is complete only after the entire deployed history was scanned', async () => {
  const f = fixture(); f.rows.length = 0;
  const page = await f.readPage();
  assert.deepEqual(page.items, []); assert.equal(page.complete, true); assert.equal(page.scannedFromBlock, OLD.fromBlock);
  assert.equal(f.ranges.length, 1);
});

test('range-limited providers return honest bounded progress and preserve the snapshot across pages', async () => {
  const f = fixture(); f.rows.length = 0; f.changes.limitRanges = true;
  const page = await f.readPage();
  assert.equal(page.complete, false); assert.ok(page.cursor); assert.equal(f.ranges.length, 9);
  assert.equal(page.scannedFromBlock, BLOCK - 80000n + 1n);
  f.changes.latest = BLOCK + 10000n;
  const next = await f.readPage({ cursor: page.cursor });
  assert.equal(next.blockNumber, BLOCK); assert.equal(next.scannedToBlock, page.scannedFromBlock - 1n);
  assert.equal(next.scannedFromBlock, BLOCK - 160000n + 1n);
});

test('busy ranges narrow without truncating old launches or requiring an indexer', async () => {
  const f = fixture(); f.changes.busy = true;
  const recent = await f.readPage();
  assert.equal(recent.complete, false); assert.deepEqual(recent.items.map(item => item.asset), [ASSET]);
  const older = await f.readPage({ cursor: recent.cursor });
  assert.equal(older.complete, true); assert.deepEqual(older.items.map(item => item.asset), [OLD_ASSET]);
  assert.equal(older.scannedToBlock, recent.scannedFromBlock - 1n);
});

test('RPC failure and unknown cursors are errors, never a fabricated empty catalog', async () => {
  const f = fixture(); f.changes.rpcFailure = true;
  await assert.rejects(f.readPage(), /RPC unavailable/);
  await assert.rejects(f.readPage({ cursor: { snapshot: BLOCK, snapshotHash: hash(BLOCK), nextToBlock: BLOCK } }), /Refresh the market/);
});

test('an aborted catalog read never starts a chain request', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.readPage({ signal: controller.signal }), /abort/i);
  assert.equal(f.ranges.length, 0);
});

test('chain and exact router runtime checks reject an untrusted catalog', async () => {
  const f = fixture(); f.changes.chain = 1; await assert.rejects(f.readPage(), /Robinhood mainnet/);
  f.changes.chain = 4663; f.changes.code = '0x1234'; await assert.rejects(f.readPage(), /verified deployment/);
});

test('a reorg invalidates an existing cursor', async () => {
  const f = fixture(); f.changes.limitRanges = true; f.rows.length = 0;
  const first = await f.readPage(); f.changes.snapshotHash = hash(1);
  await assert.rejects(f.readPage({ cursor: first.cursor }), /snapshot changed/);
});

test('removed, pre-deployment, unknown quote, and duplicate launch events fail closed', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.self.event.removed = true; },
    (f: ReturnType<typeof fixture>) => { f.self.event.blockNumber = CURRENT.fromBlock - 1n; },
    (f: ReturnType<typeof fixture>) => { f.self.event.args.quote = OWNER; },
    (f: ReturnType<typeof fixture>) => { f.rows.push(f.self); },
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(f.readPage(), /invalid launch|duplicate asset/);
  }
});

test('canonical receipts must contain the exact launch event and one matching Doppler Create', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.self.receipt.status = 'reverted'; },
    (f: ReturnType<typeof fixture>) => { f.self.receipt.blockHash = hash(2); },
    (f: ReturnType<typeof fixture>) => { f.self.receipt.logs = [f.self.receipt.logs[1]]; },
    (f: ReturnType<typeof fixture>) => { f.self.receipt.logs = [f.self.receipt.logs[0]]; },
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(f.readPage(), /canonical|locked Doppler market/);
  }
});

test('pool currency, fee, hooks, locked status and token decimals must match the actual launch', async () => {
  for (const change of [
    { listed: false }, { stateStatus: 1 }, { stateFee: 10000 }, { hooks: OWNER }, { currency: OWNER }, { decimals: 6 },
  ]) {
    const f = fixture(); Object.assign(f.changes, change); await assert.rejects(f.readPage(), /locked Doppler market/);
  }
});

test('untrusted token text is bounded and stripped; changed metadata cannot substitute an image', async () => {
  const f = fixture(); f.changes.name = '\u202eRare\n Cat' + 'x'.repeat(100); f.changes.symbol = '\u200bRCAT';
  f.changes.uri = `data:application/json;base64,${Buffer.from(JSON.stringify({ image: 'https://evil.example/image.png' })).toString('base64')}`;
  const { items } = await f.readPage();
  assert.equal(items[0].name.length, 64); assert.ok(items[0].name.startsWith('Rare Cat')); assert.equal(items[0].symbol, 'RCAT');
  assert.equal(items[0].imageUrl, null);
});

test('market images permit only bounded content-addressed IPFS and the raster launch store', () => {
  assert.equal(safeMarketImageURL(image), image);
  const cid = `Qm${'a'.repeat(44)}`;
  assert.equal(safeMarketImageURL(`ipfs://${cid}/art.png`), `https://ipfs.io/ipfs/${cid}/art.png`);
  for (const unsafe of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://localhost/a.png', 'https://evil.example/a.png',
    image.replace('.public.', '.public.evil.'), image + '?track=1', image.replace('/images/', '/images/../'), image.replace('https://', 'https://x@'),
    image.replace('.png', '.svg'), `ipfs://${cid}/../secret`, image + '#x']) assert.equal(safeMarketImageURL(unsafe), null, unsafe);
  assert.equal(marketMetadataImage(URI, hash(1)), null);
  assert.equal(marketMetadataImage('data:application/json;base64,e30=', keccak256(stringToHex('data:application/json;base64,e30='))), null);
});
