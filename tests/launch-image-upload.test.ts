import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import handler, { createLaunchImageUploader, createLaunchImageStorage } from '../api/launch-image.ts';
import { launchImageMessage } from '../games/rare-pet/launch-upload-message.ts';

// A synthetic test signer only. Storage and all RPC calls are mocked; no network is used.
const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const OWNER = signer.address, OTHER = '0x2222222222222222222222222222222222222222';
const WALLET = '0x3333333333333333333333333333333333333333';
const GENESIS = '0x116eaa62241751e0c98da43d458600c6c17cd361';
const GENERATIONS = '0x14c49e6118f46525de9ab41a51cbaa3c6ebf181d';
const ORIGIN = 'https://rarepet.app', NOW = 1_790_000_000, BLOCK = 77n;
const SHA = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type: string, content = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(content.length + 12); bytes.writeUInt32BE(content.length); bytes.write(type, 4); content.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
}
function png(color = 0, options: { channels?: number; filter?: number; rasterLength?: number; width?: number; height?: number; bitDepth?: number; interlace?: number; beforeData?: Buffer; compressed?: Buffer } = {}) {
  const channels = options.channels ?? 4, row = 512 * channels + 1;
  const header = Buffer.alloc(13); header.writeUInt32BE(options.width ?? 512); header.writeUInt32BE(options.height ?? 512, 4);
  header[8] = options.bitDepth ?? 8; header[9] = channels === 4 ? 6 : 2; header[12] = options.interlace ?? 0;
  const pixels = Buffer.alloc(options.rasterLength ?? row * 512, color);
  for (let y = 0; y < 512 && row * y < pixels.length; y++) pixels[y * row] = options.filter ?? 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), options.beforeData ?? Buffer.alloc(0), chunk('IDAT', options.compressed ?? deflateSync(pixels)), chunk('IEND')]);
}
async function body(overrides: Record<string, unknown> = {}, bytes = png()) {
  const auth = { mode: 'friend', origin: ORIGIN, collection: GENESIS, tokenId: '42', wallet: WALLET, owner: OWNER,
    imageSha256: SHA(bytes), issuedAt: NOW - 10, expiresAt: NOW + 290, ...overrides };
  return { ...auth, image: bytes.toString('base64'), signature: await signer.signMessage({ message: launchImageMessage(auth as never) }) };
}
async function selfBody(overrides: Record<string, unknown> = {}, bytes = png()) {
  const auth = { mode: 'self', origin: ORIGIN, owner: OWNER, imageSha256: SHA(bytes), issuedAt: NOW - 10, expiresAt: NOW + 290, ...overrides };
  return { ...auth, image: bytes.toString('base64'), signature: await signer.signMessage({ message: launchImageMessage(auth as never) }) };
}
function setup() {
  const records = new Map<string, { content: Buffer; contentType: string }>();
  const reads: Record<string, unknown>[] = [], writes: { path: string; content: Buffer; contentType: string }[] = [];
  let clock = NOW;
  const client = {
    getChainId: async () => 4663,
    getBlockNumber: async () => BLOCK,
    getBlock: async () => ({ hash: `0x${'ab'.repeat(32)}`, timestamp: BigInt(clock - 1), number: BLOCK }),
    getCode: async (args: Record<string, unknown>) => { reads.push({ method: 'code', ...args }); return '0x6000'; },
    readContract: async (args: Record<string, unknown>) => { reads.push(args); return args.functionName === 'ownerOf' ? OWNER : WALLET; },
    verifyMessage: async (args: Record<string, unknown>) => { reads.push({ method: 'verify', ...args }); return verifyMessage(args as never); },
  };
  const storage = {
    find: async (path: string) => {
      const record = records.get(path); if (!record) return null;
      return { url: `https://fixture.public.blob.vercel-storage.com/${path}`, ...(record.contentType === 'application/json' ? JSON.parse(record.content.toString()) : {}) };
    },
    save: async (path: string, content: Buffer, contentType: string) => {
      writes.push({ path, content, contentType });
      if (records.has(path)) throw Object.assign(new Error('Blob already exists'), { name: 'BlobAlreadyExistsError' });
      records.set(path, { content, contentType }); return { url: `https://fixture.public.blob.vercel-storage.com/${path}` };
    },
  };
  const upload = createLaunchImageUploader({ client: client as never, storage, now: () => clock });
  return { upload, client, storage, records, reads, writes, setTime: (value: number) => { clock = value; } };
}

