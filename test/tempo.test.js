import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateNotePulse } from '../src/tempo.js';

const notesAt = starts => starts.map(start => ({ start, end: start + 0.2 }));

test('estimates the pulse of evenly spaced note starts', () => {
  assert.deepEqual(estimateNotePulse(notesAt([0, 0.5, 1, 1.5, 2, 2.5])), { bpm: 120, intervals: 5 });
});

test('does not assign a tempo to short or irregular phrases', () => {
  assert.equal(estimateNotePulse(notesAt([0, 0.5, 1, 1.5])), null);
  assert.equal(estimateNotePulse(notesAt([0, 0.3, 0.9, 1.8, 2.2, 3.4])), null);
});
