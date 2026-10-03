import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EditOperation, EditPlan, MediaAsset } from '../src/contracts.ts';
import { brollLayout, defaultBrollWindow, resolveFrameVisuals, validateBrollOperation } from '../src/broll-layout.ts';
import { auditPlanRealization, createRendererPlan, evaluateEditorialQuality } from '../src/editorial-quality.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type Broll = Extract<EditOperation, { type: 'broll' }>;

function asset(kind: 'image' | 'video', overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: kind === 'image' ? 'a-img' : 'a-vid', path: `/fixture/${kind}`, relativePath: kind, fileName: kind,
    kind, mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4', sizeBytes: 922012, modifiedAt: '2026-01-01T00:00:00.000Z',
    contentHash: 'b'.repeat(64), durationSeconds: kind === 'video' ? 12 : undefined, width: 1024, height: 1024, aspectRatio: 1,
    hasAudio: kind === 'video', tags: [], categories: [], searchTerms: [], rightsStatus: 'approved', rightsBasis: 'owned',
    libraryRootId: 'fixture', libraryPolicyVersion: '1', usable: true, unusableReasons: [], ...overrides,
  };
}

function broll(overrides: Partial<Broll> = {}): Broll {
  return { id: 'b1', type: 'broll', start: 10, end: 20, sourceStart: 10, sourceEnd: 20, assetId: 'a-img', visualType: 'image-broll', mode: 'full-screen', muted: true, reason: '', confidence: 1, ...overrides };
}

const plan = (...operations: EditOperation[]): EditPlan => ({ schemaVersion: '1.0', projectId: 'test', sourceTranscriptHash: 'hash', status: 'approved', createdBy: { provider: 'test', model: 'test' }, operations });
const baseInput = {
  analysis: { sections: [], confidence: 1, textTrust: 'transcript' } as any,
  durationSeconds: 60,
  canonicalCoveragePercent: 100,
  format: { orientation: 'portrait', aspectRatio: 9 / 16, sourceAspectRatio: 9 / 16, fitMode: 'contain', width: 1080, height: 1920 } as any,
  sourceWidth: 1080,
  sourceHeight: 1920,
};
const qa = (operations: EditOperation[], assets: MediaAsset[], renderedOperationIds?: string[]) => evaluateEditorialQuality({ ...baseInput, approvedPlan: plan(...operations), mediaAssets: assets, renderedOperationIds });
const image = asset('image');
const video = asset('video');

// --- Operation contract (QA) ---
assert.ok(!qa([broll()], [image]).failures.some((f) => f.includes('Layout violation')), 'image-broll full-screen passes layout QA');
assert.ok(qa([broll({ mode: 'split-right' })], [image]).failures.some((f) => f.includes('Layout violation: image-broll must be FULL_FRAME_MEDIA')), 'image-broll split-screen fails');
assert.ok(qa([broll({ visualType: 'video-broll', assetId: 'a-vid', mode: 'split-left' })], [video]).failures.some((f) => f.includes('Layout violation: video-broll must be FULL_FRAME_MEDIA')), 'video-broll split fails');
assert.deepEqual(qa([broll({ visualType: 'video-broll', assetId: 'a-vid' })], [video]).failures, [], 'video-broll full-screen with a video asset passes');
assert.deepEqual(qa([broll({ visualType: 'split-screen', mode: 'split-right' })], [image]).failures, [], 'explicitly approved split-screen passes');
assert.ok(qa([broll({ visualType: 'split-screen', mode: 'full-screen' })], [image]).failures.some((f) => f.includes('Layout violation: split-screen must be SPLIT_SCREEN')), 'split-screen without a split layout fails');
assert.ok(qa([broll({ visualType: undefined, mode: 'split-left' })], [image]).failures.some((f) => f.includes('without an explicit split-screen approval')), 'unapproved split fails');

// --- Real-output QA rejections ---
const rejects = (label: string, operations: EditOperation[], assets: MediaAsset[], fragment: string, rendered?: string[]) => {
  const result = qa(operations, assets, rendered);
  assert.equal(result.passed, false, `${label}: QA must fail`);
  assert.ok(result.failures.some((f) => f.includes(fragment)), `${label}: expected "${fragment}" in ${JSON.stringify(result.failures)}`);
};
rejects('missing asset', [broll()], [], 'missing from the render media set');
rejects('image asset for video-broll', [broll({ visualType: 'video-broll' })], [image], 'asset a-img is a image');
rejects('video asset for image-broll', [broll({ assetId: 'a-vid' })], [video], 'asset a-vid is a video');
rejects('end before start', [broll({ start: 20, end: 10 })], [image], 'invalid window');
rejects('beyond timeline', [broll({ start: 55, end: 65 })], [image], 'after the 60.00-second timeline');
rejects('negative start', [broll({ start: -1, end: 5 })], [image], 'invalid window');
rejects('unmuted B-roll', [{ ...broll(), muted: false as any }], [image], 'must mute B-roll source audio');
rejects('overlapping B-roll', [broll(), broll({ id: 'b2', start: 15, end: 25 })], [image], 'overlaps');
rejects('dropped operation', [broll(), broll({ id: 'b2', start: 30, end: 40 })], [image], 'dropped', ['b1']);
rejects('zero-byte asset', [broll()], [asset('image', { sizeBytes: 0 })], 'not a positive byte count');
rejects('missing content hash', [broll()], [asset('image', { contentHash: undefined })], 'SHA-256');
rejects('bad MIME type', [broll()], [asset('image', { mimeType: 'application/pdf' })], 'unsupported MIME');
rejects('unusable asset', [broll()], [asset('image', { usable: false })], 'technically unusable');
rejects('unapproved rights', [broll()], [asset('image', { rightsStatus: 'unknown' })], 'rights status is unknown');
rejects('unresolved placeholder', [{ id: 'p1', type: 'director-placeholder', start: 1, end: 5, visualType: 'image-broll', reason: '', confidence: 1 }], [], 'unsupported');
assert.throws(() => createRendererPlan(plan(broll({ mode: 'split-right' })), [image], 60), /cannot be rendered without loss/, 'accidental split-screen cannot reach the renderer');
assert.throws(() => createRendererPlan(plan(broll({ assetId: 'a-vid' })), [video], 60), /cannot be rendered without loss/, 'mismatched asset kind cannot reach the renderer');
assert.equal(auditPlanRealization(plan(broll()), [image], undefined, 60).unsupportedOperations.length, 0);