test('authorization binds origin, chain, identity, exact image hash and a short expiry into a deterministic message', async () => {
  const value = await body(); const message = launchImageMessage(value as never);
  assert.match(message, /^RarePet token image upload \/ v2\nOrigin: https:\/\/rarepet.app\nChain ID: 4663\nCreator mode: friend\n/);
  for (const text of [GENESIS, 'Token ID: 42', WALLET, OWNER.toLowerCase(), value.imageSha256, 'Issued at:', 'Expires at:', 'does not transfer assets or approve spending']) assert(message.includes(text));
  assert.equal(message, launchImageMessage({ ...value, owner: OWNER.toLowerCase() } as never));
  for (const bad of [{ origin: `${ORIGIN}/path` }, { origin: 'javascript:alert(1)' }, { tokenId: '0' }, { tokenId: '01' }, { tokenId: String(2n ** 256n) },
    { wallet: `0x${'0'.repeat(40)}` }, { imageSha256: 'A'.repeat(64) }, { issuedAt: -1 }, { expiresAt: NOW - 10 }, { expiresAt: NOW + 291 }, { issuedAt: 1.5 }]) {
    assert.throws(() => launchImageMessage({ ...value, ...bad } as never), /Invalid/);
  }
});

test('self authorization verifies its signer and current chain with no NFT reads, then isolates its wallet path', async () => {
  const state = setup(), input = await selfBody();
  state.client.readContract = async () => assert.fail('Self upload must never query an NFT');
  state.client.getCode = async () => assert.fail('Self upload must support an EOA without deployed bytecode');
  const result = await state.upload(input, ORIGIN);
  assert.equal(result.url, `https://fixture.public.blob.vercel-storage.com/rare-launchpad/4663/self/${OWNER.toLowerCase()}/images/${input.imageSha256}.png`);
  assert(!result.url.includes(GENESIS)); assert(!result.url.includes(WALLET));
  const verified = state.reads.find(read => read.method === 'verify'); assert.equal(verified.address, OWNER);
  assert.match(verified.message, /Creator mode: self/); assert(!verified.message.includes('Rare Wallet:')); assert(!verified.message.includes('Collection:'));
  assert.equal(state.records.size, 3);
});

test('self and RF signatures, image namespaces and quota reservations cannot be interchanged', async () => {
  const friend = await body(), self = await selfBody();
  for (const forged of [
    { ...self, collection: GENESIS }, { ...self, collection: GENESIS, tokenId: '42', wallet: WALLET },
    { ...friend, mode: 'self' }, { ...friend, signature: self.signature }, { ...self, signature: friend.signature },
    { ...self, owner: OTHER }, { ...self, mode: 'preview' }, { ...self, mode: undefined },
  ]) {
    const state = setup(); await assert.rejects(state.upload(forged, ORIGIN)); assert.equal(state.writes.length, 0);
  }
  const state = setup();
  for (let index = 0; index < 5; index++) await state.upload(await selfBody({}, png(index)), ORIGIN);
  await assert.rejects(state.upload(await selfBody({}, png(5)), ORIGIN), /wallet.*five new images/);
  await state.upload(friend, ORIGIN); // Self reservations cannot exhaust a Friend's separate quota.
  assert.equal([...state.records.keys()].filter(path => path.includes('/quota/')).length, 12);
});

