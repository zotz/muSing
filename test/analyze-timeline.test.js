import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineX, timeGridSeconds, waveformEnvelope, noteTrackLayout } from '../src/analyze-voice.js';

test('waveform, note blocks, and playhead share the same time coordinates', () => {
  assert.equal(timelineX(0, 4), 43);
  assert.equal(timelineX(2, 4), 393);
  assert.equal(timelineX(4, 4), 743);
  assert.equal(timelineX(6, 4), 743);
});

test('both plots use the same half-second grid for short recordings', () => {
  assert.deepEqual(timeGridSeconds(2), [0, 0.5, 1, 1.5, 2]);
  assert.equal(timelineX(timeGridSeconds(2)[2], 2), 393);
});

test('quiet recordings get a visible waveform without changing their samples', () => {
  const samples = Float32Array.from({ length: 12000 }, (_, i) => 0.01 * Math.sin(2 * Math.PI * 220 * i / 12000));
  const original = samples[100];
  const envelope = waveformEnvelope(samples, 700);
  assert.ok(envelope.gain > 30);
  assert.ok(envelope.peak * envelope.gain > 0.3);
  assert.equal(samples[100], original);
  assert.equal(waveformEnvelope(new Float32Array(100), 50).gain, 1);
});

test('note rows fit the selected height with the lowest and highest pitches visible', () => {
  const notes = [{ midi: 48 }, { midi: 72 }];
  const compact = noteTrackLayout(notes, 'all-2', null, 120);
  const tall = noteTrackLayout(notes, 'all-2', null, 420);
  assert.equal(compact.low, 46);
  assert.equal(compact.high, 74);
  assert.equal(compact.headerHeight + (compact.high - compact.low + 1) * compact.rowHeight, compact.height);
  assert.ok(tall.rowHeight > compact.rowHeight);
  assert.equal(tall.height, 420);
});
