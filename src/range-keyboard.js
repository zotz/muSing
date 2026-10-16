import { hzToMidi, midiToHz, midiToName } from './music.js';

const SVG = 'http://www.w3.org/2000/svg';
const WHITE_WIDTH = 28;
const whiteClasses = [0, 2, 4, 5, 7, 9, 11];
const whiteIndex = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
const blackBefore = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };

function keyCenter(note, firstC) {
  const offset = note - firstC;
  const octave = Math.floor(offset / 12);
  const pitchClass = ((offset % 12) + 12) % 12;
  const base = octave * 7 * WHITE_WIDTH;
  return pitchClass in whiteIndex
    ? base + (whiteIndex[pitchClass] + 0.5) * WHITE_WIDTH
    : base + (blackBefore[pitchClass] + 1) * WHITE_WIDTH;
}

export function keyboardPosition(midi, firstC) {
  const lower = Math.floor(midi);
  const fraction = midi - lower;
  return keyCenter(lower, firstC) * (1 - fraction) + keyCenter(lower + 1, firstC) * fraction;
}

function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function makePlayable(node, hz, label, onPlay) {
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-label', `Play ${label}`);
  node.addEventListener('click', () => onPlay(hz, label));
  node.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPlay(hz, label);
    }
  });
  return node;
}

export function renderRangeKeyboard(container, values, onPlay = () => {}) {
  container.replaceChildren();
  const entries = [
    { kind: 'low', label: 'Low', color: '#82c6d4', hz: values.low },
    { kind: 'happy', label: 'Happy', color: '#e8c16b', hz: values.happy },
    { kind: 'high', label: 'High', color: '#df9b9b', hz: values.high }
  ].filter(entry => Number.isFinite(entry.hz) && entry.hz > 0)
    .map(entry => ({ ...entry, midi: hzToMidi(entry.hz) }));

  const firstC = Math.floor(Math.min(48, ...entries.map(entry => entry.midi)) / 12) * 12;
  const lastC = (Math.floor(Math.max(71, ...entries.map(entry => entry.midi)) / 12) + 1) * 12;
  const width = (lastC - firstC) / 12 * 7 * WHITE_WIDTH;
  const svg = svgElement('svg', { viewBox: `0 0 ${width} 158`, width, height: 158, role: 'group', 'aria-label': 'Playable piano keyboard' });
  const title = svgElement('title');
  title.textContent = 'Click a key to hear its note. Colored markers play captured pitches.';
  svg.append(title);

  const low = entries.find(entry => entry.kind === 'low');
  const high = entries.find(entry => entry.kind === 'high');
  const range = low && high && low.midi < high.midi ? [low.midi, high.midi] : null;
  for (let note = firstC; note < lastC; note += 12) {
    whiteClasses.forEach((pitchClass, index) => {
      const midi = note + pitchClass;
      const x = ((note - firstC) / 12 * 7 + index) * WHITE_WIDTH;
      const inRange = range && midi >= range[0] && midi <= range[1];
      const key = svgElement('rect', { x, y: 31, width: WHITE_WIDTH, height: 99, rx: 2, fill: inRange ? '#c9e1cf' : '#f1f1e9', stroke: '#44545b', 'stroke-width': 1 });
      svg.append(makePlayable(key, midiToHz(midi), midiToName(midi), onPlay));
      if (pitchClass === 0) {
        const label = svgElement('text', { x: x + WHITE_WIDTH / 2, y: 150, 'text-anchor': 'middle', fill: '#a9bcbc', 'font-size': 11, 'pointer-events': 'none' });
        label.textContent = midiToName(midi);
        svg.append(label);
      }
    });
  }
  for (let note = firstC; note < lastC; note += 12) {
    for (const [pitchClassText, before] of Object.entries(blackBefore)) {
      const pitchClass = Number(pitchClassText);
      const midi = note + pitchClass;
      const x = ((note - firstC) / 12 * 7 + before + 1) * WHITE_WIDTH - 8.5;
      const inRange = range && midi >= range[0] && midi <= range[1];
      const key = svgElement('rect', { x, y: 31, width: 17, height: 62, rx: 2, fill: inRange ? '#426d63' : '#26373d', stroke: '#16262d', 'stroke-width': 1 });
      svg.append(makePlayable(key, midiToHz(midi), midiToName(midi), onPlay));
    }
  }
  if (range) {
    svg.append(svgElement('line', { x1: keyboardPosition(range[0], firstC), x2: keyboardPosition(range[1], firstC), y1: 19, y2: 19, stroke: '#a6d8ac', 'stroke-width': 5, 'stroke-linecap': 'round', 'pointer-events': 'none' }));
  }
  entries.forEach(entry => {
    const x = keyboardPosition(entry.midi, firstC);
    svg.append(svgElement('line', { x1: x, x2: x, y1: 13, y2: 119, stroke: entry.color, 'stroke-width': 2, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
    const marker = svgElement('circle', { cx: x, cy: 19, r: 8, fill: entry.color, stroke: '#192631', 'stroke-width': 2 });
    svg.append(makePlayable(marker, entry.hz, `${entry.label} captured note`, onPlay));
  });
  container.append(svg);
}
