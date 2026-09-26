/** Read-only same-origin bridge: Robinhood's documented public registry omits CORS headers.
 * No user URL, credentials, wallet provider, transaction or upload is accepted here.
 */
const SOURCES = Object.freeze({
  bankr: 'https://api.bankr.bot/token-launches/quote-tokens?chain=robinhood',
  robinhood: 'https://api.robinhood.com/rhj/assets',
  chainlink: 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json',
});
type Request = { method?: string; url?: string };
type Response = { statusCode: number; setHeader(name: string, value: string): unknown; end(body?: string): unknown };

async function readJson(url: string, fetcher: typeof fetch, signal: AbortSignal) {
  const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Registry unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength; if (length > 600_000) throw new Error('Registry too large'); chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createLaunchQuotesHandler(fetcher: typeof fetch = fetch) {
  return async function handler(request: Request, response: Response) {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET'); response.statusCode = 405; response.end(JSON.stringify({ error: 'Read-only endpoint.' })); return;
    }
    if (new URL(request.url ?? '/api/launch-quotes', 'https://rarepet.app').search) {
      response.statusCode = 400; response.end(JSON.stringify({ error: 'This endpoint takes no parameters.' })); return;
    }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const entries = await Promise.all(Object.entries(SOURCES).map(async ([key, url]) => [key, await readJson(url, fetcher, controller.signal)]));
      response.statusCode = 200; response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, must-revalidate');
      response.end(JSON.stringify(Object.fromEntries(entries)));
    } catch {
      response.statusCode = 503; response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ error: 'Could not verify the official quote registries. Retry before launching.' }));
    } finally { clearTimeout(timer); controller.abort(); }
  };
}

export default createLaunchQuotesHandler();
