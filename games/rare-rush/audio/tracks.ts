import type { ChipNote, ChipVoice, MusicScene } from './score.ts';

type Phrase = readonly (readonly [tick: number, semitones: number, length: number])[];
type Chord = { bass: number; tones: readonly number[] };
const n = (voice: ChipVoice, midi: number, duration: number, volume: number, pan = 0): ChipNote =>
  ({ voice, midi, duration, volume, pan, at: 0 });
const has = (ticks: readonly number[], tick: number) => ticks.includes(tick);

// CIRCUIT CHASE — D major, a clear four-bar question and answer.
// Every bar has its own harmony and melody. Strong beats land on chord tones;
// the few diatonic passing notes connect them on weak eighth-note positions.
const D: Chord = { bass: 0, tones: [0,4,7] };
const Bm: Chord = { bass: -3, tones: [-3,0,4] };
const G: Chord = { bass: -7, tones: [-7,-3,0] };
const A: Chord = { bass: -5, tones: [-5,-1,2] };
const Em: Chord = { bass: 2, tones: [2,5,9] };
const CIRCUIT_HARMONY = [D,Bm,G,A, D,Bm,G,A, Em,G,D,A, D,Bm,G,A];
const CIRCUIT_MELODY: readonly Phrase[] = [
  [[0,4,3.5],[4,7,3.5],[8,12,5.5],[14,11,1.5]],
  [[0,9,5.5],[6,7,1.5],[8,4,5.5],[14,2,1.5]],
  [[0,5,3.5],[4,9,3.5],[8,12,5.5],[14,9,1.5]],
  [[0,7,3.5],[4,11,3.5],[8,14,3.5],[12,11,1.5],[14,7,1.5]],
  [[0,0,3.5],[4,4,3.5],[8,7,5.5],[14,4,1.5]],
  [[0,4,5.5],[6,7,1.5],[8,9,5.5],[14,4,1.5]],
  [[0,5,3.5],[4,9,3.5],[8,12,1.5],[10,9,1.5],[12,5,3.5]],
  [[0,2,3.5],[4,7,3.5],[8,11,5.5],[14,7,1.5]],
  [[0,14,7.5],[8,9,5.5],[14,5,1.5]],
  [[0,12,5.5],[6,9,1.5],[8,5,7.5]],
  [[0,4,5.5],[6,7,1.5],[8,12,7.5]],
  [[0,11,7.5],[8,7,3.5],[12,2,3.5]],
  [[0,4,3.5],[4,7,3.5],[8,12,5.5],[14,11,1.5]],
  [[0,9,5.5],[6,7,1.5],[8,4,5.5],[14,2,1.5]],
  [[0,5,3.5],[4,9,3.5],[8,12,1.5],[10,9,1.5],[12,5,3.5]],
  [[0,7,3.5],[4,11,3.5],[8,14,3.5],[12,11,3.5]],
];

/** Direction changes color the accompaniment, never scramble the melody. */
function atmosphere(notes: ChipNote[], tick: number, scene: MusicScene, chord: Chord, tonic: number, step: number, low: boolean) {
  const world = Math.max(0, Math.min(2, scene.world));
  const reverse = scene.direction === 'left', vertical = scene.direction === 'up' || scene.direction === 'down';
  const pan = reverse ? -.25 : .25;
  if (has([0,8],tick)) {
    for (const pitch of chord.tones) notes.push(n('triangle',tonic+pitch+(low?-12:0),step*6.5,low?.038:.030,pan));
  }
  // A restrained, chord-safe answer. At most two extra notes per bar;
  // DEGEN never gains the old stream of sixteenth-note fills in a shaft.
  const answerTicks = low ? [14] : [2,10];
  if ((world>0 || vertical) && has(answerTicks,tick)) {
    const descending = scene.direction === 'down' || reverse;
    const slot = tick < 8 ? 0 : 2;
    const pitch = chord.tones[descending ? 2-slot : slot];
    const octave = scene.direction === 'up' || world === 2 ? 12 : 0;
    notes.push(n('bell',tonic+12+pitch+octave,step*1.4,.035,pan));
  }
}

