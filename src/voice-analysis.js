import { estimatePitch } from './pitch.js';
import { hzToMidi, median } from './music.js';

const HOP_SECONDS = 0.04;
const FRAME_SIZE = 1024;

// A short amplitude envelope locates attacks and releases more precisely than
// the longer windows needed to estimate a sung pitch.
export function amplitudeEnvelope(samples, sampleRate) {
  const size = Math.max(1, Math.round(sampleRate * 0.01));
  const levels = [];
  for (let offset = 0; offset < samples.length; offset += size) {
    let energy = 0;
    const end = Math.min(samples.length, offset + size);
    for (let index = offset; index < end; index++) energy += samples[index] ** 2;
    levels.push(Math.sqrt(energy / (end - offset)));
  }
  return { levels, secondsPerBin: size / sampleRate };
}

function refineNoteBoundaries(notes, envelope, duration) {
  const { levels, secondsPerBin: step } = envelope;
  const crossing = (time, direction) => {
    const at = Math.round(time / step);
    const lo = Math.max(1, at - Math.ceil(0.07 / step));
    const hi = Math.min(levels.length - 1, at + Math.ceil(0.07 / step));
    const peak = Math.max(...levels.slice(lo, hi + 1), 0);
    const threshold = Math.max(0.012, peak * 0.18);
    if (direction === 'start' && time <= 0.07 && levels[0] >= threshold) return 0;
    if (direction === 'end' && duration - time <= 0.07 && levels.at(-1) >= threshold) return duration;
    let closest = null;
    for (let index = lo; index <= hi; index++) {
      const isCrossing = direction === 'start'
        ? levels[index - 1] < threshold && levels[index] >= threshold
        : levels[index - 1] >= threshold && levels[index] < threshold;
      if (isCrossing && (closest == null || Math.abs(index - at) < Math.abs(closest - at))) closest = index;
    }
    return closest == null ? time : Math.max(0, Math.min(duration, closest * step));
  };
  const refined = notes.map(note => {
    const start = crossing(note.start, 'start');
    const end = crossing(note.end, 'end');
    return end - start >= 0.04 ? { ...note, start, end } : { ...note };
  });
  for (let index = 0; index + 1 < refined.length; index++) {
    if (refined[index].end > refined[index + 1].start) {
      const boundary = (refined[index].end + refined[index + 1].start) / 2;
      refined[index].end = boundary;
      refined[index + 1].start = boundary;
    }
  }
  const smoothed = levels.map((level, index) => (level + (levels[index - 1] ?? level) + (levels[index + 1] ?? level)) / 3);
  const split = [];
  for (const note of refined) {
    const cuts = [];
    const first = Math.ceil((note.start + 0.08) / step);
    const last = Math.floor((note.end - 0.08) / step);
    for (let index = first; index <= last; index++) {
      const level = smoothed[index];
      if (level > smoothed[index - 1] || level > smoothed[index + 1]) continue;
      const before = Math.max(...smoothed.slice(Math.max(0, index - 8), index), 0);
      const after = Math.max(...smoothed.slice(index + 1, Math.min(smoothed.length, index + 9)), 0);
      if (Math.min(before, after) < 0.025 || level > Math.min(before, after) * 0.55) continue;
      const time = index * step;
      if (time - (cuts.at(-1) ?? note.start) < 0.08) continue;
      cuts.push(time);
    }
    let start = note.start;
    for (const cut of cuts) {
      split.push({ ...note, start, end: cut });
      start = cut;
    }
    split.push({ ...note, start });
  }
  return split;
}

function articulationFrames(frames) {
  const boundaries = new Set();
  let previous = -Infinity;
  for (let index = 2; index < frames.length - 2; index++) {
    const level = frames[index].rms ?? 0;
    if (level > (frames[index - 1].rms ?? 0) || level > (frames[index + 1].rms ?? 0)) continue;
    const before = Math.max(...frames.slice(Math.max(0, index - 4), index).map(frame => frame.rms ?? 0));
    const after = Math.max(...frames.slice(index + 1, index + 5).map(frame => frame.rms ?? 0));
    if (Math.min(before, after) < 0.025 || level > Math.min(before, after) * 0.84) continue;
    if (index - previous < 3) continue;
    boundaries.add(index);
    previous = index;
  }
  return boundaries;
}

