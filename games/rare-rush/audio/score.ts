/** Original Rare Rush compositions. No recordings, samples, or game RNG are used. */
import { circuitMusicStep, riftMusicStep } from './tracks.ts';
export type AudioMode = 'easy' | 'normal' | 'degen';
export type AudioDirection = 'right' | 'up' | 'down' | 'left';
export type ChipVoice = 'pulse' | 'triangle' | 'bell' | 'kick' | 'snare' | 'hat' | 'noise';
export type SoundEffect = 'start' | 'jump' | 'double-jump' | 'slide' | 'coin' | 'rare-coin' | 'hit' | 'shield' | 'magnet' | 'up' | 'down' | 'reverse' | 'world' | 'countdown' | 'win' | 'lose';
export interface ChipNote {
  voice: ChipVoice;
  midi: number;
  endMidi?: number;
  /** Offset and duration in seconds. */
  at: number;
  duration: number;
  volume: number;
  pan: number;
}
export interface MusicScene { world: number; direction: AudioDirection; urgent: boolean }

export const TRACKS = {
  easy: { title: 'Garden Bounce', bpm: 132, root: 60, scale: [0, 2, 3, 5, 7, 9, 10], progression: [0, 3, 5, 4, 0, 3, 1, 4] },
  normal: { title: 'Circuit Chase', bpm: 132, root: 62 },
  degen: { title: 'Breakbeat Rush', bpm: 132, root: 66 },
} as const;

// The approved EASY score is preserved. Its four phrases use scale degrees;
// NORMAL and DEGEN have independent compositions in tracks.ts.
const REST = -99;
const GARDEN_MELODIES = [
    [0,REST,2,REST,4,REST,7,REST,6,REST,4,REST,2,REST,4,REST],
    [0,REST,2,REST,3,REST,4,REST,2,REST,0,REST,1,REST,2,REST],
    [4,REST,7,REST,6,REST,4,REST,2,REST,4,REST,1,REST,REST,REST],
    [3,REST,2,REST,1,REST,0,REST,-1,REST,1,REST,2,REST,4,REST],
] as const;

export const sixteenthSeconds = (mode: AudioMode) => 60 / TRACKS[mode].bpm / 4;
const gardenDegree = (value: number) => {
  const scale = TRACKS.easy.scale;
  return scale[((value % 7) + 7) % 7] + Math.floor(value / 7) * 12;
};
const note = (voice: ChipVoice, midi: number, duration: number, volume: number, pan = 0, at = 0, endMidi?: number): ChipNote =>
  ({ voice, midi, duration, volume, pan, at, ...(endMidi === undefined ? {} : { endMidi }) });

