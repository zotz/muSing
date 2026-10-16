import test from 'node:test';
import assert from 'node:assert/strict';
import { alignedMarkers, notesFromMarkers } from '../src/note-markers.js';

test('moves a separately recorded tap pass in either direction', () => {
  const taps = [1.2, 1.7, 2.2];
  assert.deepEqual(alignedMarkers(taps, 0.4, 0.1, 3).map(time => +time.toFixed(2)), [0.5, 1, 1.5]);
  assert.deepEqual(alignedMarkers(taps, 0.4, -0.2, 3).map(time => +time.toFixed(2)), [0.2, 0.7, 1.2]);
});

test('live taps retain their recording positions until shifted', () => {
  const taps = [0.32, 0.74, 1.1];
  assert.deepEqual(alignedMarkers(taps, taps[0], 0, 2).map(time => +time.toFixed(2)), taps);
  assert.deepEqual(alignedMarkers(taps, taps[0], -0.1, 2).map(time => +time.toFixed(2)), [0.22, 0.64, 1]);
});

test('tap starts split repeated pitches while keeping an automatic rest', () => {
  const frames = [0.24, 0.28, 0.32, 0.64, 0.68, 0.72].map(time => ({ time, hz: 220, confidence: 0.95 }));
  const automatic = [{ start: 0.2, end: 0.4 }, { start: 0.62, end: 0.8 }];
  const notes = notesFromMarkers([0.2, 0.6], frames, automatic, 1);
  assert.deepEqual(notes.map(note => [note.start, note.end, note.midi]), [[0.2, 0.4, 57], [0.6, 0.8, 57]]);
});
