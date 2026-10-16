# muSing Lab

A small local prototype for testing whether immediate feedback helps singing and ear training. It contains independent exercises, a voice analysis tab, and a shared results log.

## Run

```sh
npm start
```

Open <http://localhost:3000>. A modern browser is required. The microphone works on localhost (or HTTPS when hosted elsewhere). No install step or external service is needed.

Run the pitch estimation tests with `npm test`.

## Experiments

**Sing a pitch:** Choose a comfortable range, play a reference tone, enable the microphone, and sing it back. The live display shows pitch offset in cents. A recording stores median pitch offset, median absolute deviation (shown as steadiness), and the number of usable pitch readings. For headphone comparison, start the continuous target and optionally turn on voice monitoring. The pan control moves the target and monitored voice in opposite directions. Use headphones and begin at a low volume; browser monitoring can have a slight delay. Voice monitoring is off by default and stops when you leave the exercise. This is a pitch measure, not a judgment of tone quality or vocal health.

**Tune a note by ear:** Play a target and an adjustable matching tone together, then move the slider to match them. A pan control puts the target and matching tone in opposite ears and can move them through center. The alternative listening mode plays the target first and matching tone second, so you can test pitch memory; its two tones use the same pan positions. The difference stays hidden until **Check match** unless you turn on **Show difference while adjusting**. Each check is saved with its listening mode.

**Hear an interval:** Listen to two sequential notes and choose among five intervals: unison, major second, major third, perfect fourth, and perfect fifth. The app gives immediate feedback and tracks a five-question set. Replays are allowed.

**Find your range:** Enable the microphone and capture a comfortable low note, comfortable high note, and easy “happy note.” Each capture measures sustained pitch for the selected length; unstable or unclear captures ask you to retry. Review the three measurements, then save the session. The keyboard plays every piano key when clicked. Its colored markers and Low, Happy, and High buttons play the exact measured pitches, including in saved sessions loaded for viewing. The pitch values and date are stored locally; the app does not save voice audio. These are comfortable practice snapshots rather than absolute vocal limits.

The **Microphone capture length** setting applies to Sing a Pitch and Find Range. Choose 0.5, 1, 1.5, 2, or 3 seconds; 2 seconds is the default. The selection is remembered in this browser. Shorter captures may be easier to sing but provide fewer pitch readings.

**Analyze voice:** Click Start recording, sing a solo phrase, and click Stop recording. Listen back, then click Analyze recording to see a waveform and estimated note positions, timings, and pitches. Use **Download recording** to save the browser's original recording format for later listening or sharing. The waveform and note track share matching time grid lines, scroll together, and show a moving playback line during recording playback or detected-note playback. Pitch is sampled every 40 ms so short notes have a better chance of appearing. Pitch estimates are grouped into steadier notes so brief scoops and overshoots do not each become a note; clear loudness dips can separate repeated notes at the same pitch. Drag individual note blocks up or down by semitones (within an octave), or focus one and use the arrow keys. **Snap all to notes** corrects each detected note's cents offset to the nearest equal-tempered pitch; **Clear pitch edits** restores the unmodified voice. **Play tuned voice** applies the changes to the corresponding recorded audio segments while retaining timing, and **Download tuned WAV** exports the result. This experimental pitch shift can produce artifacts, especially at note boundaries and on consonants. **Play detected notes** plays the note blocks at standard piano pitches with a simple synthesized piano sound; **Play notes + original voice** plays those piano notes with the unedited recording on the same timeline; **Play notes + tuned voice** combines them with the pitch-edited recording. Both keep the original timing and rests, including silence before the first note. A tempo estimate appears when at least five detected notes begin at fairly regular intervals; irregular or short phrases show "Tempo uncertain." This estimates note-start pulse, so the musical beat may be half or twice the displayed BPM. The recording stays in browser memory and disappears on refresh unless downloaded; it is not added to Results. Tap beat to set the tempo yourself; the note timing remains unchanged. Download ABC or MIDI to export edited note pitches and timing. This version does not estimate time signature or key.

**Results:** The browser stores attempts in `localStorage`. Export JSON to keep a copy or analyze sessions later. Clearing results removes the browser copy.

For manual note correction in **Analyze voice**, the waveform and note track sit together in a compact editor. Translucent waveform chunks align with the note blocks. Click a chunk or note row to select it. Drag either edge of its waveform chunk, or use the 0.02-second boundary buttons, to change its length. Move the playhead by dragging the yellow circle on the waveform or by clicking either timeline, then split the selected note, merge it with the next note, or add a missing note in a gap. Seeking plays a short voice cue, note cue, both, or no cue according to the **Seek cue** setting. A manually added note starts with a nearby pitch guess; drag it to the intended pitch. Time zoom enlarges both timelines together; **Pitch range** includes the lowest and highest detected notes, and **Detected notes height** makes each pitch row thinner or taller to fit the chosen height. The note list can be shown or hidden. **Playback speed** applies to the original audio player, tuned voice, and piano-note playback; its time stretching keeps the pitch approximately steady. It does not change the analyzed or exported audio. The waveform display automatically enlarges quiet recordings for visibility, without changing their audio. Manual timing and pitch edits affect **Play tuned voice** and the tuned WAV export; the original recording remains available separately. Very short or mostly unvoiced syllables may still sound rough when pitch shifted.

## How to test whether it helps

1. Before regular practice, save one comfortable range session, then record 10 sung pitch matches, 10 tone matches, and 20 interval answers across multiple notes. Export the results as a baseline.
2. Practice for 5–10 minutes on several days. Try to keep headphones, microphone position, and room conditions similar.
3. Repeat a fresh set and compare your comfortable range and happy note alongside sung pitch error, steadiness, tone matching error, and interval accuracy. Compare multiple sessions rather than one unusually good or bad attempt.
4. Note which feedback changed how you sang or listened. Keep only the exercises that are useful.

This is a learning experiment, not a calibrated assessment. Browser microphones and pitch tracking can misread breathy, noisy, or highly vibrato-rich voices. Interval questions currently draw randomly, so a short set may not contain every interval equally.

## Module boundaries

- `src/music.js`: note, interval, and statistics helpers.
- `src/pitch.js`: pure waveform-to-pitch estimator. Replaceable with another detector.
- `src/voice-analysis.js`: offline note detection from a recorded audio buffer.
- `src/note-edit.js`: timing operations for manual note correction.
- `src/voice-edit.js`: pitch-shifted voice rendering and WAV export.
- `src/audio.js`: browser audio input and tone output.
- `src/pitch-match.js`, `src/tune-note.js`, `src/intervals.js`, `src/find-range.js`, `src/analyze-voice.js`: independent exercise controllers.
- `src/results.js`: versioned result storage and export.
- `src/app.js`: navigation and aggregate display.

Possible later additions include graded sharp/flat/match colors, balanced interval sets, and a progress view by session/date. The result records include a `type` and timestamp so new exercises can share the same log.
