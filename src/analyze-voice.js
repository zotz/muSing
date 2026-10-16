import { hzToMidi, midiToName } from './music.js';
import { analyzeVoiceBuffer } from './voice-analysis.js';
import { playPianoMelody, playAudioBuffer, playClickTrack, playAudioChunk, playScrubCue } from './audio.js';
import { estimateNotePulse, tappedBpm } from './tempo.js';
import { notesToAbc, notesToMidi } from './note-export.js';
import { MAX_NOTE_SHIFT, renderEditedChannels, encodeWav } from './voice-edit.js';
import { resizeNote, splitNote, mergeWithNext, addNoteInGap, noteAtTime, visiblePitchRange } from './note-edit.js';
import { alignedMarkers, notesFromMarkers } from './note-markers.js';
import { quietEdgeBounds, cropTimedNotes } from './audio-trim.js';
import { chunkRanges } from './chunk-playback.js';

const SVG = 'http://www.w3.org/2000/svg';
const TIMELINE_LEFT = 43;

function clockTime(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function addSvg(parent, name, attributes = {}, content = '') {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content) node.textContent = content;
  parent.append(node);
  return node;
}

function plotWidth(duration, zoom = 1) {
  return Math.min(24000, Math.max(700, Math.round(duration * 80)) * zoom);
}

export function timelineX(seconds, duration, zoom = 1) {
  if (duration <= 0) return TIMELINE_LEFT;
  return TIMELINE_LEFT + Math.min(duration, Math.max(0, seconds)) / duration * plotWidth(duration, zoom);
}

export function timeGridSeconds(duration) {
  const step = duration <= 10 ? 0.5 : duration <= 120 ? 1 : 10;
  return Array.from({ length: Math.floor(duration / step) + 1 }, (_, index) => index * step);
}

export function waveformEnvelope(samples, graphWidth) {
  const lows = new Float32Array(graphWidth);
  const highs = new Float32Array(graphWidth);
  const activePeaks = [];
  let peak = 0;
  for (let x = 0; x < graphWidth; x++) {
    const start = Math.floor(x / graphWidth * samples.length);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((x + 1) / graphWidth * samples.length)));
    let low = 0;
    let high = 0;
    for (let index = start; index < end; index++) {
      low = Math.min(low, samples[index]);
      high = Math.max(high, samples[index]);
    }
    lows[x] = low;
    highs[x] = high;
    const level = Math.max(-low, high);
    peak = Math.max(peak, level);
    if (level >= 0.0005) activePeaks.push(level);
  }
  activePeaks.sort((a, b) => a - b);
  const typicalPeak = activePeaks[Math.floor(activePeaks.length * 0.9)] ?? 0;
  const gain = typicalPeak ? Math.min(60, Math.max(1, 0.8 / typicalPeak)) : 1;
  return { lows, highs, gain, peak };
}

export function noteTrackLayout(notes, rangeMode, selectedNote, trackHeight) {
  const { low, high } = visiblePitchRange(notes, rangeMode, selectedNote);
  const headerHeight = 20;
  const rowHeight = (trackHeight - headerHeight) / (high - low + 1);
  return { low, high, headerHeight, rowHeight, height: trackHeight };
}

export function pianoKeyRows(notes, rangeMode, selectedNote, trackHeight) {
  const { low, high, headerHeight, rowHeight } = noteTrackLayout(notes, rangeMode, selectedNote, trackHeight);
  return Array.from({ length: high - low + 1 }, (_, index) => {
    const midi = high - index;
    return { midi, y: headerHeight + index * rowHeight, height: rowHeight, black: [1, 3, 6, 8, 10].includes((midi + 120) % 12) };
  });
}

