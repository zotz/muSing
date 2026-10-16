import { hzToMidi } from './music.js';

export const MAX_NOTE_SHIFT = 12;

export function noteShiftRatio(note) {
  if (note.targetMidi == null) return 1;
  return 2 ** ((note.targetMidi - hzToMidi(note.hz)) / 12);
}

// Waveform-similarity overlap/add changes duration while approximately
// retaining pitch. Playback speed uses this; note shifting resamples it back.
export function stretchTime(samples, factor, sampleRate) {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('Invalid stretch factor');
  if (Math.abs(factor - 1) < 0.001) return Float32Array.from(samples);
  const outputLength = Math.ceil(samples.length * factor);
  if (samples.length < sampleRate * 0.08) {
    return Float32Array.from({ length: outputLength }, (_, i) => samples[Math.min(samples.length - 1, Math.floor(i / factor))] ?? 0);
  }
  const grain = Math.min(2048, Math.max(256, 2 ** Math.round(Math.log2(sampleRate * 0.046))));
  const hop = grain / 4;
  const stretchedLength = outputLength + grain;
  const stretched = new Float32Array(stretchedLength);
  const weights = new Float32Array(stretchedLength);
  const window = Float32Array.from({ length: grain }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / grain));
  const search = Math.round(sampleRate * 0.008);
  for (let out = 0; out < outputLength; out += hop) {
    const expected = Math.round(out / factor);
    let source = Math.min(Math.max(0, expected), Math.max(0, samples.length - grain));
    if (out && source > 0 && source + grain < samples.length) {
      let best = -Infinity;
      const lo = Math.max(0, source - search);
      const hi = Math.min(samples.length - grain, source + search);
      for (let candidate = lo; candidate <= hi; candidate += 4) {
        let dot = 0, left = 0, right = 0;
        for (let i = 0; i < grain - hop; i += 8) {
          const a = stretched[out + i] / (weights[out + i] || 1);
          const b = samples[candidate + i];
          dot += a * b;
          left += a * a;
          right += b * b;
        }
        const score = dot / Math.sqrt(left * right + 1e-12);
        if (score > best) { best = score; source = candidate; }
      }
    }
    for (let i = 0; i < grain && source + i < samples.length; i++) {
      const weight = window[i];
      stretched[out + i] += samples[source + i] * weight;
      weights[out + i] += weight;
    }
  }
  const result = new Float32Array(outputLength);
  for (let i = 0; i < result.length; i++) result[i] = stretched[i] / (weights[i] || 1);
  return result;
}

// Stretch then resample to shift pitch without changing note duration.
export function shiftPitch(samples, ratio, sampleRate) {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError('Invalid pitch ratio');
  if (Math.abs(ratio - 1) < 0.001 || samples.length < sampleRate * 0.08) return Float32Array.from(samples);
  const stretched = stretchTime(samples, ratio, sampleRate);
  const result = new Float32Array(samples.length);
  for (let i = 0; i < result.length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = stretched[Math.min(index, stretched.length - 1)];
    const b = stretched[Math.min(index + 1, stretched.length - 1)];
    result[i] = a + (b - a) * fraction;
  }
  return result;
}

export function renderEditedChannels(buffer, notes) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => Float32Array.from(buffer.getChannelData(channel)));
  for (const note of notes) {
    const ratio = noteShiftRatio(note);
    if (Math.abs(ratio - 1) < 0.001) continue;
    const start = Math.max(0, Math.round(note.start * buffer.sampleRate));
    const end = Math.min(buffer.length, Math.round(note.end * buffer.sampleRate));
    if (end - start < buffer.sampleRate * 0.08) continue;
    const fade = Math.min(Math.round(buffer.sampleRate * 0.012), Math.floor((end - start) / 4));
    for (let channel = 0; channel < channels.length; channel++) {
      const original = buffer.getChannelData(channel);
      const shifted = shiftPitch(original.subarray(start, end), ratio, buffer.sampleRate);
      for (let i = 0; i < shifted.length; i++) {
        const blend = Math.min(1, i / Math.max(1, fade), (shifted.length - 1 - i) / Math.max(1, fade));
        channels[channel][start + i] = original[start + i] * (1 - blend) + shifted[i] * blend;
      }
    }
  }
  return channels;
}

export function encodeWav(channels, sampleRate) {
  const count = channels.length;
  const length = channels[0].length;
  const bytes = new ArrayBuffer(44 + length * count * 2);
  const view = new DataView(bytes);
  const label = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  label(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, count, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true); view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, length * count * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) for (const channel of channels) {
    const value = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(offset, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
    offset += 2;
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
