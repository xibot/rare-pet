import assert from 'node:assert/strict';
import test from 'node:test';
import { zeroAddress, type Address } from 'viem';
import { GENESIS_DEPLOYMENT, readOwnedGenesis, readGenesisEligibility, readGenesisIdentity, readGenesisPortrait, type GenesisClient } from '../games/rare-rush/genesis/identity.ts';

const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const WALLET = '0x3333333333333333333333333333333333333333' as Address;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="#fff"/><path fill="#000" d="M0 0h8v1h-8z"/></svg>';
const data = (mime: string, value: string) => `data:${mime};base64,${Buffer.from(value).toString('base64')}`;
const IMAGE = data('image/svg+xml', SVG);
const uriFor = (image: unknown) => data('application/json', JSON.stringify({ name: '<script>untrusted label</script>', image }));
const transfer = (tokenId: bigint, blockNumber = 10n, logIndex = 0, from: Address = zeroAddress, to: Address = ACCOUNT) => ({
  address: GENESIS_DEPLOYMENT.contract, args: { from, to, tokenId }, blockNumber, logIndex, removed: false,
});

function mock(options: {
  balance?: unknown; owner?: unknown; wallet?: unknown; uri?: unknown; chains?: number[];
  received?: unknown[]; sent?: unknown[]; error?: Error; onRead?: (name: string) => void;
} = {}) {
  const calls: { name: string; args?: unknown }[] = [];
  let chainIndex = 0;
  const client = {
    async getChainId() { calls.push({ name: 'getChainId' }); return options.chains?.[chainIndex++] ?? 4663; },
    async getBlockNumber(args: unknown) { calls.push({ name: 'getBlockNumber', args }); return 99n; },
    async readContract(args: { functionName: string; blockNumber: bigint; address: Address }) {
      calls.push({ name: args.functionName, args });
      assert.equal(args.blockNumber, 99n);
      assert.equal(args.address, GENESIS_DEPLOYMENT.contract);
      options.onRead?.(args.functionName);
      if (options.error) throw options.error;
      switch (args.functionName) {
        case 'balanceOf': return options.balance ?? 1n;
        case 'ownerOf': return options.owner ?? ACCOUNT;
        case 'tokenBoundAccount': return options.wallet ?? WALLET;
        case 'tokenURI': return options.uri ?? uriFor(IMAGE);
        default: throw Error(`Unexpected contract call ${args.functionName}`);
      }
    },
    async getLogs(args: { args: { from?: Address; to?: Address }; fromBlock: bigint; toBlock: bigint; address: Address }) {
      calls.push({ name: 'getLogs', args });
      assert.equal(args.fromBlock, 0n);
      assert.equal(args.toBlock, 99n);
      assert.equal(args.address, GENESIS_DEPLOYMENT.contract);
      assert.equal(args.args.to ?? args.args.from, ACCOUNT);
      return args.args.to ? options.received ?? [transfer(1n)] : options.sent ?? [];
    },
  } as unknown as GenesisClient;
  return { client, calls };
}

test('discovers owned Genesis using only owner-filtered transfers and pinned-block checks', async () => {
  const { client, calls } = mock();
  const result = await readOwnedGenesis(client, ACCOUNT);
  assert.deepEqual(result, { friends: [{ id: 1n, label: 'Genesis #1', walletAddress: WALLET }], blockNumber: 99n });
  assert.equal(calls.filter(call => call.name === 'getLogs').length, 2);
  assert.equal(calls.filter(call => call.name === 'getChainId').length, 2);
  assert.ok(!calls.some(call => ['totalMinted', 'generation', 'tokenURI'].includes(call.name)));
});

test('empty holders require a successful balance and second chain check, without scanning', async () => {
  const { client, calls } = mock({ balance: 0n });
  assert.deepEqual(await readOwnedGenesis(client, ACCOUNT), { friends: [], blockNumber: 99n });
  assert.ok(!calls.some(call => call.name === 'getLogs'));
  assert.equal(calls.filter(call => call.name === 'getChainId').length, 2);
});

