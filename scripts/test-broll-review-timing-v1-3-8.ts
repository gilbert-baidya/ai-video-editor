import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { EditOperation, MediaAsset, SermonAnalysis, SermonSection } from '../src/contracts.ts';
import { resolveFrameVisuals } from '../src/broll-layout.ts';
import { applyReviewAction, attachAssetCandidate, buildBrollReplacementOperation, createInitialReviewState, deriveApprovedEditPlan, evaluateReviewReadiness, type ReviewBeat } from '../src/director-review.ts';
import { sha256Browser } from '../src/sha256.ts';
import { applyRetentionPolicy } from '../src/visual-policy.ts';

function asset(kind: 'image' | 'video', overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: `asset-${kind}`, path: `/fixture/${kind}`, relativePath: kind, fileName: kind === 'image' ? 'church.jpg' : 'church.mp4', kind,
    mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4', sizeBytes: 922012, modifiedAt: '2026-01-01T00:00:00.000Z', contentHash: 'd'.repeat(64),
    durationSeconds: kind === 'video' ? 20 : undefined, width: 1024, height: 1024, aspectRatio: 1, hasAudio: false, tags: [], categories: [], searchTerms: [],
    rightsStatus: 'approved', rightsBasis: 'owned', libraryRootId: 'fixture', libraryPolicyVersion: '1', usable: true, unusableReasons: [], ...overrides,
  };
}

function section(start: number, end: number, visualRecommendation: SermonSection['visualRecommendation']): SermonSection {
  return { id: 'section-1', start, end, transcriptText: 'fixture', sourceSegmentIds: ['segment-1'], type: 'story', intensity: 'story-illustration', confidence: 0.9, reason: 'fixture', visualRecommendation };
}

function scenario(start: number, end: number, recommendation: SermonSection['visualRecommendation'], duration = 60) {
  const brollSection = section(start, end, recommendation);
  const analysis = { sections: [brollSection], projectId: 'p1' } as unknown as SermonAnalysis;
  const policy = applyRetentionPolicy(analysis, 'p1', 'hash', duration);
  const original = policy.editPlan.operations[0];
  const beat: ReviewBeat = { section: brollSection, originalOperation: original, requiredReview: true, noBroll: false, candidates: [] };
  const review = createInitialReviewState({ projectId: 'p1', aiPlan: policy.editPlan, beats: [beat], directorExecution: undefined }, sha256Browser(JSON.stringify(policy.editPlan)));
  return { brollSection, policy, original, beat, review, duration };
}

function readiness(s: ReturnType<typeof scenario>, review = s.review, assets: MediaAsset[] = []) {
  return evaluateReviewReadiness({ beats: [s.beat], qa: { status: 'PASS', failures: [] }, aiPlan: s.policy.editPlan, mediaIndex: { schemaVersion: '1', indexerVersion: '1', createdAt: '', updatedAt: '', roots: [], assets }, directorQuality: undefined }, review, s.duration);
}

// --- 10–51s semantic section, Director beat 26.5–34.5s ---
const s = scenario(10, 51, 'image-broll');
assert.equal(s.original.type, 'director-placeholder');
assert.ok(Math.abs(s.original.start - 26.5) < 1e-9 && Math.abs(s.original.end - 34.5) < 1e-9, 'Director window is 26.5–34.5');
const image = asset('image');
const op = buildBrollReplacementOperation(s.beat, image);
assert.equal(op.start, s.original.start, 'replacement keeps the approved start');
assert.equal(op.end, s.original.end, 'replacement keeps the approved end — it must not expand to 10–51');
assert.equal(op.visualType, 'image-broll');
assert.equal(op.mode, 'full-screen');
assert.equal(op.muted, true);
assert.equal(op.id, 'broll-section-1');

