// YIN pitch estimator. Kept independent of browser audio so it can be tested
// with recorded samples and replaced without changing either exercise.
export function estimatePitch(samples, sampleRate, minHz = 80, maxHz = 1000) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 0.012) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(samples.length / 2));
  const difference = new Float32Array(maxLag + 1);
  const window = samples.length - maxLag;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const delta = samples[i] - samples[i + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  let cumulative = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    cumulative += difference[lag];
    difference[lag] = cumulative ? (difference[lag] * lag) / cumulative : 1;
  }

  let bestLag = minLag;
  let bestValue = 1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const value = difference[lag];
    if (value < bestValue) {
      bestValue = value;
      bestLag = lag;
    }
    if (value < 0.12) {
      while (lag + 1 <= maxLag && difference[lag + 1] < difference[lag]) lag++;
      bestLag = lag;
      bestValue = difference[lag];
      break;
    }
  }
  if (bestValue > 0.23) return null;

  const left = difference[bestLag - 1] ?? difference[bestLag];
  const center = difference[bestLag];
  const right = difference[bestLag + 1] ?? center;
  const divisor = 2 * (left - 2 * center + right);
  const offset = divisor ? Math.max(-1, Math.min(1, (left - right) / divisor)) : 0;
  return { hz: sampleRate / (bestLag + offset), confidence: 1 - bestValue, rms };
}
