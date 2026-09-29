import test from 'node:test';
import assert from 'node:assert/strict';
import { effectNotes, musicStep, sixteenthSeconds, TRACKS, type AudioMode, type ChipNote, type SoundEffect } from '../games/rare-rush/audio/score.ts';
import { ChipSynth } from '../games/rare-rush/audio/synth.ts';
import { RushAudio } from '../games/rare-rush/audio/run-audio.ts';
import { createRun, stepRun, demoControls, setPace, setSliding, jump, FIXED_STEP, type RunState } from '../games/rare-rush/twist/engine.ts';

const modes: AudioMode[] = ['easy', 'normal', 'degen'];
const effects: SoundEffect[] = ['start', 'jump', 'double-jump', 'slide', 'coin', 'rare-coin', 'hit', 'shield', 'magnet', 'up', 'down', 'reverse', 'world', 'countdown', 'win', 'lose'];

class Param {
  value = 0;
  calls: { method: string; value: number; at: number }[] = [];
  setValueAtTime(value: number, at: number) { this.value = value; this.calls.push({ method: 'set', value, at }); return this; }
  linearRampToValueAtTime(value: number, at: number) { this.value = value; this.calls.push({ method: 'linear', value, at }); return this; }
  exponentialRampToValueAtTime(value: number, at: number) { assert(value > 0); this.value = value; this.calls.push({ method: 'exponential', value, at }); return this; }
  setTargetAtTime(value: number, at: number, _constant: number) { this.value = value; this.calls.push({ method: 'target', value, at }); return this; }
  cancelScheduledValues(at: number) { this.calls.push({ method: 'cancel', value: this.value, at }); return this; }
}

class Node {
  outputs: Node[] = [];
  disconnected = false;
  gain = new Param(); pan = new Param(); frequency = new Param(); Q = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  type = ''; buffer: unknown; onended: (() => void) | null = null;
  starts: number[] = []; stops: number[] = [];
  connect(node: Node) { this.outputs.push(node); return node; }
  disconnect() { this.disconnected = true; this.outputs = []; }
  setPeriodicWave(_wave: unknown) {}
  start(at: number) { this.starts.push(at); }
  stop(at: number) { this.stops.push(at); }
}

class Context {
  currentTime = 0; sampleRate = 44100; state = 'suspended';
  destination = new Node(); nodes: Node[] = []; sources: Node[] = [];
  resumeCalls = 0; closeCalls = 0;
  make() { const node = new Node(); this.nodes.push(node); return node; }
  createGain() { return this.make(); }
  createDynamicsCompressor() { return this.make(); }
  createStereoPanner() { return this.make(); }
  createBiquadFilter() { return this.make(); }
  createOscillator() { const node = this.make(); this.sources.push(node); return node; }
  createBufferSource() { const node = this.make(); this.sources.push(node); return node; }
  createPeriodicWave(_real: Float32Array, _imaginary: Float32Array) { return {}; }
  createBuffer(channels: number, length: number, _rate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (channel: number) => data[channel] };
  }
  async resume() { this.state = 'running'; this.resumeCalls++; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; this.closeCalls++; }
}
const synthContext = (context: Context) => context as unknown as BaseAudioContext;
const validNotes = (notes: ChipNote[]) => {
  assert(notes.length > 0);
  for (const note of notes) {
    for (const value of [note.at, note.duration, note.midi, note.volume, note.pan]) assert(Number.isFinite(value));
    assert(note.at >= 0 && note.duration > 0 && note.duration < 2);
    assert(note.volume > 0 && note.volume <= .6);
    assert(note.pan >= -1 && note.pan <= 1);
  }
};

test('each difficulty has an original, finite arrangement at a shared tempo with distinct world/direction phrases', () => {
  assert.equal(TRACKS.normal.bpm, TRACKS.easy.bpm);
  assert.equal(TRACKS.degen.bpm, TRACKS.easy.bpm);
  const arrangements = new Set<string>();
  for (const mode of modes) {
    const variants = new Set<string>();
    for (const world of [0, 1, 2]) for (const direction of ['right', 'up', 'down', 'left'] as const) {
      const scene = Object.freeze({ world, direction, urgent: false });
      const notes = Array.from({ length: 256 }, (_, step) => musicStep(mode, step, scene));
      notes.filter(events => events.length).forEach(validNotes);
      assert.deepEqual(notes, Array.from({ length: 256 }, (_, step) => musicStep(mode, step, scene)), 'Audio arrangement is deterministic without gameplay RNG');
      variants.add(JSON.stringify(notes));
    }
    assert(variants.size >= 6, `${mode} has audibly different world and direction arrangements`);
    arrangements.add(JSON.stringify(musicStep(mode, 0, { world: 0, direction: 'right', urgent: false })));
    assert(sixteenthSeconds(mode) > .06 && sixteenthSeconds(mode) < .15);
  }
  assert.equal(arrangements.size, 3);
});

