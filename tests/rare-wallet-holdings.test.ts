import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Bundle the actual module: wallet.ts includes browser SDK imports and extensionless TS imports.
const modulePath = fileURLToPath(new URL('../games/rare-pet/rare-wallet-holdings.ts', import.meta.url));
const buildResult = await build({ stdin: { contents: `export * from ${JSON.stringify(modulePath)}; export { BaseError, ContractFunctionRevertedError, encodeErrorResult } from 'viem';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { createRareWalletHoldingsReader, formatHoldingBalance, safeHoldingImage, HoldingNotOwnedError, BaseError, ContractFunctionRevertedError, encodeErrorResult } = await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
const WALLET = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const TOKEN2 = '0x4444444444444444444444444444444444444444';
const MAX = (1n << 256n) - 1n;
function response(value: unknown) { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }); }
function token(value: unknown = '1000000000000000001', scale: unknown = '18') {
  return { value, token: { address_hash: TOKEN, type: 'ERC-20', name: 'Rare Token', symbol: 'RF', decimals: scale } };
}
function nft(type = 'ERC-721', value: unknown = '1', id = '0') {
  return { id, value, token_type: type, holder_address_hash: WALLET, token: { address_hash: TOKEN, name: 'Rare Collectible', type }, metadata: { name: 'Rare #0', image: 'https://example.com/nft.png' } };
}
function mockClient(overrides: Record<string, unknown> = {}) {
  return { getChainId: async () => 4663, getBlockNumber: async () => 77n, getCode: async () => '0x1234', getBalance: async () => MAX,
    readContract: async ({ functionName }: { functionName: string }) => ({ balanceOf: MAX, name: 'Rare', symbol: 'RF', decimals: 18, supportsInterface: true, ownerOf: WALLET })[functionName], ...overrides };
}

test('reads exactly the RF wallet and keeps large balances, unknown decimals and pending balances distinct', async () => {
  const urls: string[] = [];
  const reader = createRareWalletHoldingsReader({ fetcher: async (url: string) => {
    urls.push(url); return response({ items: [token(String(MAX), '18'), token('123', null), token(null, '0')], next_page_params: null });
  } });
  const page = await reader.readTokenPage(WALLET);
  assert.equal(new URL(urls[0]).pathname, `/api/v2/addresses/${WALLET}/tokens`);
  assert(!urls[0].includes(OWNER));
  assert.equal(page.items[0].balance, MAX); assert.equal(page.items[1].decimals, null);
  assert.equal(page.items[2].balance, null); assert.equal(page.items[2].decimals, 0);
  assert.equal(formatHoldingBalance(1000000000000000001n, 18), '1.000000000000000001');
  assert.equal(formatHoldingBalance(123n, null), '123 base units');
  assert.equal(formatHoldingBalance(null, 18), 'Pending balance');
  assert.equal(formatHoldingBalance(0n, 18), '0');
});

test('keyset pages preserve filters, bind cursors to wallet/type, and reject repeated cursors', async () => {
  const urls: URL[] = [];
  const reader = createRareWalletHoldingsReader({ fetcher: async (url: string) => {
    urls.push(new URL(url)); return response({ items: [token()], next_page_params: { items_count: 50, value: '123', token_name: null } });
  } });
  const first = await reader.readTokenPage(WALLET);
  assert.deepEqual(first.nextCursor.params, { items_count: '50', value: '123' });
  await assert.rejects(reader.readTokenPage(WALLET, first.nextCursor), /repeated/);
  assert.equal(urls[1].searchParams.get('type'), 'ERC-20'); assert.equal(urls[1].searchParams.get('value'), '123');
  await assert.rejects(reader.readTokenPage(OWNER, first.nextCursor), /does not match/);
  await assert.rejects(reader.readNftPage(WALLET, first.nextCursor), /does not match/);
  await assert.rejects(reader.readTokenPage(WALLET, { ...first.nextCursor, params: { type: 'ERC-721' } }), /unsupported/);
});

test('unavailable APIs, non-JSON challenges and missing pagination throw rather than reporting empty', async () => {
  for (const [make, pattern] of [
    [() => new Response('challenge', { status: 403 }), /explorer 403/],
    [() => new Response('<html/>', { headers: { 'content-type': 'text/html' } }), /did not return/],
    [() => response({ items: [] }), /incomplete/],
    [() => response({ items: [], next_page_params: {} }), /pagination/],
    [() => response({ items: [], next_page_params: { value: Number.MAX_SAFE_INTEGER + 1 } }), /pagination/],
  ] as const) {
    await assert.rejects(createRareWalletHoldingsReader({ fetcher: make }).readTokenPage(WALLET), pattern);
  }
});

test('malformed or incomplete rows retain a visible partial-list warning', async () => {
  const reader = createRareWalletHoldingsReader({ fetcher: async () => response({ items: [token('-1'), token(123), token('1.1'), token(String(1n << 256n)), token('4')], next_page_params: null }) });
  const page = await reader.readTokenPage(WALLET);
  assert.equal(page.items.length, 1); assert.equal(page.items[0].balance, 4n);
  assert.match(page.warnings[0], /4 asset rows.*incomplete/);
  const badOnly = createRareWalletHoldingsReader({ fetcher: async () => response({ items: [null], next_page_params: null }) });
  assert.match((await badOnly.readTokenPage(WALLET)).warnings[0], /incomplete/);
});

test('NFT quantities, uint256 token IDs and owner-filtered provenance remain exact', async () => {
  const reader = createRareWalletHoldingsReader({ fetcher: async () => response({ items: [nft(), nft('ERC-1155', String(MAX), String(MAX)), { ...nft(), holder_address_hash: OWNER }, nft('ERC-404')], next_page_params: null }) });
  const page = await reader.readNftPage(WALLET);
  assert.equal(page.items.length, 2); assert.equal(page.items[0].tokenId, '0');
  assert.equal(page.items[1].tokenId, String(MAX)); assert.equal(page.items[1].balance, MAX);
  assert.match(page.warnings[0], /2 asset rows/);
});

test('untrusted images never become script, SVG data, local-network requests, or credentialed URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://example.com/x', 'https://user:pass@example.com/x', 'https://localhost/x', 'https://127.1/x', 'https://10.0.0.1/x', 'https://192.168.1.1/x', 'https://[::1]/x', 'https://thing.local/x', 'https://example.com:8443/x', 'https://example.com/\nx']) assert.equal(safeHoldingImage(value), null, value);
  assert.equal(safeHoldingImage('https://example.com/a.svg'), 'https://example.com/a.svg', 'External SVG is only used as an inert img, never injected markup');
  const cid = `Qm${'a'.repeat(44)}`;
  assert.equal(safeHoldingImage(`ipfs://${cid}/image.png`), `https://ipfs.io/ipfs/${cid}/image.png`);
  assert.equal(safeHoldingImage(`ipfs://${cid}/../image.png`), null);
});

test('native balance uses chain check and a pinned block of the RF wallet', async () => {
  const calls: unknown[] = [];
  const reader = createRareWalletHoldingsReader({ client: mockClient({ getBalance: async (args: unknown) => { calls.push(args); return MAX; } }) });
  const balance = await reader.readNativeBalance(WALLET);
  assert.equal(balance.balance, MAX); assert.equal(balance.blockNumber, 77n);
  assert.deepEqual(calls, [{ address: WALLET, blockNumber: 77n }]);
  await assert.rejects(createRareWalletHoldingsReader({ client: mockClient({ getChainId: async () => 1 }) }).readNativeBalance(WALLET), /Robinhood Chain/);
});

test('manual token discovery reads only balance/metadata at one block and preserves missing metadata', async () => {
  const calls: { functionName: string; args?: unknown[]; blockNumber: bigint }[] = [];
  const reader = createRareWalletHoldingsReader({ client: mockClient({ readContract: async (args: typeof calls[number]) => {
    calls.push(args); if (args.functionName === 'balanceOf') return MAX; throw new Error('Metadata unavailable');
  } }) });
  const result = await reader.readTokenHolding(WALLET, TOKEN);
  assert.equal(result.balance, MAX); assert.equal(result.decimals, null);
  assert.equal(result.name, 'Unnamed token'); assert.equal(result.source, 'rpc');
  assert(calls.every(call => call.blockNumber === 77n));
  assert.deepEqual(calls.find(call => call.functionName === 'balanceOf')?.args, [WALLET]);
});

test('manual NFT lookup verifies standard and canonical RF wallet owner/balance', async () => {
  const reader = createRareWalletHoldingsReader({ client: mockClient() });
  assert.equal((await reader.readNftHolding(WALLET, TOKEN, '0', 'erc721')).balance, 1n);
  assert.equal((await reader.readNftHolding(WALLET, TOKEN2, String(MAX), 'erc1155')).balance, MAX);
  const notOwned = createRareWalletHoldingsReader({ client: mockClient({ readContract: async ({ functionName }: { functionName: string }) => ({ supportsInterface: true, ownerOf: OWNER, balanceOf: 0n })[functionName] }) });
  await assert.rejects(notOwned.readNftHolding(WALLET, TOKEN, '0', 'erc721'), HoldingNotOwnedError);
  await assert.rejects(notOwned.readNftHolding(WALLET, TOKEN, '0', 'erc1155'), HoldingNotOwnedError);
  const unsupported = createRareWalletHoldingsReader({ client: mockClient({ readContract: async () => false }) });
  await assert.rejects(unsupported.readNftHolding(WALLET, TOKEN, '0', 'erc721'), /does not support/);
});

test('inventory can pin all manual reads to a shared block, without silently fetching a newer block', async () => {
  const pinned: bigint[] = [];
  const base = mockClient();
  const reader = createRareWalletHoldingsReader({ client: mockClient({
    getBlockNumber: async () => { throw new Error('Must not replace supplied block'); },
    getCode: async ({ blockNumber }: { blockNumber: bigint }) => { pinned.push(blockNumber); return '0x1234'; },
    readContract: async (args: { functionName: string; blockNumber: bigint }) => { pinned.push(args.blockNumber); return base.readContract(args); },
  }) });
  assert.equal((await reader.readTokenHolding(WALLET, TOKEN, undefined, 55n)).blockNumber, 55n);
  assert.equal((await reader.readNftHolding(WALLET, TOKEN, '0', 'erc721', undefined, 55n)).blockNumber, 55n);
  assert(pinned.length > 5); assert(pinned.every(block => block === 55n));
  const emptyCode = createRareWalletHoldingsReader({ client: mockClient({ getCode: async () => '0x' }) });
  await assert.rejects(emptyCode.readTokenHolding(WALLET, TOKEN), /no token contract/);
});

test('only the exact standardized nonexistent NFT error counts as a burned historical holding', async () => {
  function readerFor(revertedId: bigint | null) {
    return createRareWalletHoldingsReader({ client: mockClient({ readContract: async ({ functionName, abi }: { functionName: string; abi: unknown }) => {
      if (functionName === 'supportsInterface') return true;
      if (functionName === 'ownerOf') {
        if (revertedId === null) throw new Error('Execution reverted or RPC unavailable');
        const data = encodeErrorResult({ abi, errorName: 'ERC721NonexistentToken', args: [revertedId] });
        throw new BaseError('Wrapped contract read failure', { cause: new ContractFunctionRevertedError({ abi, data, functionName }) });
      }
      throw new Error('Unexpected read');
    } }) });
  }
  await assert.rejects(readerFor(0n).readNftHolding(WALLET, TOKEN, '0', 'erc721'), HoldingNotOwnedError);
  await assert.rejects(readerFor(1n).readNftHolding(WALLET, TOKEN, '0', 'erc721'), error => !(error instanceof HoldingNotOwnedError));
  await assert.rejects(readerFor(null).readNftHolding(WALLET, TOKEN, '0', 'erc721'), /RPC unavailable/);
});

test('response byte and page row limits prevent unbounded untrusted API payloads', async () => {
  const oversized = createRareWalletHoldingsReader({ fetcher: async () => new Response('{"items":[]}', { headers: { 'content-type': 'application/json', 'content-length': '2000001' } }) });
  await assert.rejects(oversized.readTokenPage(WALLET), /too large/);
  const tooMany = createRareWalletHoldingsReader({ fetcher: async () => response({ items: Array(101).fill(token()), next_page_params: null }) });
  await assert.rejects(tooMany.readTokenPage(WALLET), /incomplete/);
});

test('cancelled modal loads and stalled transports terminate without an empty success result', async () => {
  const controller = new AbortController();
  const reader = createRareWalletHoldingsReader({ timeoutMs: 20, fetcher: () => new Promise(() => {}) });
  const pending = reader.readTokenPage(WALLET, null, controller.signal);
  controller.abort(new Error('Modal closed'));
  await assert.rejects(pending, /Modal closed/);
  await assert.rejects(reader.readNftPage(WALLET), /timed out/);
  let requests = 0;
  await assert.rejects(createRareWalletHoldingsReader({ fetcher: async () => { requests++; return response({ items: [], next_page_params: null }); } }).readTokenPage(WALLET, null, controller.signal), /Modal closed/);
  assert.equal(requests, 0);
});

test('page limit is explicit and cannot silently imply complete holdings', async () => {
  const reader = createRareWalletHoldingsReader({ fetcher: async () => response({ items: [], next_page_params: { value: '2000', items_count: 2500 } }) });
  const page = await reader.readTokenPage(WALLET, { wallet: WALLET, kind: 'tokens', page: 49, params: { value: '1000' } });
  assert.equal(page.nextCursor, null); assert.match(page.warnings[0], /limit.*More assets/);
});