function stabilizePitchRun(frames, start, end, pitches) {
  const values = frames.slice(start, end + 1).map(frame => hzToMidi(frame.hz));
  const low = Math.floor(Math.min(...values)) - 1;
  const high = Math.ceil(Math.max(...values)) + 1;
  const states = high - low + 1;
  const previous = Array.from({ length: values.length }, () => new Int16Array(states));
  let costs = Float64Array.from({ length: states }, (_, state) => Math.min(3, Math.abs(values[0] - low - state)));
  for (let index = 1; index < values.length; index++) {
    const next = new Float64Array(states);
    for (let state = 0; state < states; state++) {
      let best = Infinity;
      let source = 0;
      for (let prior = 0; prior < states; prior++) {
        const change = state === prior ? 0 : 2.5 + 0.2 * Math.abs(state - prior);
        const cost = costs[prior] + change;
        if (cost < best) { best = cost; source = prior; }
      }
      next[state] = best + Math.min(3, Math.abs(values[index] - low - state));
      previous[index][state] = source;
    }
    costs = next;
  }
  let state = costs.indexOf(Math.min(...costs));
  for (let index = values.length - 1; index >= 0; index--) {
    pitches[start + index] = low + state;
    state = previous[index][state];
  }
  for (let index = start; index <= end;) {
    let last = index;
    while (last < end && pitches[last + 1] === pitches[index]) last++;
    if (last - index + 1 <= 3 && (index > start || last < end)) {
      const replacement = last < end ? pitches[last + 1] : pitches[index - 1];
      pitches.fill(replacement, index, last + 1);
    }
    index = last + 1;
  }
}

export function selectDominantChannel(buffer) {
  let best = buffer.getChannelData(0);
  let bestEnergy = -1;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    let energy = 0;
    for (let index = 0; index < samples.length; index += 32) energy += samples[index] ** 2;
    if (energy > bestEnergy) {
      best = samples;
      bestEnergy = energy;
    }
  }
  return best;
}

export function segmentPitchFrames(frames, duration, hopSeconds = HOP_SECONDS) {
  const pitches = frames.map(frame => frame.hz && frame.confidence >= 0.77 ? Math.round(hzToMidi(frame.hz)) : null);
  const articulations = articulationFrames(frames);
  for (let start = 0; start < pitches.length;) {
    if (pitches[start] == null) { start++; continue; }
    let end = start;
    while (end + 1 < pitches.length && pitches[end + 1] != null && !articulations.has(end + 1)) end++;
    stabilizePitchRun(frames, start, end, pitches);
    start = end + 1;
  }
  const notes = [];
  for (let start = 0; start < pitches.length;) {
    const pitch = pitches[start];
    let end = start;
    while (end + 1 < pitches.length && pitches[end + 1] === pitch && !articulations.has(end + 1)) end++;
    if (pitch != null) {
      const startTime = Math.max(0, frames[start].time - hopSeconds / 2);
      const endTime = Math.min(duration, frames[end].time + hopSeconds / 2);
      const frequencies = frames.slice(start, end + 1).map(frame => frame.hz).filter(Boolean);
      if (endTime - startTime >= 0.08 && frequencies.length) {
        const hz = median(frequencies);
        const midi = Math.round(hzToMidi(hz));
        notes.push({ start: startTime, end: endTime, midi, hz, cents: Math.round((hzToMidi(hz) - midi) * 100) });
      }
    }
    start = end + 1;
  }
  return notes;
}

export async function analyzeVoiceBuffer(buffer, onProgress = () => {}, isCancelled = () => false) {
  const channel = selectDominantChannel(buffer);
  const step = Math.max(1, Math.round(buffer.sampleRate / 12000));
  const analysisRate = buffer.sampleRate / step;
  const hopSamples = Math.max(1, Math.round(buffer.sampleRate * HOP_SECONDS));
  const windowSamples = FRAME_SIZE * step;
  const frame = new Float32Array(FRAME_SIZE);
  const frames = [];
  for (let offset = 0; offset + windowSamples <= channel.length; offset += hopSamples) {
    if (isCancelled()) return null;
    for (let index = 0; index < FRAME_SIZE; index++) frame[index] = channel[offset + index * step];
    const pitch = estimatePitch(frame, analysisRate, 50, 1400);
    let energy = 0;
    for (const sample of frame) energy += sample * sample;
    frames.push({ time: (offset + windowSamples / 2) / buffer.sampleRate, hz: pitch?.hz ?? null, confidence: pitch?.confidence ?? 0, rms: Math.sqrt(energy / FRAME_SIZE) });
    if (frames.length % 25 === 0) {
      onProgress(Math.min(1, (offset + windowSamples) / channel.length));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (isCancelled()) return null;
  onProgress(1);
  const notes = refineNoteBoundaries(segmentPitchFrames(frames, buffer.duration), amplitudeEnvelope(channel, buffer.sampleRate), buffer.duration);
  return { channel, duration: buffer.duration, frames, notes };
}
