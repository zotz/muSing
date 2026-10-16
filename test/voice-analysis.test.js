import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVoiceBuffer, segmentPitchFrames, selectDominantChannel } from '../src/voice-analysis.js';
import { midiToHz } from '../src/music.js';

test('analyzes a solo phrase and selects the active stereo input channel', async () => {
  const sampleRate = 48000;
  const duration = 1.9;
  const silent = new Float32Array(Math.round(sampleRate * duration));
  const voice = Float32Array.from(silent, (_, index) => {
    const time = index / sampleRate;
    const hz = time < 0.8 ? 220 : time < 1.05 ? 0 : 261.6256;
    return hz ? 0.22 * Math.sin(2 * Math.PI * hz * time) : 0;
  });
  const buffer = {
    sampleRate,
    duration,
    numberOfChannels: 2,
    getChannelData(channel) { return channel === 0 ? silent : voice; }
  };
  assert.equal(selectDominantChannel(buffer), voice);
  const result = await analyzeVoiceBuffer(buffer);
  assert.equal(result.channel, voice);
  assert.ok(result.notes.some(note => note.midi === 57), 'Expected A3');
  assert.ok(result.notes.some(note => note.midi === 60), 'Expected C4');
  assert.ok(result.notes.every(note => note.end > note.start));
});

test('short amplitude windows refine a clear attack and release', async () => {
  const sampleRate = 48000;
  const duration = 0.7;
  const voice = Float32Array.from({ length: sampleRate * duration }, (_, index) => {
    const time = index / sampleRate;
    return time >= 0.2 && time < 0.4 ? 0.22 * Math.sin(2 * Math.PI * 220 * time) : 0;
  });
  const result = await analyzeVoiceBuffer({ sampleRate, duration, numberOfChannels: 1, getChannelData() { return voice; } });
  assert.ok(Math.abs(result.notes[0].start - 0.2) <= 0.01);
  assert.ok(Math.abs(result.notes[0].end - 0.4) <= 0.01);
});

test('a short quiet articulation can split repeated pitches', async () => {
  const sampleRate = 48000;
  const duration = 1;
  const voice = Float32Array.from({ length: sampleRate * duration }, (_, index) => {
    const time = index / sampleRate;
    const level = Math.abs(time - 0.45) < 0.01 ? 0.01 : 0.22;
    return level * Math.sin(2 * Math.PI * 164.81 * time);
  });
  const result = await analyzeVoiceBuffer({ sampleRate, duration, numberOfChannels: 1, getChannelData() { return voice; } });
  assert.equal(result.notes.length, 2);
  assert.ok(Math.abs(result.notes[0].end - 0.45) <= 0.02);
});

test('keeps short, distinct sung notes in the note track', async () => {
  const sampleRate = 48000;
  const notes = [
    { start: 0, end: 0.11, hz: 220, midi: 57 },
    { start: 0.15, end: 0.26, hz: 246.94, midi: 59 },
    { start: 0.3, end: 0.41, hz: 261.63, midi: 60 },
    { start: 0.45, end: 0.56, hz: 293.66, midi: 62 }
  ];
  const duration = 0.72;
  const voice = Float32Array.from({ length: Math.round(sampleRate * duration) }, (_, index) => {
    const time = index / sampleRate;
    const note = notes.find(item => time >= item.start && time < item.end);
    return note ? 0.22 * Math.sin(2 * Math.PI * note.hz * time) : 0;
  });
  const buffer = { sampleRate, duration, numberOfChannels: 1, getChannelData() { return voice; } };
  const result = await analyzeVoiceBuffer(buffer);
  assert.deepEqual(result.notes.map(note => note.midi), notes.map(note => note.midi));
});

test('separates repeated same-pitch notes at a clear energy dip', () => {
  const frames = Array.from({ length: 18 }, (_, index) => ({
    time: index * 0.04 + 0.02,
    hz: 164.81,
    confidence: 0.95,
    rms: index === 8 ? 0.12 : index === 7 || index === 9 ? 0.13 : 0.15
  }));
  const notes = segmentPitchFrames(frames, 0.72);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].midi, 52);
  assert.equal(notes[1].midi, 52);
});

test('treats a brief semitone excursion without articulation as one note', () => {
  const frames = Array.from({ length: 14 }, (_, index) => ({
    time: index * 0.04 + 0.02,
    hz: index >= 5 && index <= 7 ? 155.56 : 146.83,
    confidence: 0.95,
    rms: 0.15
  }));
  const notes = segmentPitchFrames(frames, 0.56);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi, 50);
});

test('finds repeated same-pitch syllables in an analyzed recording', async () => {
  const sampleRate = 48000;
  const duration = 1.4;
  const voice = Float32Array.from({ length: Math.round(sampleRate * duration) }, (_, index) => {
    const time = index / sampleRate;
    const nearArticulation = [0.45, 0.9].some(at => Math.abs(time - at) < 0.035);
    return (nearArticulation ? 0.018 : 0.22) * Math.sin(2 * Math.PI * 164.81 * time);
  });
  const buffer = { sampleRate, duration, numberOfChannels: 1, getChannelData() { return voice; } };
  const result = await analyzeVoiceBuffer(buffer);
  assert.ok(result.notes.length >= 3, `Expected three E3 syllables, got ${result.notes.length}`);
  assert.ok(result.notes.every(note => note.midi === 52));
});

test('follows stable notes through pitch scoops and brief overshoots', () => {
  const contour = [
    50.2, 50.6, 51.5, 51.8, 52, 52, 52, 51.7,
    50.2, 49.1, 49.8, 50.7, 50.8, 50.7,
    48.9, 46.6, 47.6, 47.5, 47.7, 47.8,
    49.3, 50.7, 51, 50.5, 50, 50, 50.1,
    51.1, 51.6, 51.8, 52, 52
  ];
  const frames = contour.map((midi, index) => ({
    time: index * 0.04 + 0.02,
    hz: midiToHz(midi), confidence: 0.95, rms: 0.04
  }));
  assert.deepEqual(segmentPitchFrames(frames, frames.length * 0.04).map(note => note.midi), [52, 50, 48, 50, 52]);
});