function drawPianoKeyboard(container, notes, rangeMode, selectedNote, trackHeight) {
  container.replaceChildren();
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', TIMELINE_LEFT);
  svg.setAttribute('height', trackHeight);
  svg.setAttribute('viewBox', `0 0 ${TIMELINE_LEFT} ${trackHeight}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Piano keys aligned with the note rows');
  addSvg(svg, 'rect', { x: 0, y: 0, width: TIMELINE_LEFT, height: trackHeight, fill: '#13212b' });
  for (const row of pianoKeyRows(notes, rangeMode, selectedNote, trackHeight)) {
    addSvg(svg, 'rect', { x: 0, y: row.y, width: row.black ? 30 : TIMELINE_LEFT, height: row.height, fill: row.black ? '#253137' : '#e9eee4', stroke: row.black ? '#66777a' : '#8e9d96', 'stroke-width': 0.7 });
    if (row.height >= 11) addSvg(svg, 'text', { x: 3, y: row.y + row.height / 2 + Math.min(3.5, row.height * 0.27), fill: row.black ? '#e9eee4' : '#26352e', 'font-size': Math.min(10, row.height * 0.65), 'font-weight': row.midi % 12 === 0 ? 700 : 500 }, midiToName(row.midi));
  }
  container.append(svg);
}

function drawWaveform(canvas, samples, duration, zoom) {
  const graphWidth = plotWidth(duration, zoom);
  const width = graphWidth + TIMELINE_LEFT;
  const height = 120;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#13212b';
  context.fillRect(0, 0, width, height);
  const envelope = waveformEnvelope(samples, graphWidth);
  context.fillStyle = '#c6f1cf';
  for (let x = 0; x < graphWidth; x++) {
    const high = Math.min(0.95, envelope.highs[x] * envelope.gain);
    const low = Math.max(-0.95, envelope.lows[x] * envelope.gain);
    context.fillRect(x + TIMELINE_LEFT, (1 - high) * height / 2, 1, Math.max(1, (high - low) * height / 2));
  }
  context.strokeStyle = '#42535b';
  context.fillStyle = '#b2c5c5';
  context.font = '10px sans-serif';
  for (const second of timeGridSeconds(duration)) {
    const x = Math.round(timelineX(second, duration, zoom)) + 0.5;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    if (x < width - 32) context.fillText(`${second}s`, x + 3, 12);
  }
  if (envelope.peak < 0.0005) {
    context.fillStyle = '#d4e1da';
    context.font = '13px sans-serif';
    context.fillText('Signal is nearly silent — check the microphone input.', TIMELINE_LEFT + 16, height / 2 - 10);
  }
  return envelope;
}

function drawNotes(container, list, notes, duration, zoom, rangeMode, trackHeight, onEdit, onSelect, onSeek, onCommit, selectedNote) {
  container.replaceChildren();
  list.replaceChildren();
  const { low, high, headerHeight, rowHeight, height } = noteTrackLayout(notes, rangeMode, selectedNote, trackHeight);
  const width = plotWidth(duration, zoom) + TIMELINE_LEFT;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', `${notes.length} detected notes over ${duration.toFixed(1)} seconds`);
  addSvg(svg, 'rect', { x: 0, y: 0, width, height, fill: '#13212b' });
  for (let midi = low; midi <= high; midi++) {
    const y = headerHeight + (high - midi) * rowHeight;
    addSvg(svg, 'line', { x1: TIMELINE_LEFT, x2: width, y1: y + rowHeight, y2: y + rowHeight, stroke: '#2a3c46' });
  }
  for (const second of timeGridSeconds(duration)) {
    const x = Math.round(timelineX(second, duration, zoom)) + 0.5;
    addSvg(svg, 'line', { x1: x, x2: x, y1: 0, y2: height, stroke: '#536b75' });
    if (x < width - 32) addSvg(svg, 'text', { x: x + 3, y: 11, fill: '#b2c5c5', 'font-size': 10 }, `${second}s`);
  }
  if (!notes.length) addSvg(svg, 'text', { x: TIMELINE_LEFT + 12, y: height / 2, fill: '#9bb2b2', 'font-size': 13 }, 'No stable notes detected. Try a clear solo phrase.');
  for (const [index, note] of notes.entries()) {
    const x = timelineX(note.start, duration, zoom);
    const noteWidth = Math.max(3, timelineX(note.end, duration, zoom) - x);
    const yFor = midi => headerHeight + (high - midi) * rowHeight + Math.min(2, rowHeight * 0.12);
    const currentMidi = note.targetMidi ?? note.midi;
    const rect = addSvg(svg, 'rect', { x, y: yFor(currentMidi), width: noteWidth, height: Math.max(2, rowHeight - Math.min(4, rowHeight * 0.24)), rx: Math.min(3, rowHeight / 3), fill: '#79bea6', class: `analyze-draggable-note${selectedNote === note ? ' selected' : ''}`, 'data-note-index': index, role: 'slider', tabindex: 0, 'aria-label': `Note ${index + 1} pitch`, 'aria-valuemin': note.midi - MAX_NOTE_SHIFT, 'aria-valuemax': note.midi + MAX_NOTE_SHIFT, 'aria-valuenow': currentMidi, 'aria-valuetext': midiToName(currentMidi) });
    const label = noteWidth > 35 && rowHeight >= 13 ? addSvg(svg, 'text', { x: x + 5, y: yFor(currentMidi) + rowHeight / 2 + 3, fill: '#173025', 'font-size': 10, 'font-weight': 700, 'pointer-events': 'none' }, midiToName(currentMidi)) : null;

    const row = document.createElement('div');
    row.className = `analyze-note-row${selectedNote === note ? ' selected' : ''}`;
    row.dataset.noteIndex = index;
    const time = document.createElement('span');
    time.textContent = `${note.start.toFixed(2)}–${note.end.toFixed(2)} s`;
    const name = document.createElement('strong');
    name.textContent = midiToName(currentMidi);
    const offset = document.createElement('span');
    offset.textContent = `Source ${midiToName(note.midi)} ${note.cents > 0 ? '+' : ''}${note.cents}¢ · ${note.hz.toFixed(1)} Hz`;
    row.append(time, name, offset);
    row.addEventListener('click', () => { onSelect(note); onCommit(); });
    list.append(row);
    const setPitch = midi => {
      const next = Math.max(note.midi - MAX_NOTE_SHIFT, Math.min(note.midi + MAX_NOTE_SHIFT, midi));
      if (note.targetMidi === next) return;
      note.targetMidi = next;
      rect.setAttribute('y', yFor(next));
      rect.setAttribute('aria-valuenow', next);
      rect.setAttribute('aria-valuetext', midiToName(next));
      if (label) { label.setAttribute('y', yFor(next) + rowHeight / 2 + 3); label.textContent = midiToName(next); }
      name.textContent = midiToName(next);
      onEdit(note);
    };
    rect.addEventListener('pointerdown', event => {
      event.preventDefault();
      onSelect(note);
      rect.setPointerCapture(event.pointerId);
      const initialY = event.clientY;
      const initialMidi = note.targetMidi ?? note.midi;
      const move = moved => setPitch(initialMidi - Math.round((moved.clientY - initialY) / rowHeight));
      const end = () => {
        rect.removeEventListener('pointermove', move);
        rect.removeEventListener('pointerup', end);
        rect.removeEventListener('pointercancel', end);
        onCommit();
      };
      rect.addEventListener('pointermove', move);
      rect.addEventListener('pointerup', end);
      rect.addEventListener('pointercancel', end);
    });
    rect.addEventListener('keydown', event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      onSelect(note);
      setPitch((note.targetMidi ?? note.midi) + (event.key === 'ArrowUp' ? 1 : -1));
      onCommit();
    });
  }
  svg.addEventListener('click', event => onSeek(event.clientX, svg));
  container.append(svg);
}

function drawWaveChunks(container, notes, duration, zoom, selectedNote, onSelect, onSeek, onResize, onCommit) {
  container.replaceChildren();
  for (const [index, note] of notes.entries()) {
    const chunk = document.createElement('div');
    chunk.className = `analyze-wave-chunk${selectedNote === note ? ' selected' : ''}`;
    chunk.dataset.noteIndex = index;
    const position = () => {
      const left = timelineX(note.start, duration, zoom);
      chunk.style.left = `${left}px`;
      chunk.style.width = `${Math.max(3, timelineX(note.end, duration, zoom) - left)}px`;
    };
    position();
    chunk.title = `Note ${index + 1}: ${midiToName(note.targetMidi ?? note.midi)} · ${note.start.toFixed(2)}–${note.end.toFixed(2)} s`;
    chunk.addEventListener('click', event => {
      onSelect(note);
      onSeek(event.clientX);
      onCommit();
    });
    for (const edge of ['start', 'end']) {
      const handle = document.createElement('div');
      handle.className = `analyze-chunk-handle ${edge}`;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-label', `Note ${index + 1} ${edge} boundary`);
      handle.addEventListener('click', event => event.stopPropagation());
      handle.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(note);
        handle.setPointerCapture(event.pointerId);
        const originX = event.clientX;
        const originTime = note[edge];
        const move = moved => {
          const time = originTime + (moved.clientX - originX) / plotWidth(duration, zoom) * duration;
          if (resizeNote(notes, index, edge, time, duration)) {
            position();
            onResize(note);
          }
        };
        const end = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          onCommit();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      });
      chunk.append(handle);
    }
    container.append(chunk);
  }
}

export function initAnalyzeVoice() {
  const el = id => document.getElementById(id);
  const startButton = el('analyze-start');
  const stopButton = el('analyze-stop');
  const runButton = el('analyze-run');
  const downloadButton = el('analyze-download');
  const playNotesButton = el('analyze-play-notes');
  const playBothButton = el('analyze-play-both');
  const playTunedBothButton = el('analyze-play-tuned-both');
  const playEditedButton = el('analyze-play-edited');
  const melodyButtons = { notes: playNotesButton, both: playBothButton, edited: playEditedButton, 'tuned-both': playTunedBothButton };
  const melodyLabels = { notes: '▶  Play detected notes', both: '▶  Play notes + original voice', edited: '▶  Play tuned voice', 'tuned-both': '▶  Play notes + tuned voice' };
  const downloadEditedButton = el('analyze-download-edited');
  const snapButton = el('analyze-snap');
  const resetButton = el('analyze-reset-notes');
  const addNoteButton = el('analyze-add-note');
  const splitButton = el('analyze-split-note');
  const mergeButton = el('analyze-merge-note');
  const selectionLabel = el('analyze-selection');
  const boundaryButtons = {
    'analyze-start-earlier': ['start', -0.02],
    'analyze-start-later': ['start', 0.02],
    'analyze-end-earlier': ['end', -0.02],
    'analyze-end-later': ['end', 0.02]
  };
  const speedSelect = el('analyze-speed');
  const zoomSlider = el('analyze-zoom');
  const playheadTime = el('analyze-playhead-time');
  const waveNow = el('analyze-wave-now');
  const scrubMode = el('analyze-scrub-mode');
  const pitchRangeSelect = el('analyze-pitch-range');
  const trackHeightSlider = el('analyze-track-height');
  const toggleListButton = el('analyze-toggle-list');
  const noteList = el('analyze-note-list');
  const notePlaybackStatus = el('analyze-note-playback-status');
  const status = el('analyze-status');
  const audio = el('analyze-audio');
  const timer = el('analyze-timer');
  const waveScroll = el('analyze-wave-scroll');
  const noteScroll = el('analyze-note-scroll');
  const waveCanvas = el('analyze-waveform');
  const waveChunks = el('analyze-wave-chunks');
  const tapMarkers = el('analyze-tap-markers');
  const chunkSource = el('analyze-chunk-source');
  const chunkVoice = el('analyze-chunk-voice');
  const chunkNotes = el('analyze-chunk-notes');
  const chunkClicks = el('analyze-chunk-clicks');
  const chunkAuto = el('analyze-chunk-auto');
  const chunkPrev = el('analyze-chunk-prev');
  const chunkPlay = el('analyze-chunk-play');
  const chunkNext = el('analyze-chunk-next');
  const chunkPosition = el('analyze-chunk-position');
  const chunkStatus = el('analyze-chunk-status');
  const chunkHighlight = el('analyze-chunk-highlight');
  const trimQuietButton = el('analyze-trim-quiet');
  const trimStartButton = el('analyze-trim-start');
  const trimEndButton = el('analyze-trim-end');
  const trimRestoreButton = el('analyze-trim-restore');
  const trimStatus = el('analyze-trim-status');
  const tapsStartButton = el('analyze-taps-start');
  const tapsStopButton = el('analyze-taps-stop');
  const tapsClearButton = el('analyze-taps-clear');
  const tapsApplyButton = el('analyze-taps-apply');
  const tapsRestoreButton = el('analyze-taps-restore');
  const tapsShift = el('analyze-taps-shift');
  const tapsShiftNumber = el('analyze-taps-shift-number');
  const tapsStatus = el('analyze-taps-status');
  const tapKeyButton = el('analyze-tap-key');
  const tapKeyLabel = el('analyze-tap-key-label');
  const tapsWithVoice = el('analyze-taps-with-voice');
  const tapsGuideVoice = el('analyze-taps-guide-voice');
  const tapsPlayButton = el('analyze-taps-play');
  const tapsPlayVoiceButton = el('analyze-taps-play-voice');
  const tapsPlayStatus = el('analyze-taps-play-status');
  const nowLines = [el('analyze-wave-now'), el('analyze-note-now')];
  const tapTempoButton = el('analyze-tap-tempo');
  const resetTempoButton = el('analyze-reset-tempo');
  const downloadAbcButton = el('analyze-download-abc');
  const downloadMidiButton = el('analyze-download-midi');
  let active = false;
  let stream = null;
  let recorder = null;
  let chunks = [];
  let blob = null;
  let audioUrl = null;
  let timerId = null;
  let startedAt = 0;
  let analysisToken = 0;
  let timelineDuration = 0;
  let playheadFrame = null;
  let detectedNotes = [];
  let decodedBuffer = null;
  let editedBuffer = null;
  let waveSamples = null;
  let analysisFrames = [];
  let selectedNote = null;
  let zoom = 1;
  let melodyPlayback = null;
  let melodyMode = null;
  let melodyToken = 0;
  let preparingMelody = false;
  let scrubCue = null;
  let scrubToken = 0;
  let pitchCue = null;
  let pitchCueToken = 0;
  let lastCueAt = -Infinity;
  let draggingPlayhead = false;
  let dragFrame = null;
  let pendingDragX = null;
  let estimatedBpm = null;
  let manualBpm = null;
  let tempoTaps = [];
  let noteTaps = [];
  let tapPassStartedAt = null;
  let tapShift = 0;
  let tapAnchor = 0;
  let automaticNotes = [];
  let originalBlob = null;
  let fullTakeState = null;
  let tapCaptureMode = 'separate';
  let choosingTapKey = false;
  let tapKeyCode = 'KeyT';
  let tapKeyName = 'T';
  let clickPlayback = null;
  let clickPlaybackToken = 0;
  let chunkIndex = 0;
  let chunkPlayback = null;
  let chunkPlaybackToken = 0;
  let guidePlayback = null;
  let guideToken = 0;
  try {
    const saved = JSON.parse(localStorage.getItem('musing-analyze-tap-key'));
    if (saved && typeof saved.code === 'string' && typeof saved.name === 'string') {
      tapKeyCode = saved.code;
      tapKeyName = saved.name;
    }
  } catch { /* Browser storage may be unavailable. */ }
  tapKeyLabel.textContent = `Tap key: ${tapKeyName}`;

  function endTapKeyChoice() {
    choosingTapKey = false;
    tapKeyButton.textContent = 'Click to set tap key';
    tapKeyLabel.textContent = `Tap key: ${tapKeyName}`;
  }

  function markerPositions() { return alignedMarkers(noteTaps, tapAnchor, tapShift, timelineDuration); }

  function selectedChunks() { return chunkRanges(chunkSource.value, detectedNotes, markerPositions(), timelineDuration); }

  function updateChunkControls() {
    const ranges = selectedChunks();
    chunkIndex = Math.max(0, Math.min(chunkIndex, ranges.length - 1));
    const range = ranges[chunkIndex];
    const hasSound = chunkVoice.value !== 'none' || chunkNotes.checked || chunkClicks.checked;
    chunkPrev.disabled = !range || chunkIndex === 0;
    chunkNext.disabled = !range || chunkIndex === ranges.length - 1;
    chunkPlay.disabled = !range || !hasSound || !decodedBuffer;
    chunkPosition.textContent = range ? `${range.label} · ${chunkIndex + 1}/${ranges.length} · ${range.start.toFixed(2)}–${range.end.toFixed(2)} s` : 'No chunks for this source';
    chunkHighlight.style.display = range ? 'block' : 'none';
    if (range) {
      chunkHighlight.style.left = `${timelineX(range.start, timelineDuration, zoom)}px`;
      chunkHighlight.style.width = `${Math.max(2, timelineX(range.end, timelineDuration, zoom) - timelineX(range.start, timelineDuration, zoom))}px`;
    }
  }

  function stopChunkPlayback(message = '') {
    chunkPlaybackToken++;
    if (chunkPlayback) audio.currentTime = Math.min(timelineDuration, chunkPlayback.currentTime());
    chunkPlayback?.stop();
    chunkPlayback = null;
    chunkPlay.textContent = '▶ Play chunk';
    chunkStatus.textContent = message;
    updateChunkControls();
    if (audio.paused && !melodyPlayback && !clickPlayback) stopPlayheadLoop();
  }

  async function playSelectedChunk() {
    if (chunkPlayback) { stopChunkPlayback('Chunk playback stopped.'); return; }
    const range = selectedChunks()[chunkIndex];
    if (!range || !decodedBuffer || chunkPlay.disabled) return;
    stopClickPlayback();
    stopMelody();
    audio.pause();
    scrubToken++;
    scrubCue?.stop();
    const token = ++chunkPlaybackToken;
    chunkPlay.disabled = true;
    chunkStatus.textContent = 'Preparing chunk…';
    try {
      const playback = await playAudioChunk({
        start: range.start, end: range.end,
        recordingBuffer: chunkVoice.value === 'tuned' ? getEditedBuffer() : chunkVoice.value === 'original' ? decodedBuffer : null,
        notes: chunkNotes.checked ? detectedNotes.map(note => ({ ...note, midi: note.targetMidi ?? note.midi })) : [],
        clicks: chunkClicks.checked ? markerPositions() : [],
        speed: Number(speedSelect.value)
      });
      if (token !== chunkPlaybackToken || !active) { playback?.stop(); return; }
      chunkPlayback = playback;
      chunkPlay.disabled = false;
      chunkPlay.textContent = '■ Stop chunk';
      chunkStatus.textContent = `Playing ${range.label.toLowerCase()}.`;
      if (playheadFrame == null) playheadFrame = requestAnimationFrame(animatePlayhead);
      playback.done.then(() => {
        if (chunkPlayback === playback) {
          audio.currentTime = range.end;
          chunkPlayback = null;
          chunkPlay.textContent = '▶ Play chunk';
          chunkStatus.textContent = 'Chunk finished.';
          stopPlayheadLoop();
        }
      });
    } catch (error) {
      if (token === chunkPlaybackToken) chunkStatus.textContent = `Could not play chunk: ${error.message || error.name}.`;
    } finally {
      if (token === chunkPlaybackToken) updateChunkControls();
    }
  }

  function stepChunk(direction) {
    stopChunkPlayback();
    chunkIndex = Math.max(0, Math.min(selectedChunks().length - 1, chunkIndex + direction));
    updateChunkControls();
    const range = selectedChunks()[chunkIndex];
    if (!range) return;
    audio.currentTime = range.start;
    updatePlayhead();
    if (chunkAuto.checked) void playSelectedChunk();
  }

  chunkPrev.addEventListener('click', () => stepChunk(-1));
  chunkNext.addEventListener('click', () => stepChunk(1));
  chunkPlay.addEventListener('click', () => void playSelectedChunk());
  chunkSource.addEventListener('change', () => { stopChunkPlayback(); chunkIndex = 0; updateChunkControls(); });
  for (const option of [chunkVoice, chunkNotes, chunkClicks]) option.addEventListener('change', () => { stopChunkPlayback(); updateChunkControls(); });

  function updateTapControls() {
    const hasTaps = noteTaps.length > 0;
    const canAlign = hasTaps && Boolean(decodedBuffer);
    tapsClearButton.disabled = !hasTaps && tapPassStartedAt == null;
    tapsApplyButton.disabled = !canAlign || tapPassStartedAt != null;
    tapsRestoreButton.disabled = !decodedBuffer;
    tapsShift.disabled = !canAlign;
    tapsShiftNumber.disabled = !canAlign;
    tapsPlayButton.disabled = !hasTaps || tapPassStartedAt != null || recorder?.state === 'recording';
    tapsPlayVoiceButton.disabled = !canAlign || tapPassStartedAt != null || recorder?.state === 'recording';
    tapsGuideVoice.disabled = !hasTaps || tapsWithVoice.checked || recorder?.state === 'recording';
    if (!hasTaps || tapsWithVoice.checked) tapsGuideVoice.checked = false;
    el('analyze-taps-align-help').textContent = tapCaptureMode === 'live'
      ? 'Live taps keep their recording times until shifted.'
      : 'First tap starts at the first detected note until shifted.';
    tapsShift.value = String(Math.max(-3, Math.min(3, tapShift)));
    tapsShiftNumber.value = tapShift.toFixed(2);
    if (!decodedBuffer) { updateChunkControls(); return; }
    tapMarkers.replaceChildren();
    markerPositions().forEach((time, index) => {
      const marker = document.createElement('div');
      marker.className = 'analyze-tap-marker';
      marker.style.left = `${timelineX(time, timelineDuration, zoom)}px`;
      marker.title = `Tap ${index + 1}: ${time.toFixed(2)} s`;
      tapMarkers.append(marker);
    });
    updateChunkControls();
  }

  function stopTapPass() {
    if (tapPassStartedAt == null) return;
    tapPassStartedAt = null;
    tapsStartButton.disabled = false;
    tapKeyButton.disabled = false;
    tapsStopButton.disabled = true;
    speedSelect.disabled = false;
    if (!audio.paused) audio.pause();
    audio.playbackRate = Number(speedSelect.value);
    tapsStatus.textContent = noteTaps.length ? `${noteTaps.length} note-start taps captured. Align them after analysis.` : 'No taps captured. Start another tap pass.';
    updateTapControls();
  }

  tapsStartButton.addEventListener('click', async () => {
    if (recorder?.state === 'recording' || tapPassStartedAt != null) return;
    endTapKeyChoice();
    noteTaps = [];
    tapCaptureMode = 'separate';
    if (decodedBuffer) tapAnchor = automaticNotes[0]?.start ?? 0;
    tapShift = 0;
    stopClickPlayback();
    stopGuidePlayback();
    tapsStartButton.disabled = true;
    tapKeyButton.disabled = true;
    tapsStopButton.disabled = false;
    speedSelect.disabled = true;
    tapPassStartedAt = performance.now();
    if (blob) {
      audio.currentTime = 0;
      audio.playbackRate = 1;
      try { await audio.play(); } catch { /* Tapping can still be done without playback. */ }
    }
    if (tapPassStartedAt == null) return;
    tapsStatus.textContent = `Tap ${tapKeyName} once per note start, then stop the pass.`;
    updateTapControls();
  });
  tapsStopButton.addEventListener('click', stopTapPass);
  tapsClearButton.addEventListener('click', () => {
    stopTapPass();
    stopClickPlayback();
    noteTaps = [];
    tapShift = 0;
    tapsStatus.textContent = 'No taps recorded.';
    updateTapControls();
  });
  tapsWithVoice.addEventListener('change', updateTapControls);
  tapKeyButton.addEventListener('click', () => {
    choosingTapKey = true;
    tapKeyButton.textContent = 'Press a key…';
    tapKeyLabel.textContent = 'Press the key you want to use. Escape cancels.';
  });
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (choosingTapKey) {
      event.preventDefault();
      if (event.code !== 'Escape' && !['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)) {
        tapKeyCode = event.code;
        tapKeyName = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
        try { localStorage.setItem('musing-analyze-tap-key', JSON.stringify({ code: tapKeyCode, name: tapKeyName })); } catch { /* Session setting still works. */ }
      }
      endTapKeyChoice();
      return;
    }
    const live = tapCaptureMode === 'live' && recorder?.state === 'recording';
    if ((tapPassStartedAt == null && !live) || event.code !== tapKeyCode) return;
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return;
    event.preventDefault();
    if (event.repeat) return;
    noteTaps.push((performance.now() - (live ? startedAt : tapPassStartedAt)) / 1000);
    tapsStatus.textContent = `${noteTaps.length} ${noteTaps.length === 1 ? 'tap' : 'taps'} captured.`;
    updateTapControls();
  });
  const setTapShift = value => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    tapShift = Math.max(-120, Math.min(120, next));
    if (chunkPlayback) stopChunkPlayback();
    stopClickPlayback();
    updateTapControls();
  };
  tapsShift.addEventListener('input', () => setTapShift(tapsShift.value));
  tapsShiftNumber.addEventListener('change', () => setTapShift(tapsShiftNumber.value));

  function updateTempoDisplay() {
    el('analyze-tempo-value').textContent = manualBpm ? `${manualBpm} BPM · tapped` : estimatedBpm ? `About ${estimatedBpm} BPM` : 'Tempo uncertain';
    el('analyze-tempo-detail').textContent = manualBpm
      ? 'Your tapped beat is used for ABC and MIDI export. Note timing stays unchanged.'
      : estimatedBpm
        ? 'Estimated from note starts. The beat may be half or twice this rate. Tap to set it yourself.'
        : 'Tap at least three beats to set a tempo for note export.';
  }

  function downloadNoteFile(data, extension, type) {
    if (!detectedNotes.length) return;
    const payload = data instanceof Uint8Array ? data : String(data);
    const url = URL.createObjectURL(new Blob([payload], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `muSing-notes-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function selectedIndex() { return detectedNotes.indexOf(selectedNote); }

  function syncSelection() {
    const index = selectedIndex();
    selectionLabel.textContent = index < 0 ? 'No note selected' : `Note ${index + 1}: ${midiToName(selectedNote.targetMidi ?? selectedNote.midi)} · ${selectedNote.start.toFixed(2)}–${selectedNote.end.toFixed(2)} s`;
    splitButton.disabled = index < 0;
    mergeButton.disabled = index < 0 || index === detectedNotes.length - 1;
    for (const id of Object.keys(boundaryButtons)) el(id).disabled = index < 0;
    for (const node of document.querySelectorAll('[data-note-index]')) node.classList.toggle('selected', Number(node.dataset.noteIndex) === index);
  }

  function selectNote(note) {
    selectedNote = note;
    syncSelection();
  }

  async function auditionAt(seconds, force = false) {
    if (!decodedBuffer || scrubMode.value === 'off') return;
    const now = performance.now();
    if (!force && now - lastCueAt < 130) return;
    lastCueAt = now;
    scrubCue?.stop();
    const token = ++scrubToken;
    try {
      const cue = await playScrubCue(decodedBuffer, noteAtTime(detectedNotes, seconds), seconds, scrubMode.value);
      if (token !== scrubToken || !active) cue?.stop();
      else scrubCue = cue;
    } catch (error) {
      if (token === scrubToken) notePlaybackStatus.textContent = `Seek cue unavailable: ${error.name || 'audio error'}.`;
    }
  }

  function stopPitchCue() {
    pitchCueToken++;
    pitchCue?.stop();
    pitchCue = null;
  }

  async function auditionPitch(midi) {
    stopPitchCue();
    const token = pitchCueToken;
    try {
      const cue = await playScrubCue(null, { midi }, 0, 'note');
      if (token !== pitchCueToken || !active) cue?.stop();
      else pitchCue = cue;
    } catch (error) {
      if (token === pitchCueToken) notePlaybackStatus.textContent = `Pitch preview unavailable: ${error.name || 'audio error'}.`;
    }
  }

  function seekTo(seconds, forceCue = false) {
    if (!decodedBuffer) return;
    if (chunkPlayback) stopChunkPlayback();
    if (clickPlayback) stopClickPlayback();
    if (!audio.paused) audio.pause();
    if (melodyPlayback || preparingMelody) stopMelody();
    const position = Math.max(0, Math.min(timelineDuration, seconds));
    if (!forceCue && Math.abs(audio.currentTime - position) <= 0.001) return;
    if (Math.abs(audio.currentTime - position) > 0.001) audio.currentTime = position;
    updatePlayhead();
    void auditionAt(position, forceCue);
  }

  function seekFromClientX(clientX, element = waveCanvas) {
    const bounds = element.getBoundingClientRect();
    seekTo((clientX - bounds.left - TIMELINE_LEFT) / plotWidth(timelineDuration, zoom) * timelineDuration);
  }

  function renderTimeline() {
    if (!decodedBuffer || !waveSamples) return;
    const envelope = drawWaveform(waveCanvas, waveSamples, timelineDuration, zoom);
    el('analyze-wave-scale').textContent = envelope.peak < 0.0005 ? 'Signal nearly silent' : envelope.gain > 1.1 ? `Display amplified ×${envelope.gain < 10 ? envelope.gain.toFixed(1) : Math.round(envelope.gain)}; audio unchanged` : 'Original amplitude';
    drawPianoKeyboard(el('analyze-piano-keyboard'), detectedNotes, pitchRangeSelect.value, selectedNote, Number(trackHeightSlider.value));
    drawNotes(el('analyze-note-track'), noteList, detectedNotes, timelineDuration, zoom, pitchRangeSelect.value, Number(trackHeightSlider.value), onNoteEdit, selectNote, seekFromClientX, renderTimeline, selectedNote);
    drawWaveChunks(waveChunks, detectedNotes, timelineDuration, zoom, selectedNote, selectNote, seekFromClientX, onBoundaryEdit, renderTimeline);
    updateTapControls();
    el('analyze-note-count').textContent = `${detectedNotes.length} ${detectedNotes.length === 1 ? 'note' : 'notes'}`;
    syncSelection();
    updatePlayhead();
  }

  function showRecordingBlob(nextBlob) {
    audio.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    blob = nextBlob;
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl;
    audio.load();
    audio.playbackRate = Number(speedSelect.value);
    audio.preservesPitch = true;
  }

  function snapshotFullTake() {
    if (fullTakeState) return;
    fullTakeState = {
      buffer: decodedBuffer,
      samples: waveSamples,
      notes: detectedNotes.map(note => ({ ...note })),
      automaticNotes: automaticNotes.map(note => ({ ...note })),
      frames: analysisFrames.map(frame => ({ ...frame })),
      tapAnchor, tapShift, noteTaps: [...noteTaps], tapCaptureMode,
      estimatedBpm, manualBpm, tempoTaps: [...tempoTaps]
    };
  }

  function applyTrim(start, end) {
    if (!decodedBuffer) return;
    stopChunkPlayback();
    const rate = decodedBuffer.sampleRate;
    const first = Math.max(0, Math.floor(start * rate));
    const last = Math.min(decodedBuffer.length, Math.ceil(end * rate));
    const actualStart = first / rate;
    const actualEnd = last / rate;
    if (last - first < rate * 0.15) {
      trimStatus.textContent = 'Keep at least 0.15 seconds of audio.';
      return;
    }
    if (first === 0 && last === decodedBuffer.length) {
      trimStatus.textContent = 'No edge audio to trim at this position.';
      return;
    }
    snapshotFullTake();
    stopTapPass();
    stopClickPlayback();
    stopMelody();
    scrubToken++;
    scrubCue?.stop();
    analysisToken++;
    const source = decodedBuffer;
    const context = new AudioContext();
    const cropped = context.createBuffer(source.numberOfChannels, last - first, rate);
    const channels = [];
    for (let channel = 0; channel < source.numberOfChannels; channel++) {
      const samples = source.getChannelData(channel).subarray(first, last);
      cropped.copyToChannel(samples, channel);
      channels.push(samples);
    }
    void context.close().catch(() => {});
    decodedBuffer = cropped;
    waveSamples = Float32Array.from(waveSamples.subarray(first, last));
    detectedNotes = cropTimedNotes(detectedNotes, actualStart, actualEnd);
    automaticNotes = cropTimedNotes(automaticNotes, actualStart, actualEnd);
    analysisFrames = analysisFrames.filter(frame => frame.time >= actualStart && frame.time <= actualEnd)
      .map(frame => ({ ...frame, time: frame.time - actualStart }));
    tapAnchor -= actualStart;
    selectedNote = null;
    editedBuffer = null;
    timelineDuration = cropped.duration;
    waveNow.setAttribute('aria-valuemax', timelineDuration.toFixed(2));
    showRecordingBlob(encodeWav(channels, rate));
    audio.currentTime = 0;
    estimatedBpm = estimateNotePulse(detectedNotes)?.bpm ?? null;
    updateTempoDisplay();
    el('analyze-duration').textContent = `${timelineDuration.toFixed(1)} seconds`;
    waveScroll.scrollLeft = 0;
    noteScroll.scrollLeft = 0;
    trimRestoreButton.disabled = false;
    afterStructureEdit('Take trimmed. Notes and taps now use the shortened timeline.');
    trimStatus.textContent = `Trimmed to ${timelineDuration.toFixed(2)} seconds. Download recording saves the shortened WAV.`;
  }

  trimQuietButton.addEventListener('click', () => {
    if (!decodedBuffer) return;
    const { start, end } = quietEdgeBounds(waveSamples, decodedBuffer.sampleRate, timelineDuration);
    applyTrim(start, end);
  });
  const currentTrimPosition = () => chunkPlayback?.currentTime() ?? clickPlayback?.currentTime() ?? melodyPlayback?.currentTime() ?? audio.currentTime;
  trimStartButton.addEventListener('click', () => applyTrim(currentTrimPosition(), timelineDuration));
  trimEndButton.addEventListener('click', () => applyTrim(0, currentTrimPosition()));
  trimRestoreButton.addEventListener('click', () => {
    if (!fullTakeState || !originalBlob) return;
    stopTapPass();
    stopClickPlayback();
    stopMelody();
    const saved = fullTakeState;
    decodedBuffer = saved.buffer;
    waveSamples = saved.samples;
    detectedNotes = saved.notes.map(note => ({ ...note }));
    automaticNotes = saved.automaticNotes.map(note => ({ ...note }));
    analysisFrames = saved.frames.map(frame => ({ ...frame }));
    tapAnchor = saved.tapAnchor;
    tapShift = saved.tapShift;
    noteTaps = [...saved.noteTaps];
    tapCaptureMode = saved.tapCaptureMode;
    estimatedBpm = saved.estimatedBpm;
    manualBpm = saved.manualBpm;
    tempoTaps = [...saved.tempoTaps];
    selectedNote = null;
    editedBuffer = null;
    timelineDuration = decodedBuffer.duration;
    waveNow.setAttribute('aria-valuemax', timelineDuration.toFixed(2));
    showRecordingBlob(originalBlob);
    audio.currentTime = 0;
    waveScroll.scrollLeft = 0;
    noteScroll.scrollLeft = 0;
    el('analyze-duration').textContent = `${timelineDuration.toFixed(1)} seconds`;
    updateTempoDisplay();
    fullTakeState = null;
    trimRestoreButton.disabled = true;
    afterStructureEdit('Full take restored.');
    trimStatus.textContent = 'Full recording restored.';
  });

  function afterStructureEdit(message) {
    editedBuffer = null;
    if (chunkPlayback) stopChunkPlayback();
    stopMelody();
    renderTimeline();
    playNotesButton.disabled = !detectedNotes.length;
    playBothButton.disabled = !detectedNotes.length;
    playEditedButton.disabled = !detectedNotes.length;
    playTunedBothButton.disabled = !detectedNotes.length;
    downloadEditedButton.disabled = !detectedNotes.length;
    snapButton.disabled = !detectedNotes.length;
    resetButton.disabled = !detectedNotes.length;
    downloadAbcButton.disabled = !detectedNotes.length;
    downloadMidiButton.disabled = !detectedNotes.length;
    notePlaybackStatus.textContent = message;
  }

  tapsApplyButton.addEventListener('click', () => {
    if (!decodedBuffer || !noteTaps.length) return;
    const positions = markerPositions();
    const marked = notesFromMarkers(positions, analysisFrames, automaticNotes, timelineDuration);
    if (!marked.length) {
      tapsStatus.textContent = 'No sung pitches found under these taps. Slide the tap track and try again.';
      return;
    }
    detectedNotes = marked.map(note => ({ ...note, targetMidi: null }));
    selectedNote = null;
    estimatedBpm = estimateNotePulse(detectedNotes)?.bpm ?? null;
    updateTempoDisplay();
    afterStructureEdit(`Used ${marked.length} tap starts. Adjust note ends and pitches on the timeline.`);
    tapsStatus.textContent = `${marked.length} notes placed from ${noteTaps.length} taps.`;
  });
  tapsRestoreButton.addEventListener('click', () => {
    if (!decodedBuffer) return;
    detectedNotes = automaticNotes.map(note => ({ ...note, targetMidi: null }));
    selectedNote = null;
    estimatedBpm = estimateNotePulse(detectedNotes)?.bpm ?? null;
    updateTempoDisplay();
    afterStructureEdit('Automatic notes restored.');
  });

  function stopMelody(message = '', keepPosition = true) {
    stopPitchCue();
    melodyToken++;
    preparingMelody = false;
    if (melodyPlayback && keepPosition) audio.currentTime = melodyPlayback.currentTime();
    melodyPlayback?.stop();
    melodyPlayback = null;
    melodyMode = null;
    for (const [mode, button] of Object.entries(melodyButtons)) {
      button.disabled = !detectedNotes.length || (mode !== 'notes' && !decodedBuffer);
      button.textContent = melodyLabels[mode];
    }
    notePlaybackStatus.textContent = message;
    if (audio.paused) stopPlayheadLoop();
  }

  function stopClickPlayback(message = '') {
    clickPlaybackToken++;
    clickPlayback?.stop();
    clickPlayback = null;
    tapsPlayButton.textContent = '▶ Play tap clicks';
    tapsPlayVoiceButton.textContent = '▶ Play voice + clicks';
    tapsPlayStatus.textContent = message;
    if (audio.paused && !melodyPlayback) stopPlayheadLoop();
  }

  function stopGuidePlayback() {
    guideToken++;
    guidePlayback?.stop();
    guidePlayback = null;
  }

  async function startClickPlayback(withVoice) {
    if (clickPlayback) { stopClickPlayback('Click playback stopped.'); return; }
    stopChunkPlayback();
    const times = decodedBuffer ? markerPositions() : noteTaps.map(time => time - noteTaps[0]);
    if (!times.length || (withVoice && !decodedBuffer)) return;
    stopMelody();
    audio.pause();
    const token = ++clickPlaybackToken;
    tapsPlayButton.disabled = true;
    tapsPlayVoiceButton.disabled = true;
    tapsPlayStatus.textContent = 'Preparing click track…';
    try {
      const playback = await playClickTrack(times, withVoice ? decodedBuffer : null, Number(speedSelect.value));
      if (token !== clickPlaybackToken || !active) { playback?.stop(); return; }
      clickPlayback = playback;
      tapsPlayButton.disabled = false;
      tapsPlayVoiceButton.disabled = !decodedBuffer;
      (withVoice ? tapsPlayVoiceButton : tapsPlayButton).textContent = '■ Stop clicks';
      tapsPlayStatus.textContent = withVoice ? 'Playing voice with aligned clicks.' : 'Playing tap clicks.';
      if (decodedBuffer && playheadFrame == null) playheadFrame = requestAnimationFrame(animatePlayhead);
      playback.done.then(() => {
        if (clickPlayback === playback) stopClickPlayback('Click playback finished.');
      });
    } catch (error) {
      if (token === clickPlaybackToken) {
        updateTapControls();
        tapsPlayStatus.textContent = `Could not play clicks: ${error.name || 'audio error'}.`;
      }
    }
  }
  tapsPlayButton.addEventListener('click', () => startClickPlayback(false));
  tapsPlayVoiceButton.addEventListener('click', () => startClickPlayback(true));

  waveScroll.addEventListener('scroll', () => { noteScroll.scrollLeft = waveScroll.scrollLeft; });
  noteScroll.addEventListener('scroll', () => { waveScroll.scrollLeft = noteScroll.scrollLeft; });
  const timeAtPointer = clientX => {
    const x = clientX - waveScroll.getBoundingClientRect().left + waveScroll.scrollLeft;
    return (x - TIMELINE_LEFT) / plotWidth(timelineDuration, zoom) * timelineDuration;
  };
  const dragTick = () => {
    if (!draggingPlayhead) { dragFrame = null; return; }
    const bounds = waveScroll.getBoundingClientRect();
    const edge = 28;
    const leftDistance = pendingDragX - bounds.left;
    const rightDistance = bounds.right - pendingDragX;
    if (leftDistance < edge) waveScroll.scrollLeft -= Math.min(12, Math.ceil((edge - leftDistance) / 3));
    else if (rightDistance < edge) waveScroll.scrollLeft += Math.min(12, Math.ceil((edge - rightDistance) / 3));
    seekTo(timeAtPointer(pendingDragX));
    dragFrame = requestAnimationFrame(dragTick);
  };
  waveScroll.addEventListener('pointerdown', event => {
    if (!decodedBuffer || (event.target !== waveCanvas && event.target !== waveNow)) return;
    event.preventDefault();
    draggingPlayhead = true;
    pendingDragX = event.clientX;
    waveScroll.setPointerCapture(event.pointerId);
    seekTo(timeAtPointer(event.clientX));
    dragFrame = requestAnimationFrame(dragTick);
  });
  waveScroll.addEventListener('pointermove', event => {
    if (!draggingPlayhead) return;
    pendingDragX = event.clientX;
  });
  const endDrag = event => {
    if (!draggingPlayhead) return;
    draggingPlayhead = false;
    if (dragFrame != null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
    pendingDragX = null;
    seekTo(timeAtPointer(event.clientX), true);
  };
  waveScroll.addEventListener('pointerup', endDrag);
  waveScroll.addEventListener('pointercancel', endDrag);
  waveNow.addEventListener('keydown', event => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const next = event.key === 'ArrowLeft' ? audio.currentTime - step
      : event.key === 'ArrowRight' ? audio.currentTime + step
        : event.key === 'Home' ? 0 : event.key === 'End' ? timelineDuration : null;
    if (next == null) return;
    event.preventDefault();
    seekTo(next, true);
  });
  pitchRangeSelect.addEventListener('change', renderTimeline);
  trackHeightSlider.addEventListener('input', () => {
    const height = Number(trackHeightSlider.value);
    el('analyze-track-height-value').textContent = `${height} px`;
    renderTimeline();
  });
  toggleListButton.addEventListener('click', () => {
    const show = noteList.classList.toggle('hidden') === false;
    toggleListButton.textContent = show ? 'Hide note list' : 'Show note list';
    toggleListButton.setAttribute('aria-expanded', String(show));
  });
  tapTempoButton.addEventListener('click', () => {
    const now = performance.now();
    if (tempoTaps.length && now - tempoTaps.at(-1) > 2000) tempoTaps = [];
    tempoTaps.push(now);
    manualBpm = tappedBpm(tempoTaps);
    if (manualBpm) updateTempoDisplay();
    else el('analyze-tempo-detail').textContent = `Tap ${Math.max(0, 3 - tempoTaps.length)} more ${tempoTaps.length === 2 ? 'beat' : 'beats'} to set tempo.`;
  });
  resetTempoButton.addEventListener('click', () => {
    tempoTaps = [];
    manualBpm = null;
    updateTempoDisplay();
  });
  downloadAbcButton.addEventListener('click', () => downloadNoteFile(notesToAbc(detectedNotes, manualBpm ?? estimatedBpm ?? 120), 'abc', 'text/plain'));
  downloadMidiButton.addEventListener('click', () => downloadNoteFile(notesToMidi(detectedNotes, manualBpm ?? estimatedBpm ?? 120), 'mid', 'audio/midi'));
  speedSelect.addEventListener('change', () => {
    audio.playbackRate = Number(speedSelect.value);
    audio.preservesPitch = true;
    if (clickPlayback) stopClickPlayback('Playback speed changed. Play clicks again to hear the new speed.');
    if (chunkPlayback) stopChunkPlayback('Playback speed changed. Play the chunk again.');
    if (melodyPlayback) {
      const mode = melodyMode;
      stopMelody();
      void startMelody(mode);
    }
  });
  zoomSlider.addEventListener('input', () => {
    zoom = Number(zoomSlider.value);
    el('analyze-zoom-value').textContent = `${zoom}×`;
    renderTimeline();
    const x = timelineX(melodyPlayback?.currentTime() ?? audio.currentTime, timelineDuration, zoom);
    waveScroll.scrollLeft = Math.max(0, x - waveScroll.clientWidth / 2);
    noteScroll.scrollLeft = waveScroll.scrollLeft;
  });

  function updatePlayhead(follow = false) {
    if (!timelineDuration) return;
    const time = chunkPlayback ? chunkPlayback.currentTime() : clickPlayback ? clickPlayback.currentTime() : melodyPlayback ? melodyPlayback.currentTime() : audio.currentTime;
    const x = timelineX(time, timelineDuration, zoom);
    nowLines.forEach(line => { line.style.left = `${x}px`; });
    playheadTime.textContent = `${time.toFixed(2)} s`;
    waveNow.setAttribute('aria-valuenow', time.toFixed(2));
    waveNow.setAttribute('aria-valuetext', `${time.toFixed(2)} seconds`);
    const visibleX = x - waveScroll.scrollLeft;
    if (follow && !draggingPlayhead && (visibleX > waveScroll.clientWidth * 0.8 || visibleX < waveScroll.clientWidth * 0.2)) {
      waveScroll.scrollLeft = Math.max(0, x - waveScroll.clientWidth * (visibleX > waveScroll.clientWidth * 0.8 ? 0.8 : 0.2));
      noteScroll.scrollLeft = waveScroll.scrollLeft;
    }
  }

  function stopPlayheadLoop() {
    if (playheadFrame != null) cancelAnimationFrame(playheadFrame);
    playheadFrame = null;
    updatePlayhead();
  }

  function animatePlayhead() {
    updatePlayhead(true);
    if (chunkPlayback || clickPlayback || melodyPlayback || (!audio.paused && !audio.ended)) playheadFrame = requestAnimationFrame(animatePlayhead);
    else playheadFrame = null;
  }

  audio.addEventListener('play', () => {
    stopPitchCue();
    if (chunkPlayback) stopChunkPlayback();
    if (clickPlayback) stopClickPlayback();
    scrubToken++;
    scrubCue?.stop();
    scrubCue = null;
    if (melodyPlayback || preparingMelody) stopMelody('', false);
    if (playheadFrame == null) playheadFrame = requestAnimationFrame(animatePlayhead);
  });
  audio.addEventListener('pause', () => { if (!melodyPlayback && !chunkPlayback && !clickPlayback) stopPlayheadLoop(); });
  audio.addEventListener('ended', () => { if (!melodyPlayback && !chunkPlayback && !clickPlayback) stopPlayheadLoop(); });
  audio.addEventListener('seeked', () => updatePlayhead());
  audio.addEventListener('timeupdate', () => updatePlayhead());

  function stopTracks() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  }

  function clearRecording() {
    stopChunkPlayback();
    analysisToken++;
    scrubToken++;
    scrubCue?.stop();
    scrubCue = null;
    detectedNotes = [];
    decodedBuffer = null;
    editedBuffer = null;
    waveSamples = null;
    analysisFrames = [];
    automaticNotes = [];
    originalBlob = null;
    fullTakeState = null;
    trimRestoreButton.disabled = true;
    trimStatus.textContent = 'Move the playhead to an edge, then trim.';
    tapAnchor = 0;
    selectedNote = null;
    tempoTaps = [];
    manualBpm = null;
    estimatedBpm = null;
    addNoteButton.disabled = true;
    if (dragFrame != null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
    draggingPlayhead = false;
    playheadTime.textContent = '0.00 s';
    waveNow.setAttribute('aria-valuemax', '0');
    syncSelection();
    downloadEditedButton.disabled = true;
    snapButton.disabled = true;
    resetButton.disabled = true;
    downloadAbcButton.disabled = true;
    downloadMidiButton.disabled = true;
    stopMelody();
    stopClickPlayback();
    stopGuidePlayback();
    notePlaybackStatus.textContent = '';
    timelineDuration = 0;
    chunkIndex = 0;
    updateChunkControls();
    nowLines.forEach(line => { line.style.display = 'none'; });
    stopPlayheadLoop();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    blob = null;
    runButton.disabled = true;
    downloadButton.disabled = true;
    el('analyze-results').classList.add('hidden');
    updateTapControls();
  }

  function finishRecording() {
    clearInterval(timerId);
    timerId = null;
    stopTracks();
    stopGuidePlayback();
    const mimeType = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
    recorder = null;
    tapsStartButton.disabled = false;
    tapKeyButton.disabled = false;
    tapsWithVoice.disabled = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    const recorded = chunks.filter(chunk => chunk.size > 0);
    if (!recorded.length) {
      status.textContent = 'No audio was recorded. Please try again.';
      return;
    }
    blob = new Blob(recorded, { type: mimeType });
    originalBlob = blob;
    chunks = [];
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl;
    audio.playbackRate = Number(speedSelect.value);
    audio.preservesPitch = true;
    runButton.disabled = false;
    downloadButton.disabled = false;
    status.textContent = 'Recording ready. Listen back, then click Analyze recording.';
    if (tapCaptureMode === 'live') tapsStatus.textContent = noteTaps.length ? `${noteTaps.length} taps captured with the voice.` : 'No note-start taps captured with the voice.';
    updateTapControls();
  }

  downloadButton.addEventListener('click', () => {
    if (!audioUrl || !blob) return;
    const type = blob.type.toLowerCase();
    const extension = type.includes('ogg') ? 'ogg'
      : type.includes('mp4') ? 'mp4'
        : type.includes('wav') ? 'wav' : 'webm';
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = `muSing-voice-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
  });

  startButton.addEventListener('click', async () => {
    if (recorder || stream) return;
    endTapKeyChoice();
    stopTapPass();
    startButton.disabled = true;
    clearRecording();
    if (tapCaptureMode === 'live' || tapsWithVoice.checked) {
      noteTaps = [];
      tapShift = 0;
    }
    tapCaptureMode = tapsWithVoice.checked ? 'live' : 'separate';
    tapsStatus.textContent = tapCaptureMode === 'live' ? `Live tap capture armed: press ${tapKeyName} at each note start.`
      : noteTaps.length ? `${noteTaps.length} separate taps ready for alignment.` : 'No taps recorded.';
    updateTapControls();
    timer.textContent = '0:00';
    status.textContent = 'Waiting for microphone permission…';
    try {
      if (!window.MediaRecorder) throw new Error('Recording is unavailable in this browser');
      const opened = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!active) {
        opened.getTracks().forEach(track => track.stop());
        startButton.disabled = false;
        return;
      }
      stream = opened;
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.addEventListener('dataavailable', event => { if (event.data?.size) chunks.push(event.data); });
      recorder.addEventListener('stop', finishRecording, { once: true });
      recorder.addEventListener('error', () => { status.textContent = 'Recording failed. Please try again.'; });
      recorder.start();
      tapsStartButton.disabled = true;
      tapKeyButton.disabled = true;
      tapsWithVoice.disabled = true;
      startedAt = performance.now();
      if (tapsGuideVoice.checked && noteTaps.length && tapCaptureMode === 'separate') {
        const guideTimes = noteTaps.map(time => time - noteTaps[0]);
        const token = ++guideToken;
        void playClickTrack(guideTimes).then(playback => {
          if (token !== guideToken || recorder?.state !== 'recording') { playback?.stop(); return; }
          guidePlayback = playback;
          playback?.done.then(() => { if (guidePlayback === playback) guidePlayback = null; });
        }).catch(() => { if (token === guideToken) tapsStatus.textContent = 'Could not play guide clicks; voice recording continues.'; });
      }
      timerId = setInterval(() => { timer.textContent = clockTime((performance.now() - startedAt) / 1000); }, 200);
      stopButton.disabled = false;
      status.textContent = tapCaptureMode === 'live' ? `Recording… sing and tap ${tapKeyName} at each note start.` : 'Recording… sing your solo phrase, then stop.';
    } catch (error) {
      stopTracks();
      recorder = null;
      startButton.disabled = false;
      tapKeyButton.disabled = false;
      tapsWithVoice.disabled = false;
      status.textContent = `Could not record: ${error.name || error.message || 'microphone error'}.`;
    }
  });

  stopButton.addEventListener('click', () => {
    if (recorder?.state === 'recording') {
      stopButton.disabled = true;
      timer.textContent = clockTime((performance.now() - startedAt) / 1000);
      status.textContent = 'Finishing recording…';
      recorder.stop();
    }
  });

  runButton.addEventListener('click', async () => {
    if (!blob) return;
    stopChunkPlayback();
    stopMelody();
    audio.pause();
    const token = ++analysisToken;
    runButton.disabled = true;
    status.textContent = 'Decoding recording…';
    let context;
    try {
      context = new AudioContext();
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      if (token !== analysisToken) return;
      if (buffer.duration < 0.15) throw new Error('Recording is too short to analyze');
      status.textContent = 'Analyzing pitch…';
      const result = await analyzeVoiceBuffer(buffer, progress => {
        status.textContent = `Analyzing pitch… ${Math.round(progress * 100)}%`;
      }, () => token !== analysisToken);
      if (!result || token !== analysisToken) return;
      detectedNotes = result.notes.map(note => ({ ...note, targetMidi: null }));
      automaticNotes = result.notes.map(note => ({ ...note }));
      if (!fullTakeState) tapAnchor = tapCaptureMode === 'live' ? noteTaps[0] ?? 0 : result.notes[0]?.start ?? 0;
      decodedBuffer = buffer;
      // Playback can detach an AudioBuffer's channel view. Keep drawing data independent.
      waveSamples = Float32Array.from(result.channel);
      analysisFrames = result.frames;
      selectedNote = null;
      editedBuffer = null;
      timelineDuration = result.duration;
      waveNow.setAttribute('aria-valuemax', result.duration.toFixed(2));
      addNoteButton.disabled = false;
      renderTimeline();
      playNotesButton.disabled = !detectedNotes.length;
      playBothButton.disabled = !detectedNotes.length;
      playEditedButton.disabled = !detectedNotes.length;
      playTunedBothButton.disabled = !detectedNotes.length;
      downloadEditedButton.disabled = !detectedNotes.length;
      snapButton.disabled = !detectedNotes.length;
      resetButton.disabled = !detectedNotes.length;
      downloadAbcButton.disabled = !detectedNotes.length;
      downloadMidiButton.disabled = !detectedNotes.length;
      waveScroll.scrollLeft = 0;
      noteScroll.scrollLeft = 0;
      nowLines.forEach(line => { line.style.display = 'block'; });
      updatePlayhead();
      el('analyze-duration').textContent = `${result.duration.toFixed(1)} seconds`;
      const pulse = estimateNotePulse(result.notes);
      estimatedBpm = pulse?.bpm ?? null;
      tempoTaps = [];
      manualBpm = null;
      updateTempoDisplay();
      el('analyze-results').classList.remove('hidden');
      status.textContent = result.notes.length ? 'Analysis complete. Compare the note track with what you hear.' : 'Analysis complete, but no stable notes were detected.';
    } catch (error) {
      if (token === analysisToken) status.textContent = `Could not analyze recording: ${error.message || error.name || 'audio error'}.`;
    } finally {
      if (context) {
        try { await context.close(); } catch { /* Analysis is already finished or cancelled. */ }
      }
      if (token === analysisToken) runButton.disabled = false;
    }
  });

  function onNoteEdit(note) {
    editedBuffer = null;
    if (chunkPlayback) stopChunkPlayback();
    stopMelody();
    syncSelection();
    notePlaybackStatus.textContent = `${midiToName(note.midi)} → ${midiToName(note.targetMidi)}. Play tuned voice to hear it in the recording.`;
    void auditionPitch(note.targetMidi ?? note.midi);
  }

  function onBoundaryEdit(note) {
    editedBuffer = null;
    if (chunkPlayback) stopChunkPlayback();
    stopMelody();
    drawNotes(el('analyze-note-track'), noteList, detectedNotes, timelineDuration, zoom, pitchRangeSelect.value, Number(trackHeightSlider.value), onNoteEdit, selectNote, seekFromClientX, renderTimeline, selectedNote);
    updateChunkControls();
    syncSelection();
    notePlaybackStatus.textContent = `Note boundary: ${note.start.toFixed(2)}–${note.end.toFixed(2)} s.`;
  }

  addNoteButton.addEventListener('click', () => {
    if (!decodedBuffer) return;
    const time = melodyPlayback?.currentTime() ?? audio.currentTime;
    const nearby = analysisFrames
      .filter(frame => frame.hz && frame.confidence >= 0.6 && Math.abs(frame.time - time) <= 0.2)
      .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
    const source = nearby ? {
      hz: nearby.hz,
      midi: Math.round(hzToMidi(nearby.hz)),
      cents: Math.round((hzToMidi(nearby.hz) - Math.round(hzToMidi(nearby.hz))) * 100)
    } : null;
    const note = addNoteInGap(detectedNotes, time, timelineDuration, source);
    if (!note) {
      notePlaybackStatus.textContent = 'Place the playhead in a gap between notes. To divide an existing note, use Split at playhead.';
      return;
    }
    selectedNote = note;
    afterStructureEdit('Manual note added. Adjust its chunk length and pitch, then listen to the tuned voice.');
  });

  splitButton.addEventListener('click', () => {
    const index = selectedIndex();
    const time = melodyPlayback?.currentTime() ?? audio.currentTime;
    const right = splitNote(detectedNotes, index, time);
    if (!right) {
      notePlaybackStatus.textContent = 'Place the playhead at least 0.04 s inside the selected note to split it.';
      return;
    }
    selectedNote = right;
    afterStructureEdit('Note split. Select either half to adjust its pitch or boundaries.');
  });

  mergeButton.addEventListener('click', () => {
    const merged = mergeWithNext(detectedNotes, selectedIndex());
    if (!merged) return;
    selectedNote = merged;
    afterStructureEdit('Notes merged into one chunk. Adjust its pitch or length if needed.');
  });

  for (const [id, [edge, delta]] of Object.entries(boundaryButtons)) {
    el(id).addEventListener('click', () => {
      const index = selectedIndex();
      if (index < 0) return;
      const note = detectedNotes[index];
      if (resizeNote(detectedNotes, index, edge, note[edge] + delta, timelineDuration)) {
        afterStructureEdit(`Note boundary: ${note.start.toFixed(2)}–${note.end.toFixed(2)} s.`);
      }
    });
  }

  function getEditedBuffer() {
    if (editedBuffer) return editedBuffer;
    const channels = renderEditedChannels(decodedBuffer, detectedNotes);
    const context = new AudioContext();
    const result = context.createBuffer(channels.length, decodedBuffer.length, decodedBuffer.sampleRate);
    channels.forEach((samples, index) => result.copyToChannel(samples, index));
    void context.close().catch(() => {});
    editedBuffer = result;
    return result;
  }

  snapButton.addEventListener('click', () => {
    if (!detectedNotes.length) return;
    for (const note of detectedNotes) note.targetMidi = note.midi;
    editedBuffer = null;
    stopMelody();
    renderTimeline();
    notePlaybackStatus.textContent = 'All detected notes snapped to their nearest piano pitches.';
  });

  resetButton.addEventListener('click', () => {
    if (!detectedNotes.length) return;
    // A reset plays the untouched recording, including its original cents offset.
    for (const note of detectedNotes) note.targetMidi = null;
    editedBuffer = null;
    stopMelody();
    renderTimeline();
    notePlaybackStatus.textContent = 'Pitch edits cleared.';
  });

  downloadEditedButton.addEventListener('click', () => {
    if (!decodedBuffer || !detectedNotes.length) return;
    try {
      const buffer = getEditedBuffer();
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      const url = URL.createObjectURL(encodeWav(channels, buffer.sampleRate));
      const link = document.createElement('a');
      link.href = url;
      link.download = `muSing-tuned-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notePlaybackStatus.textContent = `Could not export tuned voice: ${error.message || error.name}.`;
    }
  });

  async function startMelody(mode) {
    stopChunkPlayback();
    stopClickPlayback();
    scrubToken++;
    scrubCue?.stop();
    scrubCue = null;
    if (melodyPlayback) {
      if (melodyMode === mode) { stopMelody('Playback stopped.'); return; }
      stopMelody();
    }
    if (!detectedNotes.length || (mode !== 'notes' && !decodedBuffer)) return;
    audio.pause();
    const startOffset = Math.min(audio.currentTime, timelineDuration - 0.01);
    const playbackSpeed = Number(speedSelect.value);
    const token = ++melodyToken;
    preparingMelody = true;
    for (const button of Object.values(melodyButtons)) button.disabled = true;
    notePlaybackStatus.textContent = mode === 'edited' ? 'Preparing tuned voice…' : mode === 'tuned-both' ? 'Preparing notes and tuned voice…' : mode === 'both' ? 'Preparing notes and original voice…' : 'Preparing piano notes…';
    try {
      const playback = mode === 'edited'
        ? await playAudioBuffer(getEditedBuffer(), startOffset, playbackSpeed)
        : await playPianoMelody(detectedNotes.map(note => ({ ...note, midi: note.targetMidi ?? note.midi })), mode === 'tuned-both' ? getEditedBuffer() : mode === 'both' ? decodedBuffer : null, playbackSpeed, startOffset);
      if (!playback) {
        preparingMelody = false;
        for (const button of Object.values(melodyButtons)) button.disabled = false;
        notePlaybackStatus.textContent = 'No notes remain after the playhead. Seek earlier to listen.';
        return;
      }
      if (token !== melodyToken || !active) {
        playback?.stop();
        return;
      }
      preparingMelody = false;
      melodyPlayback = playback;
      melodyMode = mode;
      for (const button of Object.values(melodyButtons)) button.disabled = false;
      melodyButtons[mode].textContent = '■  Stop playback';
      notePlaybackStatus.textContent = mode === 'edited' ? 'Playing tuned voice.' : mode === 'tuned-both' ? 'Playing piano notes with the tuned voice.' : mode === 'both' ? 'Playing piano notes with the original voice.' : 'Playing detected notes only.';
      if (playheadFrame == null) playheadFrame = requestAnimationFrame(animatePlayhead);
      playback.done.then(() => {
        if (melodyPlayback === playback) {
          audio.currentTime = playback.currentTime();
          melodyPlayback = null;
          melodyMode = null;
          for (const [name, button] of Object.entries(melodyButtons)) button.textContent = melodyLabels[name];
          notePlaybackStatus.textContent = 'Playback finished.';
          stopPlayheadLoop();
        }
      });
    } catch (error) {
      if (token === melodyToken) {
        preparingMelody = false;
        for (const [name, button] of Object.entries(melodyButtons)) button.disabled = name !== 'notes' && !decodedBuffer;
        notePlaybackStatus.textContent = `Playback unavailable: ${error.name || 'audio error'}.`;
      }
    }
  }

  playNotesButton.addEventListener('click', () => startMelody('notes'));
  playBothButton.addEventListener('click', () => startMelody('both'));
  playEditedButton.addEventListener('click', () => startMelody('edited'));
  playTunedBothButton.addEventListener('click', () => startMelody('tuned-both'));

  return {
    onEnter() { active = true; },
    onLeave() {
      active = false;
      stopChunkPlayback();
      endTapKeyChoice();
      stopTapPass();
      stopClickPlayback();
      stopGuidePlayback();
      scrubToken++;
      scrubCue?.stop();
      scrubCue = null;
      analysisToken++;
      if (blob && runButton.disabled) status.textContent = 'Analysis stopped. You can analyze this recording again.';
      runButton.disabled = !blob;
      stopMelody();
      audio.pause();
      if (recorder?.state === 'recording') recorder.stop();
      else stopTracks();
    }
  };
}
