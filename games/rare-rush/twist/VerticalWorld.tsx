import { useId } from 'react';
import { CanonicalProp } from '../CanonicalArt';

type VerticalWorldProps = {
  phase: 'up' | 'down';
  /** Milliseconds, matching the arcade world's animation clock. */
  elapsed: number;
  /** Cumulative run distance in meters. */
  distance: number;
  reducedMotion?: boolean;
};

const positiveModulo = (value: number, period: number) => ((value % period) + period) % period;

/** Decorative shaft only. The arcade engine owns every coin, obstacle and collision. */
export function VerticalWorld({ phase, elapsed, distance, reducedMotion = false }: VerticalWorldProps) {
  const id = `direction-shaft-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const up = phase === 'up';
  const travel = reducedMotion ? 0 : Math.max(0, distance) * 6;
  const direction = up ? 1 : -1;
  const wallOffset = positiveModulo(travel * direction, 176);
  const farOffset = positiveModulo(travel * direction * .3, 260);
  const airOffset = positiveModulo(travel * direction * 1.4, 132);
  const currentOffset = positiveModulo(travel * direction * 1.4, 88);
  const light = reducedMotion ? .42 : .35 + Math.sin(elapsed * .0015) * .09;

  return <g aria-hidden="true" data-world-direction={phase}>
    <defs>
      <clipPath id={`${id}-frame`}><rect width="960" height="500" /></clipPath>
      <clipPath id={`${id}-walls`}>
        <rect width="102" height="500" />
        <rect x="858" width="102" height="500" />
      </clipPath>
      <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform={`translate(0 ${wallOffset})`}>
        <rect width="7" height="7" fill="#fff" />
        <path d="M-1 1l2-2M0 7L7 0M6 8l2-2" stroke="#000" fill="none" />
      </pattern>
      <pattern id={`${id}-dither`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform={`translate(0 ${wallOffset})`}>
        <rect width="4" height="4" fill="#fff" />
        <path d="M0 0h1v1H0zM2 2h1v1H2z" fill="#000" />
      </pattern>
      <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="#ccff00" stopOpacity="0" />
        <stop offset=".5" stopColor="#ccff00" stopOpacity={up ? '.045' : '.015'} />
        <stop offset="1" stopColor="#ccff00" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-air`} gradientUnits="userSpaceOnUse" x1="0" y1={up ? '500' : '0'} x2="0" y2={up ? '0' : '500'}>
        <stop stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#fff" stopOpacity=".22" />
      </linearGradient>
    </defs>

    <g clipPath={`url(#${id}-frame)`}>
      <rect width="960" height="500" fill="#000" />
      <rect x="108" width="744" height="500" fill={`url(#${id}-beam)`} />

      {/* Long, faint perspective lines suggest depth without hiding the route. */}
      <g stroke="#fff" fill="none" strokeWidth="1" opacity=".07">
        <path d={up ? 'M108 500L198 0M852 500L762 0' : 'M108 0L198 500M852 0L762 500'} />
        <path d={up ? 'M158 500L240 0M802 500L720 0' : 'M158 0L240 500M802 0L720 500'} />
      </g>
      <g stroke="#fff" fill="none" strokeWidth="1" opacity=".12">
        {Array.from({ length: 4 }, (_, index) => {
          const y = index * 260 - 260 + farOffset;
          return <g key={`depth-${index}`}>
            <path d={`M110 ${y}l48 ${up ? -30 : 30}v72M850 ${y}l-48 ${up ? -30 : 30}v72`} />
          </g>;
        })}
      </g>

      {/* No prop extends into the playable shaft. The original SDK line art
          reads as machinery embedded in the passing walls. */}
      <g clipPath={`url(#${id}-walls)`}>
        <rect width="102" height="500" fill="#050505" />
        <rect x="858" width="102" height="500" fill="#050505" />
        {Array.from({ length: 5 }, (_, index) => {
          const y = index * 176 - 176 + wallOffset;
          const rightY = y + 64;
          return <g key={`wall-${index}`}>
            <path d={`M0 ${y}H82V${y + 176}H0M878 ${rightY}H960M878 ${rightY}V${rightY + 176}H960`} fill="none" stroke="#fff" strokeWidth="1" />
            <path d={`M0 ${y + 16}H32V${y + 98}H0M960 ${rightY + 18}H928V${rightY + 124}H960`} stroke="#fff" fill="none" strokeWidth="1" />
            <path d={`M0 ${y + 133}H83V${y + 145}H0ZM877 ${rightY + 140}H960V${rightY + 152}H877Z`} fill={`url(#${id}-hatch)`} />
            <CanonicalProp type={up ? 'terminal' : 'crystal'} x={37} y={y + 28} width={40} height={62} />
            <CanonicalProp type={up ? 'circuit' : 'terminal'} x={884} y={rightY + 38} width={40} height={up ? 28 : 60} />
            <g stroke="#fff" fill="none" strokeWidth="1">
              <path d={`M46 ${y + 110}h20M56 ${y + 107}v6M888 ${rightY + 112}h26M901 ${rightY + 109}v6`} />
              <path d={`M13 ${y + 39}v18M21 ${y + 74}v6M946 ${rightY + 42}v18M938 ${rightY + 90}v6`} />
            </g>
            <path d={`M46 ${y + 161}h12M890 ${rightY + 162}h12`} stroke="#ccff00" strokeWidth="3" />
          </g>;
        })}
      </g>

      {/* The wall treatment mirrors the arcade's white verge and hatched slab. */}
      <rect x="84" width="8" height="500" fill={`url(#${id}-dither)`} />
      <rect x="94" width="8" height="500" fill={`url(#${id}-hatch)`} />
      <rect x="858" width="8" height="500" fill={`url(#${id}-hatch)`} />
      <rect x="868" width="8" height="500" fill={`url(#${id}-dither)`} />
      <path d="M104 0V500M856 0V500" stroke="#fff" strokeWidth="2" />
      <path d="M110 0V500M850 0V500" stroke="#fff" strokeWidth="1" opacity=".35" />

      {/* Air moves opposite the player. These thin streaks are intentionally
          unlike the solid sprites used for coins and collision geometry. */}
      {!reducedMotion && <g stroke={`url(#${id}-air)`} fill="none" strokeWidth="1">
        {Array.from({ length: 6 }, (_, index) => {
          const y = index * 132 - 132 + airOffset;
          return <g key={`air-${index}`}>
            <path d={`M206 ${y}v${up ? -42 : 42}M754 ${y + 66}v${up ? -52 : 52}`} />
            <path d={`M306 ${y + 31}v${up ? -18 : 18}M654 ${y + 99}v${up ? -24 : 24}`} opacity=".4" />
          </g>;
        })}
      </g>}
      <g stroke="#ccff00" fill="none" strokeWidth="1.5" opacity={light}>
        {Array.from({ length: 7 }, (_, index) => {
          const y = index * 88 - 88 + currentOffset;
          const tip = up ? -7 : 7;
          return <g key={`current-${index}`}>
            <path d={`M123 ${y}l6 ${tip}l6 ${-tip}M825 ${y + 44}l6 ${tip}l6 ${-tip}`} />
          </g>;
        })}
      </g>
    </g>
  </g>;
}