test('all game cues are finite, short and musically distinct', () => {
  for (const mode of modes) {
    const distinct = new Set<string>();
    for (const effect of effects) {
      const notes = effectNotes(effect, mode);
      validNotes(notes);
      assert(Math.max(...notes.map(note => note.at + note.duration)) < 2);
      distinct.add(JSON.stringify(notes));
    }
    assert.equal(distinct.size, effects.length);
    assert.notDeepEqual(effectNotes('coin', mode, 0), effectNotes('coin', mode, 1), 'Dense pickups vary in pitch');
  }
});

test('music and effects mute independently and cancelled future attacks cannot return', () => {
  const context = new Context(), synth = new ChipSynth(synthContext(context));
  synth.schedule(effectNotes('start', 'normal'), 10, 'music');
  const music = [...context.sources];
  synth.schedule(effectNotes('coin', 'normal'), 10, 'effects');
  const sfx = context.sources.slice(music.length);
  synth.setBus('music', false);
  assert.equal((synth.music.gain as unknown as Param).value, 0);
  assert(music.every(source => source.disconnected && source.stops.at(-1)! < 1));
  assert(sfx.every(source => !source.disconnected), 'Music mute does not cancel pickup cues');
  assert.equal(synth.activeVoices, sfx.length);
  synth.setBus('effects', false);
  assert(sfx.every(source => source.disconnected));
  assert.equal(synth.activeVoices, 0);
  synth.setBus('music', true);
  assert.equal(synth.activeVoices, 0, 'Unmute cannot resurrect future scheduled attacks');
  synth.dispose();
});

test('rapid coin bursts have a strict live voice bound and disposed synths stay silent', () => {
  const context = new Context(), synth = new ChipSynth(synthContext(context));
  for (let index = 0; index < 1000; index++) synth.schedule(effectNotes('coin', 'degen', index), 0, 'effects');
  assert(synth.activeVoices <= 48);
  assert(context.sources.length <= 48, 'Bound applies before allocating more oscillators');
  synth.stop();
  assert.equal(synth.activeVoices, 0);
  assert(context.sources.every(source => source.disconnected));
  synth.dispose(); synth.dispose();
  const count = context.sources.length;
  synth.schedule(effectNotes('win', 'degen'), 0, 'effects');
  assert.equal(context.sources.length, count);
  assert(context.nodes.every(node => node.disconnected), 'Dispose releases all created nodes');
});

const runFor = () => createRun('0x' + '42'.repeat(32), 'degen');
const controllerFor = (context: Context) => new RushAudio({ contextFactory: () => context as unknown as AudioContext });
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

test('silent visitors and restored preferences allocate no audio before deliberate unlock', async () => {
  let contexts = 0;
  const context = new Context();
  const audio = new RushAudio({ contextFactory: () => { contexts++; return context as unknown as AudioContext; } });
  try {
    audio.update(runFor(), true);
    assert.equal(await audio.unlock(), false, 'A Play gesture with both channels off remains silent');
    assert.equal(contexts, 0);
    audio.setEnabled({ music: true, effects: true });
    audio.update(runFor(), true);
    assert.equal(contexts, 0, 'Restoring preferences does not bypass browser opt-in');
    assert.equal(audio.diagnostics.contextCreated, false);
    const unlocked = await Promise.all([audio.unlock(), audio.unlock()]);
    assert.deepEqual(unlocked, [true, true]);
    assert.equal(contexts, 1, 'Concurrent gestures share one AudioContext');
    assert.equal(context.resumeCalls, 1);
    assert(audio.diagnostics.timerActive && audio.diagnostics.active);
  } finally { audio.dispose(); }
  assert.equal(context.closeCalls, 1);
});

test('pause, resume, channel mute and dispose cancel voices and music scheduling', async () => {
  const context = new Context(), audio = controllerFor(context), run = runFor();
  try {
    audio.setEnabled({ music: true, effects: true });
    await audio.unlock(); audio.update(run, true);
    assert(audio.diagnostics.voices > 0 && audio.diagnostics.timerActive);
    audio.pause();
    assert.deepEqual(audio.diagnostics, { contextCreated: true, active: false, timerActive: false, voices: 0 });
    assert(context.sources.every(source => source.disconnected));
    run.elapsed = .2; audio.update(run, true);
    assert(audio.diagnostics.active && audio.diagnostics.timerActive);
    audio.setEnabled({ music: false, effects: true });
    assert.equal(audio.diagnostics.timerActive, false);
    const before = context.sources.length;
    run.elapsed += .01; run.coins++; context.currentTime += .1; audio.update(run, true);
    assert(context.sources.length > before, 'Effects still play while music is off');
    audio.setEnabled({ music: true, effects: false });
    assert(audio.diagnostics.timerActive);
    audio.setEnabled({ music: false, effects: false });
    assert.equal(audio.diagnostics.voices, 0);
    assert.equal(audio.diagnostics.timerActive, false);
    audio.dispose(); audio.dispose();
    const finalCount = context.sources.length;
    assert.equal(await audio.unlock(), false);
    audio.setEnabled({ music: true, effects: true }); audio.update(run, true);
    assert.equal(context.sources.length, finalCount);
    assert.equal(context.closeCalls, 1);
  } finally { audio.dispose(); }
});

