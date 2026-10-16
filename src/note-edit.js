export const MIN_NOTE_SECONDS = 0.04;

export function noteAtTime(notes, time) {
  return notes.find(note => note.start <= time && time < note.end) ?? null;
}

export function visiblePitchRange(notes, mode = 'all-2', selected = null) {
  if (!notes.length) return { low: 59, high: 61 };
  const pitches = notes.map(note => note.targetMidi ?? note.midi).sort((a, b) => a - b);
  const [scope, amount] = mode.split('-');
  const padding = Number(amount) || 2;
  if (scope === 'focus') {
    const center = selected ? selected.targetMidi ?? selected.midi : pitches[Math.floor(pitches.length / 2)];
    return { low: center - padding, high: center + padding };
  }
  return { low: pitches[0] - padding, high: pitches.at(-1) + padding };
}

export function resizeNote(notes, index, edge, time, duration) {
  const note = notes[index];
  if (!note || !Number.isFinite(time)) return false;
  const previousEnd = index ? notes[index - 1].end : 0;
  const nextStart = index + 1 < notes.length ? notes[index + 1].start : duration;
  if (edge === 'start') {
    const next = Math.max(previousEnd, Math.min(note.end - MIN_NOTE_SECONDS, time));
    if (next === note.start) return false;
    note.start = next;
  } else if (edge === 'end') {
    const next = Math.max(note.start + MIN_NOTE_SECONDS, Math.min(nextStart, time));
    if (next === note.end) return false;
    note.end = next;
  } else return false;
  return true;
}

export function splitNote(notes, index, time) {
  const note = notes[index];
  if (!note || time < note.start + MIN_NOTE_SECONDS || time > note.end - MIN_NOTE_SECONDS) return null;
  const right = { ...note, start: time };
  note.end = time;
  notes.splice(index + 1, 0, right);
  return right;
}

export function mergeWithNext(notes, index) {
  if (index < 0 || index + 1 >= notes.length) return null;
  const first = notes[index];
  const second = notes[index + 1];
  first.end = second.end;
  notes.splice(index + 1, 1);
  return first;
}

export function addNoteInGap(notes, time, duration, source = null) {
  if (!Number.isFinite(time) || time < 0 || time >= duration) return null;
  const index = notes.findIndex(note => note.start > time);
  const insertAt = index < 0 ? notes.length : index;
  const previous = notes[insertAt - 1];
  const next = notes[insertAt];
  const gapStart = previous?.end ?? 0;
  const gapEnd = next?.start ?? duration;
  if (time < gapStart || time >= gapEnd || gapEnd - gapStart < MIN_NOTE_SECONDS) return null;
  const start = Math.max(gapStart, Math.min(time - 0.06, gapEnd - MIN_NOTE_SECONDS));
  const end = Math.min(gapEnd, Math.max(start + MIN_NOTE_SECONDS, time + 0.06));
  const reference = source ?? previous ?? next;
  const note = { start, end, midi: reference?.midi ?? 60, hz: reference?.hz ?? 261.63, cents: reference?.cents ?? 0, targetMidi: null, manual: true };
  notes.splice(insertAt, 0, note);
  return note;
}
