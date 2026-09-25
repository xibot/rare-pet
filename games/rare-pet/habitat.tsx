import { type CSSProperties, type ReactNode } from 'react';
import type { CareAction } from './care';
import { CanonicalSpaceIsland, SPACE_ISLAND_ART } from './CanonicalSpaceIsland';

export const islandOptions = [
  { id: 'garden', name: 'Garden', scene: SPACE_ISLAND_ART[0], description: 'The original Rare Friends garden.' },
  { id: 'circuit', name: 'Circuit', scene: SPACE_ISLAND_ART[1], description: 'A home in the circuit courtyard.' },
  { id: 'crystal', name: 'Crystal', scene: SPACE_ISLAND_ART[2], description: 'Life on the crystal mesa.' },
  { id: 'rooftop', name: 'Rooftop', scene: SPACE_ISLAND_ART[3], description: 'Your own rooftop terrace.' },
  { id: 'tidal', name: 'Tidal', scene: SPACE_ISLAND_ART[4], description: 'A little home among the tidal islands.' },
  { id: 'orbital', name: 'Rare', scene: SPACE_ISLAND_ART[5], description: 'The Rare Friends orbital islands.' },
] as const;
export type Island = (typeof islandOptions)[number]['id'];
export function isIsland(value: unknown): value is Island { return islandOptions.some(island => island.id === value); }

/** Keep saved cosmetic choices when upgrading from the original custom floors. */
export function restoreIsland(value: string): Island {
  if (isIsland(value)) return value;
  const previous: Record<string, Island> = { meadow: 'garden', moon: 'crystal', arcade: 'circuit', beach: 'tidal', rare: 'orbital' };
  return Object.hasOwn(previous, value) ? previous[value] : 'garden';
}

export function IslandPicker({ value, onChange }: { value: Island; onChange: (island: Island) => void }) {
  return <fieldset className="island-picker"><legend>YOUR ISLAND</legend><div>{islandOptions.map(island =>
    <button key={island.id} type="button" data-island={island.id} aria-pressed={value === island.id} title={island.description} onClick={() => onChange(island.id)}>
      <span className="island-thumbnail" aria-hidden="true"><CanonicalSpaceIsland scene={island.scene}/></span>{island.name}
    </button>,
  )}</div></fieldset>;
}

/** The pet and its original SDK world share one coordinate system. */
export function HabitatIsland({ island, children }: { island: Island; children: ReactNode }) {
  const scene = islandOptions.find(option => option.id === island)!.scene;
  return <div className="habitat-island" data-island={island} style={{
    aspectRatio: scene.aspectRatio,
    '--pet-ground-x': scene.petX,
    '--pet-ground-y': scene.petY,
    '--pet-max-width': scene.petMaxWidth,
  } as CSSProperties}>
    <CanonicalSpaceIsland scene={scene}/>
    {children}
  </div>;
}

function Heart() { return <svg viewBox="0 0 12 12"><path d="M2 1H5V3H7V1H10V2H12V6H10V8H8V10H6V12H4V10H2V8H0V3H2Z" fill="currentColor"/></svg>; }
function Spark() { return <svg viewBox="0 0 12 12"><path d="M5 0H7V4H9V5H12V7H8V9H7V12H5V8H3V7H0V5H4V3H5Z" fill="currentColor"/></svg>; }
function Snack({ variant }: { variant: number }) {
  return <svg viewBox="0 0 24 24" shapeRendering="crispEdges">{variant === 0 ? <>
    <path d="M7 2H18V5H20V8H22V21H4V5H7Z" fill="#362c1f"/><path d="M7 5H18V8H20V19H6V8H7Z" fill="#f3cc75"/><path d="M9 8H12V11H9ZM15 13H18V16H15ZM8 16H11V19H8Z" fill="#8b603d"/>
  </> : variant === 1 ? <>
    <path d="M9 2H13V7H17V11H15V15H12V19H9V22H6V16H4V10H7V7H9Z" fill="#3d3820"/><path d="M7 10H13V14H10V18H7Z" fill="#f1a05b"/><path d="M10 1H13V7H10ZM14 3H19V6H14Z" fill="#7cac42"/>
  </> : <>
    <path d="M4 4H20V7H22V18H19V21H5V18H2V7H4Z" fill="#483b21"/><path d="M5 7H19V17H16V19H7V17H5Z" fill="#d8ea76"/><path d="M5 7H19V10H5Z" fill="#fff2b0"/><path d="M9 3H15V7H9Z" fill="#829d38"/>
  </>}</svg>;
}

function ActionEffects({ action, variant }: { action: CareAction | ''; variant: number }) {
  if (!action) return null;
  return <div className={`pet-effects effect-${action} variant-${variant}`} aria-hidden="true">
    {action === 'pet' && <>{Array.from({ length: 5 }, (_, index) => <span className={`care-heart particle-${index}`} key={index}><Heart/></span>)}</>}
    {action === 'feed' && <><span className="care-snack"><Snack variant={variant}/></span><span className="care-bowl"><svg viewBox="0 0 30 16"><path d="M0 2H30V6H27V10H24V14H6V10H3V6H0Z" fill="#191f16"/><path d="M3 3H27V6H24V9H6V6H3Z" fill="#ccff00"/><path d="M9 14H21V16H9Z" fill="#191f16"/></svg></span>{Array.from({ length: 4 }, (_, index) => <i className={`care-crumb particle-${index}`} key={index}/>)}</>}
    {action === 'poop' && <><span className="care-puff"><svg viewBox="0 0 34 26"><path d="M9 2H21V5H27V10H32V20H27V24H7V20H2V11H6V6H9Z" fill="#e4e8d9"/><path d="M12 7H22V11H27V17H23V21H12V18H7V11H12Z" fill="#f5f7ee"/></svg></span><span className="care-poop"><svg viewBox="0 0 20 20"><path d="M10 1H13V5H15V8H17V12H19V17H1V12H3V9H6V6H9V4H10Z" fill="#8b7157"/><path d="M5 11H14V13H5ZM3 16H17V18H3Z" fill="#614c39"/><path d="M6 12H8V14H6ZM12 12H14V14H12Z" fill="#fff7e8"/></svg></span>{[0, 1, 2].map(index => <span className={`care-clean particle-${index}`} key={index}><Spark/></span>)}</>}
    {action === 'play' && <>{Array.from({ length: 6 }, (_, index) => <span className={`care-celebrate particle-${index}`} key={index}><Spark/></span>)}<span className="care-xp">+XP</span></>}
  </div>;
}

/** Transform the sprite container rather than editing its canonical pixel artwork. */
export function FriendMotion({ children, speech, action = '', sequence = 0, variant = sequence % 3 }: { children: ReactNode; speech?: ReactNode; action?: CareAction | ''; sequence?: number; variant?: number }) {
  const safeVariant = ((variant % 3) + 3) % 3;
  return <div className="friend-art pet-motion" data-action={action || 'idle'} data-variant={safeVariant}>
    {speech && <div className="speech-bubble" key={action}>{speech}</div>}
    <div className="pet-idle"><div className="pet-action-motion" key={`${sequence}-${action}`}>{children}</div></div>
    <ActionEffects key={`${sequence}-${action}-effects`} action={action} variant={safeVariant}/>
  </div>;
}