test('current canonical owner authorizes one PNG stored at a deterministic Friend/hash path', async () => {
  for (const collection of [GENESIS, GENERATIONS]) {
    const state = setup(), input = await body({ collection });
    const result = await state.upload(input, ORIGIN);
    const prefix = `rare-launchpad/4663/${collection}/42`;
    assert.equal(result.url, `https://fixture.public.blob.vercel-storage.com/${prefix}/images/${input.imageSha256}.png`);
    assert.equal(result.sha256, input.imageSha256); assert.equal(state.records.size, 3);
    assert(state.reads.filter(read => read.blockNumber !== undefined).every(read => read.blockNumber === BLOCK));
    assert(state.reads.some(read => read.functionName === 'tokenBoundAccount' && read.address === collection && read.args[0] === 42n));
    assert(state.reads.some(read => read.method === 'code' && read.address === WALLET));
    const verify = state.reads.find(read => read.method === 'verify'); assert.equal(verify.address, OWNER); assert.equal(verify.message, launchImageMessage(input as never));
    assert(state.reads.some(read => read.functionName === 'ownerOf' && read.blockNumber === undefined), 'owner rechecked at latest');
    assert.deepEqual(state.writes.map(write => write.contentType), ['application/json', 'application/json', 'image/png']);
    assert.deepEqual(state.writes[2].content, png());
  }
});

test('invalid request/collection/expiry/signature format/base64/image hash never reaches RPC or storage', async () => {
  const input = await body();
  for (const changes of [{ origin: 'https://attacker.example' }, { collection: OTHER }, { expiresAt: NOW }, { issuedAt: NOW + 31, expiresAt: NOW + 200 },
    { issuedAt: NOW - 301, expiresAt: NOW - 1 }, { signature: '0x12' }, { image: `${input.image}\n` }, { image: 'data:image/png;base64,AA==' },
    { imageSha256: 'f'.repeat(64) }, { extra: true }]) {
    const state = setup(); let chainCalls = 0; state.client.getChainId = async () => { chainCalls++; return 4663; };
    await assert.rejects(state.upload({ ...input, ...changes }, ORIGIN)); assert.equal(chainCalls, 0); assert.equal(state.writes.length, 0);
  }
  const state = setup(); await assert.rejects(state.upload({ ...input, image: Buffer.alloc(1024 * 1024 + 1).toString('base64') }, ORIGIN), /image/);
  assert.equal(state.reads.length, 0); assert.equal(state.writes.length, 0);
});

test('rejects forged headers, invalid CRC/chunks/truncation/trailing bytes and malformed/decompression-bomb rasters', async () => {
  const valid = png(), forged = valid.subarray(0, 33), badCrc = Buffer.from(valid); badCrc[29] ^= 1;
  const badImages = [forged, badCrc, valid.subarray(0, -12), Buffer.concat([valid, Buffer.from('<svg onload=alert(1)>')]),
    png(0, { width: 511 }), png(0, { height: 513 }), png(0, { bitDepth: 16 }), png(0, { interlace: 1 }), png(0, { filter: 5 }),
    png(0, { rasterLength: 100 }), png(0, { rasterLength: (512 * 4 + 1) * 512 + 1 }), png(0, { compressed: Buffer.from('not compressed') }),
    png(0, { beforeData: chunk('FAKE', Buffer.from('bad critical chunk')) }),
  ];
  for (const bytes of badImages) {
    const state = setup(); await assert.rejects(state.upload(await body({}, bytes), ORIGIN), /PNG/);
    assert.equal(state.reads.length, 0); assert.equal(state.writes.length, 0);
  }
  for (const bytes of [png(1, { channels: 3 }), png(2, { beforeData: chunk('sRGB', Buffer.from([0])) })]) {
    const state = setup(); await state.upload(await body({}, bytes), ORIGIN); assert.equal(state.records.size, 3);
  }
});