test('orders transfers and deduplicates a self-transfer, excluding NFTs sent away', async () => {
  const self = transfer(1n, 30n, 0, ACCOUNT, ACCOUNT);
  const { client } = mock({ received: [self, transfer(2n, 10n, 1), transfer(1n)], sent: [transfer(2n, 20n, 0, ACCOUNT, OTHER), self] });
  assert.deepEqual((await readOwnedGenesis(client, ACCOUNT)).friends.map(friend => friend.id), [1n]);
});

test('rejects invalid connected accounts and token IDs before RPC calls', async () => {
  for (const account of [zeroAddress, 'bad-address' as Address]) {
    const { client, calls } = mock();
    await assert.rejects(readOwnedGenesis(client, account), /valid wallet/);
    assert.equal(calls.length, 0);
  }
  for (const id of [0n, -1n, 1n << 256n]) {
    const { client, calls } = mock();
    await assert.rejects(readGenesisEligibility(client, id, ACCOUNT), /valid Genesis/);
    assert.equal(calls.length, 0);
  }
});

test('rejects the wrong chain initially and a changed chain at completion', async () => {
  for (const operation of [readOwnedGenesis, (client: GenesisClient, account: Address) => readGenesisIdentity(client, 1n, account)]) {
    const wrong = mock({ chains: [1] });
    await assert.rejects(operation(wrong.client, ACCOUNT), /Robinhood mainnet/);
    assert.deepEqual(wrong.calls.map(call => call.name), ['getChainId']);
    const changed = mock({ chains: [4663, 1] });
    await assert.rejects(operation(changed.client, ACCOUNT), /Robinhood mainnet/);
  }
});

test('rejects missing history, conflicting duplicates, and invalid logs', async () => {
  await assert.rejects(readOwnedGenesis(mock({ balance: 2n }).client, ACCOUNT), /incomplete/);
  await assert.rejects(readOwnedGenesis(mock({ received: [] }).client, ACCOUNT), /incomplete/);
  await assert.rejects(readOwnedGenesis(mock({ sent: [transfer(2n)] }).client, ACCOUNT), /inconsistent/);
  for (const log of [
    { ...transfer(1n), removed: true }, { ...transfer(1n), blockNumber: 100n },
    { ...transfer(1n), logIndex: null }, { ...transfer(1n), address: OTHER },
    transfer(0n), transfer(1n, 10n, 0, OTHER, OTHER),
  ]) await assert.rejects(readOwnedGenesis(mock({ received: [log] }).client, ACCOUNT), /history could not/);
});

test('rejects invalid balances rather than returning an empty account', async () => {
  for (const balance of [-1n, 1025n, '1', 1]) {
    await assert.rejects(readOwnedGenesis(mock({ balance }).client, ACCOUNT), /balance/);
  }
});

test('fresh eligibility checks ownership and the canonical wallet at one block', async () => {
  const { client, calls } = mock();
  assert.deepEqual(await readGenesisEligibility(client, 1n, ACCOUNT), { id: 1n, owner: ACCOUNT, walletAddress: WALLET, blockNumber: 99n });
  assert.deepEqual(calls.find(call => call.name === 'getBlockNumber')?.args, { cacheTime: 0 });
  assert.ok(!calls.some(call => call.name === 'tokenURI'));
  await assert.rejects(readGenesisEligibility(mock({ wallet: zeroAddress }).client, 1n, ACCOUNT), /canonical wallet/);
});

test('wrong or zero owner never loads artwork or token wallet', async () => {
  for (const owner of [OTHER, zeroAddress]) {
    const { client, calls } = mock({ owner });
    await assert.rejects(readGenesisIdentity(client, 1n, ACCOUNT), /no longer owned/);
    assert.ok(!calls.some(call => ['tokenURI', 'tokenBoundAccount'].includes(call.name)));
  }
  await assert.rejects(readOwnedGenesis(mock({ owner: OTHER }).client, ACCOUNT), /no longer owned/);
});

