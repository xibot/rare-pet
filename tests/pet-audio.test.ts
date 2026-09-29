import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createPetAudio, PET_MUSIC_TRACKS, type PetMusicTrack, type PetSound } from '../games/rare-pet/audio.ts';

class Param {
  value = 0;
  events: { method: string; values: number[] }[] = [];
  setValueAtTime(...values: number[]) { this.events.push({ method: 'set', values }); }
  linearRampToValueAtTime(...values: number[]) { this.events.push({ method: 'linear', values }); }
  exponentialRampToValueAtTime(...values: number[]) { this.events.push({ method: 'exponential', values }); }
  setTargetAtTime(...values: number[]) { this.events.push({ method: 'target', values }); }
  cancelScheduledValues(...values: number[]) { this.events.push({ method: 'cancel', values }); }
}
class Node {
  disconnected = false;
  connect() { return this; }
  disconnect() { this.disconnected = true; }
}
class Oscillator extends Node {
  frequency = new Param();
  type = 'sine';
  onended: (() => void) | null = null;
  starts: number[] = [];
  stops: number[] = [];
  start(at: number) { this.starts.push(at); }
  stop(at: number) { this.stops.push(at); }
}
class Context extends EventTarget {
  static instances: Context[] = [];
  static rejectResume = false;
  currentTime = 0;
  state = 'suspended';
  destination = new Node();
  oscillators: Oscillator[] = [];
  nodes: Node[] = [];
  constructor() { super(); Context.instances.push(this); }
  createGain() { const node = Object.assign(new Node(), { gain: new Param() }); this.nodes.push(node); return node; }
  createBiquadFilter() { const node = Object.assign(new Node(), { frequency: new Param(), Q: new Param(), type: 'lowpass' }); this.nodes.push(node); return node; }
  createOscillator() { const node = new Oscillator(); this.oscillators.push(node); return node; }
  async resume() {
    if (Context.rejectResume) throw new Error('User gesture required');
    this.state = 'running'; this.dispatchEvent(new Event('statechange'));
  }
  async suspend() { this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); }
  async close() { this.state = 'closed'; this.dispatchEvent(new Event('statechange')); }
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const oscillator of this.oscillators) {
      if (oscillator.stops.at(-1)! <= this.currentTime) oscillator.onended?.();
    }
  }
}

function environment(t: TestContext) {
  const originals = Object.fromEntries(['AudioContext', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: page });
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; });
  t.mock.method(globalThis, 'clearInterval', (id: number) => timers.delete(id));
  Context.instances = [];
  Context.rejectResume = false;
  t.after(() => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const tick = () => { for (const callback of timers.values()) callback(); };
  return { page, timers, tick };
}

test('audio is silent and creates no context or timers before explicit unlock', async t => {
  const { timers } = environment(t);
  const audio = createPetAudio();
  assert.deepEqual(audio.getStatus(), { supported: true, unlocked: false });
  audio.setMusicEnabled(true);
  audio.setEffectsEnabled(true);
  audio.play('pet');
  assert.equal(Context.instances.length, 0);
  assert.equal(timers.size, 0);
  assert.equal(await audio.unlock(), true);
  assert.equal(Context.instances.length, 1);
  assert.equal(timers.size, 1);
  assert.ok(Context.instances[0].oscillators.length > 0);
  const count = Context.instances[0].oscillators.length;
  audio.setMusicEnabled(true);
  audio.setEffectsEnabled(true);
  audio.setMusicPaused(false);
  assert.equal(timers.size, 1);
  assert.equal(Context.instances[0].oscillators.length, count);
  audio.dispose();
  assert.equal(timers.size, 0);
});

test('unlock alone never enables music or effects', async t => {
  const { timers } = environment(t);
  const audio = createPetAudio();
  await audio.unlock();
  audio.play('pet');
  assert.equal(timers.size, 0);
  assert.equal(Context.instances[0].oscillators.length, 0);
  audio.dispose();
});

