import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
import { put, head, get } from '@vercel/blob';
import { launchImageMessage, type LaunchImageAuthorization } from '../games/rare-pet/launch-upload-message.ts';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const COLLECTIONS = ['0x116eaa62241751e0c98da43d458600c6c17cd361', '0x14c49e6118f46525de9ab41a51cbaa3c6ebf181d'];
const ABI = parseAbi(['function ownerOf(uint256 id) view returns(address)', 'function tokenBoundAccount(uint256 id) view returns(address)']);
const MAX_BYTES = 1024 * 1024, MAX_BODY = 1_500_000, DAILY_LIMIT = 5, GLOBAL_DAILY_LIMIT = 100;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
type Body = LaunchImageAuthorization & { image: string; signature: Hex };
type Client = ReturnType<typeof createPublicClient>;
type Storage = { find(path: string): Promise<{ url: string; imageSha256?: string; creatorKey?: string } | null>; save(path: string, content: Buffer, contentType: string): Promise<{ url: string }> };
type Dependencies = { client: Pick<Client, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract' | 'verifyMessage'>; storage: Storage; now?: () => number };
function isConflict(cause: unknown) { return cause instanceof Error && (cause.name === 'BlobAlreadyExistsError' || /already exists/i.test(cause.message)); }
function validateBody(value: unknown, origin: string, now: number): Body {
  if (!object(value) || value.origin !== origin || !['self', 'friend'].includes(String(value.mode))) throw new Error('Invalid upload request.');
  const keys = ['mode', 'origin', 'owner', 'imageSha256', 'issuedAt', 'expiresAt', 'image', 'signature', ...(value.mode === 'friend' ? ['collection', 'tokenId', 'wallet'] : [])];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid upload request.');
  const body = value as Body;
  launchImageMessage(body);
  if (body.mode === 'friend' && !COLLECTIONS.includes(body.collection.toLowerCase())) throw new Error('Choose a canonical Rare Friend.');
  if (body.issuedAt > now + 30 || body.expiresAt <= now || body.issuedAt < now - 300) throw new Error('Image authorization expired. Please try again.');
  if (typeof body.signature !== 'string' || !/^0x(?:[\da-f]{2}){64,4096}$/i.test(body.signature)) throw new Error('Invalid owner signature.');
  if (typeof body.image !== 'string' || body.image.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)) throw new Error('Invalid image bytes.');
  return body;
}
function decodeImage(body: Body) {
  const bytes = Buffer.from(body.image, 'base64');
  if (bytes.length < 33 || bytes.length > MAX_BYTES || bytes.toString('base64') !== body.image ||
      !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== 512 || bytes.readUInt32BE(20) !== 512) throw new Error('Upload a prepared square PNG image.');
  if (createHash('sha256').update(bytes).digest('hex') !== body.imageSha256) throw new Error('Image differs from the signed upload.');
  validatePng(bytes);
  return bytes;
}
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Canvas output is a complete, noninterlaced 8-bit RGB/RGBA PNG, not merely a PNG-looking header. */
function validatePng(bytes: Buffer) {
  const invalid = () => new Error('Upload a prepared square PNG image.');
  let offset = 8, channels = 0, ended = false, dataEnded = false;
  const imageData: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length || ended) throw invalid();
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()
      || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13 || bytes[offset + 16] !== 8 || ![2, 6].includes(bytes[offset + 17])
        || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) throw invalid();
      channels = bytes[offset + 17] === 6 ? 4 : 3;
    } else if (type === 'IHDR') throw invalid();
    else if (type === 'IDAT') {
      if (dataEnded) throw invalid();
      imageData.push(bytes.subarray(offset + 8, end - 4));
    } else {
      if (imageData.length) dataEnded = true;
      if (type === 'IEND') { if (length || !imageData.length || end !== bytes.length) throw invalid(); ended = true; }
      else if (type[0] === type[0].toUpperCase() && type !== 'PLTE') throw invalid();
      else if (type === 'PLTE' && (imageData.length || length === 0 || length % 3 || length > 768)) throw invalid();
    }
    offset = end;
  }
  if (!ended || !channels) throw invalid();
  const rowSize = 512 * channels + 1, expected = rowSize * 512;
  let pixels: Buffer;
  try { pixels = inflateSync(Buffer.concat(imageData), { maxOutputLength: expected }); } catch { throw invalid(); }
  if (pixels.length !== expected) throw invalid();
  for (let row = 0; row < 512; row++) if (pixels[row * rowSize] > 4) throw invalid();
}
export function createLaunchImageUploader(deps: Dependencies) {
  return async (input: unknown, origin: string) => {
    const time = () => deps.now?.() ?? Math.floor(Date.now() / 1000);
    const now = time(), body = validateBody(input, origin, now), bytes = decodeImage(body);
    const checkExpiry = () => { if (body.expiresAt <= time() || time() - body.issuedAt > 300) throw new Error('Image authorization expired. Please try again.'); };
    const { client, storage } = deps;
    if (await client.getChainId() !== 4663) throw new Error('Image ownership must be verified on Robinhood Chain.');
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const block = await client.getBlock({ blockNumber });
    if (!block.hash || BigInt(now) - block.timestamp > 120n || block.timestamp > BigInt(now + 30)) throw new Error('Could not verify fresh ownership. Retry shortly.');
    if (body.mode === 'friend') {
      const [owner, wallet, code] = await Promise.all([
        client.readContract({ address: body.collection, abi: ABI, functionName: 'ownerOf', args: [BigInt(body.tokenId)], blockNumber }),
        client.readContract({ address: body.collection, abi: ABI, functionName: 'tokenBoundAccount', args: [BigInt(body.tokenId)], blockNumber }),
        client.getCode({ address: body.wallet, blockNumber }),
      ]);
      if (typeof owner !== 'string' || owner.toLowerCase() !== body.owner.toLowerCase() || typeof wallet !== 'string' || wallet.toLowerCase() !== body.wallet.toLowerCase() || !code || code === '0x') throw new Error('Only the current owner can publish artwork for this Rare Wallet.');
    }
    if (!await client.verifyMessage({ address: body.owner, message: launchImageMessage(body), signature: body.signature, blockNumber })) throw new Error('The current owner must authorize this upload.');
    if (body.mode === 'friend') {
      const current = await client.readContract({ address: body.collection, abi: ABI, functionName: 'ownerOf', args: [BigInt(body.tokenId)] });
      if (typeof current !== 'string' || current.toLowerCase() !== body.owner.toLowerCase()) throw new Error('The Friend changed owners. Select it again.');
    }
    if (await client.getChainId() !== 4663) throw new Error('Image ownership must be verified on Robinhood Chain.');
    checkExpiry();
    const prefix = body.mode === 'friend' ? `rare-launchpad/4663/${body.collection.toLowerCase()}/${body.tokenId}` : `rare-launchpad/4663/self/${body.owner.toLowerCase()}`;
    const pathname = `${prefix}/images/${body.imageSha256}.png`;
    const existing = await storage.find(pathname);
    if (existing) return { url: existing.url, sha256: body.imageSha256 };
    const day = Math.floor(now / 86400);
    const creatorLimit = () => new Error(`This ${body.mode === 'friend' ? 'Friend' : 'wallet'} has reserved five new images today. Retry the same image, reuse a prepared image or try tomorrow.`);
    // Read before reserving globally so an already-full creator cannot waste global slots.
    const creatorSlots = await Promise.all(Array.from({ length: DAILY_LIMIT }, (_, slot) => storage.find(`${prefix}/quota/${day}/${slot}.json`)));
    if (!creatorSlots.some(slot => !slot || slot.imageSha256 === body.imageSha256)) throw creatorLimit();
    let globallyReserved = false;
    const creatorKey = prefix;
    const sameReservation = (slot: Awaited<ReturnType<Storage['find']>>) => slot?.creatorKey === creatorKey && slot.imageSha256 === body.imageSha256;
    // Batch immutable reads to bound round trips; every claim still uses an atomic no-overwrite write.
    for (let start = 0; start < GLOBAL_DAILY_LIMIT && !globallyReserved; start += 10) {
      checkExpiry();
      const paths = Array.from({ length: Math.min(10, GLOBAL_DAILY_LIMIT - start) }, (_, offset) => `rare-launchpad/4663/quota/${day}/${start + offset}.json`);
      const slots = await Promise.all(paths.map(path => storage.find(path)));
      if (slots.some(sameReservation)) { globallyReserved = true; break; }
      for (let offset = 0; offset < paths.length; offset++) {
        if (slots[offset]) continue;
        checkExpiry();
        try {
          await storage.save(paths[offset], Buffer.from(JSON.stringify({ creatorKey, imageSha256: body.imageSha256, issuedAt: body.issuedAt })), 'application/json');
          globallyReserved = true; break;
        } catch (cause) {
          if (!isConflict(cause)) throw cause;
          // A concurrent retry may have reserved this same creator/hash while we read.
          if (sameReservation(await storage.find(paths[offset]))) { globallyReserved = true; break; }
        }
      }
    }
    if (!globallyReserved) throw new Error('RarePet has reserved its 100 new token images for today. Reuse a prepared image or try tomorrow.');
    // Global capacity is reserved first: once full, even Sybil wallets cannot add quota blobs.
    let reserved = false;
    for (let slot = 0; slot < DAILY_LIMIT; slot++) {
      const quotaPath = `${prefix}/quota/${day}/${slot}.json`;
      checkExpiry();
      try { await storage.save(quotaPath, Buffer.from(JSON.stringify({ imageSha256: body.imageSha256, issuedAt: body.issuedAt })), 'application/json'); reserved = true; break; }
      catch (cause) {
        if (!isConflict(cause)) throw cause;
        const reservation = await storage.find(quotaPath);
        if (reservation?.imageSha256 === body.imageSha256) { reserved = true; break; }
      }
    }
    if (!reserved) throw creatorLimit();
    checkExpiry();
    try { const result = await storage.save(pathname, bytes, 'image/png'); return { url: result.url, sha256: body.imageSha256 }; }
    catch (cause) { if (isConflict(cause)) { const found = await storage.find(pathname); if (found) return { url: found.url, sha256: body.imageSha256 }; } throw cause; }
  };
}
async function readBody(req: IncomingMessage & { body?: unknown }) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') { if (Buffer.byteLength(req.body) > MAX_BODY) throw new Error('Image request is too large.'); return JSON.parse(req.body); }
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) throw new Error('Image request is too large.');
    return req.body;
  }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const data = Buffer.from(chunk); size += data.length; if (size > MAX_BODY) throw new Error('Image request is too large.'); chunks.push(data); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const blobCommands = { put, head, get };
