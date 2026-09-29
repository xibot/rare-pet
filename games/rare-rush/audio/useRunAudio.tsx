import { useEffect, useRef, useState } from 'react';
import type { RunState } from '../twist/engine.ts';
import { RushAudio, type AudioPreferences } from './run-audio.ts';
import './audio.css';

const PREFERENCE_KEY = 'rare-rush-audio-v1';
function readPreferences(): AudioPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? '{}');
    return {
      music: typeof value?.music === 'boolean' ? value.music : true,
      effects: typeof value?.effects === 'boolean' ? value.effects : true,
    };
  } catch { return { music: true, effects: true }; }
}

/** Own audio above a changing run/result view when its end cue should continue. */
export function useAudioController(enabled = true) {
  const [preferences, setPreferences] = useState(readPreferences);
  const controller = useRef<RushAudio | null>(null);
  const focused = useRef(true);
  const preferencesRef = useRef(preferences); preferencesRef.current = preferences;
  useEffect(() => {
    if (!enabled) return;
    const audio = new RushAudio(); controller.current = audio;
    audio.setEnabled(preferencesRef.current);
    const unlock = () => { focused.current = true; void audio.unlock(); };
    const silence = () => audio.pause();
    const blur = () => { focused.current = false; silence(); };
    const focus = () => { focused.current = true; };
    const visibility = () => { if (document.hidden) silence(); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', silence);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock);
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); window.removeEventListener('pagehide', silence);
      document.removeEventListener('visibilitychange', visibility);
      audio.dispose(); if (controller.current === audio) controller.current = null;
    };
  }, [enabled]);
  const toggle = (bus: keyof AudioPreferences) => {
    const next = { ...preferencesRef.current, [bus]: !preferencesRef.current[bus] };
    preferencesRef.current = next; setPreferences(next);
    try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify(next)); } catch { /* Sandboxed Arcade can still play sound. */ }
    const audio = controller.current;
    audio?.setEnabled(next);
    void audio?.unlock();
  };
  return {
    musicEnabled: preferences.music, effectsEnabled: preferences.effects,
    toggleMusic: () => toggle('music'), toggleEffects: () => toggle('effects'),
    unlock: () => controller.current?.unlock(),
    update: (run: RunState, playing: boolean) => controller.current?.update(run, playing && focused.current && !document.hidden),
    pause: () => controller.current?.pause(),
  };
}

export function useRunAudio(run: RunState, playing: boolean, enabled = true) {
  const audio = useAudioController(enabled);
  // The engine mutates one run object; observe the latest frame on every render.
  useEffect(() => { audio.update(run, playing); });
  return audio;
}

export function RunAudioControls({ audio, onInteract }: { audio: ReturnType<typeof useRunAudio>; onInteract?: () => void }) {
  return <span className="rush-audio-controls" role="group" aria-label="Game audio">
    <button type="button" className="rush-audio-toggle" aria-pressed={audio.musicEnabled}
      aria-label={audio.musicEnabled ? 'Mute sound' : 'Turn sound on'} title={audio.musicEnabled ? 'Mute soundtrack' : 'Play original 8-bit soundtrack'}
      onClick={() => { audio.toggleMusic(); onInteract?.(); }}>MUSIC {audio.musicEnabled ? 'ON' : 'OFF'}</button>
    <button type="button" className="rush-audio-toggle" aria-pressed={audio.effectsEnabled}
      aria-label={audio.effectsEnabled ? 'Mute effects' : 'Turn effects on'} title="Game sound effects"
      onClick={() => { audio.toggleEffects(); onInteract?.(); }}>SFX {audio.effectsEnabled ? 'ON' : 'OFF'}</button>
  </span>;
}