test('wrong chain, nonowner, noncanonical wallet, undeployed wallet and stale ownership cannot upload', async () => {
  const input = await body();
  for (const mutate of [
    state => { state.client.getChainId = async () => 1; },
    state => { state.client.readContract = async args => args.functionName === 'ownerOf' ? OTHER : WALLET; },
    state => { state.client.readContract = async args => args.functionName === 'ownerOf' ? OWNER : OTHER; },
    state => { state.client.getCode = async () => '0x'; },
    state => { state.client.getBlock = async () => ({ hash: '0x1234', timestamp: BigInt(NOW - 121), number: BLOCK }); },
    state => { state.client.getBlock = async () => ({ hash: '0x1234', timestamp: BigInt(NOW + 31), number: BLOCK }); },
    state => { state.client.getBlock = async () => ({ hash: null, timestamp: BigInt(NOW - 1), number: BLOCK }); },
  ]) {
    const state = setup(); mutate(state); await assert.rejects(state.upload(input, ORIGIN)); assert.equal(state.writes.length, 0);
  }
});

test('cryptographic signature is required and cannot be replayed for different artwork or another Friend', async () => {
  const input = await body(), replacement = png(3);
  for (const changes of [{ signature: `0x${'22'.repeat(65)}` }, { tokenId: '43' }, { image: replacement.toString('base64'), imageSha256: SHA(replacement) }]) {
    const state = setup(); await assert.rejects(state.upload({ ...input, ...changes }, ORIGIN)); assert.equal(state.writes.length, 0);
  }
});

test('owner/network changes and expiry during verification are rejected before storage', async () => {
  const input = await body();
  for (const mutate of [
    state => { state.client.readContract = async args => args.functionName === 'ownerOf' ? (args.blockNumber === undefined ? OTHER : OWNER) : WALLET; },
    state => { let count = 0; state.client.getChainId = async () => ++count === 1 ? 4663 : 1; },
    state => { const verify = state.client.verifyMessage; state.client.verifyMessage = async args => { const result = await verify(args); state.setTime(NOW + 291); return result; }; },
  ]) {
    const state = setup(); mutate(state); await assert.rejects(state.upload(input, ORIGIN), /changed owners|Robinhood|expired/); assert.equal(state.writes.length, 0);
  }
});

test('an identical signed replay returns the existing immutable image without new quota or writes', async () => {
  const state = setup(), input = await body(), result = await state.upload(input, ORIGIN);
  const previousWrites = state.writes.length;
  assert.deepEqual(await state.upload(input, ORIGIN), result); assert.equal(state.writes.length, previousWrites);
  assert.equal([...state.records.keys()].filter(path => path.includes('/quota/')).length, 2);
});

test('concurrent same-image requests share one quota reservation and one stored image', async () => {
  const state = setup(), input = await body();
  const results = await Promise.all(Array.from({ length: 8 }, () => state.upload(input, ORIGIN)));
  assert(results.every(result => result.url === results[0].url));
  assert.equal([...state.records.keys()].filter(path => path.includes('/quota/')).length, 2);
  assert.equal([...state.records.keys()].filter(path => path.includes('/images/')).length, 1);
});

test('failed image storage retry reuses its slot; five distinct daily reservations stay capped', async () => {
  const state = setup(), input = await body(), save = state.storage.save; let fail = true;
  state.storage.save = async (path, bytes, contentType) => { if (contentType === 'image/png' && fail) { fail = false; throw new Error('Temporary storage failure'); } return save(path, bytes, contentType); };
  await assert.rejects(state.upload(input, ORIGIN), /Temporary/); await state.upload(input, ORIGIN);
  assert.equal([...state.records.keys()].filter(path => path.includes('/quota/')).length, 2);
  for (let index = 1; index < 5; index++) await state.upload(await body({}, png(index)), ORIGIN);
  await assert.rejects(state.upload(await body({}, png(5)), ORIGIN), /five new images/);
  assert.equal([...state.records.keys()].filter(path => path.includes('/images/')).length, 5);
  await state.upload(input, ORIGIN); // Existing images remain reusable at the limit.
  state.setTime(NOW + 86400);
  await state.upload(await body({ issuedAt: NOW + 86400 - 10, expiresAt: NOW + 86400 + 290 }, png(5)), ORIGIN);
  assert.equal([...state.records.keys()].filter(path => path.includes('/images/')).length, 6);
});