const replaced = applyReviewAction(s.review, 'section-1', 'replace-broll', { operation: op });
const approved = deriveApprovedEditPlan(s.policy.editPlan, replaced);
assert.equal(approved.operations.length, 1);
const approvedOp = approved.operations[0] as Extract<EditOperation, { type: 'broll' }>;
assert.equal(approvedOp.type, 'broll');
assert.equal(approvedOp.start, 26.5);
assert.equal(approvedOp.end, 34.5);
const ready = readiness(s, replaced, [image]);
assert.deepEqual(ready.blockers, [], 'the compatible 26.5–34.5 image beat is ready for render');
const frames = (seconds: number) => resolveFrameVisuals(approved.operations, seconds, [image]);
assert.equal(frames(10).pastorVisible, true, '10–26.5 Pastor');
assert.equal(frames(26.49).pastorVisible, true);
assert.equal(frames(26.5).pastorVisible, false, '26.5–34.5 full-frame B-roll');
assert.equal(frames(34.49).pastorVisible, false);
assert.equal(frames(34.5).pastorVisible, true, '34.5–51 Pastor');
assert.equal(frames(50.9).pastorVisible, true);

// --- Windows come only from the approved operation or an explicit reviewer operation, and must stay inside the section ---
const sectionWide: EditOperation = { ...op, start: 10, end: 51, sourceStart: 10, sourceEnd: 51 };
const wide = applyReviewAction(s.review, 'section-1', 'replace-broll', { operation: sectionWide });
assert.deepEqual(approvedWindow(wide), [10, 51], 'a human-supplied window is preserved as supplied (inside the section it is legal)');
function approvedWindow(review: typeof s.review): [number, number] {
  const o = deriveApprovedEditPlan(s.policy.editPlan, review).operations[0];
  return [o.start, o.end];
}
const outside: EditOperation = { ...op, start: 5, end: 30 };
const outsideReady = readiness(s, applyReviewAction(s.review, 'section-1', 'replace-broll', { operation: outside }), [image]);
assert.ok(outsideReady.blockers.some((b) => b.includes('outside its semantic section')), 'B-roll outside its semantic section blocks approval');
assert.equal(outsideReady.ready, false);

// --- Replacing an existing approved B-roll keeps its sub-window ---
const second = buildBrollReplacementOperation({ section: s.brollSection, originalOperation: op }, asset('image', { id: 'asset-image-2', fileName: 'other.jpg' }));
assert.equal(second.start, 26.5);
assert.equal(second.end, 34.5);
assert.equal(second.assetId, 'asset-image-2');

// --- video-broll recommendation converted to an image asset ---
const v = scenario(10, 51, 'video-broll');
assert.equal((v.original as Extract<EditOperation, { type: 'director-placeholder' }>).visualType, 'video-broll');
const converted = buildBrollReplacementOperation(v.beat, image);
assert.equal(converted.visualType, 'image-broll', 'operation type is explicitly converted to image-broll');
assert.equal(converted.mode, 'full-screen');
assert.ok(converted.reason.includes('explicitly converted from video-broll to image-broll'), 'conversion is recorded in the reason');
assert.equal(converted.start, 26.5);
assert.equal(converted.end, 34.5);
const videoAsset = asset('video');
const keptVideo = buildBrollReplacementOperation(v.beat, videoAsset);
assert.equal(keptVideo.visualType, 'video-broll');
assert.equal(buildBrollReplacementOperation(s.beat, videoAsset).visualType, 'video-broll', 'a video asset on an image recommendation is converted to video-broll, not left mismatched');

