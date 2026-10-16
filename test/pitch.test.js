import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePitch } from '../src/pitch.js';
import { centsBetween, midiToHz, hzToMidi, midiToName, median } from '../src/music.js';

const rate = 48000;
function signal(hz, length = 4096) {
  return Float32Array.from({ length }, (_, i) => 0.2 * Math.sin(2 * Math.PI * hz * i / rate) + 0.07 * Math.sin(4 * Math.PI * hz * i / rate));
}

test('estimates sung-range fundamentals even with a strong overtone', () => {
  for (const hz of [110, 196, 261.63, 440, 659.25]) {
    const estimate = estimatePitch(signal(hz), rate);
    assert.ok(estimate, `No estimate for ${hz} Hz`);
    assert.ok(Math.abs(centsBetween(estimate.hz, hz)) < 5, `${hz} Hz estimated as ${estimate.hz} Hz`);
  }
});

test('ignores silence and very quiet input', () => {
  assert.equal(estimatePitch(new Float32Array(4096), rate), null);
  assert.equal(estimatePitch(Float32Array.from(signal(440), value => value * 0.02), rate), null);
});

test('covers the wider low and high frequencies used by Find Range', () => {
  for (const hz of [55, 1318.51]) {
    const estimate = estimatePitch(signal(hz), rate, 50, 1400);
    assert.ok(estimate, `No estimate for ${hz} Hz`);
    assert.ok(Math.abs(centsBetween(estimate.hz, hz)) < 8, `${hz} Hz estimated as ${estimate.hz} Hz`);
  }
});

test('music helpers preserve pitch math and robust median', () => {
  assert.equal(midiToHz(69), 440);
  assert.equal(hzToMidi(440), 69);
  assert.equal(midiToName(60), 'C4');
  assert.equal(median([20, -1, 2, 100]), 11);
  assert.ok(Math.abs(centsBetween(880, 440) - 1200) < 0.001);
});
