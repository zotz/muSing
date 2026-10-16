import test from 'node:test';
import assert from 'node:assert/strict';
import { playPianoMelody, playAudioBuffer } from '../src/audio.js';

test('schedules piano notes and recording on the same timeline', async () => {
  let context;
  class Node {
    connect(destination) { return destination; }
    disconnect() {}
  }
  class Parameter {
    setValueAtTime() {}
    exponentialRampToValueAtTime() {}
    cancelScheduledValues() {}
    setTargetAtTime() {}
  }
  class FakeContext {
    constructor() {
      context = this;
      this.currentTime = 10;
      this.state = 'running';
      this.destination = new Node();
      this.oscillators = [];
    }
    createGain() { return Object.assign(new Node(), { gain: new Parameter() }); }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, copyToChannel(samples, channel) { data[channel].set(samples); }, getChannelData(channel) { return data[channel]; } };
    }
    createOscillator() {
      const oscillator = Object.assign(new Node(), {
        frequency: { value: 0 }, start(time) { this.startTime = time; }, stop() {}
      });
      this.oscillators.push(oscillator);
      return oscillator;
    }
    createBufferSource() {
      this.recording = Object.assign(new Node(), { start(time, offset) { this.startTime = time; this.offset = offset; }, stop() {} });
      return this.recording;
    }
  }
  globalThis.AudioContext = FakeContext;
  try {
    const recording = { duration: 3 };
    const playback = await playPianoMelody([{ midi: 60, start: 0.5, end: 1 }], recording);
    assert.equal(context.recording.buffer, recording);
    assert.equal(context.recording.startTime, 10.08);
    assert.equal(context.oscillators[0].startTime, 10.58);
    context.currentTime = 10.83;
    assert.ok(Math.abs(playback.currentTime() - 0.75) < 1e-9);
    const tuned = await playAudioBuffer({ duration: 4 }, 1.5);
    assert.equal(context.recording.offset, 1.5);
    assert.ok(Math.abs(tuned.currentTime() - 1.5) < 1e-9);
    const phrase = context.createBuffer(1, 12000, 12000);
    const slow = await playPianoMelody([{ midi: 60, start: 0.5, end: 1 }], phrase, 0.5, 0.5);
    assert.equal(context.recording.buffer.duration, 2);
    assert.equal(context.recording.offset, 1);
    assert.equal(context.oscillators.at(-1).startTime, context.recording.startTime);
    context.currentTime = context.recording.startTime + 1;
    assert.ok(Math.abs(slow.currentTime() - 1) < 1e-9);
    const slowVoice = await playAudioBuffer(phrase, 0.25, 0.5);
    assert.equal(context.recording.offset, 0.5);
    assert.equal(context.recording.buffer.duration, 2);
    assert.ok(Math.abs(slowVoice.currentTime() - 0.25) < 1e-9);
  } finally {
    delete globalThis.AudioContext;
  }
});
