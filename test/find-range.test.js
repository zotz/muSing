import test from 'node:test';
import assert from 'node:assert/strict';
import { validRange } from '../src/find-range.js';

test('happy note may sit outside the low-to-high range', () => {
  assert.equal(validRange({ low: 110, high: 220, happy: 330 }), true);
  assert.equal(validRange({ low: 110, high: 220, happy: 82.4 }), true);
  assert.equal(validRange({ low: 220, high: 110, happy: 330 }), false);
  assert.equal(validRange({ low: 110, high: 220, happy: null }), false);
});
