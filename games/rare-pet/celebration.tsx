import type { ReactNode } from 'react';

import type { CelebrationAction } from './celebration-motion';
export * from './celebration-motion';

export function Spark() { return <svg viewBox="0 0 12 12"><path d="M5 0H7V4H9V5H12V7H8V9H7V12H5V8H3V7H0V5H4V3H5Z" fill="currentColor"/></svg>; }

function Glyph({ x, y, size, color, children }: {
  x: number; y: number; size: number; color?: string; children: ReactNode;
}) {
  return <svg x={x} y={y} width={size} height={size} overflow="visible" color={color} data-share-slot="glyph">{children}</svg>;
}

/** Canonical visual sequence shared by the habitat and still/GIF exports. */
export function CelebrationEffects({ action, variant, size, phase }: {
  action: CelebrationAction; variant: number; size: number; phase?: number;
}) {
  const wave = (offset = 0) => phase === undefined ? 0 : Math.sin(phase * Math.PI * 2 + offset);
  if (action === 'play') {
    const [x, y, tilt] = [[.8, .6, -8], [-.15, .52, 9], [.78, .38, -5]][variant];
    return <g data-share-reaction="play">
      <g transform={`translate(${size * (x + wave() * .016)} ${size * (y + wave() * .04)}) rotate(${tilt + wave() * 4} ${size * .17} ${size * .12})`}>
        <svg width={size * .34} height={size * .255} viewBox="0 0 32 24" shapeRendering="crispEdges">
          <path d="M6 3H26V5H29V8H31V21H23V18H9V21H1V8H3V5H6Z" fill="#fff"/>
          <path d="M7 6H25V8H28V18H25V15H7V18H4V9H7Z" fill="#10110e"/>
          <path d="M8 8H11V11H14V14H11V17H8V14H5V11H8Z" fill="#ccff00"/>
          <rect x="21" y="8" width="3" height="3" fill="#ccff00" opacity={phase === undefined ? 1 : .65 + wave() * .35}/>
          <rect x="25" y="12" width="3" height="3" fill="#ccff00" opacity={phase === undefined ? 1 : .65 - wave() * .35}/>
          <path d="M15 13H18V15H15Z" fill="#fff"/>
        </svg>
      </g>
      {[[-.1, .16, .095], [.86, -.06, .085], [1.05, .3, .065], [.06, .7, .075], [.57, -.16, .065]].map(([x, y, s], index) =>
        <Glyph key={index} x={size * (x + wave(index + variant) * .025)} y={size * (y + wave(index * .8 + variant) * .045)} size={size * s * (1 + wave(index) * .2)} color={index % 2 === 0 ? '#ccff00' : '#fff'}><Spark/></Glyph>)}
      {[0, 1, 2].map(index => <rect key={index} x={size * (.25 + index * .26 + wave(index) * .025)} y={size * (.96 - index * .075 + wave(index + 1) * .04)} width={size * .024} height={size * .024} fill="#ccff00" opacity={phase === undefined ? .8 : .55 + wave(index) * .3}/>)}
    </g>;
  }
  if (action === 'launch') {
    const [x, y, tilt] = [[.94, .38, 12], [-.2, .3, -12], [.88, .15, 8]][variant];
    const lift = phase === undefined ? .5 : (1 - Math.cos(phase * Math.PI * 2)) / 2;
    const flame = phase === undefined ? 6 : 5 + Math.round(Math.sin(phase * Math.PI * 8) * 2);
    return <g data-share-reaction="launch">
      <g transform={`translate(${size * (x + wave() * .022)} ${size * (y - lift * .13)}) rotate(${tilt + wave() * 3} ${size * .12} ${size * .22})`}>
        <svg width={size * .24} height={size * .42} viewBox="0 0 24 42" shapeRendering="crispEdges">
          <path d="M11 1H13V3H15V5H17V9H19V22H22V31H17V28H7V31H2V22H5V9H7V5H9V3H11Z" fill="#fff"/>
          <path d="M11 5H13V7H15V10H17V22H7V10H9V7H11Z" fill="#10110e"/>
          <path d="M4 24H6V28H4ZM18 24H20V28H18Z" fill="#10110e"/>
          <path d="M9 11H15V17H9Z" fill="#fff"/><path d="M11 13H13V15H11Z" fill="#ccff00"/>
          <path d="M8 24H16V27H8Z" fill="#10110e"/>
          <path d="M8 29H16V33H8Z" fill="#ccff00"/>
          <rect x="10" y="33" width="4" height={flame} fill="#ccff00"/>
          <path d="M10 29H14V33H10Z" fill="#fff"/>
        </svg>
        {[0, 1, 2].map(index => <rect key={index} x={size * (.06 + index * .05 + wave(index) * .015)} y={size * (.44 + index * .045 + wave(index + 1) * .02)} width={size * .024} height={size * .024} fill="#ccff00" opacity={phase === undefined ? .75 : .55 + wave(index) * .3}/>)}
      </g>
      {[[-.08, .08, .085], [.12, .6, .075], [.76, -.09, .09], [.99, .75, .06]].map(([x, y, s], index) =>
        <Glyph key={index} x={size * (x + wave(index + variant) * .02)} y={size * (y + wave(index) * .04)} size={size * s * (1 + wave(index) * .18)} color={index % 2 === 0 ? '#ccff00' : '#fff'}><Spark/></Glyph>)}
    </g>;
  }
  return null;
}