test('identity preserves canonical SVG, uses a trusted label, and serializes without bigint', async () => {
  const { client, calls } = mock();
  const result = await readGenesisIdentity(client, 1n, ACCOUNT);
  assert.equal(result.collection, 'genesis');
  assert.equal(result.chainId, 4663);
  assert.equal(result.contract, GENESIS_DEPLOYMENT.contract);
  assert.equal(result.tokenId, '1');
  assert.equal(result.label, 'Genesis #1');
  assert.equal(result.image, IMAGE);
  assert.equal(result.owner, ACCOUNT);
  assert.equal(result.walletAddress, WALLET);
  assert.equal(result.blockNumber, '99');
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.ok(calls.findIndex(call => call.name === 'ownerOf') < calls.findIndex(call => call.name === 'tokenURI'));
});

test('picker portraits are public pinned-block artwork, never ownership authorization', async () => {
  const { client, calls } = mock({ owner: OTHER });
  assert.equal(await readGenesisPortrait(client, 1n), IMAGE);
  assert.deepEqual(calls.map(call => call.name), ['getChainId', 'getBlockNumber', 'tokenURI', 'getChainId']);
  // Successfully previewing art must not let the connected account enter with someone else's NFT.
  await assert.rejects(readGenesisIdentity(client, 1n, ACCOUNT), /no longer owned/);
});

test('picker artwork rejects active SVG and discards a cancelled metadata result', async () => {
  const activeImage = data('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  await assert.rejects(readGenesisPortrait(mock({ uri: uriFor(activeImage) }).client, 1n), /supported static portrait/);
  const controller = new AbortController();
  const during = mock({ onRead(name) { if (name === 'tokenURI') controller.abort(); } });
  await assert.rejects(readGenesisPortrait(during.client, 1n, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(during.calls.filter(call => call.name === 'getChainId').length, 1);
});

test('rejects malformed metadata and noncanonical or active image payloads', async () => {
  const uris = [
    'https://example.com/metadata', 'data:application/json;base64,!!!!',
    data('application/json', '{broken'), data('application/json', 'null'), data('application/json', '[]'),
    uriFor(undefined), uriFor('https://example.com/image.svg'), uriFor('data:image/svg+xml,<svg/>'),
    uriFor(data('image/png', 'not png')), uriFor(data('image/svg+xml', '<svg/>')),
    uriFor(data('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
    uriFor(data('image/svg+xml', '<svg onload="alert(1)"></svg>')),
    uriFor(data('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x"/></svg>')),
    uriFor(data('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="x"/></svg>')),
    uriFor(data('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg">' + ' '.repeat(200_000) + '</svg>')),
    data('application/json', ' '.repeat(500_000)),
  ];
  for (const uri of uris) await assert.rejects(readGenesisIdentity(mock({ uri }).client, 1n, ACCOUNT));
});

test('RPC failures surface a friendly retry message without private error detail', async () => {
  const { client } = mock({ error: new Error('RPC SECRET INTERNAL DETAIL') });
  await assert.rejects(readOwnedGenesis(client, ACCOUNT), error => {
    assert.equal((error as Error).message, 'Could not verify your Genesis on Robinhood. Please retry.');
    return true;
  });
});

test('abort stops initial reads and stops after an in-flight owner read', async () => {
  const aborted = new AbortController();
  aborted.abort();
  const before = mock();
  await assert.rejects(readOwnedGenesis(before.client, ACCOUNT, { signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(before.calls.length, 0);
  const during = new AbortController();
  const state = mock({ onRead(name) { if (name === 'ownerOf') during.abort(); } });
  await assert.rejects(readGenesisIdentity(state.client, 1n, ACCOUNT, { signal: during.signal }), { name: 'AbortError' });
  assert.ok(!state.calls.some(call => call.name === 'tokenURI' || call.name === 'tokenBoundAccount'));
});
