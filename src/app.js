import { initPitchMatch } from './pitch-match.js';
import { initTuneNote } from './tune-note.js';
import { initIntervals } from './intervals.js';
import { initFindRange } from './find-range.js';
import { initAnalyzeVoice } from './analyze-voice.js';
import { getResults, exportResults } from './results.js';
import { hzToMidi, midiToName } from './music.js';
import { initCaptureDuration } from './capture-duration.js';

function renderResults() {
  const results = getResults();
  const pitches = results.filter(item => item.type === 'pitch-match');
  const tunes = results.filter(item => item.type === 'tune-note');
  const intervals = results.filter(item => item.type === 'interval');
  const ranges = results.filter(item => item.type === 'range-session');
  const mean = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const accuracy = mean(pitches.map(item => Math.abs(item.offsetCents)));
  const tuneAccuracy = mean(tunes.map(item => Math.abs(item.offsetCents)));
  const success = intervals.length ? Math.round(intervals.filter(item => item.correct).length / intervals.length * 100) : null;
  document.getElementById('summary').innerHTML = [
    ['Pitch attempts', pitches.length, 'Microphone captures'],
    ['Mean pitch error', accuracy == null ? '—' : `${accuracy}¢`, 'Lower is better'],
    ['Tone matches', tunes.length, tuneAccuracy == null ? 'No matches yet' : `${tuneAccuracy}¢ mean error`],
    ['Interval accuracy', success == null ? '—' : `${success}%`, `${intervals.length} answers`],
    ['Range sessions', ranges.length, ranges.length ? `Latest happy: ${midiToName(Math.round(hzToMidi(ranges.at(-1).happyHz)))}` : 'No range saved yet']
  ].map(([label, value, note]) => `<div class="summary-card"><span class="field-label">${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');

  const history = document.getElementById('history');
  history.replaceChildren();
  if (!results.length) {
    history.innerHTML = '<p class="empty">No attempts yet. Try an exercise to start tracking progress.</p>';
    return;
  }
  for (const item of results.slice(-12).reverse()) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const date = new Date(item.at).toLocaleString();
    const label = item.type === 'pitch-match' ? 'Sing a pitch' : item.type === 'tune-note' ? 'Tune a note' : item.type === 'range-session' ? 'Find range' : 'Hear an interval';
    const direction = item.offsetCents === 0 ? 'centered' : item.offsetCents < 0 ? 'flat' : 'sharp';
    const detail = item.type === 'pitch-match' ? `${Math.abs(item.offsetCents)}¢ ${direction} · ±${item.steadinessCents}¢ steady` : item.type === 'tune-note' ? `${Math.abs(item.offsetCents)}¢ ${direction} · ${item.mode}` : item.type === 'range-session' ? `${midiToName(Math.round(hzToMidi(item.lowHz)))}–${midiToName(Math.round(hzToMidi(item.highHz)))} · happy ${midiToName(Math.round(hzToMidi(item.happyHz)))}` : item.correct ? 'Correct' : 'Try again';
    const title = document.createElement('strong');
    title.textContent = label;
    const description = document.createElement('span');
    description.textContent = detail;
    const time = document.createElement('time');
    time.textContent = date;
    row.append(title, description, time);
    history.append(row);
  }
}

initCaptureDuration();
const controllers = {
  pitch: initPitchMatch(renderResults),
  tune: initTuneNote(renderResults),
  range: initFindRange(renderResults),
  analyze: initAnalyzeVoice()
};
let activeView = 'pitch';
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    if (tab.dataset.view !== activeView) controllers[activeView]?.onLeave();
    activeView = tab.dataset.view;
    controllers[activeView]?.onEnter();
    for (const other of document.querySelectorAll('.tab')) {
      other.classList.toggle('active', other === tab);
      other.setAttribute('aria-selected', String(other === tab));
    }
    for (const panel of document.querySelectorAll('.panel')) panel.classList.add('hidden');
    document.getElementById(`${tab.dataset.view}-panel`).classList.remove('hidden');
    if (tab.dataset.view === 'results') renderResults();
  });
}

document.getElementById('export-results').addEventListener('click', exportResults);
document.getElementById('clear-results').addEventListener('click', () => {
  if (!confirm('Delete all locally saved results? Export first if you want a copy.')) return;
  localStorage.removeItem('musing-lab-results-v1');
  renderResults();
});

initIntervals(renderResults);
renderResults();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) controllers[activeView]?.onLeave();
  else controllers[activeView]?.onEnter();
});