test('concurrent different-image requests cannot exceed the five daily reservations', async () => {
  const state = setup(), inputs = await Promise.all(Array.from({ length: 8 }, (_, index) => body({}, png(index))));
  const results = await Promise.allSettled(inputs.map(input => state.upload(input, ORIGIN)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 5);
  assert.equal([...state.records.keys()].filter(path => path.includes(`/${GENESIS}/42/quota/`)).length, 5);
  assert([...state.records.keys()].filter(path => path.startsWith('rare-launchpad/4663/quota/')).length <= 8);
  assert.equal([...state.records.keys()].filter(path => path.includes('/images/')).length, 5);
});

test('global quota caps self and Friend image paths at100 perUTC day, including identical bytes for different creators', async () => {
  const state = setup(), inputs = [];
  for (let i = 0; i < 5; i++) inputs.push(await selfBody({}, png(i)));
  for (let i = 1; i <= 95; i++) inputs.push(await body({ tokenId: String(i) }));
  for (const input of inputs) await state.upload(input, ORIGIN);
  const globalPaths = () => [...state.records.keys()].filter(path => path.startsWith('rare-launchpad/4663/quota/'));
  assert.equal(globalPaths().length, 100);
  assert.equal([...state.records.keys()].filter(path => path.includes('/images/')).length, 100);
  const before = state.records.size;
  await assert.rejects(state.upload(await body({ tokenId: '96' }), ORIGIN), /100 new token images/);
  assert.equal(state.records.size, before, 'a globally blocked creator must not write even a quota blob');
  await state.upload(inputs[0], ORIGIN); assert.equal(state.records.size, before, 'existing images stay reusable at the global limit');
  state.setTime(NOW + 86400);
  await state.upload(await body({ tokenId: '96', issuedAt: NOW + 86400 - 10, expiresAt: NOW + 86400 + 290 }), ORIGIN);
  assert.equal(globalPaths().length, 101);
});

test('concurrent creators cannot claim more than the one remaining global slot', async () => {
  const state = setup(), day = Math.floor(NOW / 86400);
  for (let i = 0; i < 99; i++) state.records.set(`rare-launchpad/4663/quota/${day}/${i}.json`, {
    content: Buffer.from(JSON.stringify({ creatorKey: `previous-creator-${i}`, imageSha256: 'f'.repeat(64) })), contentType: 'application/json',
  });
  const inputs = await Promise.all(Array.from({ length: 8 }, (_, i) => body({ tokenId: String(200 + i) })));
  const results = await Promise.allSettled(inputs.map(input => state.upload(input, ORIGIN)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal([...state.records.keys()].filter(path => path.startsWith('rare-launchpad/4663/quota/')).length, 100);
  assert.equal([...state.records.keys()].filter(path => path.includes('/images/')).length, 1);
  assert.equal([...state.records.keys()].filter(path => path.includes(`/${GENESIS}/`) && path.includes('/quota/')).length, 1);
});

test('storage adapter always disables overwrites/random suffixes, shares abort signal and reads only bounded immutable quota content', async () => {
  const controller = new AbortController(), calls: Record<string, unknown>[] = [], hash = 'a'.repeat(64);
  const quota = `rare-launchpad/4663/${GENESIS}/42/quota/20000/0.json`, image = `rare-launchpad/4663/${GENESIS}/42/images/${hash}.png`;
  const commands = {
    put: async (path: string, bytes: Buffer, options: Record<string, unknown>) => { calls.push({ method: 'put', path, bytes, ...options }); return { url: 'https://fixture.public.blob.vercel-storage.com/image.png' }; },
    head: async (path: string, options: Record<string, unknown>) => { calls.push({ method: 'head', path, ...options }); throw Object.assign(new Error('Not found'), { name: 'BlobNotFoundError' }); },
    get: async (path: string, options: Record<string, unknown>) => { calls.push({ method: 'get', path, ...options }); const bytes = Buffer.from(JSON.stringify({ imageSha256: hash })); return { statusCode: 200, blob: { url: 'https://fixture.public.blob.vercel-storage.com/quota.json', size: bytes.length, contentType: 'application/json' }, stream: new Response(bytes).body }; },
  };
  const storage = createLaunchImageStorage(controller.signal, commands as never);
  await storage.save(image, png(), 'image/png'); assert.equal(await storage.find(image), null);
  assert.equal((await storage.find(quota)).imageSha256, hash);
  const put = calls.find(call => call.method === 'put'); assert.equal(put.path, image); assert.equal(put.allowOverwrite, false); assert.equal(put.addRandomSuffix, false); assert.equal(put.access, 'public');
  const get = calls.find(call => call.method === 'get'); assert.equal(get.path, quota); assert.equal(get.useCache, false);
  assert(calls.every(call => call.abortSignal === controller.signal));
  for (const change of [
    result => { result.blob.size = 513; }, result => { result.blob.contentType = 'text/html'; },
    result => { result.stream = new Response(JSON.stringify({ imageSha256: 'bad' })).body; },
    result => { result.stream = new Response('a'.repeat(513)).body; },
  ]) {
    const get = commands.get; const invalid = createLaunchImageStorage(controller.signal, { ...commands, get: async (...args) => { const result = await get(...args); change(result); return result; } } as never);
    await assert.rejects(invalid.find(quota), /reservation/);
  }
});

test('HTTP handler refuses wrong methods, missing storage, foreign origins and non-JSON without reaching uploads', async () => {
  const previous = process.env.BLOB_READ_WRITE_TOKEN;
  function response() { return { status: 0, body: '', headers: {}, setHeader(key, value) { this.headers[key] = value; }, writeHead(status) { this.status = status; return this; }, end(body) { this.body = body; } }; }
  try {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    for (const [request, expected] of [[{ method: 'GET', headers: {} }, 405], [{ method: 'POST', headers: {} }, 503]]) {
      const res = response(); await handler(request as never, res as never); assert.equal(res.status, expected); assert.equal(res.headers['Cache-Control'], 'no-store');
    }
    process.env.BLOB_READ_WRITE_TOKEN = 'test-placeholder-never-used';
    for (const headers of [{ origin: 'https://attacker.example', 'content-type': 'application/json' }, { origin: ORIGIN, 'content-type': 'text/plain' }, { 'content-type': 'application/json' }]) {
      const res = response(); await handler({ method: 'POST', headers } as never, res as never); assert.equal(res.status, 403);
    }
  } finally { if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = previous; }
});

let uploadClientModule: Promise<Record<string, any>> | undefined;
function loadUploadClient() {
  return uploadClientModule ??= (async () => {
  const source = fileURLToPath(new URL('../games/rare-pet/launch-upload.ts', import.meta.url));
  const bundle = await build({ entryPoints: [source], bundle: true, write: false, platform: 'node', format: 'esm' });
    return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  })();
}
test('preview/disconnected wallet cannot sign, read RPC or upload an image in either creator mode', async () => {
  const { uploadLaunchImage, uploadSelfLaunchImage } = await loadUploadClient();
  let requests = 0; const provider = { request: async () => { requests++; throw new Error('Preview must not use a wallet'); } };
  const session = { getProvider: () => provider, getSnapshot: () => ({ status: 'disconnected', revision: 1, chainId: 4663, account: OWNER }) };
  await assert.rejects(uploadLaunchImage({ session, pet: { owner: OWNER, walletAddress: WALLET }, revision: 1, image: {} }), /wallet or Friend changed/);
  await assert.rejects(uploadSelfLaunchImage({ session, owner: OWNER, revision: 1, image: {} }), /wallet or Friend changed/);
  assert.equal(requests, 0);
});

test('self client signs only its explicit self authorization and uploads without any NFT RPC calls', async () => {
  const { uploadSelfLaunchImage, selfTokenMetadataURI, tokenMetadataURI } = await loadUploadClient();
  const originalFetch = globalThis.fetch, originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const state = setup(); state.setTime(Math.floor(Date.now() / 1000));
  const requests: string[] = []; let posted: Record<string, unknown> | null = null;
  const provider = { request: async ({ method, params }) => {
    requests.push(method);
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_accounts') return [OWNER];
    if (method === 'personal_sign') {
      const message = Buffer.from(params[0].slice(2), 'hex').toString('utf8');
      assert.equal(params[1].toLowerCase(), OWNER.toLowerCase()); assert.match(message, /Creator mode: self/);
      return signer.signMessage({ message });
    }
    assert.fail(`Unexpected wallet request ${method}`);
  } };
  const session = { getProvider: () => provider, getSnapshot: () => ({ status: 'connected', revision: 1, chainId: 4663, account: OWNER }) };
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: ORIGIN } });
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/launch-image'); assert.equal(init.method, 'POST'); posted = JSON.parse(init.body as string);
      assert.equal(posted.mode, 'self'); assert(!('wallet' in posted)); assert(!('collection' in posted)); assert(!('tokenId' in posted));
      return new Response(JSON.stringify(await state.upload(posted, ORIGIN)), { headers: { 'Content-Type': 'application/json' } });
    };
    const result = await uploadSelfLaunchImage({ session, owner: OWNER, revision: 1, image: { blob: new Blob([png()], { type: 'image/png' }), sha256: SHA(png()) } });
    assert.deepEqual(requests.sort(), ['eth_accounts', 'eth_chainId', 'personal_sign'].sort());
    assert(!state.reads.some(read => read.functionName || read.method === 'code'));
    const metadata = JSON.parse(Buffer.from(selfTokenMetadataURI('Rare Self', 'SELF', result, OWNER).split(',')[1], 'base64').toString());
    assert.equal(metadata.creator, OWNER); assert.equal(metadata.creator_mode, 'self'); assert.equal(metadata.image_sha256, result.sha256);
    assert(!('collection' in metadata)); assert(!('tokenId' in metadata));
    assert.throws(() => selfTokenMetadataURI('Rare Self', 'SELF', result, OTHER), /creator/);
    assert.throws(() => tokenMetadataURI('Rare RF', 'RARE', result, { contract: GENESIS, tokenId: '42', walletAddress: WALLET, label: 'Genesis #42' }), /creator/);
    for (const url of [result.url.replace('https://', 'https://user:password@'), `${result.url}?download=1`, `${result.url}#changed`]) {
      assert.throws(() => selfTokenMetadataURI('Rare Self', 'SELF', { ...result, url }, OWNER), /creator/);
    }
  } finally { globalThis.fetch = originalFetch; if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation); else delete globalThis.location; }
});

