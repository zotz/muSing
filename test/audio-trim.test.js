import test from 'node:test';
import assert from 'node:assert/strict';
import { quietEdgeBounds, cropTimedNotes } from '../src/audio-trim.js';

test('finds quiet edges with a little phrase margin', () => {
  const sampleRate = 12000;
  const samples = Float32Array.from({ length: sampleRate }, (_, index) => {
    const time = index / sampleRate;
    return time >= 0.2 && time < 0.7 ? 0.2 * Math.sin(2 * Math.PI * 220 * time) : 0;
  });
  const { start, end } = quietEdgeBounds(samples, sampleRate);
  assert.ok(start >= 0.17 && start <= 0.2);
  assert.ok(end >= 0.7 && end <= 0.73);
});

test('moves and clips notes to the shorter recording', () => {
  const notes = [{ start: 0.1, end: 0.4, midi: 60 }, { start: 0.6, end: 0.9, midi: 62 }];
  assert.deepEqual(cropTimedNotes(notes, 0.2, 0.8).map(note => [Number(note.start.toFixed(2)), Number(note.end.toFixed(2)), note.midi]), [[0, 0.2, 60], [0.4, 0.6, 62]]);
});
