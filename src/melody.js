import { midiToHz } from './music.js';

export function melodyEvents(notes) {
  const sorted = notes
    .filter(note => Number.isFinite(note.midi) && Number.isFinite(note.start) && Number.isFinite(note.end) && note.end > note.start)
    .sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];
  return sorted.map(note => ({
    start: Math.max(0, note.start),
    duration: Math.max(0.08, note.end - note.start),
    hz: midiToHz(Math.round(note.midi))
  }));
}
