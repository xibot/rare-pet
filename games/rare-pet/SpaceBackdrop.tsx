import { useState, type CSSProperties } from 'react';
import { pickSpacePassenger, SpaceRider } from './SpaceRider';
import { getIsland, IslandArt, islandStyle, type Island } from './islands';
import { type IslandFlight } from './islandFlights';
import './space-backdrop.css';

const stars = [
  [8, 19], [16, 49], [31, 11], [43, 25], [57, 13], [80, 9],
  [93, 25], [4, 57], [34, 44], [66, 49], [95, 58], [12, 86],
  [27, 82], [73, 84], [91, 90], [53, 37], [37, 72], [81, 56],
] as const;

/** Match home and keep visitors inside their separate sky and side corridors. */
export function SpaceBackdrop({ mainIsland, stageWidth, flights }: { mainIsland: Island; stageWidth: number; flights: readonly IslandFlight[] }) {
  const option = getIsland(mainIsland);
  const [passengers, setPassengers] = useState(() => Array.from({ length: 5 }, () => pickSpacePassenger()));
  return <div className="space-backdrop" aria-hidden="true">
    <div className="space-stars">{stars.map(([x, y], index) => <i
      className={`space-star${index % 6 === 0 ? ' space-star-bright' : ''}`}
      key={index} style={{ left: `${x}%`, top: `${y}%` }}
    />)}</div>
    {flights.map(flight => <div
      className={`space-flight space-island-${flight.depth}`}
      key={flight.slot}
      data-flight-slot={flight.slot}
      style={{
        top: flight.top, left: flight.start, width: flight.width,
        '--flight-travel': `${flight.travel}px`, '--flight-rest': `${flight.rest - flight.start}px`,
        animationDuration: `${flight.duration}s`, animationDelay: `${flight.delay}s`,
      } as CSSProperties}
      onAnimationIteration={event => {
        if (event.target !== event.currentTarget) return;
        const island = event.currentTarget.getBoundingClientRect();
        const stage = event.currentTarget.parentElement!.getBoundingClientRect();
        // Side paths turn around in view: change the visitor only after it exits.
        if (island.right > stage.left && island.left < stage.right) return;
        setPassengers(current => current.map((passenger, slot) => slot === flight.slot ? pickSpacePassenger(passenger) : passenger));
      }}
    >
      <div className="space-island" data-island={option.id} style={islandStyle(option, stageWidth)}>
        <IslandArt option={option}/><SpaceRider passenger={passengers[flight.slot]} direction={flight.direction}/>
      </div>
    </div>)}
  </div>;
}
