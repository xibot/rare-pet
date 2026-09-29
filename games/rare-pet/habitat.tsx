import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CareAction } from './care';
import { getIsland, IslandArt, islandFamilies, islandOptions, islandStyle, type Island } from './islands';
import { Spark, CelebrationEffects, celebrationPose, celebrationMotion, celebrationSpriteFrame, CELEBRATION_VIEW_SIZE, CELEBRATION_FRAMES, CELEBRATION_FRAME_MS, type CelebrationAction } from './celebration';

export { Spark } from './celebration';
export type HabitatAction = CareAction | 'launch';

export function IslandPicker({ value, onChange }: { value: Island; onChange: (island: Island) => void }) {
  const selected = getIsland(value);
  const [family, setFamily] = useState(selected.family);
  return <fieldset className="island-picker"><legend>YOUR ISLAND <span>{selected.name}</span></legend>
    <div className="island-family-switch" aria-label="Island collections">{islandFamilies.map(group =>
      <button type="button" key={group.id} aria-pressed={family === group.id} onClick={() => setFamily(group.id)}>{group.name}</button>,
    )}</div>
    <div className="island-options">{islandOptions.filter(island => island.family === family).map(island =>
      <button className="island-choice" key={island.id} type="button" data-island={island.id} aria-pressed={value === island.id} onClick={() => onChange(island.id)}>
        <span className="island-thumbnail" aria-hidden="true"><IslandArt option={island}/></span>{island.name}
      </button>,
    )}</div>
  </fieldset>;
}

/** The pet and its island share coordinates and scale with the background. */
export function HabitatIsland({ island, stageWidth, children }: { island: Island; stageWidth: number; children: ReactNode }) {
  const option = getIsland(island);
  const groupRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = groupRef.current;
    const stage = group?.parentElement;
    if (!group || !stage) return;
    const friend = group.querySelector<HTMLElement>('.friend-art');
    const bubble = group.querySelector<HTMLElement>('.speech-bubble');
    const center = () => {
      const floor = group.getBoundingClientRect();
      let left = 0, top = 0, right = floor.width, bottom = floor.height;
      const include = (element: HTMLElement, halo = 0, shadow = 0) => {
        const box = element.getBoundingClientRect();
        left = Math.min(left, box.left - floor.left - halo);
        top = Math.min(top, box.top - floor.top - halo);
        right = Math.max(right, box.right - floor.left + halo + shadow);
        bottom = Math.max(bottom, box.bottom - floor.top + halo + shadow);
      };
      // Use the stable sprite frame so idle bobs and action hops do not move the island.
      if (friend) include(friend, friend.getBoundingClientRect().width / 16);
      if (bubble) include(bubble, 0, 3);
      const centerY = (floor.height - top - bottom) / 2;
      const bottomGap = Math.max(0, (stage.getBoundingClientRect().height - floor.height) / 2 - centerY);
      group.style.setProperty('--habitat-center-x', `${(floor.width - left - right) / 2}px`);
      // Keep two thirds of the centered space below the island.
      group.style.setProperty('--habitat-center-y', `${centerY + bottomGap / 3}px`);
    };
    center();
    const observer = new ResizeObserver(center);
    [stage, group, friend, bubble].forEach(element => { if (element) observer.observe(element); });
    // Celebration poses reserve more bubble clearance without measuring animated pixels.
    const actionObserver = new MutationObserver(center);
    if (friend) actionObserver.observe(friend, { attributes: true, attributeFilter: ['data-action'] });
    return () => { observer.disconnect(); actionObserver.disconnect(); };
  }, [island, stageWidth]);
  return <div className="habitat-island" ref={groupRef} data-island={island} style={islandStyle(option, stageWidth)}>
    <IslandArt option={option}/>{children}
  </div>;
}

export function Heart() { return <svg viewBox="0 0 12 12"><path d="M2 1H5V3H7V1H10V2H12V6H10V8H8V10H6V12H4V10H2V8H0V3H2Z" fill="currentColor"/></svg>; }
export function Snack({ variant }: { variant: number }) {
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
  </div>;
}

/** Quantized to the same 48 × 50ms frames as the downloadable GIF. */
function useCelebrationPhase() {
  const [phase, setPhase] = useState(0);
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    let request: number | undefined;
    let disposed = false;
    const stop = () => { if (request !== undefined) cancelAnimationFrame(request); request = undefined; };
    const restart = () => {
      stop();
      setReduced(query.matches); setPhase(0);
      if (query.matches) return;
      const start = performance.now();
      let previous = 0;
      const update = (now: number) => {
        if (disposed) return;
        const frame = Math.floor(Math.max(0, now - start) / CELEBRATION_FRAME_MS) % CELEBRATION_FRAMES;
        if (frame !== previous) { previous = frame; setPhase(frame / CELEBRATION_FRAMES); }
        request = requestAnimationFrame(update);
      };
      request = requestAnimationFrame(update);
    };
    restart();
    query.addEventListener('change', restart);
    return () => { disposed = true; stop(); query.removeEventListener('change', restart); };
  }, []);
  return { phase, reduced };
}

function HabitatCelebration({ action, variant, children }: { action: CelebrationAction; variant: number; children: ReactNode }) {
  const { phase, reduced } = useCelebrationPhase();
  // Keep the supplied canonical identity/body, synchronizing only its frame and pose.
  const friend = isValidElement<{ frame?: number; walking?: boolean }>(children) && 'frame' in children.props
    ? cloneElement(children, { frame: reduced ? 0 : celebrationSpriteFrame(variant, phase), walking: false }) : children;
  if (reduced) return <div className="pet-celebration-still">{friend}</div>;
  const size = CELEBRATION_VIEW_SIZE;
  return <svg className="pet-celebration-scene" viewBox={`0 0 ${size} ${size}`} overflow="visible" data-celebration-phase={phase}>
    <g transform={celebrationMotion(action, size, phase)}><g transform={celebrationPose(action, variant, size)}>
      <svg width={size} height={size} overflow="visible">{friend}</svg>
    </g></g>
    <g aria-hidden="true"><CelebrationEffects action={action} variant={variant} size={size} phase={phase}/></g>
  </svg>;
}

/** Transform the sprite container rather than editing its canonical pixel artwork. */
export function FriendMotion({ children, speech, action = '', sequence = 0, variant = sequence % 3 }: { children: ReactNode; speech?: ReactNode; action?: HabitatAction | ''; sequence?: number; variant?: number }) {
  const safeVariant = ((variant % 3) + 3) % 3;
  return <div className="friend-art pet-motion" data-action={action || 'idle'} data-variant={safeVariant}>
    {speech && <div className="speech-bubble">{speech}</div>}
    {action === 'play' || action === 'launch'
      ? <HabitatCelebration key={`${sequence}-${action}-${safeVariant}`} action={action} variant={safeVariant}>{children}</HabitatCelebration>
      : <><div className="pet-idle"><div className="pet-action-motion" key={`${sequence}-${action}`}>{children}</div></div>
        <ActionEffects key={`${sequence}-${action}-effects`} action={action} variant={safeVariant}/></>}
  </div>;
}
