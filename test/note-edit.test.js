import test from 'node:test';
import assert from 'node:assert/strict';
import { addNoteInGap, mergeWithNext, resizeNote, splitNote, noteAtTime, visiblePitchRange } from '../src/note-edit.js';
import { timelineX } from '../src/analyze-voice.js';

test('zoom keeps waveform and note positions on the same timeline', () => {
  assert.equal(timelineX(2, 4, 1), 393);
  assert.equal(timelineX(2, 4, 3), 1093);
});

test('note boundaries stay ordered and retain a minimum duration', () => {
  const notes = [
    { start: 0.2, end: 0.5 },
    { start: 0.7, end: 1.0 }
  ];
  resizeNote(notes, 0, 'end', 0.9, 2);
  assert.equal(notes[0].end, 0.7);
  resizeNote(notes, 1, 'start', 0.99, 2);
  assert.equal(notes[1].start, 0.96);
  resizeNote(notes, 0, 'start', -1, 2);
  assert.equal(notes[0].start, 0);
});

test('manual notes can fill gaps, split, and merge', () => {
  const notes = [
    { start: 0.1, end: 0.4, midi: 60, hz: 261.63 },
    { start: 0.8, end: 1.1, midi: 62, hz: 293.66 }
  ];
  const added = addNoteInGap(notes, 0.6, 1.4);
  assert.equal(notes.length, 3);
  assert.equal(added.midi, 60);
  assert.ok(added.start >= 0.4 && added.end <= 0.8);
  assert.equal(addNoteInGap(notes, 0.2, 1.4), null);
  const right = splitNote(notes, 1, 0.6);
  assert.ok(right);
  assert.equal(notes.length, 4);
  assert.equal(notes[1].end, right.start);
  assert.equal(mergeWithNext(notes, 1), notes[1]);
  assert.equal(notes.length, 3);
});

test('scrub note lookup and pitch range follow the chosen view', () => {
  const notes = [
    { start: 0.1, end: 0.3, midi: 60 },
    { start: 0.5, end: 0.8, midi: 72, targetMidi: 74 }
  ];
  assert.equal(noteAtTime(notes, 0.2), notes[0]);
  assert.equal(noteAtTime(notes, 0.4), null);
  assert.deepEqual(visiblePitchRange(notes, 'all-2'), { low: 58, high: 76 });
  assert.deepEqual(visiblePitchRange(notes, 'focus-3', notes[0]), { low: 57, high: 63 });
  assert.deepEqual(visiblePitchRange(notes, 'focus-6', notes[1]), { low: 68, high: 80 });
});
