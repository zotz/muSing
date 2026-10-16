import { playTone } from './audio.js';
import { INTERVALS, midiToHz, randomItem } from './music.js';
import { saveResult } from './results.js';

export function initIntervals(onResult) {
  const el = id => document.getElementById(id);
  const options = el('interval-options');
  const play = el('play-interval');
  const next = el('next-interval');
  const progress = el('interval-progress');
  const status = el('interval-status');
  const score = el('interval-score');
  let question = 0;
  let correctCount = 0;
  let answered = false;
  let playing = false;
  let heard = false;
  let interval;
  let root;

  function newQuestion() {
    interval = randomItem(INTERVALS);
    root = 55 + Math.floor(Math.random() * 8);
    answered = false;
    heard = false;
    next.disabled = true;
    next.textContent = 'Next question';
    progress.textContent = `Question ${question + 1} of 5`;
    status.textContent = 'You can replay the notes before answering.';
    options.replaceChildren();
    for (const choice of INTERVALS) {
      const button = document.createElement('button');
      button.className = 'option';
      button.textContent = choice.label;
      button.disabled = true;
      button.addEventListener('click', () => answer(choice, button));
      options.append(button);
    }
  }

  function answer(choice, selectedButton) {
    if (answered || playing || !heard) return;
    answered = true;
    const correct = choice.semitones === interval.semitones;
    if (correct) correctCount++;
    saveResult({ type: 'interval', rootMidi: root, intervalSemitones: interval.semitones, answerSemitones: choice.semitones, correct });
    onResult();
    for (const button of options.children) {
      button.disabled = true;
      if (button.textContent === interval.label) button.classList.add('correct');
    }
    if (!correct) selectedButton.classList.add('incorrect');
    score.textContent = `${correctCount} / ${question + 1}`;
    status.textContent = correct ? 'Correct — nice listening.' : `That was a ${interval.label}. Replay it to hear the difference.`;
    next.disabled = false;
    if (question === 4) next.textContent = 'Start new set';
  }

  play.addEventListener('click', async () => {
    if (playing) return;
    playing = true;
    play.disabled = true;
    status.textContent = 'Playing notes…';
    await playTone(midiToHz(root), 0.65);
    await new Promise(resolve => setTimeout(resolve, 180));
    await playTone(midiToHz(root + interval.semitones), 0.65);
    playing = false;
    heard = true;
    play.disabled = false;
    if (!answered) for (const button of options.children) button.disabled = false;
    status.textContent = answered ? `That was a ${interval.label}.` : 'Which interval did you hear?';
  });

  next.addEventListener('click', () => {
    if (!answered) return;
    if (question === 4) {
      question = 0;
      correctCount = 0;
      score.textContent = '0 / 0';
    } else question++;
    newQuestion();
  });

  newQuestion();
}
