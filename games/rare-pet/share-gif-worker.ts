import { GIFEncoder, quantize, applyPalette } from 'gifenc';

// One job per worker, one transferred frame at a time. The palette stays fixed
// across the loop so the monochrome islands and lime details cannot flicker.
const encoder = GIFEncoder();
let palette: number[][] | undefined;
globalThis.onmessage = (event: MessageEvent<{ pixels: Uint8ClampedArray; size: number; last: boolean; delay: number }>) => {
  try {
    const { pixels, size, last, delay } = event.data;
    const first = !palette;
    palette ??= quantize(pixels, 256);
    encoder.writeFrame(applyPalette(pixels, palette), size, size, { palette: first ? palette : undefined, delay, repeat: 0, dispose: 1 });
    if (last) {
      encoder.finish();
      const bytes = encoder.bytes();
      globalThis.postMessage({ bytes }, { transfer: [bytes.buffer] });
    } else globalThis.postMessage({ ready: true });
  } catch {
    globalThis.postMessage({ error: 'Could not encode the GIF. Please try again.' });
  }
};
