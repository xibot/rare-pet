import type { ChipNote } from './score.ts';

export type AudioBus = 'music' | 'effects';
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
type Voice = { source: AudioScheduledSourceNode; gain: GainNode; nodes: AudioNode[]; bus: AudioBus; end: number };

/** Small Web Audio chip synth; also works in OfflineAudioContext for WAV exports. */
export class ChipSynth {
  readonly context: BaseAudioContext;
  readonly music: GainNode;
  readonly effects: GainNode;
  private output: GainNode;
  private limiter: DynamicsCompressorNode;
  private pulse: PeriodicWave;
  private noise: AudioBuffer;
  private voices = new Set<Voice>();
  private disposed = false;
  private offline: boolean;

  constructor(context: BaseAudioContext) {
    this.context = context;
    this.offline = 'startRendering' in context;
    this.music = context.createGain(); this.music.gain.value = .64;
    this.effects = context.createGain(); this.effects.gain.value = .72;
    this.output = context.createGain(); this.output.gain.value = .62;
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -9; this.limiter.knee.value = 9; this.limiter.ratio.value = 8;
    this.limiter.attack.value = .003; this.limiter.release.value = .12;
    this.music.connect(this.limiter); this.effects.connect(this.limiter);
    this.limiter.connect(this.output); this.output.connect(context.destination);
    const real = new Float32Array(33), imaginary = new Float32Array(33);
    // Band-limited 25% pulse wave: NES-like color without a harsh raw square.
    for (let harmonic = 1; harmonic < real.length; harmonic++) {
      real[harmonic] = Math.sin(2 * Math.PI * harmonic * .25) / (Math.PI * harmonic);
      imaginary[harmonic] = (1 - Math.cos(2 * Math.PI * harmonic * .25)) / (Math.PI * harmonic);
    }
    this.pulse = context.createPeriodicWave(real, imaginary);
    this.noise = context.createBuffer(1, Math.ceil(context.sampleRate), context.sampleRate);
    const data = this.noise.getChannelData(0);
    let state = 0x5a17;
    for (let index = 0; index < data.length; index++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[index] = ((state >>> 0) / 0xffffffff * 2 - 1);
    }
  }

  setBus(bus: AudioBus, enabled: boolean) {
    const param = this[bus].gain, now = this.context.currentTime;
    param.cancelScheduledValues(now); param.setTargetAtTime(enabled ? bus === 'music' ? .64 : .72 : 0, now, .008);
    if (!enabled) this.stop(bus);
  }

  schedule(notes: readonly ChipNote[], at: number, bus: AudioBus) {
    if (this.disposed) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) if (voice.end <= now) this.release(voice);
    for (const event of notes) {
      if (![at, event.at, event.duration, event.volume, event.midi].every(Number.isFinite) || event.duration <= 0) continue;
      // Offline scores are pre-scheduled in full. Live playback is strictly bounded.
      if (!this.offline && this.voices.size >= 48) break;
      const start = Math.max(now, at + event.at), end = start + event.duration;
      const gain = this.context.createGain(), pan = this.context.createStereoPanner();
      const filter = this.context.createBiquadFilter();
      pan.pan.value = Math.max(-1, Math.min(1, event.pan));
      filter.type = 'lowpass'; filter.frequency.value = event.voice === 'pulse' ? 4600 : 9000;
      let source: OscillatorNode | AudioBufferSourceNode;
      if (event.voice === 'noise' || event.voice === 'snare' || event.voice === 'hat') {
        source = this.context.createBufferSource(); source.buffer = this.noise;
        filter.type = event.voice === 'hat' ? 'highpass' : 'bandpass';
        filter.frequency.value = event.voice === 'hat' ? 6500 : event.voice === 'snare' ? 1800 : 1200;
        filter.Q.value = event.voice === 'noise' ? .7 : .5;
      } else {
        source = this.context.createOscillator();
        if (event.voice === 'pulse') source.setPeriodicWave(this.pulse);
        else source.type = event.voice === 'triangle' ? 'triangle' : 'sine';
        const hz = event.voice === 'kick' ? 145 : frequency(event.midi);
        source.frequency.setValueAtTime(hz, start);
        if (event.voice === 'kick') source.frequency.exponentialRampToValueAtTime(42, start + .11);
        else if (event.endMidi !== undefined) source.frequency.exponentialRampToValueAtTime(frequency(event.endMidi), end);
      }
      const volume = Math.max(0, Math.min(.6, event.volume));
      const attack = Math.min(.004, event.duration / 4);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + attack);
      gain.gain.exponentialRampToValueAtTime(.0001, end);
      source.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this[bus]);
      const voice: Voice = { source, gain, nodes: [source, filter, gain, pan], bus, end: end + .012 };
      this.voices.add(voice);
      source.onended = () => this.release(voice);
      source.start(start); source.stop(end + .012);
    }
  }

  private release(voice: Voice) {
    if (!this.voices.delete(voice)) return;
    voice.source.onended = null;
    for (const node of voice.nodes) node.disconnect();
  }

  stop(bus?: AudioBus) {
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      if (bus && voice.bus !== bus) continue;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, .003);
      try { voice.source.stop(now + .015); } catch { /* Already stopped. */ }
      // Disconnect immediately so future scheduled attacks cannot leak on resume.
      this.release(voice);
    }
  }

  get activeVoices() { return this.voices.size; }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.stop();
    this.music.disconnect(); this.effects.disconnect(); this.limiter.disconnect(); this.output.disconnect();
  }
}
