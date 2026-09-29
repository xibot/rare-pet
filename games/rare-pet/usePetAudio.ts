import { useCallback, useEffect, useRef, useState } from 'react';
import { createPetAudio, PET_MUSIC_TRACKS, type PetAudio, type PetMusicTrack, type PetSound } from './audio';

type Preferences = { music: boolean; effects: boolean; track: PetMusicTrack };
const preferenceKey = 'rarepet:audio:v1';
function savedPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
    const track = PET_MUSIC_TRACKS.find(track => track.id === value?.track)?.id ?? 'daydream';
    return { music: value?.music === true, effects: value?.effects === true, track };
  } catch { return { music: false, effects: false, track: 'daydream' }; }
}

export function usePetAudio(musicPaused: boolean) {
  const [preferences, setPreferences] = useState(savedPreferences);
  const preferencesRef = useRef(preferences);
  const engine = useRef<PetAudio | null>(null);
  const unlocking = useRef<Promise<boolean> | null>(null);
  const [available, setAvailable] = useState(true);
  const [status, setStatus] = useState(() => preferences.music || preferences.effects ? 'Sound resumes after your first tap.' : '');

  const activate = useCallback((): Promise<boolean> => {
    const audio = engine.current;
    if (!audio || !(preferencesRef.current.music || preferencesRef.current.effects)) return Promise.resolve(false);
    if (audio.getStatus().unlocked) return Promise.resolve(true);
    if (unlocking.current) return unlocking.current;
    const pending = audio.unlock().then(ok => {
      if (engine.current === audio && (preferencesRef.current.music || preferencesRef.current.effects)) {
        setStatus(ok ? '' : 'Your browser has paused sound. Try switching sound off and on.');
      }
      return ok;
    }).catch(() => {
      if (engine.current === audio) setStatus('Sound could not start in this browser.');
      return false;
    }).finally(() => { if (unlocking.current === pending) unlocking.current = null; });
    unlocking.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    const audio = createPetAudio(); engine.current = audio;
    audio.setMusicTrack(preferencesRef.current.track);
    audio.setMusicEnabled(preferencesRef.current.music);
    audio.setEffectsEnabled(preferencesRef.current.effects);
    setAvailable(audio.getStatus().supported);
    if (!audio.getStatus().supported) setStatus('Sound is unavailable in this browser.');
    // Saved preferences are consent, but playback still waits for a fresh browser gesture.
    const resume = () => { void activate(); };
    document.addEventListener('pointerdown', resume, { capture: true, passive: true });
    document.addEventListener('keydown', resume, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', resume, { capture: true });
      document.removeEventListener('keydown', resume, { capture: true });
      if (engine.current === audio) { engine.current = null; unlocking.current = null; }
      audio.dispose();
    };
  }, [activate]);

  useEffect(() => { engine.current?.setMusicPaused(musicPaused); }, [musicPaused]);

  const play = useCallback((sound: PetSound) => {
    if (!preferencesRef.current.effects) return;
    const audio = engine.current;
    // A first-tap care action may finish before AudioContext.resume() resolves.
    if (unlocking.current) {
      void unlocking.current.then(ok => {
        if (ok && engine.current === audio && preferencesRef.current.effects) audio?.play(sound);
      });
    } else audio?.play(sound);
  }, []);

  function savePreferences(next: Preferences) {
    preferencesRef.current = next; setPreferences(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { /* Audio works without storage. */ }
  }

  function toggle(key: 'music' | 'effects') {
    const next = { ...preferencesRef.current, [key]: !preferencesRef.current[key] };
    savePreferences(next);
    engine.current?.setMusicEnabled(next.music);
    engine.current?.setEffectsEnabled(next.effects);
    if (!next.music && !next.effects) setStatus('');
    if (next[key]) void activate().then(ok => { if (ok && key === 'effects' && preferencesRef.current.effects) play('select'); });
  }

  function chooseTrack(track: PetMusicTrack) {
    if (!preferencesRef.current.music || !PET_MUSIC_TRACKS.some(option => option.id === track)) return;
    savePreferences({ ...preferencesRef.current, track });
    engine.current?.setMusicTrack(track);
    if (preferencesRef.current.music) void activate();
  }

  return { ...preferences, available, status, play, onMusic: () => toggle('music'), onEffects: () => toggle('effects'), onTrack: chooseTrack };
}
