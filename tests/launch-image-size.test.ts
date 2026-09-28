import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LAUNCH_IMAGE_BYTES, prepareLaunchImage, validateLaunchImageDimensions } from '../games/rare-pet/launch-image.ts';

function pngHeader(width: number, height: number) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('image limits preserve inclusive square and rectangular boundaries', () => {
  for (const [width, height] of [[2000, 2000], [4096, 4096], [8192, 2048], [2048, 8192]]) {
    assert.doesNotThrow(() => validateLaunchImageDimensions(width, height));
  }
  assert.throws(() => validateLaunchImageDimensions(4097, 4097), /4097 × 4097.*4096 × 4096/);
  assert.throws(() => validateLaunchImageDimensions(8193, 1), /8192 px per side/);
  assert.throws(() => validateLaunchImageDimensions(1, 8193), /8192 px per side/);
  assert.throws(() => validateLaunchImageDimensions(0, 100), /invalid dimensions/);
});

test('oversized PNG dimensions and file bytes are rejected before browser decoding', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let decodes = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => { decodes++; throw new Error('decoder failed'); } });
  try {
    await assert.rejects(prepareLaunchImage(new File([pngHeader(8000, 8000)], '8k.png')), /8000 × 8000.*4096 × 4096.*2000 × 2000/);
    await assert.rejects(prepareLaunchImage(new File([new Uint8Array(MAX_LAUNCH_IMAGE_BYTES + 1)], 'big.png')), /Maximum file size: 5 MB/);
    await assert.rejects(prepareLaunchImage(new File([], 'empty.png')), /file is empty/);
    assert.equal(decodes, 0);

    const atLimit = new Uint8Array(MAX_LAUNCH_IMAGE_BYTES); atLimit.set(pngHeader(4096, 4096));
    await assert.rejects(prepareLaunchImage(new File([atLimit], 'limit.png')), /could not be read.*exporting it again/);
    assert.equal(decodes, 1, 'inclusive file and dimension limits reach the decoder');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  }
});

test('decoded non-PNG dimensions are still checked and bitmap memory is released on rejection', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let closed = false;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 8000, height: 8000, close() { closed = true; } }) });
  try {
    await assert.rejects(prepareLaunchImage(new File([new Uint8Array([255,216,255,224])], 'large.jpg')), /8000 × 8000.*4096 × 4096/);
    assert.equal(closed, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  }
});
