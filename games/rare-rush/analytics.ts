/** Best-effort Arcade statistics. This module has no keys, signatures or wallet RPCs. */
export const ARCADE_ANALYTICS_ORIGINS = new Set([
  'https://rarerush.app', 'https://rarerush.vercel.app',
]);
export const EXCLUDED_ARCADE_WALLET = '0x6fd155b9d52f80e8a73a8a2537268602978486e2';
type Collection = 'genesis' | 'generations';
type Difficulty = 'easy' | 'normal' | 'degen';
export type ArcadeSignal =
  | { version: 1; type: 'rarerush:arcade-start'; runId: string; collection: Collection; difficulty: Difficulty }
  | { version: 1; type: 'rarerush:arcade-finish'; runId: string; finishReason: 'time' | 'hearts'; elapsedSeconds: number };
export type ArcadeAnalyticsRun = { finish: (reason: 'time' | 'hearts', elapsedSeconds: number) => void };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;

export function isArcadeAnalyticsOrigin(origin: string): boolean {
  return ARCADE_ANALYTICS_ORIGINS.has(origin);
}

/** Only fixed, bounded lifecycle messages are allowed across the sandbox. */
export function parseArcadeSignal(value: unknown): ArcadeSignal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || typeof data.runId !== 'string' || !UUID.test(data.runId)) return null;
  if (data.type === 'rarerush:arcade-start' && Object.keys(data).sort().join(',') === 'collection,difficulty,runId,type,version'
    && (data.collection === 'genesis' || data.collection === 'generations')
    && (data.difficulty === 'easy' || data.difficulty === 'normal' || data.difficulty === 'degen')) {
    return { version: 1, type: data.type, runId: data.runId.toLowerCase(), collection: data.collection, difficulty: data.difficulty };
  }
  if (data.type === 'rarerush:arcade-finish' && Object.keys(data).sort().join(',') === 'elapsedSeconds,finishReason,runId,type,version'
    && (data.finishReason === 'time' || data.finishReason === 'hearts')
    && typeof data.elapsedSeconds === 'number' && Number.isFinite(data.elapsedSeconds)
    && data.elapsedSeconds > 0 && data.elapsedSeconds <= 120.01) {
    return { version: 1, type: data.type, runId: data.runId.toLowerCase(), finishReason: data.finishReason, elapsedSeconds: data.elapsedSeconds };
  }
  return null;
}

/** Call after actual entry succeeds. Analytics never gates or delays gameplay. */
export function startArcadeAnalytics(collection: Collection, difficulty: Difficulty, send?: (event: ArcadeSignal) => void): ArcadeAnalyticsRun | null {
  try {
    // SDK sets no-referrer and uses a classic script in an opaque sandbox.
    // Its document URL is still readable; the host independently checks source.
    const hostOrigin = new URL(window.location.href).origin;
    if (window.parent === window || !isArcadeAnalyticsOrigin(hostOrigin)) return null;
    const emit = send ?? ((event: ArcadeSignal) => window.parent.postMessage(event, hostOrigin));
    const runId = crypto.randomUUID();
    let finished = false;
    emit({ version: 1, type: 'rarerush:arcade-start', runId, collection, difficulty });
    return { finish(reason, elapsedSeconds) {
      if (finished) return;
      finished = true;
      try { emit({ version: 1, type: 'rarerush:arcade-finish', runId, finishReason: reason, elapsedSeconds }); } catch { /* Gameplay always continues. */ }
    } };
  } catch { return null; }
}

/** One reporter belongs to one verified iframe/session. Receipts never enter the game frame. */
export function createArcadeEventReporter(origin: string, fetcher: typeof fetch = globalThis.fetch) {
  type Entry = { collection: Collection; difficulty: Difficulty; createdAt: number; receipt: Promise<string | null>; finished: boolean };
  const runs = new Map<string, Entry>();
  const enabled = isArcadeAnalyticsOrigin(origin);
  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4_000);
      try {
        const response = await fetcher(`${origin}/api/arcade-events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          credentials: 'same-origin', keepalive: true, signal: controller.signal,
        });
        if (response.ok) {
          const value: unknown = await response.json();
          return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
        }
        if (response.status < 500 && response.status !== 429) return null;
      } catch { /* A short retry reuses the exact id/receipt; server deduplicates. */ }
      finally { clearTimeout(timeout); }
      if (!attempt) await new Promise(resolve => setTimeout(resolve, 300));
    }
    return null;
  }
  return {
    start(signal: ArcadeSignal, wallet: string): void {
      if (!enabled || signal.type !== 'rarerush:arcade-start' || !parseArcadeSignal(signal) || !ADDRESS.test(wallet)
        || /^0x0{40}$/i.test(wallet) || wallet.toLowerCase() === EXCLUDED_ARCADE_WALLET || runs.has(signal.runId)) return;
      for (const [id, entry] of runs) if (Date.now() - entry.createdAt > 15 * 60_000) runs.delete(id);
      if (runs.size >= 128) return;
      const receipt = post({ version: 1, type: 'start', runId: signal.runId, wallet: wallet.toLowerCase(), collection: signal.collection, difficulty: signal.difficulty })
        .then(value => value?.accepted === true && typeof value.receipt === 'string' && value.receipt.length > 0 && value.receipt.length <= 4096 ? value.receipt : null);
      runs.set(signal.runId, { collection: signal.collection, difficulty: signal.difficulty, createdAt: Date.now(), receipt, finished: false });
    },
    finish(signal: ArcadeSignal): void {
      if (!enabled || signal.type !== 'rarerush:arcade-finish' || !parseArcadeSignal(signal)) return;
      const entry = runs.get(signal.runId);
      const duration = entry?.difficulty === 'easy' ? 120 : entry?.difficulty === 'normal' ? 90 : 60;
      if (!entry || entry.finished || signal.elapsedSeconds > duration + .01
        || (signal.finishReason === 'time' && Math.abs(signal.elapsedSeconds - duration) > .01)) return;
      entry.finished = true;
      void entry.receipt.then(receipt => receipt ? post({ version: 1, type: 'finish', receipt, finishReason: signal.finishReason, elapsedSeconds: signal.elapsedSeconds }) : null).catch(() => {});
    },
  };
}
