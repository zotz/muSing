import test from 'node:test';
import assert from 'node:assert/strict';
import { minimumReadings } from '../src/capture-duration.js';

test('short captures require proportionately fewer clear readings', () => {
  assert.equal(minimumReadings(0.5), 3);
  assert.equal(minimumReadings(1), 5);
  assert.equal(minimumReadings(1.5), 7);
  assert.equal(minimumReadings(2), 8);
  assert.equal(minimumReadings(3), 8);
});
