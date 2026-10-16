import { estimatePitch } from './pitch.js';
import { melodyEvents } from './melody.js';
import { midiToHz } from './music.js';
import { stretchTime } from './voice-edit.js';

let context;
let stream;
let analyser;
let buffer;
let microphoneSource;
let monitorGain;
let monitorPan;
const stretchedBuffers = new WeakMap();

async function audioContext() {
  context ||= new AudioContext();
  if (context.state === 'suspended') await context.resume();
  return context;
}

function bufferAtSpeed(audio, recordingBuffer, speed) {
  if (speed === 1) return recordingBuffer;
  let versions = stretchedBuffers.get(recordingBuffer);
  if (!versions) { versions = new Map(); stretchedBuffers.set(recordingBuffer, versions); }
  if (versions.has(speed)) return versions.get(speed);
  const length = Math.ceil(recordingBuffer.length / speed);
  const output = audio.createBuffer(recordingBuffer.numberOfChannels, length, recordingBuffer.sampleRate);
  for (let channel = 0; channel < recordingBuffer.numberOfChannels; channel++) {
    output.copyToChannel(stretchTime(recordingBuffer.getChannelData(channel), 1 / speed, recordingBuffer.sampleRate), channel);
  }
  versions.set(speed, output);
  return output;
}

export async function playTone(hz, duration = 0.8, delay = 0, pan = 0) {
  const audio = await audioContext();
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const panner = audio.createStereoPanner();
  oscillator.type = 'sine';
  oscillator.frequency.value = hz;
  panner.pan.value = pan;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.16, start + 0.025);
  gain.gain.setValueAtTime(0.16, start + duration - 0.04);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  oscillator.connect(gain).connect(panner).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
  return new Promise(resolve => oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
    panner.disconnect();
    resolve();
  });
}

export async function playPianoMelody(notes, recordingBuffer = null, speed = 1, startOffset = 0) {
  const events = melodyEvents(notes);
  const upcoming = events.filter(event => event.start + event.duration > startOffset);
  if (!upcoming.length && !recordingBuffer) return null;
  const audio = await audioContext();
  const playbackBuffer = recordingBuffer ? bufferAtSpeed(audio, recordingBuffer, speed) : null;
  const master = audio.createGain();
  master.gain.value = recordingBuffer ? 0.55 : 0.8;
  master.connect(audio.destination);
  const beginning = audio.currentTime + 0.08;
  const duration = Math.max(recordingBuffer?.duration ?? 0, ...events.map(event => event.start + event.duration));
  const harmonics = [1, 2, 3];
  const strengths = [0.7, 0.22, 0.08];
  let remaining = upcoming.length * harmonics.length + (recordingBuffer ? 1 : 0);
  let finished = false;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const finish = () => {
    if (finished) return;
    finished = true;
    master.disconnect();
    resolveDone();
  };

  if (recordingBuffer) {
    const recording = audio.createBufferSource();
    const recordingGain = audio.createGain();
    recording.buffer = playbackBuffer;
    recordingGain.gain.value = 1.5;
    recording.connect(recordingGain).connect(master);
    recording.onended = () => {
      recording.disconnect();
      recordingGain.disconnect();
      if (--remaining === 0) finish();
    };
    recording.start(beginning, startOffset / speed);
  }

  for (const event of upcoming) {
    const start = beginning + Math.max(0, event.start - startOffset) / speed;
    const end = beginning + (event.start + event.duration - startOffset) / speed + 0.16;
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(0.16, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.055, start + Math.min(0.25, Math.max(0.04, event.duration / speed * 0.5)));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(master);
    for (let index = 0; index < harmonics.length; index++) {
      const oscillator = audio.createOscillator();
      const level = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = event.hz * harmonics[index];
      level.gain.value = strengths[index];
      oscillator.connect(level).connect(envelope);
      oscillator.onended = () => {
        oscillator.disconnect();
        level.disconnect();
        if (--remaining === 0) {
          envelope.disconnect();
          finish();
        }
      };
      oscillator.start(start);
      oscillator.stop(end);
    }
  }

  return {
    done,
    currentTime() { return Math.min(duration, Math.max(startOffset, startOffset + (audio.currentTime - beginning) * speed)); },
    stop() {
      if (finished) return;
      master.gain.cancelScheduledValues(audio.currentTime);
      master.gain.setTargetAtTime(0, audio.currentTime, 0.01);
      setTimeout(finish, 80);
    }
  };
}