export function createLaunchImageStorage(signal: AbortSignal, commands = blobCommands): Storage {
  return {
    find: async pathname => {
      if (pathname.includes('/quota/')) {
        // get(pathname) binds reads to the configured store; no user-controlled URL is fetched.
        const result = await commands.get(pathname, { access: 'public', useCache: false, abortSignal: signal });
        if (!result) return null;
        if (result.statusCode !== 200 || result.blob.size > 512 || result.blob.contentType !== 'application/json') throw new Error('Could not verify the image reservation.');
        const reader = result.stream.getReader(), parts: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength; if (size > 512) throw new Error('Could not verify the image reservation.'); parts.push(part.value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
        if (!object(data) || typeof data.imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.imageSha256)
          || data.creatorKey !== undefined && (typeof data.creatorKey !== 'string' || data.creatorKey.length > 200)) throw new Error('Could not verify the image reservation.');
        return { url: result.blob.url, imageSha256: data.imageSha256, creatorKey: data.creatorKey as string | undefined };
      }
      try { return await commands.head(pathname, { abortSignal: signal }); } catch (cause) { if (cause instanceof Error && cause.name === 'BlobNotFoundError') return null; throw cause; }
    },
    save: (pathname, content, contentType) => commands.put(pathname, content, { access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType, abortSignal: signal }),
  };
}
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.writeHead(405).end(JSON.stringify({ error: 'Use POST.' })); return; }
  if (!process.env.BLOB_READ_WRITE_TOKEN) { res.writeHead(503).end(JSON.stringify({ error: 'Token image storage is not configured yet.' })); return; }
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const origins = new Set(['https://rarepet.app', 'https://www.rarepet.app', ...[process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter(Boolean).map(host => `https://${host}`)]);
  if (!origins.has(origin) || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(JSON.stringify({ error: 'Use the RarePet launch form to prepare an image.' })); return; }
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 25_000);
  try {
    const client = createPublicClient({ transport: http(RPC, { timeout: 12_000, retryCount: 0, fetchOptions: { signal: abort.signal } }), cacheTime: 0 });
    const upload = createLaunchImageUploader({ client, storage: createLaunchImageStorage(abort.signal) });
    res.writeHead(200).end(JSON.stringify(await upload(await readBody(req), origin)));
  } catch (cause) {
    const text = cause instanceof Error && !/https?:|Authorization|token/i.test(cause.message) ? cause.message : 'The token image could not be prepared. Please retry.';
    res.writeHead(400).end(JSON.stringify({ error: text.slice(0, 240) }));
  } finally { clearTimeout(timeout); }
}
