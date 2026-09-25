import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_BODY_ID, GENESIS_BODIES, GENESIS_SPRITE_SPACE, getGenesisBodyFrame, pickGenesisBody } from '../games/rare-rush/genesis/bodies.ts';

type Pixel = [number, number];
function pixels(path: string): Pixel[] {
  const result = [...path.matchAll(/M(-?\d+) (-?\d+)h1v1h-1z/g)].map(match => [Number(match[1]), Number(match[2])] as Pixel);
  assert.equal(result.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join(''), path, 'Expected exact pixel geometry');
  assert(result.length > 0);
  return result;
}
const pointKey = (points: Pixel[]) => points.map(point => point.join(',')).sort();
const box = (points: Pixel[]) => ({
  left: Math.min(...points.map(([x]) => x)), right: Math.max(...points.map(([x]) => x + 1)),
  top: Math.min(...points.map(([, y]) => y)), bottom: Math.max(...points.map(([, y]) => y + 1)),
});

test('ships 36 distinct canonical bodies from the four approved upright families', () => {
  assert.equal(GENESIS_BODIES.length, 36);
  assert.equal(new Set(GENESIS_BODIES.map(body => body.id)).size, 36);
  assert.equal(DEFAULT_BODY_ID, '8888');
  assert.deepEqual(Object.fromEntries(['Asymmetry', 'Mask', 'Skeleton', 'Cellular'].map(name => [
    name, GENESIS_BODIES.filter(body => body.familyName === name).length,
  ])), { Asymmetry: 7, Mask: 15, Skeleton: 3, Cellular: 11 });
  const signatures = new Set<string>();
  for (const body of GENESIS_BODIES) {
    assert.equal(body.tokenId, body.id);
    const sequence = [getGenesisBodyFrame(body.id), ...Array.from({ length: 8 }, (_, i) => getGenesisBodyFrame(body.id, i, true))]
      .map(frame => pixels(frame.bodyPath));
    const minX = Math.min(...sequence.flat().map(([x]) => x));
    signatures.add(JSON.stringify(sequence.map(frame => frame.map(([x, y]) => [x - minX, y]))));
  }
  assert.equal(signatures.size, 36, 'Different NFT heads must not inflate the number of body/gait choices');
});

test('all 288 running frames and 36 idle frames retain their canonical lower-body pixels', () => {
  const snapshots = GENESIS_BODIES.flatMap(body => Array.from({ length: 9 }, (_, index) => ({
    id: body.id, frame: index - 1,
    pixels: pixels(getGenesisBodyFrame(body.id, Math.max(index - 1, 0), index > 0).bodyPath),
  })));
  // Golden digest generated independently from decoded public canonical registry
  // frames, before packing. Includes IDs, frame order and every pixel coordinate.
  assert.equal(createHash('sha256').update(JSON.stringify(snapshots)).digest('hex'),
    '6194a297650c631e4865666af880c6643e50081075f7f9c970ba0329e6e927a7');
});

test('every frame joins the square portrait to a connected body, with a grounded outline inside the game viewport', () => {
  const scale = GENESIS_SPRITE_SPACE.scale;
  for (const body of GENESIS_BODIES) for (let index = -1; index < 8; index++) {
    const frame = getGenesisBodyFrame(body.id, Math.max(index, 0), index >= 0);
    const bodyPixels = pixels(frame.bodyPath), outline = pixels(frame.outlinePath);
    const expectedHalo = new Map<string, Pixel>();
    for (const [x, y] of bodyPixels) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      expectedHalo.set(`${x + dx},${y + dy}`, [x + dx, y + dy]);
    }
    assert.deepEqual(pointKey(outline), pointKey([...expectedHalo.values()]));
    const pending = [bodyPixels[0]], remaining = new Set(pointKey(bodyPixels));
    while (pending.length) {
      const [x, y] = pending.pop()!;
      if (!remaining.delete(`${x},${y}`)) continue;
      pending.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
    }
    assert.equal(remaining.size, 0, `${body.id} frame ${index} has disconnected anatomy`);
    const bounds = box(outline), head = frame.head;
    assert.equal(head.size, 8);
    assert.equal(bounds.bottom, 18);
    const neckY = Math.min(...bodyPixels.map(([, y]) => y));
    assert.equal(neckY, head.y + head.size, 'The original portrait must meet its neck');
    assert(bodyPixels.filter(([, y]) => y === neckY).every(([x]) => x >= head.x && x < head.x + head.size));
    const left = Math.min(bounds.left, head.x - 1), right = Math.max(bounds.right, head.x + 9);
    const top = Math.min(bounds.top, head.y - 1);
    const normalizeX = (x: number) => 8 + scale * (x - head.x - 4);
    const normalizeY = (y: number) => 15 + scale * (y - 18);
    assert(normalizeX(left) >= 0 && normalizeX(right) <= 16, `${body.id} exceeds viewport width`);
    assert(normalizeY(top) >= 0 && normalizeY(bounds.bottom) === 15, `${body.id} exceeds viewport height or moves its feet`);
    assert.equal(frame.transform, `translate(8 15) scale(${scale}) translate(${-head.x - 4} -18)`);
  }
});

