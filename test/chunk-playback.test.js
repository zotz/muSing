import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkRanges } from '../src/chunk-playback.js';

const notes = [
  { start: 0.2, end: 0.6, midi: 60 },
  { start: 0.7, end: 1, midi: 62 },
  { start: 1.5, end: 1.9, midi: 64 }
];

test('tap and note-start chunks include the lead-in and tail', () => {
  assert.deepEqual(chunkRanges('taps', notes, [0.3, 0.8], 2).map(({ start, end }) => [start, end]), [[0, 0.3], [0.3, 0.8], [0.8, 2]]);
  assert.deepEqual(chunkRanges('note-starts', notes, [], 2).map(({ start, end }) => [start, end]), [[0, 0.2], [0.2, 0.7], [0.7, 1.5], [1.5, 2]]);
});

test('exact note and phrase chunks use note ends and rest gaps', () => {
  assert.deepEqual(chunkRanges('notes', notes, [], 2).map(({ start, end }) => [start, end]), [[0.2, 0.6], [0.7, 1], [1.5, 1.9]]);
  assert.deepEqual(chunkRanges('phrases', notes, [], 2).map(({ start, end }) => [start, end]), [[0.2, 1], [1.5, 1.9]]);
  assert.deepEqual(chunkRanges('taps', notes, [], 2), []);
});
