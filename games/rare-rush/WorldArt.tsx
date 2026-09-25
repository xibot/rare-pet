import { getWorldPreset, renderProp, renderWorld, type WorldPropType } from '@rarefriends/friendsdk/world';

/** Canonical Rare Friends scenery inside the runner's 960 × 500 viewport. */
type WorldArtProps = {
  distance: number;
  elapsed: number;
  reducedMotion: boolean;
  biome: number;
};

type SceneryProp = { type: WorldPropType; x: number; base: number; size: number };

const svgImage = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const BIOMES = [
  {
    preset: '01-garden-oval',
    props: [
      { type: 'tree', x: 70, base: 325, size: 312 },
      { type: 'flower', x: 205, base: 331, size: 264 },
      { type: 'bench', x: 360, base: 322, size: 240 },
      { type: 'tree', x: 568, base: 325, size: 276 },
      { type: 'planter', x: 770, base: 322, size: 240 },
      { type: 'reeds', x: 914, base: 330, size: 264 },
    ],
  },
  {
    preset: '02-circuit-courtyard',
    props: [
      { type: 'tank', x: 65, base: 324, size: 264 },
      { type: 'terminal', x: 245, base: 324, size: 264 },
      { type: 'pipe', x: 390, base: 330, size: 264 },
      { type: 'antenna', x: 574, base: 324, size: 264 },
      { type: 'vent', x: 760, base: 321, size: 264 },
      { type: 'circuit', x: 910, base: 328, size: 240 },
    ],
  },
  {
    preset: '03-crystal-mesa',
    props: [
      { type: 'crystal', x: 76, base: 324, size: 288 },
      { type: 'rock', x: 244, base: 328, size: 264 },
      { type: 'crystal', x: 409, base: 326, size: 240 },
      { type: 'antenna', x: 610, base: 324, size: 240 },
      { type: 'crystal', x: 772, base: 324, size: 288 },
      { type: 'rock', x: 920, base: 326, size: 288 },
    ],
  },
] satisfies { preset: string; props: SceneryProp[] }[];

// Preserve the SDK exports byte-for-byte inside each image. Asset generation and
// validation happen once, not in the animation loop. The monochrome default is
// the approved Rare Friends artwork, including its small #CCFF00 signals.
// A run visits every official island family. The order belongs to world
// positions, so crossing a repeat boundary cannot swap an island on screen.
const ISLAND_SEQUENCE = [
  { preset: '01-garden-oval', width: 656, centerY: 218 },
  { preset: '06-orbital-hex', width: 584, centerY: 190 },
  { preset: '05-tidal-islands', width: 640, centerY: 225 },
  { preset: '02-circuit-courtyard', width: 600, centerY: 198 },
  { preset: '04-rooftop-terrace', width: 632, centerY: 219 },
  { preset: '03-crystal-mesa', width: 608, centerY: 207 },
] as const;
const ISLAND_SPACING = 500;
const WORLD_IMAGES = ISLAND_SEQUENCE.map(({ preset }) => ({
  complete: svgImage(renderWorld(getWorldPreset(`${preset}-complete`))),
  loading: svgImage(renderWorld(getWorldPreset(`${preset}-loading`))),
}));
const PROP_IMAGES = new Map<WorldPropType, string>(
  [...new Set(BIOMES.flatMap(({ props }) => props.map(prop => prop.type)))].map(type => [type, svgImage(renderProp(type))]),
);

function Scenery({ type, x, base, size }: SceneryProp) {
  // renderProp's fixed native ground anchor is (120, 180) on a 240px canvas.
  return <image href={PROP_IMAGES.get(type)} x={x - size / 2} y={base - size * .75} width={size} height={size} />;
}

