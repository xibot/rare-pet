import { useId } from 'react';

type Direction = 'up' | 'down';
type TrackGateProps = {
  direction: Direction;
  /** Centre of the physical opening in the horizontal world. */
  x: number;
  /** Seconds, matching the arcade engine clock. */
  elapsed: number;
  strength?: number;
  reducedMotion?: boolean;
  width?: number;
  /** An exit exhales along the same duct instead of drawing the Friend in. */
  flow?: 'in' | 'out';
};

const lime = '#ccff00';
const modulo = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function Fan({ x, y, angle }: { x: number; y: number; angle: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <rect x="-26" y="-26" width="52" height="52" fill="#000" stroke="#fff" strokeWidth="2" />
    <circle r="22" fill="#000" stroke="#fff" strokeWidth="1" />
    <g transform={`rotate(${angle})`} fill={lime}>
      {[0, 90, 180, 270].map(a => <path key={a} transform={`rotate(${a})`} d="M-3-5V-19H7L12-13L4-4Z" />)}
    </g>
    <rect x="-4" y="-4" width="8" height="8" fill="#fff" stroke="#000" strokeWidth="1" />
  </g>;
}

/** A world-space junction. Render after the horizontal world and before sprites.
 * The opaque floor cut actually removes the track beneath a falling Friend;
 * nothing in this component fades the scene or rotates the player's controls. */
export function TrackGate({ direction, x, elapsed, strength = 1, reducedMotion = false, width = 320, flow = 'in' }: TrackGateProps) {
  const id = `track-gate-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const up = direction === 'up';
  const half = clamp(width, 200, 520) / 2;
  const power = clamp(strength, 0, 1);
  const clock = reducedMotion ? 0 : elapsed;
  const flowSign = flow === 'in' ? 1 : -1;
  const fanAngle = clock * (240 + power * 520) * flowSign;
  const streamOffset = -clock * (140 + power * 240) * flowSign;

  return <g aria-hidden="true" data-track-gate={direction} data-flow={flow} transform={`translate(${x} 0)`}>
    <defs>
      <pattern id={`${id}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="#fff" />
        <path d="M-2 2L2-2M0 8L8 0M6 10L10 6" stroke="#000" strokeWidth="2" />
      </pattern>
      <pattern id={`${id}-dots`} width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill="#fff" />
        <path d="M0 0h1v1H0ZM2 2h1v1H2Z" fill="#000" />
      </pattern>
    </defs>

    {up ? <g>
      {/* A ceiling-mounted duct runs beyond the frame: an actual route above. */}
      <path data-gate-opening="ceiling" d={`M${-half - 22} -20H${half + 22}V52H${half + 10}V83H${half - 8}V101H${-half + 8}V83H${-half - 10}V52H${-half - 22}Z`} fill="#000" stroke="#fff" strokeWidth="3" />
      <path d={`M${-half - 14} -20V49H${-half - 2}V79H${half + 2}V49H${half + 14}V-20`} fill="none" stroke="#fff" strokeWidth="1" />
      <path d={`M${-half - 21} 51H${-half - 3}V80H${half + 3}V51H${half + 21}V88H${half + 4}V106H${-half - 4}V88H${-half - 21}Z`} fill={`url(#${id}-hatch)`} stroke="#000" strokeWidth="2" />
      <rect x={-half + 16} y="73" width={half * 2 - 32} height="9" fill="#000" />
      <path d={`M${-half + 28} 91H${-half + 60}M${half - 60} 91H${half - 28}`} stroke={lime} strokeWidth="5" />
      <path d={`M${-half - 42} 0V35H${-half - 22}M${half + 42} 0V35H${half + 22}`} fill="none" stroke="#fff" strokeWidth="2" />
      <Fan x={-half + 44} y={29} angle={fanAngle} />
      <Fan x={half - 44} y={29} angle={-fanAngle} />
      <path d={flow === 'in' ? 'M-12 33L0 21L12 33M-12 50L0 38L12 50' : 'M-12 21L0 33L12 21M-12 38L0 50L12 38'} fill="none" stroke={lime} strokeWidth="3" />

      {/* Dashed currents travel along curved paths into the open throat. */}
      <g fill="none" strokeWidth={1.2 + power * .8} strokeDasharray="18 34" strokeDashoffset={streamOffset}>
        {[-1, 1].map(side => <g key={side}>
          <path d={`M${side * (half + 65)} 377Q${side * (half + 30)} 238 ${side * 34} 104`} stroke={lime} />
          <path d={`M${side * (half + 15)} 392Q${side * 110} 273 ${side * 17} 104`} stroke="#fff" />
          <path d={`M${side * 74} 375Q${side * 14} 228 ${side * 4} 104`} stroke="#fff" opacity=".42" />
        </g>)}
      </g>
      {Array.from({ length: 14 }, (_, index) => {
        const t = modulo(clock * (.7 + power * .5) * flowSign + index / 14, 1);
        const side = index % 2 ? 1 : -1;
        const sx = side * (half + 28 + index % 3 * 24) * (1 - t) ** 1.8;
        const sy = 384 - t * 278;
        return <path key={index} d={`M${sx} ${sy}l${-side * (3 + 5 * (1 - t))} -${7 + power * 9}`} fill="none" stroke={index % 3 ? '#fff' : lime} strokeWidth={index % 3 ? 1 : 2} />;
      })}
    </g> : <g>
      {/* Remove the real running surface, verge and slab. Broken white ends
          remain attached to the level, rather than floating over its floor. */}
      <path data-gate-opening="floor" d={`M${-half} 345H${half}V520H${-half}Z`} fill="#000" />
      <path d={`M${-half - 18} 350H${-half + 10}V363H${-half - 2}V379H${-half + 16}V391H${-half - 9}V401H${-half - 18}Z`} fill={`url(#${id}-dots)`} stroke="#000" strokeWidth="2" />
      <path d={`M${half + 18} 350H${half - 15}V362H${half + 2}V377H${half - 11}V388H${half + 7}V401H${half + 18}Z`} fill={`url(#${id}-dots)`} stroke="#000" strokeWidth="2" />
      <path d={`M${-half - 19} 403H${-half + 3}V415H${-half - 11}V433H${-half - 3}V448H${-half - 19}M${half + 19} 403H${half - 5}V414H${half + 10}V435H${half + 2}V451H${half + 19}`} fill="#000" stroke="#fff" strokeWidth="2" />
      <path d={`M${-half - 20} 407H${-half}V415H${-half - 20}ZM${half} 407H${half + 20}V415H${half}Z`} fill={`url(#${id}-hatch)`} />
      <path d={`M${-half - 8} 450V500M${half + 8} 450V500`} stroke="#fff" strokeWidth="2" />
      <path d={`M${-half + 12} 458l12 ${12 * flowSign} 12 ${-12 * flowSign}M${half - 36} 458l12 ${12 * flowSign} 12 ${-12 * flowSign}`} fill="none" stroke={lime} strokeWidth="3" />

      <g fill="none" strokeDasharray="18 34" strokeDashoffset={streamOffset} strokeWidth={1.2 + power * .8}>
        {[-1, 1].map(side => <g key={side}>
          <path d={`M${side * (half + 32)} 274Q${side * (half - 18)} 305 ${side * 40} 500`} stroke={lime} />
          <path d={`M${side * (half - 40)} 254Q${side * 72} 340 ${side * 18} 500`} stroke="#fff" />
          <path d={`M${side * 44} 246Q${side * 26} 390 ${side * 4} 500`} stroke="#fff" opacity=".42" />
        </g>)}
      </g>
      {/* Tiny attached-platform fragments tumble down, not toward the runner. */}
      {Array.from({ length: 10 }, (_, index) => {
        const t = modulo(clock * (.55 + power * .9) + index / 10, 1);
        const side = index % 2 ? 1 : -1;
        const sx = side * (half - 13 - t * (36 + index % 4 * 12));
        const sy = 366 + t * 182;
        const size = 3 + index % 3 * 2;
        return <g key={index} transform={`translate(${sx} ${sy}) rotate(${(reducedMotion ? 0 : clock * 80) + index * 35})`}>
          <path d={`M${-size} -3H${size}V2H0V5H${-size}Z`} fill={index % 4 ? '#fff' : lime} />
        </g>;
      })}
    </g>}
  </g>;
}

type ShaftMouthProps = { direction: Direction; elapsed: number; reducedMotion?: boolean; width?: number };

/** Entry lip on a vertical world tile. Up arrives through the bottom edge;
 * down arrives through the top. The caller scrolls this world-space tile away. */
export function ShaftMouth({ direction, elapsed, reducedMotion = false, width = 320 }: ShaftMouthProps) {
  const id = `shaft-mouth-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const up = direction === 'up';
  const offset = reducedMotion ? 0 : -elapsed * 190;
  const half = clamp(width, 200, 520) / 2;
  // Keep the lower edges registered to the shaft walls while varying the neck.
  const left = (x: number) => 104 + (x - 104) * (376 - half) / 216;
  const right = (x: number) => 960 - left(x);
  const edge = (point: typeof left) => `M${point(320)} 0V18H${point(296)}V38H${point(268)}V59H${point(240)}V82H${point(212)}V103H${point(180)}V125H${point(144)}V148H${point(104)}V164`;
  const lining = (point: typeof left) => `M${point(310)} 0V10H${point(286)}V30H${point(258)}V51H${point(230)}V74H${point(202)}V95H${point(170)}V117H${point(134)}V140H${point(96)}V164`;
  const markers = (point: typeof left) => `M${point(300)} 36H${point(290)}M${point(256)} 78H${point(244)}M${point(204)} 120H${point(192)}`;
  return <g aria-hidden="true" data-shaft-mouth={direction} transform={up ? 'translate(0 500) scale(1 -1)' : undefined}>
    <defs>
      <pattern id={`${id}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="#fff" />
        <path d="M-2 2L2-2M0 8L8 0M6 10L10 6" stroke="#000" strokeWidth="2" />
      </pattern>
    </defs>
    {/* The narrow horizontal opening flares into the wide vertical track.
        Opaque corners cover only the masonry, leaving its central passage open. */}
    <path d={`${edge(left)}H0V0ZM960 0H${480 + half}${edge(right).replace(/^M[^V]+/, '')}H960Z`} fill="#000" />
    <path d={`${edge(left)}${edge(right)}`} fill="none" stroke="#fff" strokeWidth="3" />
    <path d={`${lining(left)}${lining(right)}`} fill="none" stroke={`url(#${id}-hatch)`} strokeWidth="8" />
    <path d={`${markers(left)}${markers(right)}`} stroke={lime} strokeWidth="4" />
    <g fill="none" stroke={lime} strokeWidth="2" strokeDasharray="15 30" strokeDashoffset={offset}>
      <path d={`M${480 - half + 29} -10Q${left(300)} 62 160 158M${480 + half - 29} -10Q${right(300)} 62 800 158`} />
    </g>
  </g>;
}
