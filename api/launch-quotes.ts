/** Read-only same-origin bridge for official public registries and issuer prices.
 * The only accepted input is a reviewed catalog ID. No URL, credentials or wallet is accepted.
 */
import catalog from '../games/rare-pet/launch-quote-catalog.json' with { type: 'json' };
const SOURCES = Object.freeze({ robinhood: 'https://api.robinhood.com/rhj/assets', chainlink: 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json' });
type Request = { method?: string; url?: string };
type Response = { statusCode: number; setHeader(name: string, value: string): unknown; end(body?: string): unknown };
async function readJson(url: string, fetcher: typeof fetch, signal: AbortSignal) {
  const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Registry unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength; if (length > 600_000) throw new Error('Registry too large'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function createLaunchQuotesHandler(fetcher: typeof fetch = fetch) {
  return async function handler(request: Request, response: Response) {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); response.statusCode = 405; response.end(JSON.stringify({ error: 'Read-only endpoint.' })); return; }
    const params = new URL(request.url ?? '/api/launch-quotes', 'https://rarepet.app').searchParams;
    const id = params.get('asset'), asset = id ? catalog.assets.find(asset => asset.id === id) : null;
    if ([...params.keys()].some(key => key !== 'asset') || params.getAll('asset').length > 1 || (params.has('asset') && !asset)) {
      response.statusCode = 400; response.end(JSON.stringify({ error: 'Choose a reviewed Robinhood quote asset.' })); return;
    }
    const sources: Record<string, string> = {};
    if (!asset || asset.kind === 'stock') sources.robinhood = SOURCES.robinhood;
    if (!asset || asset.priceSource === 'chainlink') sources.chainlink = SOURCES.chainlink;
    if (asset?.priceSource === 'robinhood') sources.price = `https://api.robinhood.com/rhj/prices/${encodeURIComponent(asset.symbol)}`;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const entries = await Promise.all(Object.entries(sources).map(async ([key, url]) => [key, await readJson(url, fetcher, controller.signal)]));
      response.statusCode = 200; response.setHeader('Cache-Control', asset?.priceSource === 'robinhood' ? 'no-store' : 'public, max-age=0, s-maxage=30, must-revalidate');
      response.end(JSON.stringify(Object.fromEntries(entries)));
    } catch {
      response.statusCode = 503; response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify({ error: 'Could not verify the official quote data. Retry before launching.' }));
    } finally { clearTimeout(timer); controller.abort(); }
  };
}
export default createLaunchQuotesHandler();