export function WorldArt({ distance, elapsed, reducedMotion, biome }: WorldArtProps) {
  const index = ((biome % BIOMES.length) + BIOMES.length) % BIOMES.length;
  const scene = BIOMES[index];
  // The engine measures meters while its collision geometry uses pixels.
  const travel = reducedMotion ? 0 : Math.max(0, distance) * 10;
  const islandOffset = Math.floor(travel * .14);
  const firstIsland = Math.floor(islandOffset / ISLAND_SPACING) - 1;
  const sceneryOffset = Math.floor(travel * .24) % 1000;
  const floorOffset = Math.floor(travel) % 96;
  const float = reducedMotion ? 0 : Math.round(Math.sin(elapsed * .0008) * 2);

  return <g aria-hidden="true">
    <defs>
      {/* These repeat the SDK's native surface textures at their original scale. */}
      <pattern id="rush-ground-grid" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform={`translate(${-floorOffset} 0)`}>
        <path d="M14 16h4M16 14v4" fill="none" stroke="#000000" strokeWidth=".8" />
      </pattern>
      <pattern id="rush-ground-dither" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform={`translate(${-floorOffset} 0)`}>
        <rect width="4" height="4" fill="#FFFFFF" />
        <path d="M0 0h1v1H0zM2 2h1v1H2z" fill="#000000" />
      </pattern>
      <pattern id="rush-ground-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform={`translate(${-floorOffset} 0)`}>
        <rect width="7" height="7" fill="#FFFFFF" />
        <path d="M-1 1l2-2M0 7L7 0M6 8l2-2" fill="none" stroke="#000000" />
      </pattern>
    </defs>

    <rect width="960" height="500" fill="#000000" />

    {/* Genuine SDK silhouettes: oval garden, orbital hexes, tidal islands,
        courtyard, rooftop and crystal mesa, then their constructing variants. */}
    {Array.from({ length: 5 }, (_, offset) => {
      const slot = firstIsland + offset;
      const sequenceIndex = ((slot % 12) + 12) % 12;
      const family = sequenceIndex % ISLAND_SEQUENCE.length;
      const island = ISLAND_SEQUENCE[family];
      const variant = sequenceIndex < ISLAND_SEQUENCE.length ? 'complete' : 'loading';
      return <image key={`island-${slot}`} data-island-slot={slot} data-island-preset={`${island.preset}-${variant}`}
        href={WORLD_IMAGES[family][variant]}
        x={210 + slot * ISLAND_SPACING - islandOffset - island.width / 2}
        y={island.centerY - island.width * (690 / 1600) + float}
        width={island.width} height={island.width * .75} />;
    })}

    {/* The rear verge is separated from the clear running surface at y=350. */}
    <path d="M0 327H960V350H0Z" fill="#FFFFFF" stroke="#000000" strokeWidth="2" />
    <path d="M0 329H960V348H0Z" fill="url(#rush-ground-dither)" />
    <path d="M0 346H960" fill="none" stroke="#000000" strokeWidth="2" />
    {[-1000, 0, 1000].map(copy => <g key={`scenery-${copy}`} transform={`translate(${copy - sceneryOffset} 0)`}>
      {scene.props.map((prop, propIndex) => <Scenery key={`${prop.type}-${propIndex}`} {...prop} />)}
    </g>)}

    {/* Horizontal adaptation of the canonical white island top and black slab.
        All upright scenery ends above this lane; its collision line is y=400. */}
    <rect y="350" width="960" height="50" fill="#FFFFFF" />
    <rect y="352" width="960" height="45" fill="url(#rush-ground-grid)" />
    <path d="M0 350H960" stroke="#000000" strokeWidth="2" />
    <rect y="394" width="960" height="6" fill="url(#rush-ground-dither)" />
    <path d="M0 400H960" stroke="#000000" strokeWidth="3" />
    <path d="M0 403H960" stroke="#FFFFFF" strokeWidth="1.5" />
    <rect y="406" width="960" height="10" fill="url(#rush-ground-hatch)" />
    <path d="M0 417H960M0 460H960" stroke="#FFFFFF" strokeWidth="1" />
    <g transform={`translate(${-floorOffset} 0)`} stroke="#FFFFFF" fill="none">
      {Array.from({ length: 12 }, (_, i) => <g key={`slab-${i}`}>
        <path d={`M${i * 96} 418v42M${i * 96 + 48} 460v22`} strokeWidth="1" />
        <path d={`M${i * 96 + 23} 448v4M${i * 96 + 76} 471v4`} strokeWidth="1" />
        <path d={`M${i * 96 + 8} 409h28`} stroke="#000000" strokeWidth="2" />
      </g>)}
      <path d="M72 430h7M456 430h7M840 430h7" stroke="#CCFF00" strokeWidth="3" />
    </g>
    <rect y="483" width="960" height="17" fill="#000000" />
  </g>;
}