test('music pause cancels its notes while care effects remain available', async t => {
  const { timers } = environment(t);
  const audio = createPetAudio();
  audio.setMusicEnabled(true);
  audio.setEffectsEnabled(true);
  await audio.unlock();
  const context = Context.instances[0];
  const music = [...context.oscillators];
  audio.setMusicPaused(true);
  assert.equal(timers.size, 0);
  assert.ok(music.every(voice => voice.stops.at(-1)! <= context.currentTime + 0.025));
  audio.play('launch');
  const effects = context.oscillators.slice(music.length);
  assert.ok(effects.length > 0);
  audio.setEffectsEnabled(false);
  assert.ok(effects.every(voice => voice.stops.at(-1)! <= context.currentTime + 0.025));
  context.advance(0.1);
  assert.ok([...music, ...effects].every(voice => voice.disconnected));
  audio.setMusicPaused(false);
  assert.equal(timers.size, 1);
  audio.setMusicEnabled(false);
  assert.equal(timers.size, 0);
  audio.dispose();
});

test('a hidden page suspends and clears audio; visibility restores only enabled music', async t => {
  const { page, timers } = environment(t);
  const audio = createPetAudio();
  audio.setMusicEnabled(true);
  audio.setEffectsEnabled(true);
  await audio.unlock();
  const context = Context.instances[0];
  audio.play('pet');
  page.visibilityState = 'hidden';
  page.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  assert.equal(context.state, 'suspended');
  assert.equal(timers.size, 0);
  assert.ok(context.oscillators.every(voice => voice.disconnected));
  const count = context.oscillators.length;
  audio.play('poop');
  assert.equal(context.oscillators.length, count);
  page.visibilityState = 'visible';
  page.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  assert.equal(context.state, 'running');
  assert.equal(timers.size, 1);
  audio.dispose();
  assert.equal(context.state, 'closed');
  assert.equal(timers.size, 0);
  assert.ok(context.nodes.every(node => node.disconnected));
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(context.state, 'closed');
  assert.equal(await audio.unlock(), false);
});

test('a stalled scheduler skips missed music instead of stacking catch-up notes', async t => {
  const { tick } = environment(t);
  const audio = createPetAudio();
  audio.setMusicEnabled(true);
  await audio.unlock();
  const context = Context.instances[0];
  const count = context.oscillators.length;
  context.advance(90);
  tick();
  assert.ok(context.oscillators.length - count <= 3);
  assert.ok(context.oscillators.slice(count).every(voice => voice.starts[0] >= 90));
  audio.dispose();
});

test('every care motif has bounded, soft-ended notes and repeated clicks cannot stack indefinitely', async t => {
  environment(t);
  const audio = createPetAudio();
  audio.setEffectsEnabled(true);
  await audio.unlock();
  const context = Context.instances[0];
  for (const sound of ['pet', 'feed', 'poop', 'play', 'launch', 'rarity', 'select'] as PetSound[]) {
    context.advance(2);
    const count = context.oscillators.length;
    audio.play(sound);
    const notes = context.oscillators.slice(count);
    assert.ok(notes.length > 0 && notes.length <= 8, sound);
    assert.ok(notes.every(voice => voice.stops[0] > voice.starts[0] && voice.stops[0] - context.currentTime < 2));
  }
  context.advance(2);
  const count = context.oscillators.length;
  for (let index = 0; index < 100; index++) audio.play('rarity');
  assert.ok(context.oscillators.length - count <= 40);
  audio.dispose();
});

test('unsupported or blocked audio fails harmlessly and can be retried after a gesture', async t => {
  const { timers } = environment(t);
  Context.rejectResume = true;
  const audio = createPetAudio();
  audio.setMusicEnabled(true);
  assert.equal(await audio.unlock(), false);
  assert.equal(timers.size, 0);
  assert.equal(audio.getStatus().unlocked, false);
  Context.rejectResume = false;
  assert.equal(await audio.unlock(), true);
  audio.dispose();
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: undefined });
  const unsupported = createPetAudio();
  assert.deepEqual(unsupported.getStatus(), { supported: false, unlocked: false });
  assert.equal(await unsupported.unlock(), false);
  unsupported.setMusicEnabled(true);
  unsupported.play('launch');
  unsupported.dispose();
});

test('choosing a track before unlock stores the choice without enabling or creating audio', async t => {
  const { timers } = environment(t);
  const audio = createPetAudio();
  audio.setMusicTrack('moon-float');
  assert.equal(Context.instances.length, 0);
  assert.equal(timers.size, 0);
  await audio.unlock();
  const context = Context.instances[0];
  assert.equal(context.oscillators.length, 0);
  audio.setMusicEnabled(true);
  assert.equal(timers.size, 1);
  // Moon Float begins on D, unlike Daydream's C opening.
  assert.equal(context.oscillators[0].frequency.events[0].values[0], 440 * 2 ** ((38 - 69) / 12));
  audio.dispose();
});