// --- Renderer frame resolution (the composition uses exactly this function) ---
const timeline: EditOperation[] = [broll({ id: 'b-sub', start: 26.5, end: 34.5 })];
const at = (seconds: number) => resolveFrameVisuals(timeline, seconds, [image]);
for (const seconds of [10, 26.49, 34.5, 50]) assert.deepEqual(at(seconds), { pastorVisible: true }, `Pastor full-frame at ${seconds}s`);
for (const seconds of [26.5, 30, 34.49]) {
  const frame = at(seconds);
  assert.equal(frame.pastorVisible, false, `Pastor hidden during image B-roll at ${seconds}s`);
  assert.equal(frame.broll?.layout, 'FULL_FRAME_MEDIA');
}
assert.equal(resolveFrameVisuals([broll({ mode: 'split-right' })], 12, [image]).pastorVisible, false, 'image-broll never degrades to a 50/50 split even if mode says split');
assert.equal(brollLayout(broll({ mode: 'split-right' })), 'FULL_FRAME_MEDIA');
const split = resolveFrameVisuals([broll({ visualType: 'split-screen', mode: 'split-left' })], 12, [image]);
assert.equal(split.broll?.layout, 'SPLIT_SCREEN');
assert.equal(split.broll?.side, 'left');
assert.equal(split.pastorVisible, true, 'split-screen keeps the Pastor pane');
assert.equal(resolveFrameVisuals([broll({ assetId: 'missing' })], 12, [image]).pastorVisible, true, 'a missing asset never blanks the Pastor');
const punchIn: EditOperation = { id: 'pi', type: 'speaker-position', start: 0, end: 5, position: 'punch-in', reason: '', confidence: 1 };
assert.deepEqual(resolveFrameVisuals([punchIn], 2, [image]), { pastorVisible: true }, 'speaker-punch-in stays full-frame Pastor');
assert.equal(resolveFrameVisuals([broll({ visualType: 'video-broll', assetId: 'a-vid' })], 12, [video]).broll?.startSeconds, 10, 'video B-roll clip starts at its operation start');

// --- Window helper ---
assert.deepEqual(defaultBrollWindow(10, 20), { start: 10, end: 20 });
const sub = defaultBrollWindow(10, 51);
assert.ok(Math.abs(sub.start - 26.5) < 1e-9 && Math.abs(sub.end - 34.5) < 1e-9, 'a 10–51s section yields the 26.5–34.5s beat');
assert.deepEqual(validateBrollOperation(broll(), image, { durationSeconds: 60, section: { start: 10, end: 20 } }), []);
assert.ok(validateBrollOperation(broll(), image, { section: { start: 12, end: 18 } }).some((f) => f.includes('outside its semantic section')));

// --- Root.tsx wiring (static guard on the actual composition source) ---
const rootTsx = fs.readFileSync(path.join(__dirname, '../src/Root.tsx'), 'utf-8');
assert.ok(rootTsx.includes('resolveFrameVisuals('), 'composition derives layout from the shared resolver');
assert.ok(rootTsx.includes('const pastorOpacity = visuals.pastorVisible ? 1 : 0;'), 'Pastor picture is hidden via opacity during full-frame B-roll');
assert.ok(rootTsx.includes('opacity: pastorOpacity'), 'Pastor video applies the dynamic opacity');
assert.ok(rootTsx.includes('<Video src={staticFile(sourcePath)}'), 'Pastor video stays mounted so sermon audio is continuous');
assert.ok(!/<Video src=\{staticFile\(sourcePath\)\}[^>]*volume=\{0\}/u.test(rootTsx), 'Pastor audio is never muted');
assert.ok(!rootTsx.includes('opacity: 0.8'), 'B-roll background is fully opaque');
assert.ok(rootTsx.match(/<Img src=\{mediaSource\(broll\.asset\)\}.*filter: 'blur/u), 'Image B-roll uses the B-roll asset for its blurred background');
assert.ok(rootTsx.match(/<Img src=\{mediaSource\(broll\.asset\)\}.*objectFit: 'contain'/u), 'Image B-roll uses the B-roll asset for its sharp foreground');
assert.ok(!rootTsx.match(/<Video src=\{staticFile\(sourcePath\)\}.*filter: 'blur/u), 'Source video is NOT used as the background');
assert.equal(rootTsx.match(/<Video src=\{mediaSource\(broll\.asset\)\} volume=\{0\}/gu)?.length, 2, 'every B-roll <Video> mutes its own audio');
assert.ok(rootTsx.includes('<Sequence from={brollClip.from}'), 'video B-roll starts at its operation start, not at composition time zero');

console.log(JSON.stringify({ status: 'PASS', suite: 'broll-layout-v1-3-8' }, null, 2));
