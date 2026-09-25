import { spriteFrame, type GenerationSprites } from '@rarefriends/friendsdk/sprites';
import type { RunState } from './engine';
import { CanonicalProp, TokenCoin } from './CanonicalArt';

export function FriendSprite({ sprites, frame, walking = false }: { sprites: GenerationSprites; frame: number; walking?: boolean }) {
  const rows = spriteFrame(sprites, 'right', walking, frame % 8).frame.rows;
  const halo = rows.map((row, y) => [...row].map((_, x) => {
    for (let yy = Math.max(0, y - 1); yy <= Math.min(15, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(15, x + 1); xx++) if (rows[yy][xx] === '#') return '#';
    }
    return '.';
  }).join(''));
  const path = (pixels: readonly string[]) => pixels.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '#' ? [`M${x} ${y}h1v1h-1z`] : [])).join('');
  return <g shapeRendering="crispEdges"><path d={path(halo)} fill="#FFFFFF"/><path d={path(rows)} fill="#000000"/></g>;
}

export function EntityArt({ entity: e, elapsed, reduced }: { entity: RunState['entities'][number]; elapsed: number; reduced: boolean }) {
  if (e.kind === 'coin') return <TokenCoin x={e.x-3} y={e.y-3} size={e.w+6} phase={reduced ? 0 : elapsed * 4 + e.id}/>;
  if (e.kind === 'bonus') return <g data-bonus-coin={e.id} data-bonus-x={e.x} data-bonus-y={e.y} transform={`translate(${e.x} ${e.y})`}>
    <path d="M53 14h14m-10 10h18M53 34h10M-8-7v8m-4-4h8" fill="none" stroke="#CCFF00" strokeWidth="2" shapeRendering="crispEdges"/>
    <TokenCoin x={-6} y={-6} size={e.w+12} phase={reduced ? 0 : elapsed * 3 + e.id}/>
    <rect x="8" y="-24" width="34" height="16" fill="#CCFF00"/>
    <text x="25" y="-12" textAnchor="middle" fill="#000" fontFamily="var(--rush-font-mono)" fontSize="13" fontWeight="700">10×</text>
  </g>;
  if (e.kind === 'drone') return <g><CanonicalProp type="bridge" x={e.x} y={e.y} width={e.w} height={e.h}/><path d={`M${e.x+e.w/2} ${e.y-16}v10m-4-4l4 4 4-4`} fill="none" stroke="#CCFF00" strokeWidth="2"/></g>;
  if (e.kind === 'shield' || e.kind === 'magnet') return <g transform={`translate(${e.x} ${e.y})`}>
    <rect x="0" y="0" width={e.w} height={e.h} fill="#CCFF00" stroke="#000000" strokeWidth="2"/>
    <text x={e.w/2} y={e.h*.74} textAnchor="middle" fill="#000000" fontSize={e.h*.72} fontWeight="bold">{e.kind === 'shield' ? 'S' : 'M'}</text>
  </g>;
  return <CanonicalProp type={e.kind === 'crystal' ? 'crystal' : 'crate'} x={e.x} y={e.y} width={e.w} height={e.h}/>;
}
