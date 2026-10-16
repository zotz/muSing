import test from 'node:test';
import assert from 'node:assert/strict';
import { notesToAbc, notesToMidi } from '../src/note-export.js';
import { tappedBpm } from '../src/tempo.js';

test('ABC uses edited pitches, rests, and the chosen tempo', () => {
  const abc = notesToAbc([
    { start: 0, end: 0.5, midi: 60, targetMidi: 62 },
    { start: 1, end: 1.5, midi: 64 }
  ], 120);
  assert.match(abc, /Q:1\/4=120/);
  assert.match(abc, /\nD4 z4 E4\n/);
});

test('MIDI preserves edited pitch and exact note positions in a valid track', () => {
  const data = notesToMidi([{ start: 0.25, end: 0.75, midi: 60, targetMidi: 62 }], 120);
  assert.equal(Buffer.from(data.subarray(0, 4)).toString(), 'MThd');
  assert.equal(Buffer.from(data.subarray(14, 18)).toString(), 'MTrk');
  assert.deepEqual(Array.from(data.slice(-4)), [0, 0xff, 0x2f, 0]);
  assert.ok(Buffer.from(data).includes(Buffer.from([0x90, 62, 88])));
  assert.ok(Buffer.from(data).includes(Buffer.from([0x80, 62, 0])));
});

test('tap tempo uses recent intervals and waits for three beats', () => {
  assert.equal(tappedBpm([0, 500]), null);
  assert.equal(tappedBpm([0, 500, 1000]), 120);
  assert.equal(tappedBpm([0, 500, 3000]), null);
});
