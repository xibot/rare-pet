import { renderShareCanvas, type ShareImageOptions } from './share-image';

export const SHARE_GIF_SIZE = 800;
export const SHARE_GIF_FRAMES = 48;
export const SHARE_GIF_DELAY = 50;

/** Render deterministically, then encode off the UI thread. Nothing is uploaded. */
export async function renderShareGif(options: ShareImageOptions, signal: AbortSignal, onProgress: (percent: number) => void): Promise<Blob> {
  signal.throwIfAborted();
  let worker: Worker | undefined;
  try {
    for (let frame = 0; frame < SHARE_GIF_FRAMES; frame++) {
      signal.throwIfAborted();
      const canvas = await renderShareCanvas(options, { size: SHARE_GIF_SIZE, phase: frame / SHARE_GIF_FRAMES, signal });
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, SHARE_GIF_SIZE, SHARE_GIF_SIZE).data;
      canvas.width = canvas.height = 0;
      worker ??= new Worker('/share-gif-worker.js', { type: 'module' });
      const encoder = worker;
      const bytes = await new Promise<Uint8Array<ArrayBuffer> | undefined>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); encoder.onmessage = encoder.onerror = null; };
        const abort = () => { cleanup(); reject(new DOMException('Export cancelled', 'AbortError')); };
        const timer = window.setTimeout(() => { cleanup(); reject(new Error('GIF encoding took too long. Please try again.')); }, 20_000);
        encoder.onerror = event => { event.preventDefault(); cleanup(); reject(new Error('Your browser could not prepare the GIF. Please try again.')); };
        encoder.onmessage = (event: MessageEvent<{ bytes?: Uint8Array<ArrayBuffer>; error?: string }>) => {
          cleanup();
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.bytes);
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { abort(); return; }
        encoder.postMessage({ pixels, size: SHARE_GIF_SIZE, delay: SHARE_GIF_DELAY, last: frame === SHARE_GIF_FRAMES - 1 }, [pixels.buffer]);
      });
      signal.throwIfAborted();
      onProgress(Math.round((frame + 1) / SHARE_GIF_FRAMES * 100));
      if (bytes) return new Blob([bytes], { type: 'image/gif' });
      // Give inputs, progress and cancellation a turn before the next SVG draw.
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    }
    throw new Error('The GIF did not finish. Please try again.');
  } finally { worker?.terminate(); }
}