test('every body is reachable and the previous body is excluded, including random boundary values', () => {
  const ids = GENESIS_BODIES.map(body => body.id);
  for (const previous of [undefined, 'unknown', ...ids]) {
    const eligible = ids.filter(id => id !== previous);
    assert.deepEqual(eligible.map((_, index) => pickGenesisBody(previous, () => (index + 0.5) / eligible.length)), eligible);
    for (const sample of [-Infinity, -1, 0, 0.5, 1 - Number.EPSILON, 1, 2, Infinity, NaN]) {
      assert(eligible.includes(pickGenesisBody(previous, () => sample)));
    }
  }
});

test('frame changes retain the chosen body and reuse cached geometry, with safe fallbacks', () => {
  for (const body of GENESIS_BODIES) {
    for (let i = 0; i < 8; i++) assert.equal(getGenesisBodyFrame(body.id, i, true).bodyId, body.id);
    assert.strictEqual(getGenesisBodyFrame(body.id, 0), getGenesisBodyFrame(body.id, 7, false));
    assert.strictEqual(getGenesisBodyFrame(body.id, -1, true), getGenesisBodyFrame(body.id, 7, true));
    assert.strictEqual(getGenesisBodyFrame(body.id, 8, true), getGenesisBodyFrame(body.id, 0, true));
    assert.strictEqual(getGenesisBodyFrame(body.id, Infinity, true), getGenesisBodyFrame(body.id, 0, true));
    assert.strictEqual(getGenesisBodyFrame(body.id, NaN, true), getGenesisBodyFrame(body.id, 0, true));
  }
  assert.strictEqual(getGenesisBodyFrame('unknown'), getGenesisBodyFrame(DEFAULT_BODY_ID));
});

test('React sprite keeps the validated portrait URL intact and leaves slide squeeze to its parent', async () => {
  // Node's native TS runner cannot parse JSX. Bundle just this component in memory
  // so this assertion exercises the real React renderer rather than a copy of it.
  const result = await build({ entryPoints: [fileURLToPath(new URL('../games/rare-rush/genesis/GenesisRunnerSprite.tsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic' });
  const { GenesisRunnerSprite } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  for (const mime of ['svg+xml', 'png', 'jpeg']) {
    const portraitUrl = `data:image/${mime};base64,AAAA`;
    const markup = renderToStaticMarkup(GenesisRunnerSprite({ portraitUrl, bodyId: '8888', frame: 1, walking: true }));
    assert(markup.includes('data-genesis-body="8888"'));
    const image = markup.match(/<image\b[^>]+>/)?.[0];
    assert(image?.includes(`href="${portraitUrl}"`));
    assert(image?.includes('data-genesis-art="true"'));
    assert(image?.includes('width="8"') && image?.includes('height="8"'));
    assert(image?.includes('preserveAspectRatio="xMidYMid meet"'));
    assert.equal((markup.match(/transform=/g) ?? []).length, 1, 'An extra slide transform would squeeze the actor twice');
    assert(!markup.includes('scale(1 .5)') && !markup.includes('<script'));
  }
});
