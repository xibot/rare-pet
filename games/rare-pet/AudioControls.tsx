import './audio-controls.css';
import { PET_MUSIC_TRACKS, type PetMusicTrack } from './audio';

type AudioControlsProps = {
  music: boolean;
  effects: boolean;
  track: PetMusicTrack;
  onMusic: () => void;
  onEffects: () => void;
  onTrack: (track: PetMusicTrack) => void;
  available: boolean;
  status?: string;
};

function MusicIcon() {
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    <path d="M6 2h8v10h-2V5H8v8H6V2ZM2 11h4v4H2v-4Zm6-1h4v4H8v-4Z" />
  </svg>;
}

function EffectsIcon() {
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    <path d="M1 6h3V4h2V2h2v12H6v-2H4v-2H1V6Zm9-1h2v6h-2V5Zm2-3h2v3h-2V2Zm2 3h2v6h-2V5Zm-2 6h2v3h-2v-3Z" />
  </svg>;
}

export function AudioControls({ music, effects, track, onMusic, onEffects, onTrack, available, status }: AudioControlsProps) {
  const message = status || (!available ? 'Sound is unavailable in this browser.' : '');
  return <div className="pet-audio-controls" role="group" aria-label="RarePet sound">
    <span className={`pet-audio-status${message ? '' : ' pet-audio-status-empty'}`} role="status" aria-live="polite">{message}</span>
    <label className="pet-audio-track">
      <span className="pet-audio-track-label">TRACK</span>
      <select aria-label="Soundtrack" value={track} disabled={!available} onChange={event => onTrack(event.target.value as PetMusicTrack)}>
        {PET_MUSIC_TRACKS.map(option => <option key={option.id} value={option.id}>{option.name.toUpperCase()} · {option.mood.toUpperCase()} · {option.bpm} BPM</option>)}
      </select>
    </label>
    <div className="pet-audio-buttons">
      <button type="button" onClick={onMusic} disabled={!available} aria-pressed={music} aria-label={`Turn music ${music ? 'off' : 'on'}`}>
        <MusicIcon />
        <span>MUSIC {music ? 'ON' : 'OFF'}</span>
      </button>
      <button type="button" onClick={onEffects} disabled={!available} aria-pressed={effects} aria-label={`Turn effects ${effects ? 'off' : 'on'}`}>
        <EffectsIcon />
        <span>FX {effects ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  </div>;
}
