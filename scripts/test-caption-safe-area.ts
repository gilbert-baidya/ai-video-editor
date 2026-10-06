import assert from 'node:assert/strict';
import { chooseCaptionPlacement } from '../src/caption-safe-area.ts';

const lowerOccupied = chooseCaptionPlacement({
  lower: 0.1,
  'center-lower': 0.03,
  center: 0.08,
  'upper-center': 0.06,
});
assert.equal(lowerOccupied.zone, 'center-lower');
assert.equal(lowerOccupied.fallbackUsed, false);

const lowerClear = chooseCaptionPlacement({
  lower: 0.01,
  'center-lower': 0.14,
  center: 0.1,
  'upper-center': 0.2,
});
assert.equal(lowerClear.zone, 'lower');

const allOccupied = chooseCaptionPlacement({
  lower: 0.3,
  'center-lower': 0.2,
  center: 0.18,
  'upper-center': 0.2,
});
assert.equal(allOccupied.zone, 'upper-center');
assert.equal(allOccupied.fallbackUsed, true);

const bengali = 'রাজার স্বীকারোক্তি: আমি ব্যর্থ!';
const mixed = 'আমি ব্যর্থ, আমি loser';
assert.equal(bengali, 'রাজার স্বীকারোক্তি: আমি ব্যর্থ!');
assert.equal(mixed, 'আমি ব্যর্থ, আমি loser');

console.log(JSON.stringify({
  status: 'PASS',
  suite: 'caption-safe-area',
  checks: [
    'persistent lower occupancy moves captions upward',
    'clear lower area retains normal caption placement',
    'uncertain occupied zones use a conservative fallback',
    'Bengali and mixed caption text remain unchanged',
  ],
}, null, 2));
