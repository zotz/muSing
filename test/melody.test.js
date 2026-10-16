import test from 'node:test';
import assert from 'node:assert/strict';
import { melodyEvents } from '../src/melody.js';
import { midiToHz } from '../src/music.js';

test('piano melody follows detected pitches, durations, and rests', () => {
  const events = melodyEvents([
    { midi: 64, start: 2.4, end: 2.8 },
    { midi: 60, start: 1.2, end: 1.5 },
    { midi: 62, start: 1.7, end: 2.0 }
  ]);
  assert.deepEqual(events.map(event => event.start), [1.2, 1.7, 2.4]);
  assert.ok(Math.abs(events[0].duration - 0.3) < 1e-9);
  assert.equal(events[0].hz, midiToHz(60));
  assert.equal(events[1].hz, midiToHz(62));
  assert.equal(events[2].hz, midiToHz(64));
});
