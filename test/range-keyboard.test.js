import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardPosition, renderRangeKeyboard } from '../src/range-keyboard.js';
import { midiToHz } from '../src/music.js';

test('keyboard positions follow white and black key geometry across octaves', () => {
  assert.equal(keyboardPosition(60, 60), 14); // C4
  assert.equal(keyboardPosition(61, 60), 28); // C♯4
  assert.equal(keyboardPosition(62, 60), 42); // D4
  assert.equal(keyboardPosition(64, 60), 70); // E4
  assert.equal(keyboardPosition(65, 60), 98); // F4, next to E4 without a black key
  assert.equal(keyboardPosition(72, 60), 210); // C5
  assert.equal(keyboardPosition(60.5, 60), 21); // between C4 and C♯4
});

test('every piano key plays before capture and markers play exact captured pitches', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS(_namespace, name) {
      return {
        name,
        attributes: {},
        children: [],
        listeners: {},
        setAttribute(key, value) { this.attributes[key] = value; },
        getAttribute(key) { return this.attributes[key]; },
        addEventListener(event, listener) { this.listeners[event] = listener; },
        append(child) { this.children.push(child); }
      };
    }
  };
  const container = {
    children: [],
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); }
  };
  const played = [];
  const onPlay = (hz, label) => played.push({ hz, label });
  try {
    renderRangeKeyboard(container, { low: null, high: null, happy: null }, onPlay);
    const keys = container.children[0].children.filter(node => node.name === 'rect');
    assert.equal(keys.length, 24); // Two octaves of white and black keys.
    assert.ok(keys.every(key => key.listeners.click && key.listeners.keydown));
    keys.find(key => key.attributes['aria-label'] === 'Play C4').listeners.click();
    assert.equal(played[0].hz, midiToHz(60));

    renderRangeKeyboard(container, { low: 220.5, high: 440.5, happy: 330.5 }, onPlay);
    const markers = container.children[0].children.filter(node => node.name === 'circle');
    assert.equal(markers.length, 3);
    markers.find(marker => marker.attributes['aria-label'] === 'Play Low captured note').listeners.click();
    assert.equal(played[1].hz, 220.5);
  } finally {
    globalThis.document = previousDocument;
  }
});
