import test from 'node:test';
import assert from 'node:assert/strict';
import { playScrubCue } from '../src/audio.js';
import { midiToHz } from '../src/music.js';

test('seek cue previews a short recording slice and the current note', async () => {
  let context;
  class Node {
    connect(destination) { return destination; }
    disconnect() {}
    stop() { this.stopped = true; }
  }
  class Parameter {
    setValueAtTime() {}
    linearRampToValueAtTime() {}
  }
  class FakeContext {
    constructor() { context = this; this.currentTime = 2; this.state = 'running'; this.destination = new Node(); }
    createGain() { return Object.assign(new Node(), { gain: new Parameter() }); }
    createBufferSource() {
      this.voice = Object.assign(new Node(), { start(time, offset, duration) { this.startTime = time; this.offset = offset; this.duration = duration; } });
      return this.voice;
    }
    createOscillator() {
      this.note = Object.assign(new Node(), { frequency: { value: 0 }, start(time) { this.startTime = time; } });
      return this.note;
    }
  }
  globalThis.AudioContext = FakeContext;
  try {
    const cue = await playScrubCue({ duration: 3 }, { midi: 60, targetMidi: 62 }, 1.4, 'both');
    assert.equal(context.voice.offset, 1.4);
    assert.equal(context.voice.duration, 0.14);
    assert.equal(context.note.frequency.value, midiToHz(62));
    cue.stop();
    assert.equal(context.voice.stopped, true);
    assert.equal(context.note.stopped, true);
  } finally {
    delete globalThis.AudioContext;
  }
});
