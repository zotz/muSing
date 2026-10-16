const TICKS_PER_BEAT = 480;

function editedPitch(note) {
  return Math.max(0, Math.min(127, Math.round(note.targetMidi ?? note.midi)));
}

function orderedNotes(notes) {
  return notes.filter(note => Number.isFinite(note.start) && Number.isFinite(note.end) && note.end > note.start)
    .sort((a, b) => a.start - b.start);
}

function abcPitch(midi) {
  const names = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
  const pitchClass = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const base = names[pitchClass];
  if (octave >= 5) return base.toLowerCase() + "'".repeat(octave - 5);
  return base + ','.repeat(Math.max(0, 4 - octave));
}

export function notesToAbc(notes, bpm = 120) {
  const tempo = Math.max(30, Math.min(300, Math.round(bpm)));
  const unitsPerSecond = tempo / 15; // Sixteenth notes per second.
  let cursor = 0;
  const tokens = [];
  for (const note of orderedNotes(notes)) {
    const start = Math.max(cursor, Math.round(note.start * unitsPerSecond));
    const end = Math.max(start + 1, Math.round(note.end * unitsPerSecond));
    if (start > cursor) tokens.push(`z${start - cursor}`);
    tokens.push(`${abcPitch(editedPitch(note))}${end - start}`);
    cursor = end;
  }
  return `X:1\nT:muSing edited notes\nM:none\nL:1/16\nQ:1/4=${tempo}\nK:C\n${tokens.join(' ') || 'z1'}\n`;
}

function variableLength(value) {
  const bytes = [value & 0x7f];
  while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

function chunk(name, data) {
  const length = data.length;
  return [...name].map(char => char.charCodeAt(0)).concat([(length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255], data);
}

export function notesToMidi(notes, bpm = 120) {
  const tempo = Math.max(30, Math.min(300, Math.round(bpm)));
  const microsPerBeat = Math.round(60_000_000 / tempo);
  const tempoBytes = [(microsPerBeat >>> 16) & 255, (microsPerBeat >>> 8) & 255, microsPerBeat & 255];
  const events = [];
  for (const note of orderedNotes(notes)) {
    const pitch = editedPitch(note);
    const start = Math.max(0, Math.round(note.start * tempo * TICKS_PER_BEAT / 60));
    const end = Math.max(start + 1, Math.round(note.end * tempo * TICKS_PER_BEAT / 60));
    events.push({ tick: start, order: 1, data: [0x90, pitch, 88] });
    events.push({ tick: end, order: 0, data: [0x80, pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track = [0, 0xff, 0x51, 3, ...tempoBytes];
  let prior = 0;
  for (const event of events) {
    track.push(...variableLength(event.tick - prior), ...event.data);
    prior = event.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  return new Uint8Array([...chunk('MThd', [0, 0, 0, 1, 0x01, 0xe0]), ...chunk('MTrk', track)]);
}