test('self account changes during signing or image serialization stop publication before fetch', async () => {
  const { uploadSelfLaunchImage } = await loadUploadClient();
  const originalFetch = globalThis.fetch, originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  let uploads = 0;
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: ORIGIN } });
    globalThis.fetch = async () => { uploads++; assert.fail('Invalidated review must not publish'); };
    for (const changedAt of ['signature', 'bytes']) {
      let revision = 1;
      const provider = { request: async ({ method, params }) => {
        if (method === 'eth_chainId') return '0x1237';
        if (method === 'eth_accounts') return [OWNER];
        if (method === 'personal_sign') { const signature = await signer.signMessage({ message: Buffer.from(params[0].slice(2), 'hex').toString('utf8') }); if (changedAt === 'signature') revision++; return signature; }
        assert.fail(`Unexpected wallet request ${method}`);
      } };
      const session = { getProvider: () => provider, getSnapshot: () => ({ status: 'connected', revision, chainId: 4663, account: OWNER }) };
      const bytes = png(), image = { sha256: SHA(bytes), blob: { arrayBuffer: async () => { if (changedAt === 'bytes') revision++; return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } } };
      await assert.rejects(uploadSelfLaunchImage({ session, owner: OWNER, revision: 1, image }), /wallet or Friend changed/);
    }
    assert.equal(uploads, 0);
  } finally { globalThis.fetch = originalFetch; if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation); else delete globalThis.location; }
});