export function circuitMusicStep(index: number, scene: MusicScene, tonic: number, step: number): ChipNote[] {
  const tick = Math.floor(index)%16, bar = Math.floor(index/16)%16;
  const chord = CIRCUIT_HARMONY[bar], bridge = bar>=8 && bar<12;
  const notes: ChipNote[] = [];
  for (const [onset,pitch,length] of CIRCUIT_MELODY[bar]) {
    if (tick===onset) notes.push(n(bridge?'bell':'pulse',tonic+12+pitch,step*length,bridge?.19:.18,scene.direction==='left'?.12:-.12));
  }
  if (has([0,4,8,12],tick)) {
    const bassInterval = tick===4 || tick===12 ? 7 : tick===8 ? 12 : 0;
    notes.push(n('triangle',tonic-12+chord.bass+bassInterval,step*2.5,.32));
  }
  if (has(bridge?[0,8]:[0,6,8],tick)) notes.push(n('kick',43,.14,scene.urgent?.48:.44));
  if (has([4,12],tick)) notes.push(n('snare',48,.11,.17,.06));
  if (has([2,6,10,14],tick)) notes.push(n('hat',92,.043,.055,.25));
  atmosphere(notes,tick,scene,chord,tonic,step,false);
  return notes;
}

// BREAKBEAT RUSH — F# natural minor. A syncopated bass hook and a two-step
// drum break supply the drive at the same tempo as EASY and NORMAL. Sixteen
// bars move from the hook to a short breakdown, rebuild, and fuller final drop.
const Fsm: Chord = { bass: 0, tones: [0,3,7] };
const Dmajor: Chord = { bass: -4, tones: [-4,0,3] };
const Emajor: Chord = { bass: -2, tones: [-2,2,5] };
const Bminor: Chord = { bass: -7, tones: [-7,-4,0] };
const RIFT_HARMONY = [Fsm,Dmajor,Emajor,Fsm, Fsm,Dmajor,Emajor,Fsm, Bminor,Dmajor,Emajor,Emajor, Fsm,Dmajor,Emajor,Fsm];
const RIFT_MELODY: readonly Phrase[] = [
  [[0,12,2.5],[3,7,1.5],[6,12,3.5],[10,15,1.5],[14,7,1.5]],
  [[0,12,2.5],[3,8,1.5],[6,12,3.5],[10,15,1.5],[14,8,1.5]],
  [[0,14,3.5],[6,17,1.5],[8,14,3.5],[12,10,3.5]],
  [[0,12,5.5],[6,7,1.5],[10,3,3.5],[14,7,1.5]],
  [[0,12,2.5],[3,7,1.5],[6,12,1.5],[10,15,3.5],[14,19,1.5]],
  [[0,15,3.5],[6,12,1.5],[8,8,5.5],[14,12,1.5]],
  [[0,14,3.5],[6,17,1.5],[8,14,3.5],[12,10,3.5]],
  [[0,12,5.5],[6,7,1.5],[10,3,3.5]],
  [[0,8,7.5],[8,5,7.5]],
  [[0,8,7.5],[8,12,7.5]],
  [[0,10,5.5],[6,14,1.5],[10,17,3.5]],
  [[0,14,3.5],[6,17,3.5],[12,10,1.5]],
  [[0,12,2.5],[3,7,1.5],[6,12,1.5],[10,15,3.5],[14,19,1.5]],
  [[0,15,3.5],[6,12,1.5],[8,8,5.5],[14,12,1.5]],
  [[0,14,3.5],[6,17,1.5],[8,14,3.5],[12,10,3.5]],
  [[0,12,5.5],[6,7,1.5],[10,3,1.5],[14,7,1.5]],
];
// Root/fifth/octave phrases leave pockets around the snare. Two related
// patterns make the bass answer itself; the low and octave voices stay locked.
const RIFT_BASS: readonly Phrase[] = [
  [[0,0,1.6],[3,0,.7],[6,12,2.8],[10,7,1.6],[14,0,1.6]],
  [[0,0,1.6],[2,12,1.5],[6,0,2.7],[9,7,2.5],[14,0,1.6]],
];

