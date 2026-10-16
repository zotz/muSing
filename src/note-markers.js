import { hzToMidi, median } from './music.js';

export function alignedMarkers(taps, anchor, shift, duration) {
  if (!taps.length) return [];
  return taps.map(tap => anchor + shift + tap - taps[0])
    .filter(time => time >= 0 && time < duration);
}

// Each tap starts one note. Pitch still comes from the voice, and an automatic
// release before the next tap is retained so a rest can remain a rest.
export function notesFromMarkers(markers, frames, automaticNotes, duration) {
  const notes = [];
  for (let index = 0; index < markers.length; index++) {
    const start = markers[index];
    const limit = markers[index + 1] ?? duration;
    if (limit - start < 0.04) continue;
    const voiced = frames.filter(frame => frame.time >= start && frame.time < limit && frame.hz && frame.confidence >= 0.77);
    if (!voiced.length) continue;
    const hz = median(voiced.map(frame => frame.hz));
    const midi = Math.round(hzToMidi(hz));
    const overlaps = automaticNotes.filter(note => note.end > start && note.start < limit);
    const lastEnd = overlaps.length ? Math.max(...overlaps.map(note => note.end)) : voiced.at(-1).time + 0.02;
    const end = Math.min(limit, Math.max(start + 0.04, lastEnd));
    notes.push({ start, end, midi, hz, cents: Math.round((hzToMidi(hz) - midi) * 100) });
  }
  return notes;
}