export async function playAudioBuffer(recordingBuffer, startOffset = 0, speed = 1) {
  const audio = await audioContext();
  const source = audio.createBufferSource();
  source.buffer = bufferAtSpeed(audio, recordingBuffer, speed);
  source.connect(audio.destination);
  const beginning = audio.currentTime + 0.05;
  let finished = false;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const finish = () => {
    if (finished) return;
    finished = true;
    source.disconnect();
    resolveDone();
  };
  source.onended = finish;
  const offset = Math.max(0, Math.min(recordingBuffer.duration - 0.001, startOffset));
  source.start(beginning, offset / speed);
  return {
    done,
    currentTime() { return Math.min(recordingBuffer.duration, Math.max(offset, offset + (audio.currentTime - beginning) * speed)); },
    stop() { if (!finished) source.stop(); }
  };
}

export async function playClickTrack(times, recordingBuffer = null, speed = 1, startOffset = 0) {
  const upcoming = times.filter(time => time >= startOffset);
  if (!upcoming.length && !recordingBuffer) return null;
  const audio = await audioContext();
  const beginning = audio.currentTime + 0.06;
  const duration = Math.max(recordingBuffer?.duration ?? 0, (times.at(-1) ?? 0) + 0.05);
  const master = audio.createGain();
  master.connect(audio.destination);
  const sources = [];
  let remaining = upcoming.length + (recordingBuffer ? 1 : 0);
  let finished = false;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const finish = () => {
    if (finished) return;
    finished = true;
    master.disconnect();
    resolveDone();
  };
  const ended = source => {
    source.disconnect();
    if (--remaining === 0) finish();
  };
  if (recordingBuffer) {
    const voice = audio.createBufferSource();
    voice.buffer = bufferAtSpeed(audio, recordingBuffer, speed);
    voice.connect(master);
    voice.onended = () => ended(voice);
    voice.start(beginning, startOffset / speed);
    sources.push(voice);
  }
  for (const time of upcoming) {
    const start = beginning + (time - startOffset) / speed;
    const click = audio.createOscillator();
    const envelope = audio.createGain();
    click.type = 'triangle';
    click.frequency.value = 1400;
    envelope.gain.setValueAtTime(0.22, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.035);
    click.connect(envelope).connect(master);
    click.onended = () => { envelope.disconnect(); ended(click); };
    click.start(start);
    click.stop(start + 0.04);
    sources.push(click);
  }
  return {
    done,
    currentTime() { return Math.min(duration, Math.max(startOffset, startOffset + (audio.currentTime - beginning) * speed)); },
    stop() {
      if (finished) return;
      for (const source of sources) {
        try { source.stop(); } catch { /* Source already stopped. */ }
      }
      finish();
    }
  };
}

export async function playAudioChunk({ start, end, recordingBuffer = null, notes = [], clicks = [], speed = 1 }) {
  if (!(end > start) || !(speed > 0)) return null;
  const audio = await audioContext();
  const beginning = audio.currentTime + 0.04;
  const duration = (end - start) / speed;
  const master = audio.createGain();
  master.gain.value = recordingBuffer ? 0.65 : 0.8;
  master.connect(audio.destination);
  const sources = [];
  let finished = false;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  let timer;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const source of sources) {
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
    }
    master.disconnect();
    resolveDone();
  };
  if (recordingBuffer) {
    const voice = audio.createBufferSource();
    voice.buffer = bufferAtSpeed(audio, recordingBuffer, speed);
    voice.connect(master);
    voice.start(beginning, start / speed, duration);
    sources.push(voice);
  }
  for (const note of notes) {
    const noteStart = Math.max(start, note.start);
    const noteEnd = Math.min(end, note.end);
    if (noteEnd <= noteStart || !Number.isFinite(note.midi)) continue;
    const from = beginning + (noteStart - start) / speed;
    const length = (noteEnd - noteStart) / speed;
    const attack = Math.min(0.01, length / 3);
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(0.0001, from);
    envelope.gain.linearRampToValueAtTime(0.22, from + attack);
    envelope.gain.setValueAtTime(0.22, from + Math.max(attack, length - 0.02));
    envelope.gain.linearRampToValueAtTime(0.0001, from + length);
    envelope.connect(master);
    const oscillator = audio.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = midiToHz(note.midi);
    oscillator.connect(envelope);
    oscillator.onended = () => envelope.disconnect();
    oscillator.start(from);
    oscillator.stop(from + length);
    sources.push(oscillator);
  }
  for (const clickTime of clicks) {
    if (clickTime < start || clickTime >= end) continue;
    const from = beginning + (clickTime - start) / speed;
    const length = Math.min(0.04, beginning + duration - from);
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(0.22, from);
    envelope.gain.exponentialRampToValueAtTime(0.0001, from + length);
    envelope.connect(master);
    const oscillator = audio.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 1400;
    oscillator.connect(envelope);
    oscillator.onended = () => envelope.disconnect();
    oscillator.start(from);
    oscillator.stop(from + length);
    sources.push(oscillator);
  }
  timer = setTimeout(finish, (duration + 0.04) * 1000);
  return {
    done,
    currentTime() { return Math.min(end, Math.max(start, start + (audio.currentTime - beginning) * speed)); },
    stop: finish
  };
}

