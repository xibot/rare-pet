import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  BlobAccessError, BlobError, BlobNotFoundError, BlobRequestAbortedError,
  BlobServiceNotAvailable, BlobServiceRateLimited, BlobStoreNotFoundError, BlobStoreSuspendedError,
} from '@vercel/blob';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { createLaunchImageStorage, createLaunchImageUploader } from '../api/launch-image.ts';
import { launchImageMessage, type LaunchImageAuthorization } from '../games/rare-pet/launch-upload-message.ts';

// Synthetic signer, local signature verification, and mocked SDK commands only: no network.
const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const ORIGIN = 'https://rarepet.app', NOW = 1_790_000_000;
const COLLECTION = '0x116eaa62241751e0c98da43d458600c6c17cd361';
const WALLET = '0x3333333333333333333333333333333333333333';
const IMAGE_PATH = 'rare-launchpad/4663/self/example/images/image.png';
const QUOTA_PATH = 'rare-launchpad/4663/self/example/quota/20000/0.json';
type CommandName = 'head' | 'get' | 'put';
type Record = { content: Buffer; contentType: string };

function png() {
  function chunk(type: string, content = Buffer.alloc(0)) {
    const bytes = Buffer.alloc(content.length + 12);
    bytes.writeUInt32BE(content.length); bytes.write(type, 4); content.copy(bytes, 8);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
    return bytes;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(512); header.writeUInt32BE(512, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((512 * 4 + 1) * 512))), chunk('IEND'),
  ]);
}

async function signedInput(mode: 'self' | 'friend' = 'self') {
  const bytes = png();
  const authorization: LaunchImageAuthorization = {
    mode, origin: ORIGIN, owner: signer.address,
    imageSha256: createHash('sha256').update(bytes).digest('hex'), issuedAt: NOW - 10, expiresAt: NOW + 290,
    ...(mode === 'friend' ? { collection: COLLECTION, tokenId: '42', wallet: WALLET } : {}),
  } as LaunchImageAuthorization;
  return { ...authorization, image: bytes.toString('base64'), signature: await signer.signMessage({ message: launchImageMessage(authorization) }) };
}

function setup(failure?: { method: 'head' | 'get'; cause: Error }) {
  const records = new Map<string, Record>();
  const calls: { method: CommandName; path: string }[] = [];
  const conflicts: BlobError[] = [];
  const controller = new AbortController();
  const url = (path: string) => `https://fixture.public.blob.vercel-storage.com/${path}`;
  const commands = {
    head: async (path: string, options: { abortSignal: AbortSignal }) => {
      calls.push({ method: 'head', path }); assert.equal(options.abortSignal, controller.signal);
      if (failure?.method === 'head') throw failure.cause;
      if (!records.has(path)) throw new BlobNotFoundError();
      return { url: url(path) };
    },
    get: async (path: string, options: { access: string; useCache: boolean; abortSignal: AbortSignal }) => {
      calls.push({ method: 'get', path });
      assert.equal(options.abortSignal, controller.signal); assert.equal(options.access, 'public'); assert.equal(options.useCache, false);
      if (failure?.method === 'get') throw failure.cause;
      const record = records.get(path);
      if (!record) return null;
      return { statusCode: 200, blob: { url: url(path), size: record.content.length, contentType: record.contentType }, stream: new Response(record.content).body };
    },
    put: async (path: string, content: Buffer, options: { contentType: string; access: string; addRandomSuffix: boolean; allowOverwrite: boolean; abortSignal: AbortSignal }) => {
      calls.push({ method: 'put', path });
      assert.equal(options.abortSignal, controller.signal); assert.equal(options.access, 'public');
      assert.equal(options.addRandomSuffix, false); assert.equal(options.allowOverwrite, false);
      if (records.has(path)) {
        // SDK 2.8.0 maps API bad_request messages to BlobError; it has no BlobAlreadyExistsError export.
        const cause = new BlobError('Blob already exists'); conflicts.push(cause); throw cause;
      }
      records.set(path, { content: Buffer.from(content), contentType: options.contentType });
      return { url: url(path) };
    },
  };
  const storage = createLaunchImageStorage(controller.signal, commands as never);
  const client = {
    getChainId: async () => 4663,
    getBlockNumber: async () => 77n,
    getBlock: async () => ({ hash: `0x${'ab'.repeat(32)}`, timestamp: BigInt(NOW - 1), number: 77n }),
    getCode: async () => '0x6000',
    readContract: async ({ functionName }: { functionName: string }) => functionName === 'ownerOf' ? signer.address : WALLET,
    verifyMessage: async (args: Parameters<typeof verifyMessage>[0]) => verifyMessage(args),
  };
  const upload = createLaunchImageUploader({ client: client as never, storage, now: () => NOW });
  return { storage, upload, calls, records, conflicts, url };
}

