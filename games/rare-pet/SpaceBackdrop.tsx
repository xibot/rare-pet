import { useState, type CSSProperties } from 'react';
import { pickSpacePassenger, SpaceRider } from './SpaceRider';
import { CanonicalSpaceIsland, SPACE_ISLAND_ART } from './CanonicalSpaceIsland';
import './space-backdrop.css';

const islands = [
  { x: '24%', y: '22%', size: 46, depth: 'far', delay: -9, direction: 'right' },
  { x: '69%', y: '15%', size: 52, depth: 'far', delay: -31, direction: 'left' },
  { x: '86%', y: '44%', size: 44, depth: 'far', delay: -17, direction: 'right' },
  { x: '7%', y: '36%', size: 76, depth: 'middle', delay: -14, direction: 'left' },
  { x: '75%', y: '32%', size: 72, depth: 'middle', delay: -4, direction: 'right' },
  { x: '20%', y: '65%', size: 68, depth: 'middle', delay: -21, direction: 'left' },
  { x: '2%', y: '76%', size: 112, depth: 'near', delay: -7, direction: 'right' },
  { x: '85%', y: '69%', size: 104, depth: 'near', delay: -15, direction: 'left' },
] as const;

const stars = [
  [8, 19], [16, 49], [31, 11], [43, 25], [57, 13], [80, 9],
  [93, 25], [4, 57], [34, 44], [66, 49], [95, 58], [12, 86],
  [27, 82], [73, 84], [91, 90], [53, 37], [37, 72], [81, 56],
] as const;

/** Random neighbours cross the whole habitat, changing only beyond the edges. */
export function SpaceBackdrop() {
  const [passengers, setPassengers] = useState(() => islands.map(() => pickSpacePassenger()));
  return <div className="space-backdrop" aria-hidden="true">
    <div className="space-stars">{stars.map(([x, y], index) => <i
      className={`space-star${index % 6 === 0 ? ' space-star-bright' : ''}`}
      key={index}
      style={{ left: `${x}%`, top: `${y}%` }}
    />)}</div>
    {islands.map((item, index) => {
      const scene = SPACE_ISLAND_ART[index % SPACE_ISLAND_ART.length];
      return <div
        className={`space-flight space-flight-${item.direction} space-island-${item.depth}`}
        key={index}
        style={{ top: item.y, '--space-rest-x': item.x, '--space-size': `${item.size}px`, animationDelay: `${item.delay}s` } as CSSProperties}
        onAnimationIteration={event => {
          if (event.target !== event.currentTarget) return;
          setPassengers(current => current.map((passenger, slot) => slot === index ? pickSpacePassenger(passenger) : passenger));
        }}
      >
        <div className="space-island" style={{ aspectRatio: scene.aspectRatio, '--space-rider-x': scene.riderX, '--space-rider-y': scene.riderY, '--space-rider-size': scene.riderSize } as CSSProperties}>
          <CanonicalSpaceIsland scene={scene}/><SpaceRider passenger={passengers[index]} direction={item.direction}/>
        </div>
      </div>;
    })}
  </div>;
}
