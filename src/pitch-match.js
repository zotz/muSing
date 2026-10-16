import { playTone, createSustainedTone, startMicrophone, stopMicrophone, microphoneReady, readPitch, enableMicrophoneMonitoring, disableMicrophoneMonitoring, setMicrophoneMonitorPan } from './audio.js';
import { PITCHES, midiToHz, midiToName, centsBetween, randomItem, median } from './music.js';
import { saveResult } from './results.js';
import { getCaptureSeconds, minimumReadings } from './capture-duration.js';

export function initPitchMatch(onResult) {
  const el = id => document.getElementById(id);
  const targetNote = el('target-note');
  const targetFrequency = el('target-frequency');
  const liveReading = el('live-reading');
  const liveDetail = el('live-detail');
  const needle = el('meter-needle');
  const status = el('pitch-status');
  const record = el('record-attempt');
  const micToggle = el('mic-toggle');
  const continuousButton = el('continuous-target');
  const monitorToggle = el('monitor-voice');
  const panSlider = el('voice-pan');
  const ranges = { low: [48, 59], middle: [55, 67], high: [60, 72] };
  const rangeSelect = el('voice-range');
  let target = 60;
  let recording = false;
  let latest = null;
  let continuousTone = null;
  let active = true;

  function updateRecordLabel() {
    record.textContent = `Record ${getCaptureSeconds()}-second attempt`;
  }
  el('capture-duration').addEventListener('change', updateRecordLabel);

  function stopContinuousTone() {
    continuousTone?.stop();
    continuousTone = null;
    continuousButton.textContent = 'Start continuous target';
  }

  function stopMonitoring() {
    disableMicrophoneMonitoring();
    monitorToggle.checked = false;
  }

  function updateTarget() {
    targetNote.textContent = midiToName(target);
    targetFrequency.textContent = `${midiToHz(target).toFixed(1)} Hz`;
    continuousTone?.setPitch(midiToHz(target));
    needle.style.opacity = '0';
  }

  function displayPitch(pitch) {
    latest = pitch;
    if (!pitch || pitch.confidence < 0.77) {
      liveReading.textContent = '—';
      liveDetail.textContent = microphoneReady() ? 'Sing a clear, sustained note.' : 'Enable the microphone to see live pitch.';
      needle.style.opacity = '0';
      return;
    }
    const cents = centsBetween(pitch.hz, midiToHz(target));
    liveReading.textContent = `${pitch.hz.toFixed(1)} Hz`;
    liveDetail.textContent = `${Math.round(cents) > 0 ? '+' : ''}${Math.round(cents)} cents from target`;
    needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
    needle.style.opacity = '1';
  }

  setInterval(() => {
    if (microphoneReady()) displayPitch(readPitch());
  }, 100);

  el('play-target').addEventListener('click', async () => {
    status.textContent = 'Playing target…';
    await playTone(midiToHz(target));
    status.textContent = 'Now sing the note. Record a short attempt when ready.';
  });

  continuousButton.addEventListener('click', async () => {
    if (continuousTone) {
      stopContinuousTone();
      status.textContent = 'Continuous target stopped.';
      return;
    }
    continuousButton.disabled = true;
    try {
      const tone = await createSustainedTone(midiToHz(target), Number(panSlider.value) / 100);
      if (!active) { tone.stop(); return; }
      continuousTone = tone;
      continuousButton.textContent = 'Stop continuous target';
      status.textContent = 'Target is sounding continuously. Sing along when ready.';
    } catch (error) {
      status.textContent = `Audio output unavailable: ${error.name || 'device error'}.`;
    } finally {
      continuousButton.disabled = false;
    }
  });

  panSlider.addEventListener('input', () => {
    const pan = Number(panSlider.value) / 100;
    continuousTone?.setPan(pan);
    setMicrophoneMonitorPan(-pan);
  });

  monitorToggle.addEventListener('change', () => {
    if (monitorToggle.checked) {
      if (!enableMicrophoneMonitoring(-Number(panSlider.value) / 100)) {
        monitorToggle.checked = false;
        status.textContent = 'Enable the microphone first.';
      } else status.textContent = 'Voice monitoring on. Use headphones to avoid feedback.';
    } else {
      disableMicrophoneMonitoring();
      status.textContent = 'Voice monitoring off.';
    }
  });

  el('new-target').addEventListener('click', () => {
    if (recording) return;
    const [low, high] = ranges[rangeSelect.value];
    const choices = PITCHES.filter(note => note >= low && note <= high);
    let next;
    do next = randomItem(choices); while (next === target);
    target = next;
    updateTarget();
    status.textContent = 'New target ready. Play it to listen.';
  });

  rangeSelect.addEventListener('change', () => {
    if (recording) return;
    const [low, high] = ranges[rangeSelect.value];
    if (target < low || target > high) target = randomItem(PITCHES.filter(note => note >= low && note <= high));
    updateTarget();
    status.textContent = 'Range updated. Play the target to listen.';
  });

  micToggle.addEventListener('click', async () => {
    if (microphoneReady()) {
      stopMonitoring();
      stopMicrophone();
      micToggle.textContent = 'Enable microphone';
      monitorToggle.disabled = true;
      record.disabled = true;
      displayPitch(null);
      status.textContent = 'Microphone off.';
      return;
    }
    try {
      status.textContent = 'Waiting for microphone permission…';
      await startMicrophone();
      if (!active) { stopMicrophone(); return; }
      micToggle.textContent = 'Turn off microphone';
      monitorToggle.disabled = false;
      record.disabled = false;
      status.textContent = 'Microphone ready. Sing a note to see live feedback.';
    } catch (error) {
      status.textContent = `Microphone unavailable: ${error.name || 'permission or device error'}. Use localhost or HTTPS and allow access.`;
    }
  });

  record.addEventListener('click', async () => {
    if (recording || !microphoneReady()) return;
    recording = true;
    record.disabled = true;
    const attempts = [];
    const started = performance.now();
    const seconds = getCaptureSeconds();
    const durationMs = seconds * 1000;
    status.textContent = `Recording… hold the note for ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
    while (performance.now() - started < durationMs && microphoneReady()) {
      const pitch = latest;
      if (pitch && pitch.confidence >= 0.77) attempts.push(centsBetween(pitch.hz, midiToHz(target)));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const completed = microphoneReady() && performance.now() - started >= durationMs;
    recording = false;
    record.disabled = !microphoneReady();
    if (!completed) {
      status.textContent = 'Recording stopped before the attempt finished.';
      return;
    }
    if (attempts.length < minimumReadings(seconds)) {
      status.textContent = 'Not enough clear pitch detected. Try holding one note closer to the microphone.';
      return;
    }
    const offset = median(attempts);
    const steadiness = median(attempts.map(value => Math.abs(value - offset)));
    const result = { type: 'pitch-match', targetMidi: target, offsetCents: Math.round(offset), steadinessCents: Math.round(steadiness), samples: attempts.length, captureSeconds: seconds };
    saveResult(result);
    onResult();
    const direction = Math.abs(offset) < 5 ? 'centered' : offset < 0 ? 'flat' : 'sharp';
    el('attempt-result').innerHTML = `<div class="result-number">${Math.abs(Math.round(offset))}¢</div><div class="result-caption">${direction} from ${midiToName(target)}</div><div class="result-extra">Steadiness: ±${Math.round(steadiness)} cents<br>${attempts.length} pitch readings over ${seconds} ${seconds === 1 ? 'second' : 'seconds'}</div>`;
    status.textContent = Math.abs(offset) <= 25 ? 'Good pitch match. Try another note or repeat for consistency.' : `Try again, aiming slightly ${offset < 0 ? 'higher' : 'lower'}.`;
  });

  updateTarget();
  updateRecordLabel();
  return {
    onEnter() { active = true; },
    onLeave() {
      active = false;
      stopContinuousTone();
      stopMonitoring();
      if (microphoneReady()) {
        stopMicrophone();
        micToggle.textContent = 'Enable microphone';
        monitorToggle.disabled = true;
        record.disabled = true;
        displayPitch(null);
      }
    }
  };
}
