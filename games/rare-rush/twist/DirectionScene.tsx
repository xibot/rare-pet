import { useId, useRef, type ReactNode } from 'react';
import { WorldArt } from '../WorldArt';
import { EntityArt } from '../RunnerArt';
import { VerticalWorld } from './VerticalWorld';
import { TrackGate, ShaftMouth } from './TrackGate';
import type { MapTransition, Phase, RunState } from './engine';
import { continuousSpin } from './transition-motion';
import {headingFor,projectX,phaseTransform,presentationGeometry,characterFacing,type Heading} from './presentation';

type DirectionSceneProps = {
  run: RunState;
  reducedMotion?: boolean;
  running: boolean;
  biome: number;
  growth: number;
  renderCharacter: (frame: number, walking: boolean) => ReactNode;
  viewportWidth: number;
  reverseExits?: boolean;
};

/** Arcade renderer: one connected map, with the original character assets and HUD. */
export function DirectionScene({ run: r, reducedMotion = false, running, biome, growth, renderCharacter, viewportWidth, reverseExits = true }: DirectionSceneProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const last = useRef<{ travel: MapTransition; fromDistance: number; key: number; index:number } | null>(null);
  if (r.elapsed === 0) last.current = null;
  const localDistance = Math.max(0, r.distance - r.phaseDistanceOrigin);
  const tr = r.transition;
  if (tr) {
    if (last.current?.key !== r.phaseEnteredAt) last.current = { travel: tr, fromDistance: tr.fromLocalDistance, key: r.phaseEnteredAt, index:r._phaseIndex };
    else last.current.travel = tr;
  }
  const arrival = last.current?.travel.to === r.phase ? last.current : null;
  const heading=headingFor(r,r._phaseIndex,reverseExits),fromHeading=headingFor(r,r._phaseIndex-1,reverseExits);
  const arrivalFromHeading=arrival?headingFor(r,arrival.index-1,reverseExits):1;
  const arrivalToHeading=arrival?headingFor(r,arrival.index,reverseExits):1;
  const arrivalGeometry=arrival?presentationGeometry(arrival.travel,arrivalFromHeading,arrivalToHeading):null;
  const geometry = tr ? presentationGeometry(tr,fromHeading,heading) : null;
  const p = r.player;
  const player = geometry?.player ?? { x: projectX(p.x,p.w,r.phase,heading), y: p.y };
  const facing=characterFacing(r,reverseExits,reducedMotion);
  const t = tr?.progress ?? 0;
  const eased = t * t * (3 - 2 * t);
  const shake = !reducedMotion && tr ? Math.sin(t * Math.PI) * 2.8 : 0;
  const shakeX = Math.sin(r.elapsed * 95) * shake;
  const shakeY = Math.cos(r.elapsed * 77) * shake * .55;
  const scale = 4 * growth;
  const stretch = !reducedMotion && tr ? Math.sin(t * Math.PI) * .15 : 0;
  const sx = scale * (1 - stretch * .35);
  // A crouched Friend opens out while being pulled in, without snapping upright
  // on the first transition frame when the engine switches to its shaft pose.
  const fromScaleY = tr?.fromPlayer.height === 28 ? 2 : scale;
  const toScaleY = tr?.toPlayer.height === 28 ? 2 : scale;
  const sy = tr ? (fromScaleY + (toScaleY - fromScaleY) * eased) * (1 + stretch)
    : p.slide && r.phase === 'side' ? 2 : scale;
  const spin = continuousSpin(r, reducedMotion);
  const centerX = player.x + p.w / 2;
  const centerY = player.y - 7 * sy;
  const friendHeight = 15 * sy;
  // A narrow screen begins with the original horizontal crop. The connected
  // camera opens out during suction, keeping the whole steerable shaft visible.
  // Uniform scaling preserves square pixels; the surrounding canvas stays black.
  const verticalView = tr ? (tr.from === 'side' ? eased : 1 - eased) : r.phase === 'side' ? 0 : 1;
  const cameraScale = 1 + (Math.min(1, viewportWidth / 960) - 1) * verticalView;
  const cameraY = (500 - 500 * cameraScale) / 2;
  // Mirror the narrow horizontal crop too, so left-running Friends remain in
  // view. Interpolate into the full shaft view through the same connected turn.
  const horizontalHeading = tr?.from === 'side' ? fromHeading : heading;
  const cameraX = horizontalHeading === -1 ? (viewportWidth - 960) * (1 - verticalView) : 0;
  const characterOpacity = r.invulnerable > 0 && !tr && r.transitionGrace <= 0
    ? (reducedMotion ? .65 : Math.floor(r.elapsed * 12) % 2 ? .4 : 1) : 1;

  function entities(items: RunState['entities'], phase = r.phase, direction = heading) {
    return items.filter(entity => !entity.collected).map(entity => <g key={entity.id} opacity={entity.hit ? .35 : 1}>
      <EntityArt entity={entity} elapsed={r.elapsed} reduced={reducedMotion} mirrored={phase === 'side' && direction === -1}/>
    </g>);
  }
  function project(phase:Phase,direction:Heading,children:ReactNode){
    return <g data-projected-heading={phase==='side'?direction:1} transform={phaseTransform(phase,direction)}>{children}</g>;
  }
  function horizontal(distance: number, label: string) {
    const worldId = `side-world-${id}-${label}`;
    return <>
      <defs>
        <clipPath id={`${worldId}-clip`}><rect x="-960" width="2880" height="500"/></clipPath>
        <g id={worldId}><WorldArt distance={distance} elapsed={r.elapsed * 1000} reducedMotion={reducedMotion} biome={biome}/></g>
      </defs>
      <g clipPath={`url(#${worldId}-clip)`}><use href={`#${worldId}`} x="-960"/><use href={`#${worldId}`}/><use href={`#${worldId}`} x="960"/></g>
    </>;
  }
  function world(phase: Phase, distance: number, label: string) {
    return phase === 'side' ? horizontal(distance, label)
      : <VerticalWorld phase={phase} elapsed={r.elapsed * 1000} distance={distance} reducedMotion={reducedMotion}/>;
  }
  function exitMouth(phase: Phase, remaining = 0) {
    if (phase === 'side') return null;
    const offset = Math.max(0, remaining) / 1.4 * 230 * (phase === 'up' ? -1 : 1);
    return <g data-exit-mouth={phase} transform={`translate(0 ${offset})`}>
      <ShaftMouth direction={phase === 'up' ? 'down' : 'up'} elapsed={r.elapsed} width={200} reducedMotion={reducedMotion}/>
    </g>;
  }
  function destinationGate(travel: MapTransition, travelPixels = 0) {
    return travel.to === 'side'
      ? <TrackGate direction={travel.from === 'up' ? 'down' : 'up'} x={80 - travelPixels} width={200} elapsed={r.elapsed} strength={.7} reducedMotion={reducedMotion} flow="out"/>
      : <g transform={`translate(0 ${travelPixels * (travel.to === 'up' ? 1 : -1)})`}>
        <ShaftMouth direction={travel.to} elapsed={r.elapsed} reducedMotion={reducedMotion} width={320}/>
      </g>;
  }

  return <g data-scene="connected-track" data-heading={r.phase==='side'?heading:0} data-transition={tr ? `${tr.from}-${tr.to}` : 'none'} data-transition-progress={tr?.progress ?? 0} data-camera-scale={cameraScale} data-camera-x={cameraX}>
    <rect width={viewportWidth} height="500" fill="#000"/>
    <g transform={`translate(${cameraX} ${cameraY}) scale(${cameraScale})`}>
      <g transform={`translate(${shakeX} ${shakeY})`}>
        {tr && geometry ? <g transform={`translate(${-geometry.camera.x} ${-geometry.camera.y})`}>
          <g data-chunk="outgoing">
            {project(tr.from,fromHeading,<>
            {world(tr.from, last.current!.fromDistance, 'outgoing')}
            {exitMouth(tr.from)}
            {entities(tr.fromEntities, tr.from, fromHeading)}
            {tr.from === 'side' && <TrackGate direction={tr.to as 'up' | 'down'} x={tr.gateX} width={320} elapsed={r.elapsed} strength={1} reducedMotion={reducedMotion}/>}
            </>)}
          </g>
          <g data-chunk="incoming" transform={`translate(${geometry.origin.x} ${geometry.origin.y})`}>
            {project(tr.to,heading,<>
            {world(tr.to, 0, 'incoming')}
            {destinationGate(tr)}
            </>)}
          </g>
        </g> : <>
          {project(r.phase,heading,<>{world(r.phase, localDistance, 'active')}
          {r.phase !== 'side' && r.phasePlan[r._phaseIndex + 1]?.phase === 'side' && r.phasePlan[r._phaseIndex].end - r.elapsed <= 1.4 && exitMouth(r.phase, r.phasePlan[r._phaseIndex].end - r.elapsed)}
          </>)}
          {arrival && localDistance * 10 < 1000 && <>
            {project(r.phase,heading,destinationGate(arrival.travel, localDistance * 10))}
            <g transform={`translate(${-arrivalGeometry!.origin.x - (r.phase === 'side' ? heading * localDistance * 10 : 0)} ${-arrivalGeometry!.origin.y + (r.phase === 'side' ? 0 : localDistance * 10 * (r.phase === 'up' ? 1 : -1))})`}>
              {project(arrival.travel.from,arrivalFromHeading,<>
              {world(arrival.travel.from, arrival.fromDistance, 'departed')}
              {exitMouth(arrival.travel.from)}
              {arrival.travel.from === 'side' && <TrackGate direction={arrival.travel.to as 'up' | 'down'} x={arrival.travel.gateX} width={320} elapsed={r.elapsed} strength={1} reducedMotion={reducedMotion}/>}
              </>)}
            </g>
          </>}
          {project(r.phase,heading,<>{entities(r.entities)}
          {r.gate && <TrackGate direction={r.gate.direction} x={r.gate.x} width={320} elapsed={r.elapsed} strength={.55 + r.gate.progress * .45} reducedMotion={reducedMotion}/>}
          </>)}
        </>}
        {r.phase !== 'side' && !tr && !reducedMotion && <g stroke="#ccff00" fill="none" strokeWidth="2">
          {[0, 1, 2].map(i => <path key={i} d={r.phase === 'up' ? `M${player.x + 3 + i * 15} ${player.y + 20 + i % 2 * 15}v${32 + i * 6}` : `M${player.x + 3 + i * 15} ${player.y - 92 - i % 2 * 15}v-${32 + i * 6}`}/>)}
        </g>}
        <g opacity={characterOpacity}>
          {r.phase === 'side' && !tr && <ellipse cx={centerX} cy="403" rx={32 * growth} ry="3" fill="#000"/>}
          {r.magnet > 0 && <circle cx={centerX} cy={player.y - friendHeight / 2} r={58 * growth} fill="none" stroke="#CCFF00" strokeDasharray="3 10"/>}
          {r.shield > 0 && <rect x={centerX - 38 * growth} y={player.y - friendHeight - 10} width={76 * growth} height={friendHeight + 16} fill="none" stroke="#CCFF00" strokeWidth="2"/>}
          <g data-body-turn="true" transform={`rotate(${spin} ${centerX} ${centerY})`}>
            <g data-character="friend" data-slide={p.slide} data-growth={r.growth.toFixed(3)} data-screen-x={player.x} data-screen-y={player.y} data-spin={spin} transform={`translate(${centerX - 8 * sx} ${player.y - 15 * sy}) scale(${sx} ${sy})`}>
              <g data-facing={facing} transform={`translate(8 0) scale(${facing} 1) translate(-8 0)`}>{renderCharacter(reducedMotion ? 0 : Math.floor(r.elapsed * 12) % 8, running && r.phase === 'side' && p.grounded && !p.slide && !tr)}</g>
            </g>
          </g>
        </g>
      </g>
    </g>
  </g>;
}
