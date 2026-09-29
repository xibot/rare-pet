export type CelebrationAction = 'play' | 'launch';
export const CELEBRATION_DURATION_MS = 2400;
export const CELEBRATION_FRAME_MS = 50;
export const CELEBRATION_FRAMES = CELEBRATION_DURATION_MS / CELEBRATION_FRAME_MS;
export const CELEBRATION_VIEW_SIZE = 235;

export function celebrationPose(action: CelebrationAction, variant: number, size: number): string {
  const [dx, dy, angle] = action === 'play'
    ? [[-8, -12, -6], [8, -18, 6], [0, -28, -2]][variant]
    : [[-3, -10, -3], [7, -18, 4], [-5, -25, -4]][variant];
  return `translate(${dx * size / 235} ${dy * size / 235}) rotate(${angle} ${size / 2} ${size * .92})`;
}

export function celebrationMotion(action: CelebrationAction, size: number, phase?: number): string {
  const wave = phase === undefined ? 0 : Math.sin(phase * Math.PI * 2);
  const bounce = phase === undefined ? 0 : (1 - Math.cos(phase * Math.PI * 4)) / 2;
  const hover = phase === undefined ? .5 : (1 - Math.cos(phase * Math.PI * 2)) / 2;
  return action === 'play'
    ? `translate(${size * wave * .023} ${-size * bounce * .045}) rotate(${wave * 4} ${size / 2} ${size * .92})`
    : `translate(${size * wave * .012} ${-size * (.018 + hover * .075)}) rotate(${wave * 2.5} ${size / 2} ${size * .92})`;
}

export function celebrationSpriteFrame(variant: number, phase?: number): number {
  return phase === undefined ? variant * 2 : Math.floor(phase * 16) % 8;
}
