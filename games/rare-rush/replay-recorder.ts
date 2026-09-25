import { createRun, jump, setSliding, setPace, stepRun, FIXED_STEP, type Pace, type RunState } from './twist/engine.ts';
import { canonicalAxis, headingFor } from './twist/presentation.ts';
import type { Difficulty } from './difficulty.ts';
import type { PublicReplay } from '../../shared/replay-publication.ts';

export type HumanRecording = {
  run: RunState;
  frames: PublicReplay['inputs']['frames'];
  slide: boolean;
  pendingJumps: number;
};

export function createHumanRecording(seed: string, difficulty: Difficulty): HumanRecording {
  if (!/^0x[0-9a-f]{64}$/i.test(seed)) throw new Error('A complete recording requires a fixed hexadecimal seed.');
  return { run: createRun(seed.toLowerCase(), difficulty), frames: [], slide: false, pendingJumps: 0 };
}

export function queueHumanJump(recording: HumanRecording): void {
  if (recording.run.status === 'running') recording.pendingJumps = Math.min(2, recording.pendingJumps + 1);
}

export function releaseHumanControls(recording: HumanRecording): void {
  recording.slide = false; recording.pendingJumps = 0;
}

/** Controls are applied only here, in the published V2 order. Held screen arrows
 * are remapped at each physics tick, including a shaft exit between paint frames. */
export function advanceHumanRecording(recording: HumanRecording, screenAxis: Pace) {
  if (recording.run.status !== 'running') return [];
  const run = recording.run;
  const frame = { tick: run._tick, jump: recording.pendingJumps > 0, slide: recording.slide,
    pace: canonicalAxis(screenAxis, run.phase, headingFor(run)) };
  if (recording.pendingJumps) recording.pendingJumps--;
  recording.frames.push(frame);
  setSliding(run, frame.slide); setPace(run, frame.pace);
  if (frame.jump) jump(run);
  return stepRun(run, FIXED_STEP);
}

export function exportHumanReplay(recording: HumanRecording): PublicReplay {
  if (recording.run.status !== 'finished' || recording.frames.length !== recording.run._tick) {
    throw new Error('Finish the run before publishing its replay.');
  }
  return { version: 'rare-rush-agent-local-v1', finalTick: recording.run._tick,
    inputs: { version: 'rare-rush-input-v2', frames: recording.frames.map(frame => ({ ...frame })) } };
}
