import type { ClassicIsland } from './ClassicIslandArt';

const accents: Record<ClassicIsland, string> = {
  meadow: '#96a680',
  moon: '#a49ab8',
  arcade: '#a9b46d',
  beach: '#b7a680',
  rare: '#d3d6da',
};

const grain = [
  'M18 11H26V13H18ZM51 16H59V18H51ZM35 8H39V10H35Z',
  'M22 13H28V15H22ZM52 9H58V11H52ZM41 18H45V20H41Z',
  'M18 10H22V12H26V14H22V16H18V14H14V12H18ZM54 15H60V17H54Z',
] as const;
const grainVariant: Record<ClassicIsland, number> = { meadow: 0, moon: 1, arcade: 2, beach: 0, rare: 1 };

/** Original RarePet flyby artwork, with its original muted palettes. */
export function FloatingIslandArt({ island }: { island: ClassicIsland }) {
  return <svg viewBox="0 0 80 40" shapeRendering="crispEdges" aria-hidden="true" focusable="false" data-floating-island={island}>
    <path fill="#525761" d="M8 17H72V25H64V29H56V33H48V36H32V33H24V29H16V25H8Z"/>
    <path fill="#858a92" d="M4 15H76V21H68V25H56V28H24V25H12V21H4Z"/>
    <path fill={accents[island]} d="M24 5H56V8H68V11H76V17H68V20H56V23H24V20H12V17H4V11H12V8H24Z"/>
    <path fill="#14191f" opacity=".4" d={grain[grainVariant[island]]}/>
    <path fill="#9ba1aa" opacity=".6" d="M22 26H28V31H32V33H28V31H24V29H22ZM51 28H57V30H51Z"/>
  </svg>;
}