/** One sixteenth of a 16-bar arrangement; callers choose when to schedule it. */
export function musicStep(mode: AudioMode, index: number, scene: MusicScene): ChipNote[] {
  if (mode === 'normal') return circuitMusicStep(index, scene, TRACKS.normal.root, sixteenthSeconds(mode));
  if (mode === 'degen') return riftMusicStep(index, scene, TRACKS.degen.root, sixteenthSeconds(mode));
  const track = TRACKS.easy, tick = Math.floor(index) % 16;
  const bar = Math.floor(index / 16) % 16, chord = track.progression[bar % 8];
  const step = sixteenthSeconds(mode), world = Math.max(0, Math.min(2, scene.world));
  const vertical = scene.direction === 'up' || scene.direction === 'down';
  const breakdown = bar >= 8 && bar < 10 && !scene.urgent;
  const notes: ChipNote[] = [];
  const root = track.root + gardenDegree(chord);
  const melody = GARDEN_MELODIES[bar % 4];
  const melodyTick = scene.direction === 'left' ? 15 - tick : tick;
  const value = melody[melodyTick];

  if (value !== REST && !breakdown) {
    const pitch = track.root + 12 + gardenDegree(chord + value);
    notes.push(note('pulse', pitch, step * 1.65, .17, -.16));
    // Crystal world answers the hook with a quiet, delayed octave sparkle.
    if (world === 2 && tick % 4 === 0) notes.push(note('bell', pitch + 12, step * 1.25, .048, .38, step * .65));
  }

  const bassHit = tick % 4 === 0 || tick === 10;
  if (bassHit) {
    const bassDegree = tick === 14 || tick === 15 ? chord - 1 : chord + (tick === 6 || tick === 10 ? 4 : tick === 8 ? 7 : 0);
    notes.push(note('triangle', track.root - 24 + gardenDegree(bassDegree), step * 2.3, .36));
  }

  if (tick === 0 || tick === 8)
    notes.push(note('kick', 43, .14, .5));
  if (tick === 4 || tick === 12) notes.push(note('snare', 48, .12, .20, .07));
  if (tick % 2 === 0 || (scene.urgent && tick > 11))
    notes.push(note('hat', 92, tick % 4 === 2 ? .064 : .026, tick % 4 === 2 ? .11 : .062, tick % 4 === 0 ? -.3 : .3));

  // Garden: offbeat chord chips. Circuit: running arpeggio. Crystal: octave answers.
  if (world === 0 && !vertical && tick % 4 === 2) {
    for (const offset of [0, 2, 4]) notes.push(note('triangle', track.root + gardenDegree(chord + offset), step * .7, .046, .22));
  } else if (tick % 2 === 0 && (world > 0 || vertical || breakdown)) {
    const order = scene.direction === 'down' || scene.direction === 'left' ? [7, 4, 2, 0] : [0, 2, 4, 7];
    const arp = order[Math.floor(tick / 2) % 4];
    notes.push(note('bell', track.root + 12 + gardenDegree(chord + arp), step * .66, breakdown ? .13 : .067, .28));
  }

  // A short turn-around every fourth bar; the last seconds add a busier backbeat.
  if (bar % 4 === 3 && tick >= 14 || scene.urgent && tick === 15)
    notes.push(note('snare', 48, .055, .12, tick % 2 ? .2 : -.2));
  if (scene.urgent && tick === 0) notes.push(note('pulse', root + 24, step * .48, .055, .18));
  return notes;
}

/** Short, original game cues, pitched to the selected soundtrack. */
export function effectNotes(effect: SoundEffect, mode: AudioMode, variation = 0): ChipNote[] {
  const root = TRACKS[mode].root;
  const sequence = (pitches: number[], spacing: number, duration: number, volume = .2, voice: ChipVoice = 'pulse') =>
    pitches.map((pitch, index) => note(voice, root + pitch, duration, volume, index % 2 ? .12 : -.12, index * spacing));
  switch (effect) {
    case 'start': return sequence([0, 7, 12, 19], .085, .12);
    case 'coin': return sequence([12 + [0, 3, 7, 10, 12][variation % 5], 24 + [0, 3, 7, 10, 12][variation % 5]], .028, .058, .13, 'bell');
    case 'rare-coin': return sequence([12, 16, 19, 24, 28, 31], .045, .13, .21, 'bell');
    case 'jump': return [note('pulse', root - 1, .11, .17, -.08, 0, root + 14)];
    case 'double-jump': return [note('pulse', root + 7, .13, .18, .08, 0, root + 24)];
    case 'slide': return [note('noise', 60, .12, .13, 0), note('triangle', root, .1, .14, 0, 0, root - 12)];
    case 'hit': return [note('noise', 40, .19, .28), note('pulse', root - 6, .18, .16, 0, 0, root - 24)];
    case 'shield': return sequence([0, 7, 12, 7], .048, .16, .16, 'triangle');
    case 'magnet': return sequence([0, 3, 7, 12, 7, 12], .054, .10, .15, 'bell');
    case 'up': return [note('noise', 48, .38, .16, -.25), ...sequence([-12, -5, 0, 7, 12, 19, 24], .043, .1, .16)];
    case 'down': return [note('noise', 48, .38, .16, .25), ...sequence([24, 19, 12, 7, 0, -5, -12], .043, .1, .16)];
    case 'reverse': return sequence([19, 12, 7, 0, 7, 12], .045, .09, .17);
    case 'world': return sequence([7, 12, 19], .065, .14, .12, 'bell');
    case 'countdown': return [note('bell', root + 24, .09, .10)];
    case 'win': return [...sequence([0, 4, 7, 12, 7, 12, 19], .105, .19, .2), ...[0, 4, 7].map(pitch => note('triangle', root + pitch, .65, .1, 0, .7))];
    case 'lose': return sequence([7, 3, 0, -5, -12], .12, .19, .17);
  }
}
