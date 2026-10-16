export const PITCHES = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
export const INTERVALS = [
  { semitones: 0, label: 'Unison' },
  { semitones: 2, label: 'Major 2nd' },
  { semitones: 4, label: 'Major 3rd' },
  { semitones: 5, label: 'Perfect 4th' },
  { semitones: 7, label: 'Perfect 5th' }
];

export function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToName(midi) {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function centsBetween(actualHz, targetHz) {
  return 1200 * Math.log2(actualHz / targetHz);
}

export function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