test('finished runs have one outcome cue and pausing or reopening a result cannot replay it', async () => {
  for (const reason of ['time', 'hearts'] as const) {
    const context = new Context(), audio = controllerFor(context), run = runFor();
    try {
      audio.setEnabled({ music: false, effects: true }); await audio.unlock();
      run.elapsed = 1; audio.update(run, true);
      const beforePause = context.sources.length;
      audio.update(run, false);
      assert.equal(context.sources.length, beforePause, 'A pause is not a victory');
      audio.update(run, true);
      run.status = 'finished'; run.finishReason = reason; run.elapsed += .01;
      audio.update(run, false);
      const afterFinish = context.sources.length;
      assert(afterFinish > beforePause);
      assert.equal(audio.diagnostics.timerActive, false);
      const outcomeVoices = audio.diagnostics.voices;
      for (let index = 0; index < 10; index++) audio.update(run, false);
      assert.equal(context.sources.length, afterFinish, 'Result rerenders never repeat the outcome cue');
      assert.equal(audio.diagnostics.voices, outcomeVoices, 'Result rerenders do not truncate the single outcome jingle');
      audio.dispose();
      const reopenedContext = new Context(), reopened = controllerFor(reopenedContext);
      reopened.setEnabled({ music: false, effects: true });
      await reopened.unlock(); reopened.update(run, false);
      assert.equal(reopenedContext.sources.length, 0, 'Opening an already-finished result does not play a fresh victory');
      reopened.dispose();
    } finally { audio.dispose(); }
  }
});

test('coin bursts are rate-limited and replay seeks skip a backlog of game cues', async () => {
  const context = new Context(), audio = controllerFor(context), run = runFor();
  try {
    audio.setEnabled({ music: false, effects: true }); await audio.unlock();
    run.elapsed = 1; audio.update(run, true);
    for (let index = 0; index < 200; index++) {
      context.currentTime += .001; run.elapsed += .001; run.coins += 10;
      audio.update(run, true);
    }
    assert(context.sources.length <= 8, 'Thousands of pickups within 200ms coalesce to at most four two-note cues');
    assert(audio.diagnostics.voices <= 48);
    const beforeSeek = context.sources.length;
    run.elapsed += 10; run.coins += 100; run.player.jumps++;
    audio.update(run, true);
    assert.equal(context.sources.length, beforeSeek, 'Fast-forward never floods delayed coins/jumps');
  } finally { audio.dispose(); }
});

test('a late browser timer schedules the next beat instead of a backlog of notes', async () => {
  const context = new Context(), audio = controllerFor(context);
  try {
    audio.setEnabled({ music: true, effects: false }); await audio.unlock(); audio.update(runFor(), true);
    const beforeStall = context.sources.length;
    context.currentTime = 120;
    await new Promise(resolve => setTimeout(resolve, 60));
    const afterStall = context.sources.slice(beforeStall);
    assert(afterStall.length <= 24, 'A short lookahead may contain a musical rest, never a backlog');
    assert(afterStall.every(source => source.starts[0] >= 120));
    context.currentTime = 120.25;
    await new Promise(resolve => setTimeout(resolve, 40));
    const continued = context.sources.slice(beforeStall);
    assert(continued.length > 0 && continued.length <= 24, 'Music continues after the rest without catching up missed bars');
    assert(audio.diagnostics.voices <= 48);
  } finally { audio.dispose(); }
});

test('audio observes frozen gameplay states without changing physics, rewards, replay timing or RNG', async () => {
  const context = new Context(), audio = controllerFor(context), run = runFor();
  try {
    audio.setEnabled({ music: false, effects: true }); await audio.unlock();
    let observations = 0;
    while (run.status === 'running') {
      const controls = demoControls(run);
      setPace(run, controls.axis); setSliding(run, controls.slide); if (controls.jump) jump(run);
      stepRun(run, FIXED_STEP);
      if (run._tick % 24 === 0 || run.status === 'finished') {
        const frozen = freezeDeep(structuredClone(run)) as RunState;
        const before = JSON.stringify(frozen);
        context.currentTime = run.elapsed;
        audio.update(frozen, run.status === 'running');
        assert.equal(JSON.stringify(frozen), before);
        assert.deepEqual(frozen, run);
        observations++;
      }
    }
    assert(observations > 100, 'Observe real legal gameplay through several direction/biome changes');
  } finally { audio.dispose(); }
});
