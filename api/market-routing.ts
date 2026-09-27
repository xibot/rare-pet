/** Read-only route discovery. The client verifies and requotes every returned pool onchain. */
import type { IncomingMessage } from 'node:http';
import catalog from '../games/rare-pet/launch-quote-catalog.json' with { type: 'json' };

const PROVIDER = 'https://trade-api.gateway.uniswap.org/v1/quote';
const MAX_BODY = 1_024, MAX_RESPONSE = 200_000, MAX_AMOUNT = (1n << 128n) - 1n;
const ASSETS = new Set(catalog.assets.map(asset => asset.address.toLowerCase()));
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
type Request = IncomingMessage & { body?: unknown };
type Response = { statusCode: number; setHeader(name: string, value: string): unknown; end(body?: string): unknown };
type Input = { tokenIn: string; tokenOut: string; amount: string; swapper: string };
type Dependencies = { fetcher?: typeof fetch; apiKey?: () => string | undefined; now?: () => number; timeoutMs?: number };
class InputError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

function validate(value: unknown): Input {
  if (!object(value) || Object.keys(value).length !== 4 || Object.keys(value).some(key => !['tokenIn', 'tokenOut', 'amount', 'swapper'].includes(key)) ||
      !address(value.tokenIn) || !address(value.tokenOut) || !ASSETS.has(value.tokenIn.toLowerCase()) || !ASSETS.has(value.tokenOut.toLowerCase()) ||
      value.tokenIn.toLowerCase() === value.tokenOut.toLowerCase() || !address(value.swapper) || /^0x0{40}$/i.test(value.swapper) ||
      typeof value.amount !== 'string' || !/^[1-9][0-9]{0,38}$/.test(value.amount) || BigInt(value.amount) > MAX_AMOUNT) {
    throw new InputError(400, 'Choose two different supported tokens, a valid wallet and a positive whole-unit amount.');
  }
  return { tokenIn: value.tokenIn, tokenOut: value.tokenOut, amount: value.amount, swapper: value.swapper };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error('Route request expired.'));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function readBody(request: Request, signal: AbortSignal): Promise<unknown> {
  const declaredLength = request.headers['content-length'];
  if (declaredLength !== undefined && (typeof declaredLength !== 'string' || !/^\d{1,8}$/.test(declaredLength) || Number(declaredLength) > MAX_BODY)) {
    throw new InputError(413, 'Route request is too large.');
  }
  if (request.body !== undefined) {
    const raw = typeof request.body === 'string' ? request.body : Buffer.isBuffer(request.body) ? request.body.toString('utf8') : JSON.stringify(request.body);
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BODY) throw new InputError(413, 'Route request is too large.');
    return JSON.parse(raw);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let length = 0;
    const cleanup = () => { request.removeListener('data', data); request.removeListener('end', end); request.removeListener('error', error); signal.removeEventListener('abort', abort); };
    const fail = (cause: Error) => { cleanup(); request.resume(); reject(cause); };
    const abort = () => fail(new Error('Route request expired.'));
    const error = () => fail(new InputError(400, 'Could not read the route request.'));
    const data = (chunk: Buffer | string) => { const bytes = Buffer.from(chunk); length += bytes.length; if (length > MAX_BODY) fail(new InputError(413, 'Route request is too large.')); else chunks.push(bytes); };
    const end = () => { cleanup(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new InputError(400, 'Use a valid JSON route request.')); } };
    if (signal.aborted) { abort(); return; }
    request.on('data', data); request.once('end', end); request.once('error', error); signal.addEventListener('abort', abort, { once: true });
  });
}

async function readRoute(input: Input, protocol: 'V3' | 'V4', key: string, fetcher: typeof fetch, signal: AbortSignal): Promise<unknown[]> {
  const response = await abortable(fetcher(PROVIDER, {
    method: 'POST', redirect: 'error', signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': key, 'x-permit2-disabled': 'true', 'x-universal-router-version': '2.1.1' },
    body: JSON.stringify({ ...input, type: 'EXACT_INPUT', tokenInChainId: 4663, tokenOutChainId: 4663,
      protocols: [protocol], permitAmount: 'EXACT', slippageTolerance: 0.5, routingPreference: 'BEST_PRICE', ...(protocol === 'V4' ? { hooksOptions: 'V4_NO_HOOKS' } : {}) }),
  }), signal);
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    void response.body?.cancel().catch(() => {}); throw new Error('Route provider unavailable.');
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE)) { void response.body.cancel().catch(() => {}); throw new Error('Route response too large.'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await abortable(reader.read(), signal); if (part.done) break;
      length += part.value.byteLength; if (length > MAX_RESPONSE) throw new Error('Route response too large.'); chunks.push(part.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!object(value) || value.routing !== 'CLASSIC' || !object(value.quote) || !Array.isArray(value.quote.route) ||
      !value.quote.route.every(route => Array.isArray(route) && route.every(object))) throw new Error('Unsupported route response.');
  return value.quote.route;
}

export function createMarketRoutingHandler({ fetcher = fetch, apiKey = () => process.env.UNISWAP_API_KEY, now = Date.now, timeoutMs = 12_000 }: Dependencies = {}) {
  // Bounded, per-instance backstop; no wallet/IP history is retained. Deployment-wide limits belong at the edge.
  let windowStart = now(), requests = 0, active = 0;
  return async function handler(request: Request, response: Response) {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, body: unknown) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); send(405, { error: 'Use POST.' }); return; }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(String(request.headers['content-type'] ?? '')) ||
        request.headers['content-encoding'] !== undefined && request.headers['content-encoding'] !== 'identity') { send(415, { error: 'Use an uncompressed JSON route request.' }); return; }
    const key = apiKey()?.trim();
    if (!key) { send(503, { error: 'Token routing is not configured yet. The server needs UNISWAP_API_KEY.' }); return; }
    const time = now(); if (time - windowStart >= 60_000 || time < windowStart) { windowStart = time; requests = 0; }
    if (requests >= 120 || active >= 8) { response.setHeader('Retry-After', '60'); send(429, { error: 'Too many route requests. Try again shortly.' }); return; }
    requests++; active++;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const input = validate(await readBody(request, controller.signal));
      const results = await Promise.allSettled(['V3', 'V4'].map(protocol => readRoute(input, protocol as 'V3' | 'V4', key, fetcher, controller.signal)));
      const successful = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      if (!successful.length) { send(503, { error: 'Could not discover a route. Try again shortly.' }); return; }
      send(200, { routes: successful.filter(route => route.length > 0) });
    } catch (cause) {
      if (cause instanceof InputError) send(cause.status, { error: cause.message });
      else if (cause instanceof SyntaxError) send(400, { error: 'Use a valid JSON route request.' });
      else send(503, { error: 'Could not discover a route. Try again shortly.' });
    } finally { clearTimeout(timer); controller.abort(); active--; }
  };
}

export default createMarketRoutingHandler();
