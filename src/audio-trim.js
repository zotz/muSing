// Find sustained audio near the edges using short RMS windows. A small margin
// preserves the beginning and release of the sung phrase.
export function quietEdgeBounds(samples, sampleRate, duration = samples.length / sampleRate) {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.01));
  const levels = [];
  for (let offset = 0; offset < samples.length; offset += windowSize) {
    let energy = 0;
    const end = Math.min(samples.length, offset + windowSize);
    for (let index = offset; index < end; index++) energy += samples[index] ** 2;
    levels.push(Math.sqrt(energy / (end - offset)));
  }
  const peak = levels.reduce((maximum, level) => Math.max(maximum, level), 0);
  if (peak < 0.012) return { start: 0, end: duration };
  const threshold = Math.max(0.008, peak * 0.06);
  const first = levels.findIndex(level => level >= threshold);
  const last = levels.findLastIndex(level => level >= threshold);
  if (first < 0 || last < first) return { start: 0, end: duration };
  const step = windowSize / sampleRate;
  return {
    start: Math.max(0, first * step - 0.02),
    end: Math.min(duration, (last + 1) * step + 0.02)
  };
}

export function cropTimedNotes(notes, start, end) {
  return notes.filter(note => note.end > start && note.start < end)
    .map(note => ({ ...note, start: Math.max(0, note.start - start), end: Math.min(end - start, note.end - start) }))
    .filter(note => note.end - note.start >= 0.04);
}
