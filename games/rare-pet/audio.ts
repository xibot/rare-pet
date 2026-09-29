/** Original, locally synthesized RarePet music and care sounds. No audio is fetched. */
export type PetSound = 'pet' | 'feed' | 'poop' | 'play' | 'launch' | 'rarity' | 'select';

export const PET_MUSIC_TRACKS = [
  { id: 'daydream', name: 'Daydream', mood: 'Easygoing', bpm: 84 },
  { id: 'pixel-party', name: 'Pixel Party', mood: 'Playful', bpm: 128 },
] as const;
export type PetMusicTrack = typeof PET_MUSIC_TRACKS[number]['id'];
export const DEFAULT_MUSIC_TRACK: PetMusicTrack = 'pixel-party';

export interface PetAudio {
  unlock(): Promise<boolean>;
  setMusicEnabled(enabled: boolean): void;
  setMusicTrack(track: PetMusicTrack): void;
  setEffectsEnabled(enabled: boolean): void;
  /** Keep the habitat soundtrack out of the way of Rare Rush's own audio. */
  setMusicPaused(paused: boolean): void;
  play(sound: PetSound): void;
  getStatus(): { supported: boolean; unlocked: boolean };
  dispose(): void;
}

type Channel = 'music' | 'effects';
type Voice = { oscillator: OscillatorNode; envelope: GainNode; channel: Channel; end: number };
type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

const LOOKAHEAD_SECONDS = 0.14;
const MAX_VOICES = 40;

// Eight original bars: deliberately spacious, with a softly filtered pulse lead.
const DAYDREAM_MELODY: readonly (number | null)[] = [
  76, null, null, 79, null, null, 81, null,
  79, null, 74, null, null, null, 72, null,
  76, null, null, null, 79, null, 76, null,
  74, null, null, null, 72, null, null, null,
  79, null, null, 81, null, null, 84, null,
  81, null, 79, null, null, null, 76, null,
  74, null, null, null, 79, null, 74, null,
  72, null, null, null, null, null, null, null,
];
const DAYDREAM_CHORDS: readonly (readonly number[])[] = [
  [48, 60, 64, 67], [45, 57, 60, 64], [41, 60, 65, 69], [43, 59, 62, 67],
];

