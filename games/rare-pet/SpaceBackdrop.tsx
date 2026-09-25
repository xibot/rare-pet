import { useState, type CSSProperties } from 'react';
import { pickSpacePassenger, SpaceRider } from './SpaceRider';
import { backgroundOptions, IslandArt, islandStyle, type Background, type Island } from './islands';
import './space-backdrop.css';

const islands = [
  { x: '24%', y: '22%', size: 74, depth: 'far', delay: -9, direction: 'right' },
  { x: '69%', y: '15%', size: 84, depth: 'far', delay: -31, direction: 'left' },
  { x: '86%', y: '44%', size: 72, depth: 'far', delay: -17, direction: 'right' },
  { x: '7%', y: '36%', size: 122, depth: 'middle', delay: -14, direction: 'left' },
  { x: '75%', y: '32%', size: 116, depth: 'middle', delay: -4, direction: 'right' },
  { x: '20%', y: '65%', size: 110, depth: 'middle', delay: -21, direction: 'left' },
  { x: '2%', y: '76%', size: 180, depth: 'near', delay: -7, direction: 'right' },
  { x: '85%', y: '69%', size: 168, depth: 'near', delay: -15, direction: 'left' },
] as const;

const stars = [
  [8, 19], [16, 49], [31, 11], [43, 25], [57, 13], [80, 9],
  [93, 25], [4, 57], [34, 44], [66, 49], [95, 58], [12, 86],
  [27, 82], [73, 84], [91, 90], [53, 37], [37, 72], [81, 56],
] as const;

/** Random neighbours cross the whole habitat, changing only beyond the edges. */
export function SpaceBackdrop({ background, mainIsland, stageWidth }: { background: Background; mainIsland: Island; stageWidth: number }) {
  const options = backgroundOptions(background, mainIsland);
  const [visitors, setVisitors] = useState(() => islands.map((_, index) => ({ passenger: pickSpacePassenger(), island: options[Math.floor(index * options.length / islands.length)] })));
  return <div className="space-backdrop" aria-hidden="true">
    <div className="space-stars">{stars.map(([x, y], index) => <i
      className={`space-star${index % 6 === 0 ? ' space-star-bright' : ''}`}
      key={index}
      style={{ left: `${x}%`, top: `${y}%` }}
    />)}</div>
    {islands.map((item, index) => {
      const visitor = visitors[index];
      return <div
        className={`space-flight space-flight-${item.direction} space-island-${item.depth}`}
        key={index}
        style={{ top: item.y, '--space-rest-x': item.x, '--space-size': `${item.size}px`, animationDelay: `${item.delay}s` } as CSSProperties}
        onAnimationIteration={event => {
          if (event.target !== event.currentTarget) return;
          setVisitors(current => current.map((previous, slot) => {
            if (slot !== index) return previous;
            const next = options.filter(option => option.id !== previous.island.id);
            return { passenger: pickSpacePassenger(previous.passenger), island: next.length ? next[Math.floor(Math.random() * next.length)] : previous.island };
          }));
        }}
      >
        <div className="space-island" data-island={visitor.island.id} style={islandStyle(visitor.island, stageWidth)}>
          <IslandArt option={visitor.island}/><SpaceRider passenger={visitor.passenger} direction={item.direction}/>
        </div>
      </div>;
    })}
  </div>;
}
