import type { CSSProperties } from 'react';
import type { Island } from './habitat';
import './space-backdrop.css';

const accents: Record<Island, string> = {
  meadow: '#96a680',
  moon: '#a49ab8',
  arcade: '#a9b46d',
  beach: '#b7a680',
  rare: '#d3d6da',
};

const islands = [
  { x: '24%', y: '22%', size: 28, depth: 'far', delay: -9 },
  { x: '69%', y: '15%', size: 32, depth: 'far', delay: -31 },
  { x: '86%', y: '44%', size: 26, depth: 'far', delay: -17 },
  { x: '7%', y: '36%', size: 48, depth: 'middle', delay: -14 },
  { x: '75%', y: '32%', size: 44, depth: 'middle', delay: -4 },
  { x: '20%', y: '65%', size: 42, depth: 'middle', delay: -21 },
  { x: '2%', y: '76%', size: 68, depth: 'near', delay: -7 },
  { x: '85%', y: '69%', size: 62, depth: 'near', delay: -15 },
] as const;

const stars = [
  [8, 19], [16, 49], [31, 11], [43, 25], [57, 13], [80, 9],
  [93, 25], [4, 57], [34, 44], [66, 49], [95, 58], [12, 86],
  [27, 82], [73, 84], [91, 90], [53, 37], [37, 72], [81, 56],
] as const;

/** Quiet scenery behind the pet: depth comes from scale, contrast and drift speed. */
export function SpaceBackdrop({ island }: { island: Island }) {
  return <div className="space-backdrop" aria-hidden="true" style={{ '--space-accent': accents[island] } as CSSProperties}>
    <div className="space-stars">{stars.map(([x, y], index) => <i
      className={`space-star${index % 6 === 0 ? ' space-star-bright' : ''}`}
      key={index}
      style={{ left: `${x}%`, top: `${y}%` }}
    />)}</div>
    {islands.map((item, index) => <div
      className={`space-island space-island-${item.depth}`}
      key={index}
      style={{ left: item.x, top: item.y, '--space-size': `${item.size}px`, animationDelay: `${item.delay}s` } as CSSProperties}
    >
      <svg viewBox="0 0 80 40" shapeRendering="crispEdges" focusable="false">
        <path className="space-island-base" d="M8 17H72V25H64V29H56V33H48V36H32V33H24V29H16V25H8Z"/>
        <path className="space-island-edge" d="M4 15H76V21H68V25H56V28H24V25H12V21H4Z"/>
        <path className="space-island-top" d="M24 5H56V8H68V11H76V17H68V20H56V23H24V20H12V17H4V11H12V8H24Z"/>
        <path className="space-island-grain" d={index % 3 === 0
          ? 'M18 11H26V13H18ZM51 16H59V18H51ZM35 8H39V10H35Z'
          : index % 3 === 1
            ? 'M22 13H28V15H22ZM52 9H58V11H52ZM41 18H45V20H41Z'
            : 'M18 10H22V12H26V14H22V16H18V14H14V12H18ZM54 15H60V17H54Z'}/>
        <path className="space-island-facet" d="M22 26H28V31H32V33H28V31H24V29H22ZM51 28H57V30H51Z"/>
      </svg>
    </div>)}
  </div>;
}