// A bouncy G-major call-and-response, with short arpeggios and a tiny synth beat.
const PARTY_MELODY: readonly (number | null)[] = [
  79, 83, null, 86, 83, null, 81, 79,
  null, 74, 79, null, 83, 81, null, 79,
  76, null, 79, 83, null, 86, 83, 79,
  78, 79, null, 83, 81, null, 79, null,
  84, 83, 79, null, 76, null, 79, 83,
  84, null, 88, 86, null, 84, 83, null,
  81, 78, null, 74, 78, 81, null, 86,
  83, null, 81, 78, 79, null, null, null,
];
const PARTY_CHORDS: readonly (readonly number[])[] = [
  [43, 59, 62, 67], [40, 55, 59, 64], [36, 60, 64, 67], [38, 57, 62, 66],
];

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export function createPetAudio(): PetAudio {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  const page = typeof document === 'undefined' ? undefined : document;
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let filter: BiquadFilterNode | undefined;
  let musicBus: GainNode | undefined;
  let effectsBus: GainNode | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let unlocked = false;
  let musicEnabled = false;
  let effectsEnabled = false;
  let musicPaused = false;
  let musicTrack: PetMusicTrack = DEFAULT_MUSIC_TRACK;
  let stepSeconds = 60 / PET_MUSIC_TRACKS.find(track => track.id === DEFAULT_MUSIC_TRACK)!.bpm / 2;
  let step = 0;
  let nextStepAt = 0;
  let lastEffectAt = -Infinity;
  const voices = new Set<Voice>();
  const hidden = () => page?.visibilityState === 'hidden';
  const running = () => !disposed && unlocked && context?.state === 'running' && !hidden();
  const wantsMusic = () => running() && musicEnabled && !musicPaused;

  function disconnect(voice: Voice) {
    voices.delete(voice);
    voice.oscillator.onended = null;
    voice.oscillator.disconnect();
    voice.envelope.disconnect();
  }

  function stopVoices(channel?: Channel, immediate = false) {
    if (!context) return;
    const now = context.currentTime;
    for (const voice of [...voices]) {
      if (channel && voice.channel !== channel) continue;
      // Cancel future notes too; a short fade avoids a hard edge when muting.
      voice.envelope.gain.cancelScheduledValues(now);
      voice.envelope.gain.setTargetAtTime(0, now, 0.005);
      try { voice.oscillator.stop(now + (immediate ? 0 : 0.025)); } catch { /* Already ended. */ }
      if (immediate) disconnect(voice);
    }
  }

  function tone(
    channel: Channel, midi: number, at: number, duration: number,
    volume: number, shape: OscillatorType = 'square', slideTo?: number,
  ) {
    if (!context || !running() || voices.size >= MAX_VOICES) return;
    if (channel === 'music' ? !wantsMusic() : !effectsEnabled) return;
    const bus = channel === 'music' ? musicBus : effectsBus;
    if (!bus) return;
    const start = Math.max(at, context.currentTime + 0.005);
    const end = start + duration;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(frequency(midi), start);
    if (slideTo !== undefined) oscillator.frequency.exponentialRampToValueAtTime(frequency(slideTo), end);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + Math.min(0.012, duration / 5));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.gain.setValueAtTime(0, end + 0.008);
    oscillator.connect(envelope);
    envelope.connect(bus);
    const voice = { oscillator, envelope, channel, end: end + 0.02 };
    voices.add(voice);
    oscillator.onended = () => disconnect(voice);
    oscillator.start(start);
    oscillator.stop(voice.end);
  }

  function scheduleStep(at: number) {
    const position = step % 64;
    const chordIndex = Math.floor(position / 16);
    if (musicTrack === 'pixel-party') {
      const chord = PARTY_CHORDS[chordIndex];
      if (position % 2 === 0) {
        const bass = chord[0] + (position % 8 === 6 ? 12 : position % 8 === 2 ? 7 : 0);
        tone('music', bass, at, stepSeconds * 0.72, 0.16, 'triangle');
      } else {
        tone('music', chord[1 + Math.floor(position / 2) % 3] + 12, at, stepSeconds * 0.42, 0.04);
      }
      const lead = PARTY_MELODY[position];
      if (lead !== null) tone('music', lead, at, stepSeconds * 0.68, 0.07);
      if (position % 8 === 0) tone('music', 48, at, 0.12, 0.13, 'sine', 28);
    } else {
      const chord = DAYDREAM_CHORDS[chordIndex];
      if (position % 8 === 0) tone('music', chord[0], at, stepSeconds * 3.3, 0.2, 'triangle');
      if (position % 8 === 4) tone('music', chord[0] + 7, at, stepSeconds * 2, 0.11, 'triangle');
      if (position % 4 === 2) {
        const harmony = chord[1 + Math.floor(position / 4) % 3];
        tone('music', harmony, at, stepSeconds * 1.7, 0.065, 'triangle');
      }
      const lead = DAYDREAM_MELODY[position];
      if (lead !== null) tone('music', lead, at, stepSeconds * 1.2, 0.068);
      // A quiet distant sparkle marks the halfway point without a loud loop seam.
      if (position === 32) tone('music', 91, at, stepSeconds * 2.4, 0.025, 'sine');
    }
    step = (step + 1) % 64;
  }

  function schedule() {
    if (!context || !wantsMusic()) return;
    const now = context.currentTime;
    for (const voice of voices) if (voice.end < now) disconnect(voice);
    // A throttled tab must never catch up by playing missed notes all at once.
    if (nextStepAt < now - LOOKAHEAD_SECONDS) nextStepAt = now + 0.025;
    while (nextStepAt < now + LOOKAHEAD_SECONDS) {
      scheduleStep(nextStepAt);
      nextStepAt += stepSeconds;
    }
  }

  function syncMusic() {
    if (!wantsMusic()) {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      stopVoices('music');
      return;
    }
    if (timer !== undefined || !context) return;
    nextStepAt = context.currentTime + 0.035;
    schedule();
    timer = setInterval(schedule, 35);
  }

  function onStateChange() {
    syncMusic();
  }

  async function onVisibilityChange() {
    if (disposed || !context || !unlocked) return;
    if (hidden()) {
      syncMusic();
      stopVoices(undefined, true);
      try { await context.suspend(); } catch { /* Page lifecycle may close audio. */ }
    } else {
      try { await context.resume(); } catch { /* Another user gesture can unlock it. */ }
      if (!disposed) syncMusic();
    }
  }

  page?.addEventListener('visibilitychange', onVisibilityChange);

  return {
    async unlock() {
      if (disposed || !Context || hidden()) return false;
      try {
        if (!context) {
          context = new Context({ latencyHint: 'interactive' });
          master = context.createGain();
          master.gain.value = 0.45;
          filter = context.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 2400;
          filter.Q.value = 0.35;
          musicBus = context.createGain();
          musicBus.gain.value = 0.96;
          effectsBus = context.createGain();
          effectsBus.gain.value = 0.34;
          musicBus.connect(filter);
          effectsBus.connect(filter);
          filter.connect(master);
          master.connect(context.destination);
          context.addEventListener('statechange', onStateChange);
        }
        // resume() is called directly within the input gesture, before yielding.
        await context.resume();
        if (disposed) return false;
        unlocked = context.state === 'running';
        // Visibility may change while the browser is fulfilling resume().
        if (hidden() && unlocked) await onVisibilityChange();
        syncMusic();
        return unlocked;
      } catch {
        unlocked = false;
        syncMusic();
        return false;
      }
    },
    setMusicEnabled(enabled) {
      if (musicEnabled === enabled || disposed) return;
      musicEnabled = enabled;
      syncMusic();
    },
    setMusicTrack(track) {
      if (disposed || track === musicTrack) return;
      const option = PET_MUSIC_TRACKS.find(option => option.id === track);
      if (!option) return;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      stopVoices('music');
      musicTrack = track;
      stepSeconds = 60 / option.bpm / 2;
      step = 0;
      nextStepAt = 0;
      syncMusic();
    },
    setEffectsEnabled(enabled) {
      if (effectsEnabled === enabled || disposed) return;
      effectsEnabled = enabled;
      if (!enabled) stopVoices('effects');
    },
    setMusicPaused(paused) {
      if (musicPaused === paused || disposed) return;
      musicPaused = paused;
      syncMusic();
    },
    play(sound) {
      if (!context || !running() || !effectsEnabled) return;
      const at = context.currentTime + 0.01;
      // Keep rapid repeated UI clicks from stacking into a loud burst.
      if (at - lastEffectAt < 0.08 && sound !== 'rarity') return;
      lastEffectAt = at;
      const notes = (pitches: readonly number[], gap: number, duration = 0.16, volume = 0.16) => {
        pitches.forEach((midi, index) => tone('effects', midi, at + index * gap, duration, volume));
      };
      switch (sound) {
        case 'pet':
          tone('effects', 67, at, 0.4, 0.11, 'triangle');
          notes([76, 79, 84], 0.095, 0.22, 0.14);
          break;
        case 'feed':
          tone('effects', 48, at, 0.055, 0.18, 'triangle', 60);
          notes([72, 76, 79], 0.09, 0.105, 0.16);
          break;
        case 'poop':
          // Playful little bubbles, with no recorded/body sounds.
          tone('effects', 60, at, 0.12, 0.22, 'sine', 43);
          tone('effects', 55, at + 0.13, 0.14, 0.19, 'sine', 41);
          tone('effects', 72, at + 0.29, 0.2, 0.16, 'triangle', 67);
          break;
        case 'play': notes([72, 79, 81, 84], 0.085, 0.18, 0.14); break;
        case 'launch':
          notes([60, 64, 67, 72, 76, 79], 0.085, 0.19, 0.13);
          tone('effects', 84, at + 0.5, 0.55, 0.13, 'sine');
          break;
        case 'rarity':
          notes([72, 76, 79, 84], 0.14, 0.35, 0.13);
          tone('effects', 91, at + 0.55, 0.7, 0.12, 'sine');
          tone('effects', 84, at + 0.55, 0.6, 0.08, 'triangle');
          break;
        case 'select': tone('effects', 79, at, 0.075, 0.085, 'triangle'); break;
      }
    },
    getStatus() { return { supported: Boolean(Context), unlocked: !disposed && unlocked && context?.state === 'running' }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      page?.removeEventListener('visibilitychange', onVisibilityChange);
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      stopVoices(undefined, true);
      context?.removeEventListener('statechange', onStateChange);
      musicBus?.disconnect();
      effectsBus?.disconnect();
      filter?.disconnect();
      master?.disconnect();
      if (context) void context.close().catch(() => {});
      unlocked = false;
    },
  };
}
