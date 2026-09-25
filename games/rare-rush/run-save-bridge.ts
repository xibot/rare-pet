import type { PublicReplay, PublicRunArt } from '../../shared/replay-publication.ts';
import type { Difficulty } from './difficulty.ts';

export type ArcadeRunCapture = {
  collection: 0 | 1; tokenId: string; seed: string; difficulty: Difficulty;
  replay: PublicReplay; art: Omit<PublicRunArt, 'owner'>;
};
export const RUN_SAVE_MAX_BYTES = 1_798_000;

/** The opaque game sends public replay data only. Signing stays in its trusted
 * host; neither a provider nor the connected wallet address enters this bridge. */
export function requestArcadeRunSave(capture: ArcadeRunCapture, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new Error('Saving was cancelled.'));
  if (window.parent === window) return Promise.reject(new Error('Open this game through the Arcade to save its run.'));
  const body = JSON.stringify(capture, (_, value) => typeof value === 'bigint' ? value.toString() : value);
  if (new TextEncoder().encode(body).length > RUN_SAVE_MAX_BYTES) return Promise.reject(new Error('This replay is too large to save.'));
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(), requestId = crypto.randomUUID();
    let settled = false;
    const finish = (error?: Error, id?: string) => {
      if (settled) return; settled = true;
      window.clearTimeout(timer); signal?.removeEventListener('abort', cancel); channel.port1.close(); channel.port2.close();
      if (error) reject(error); else resolve(id!);
    };
    const cancel = () => { channel.port1.postMessage({ type: 'rarerush:cancel-save', requestId }); finish(new Error('Saving was cancelled.')); };
    const timer = window.setTimeout(() => { channel.port1.postMessage({ type: 'rarerush:cancel-save', requestId }); finish(new Error('Saving timed out. Check your wallet, then try again.')); }, 240_000);
    signal?.addEventListener('abort', cancel, { once: true });
    channel.port1.onmessage = ({ data }) => {
      if (data?.type !== 'rarerush:save-result' || data.requestId !== requestId) return;
      if (typeof data.id === 'string' && /^[a-f0-9]{64}$/.test(data.id)) finish(undefined, data.id);
      else finish(new Error(typeof data.error === 'string' && data.error.length <= 300 ? data.error : 'The run could not be saved. Try again.'));
    };
    channel.port1.start();
    try { window.parent.postMessage({ type: 'rarerush:save-run', requestId, body }, new URL(window.location.href).origin, [channel.port2]); }
    catch { finish(new Error('The Arcade save connection is unavailable.')); }
  });
}

export function requestSavedRunNavigation(id: string): void {
  if (/^[a-f0-9]{64}$/.test(id)) window.parent.postMessage({ type: 'rarerush:open-saved-run', id }, new URL(window.location.href).origin);
}
