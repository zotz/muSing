import { createSustainedTone, playTone } from './audio.js';
import { PITCHES, midiToHz, midiToName, randomItem } from './music.js';
import { saveResult } from './results.js';

export function initTuneNote(onResult) {
  const el = id => document.getElementById(id);
  const ranges = { low: [48, 59], middle: [55, 67], high: [60, 72] };
  const range = el('tune-range');
  const slider = el('tune-slider');
  const panSlider = el('tune-pan');
  const sequential = el('sequential-mode');
  const reveal = el('show-difference');
  const play = el('play-tune');
  const check = el('check-tune');
  const status = el('tune-status');
  const feedback = el('tune-feedback');
  let target = 60;
  let targetTone = null;
  let matchingTone = null;
  let playingSequence = false;
  let sequenceId = 0;
  let heard = false;
  let checked = false;
  let active = false;

  function targetPan() {
    return Number(panSlider.value) / 100;
  }

  function offsetCents() {
    return Math.round((Number(slider.value) - target) * 100);
  }

  function feedbackText() {
    const offset = offsetCents();
    const direction = Math.abs(offset) < 5 ? 'matched' : offset < 0 ? 'flat' : 'sharp';
    return `<div class="result-number">${Math.abs(offset)}¢</div><div class="result-caption">${direction} from ${midiToName(target)}</div>`;
  }

  function renderFeedback() {
    feedback.innerHTML = checked || reveal.checked ? feedbackText() : 'The pitch difference is hidden until you check.';
  }

  function stopSimultaneous() {
    targetTone?.stop();
    matchingTone?.stop();
    targetTone = null;
    matchingTone = null;
    play.textContent = sequential.checked ? '▶  Play target, then match' : '▶  Start both tones';
  }

  function resetMatch() {
    let start;
    const low = Number(slider.min);
    const high = Number(slider.max);
    do start = low + Math.random() * (high - low); while (Math.abs(start - target) < 1.5);
    slider.value = start.toFixed(2);
    matchingTone?.setPitch(midiToHz(Number(slider.value)));
    checked = false;
    heard = false;
    check.disabled = true;
    renderFeedback();
  }

  function configureSlider() {
    // Vary where the target falls on the unlabeled slider, so its position
    // does not reveal the answer before the listener checks.
    const below = 3 + Math.random() * 4;
    slider.min = (target - below).toFixed(2);
    slider.max = (target + 10 - below).toFixed(2);
    resetMatch();
  }

  function newTarget() {
    sequenceId++;
    stopSimultaneous();
    const [low, high] = ranges[range.value];
    const choices = PITCHES.filter(note => note >= low && note <= high);
    let next;
    do next = randomItem(choices); while (next === target);
    target = next;
    el('tune-target-note').textContent = midiToName(target);
    configureSlider();
    status.textContent = 'New target ready. Listen and adjust by ear.';
  }

  play.addEventListener('click', async () => {
    if (playingSequence) return;
    if (!sequential.checked) {
      if (targetTone) {
        stopSimultaneous();
        status.textContent = 'Both tones stopped.';
        return;
      }
      play.disabled = true;
      const id = sequenceId;
      try {
        const first = await createSustainedTone(midiToHz(target), targetPan(), 0.1);
        if (id !== sequenceId || !active) { first.stop(); return; }
        targetTone = first;
        const second = await createSustainedTone(midiToHz(Number(slider.value)), -targetPan(), 0.1);
        if (id !== sequenceId || !active) { second.stop(); stopSimultaneous(); return; }
        matchingTone = second;
        heard = true;
        check.disabled = false;
        play.textContent = 'Stop both tones';
        status.textContent = 'Move the slider until the two tones sound alike.';
      } catch (error) {
        stopSimultaneous();
        status.textContent = `Audio output unavailable: ${error.name || 'device error'}.`;
      } finally {
        play.disabled = false;
      }
      return;
    }
    playingSequence = true;
    play.disabled = true;
    const id = ++sequenceId;
    status.textContent = 'Playing target…';
    try {
      await playTone(midiToHz(target), 0.8, 0, targetPan());
      if (id !== sequenceId) return;
      await new Promise(resolve => setTimeout(resolve, 220));
      if (id !== sequenceId) return;
      status.textContent = 'Playing matching tone…';
      await playTone(midiToHz(Number(slider.value)), 0.8, 0, -targetPan());
      if (id !== sequenceId) return;
      heard = true;
      check.disabled = false;
      status.textContent = 'Adjust the slider and replay, or check your match.';
    } catch (error) {
      status.textContent = `Audio output unavailable: ${error.name || 'device error'}.`;
    } finally {
      playingSequence = false;
      play.disabled = false;
    }
  });

  slider.addEventListener('input', () => {
    matchingTone?.setPitch(midiToHz(Number(slider.value)));
    checked = false;
    renderFeedback();
    if (sequential.checked) status.textContent = 'Replay the pair to hear this adjustment.';
  });

  panSlider.addEventListener('input', () => {
    targetTone?.setPan(targetPan());
    matchingTone?.setPan(-targetPan());
  });

  check.addEventListener('click', () => {
    if (!heard) return;
    checked = true;
    renderFeedback();
    const offset = offsetCents();
    saveResult({ type: 'tune-note', targetMidi: target, matchedMidi: Number(slider.value), offsetCents: offset, mode: sequential.checked ? 'sequential' : 'simultaneous' });
    onResult();
    status.textContent = Math.abs(offset) <= 25 ? 'Close match. Try another target or repeat.' : `The matching tone is ${offset < 0 ? 'too low' : 'too high'}.`;
  });

  sequential.addEventListener('change', () => {
    sequenceId++;
    stopSimultaneous();
    heard = false;
    check.disabled = true;
    checked = false;
    renderFeedback();
    el('mode-description').textContent = sequential.checked
      ? 'The target plays first, then your matching tone. Replay after each adjustment.'
      : 'Both tones play together; moving the slider changes the matching tone live.';
    status.textContent = sequential.checked ? 'Sequential mode ready. Play the pair to listen.' : 'Simultaneous mode ready. Start both tones to listen.';
  });

  reveal.addEventListener('change', renderFeedback);
  range.addEventListener('change', newTarget);
  el('new-tune-target').addEventListener('click', newTarget);
  configureSlider();

  return {
    onEnter() { active = true; },
    onLeave() { active = false; sequenceId++; stopSimultaneous(); }
  };
}
