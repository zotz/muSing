const MIN_CHUNK = 0.015;

function validTimes(times, duration) {
  return [...new Set(times.filter(time => Number.isFinite(time) && time >= 0 && time < duration).map(time => Math.round(time * 1000) / 1000))].sort((a, b) => a - b);
}

export function chunkRanges(kind, notes, taps, duration) {
  if (!(duration > 0)) return [];
  const sortedNotes = notes.filter(note => Number.isFinite(note.start) && Number.isFinite(note.end) && note.end > note.start)
    .map(note => ({ ...note, start: Math.max(0, note.start), end: Math.min(duration, note.end) }))
    .filter(note => note.end - note.start >= MIN_CHUNK).sort((a, b) => a.start - b.start);
  if (kind === 'notes') return sortedNotes.map((note, index) => ({ start: note.start, end: note.end, label: `Note ${index + 1}` }));
  if (kind === 'phrases') {
    const phrases = [];
    for (const note of sortedNotes) {
      const last = phrases.at(-1);
      if (last && note.start - last.end <= 0.15) last.end = Math.max(last.end, note.end);
      else phrases.push({ start: note.start, end: note.end, label: `Phrase ${phrases.length + 1}` });
    }
    return phrases;
  }
  const boundaries = validTimes(kind === 'taps' ? taps : sortedNotes.map(note => note.start), duration);
  if (!boundaries.length) return [];
  const edges = boundaries[0] > MIN_CHUNK ? [0, ...boundaries, duration] : [...boundaries, duration];
  return edges.slice(0, -1).flatMap((start, index) => edges[index + 1] - start >= MIN_CHUNK
    ? [{ start, end: edges[index + 1], label: start === 0 && boundaries[0] > MIN_CHUNK ? 'Lead-in' : `${kind === 'taps' ? 'Tap' : 'Note start'} ${index + 1 - Number(boundaries[0] > MIN_CHUNK)}` }]
    : []);
}
