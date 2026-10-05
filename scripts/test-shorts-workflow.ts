import assert from 'node:assert/strict';
import { validateExtractedShorts } from '../src/features/shorts/shorts-extractor.ts';
import type { ExtractedShort, ShortsExtractionInput } from '../src/features/shorts/shorts-model.ts';
import { beginShortRender, recommendedShortState, reviewShortState } from '../src/product-workflow.ts';

const now = '2026-10-04T00:00:00.000Z';
const recommended = recommendedShortState(now);
assert.equal(recommended.approvalStatus, 'pending');
assert.equal(recommended.renderStatus, 'not-started');
assert.throws(() => beginShortRender(recommended, now), /Approve this Short/);

const approved = reviewShortState(recommended, true, now);
assert.equal(approved.approvalStatus, 'approved');
const running = beginShortRender(approved, now);
assert.equal(running.renderStatus, 'running');
assert.throws(() => reviewShortState(running, false, now), /while it is rendering/);

const input: ShortsExtractionInput = {
  projectId: 'project-shorts-test',
  canonicalTranscriptHash: 'hash',
  maxShortsToExtract: 3,
  segments: [
    { id: 's0', start: 0, end: 10, text: 'Opening.' },
    { id: 's1', start: 10, end: 20, text: 'Setup.' },
    { id: 's2', start: 20, end: 31, text: 'Payoff.' },
    { id: 's3', start: 31, end: 45, text: 'Next idea.' },
  ],
};

const valid: ExtractedShort = {
  id: 'short-0',
  title: 'Opening to payoff',
  subtitle: 'A complete source moment',
  hookExplanation: 'Starts at the opening and resolves the thought.',
  viralScore: 8,
  sourceSegmentIds: ['s0', 's1', 's2'],
  sourceStartSeconds: 0,
  sourceEndSeconds: 31,
  durationEstimateSeconds: 31,
  targetDuration: 30,
};
assert.deepEqual(validateExtractedShorts([valid], input), []);
assert.match(validateExtractedShorts([{ ...valid, sourceSegmentIds: ['s0', 's2'] }], input).join(' '), /continuous/);
assert.match(validateExtractedShorts([{ ...valid, sourceEndSeconds: 40 }], input).join(' '), /source boundaries/);
assert.match(validateExtractedShorts([{ ...valid, durationEstimateSeconds: 12 }], input).join(' '), /duration metadata/);
assert.match(validateExtractedShorts([{ ...valid, sourceSegmentIds: ['missing'] }], input).join(' '), /invalid segment ID/);

console.log('PASS shorts workflow: independent approval/render state and recommendation validation');