export function riftMusicStep(index: number, scene: MusicScene, tonic: number, step: number): ChipNote[] {
  const tick = Math.floor(index)%16, bar = Math.floor(index/16)%16;
  const chord = RIFT_HARMONY[bar];
  const breakdown = bar===8 || bar===9, build = bar===10 || bar===11, drop = bar>=12;
  const notes: ChipNote[] = [];
  const pan = scene.direction==='left' ? .12 : -.12;
  for (const [onset,pitch,length] of RIFT_MELODY[bar]) {
    if (tick===onset) notes.push(n(breakdown?'bell':'pulse',tonic+pitch,step*length,breakdown?.14:drop?.17:.15,pan));
  }
  const bassPhrase: Phrase = breakdown ? [[0,0,6.5],[8,7,6.5]] : RIFT_BASS[bar%2];
  for (const [onset,pitch,length] of bassPhrase) {
    if (tick!==onset) continue;
    const root = tonic-24+chord.bass;
    // A rounded sub plus a quieter octave pulse keeps the bass audible on
    // laptop speakers. No detuning or chromatic movement against the chords.
    notes.push(n('triangle',root+pitch,step*length,breakdown?.30:.43));
    if (!breakdown) notes.push(n('pulse',root+12+pitch,step*Math.min(length,1.8),drop?.12:.095));
  }
  const kicks = breakdown ? [0] : bar%2===0 ? [0,6,10] : [0,7,10];
  if (has(kicks,tick)) notes.push(n('kick',43,.13,breakdown?.38:scene.urgent?.58:.55));
  if (has(breakdown?[8]:[4,12],tick)) notes.push(n('snare',48,.13,breakdown?.18:drop?.31:.28,.04));
  // Quiet ghost hits and alternating hat accents create the break's swing;
  // sixteenth-note details are reserved for the ends of phrases.
  const fill = bar===7 || bar===11 || bar===15;
  if (!breakdown && !(fill && tick===14) && has(bar%2===0?[11]:[3,14],tick))
    notes.push(n('snare',48,.045,.075,-.12));
  if (has(breakdown?[2,10]:[0,2,4,6,8,10,12,14],tick)) {
    const accent = tick%4===2;
    notes.push(n('hat',92,accent?.055:.025,breakdown?.045:accent?.095:.045,accent?.25:-.18));
  }
  if (!breakdown && (drop || bar%4===3) && has([7,15],tick))
    notes.push(n('hat',92,.022,.042,-.22));
  if (fill && has([14,15],tick))
    notes.push(n('snare',48,.047,tick===15?.13:.095,tick===15?.12:-.12));

  const chordTicks = breakdown ? [0,8] : [2,10];
  if (has(chordTicks,tick)) {
    for (const pitch of chord.tones)
      notes.push(n('triangle',tonic+pitch,step*(breakdown?6.5:1.4),breakdown?.038:.045,-pan));
  }
  // Scene changes add one quiet chord-tone answer, leaving the bass, groove,
  // and main hook recognizable in every direction and world.
  if (!breakdown && tick===14 && (scene.world>0 || scene.direction!=='right')) {
    const pitch = scene.direction==='down' || scene.direction==='left' ? chord.tones[0] : chord.tones[2];
    const octave = scene.direction==='up' || scene.world===2 ? 12 : 0;
    notes.push(n('bell',tonic+12+pitch+octave,step*1.4,.040,-pan));
  }
  if (build && bar===11 && tick===0) notes.push(n('noise',48,step*8,.075,.12));
  return notes;
}
