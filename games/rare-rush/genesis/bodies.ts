import bodyData from './body-data.json' with { type: 'json' };

export const DEFAULT_BODY_ID = '8888';
export const GENESIS_SPRITE_SPACE = Object.freeze({ width: 16, height: 16, baseline: 15, scale: 15 / 17 });
export const GENESIS_BODIES = Object.freeze(bodyData.bodies.map(body => Object.freeze({
  id: body.id, tokenId: body.id, familyId: body.familyId, familyName: body.familyName,
  label: `${body.familyName} #${body.id}`,
})));

/** Cosmetic only. Call once after a run is accepted, never on animation ticks. */
export function pickGenesisBody(previousId?: string, random: () => number = Math.random): string {
  const eligible = GENESIS_BODIES.filter(body => body.id !== previousId);
  const sample = random();
  const index = Math.min(eligible.length - 1, Math.max(0,
    Math.floor((Number.isFinite(sample) ? sample : 0) * eligible.length)));
  return eligible[index].id;
}

type Pixel = readonly [number, number];
type PackedFrame = { bob: number; rows: number[] };
const pixelPath = (pixels: readonly Pixel[]) => pixels.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('');

function geometry(body: typeof bodyData.bodies[number], packed: PackedFrame) {
  // Row masks retain exact canonical lower-body pixels. Source row 8 is y=10
  // in the approved prototype; no Genesis or Generations head pixels are redrawn.
  const pixels: Pixel[] = [];
  for (let row = 0; row < packed.rows.length; row++) {
    for (let x = 0; x < 16; x++) if (packed.rows[row] & (1 << x)) pixels.push([x, row + 10]);
  }
  const outline = new Map<string, Pixel>();
  for (const [x, y] of pixels) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    outline.set(`${x + dx},${y + dy}`, [x + dx, y + dy]);
  }
  return Object.freeze({
    bodyId: body.id,
    bodyPath: pixelPath(pixels), outlinePath: pixelPath([...outline.values()]),
    head: Object.freeze({ x: body.headX, y: 2 + packed.bob, size: 8 }),
    // Approved source bounds: top 1, baseline 18. Place them at top 0 and
    // baseline 15, centered in the same 16×16 local box as Generations.
    transform: `translate(8 15) scale(${GENESIS_SPRITE_SPACE.scale}) translate(${-body.headX - 4} -18)`,
  });
}

const bodies = new Map(bodyData.bodies.map(body => [body.id, {
  frames: body.frames.map(frame => geometry(body, frame)), idle: body.idle, run: body.run,
}]));

/** Cached SVG geometry shared by the game and the archived animation showcase. */
export function getGenesisBodyFrame(bodyId = DEFAULT_BODY_ID, frame = 0, walking = false) {
  const body = bodies.get(bodyId) ?? bodies.get(DEFAULT_BODY_ID)!;
  const index = Number.isFinite(frame) ? ((Math.floor(frame) % 8) + 8) % 8 : 0;
  return body.frames[walking ? body.run[index] : body.idle];
}