export async function playScrubCue(recordingBuffer, note, seconds, mode = 'voice') {
  if (mode === 'off' || (mode === 'note' && !note)) return null;
  const audio = await audioContext();
  const start = audio.currentTime + 0.005;
  const duration = 0.14;
  const master = audio.createGain();
  master.gain.setValueAtTime(0, start);
  master.gain.linearRampToValueAtTime(0.22, start + 0.012);
  master.gain.setValueAtTime(0.22, start + duration - 0.018);
  master.gain.linearRampToValueAtTime(0, start + duration);
  master.connect(audio.destination);
  const sources = [];
  const finish = () => {
    if (sources.every(source => source.ended)) master.disconnect();
  };
  if ((mode === 'voice' || mode === 'both') && recordingBuffer) {
    const source = audio.createBufferSource();
    source.buffer = recordingBuffer;
    source.connect(master);
    source.onended = () => { source.ended = true; source.disconnect(); finish(); };
    source.start(start, Math.max(0, Math.min(recordingBuffer.duration - 0.01, seconds)), duration);
    sources.push(source);
  }
  if ((mode === 'note' || mode === 'both') && note) {
    const oscillator = audio.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = midiToHz(note.targetMidi ?? note.midi);
    oscillator.connect(master);
    oscillator.onended = () => { oscillator.ended = true; oscillator.disconnect(); finish(); };
    oscillator.start(start);
    oscillator.stop(start + duration);
    sources.push(oscillator);
  }
  if (!sources.length) { master.disconnect(); return null; }
  return {
    stop() {
      for (const source of sources) {
        if (source.ended) continue;
        try { source.stop(); } catch { /* The short cue already ended. */ }
      }
    }
  };
}

export async function createSustainedTone(hz, pan = 0, volume = 0.12) {
  const audio = await audioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const panner = audio.createStereoPanner();
  oscillator.type = 'sine';
  oscillator.frequency.value = hz;
  panner.pan.value = pan;
  gain.gain.setValueAtTime(0, audio.currentTime);
  gain.gain.linearRampToValueAtTime(volume, audio.currentTime + 0.03);
  oscillator.connect(gain).connect(panner).connect(audio.destination);
  oscillator.start();
  let stopped = false;
  return {
    setPitch(nextHz) {
      if (!stopped) oscillator.frequency.setTargetAtTime(nextHz, audio.currentTime, 0.015);
    },
    setPan(nextPan) {
      if (!stopped) panner.pan.setTargetAtTime(nextPan, audio.currentTime, 0.015);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      gain.gain.cancelScheduledValues(audio.currentTime);
      gain.gain.setTargetAtTime(0, audio.currentTime, 0.012);
      oscillator.stop(audio.currentTime + 0.08);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); panner.disconnect(); };
    }
  };
}

export async function startMicrophone() {
  if (analyser) return;
  const audio = await audioContext();
  stream = await navigator.mediaDevices.getUserMedia({ audio: {
    echoCancellation: false, noiseSuppression: false, autoGainControl: false
  } });
  analyser = audio.createAnalyser();
  analyser.fftSize = 4096;
  microphoneSource = audio.createMediaStreamSource(stream);
  microphoneSource.connect(analyser);
  buffer = new Float32Array(analyser.fftSize);
}

export function enableMicrophoneMonitoring(pan = 0) {
  if (!microphoneSource) return false;
  if (!monitorGain) {
    monitorGain = context.createGain();
    monitorPan = context.createStereoPanner();
    monitorGain.gain.value = 0;
    microphoneSource.connect(monitorGain).connect(monitorPan).connect(context.destination);
    monitorGain.gain.setTargetAtTime(0.5, context.currentTime, 0.02);
  }
  monitorPan.pan.setTargetAtTime(pan, context.currentTime, 0.015);
  return true;
}

export function setMicrophoneMonitorPan(pan) {
  monitorPan?.pan.setTargetAtTime(pan, context.currentTime, 0.015);
}

export function disableMicrophoneMonitoring() {
  if (!monitorGain) return;
  monitorGain.disconnect();
  monitorPan.disconnect();
  monitorGain = null;
  monitorPan = null;
}

export function readPitch(minHz = 80, maxHz = 1000) {
  if (!analyser) return null;
  analyser.getFloatTimeDomainData(buffer);
  return estimatePitch(buffer, context.sampleRate, minHz, maxHz);
}

export function microphoneReady() {
  return Boolean(analyser);
}

export function stopMicrophone() {
  disableMicrophoneMonitoring();
  microphoneSource?.disconnect();
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  microphoneSource = null;
  analyser = null;
  buffer = null;
}