test('storage recognizes the actual SDK missing-blob error even though its name is Error', async () => {
  assert.equal(new BlobNotFoundError().name, 'Error');
  const state = setup();
  assert.equal(await state.storage.find(IMAGE_PATH), null);
  assert.equal(await state.storage.find(QUOTA_PATH), null, 'get returns null for an absent quota blob');
  assert.deepEqual(state.calls.map(call => call.method), ['head', 'get']);
  assert.equal(state.records.size, 0);
});

test('storage failures propagate unchanged and stop uploads before any writes', async t => {
  const input = await signedInput();
  const failures = [
    ['permission', new BlobAccessError()], ['missing store', new BlobStoreNotFoundError()],
    ['suspended store', new BlobStoreSuspendedError()], ['service unavailable', new BlobServiceNotAvailable()],
    ['rate limit', new BlobServiceRateLimited(30)], ['SDK abort', new BlobRequestAbortedError()],
    ['fetch abort', new DOMException('The operation was aborted', 'AbortError')],
    ['network', new TypeError('fetch failed')],
  ] as const;
  for (const method of ['head', 'get'] as const) {
    for (const [label, cause] of failures) {
      await t.test(`${method}: ${label}`, async () => {
        const state = setup({ method, cause });
        await assert.rejects(state.storage.find(method === 'head' ? IMAGE_PATH : QUOTA_PATH), error => error === cause);
        await assert.rejects(state.upload(input, ORIGIN), error => error === cause);
        assert.equal(state.calls.filter(call => call.method === 'put').length, 0);
        assert.equal(state.records.size, 0);
      });
    }
  }
});

test('first uploads traverse SDK missing reads, reserve quotas, and replay without extra writes', async t => {
  for (const mode of ['self', 'friend'] as const) {
    await t.test(mode, async () => {
      const state = setup(), input = await signedInput(mode);
      const prefix = mode === 'self' ? `rare-launchpad/4663/self/${signer.address.toLowerCase()}` : `rare-launchpad/4663/${COLLECTION}/42`;
      const imagePath = `${prefix}/images/${input.imageSha256}.png`;
      const result = await state.upload(input, ORIGIN);
      assert.deepEqual(result, { url: state.url(imagePath), sha256: input.imageSha256 });
      assert.equal(state.records.size, 3);
      assert.equal([...state.records.keys()].filter(path => path.startsWith('rare-launchpad/4663/quota/')).length, 1);
      assert.equal([...state.records.keys()].filter(path => path.startsWith(`${prefix}/quota/`)).length, 1);
      assert.deepEqual(state.records.get(imagePath)?.content, png());
      assert.deepEqual(state.calls.filter(call => call.method === 'put').map(call => state.records.get(call.path)?.contentType), ['application/json', 'application/json', 'image/png']);
      const writes = state.calls.filter(call => call.method === 'put').length;
      assert.deepEqual(await state.upload(input, ORIGIN), result);
      assert.equal(state.calls.filter(call => call.method === 'put').length, writes);
      assert.equal(state.records.size, 3);
    });
  }
});

test('concurrent identical uploads handle SDK conflict errors and retain exactly one reservation per scope', async () => {
  const state = setup(), input = await signedInput();
  const [first, second] = await Promise.all([state.upload(input, ORIGIN), state.upload(input, ORIGIN)]);
  assert.deepEqual(first, second);
  assert(state.conflicts.length > 0, 'the requests must exercise atomic write conflicts');
  assert(state.conflicts.every(cause => cause instanceof BlobError && cause.name === 'Error'));
  assert.equal(state.records.size, 3);
  assert.equal([...state.records.keys()].filter(path => path.startsWith('rare-launchpad/4663/quota/')).length, 1);
  assert.equal([...state.records.keys()].filter(path => path.startsWith(`rare-launchpad/4663/self/${signer.address.toLowerCase()}/quota/`)).length, 1);
  assert.equal([...state.records.keys()].filter(path => path.includes('/images/')).length, 1);
  const writes = state.calls.filter(call => call.method === 'put').length;
  assert.deepEqual(await state.upload(input, ORIGIN), first);
  assert.equal(state.calls.filter(call => call.method === 'put').length, writes);
});
