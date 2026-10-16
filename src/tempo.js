import { median } from './music.js';

// A first-pass pulse estimate for clearly articulated solo phrases. Note starts
// can be subdivisions of a beat, so this is deliberately labelled approximate.
export function estimateNotePulse(notes) {
  const starts = notes
    .filter(note => Number.isFinite(note.start) && Number.isFinite(note.end) && note.end - note.start >= 0.08)
    .map(note => note.start)
    .sort((a, b) => a - b);
  const intervals = [];
  for (let index = 1; index < starts.length; index++) {
    const interval = starts[index] - starts[index - 1];
    if (interval >= 0.25 && interval <= 1.5) intervals.push(interval);
  }
  if (starts.length < 5 || intervals.length < 4) return null;

  const typical = median(intervals);
  const deviations = intervals.map(interval => Math.abs(interval - typical) / typical);
  const consistent = deviations.filter(deviation => deviation <= 0.16).length;
  if (consistent < Math.max(4, Math.ceil(intervals.length * 0.75))) return null;

  return { bpm: Math.round(60 / typical), intervals: intervals.length };
}

export function tappedBpm(taps) {
  const recent = taps.slice(-6);
  const intervals = recent.slice(1).map((time, index) => time - recent[index]);
  if (intervals.length < 2 || intervals.some(gap => gap < 200 || gap > 2000)) return null;
  return Math.round(60_000 / median(intervals));
}
