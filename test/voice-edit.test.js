import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePitch } from '../src/pitch.js';
import { encodeWav, renderEditedChannels, shiftPitch, stretchTime } from '../src/voice-edit.js';

test('pitch shifting moves a sung tone without changing its duration', () => {
  const sampleRate = 12000;
  const source = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(2 * Math.PI * 220 * i / sampleRate));
  for (const [ratio, expected] of [[2 ** (1 / 12), 233.08], [2 ** (4 / 12), 277.18], [0.5, 110]]) {
    const shifted = shiftPitch(source, ratio, sampleRate);
    const reading = estimatePitch(shifted.subarray(4000, 5024), sampleRate, 80, 500);
    assert.equal(shifted.length, source.length);
    assert.ok(Math.abs(reading.hz - expected) < 3, `${reading.hz} should be near ${expected}`);
  }
});

test('time stretching changes playback length while keeping vocal pitch', () => {
  const sampleRate = 12000;
  const source = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(2 * Math.PI * 220 * i / sampleRate));
  for (const factor of [2, 4 / 3, 0.8]) {
    const stretched = stretchTime(source, factor, sampleRate);
    const reading = estimatePitch(stretched.subarray(4000, 5024), sampleRate, 80, 500);
    assert.equal(stretched.length, Math.ceil(source.length * factor));
    assert.ok(Math.abs(reading.hz - 220) < 4, `${reading.hz} should stay near 220 Hz`);
  }
});

test('only the edited note interval changes; clear edits preserve the recording', () => {
  const sampleRate = 12000;
  const original = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(2 * Math.PI * 220 * i / sampleRate) * 0.5);
  const buffer = { sampleRate, length: original.length, numberOfChannels: 1, getChannelData() { return original; } };
  const note = { start: 0.25, end: 0.75, hz: 220, midi: 57, targetMidi: null };
  assert.deepEqual(renderEditedChannels(buffer, [note])[0], original);
  note.targetMidi = 60;
  const edited = renderEditedChannels(buffer, [note])[0];
  assert.deepEqual(edited.subarray(0, 3000), original.subarray(0, 3000));
  assert.deepEqual(edited.subarray(9000), original.subarray(9000));
  assert.notDeepEqual(edited.subarray(3500, 8500), original.subarray(3500, 8500));
});

test('edited output encodes as a playable PCM WAV', async () => {
  const blob = encodeWav([new Float32Array([0, 1, -1])], 12000);
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, 50);
  assert.equal(view.getUint32(24, true), 12000);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), -32768);
});
