import { renderProp, type WorldPropType } from '@rarefriends/friendsdk/world';

/** The SDK's unmodified monochrome prop paths, cropped to their visible bounds. */
const PROP_BOUNDS = {
  crystal: '-41 -96 90 106',
  crate: '-29 -41 58 52',
  bridge: '-51 -35 103 53',
  terminal: '-25 -67 54 80',
  circuit: '-43 -41 88 48',
} as const;
type RunnerProp = keyof typeof PROP_BOUNDS;
const PROP_IMAGES = Object.fromEntries(Object.entries(PROP_BOUNDS).map(([name, bounds]) => {
  const source = renderProp(name as WorldPropType).replace('viewBox="-120 -180 240 240"', `viewBox="${bounds}"`);
  return [name, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`];
})) as Record<RunnerProp, string>;

export function CanonicalProp({ type, x, y, width, height }: { type: RunnerProp; x: number; y: number; width: number; height: number }) {
  return <image data-canonical-prop={type} href={PROP_IMAGES[type]} x={x} y={y} width={width} height={height} preserveAspectRatio="none"/>;
}

/** Unmodified coin paths from https://rarefriends.com/art/token.svg. */
const TOKEN_EDGE = 'M-28-58H28V-52H40V-42H50V-28H56V28H50V42H40V52H28V58H-28V52H-40V42H-50V28H-56V-28H-50V-42H-40V-52H-28Z';
export function TokenCoin({ x = 0, y = 0, size = 30, phase = 0 }: { x?: number; y?: number; size?: number; phase?: number }) {
  const turn = .65 + Math.abs(Math.cos(phase)) * .35;
  return <svg x={x} y={y} width={size} height={size} viewBox="-65 -65 130 130" aria-hidden="true" data-token-design="1" data-canonical-face="08">
    <g shapeRendering="crispEdges" transform={`scale(${turn} 1)`}>
      <path d={TOKEN_EDGE} transform="translate(5 4)" fill="#000" stroke="#fff" strokeWidth="2"/>
      <path d={TOKEN_EDGE} fill="#fff" stroke="#000" strokeWidth="4"/>
      <path d={TOKEN_EDGE} transform="scale(.85)" fill="#000"/>
      <path d="M-24-43H24M-43-22V22M43-22V22M-24 43H24" fill="none" stroke="#fff" strokeWidth="2"/>
      <g transform="translate(-36 -36) scale(9)"><rect width="8" height="8" fill="#000"/><path d="M1 1h1v1h-1zM2 1h1v1h-1zM5 1h1v1h-1zM6 1h1v1h-1zM1 2h1v1h-1zM2 2h1v1h-1zM3 2h1v1h-1zM4 2h1v1h-1zM5 2h1v1h-1zM6 2h1v1h-1zM1 3h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM6 3h1v1h-1zM1 4h1v1h-1zM2 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM6 5h1v1h-1zM3 6h1v1h-1zM4 6h1v1h-1z" fill="#fff"/></g>
      <rect x="-36" y="-40" width="6" height="6" fill="#ccff00"/>
    </g>
  </svg>;
}

/** Original Rare Friends currency glyph from FriendSDK signalArtwork(). */
export function CurrencyGlyph({ x = 0, y = 0, size = 24, phase = 0 }: { x?: number; y?: number; size?: number; phase?: number }) {
  const scaleX = .8 + Math.abs(Math.cos(phase)) * .2;
  return <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 30" aria-hidden="true" data-canonical-glyph="currency">
    <g transform={`translate(12 0) scale(${scaleX} 1) translate(-12 0)`}>
      <path d="M250 500L250 625L375 625L375 750L500 750L500 625L625 625L625 500ZM250 -125L250 0L125 0L125 125L500 125L500 250L250 250L250 375L125 375L125 500L250 500L250 375L500 375L500 250L625 250L625 125L500 125L500 0L375 0L375 -125Z" transform="translate(0 25) scale(.032 -.032)" fill="#CCFF00" stroke="#000000" strokeWidth="62.5" paintOrder="stroke"/>
    </g>
  </svg>;
}