// --- sourceStart/sourceEnd are canonical sermon-timeline fields, never an in-point into the asset ---
const clip = asset('video', { durationSeconds: 120 });
const videoOp = buildBrollReplacementOperation(v.beat, clip);
assert.deepEqual([videoOp.start, videoOp.end], [26.5, 34.5], 'video replacement preserves the approved composition window');
assert.deepEqual([videoOp.sourceStart, videoOp.sourceEnd], [26.5, 34.5], 'sourceStart/sourceEnd stay on the sermon timeline');
const remapped = { ...videoOp, sourceStart: 100, sourceEnd: 108 };
const clipFrame = resolveFrameVisuals([remapped], 30, [clip]);
assert.equal(clipFrame.broll?.startSeconds, 26.5, 'the clip starts at the operation start regardless of sourceStart');
const replacedVideo = buildBrollReplacementOperation({ section: v.brollSection, originalOperation: remapped }, asset('video', { id: 'clip-2' }));
assert.deepEqual([replacedVideo.sourceStart, replacedVideo.sourceEnd], [100, 108], 'an existing source mapping survives a replacement');
assert.deepEqual([replacedVideo.start, replacedVideo.end], [26.5, 34.5]);
const rootSource = readFileSync(new URL('../src/Root.tsx', import.meta.url), 'utf8');
assert.ok(!/sourceStart|sourceEnd|startFrom/u.test(rootSource), 'the renderer never seeks into a B-roll asset using source timing');

// --- Silent mismatches are caught even if a stale review state bypasses the builder ---
const stale: EditOperation = { ...op, visualType: 'video-broll' };
const staleReady = readiness(v, applyReviewAction(v.review, 'section-1', 'replace-broll', { operation: { ...stale, start: 26.5, end: 34.5 } }), [image]);
assert.ok(staleReady.blockers.some((b) => b.includes('B-roll compatibility')), 'image asset cannot silently satisfy a video-broll operation');
const splitStale: EditOperation = { ...op, mode: 'split-right' };
assert.ok(readiness(s, applyReviewAction(s.review, 'section-1', 'replace-broll', { operation: splitStale }), [image]).blockers.some((b) => b.includes('Layout violation')), 'accidental split-screen blocks approval');

// --- Invalid assets can never be selected ---
assert.throws(() => buildBrollReplacementOperation(s.beat, asset('image', { usable: false })), /not usable/);
assert.throws(() => buildBrollReplacementOperation(s.beat, asset('image', { rightsStatus: 'unknown' })), /not usable/);
assert.throws(() => buildBrollReplacementOperation(s.beat, asset('image', { sizeBytes: 0 })), /not usable/);
assert.throws(() => buildBrollReplacementOperation(s.beat, asset('image', { contentHash: undefined })), /not usable/);
assert.throws(() => applyReviewAction(s.review, 'section-1', 'replace-broll', { operation: { ...s.original } }), /explicit broll operation/);
assert.throws(() => applyReviewAction(s.review, 'section-1', 'replace-broll'), /explicit broll operation/);

// --- Short sections use their full window; imported assets become selectable candidates ---
const short = scenario(10, 18, 'image-broll');
const shortOp = buildBrollReplacementOperation(short.beat, image);
assert.deepEqual([shortOp.start, shortOp.end], [10, 18]);
const withCandidate = attachAssetCandidate([s.beat, { ...s.beat, section: section(0, 5, 'speaker-full') }], image);
assert.equal(withCandidate[0].candidates.length, 1);
assert.equal(withCandidate[0].candidates[0].eligible, true);
assert.equal(withCandidate[1].candidates.length, 0, 'non-B-roll beats get no candidate');
assert.equal(attachAssetCandidate(withCandidate, image)[0].candidates.length, 1, 're-importing the same asset does not duplicate it');
assert.equal(attachAssetCandidate([s.beat], asset('image', { rightsStatus: 'unknown' }))[0].candidates[0].eligible, false);

// --- Keep Pastor leaves no B-roll ---
const kept = deriveApprovedEditPlan(s.policy.editPlan, applyReviewAction(s.review, 'section-1', 'keep-pastor'));
assert.equal(kept.operations.some((o) => o.type === 'broll'), false);

console.log(JSON.stringify({ status: 'PASS', suite: 'broll-review-timing-v1-3-8' }, null, 2));
