import { playTone, startMicrophone, stopMicrophone, microphoneReady, readPitch } from './audio.js';
import { hzToMidi, midiToName, median } from './music.js';
import { getResults, saveResult } from './results.js';
import { renderRangeKeyboard } from './range-keyboard.js';
import { getCaptureSeconds, minimumReadings } from './capture-duration.js';

const kinds = ['low', 'high', 'happy'];

export function validRange(values) {
  return kinds.every(kind => Number.isFinite(values[kind]) && values[kind] > 0) && values.low < values.high;
}

function pitchLabel(hz) {
  const midi = hzToMidi(hz);
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 100);
  const suffix = cents === 0 ? '' : ` ${cents > 0 ? '+' : ''}${cents}¢`;
  return `${midiToName(nearest)}${suffix} · ${hz.toFixed(1)} Hz`;
}

export function initFindRange(onResult) {
  const el = id => document.getElementById(id);
  const status = el('range-status');
  const micButton = el('range-mic');
  const saveButton = el('save-range');
  const captureButtons = [...document.querySelectorAll('.range-capture')];
  const values = { low: null, high: null, happy: null };
  let active = false;
  let capturing = false;
  let saved = false;
  let latest = null;
  let latestAt = 0;
  let captureId = 0;
  let selectedSessionId = null;

  function playKeyboardPitch(hz, label) {
    const playbackStatus = el('range-playback-status');
    playbackStatus.textContent = `Playing ${label} · ${hz.toFixed(1)} Hz`;
    playTone(hz).catch(error => {
      playbackStatus.textContent = `Audio output unavailable: ${error.name || 'device error'}.`;
    });
  }

  for (const kind of kinds) {
    el(`play-range-${kind}`).addEventListener('click', () => {
      if (values[kind] != null) playKeyboardPitch(values[kind], `${kind} captured note`);
    });
  }

  function validSet() {
    return validRange(values);
  }

  function render() {
    for (const kind of kinds) {
      el(`range-${kind}-value`).textContent = values[kind] == null ? 'Not captured' : pitchLabel(values[kind]);
      el(`play-range-${kind}`).disabled = values[kind] == null;
    }
    captureButtons.forEach(button => button.disabled = !microphoneReady() || capturing || saved);
    if (saved) {
      saveButton.disabled = false;
      saveButton.textContent = 'Start new session';
    } else {
      saveButton.disabled = !validSet() || capturing;
      saveButton.textContent = 'Save range session';
    }
    const summary = el('range-summary');
    el('range-session-label').textContent = selectedSessionId ? 'Viewing saved session' : 'Current session';
    renderRangeKeyboard(el('range-keyboard'), values, playKeyboardPitch);
    if (kinds.every(kind => values[kind] != null)) {
      if (!validSet()) {
        summary.textContent = 'The low reading must be below the high reading. Retry one of them.';
        return;
      }
      const semitones = hzToMidi(values.high) - hzToMidi(values.low);
      const octaves = semitones / 12;
      summary.innerHTML = `<div class="result-number">${octaves.toFixed(2)}</div><div class="result-caption">octaves (${semitones.toFixed(1)} semitones) from ${midiToName(Math.round(hzToMidi(values.low)))} to ${midiToName(Math.round(hzToMidi(values.high)))}</div><div class="result-extra">Happy note: ${pitchLabel(values.happy)}</div>`;
    } else summary.textContent = 'Capture all three notes to see your range.';
  }

  function renderHistory() {
    const history = el('range-history');
    history.replaceChildren();
    const sessions = getResults().filter(item => item.type === 'range-session' && validRange({ low: item.lowHz, high: item.highHz, happy: item.happyHz })).reverse();
    if (!sessions.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No range sessions saved yet.';
      history.append(empty);
      return;
    }
    for (const item of sessions) {
      const row = document.createElement('div');
      row.className = 'history-row';
      const title = document.createElement('strong');
      title.textContent = new Date(item.at).toLocaleString();
      const span = document.createElement('span');
      span.textContent = `${midiToName(Math.round(hzToMidi(item.lowHz)))}–${midiToName(Math.round(hzToMidi(item.highHz)))}`;
      const happy = document.createElement('span');
      happy.textContent = `Happy: ${pitchLabel(item.happyHz)}`;
      const view = document.createElement('button');
      view.className = 'button button-outline range-history-view';
      view.type = 'button';
      view.textContent = selectedSessionId === item.id ? 'Viewing' : 'View on keyboard';
      view.disabled = selectedSessionId === item.id;
      view.setAttribute('aria-label', `View range saved ${title.textContent} on keyboard`);
      view.addEventListener('click', () => {
        captureId++;
        capturing = false;
        values.low = item.lowHz;
        values.high = item.highHz;
        values.happy = item.happyHz;
        selectedSessionId = item.id;
        saved = true;
        status.textContent = `Viewing saved range from ${title.textContent}. Start a new session to capture notes.`;
        render();
        renderHistory();
        el('range-keyboard').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      row.classList.toggle('selected', selectedSessionId === item.id);
      row.append(title, span, happy, view);
      history.append(row);
    }
  }

  setInterval(() => {
    if (!active || !microphoneReady()) return;
    latest = readPitch(50, 1400);
    latestAt = performance.now();
    if (latest && latest.confidence >= 0.77) {
      el('range-live-note').textContent = midiToName(Math.round(hzToMidi(latest.hz)));
      el('range-live-detail').textContent = `${latest.hz.toFixed(1)} Hz · keep the note steady`;
    } else {
      el('range-live-note').textContent = '—';
      el('range-live-detail').textContent = 'Sing a clear, sustained note.';
    }
  }, 100);

  micButton.addEventListener('click', async () => {
    if (microphoneReady()) {
      captureId++;
      stopMicrophone();
      micButton.textContent = 'Enable microphone';
      el('range-live-note').textContent = '—';
      el('range-live-detail').textContent = 'Enable the microphone, then sing a sustained note.';
      status.textContent = 'Microphone off.';
      render();
      return;
    }
    micButton.disabled = true;
    status.textContent = 'Waiting for microphone permission…';
    try {
      await startMicrophone();
      if (!active) { stopMicrophone(); return; }
      micButton.textContent = 'Turn off microphone';
      status.textContent = 'Microphone ready. Hold a note, then capture it.';
    } catch (error) {
      status.textContent = `Microphone unavailable: ${error.name || 'permission or device error'}.`;
    } finally {
      micButton.disabled = false;
      render();
    }
  });

  captureButtons.forEach(button => button.addEventListener('click', async () => {
    const kind = button.dataset.kind;
    if (!kinds.includes(kind) || !microphoneReady() || capturing || saved) return;
    capturing = true;
    const id = ++captureId;
    const notes = [];
    const started = performance.now();
    const seconds = getCaptureSeconds();
    const durationMs = seconds * 1000;
    render();
    status.textContent = `Capturing ${kind} note… hold it for ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
    while (performance.now() - started < durationMs && microphoneReady() && active && id === captureId) {
      if (latest && latest.confidence >= 0.77 && performance.now() - latestAt < 180) notes.push(hzToMidi(latest.hz));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    capturing = false;
    if (id !== captureId || !active || !microphoneReady()) {
      status.textContent = 'Capture stopped.';
      render();
      return;
    }
    if (notes.length < minimumReadings(seconds)) {
      status.textContent = 'Not enough clear pitch detected. Hold one note and try again.';
      render();
      return;
    }
    const middle = median(notes);
    const variationCents = median(notes.map(note => Math.abs(note - middle))) * 100;
    if (variationCents > 60) {
      status.textContent = 'Pitch changed too much during capture. Try a steadier note.';
      render();
      return;
    }
    values[kind] = 440 * 2 ** ((middle - 69) / 12);
    status.textContent = `${kind === 'happy' ? 'Happy' : kind === 'low' ? 'Low' : 'High'} note captured. You can retry it before saving.`;
    if (kinds.every(name => values[name] != null) && !validSet()) {
      status.textContent = 'The low reading should be below the high reading. Retry one of them.';
    }
    render();
  }));

  saveButton.addEventListener('click', () => {
    if (saved) {
      for (const kind of kinds) values[kind] = null;
      saved = false;
      selectedSessionId = null;
      status.textContent = 'New session ready. Capture three comfortable notes.';
      render();
      renderHistory();
      return;
    }
    if (!validSet()) return;
    const results = saveResult({ type: 'range-session', lowHz: values.low, highHz: values.high, happyHz: values.happy });
    selectedSessionId = results.at(-1).id;
    saved = true;
    status.textContent = 'Range session saved in this browser.';
    render();
    renderHistory();
    onResult();
  });

  render();
  renderHistory();
  return {
    onEnter() { active = true; renderHistory(); },
    onLeave() {
      active = false;
      captureId++;
      if (microphoneReady()) stopMicrophone();
      micButton.textContent = 'Enable microphone';
      el('range-live-note').textContent = '—';
      el('range-live-detail').textContent = 'Enable the microphone, then sing a sustained note.';
      render();
    }
  };
}