test('switching tracks fades only music and starts a fresh phrase without interrupting effects', async t => {
  const { timers } = environment(t);
  const audio = createPetAudio();
  audio.setMusicEnabled(true);
  audio.setEffectsEnabled(true);
  await audio.unlock();
  const context = Context.instances[0];
  const originalMusic = [...context.oscillators];
  audio.play('launch');
  const effects = context.oscillators.slice(originalMusic.length);
  const effectStops = effects.map(voice => [...voice.stops]);
  const count = context.oscillators.length;
  context.advance(0.1);
  audio.setMusicTrack('pixel-party');
  assert.equal(timers.size, 1);
  assert.ok(originalMusic.every(voice => voice.stops.at(-1)! <= context.currentTime + 0.025));
  assert.deepEqual(effects.map(voice => voice.stops), effectStops);
  const newMusic = context.oscillators.slice(count);
  assert.ok(newMusic.length > 0);
  assert.ok(newMusic.every(voice => Math.abs(voice.starts[0] - (context.currentTime + 0.035)) < 0.00001));
  assert.equal(newMusic[0].frequency.events[0].values[0], 440 * 2 ** ((43 - 69) / 12));
  const newCount = context.oscillators.length;
  audio.setMusicTrack('pixel-party');
  assert.equal(context.oscillators.length, newCount);
  assert.equal(timers.size, 1);
  audio.dispose();
});

test('changing tracks respects muted, game-paused and hidden states', async t => {
  const { page, timers } = environment(t);
  const audio = createPetAudio();
  await audio.unlock();
  const context = Context.instances[0];
  audio.setMusicTrack('pixel-party');
  assert.equal(context.oscillators.length, 0);
  assert.equal(timers.size, 0);
  audio.setMusicEnabled(true);
  audio.setMusicPaused(true);
  let count = context.oscillators.length;
  audio.setMusicTrack('moon-float');
  assert.equal(context.oscillators.length, count);
  assert.equal(timers.size, 0);
  audio.setMusicPaused(false);
  assert.equal(timers.size, 1);
  page.visibilityState = 'hidden';
  page.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  count = context.oscillators.length;
  audio.setMusicTrack('daydream');
  assert.equal(context.oscillators.length, count);
  assert.equal(timers.size, 0);
  page.visibilityState = 'visible';
  page.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  assert.equal(timers.size, 1);
  audio.setMusicEnabled(false);
  count = context.oscillators.length;
  audio.setMusicTrack('moon-float');
  assert.equal(context.oscillators.length, count);
  assert.equal(timers.size, 0);
  audio.dispose();
});

test('all three scores use their advertised tempos and different musical arrangements', async t => {
  const { tick } = environment(t);
  const openingRest: Record<PetMusicTrack, number> = { daydream: 2, 'moon-float': 6, 'pixel-party': 1 };
  const signatures: string[] = [];
  const voiceCounts: number[] = [];
  for (const track of PET_MUSIC_TRACKS) {
    const audio = createPetAudio();
    audio.setMusicTrack(track.id);
    audio.setMusicEnabled(true);
    await audio.unlock();
    const context = Context.instances.at(-1)!;
    for (let index = 0; index < 240; index++) { context.advance(0.025); tick(); }
    const starts = [...new Set(context.oscillators.map(voice => voice.starts[0]))].sort((a, b) => a - b);
    const eighth = 60 / track.bpm / 2;
    assert.ok(Math.abs((starts[1] - starts[0]) - openingRest[track.id] * eighth) < 0.00001, `${track.name} tempo`);
    assert.ok(starts.every(at => Math.abs((at - starts[0]) / eighth - Math.round((at - starts[0]) / eighth)) < 0.00001));
    signatures.push(context.oscillators.slice(0, 8).map(voice => `${voice.type}:${voice.frequency.events[0].values[0]}`).join(','));
    voiceCounts.push(context.oscillators.length);
    audio.dispose();
  }
  assert.equal(new Set(signatures).size, 3);
  assert.ok(voiceCounts[2] > voiceCounts[0] && voiceCounts[0] > voiceCounts[1], 'the party beat is denser than the relaxed and dreamy arrangements');
});
