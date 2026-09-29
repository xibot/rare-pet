import type { RunState } from '../twist/engine.ts';
import { headingFor } from '../twist/presentation.ts';
import { effectNotes, musicStep, sixteenthSeconds, type AudioMode, type MusicScene, type SoundEffect } from './score.ts';
import { ChipSynth } from './synth.ts';

export interface AudioPreferences { music: boolean; effects: boolean }
type Snapshot = ReturnType<typeof snapshot>;
function snapshot(run: RunState) {
  return {
    seed: run.seed, mode: run.difficulty, elapsed: run.elapsed, duration: run.duration,
    status: run.status, reason: run.finishReason, coins: run.coins, bonus: run.bonusCoins,
    hearts: run.hearts, jumps: run.player.jumps, slide: run.player.slide,
    shield: run.shield, magnet: run.magnet, phase: run.phase, heading: headingFor(run),
    phaseIndex: run._phaseIndex, world: Math.min(2, Math.floor(run.elapsed / run.duration * 3)),
    remaining: Math.ceil(run.duration - run.elapsed),
  };
}

/** Presentation-only observer. Never consumes game RNG or changes replay inputs. */
export class RushAudio {
  private contextFactory: () => AudioContext;
  private context: AudioContext | null = null;
  private synth: ChipSynth | null = null;
  private preferences: AudioPreferences = { music: false, effects: false };
  private last: Snapshot | null = null;
  private playing = false;
  private active = false;
  private disposed = false;
  private unlocking: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private nextStep = 0;
  private lastCoinAt = -Infinity;
  private mode: AudioMode = 'normal';
  private scene: MusicScene = { world: 0, direction: 'right', urgent: false };

  constructor(options: { contextFactory?: () => AudioContext } = {}) {
    this.contextFactory = options.contextFactory ?? (() => new AudioContext({ latencyHint: 'interactive' }));
  }

  setEnabled(preferences: AudioPreferences) {
    if (this.disposed) return;
    this.preferences = { ...preferences };
    this.synth?.setBus('music', preferences.music);
    this.synth?.setBus('effects', preferences.effects);
    if (!preferences.music) this.stopMusic();
    if (!preferences.music && !preferences.effects) this.active = false;
    else this.activate();
  }

  /** Only call in a user interaction; no context is created for silent visitors. */
  async unlock(): Promise<boolean> {
    if (this.disposed || !this.preferences.music && !this.preferences.effects) return false;
    if (this.unlocking) return this.unlocking;
    this.unlocking = (async () => {
      try {
        if (!this.context) {
          this.context = this.contextFactory(); this.synth = new ChipSynth(this.context);
          this.synth.setBus('music', this.preferences.music); this.synth.setBus('effects', this.preferences.effects);
        }
        if (this.context.state === 'suspended') await this.context.resume();
        if (this.disposed) return false;
        this.activate();
        return this.context.state === 'running';
      } catch { return false; }
    })();
    try { return await this.unlocking; } finally { this.unlocking = null; }
  }

  update(run: RunState, playing: boolean) {
    if (this.disposed) return;
    const current = snapshot(run), previous = this.last, wasPlaying = this.playing;
    const newRun = !previous || current.seed !== previous.seed || current.mode !== previous.mode || current.elapsed < previous.elapsed;
    if (newRun) { this.pause(); this.nextStep = 0; this.lastCoinAt = -Infinity; }
    this.mode = current.mode;
    this.scene = { world: current.world, direction: current.phase === 'side' ? current.heading < 0 ? 'left' : 'right' : current.phase, urgent: current.remaining <= 12 };
    this.playing = playing && current.status === 'running';
    this.last = current;

    // Finished runs get one short outcome cue. Pause never produces a win cue.
    if (!newRun && previous?.status === 'running' && current.status === 'finished' && wasPlaying) {
      this.pause(); this.effect(current.reason === 'time' ? 'win' : 'lose'); return;
    }
    if (!newRun && current.status === 'finished') { this.stopMusic(); this.active = false; return; }
    if (!this.playing) { this.pause(); return; }
    this.activate();
    if (!previous || newRun || !wasPlaying) {
      if (current.elapsed < .15) this.effect('start');
      return;
    }
    // Seek/recovery/fast-forward must never replay a backlog of effects.
    const elapsed = current.elapsed - previous.elapsed;
    if (elapsed <= 0 || elapsed > .35) return;
    if (current.bonus > previous.bonus) this.effect('rare-coin');
    else if (current.coins > previous.coins) this.effect('coin', current.coins);
    if (current.hearts < previous.hearts) this.effect('hit');
    if (current.shield > previous.shield + 1 || previous.shield > 0 && current.shield === 0 && current.hearts === previous.hearts) this.effect('shield');
    if (current.magnet > previous.magnet + 1) this.effect('magnet');
    if (current.phase === 'side' && previous.phase === 'side') {
      if (current.jumps > previous.jumps) this.effect(current.jumps > 1 ? 'double-jump' : 'jump');
      if (current.slide && !previous.slide) this.effect('slide');
    }
    if (current.phaseIndex !== previous.phaseIndex) {
      if (current.phase === 'up' || current.phase === 'down') this.effect(current.phase);
      else if (current.heading < 0) this.effect('reverse');
    } else if (current.world !== previous.world) this.effect('world');
    if (current.remaining <= 5 && current.remaining > 0 && current.remaining !== previous.remaining) this.effect('countdown');
  }

  private activate() {
    if (!this.playing || this.disposed || this.context?.state !== 'running' || !this.synth) return;
    if (!this.preferences.music && !this.preferences.effects) return;
    this.active = true;
    if (this.preferences.music && this.timer === null) {
      this.nextTime = this.context.currentTime + .025;
      this.schedule();
      this.timer = setInterval(() => this.schedule(), 25);
    }
  }

  private schedule() {
    if (!this.active || !this.preferences.music || !this.context || !this.synth || this.context.state !== 'running') return;
    const now = this.context.currentTime, step = sixteenthSeconds(this.mode);
    if (this.nextTime < now - .1) this.nextTime = now + .02;
    // Short lookahead avoids timer jitter while leaving pause/direction changes responsive.
    while (this.nextTime < now + .12) {
      this.synth.schedule(musicStep(this.mode, this.nextStep, this.scene), this.nextTime, 'music');
      this.nextTime += step; this.nextStep = (this.nextStep + 1) % 256;
    }
  }

  private effect(effect: SoundEffect, variation = 0) {
    if (!this.preferences.effects || !this.synth || this.context?.state !== 'running') return;
    const now = this.context.currentTime;
    if (effect === 'coin') {
      if (now - this.lastCoinAt < .065) return;
      this.lastCoinAt = now;
    }
    this.synth.schedule(effectNotes(effect, this.mode, variation), now + .003, 'effects');
  }

  private stopMusic() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null; this.synth?.stop('music');
  }

  pause() {
    this.playing = false; this.active = false; this.stopMusic(); this.synth?.stop();
  }

  get diagnostics() {
    return { contextCreated: Boolean(this.context), active: this.active, timerActive: this.timer !== null, voices: this.synth?.activeVoices ?? 0 };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.pause(); this.synth?.dispose();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.synth = null;
  }
}
