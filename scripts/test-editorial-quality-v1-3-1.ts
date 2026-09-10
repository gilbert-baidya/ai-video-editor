import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { EditOperation, EditPlan, MediaAsset, SermonAnalysis, SermonSection } from '../src/contracts.ts';
import { applyReviewAction, createInitialReviewState, deriveApprovedEditPlan, evaluateReviewReadiness, type ReviewWorkspaceData } from '../src/director-review.ts';
import { applyRetentionPolicy } from '../src/visual-policy.ts';
import {
  assertFunctionalReviewIsolation,
  auditPlanRealization,
  evaluateEditorialQuality,
  meaningfulEditEvents,
  summarizeEditorialActivity,
  summarizeReviewWorkspace,
  traceCreativeOperations,
} from '../src/editorial-quality.ts';
import { createVideoFormatProfile } from '../src/video-format.ts';
import { sha256Browser } from '../src/sha256.ts';
import { ProductProjectStore } from '../src/product-store.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import type { ProductCapabilities } from '../src/product-api.ts';
import { effectiveVideoDimensions } from '../src/source-ingestion.ts';

interface BenchmarkFixture {
  projectId: string;
  source: { width: number; height: number; durationSeconds: number };
  sections: Array<Pick<SermonSection, 'id' | 'start' | 'end' | 'type' | 'intensity' | 'visualRecommendation'>>;
}

const fixture = JSON.parse(await readFile(resolve(import.meta.dirname, '../fixtures/editorial-short-v1-3-1.json'), 'utf8')) as BenchmarkFixture;
const section = (value: BenchmarkFixture['sections'][number]): SermonSection => ({
  ...value,
  transcriptText: `Canonical Bengali fixture ${value.id}`,
  sourceSegmentIds: [`segment-${value.id}`],
  suggestedDisplayText: value.type === 'main-point' || value.type === 'introduction' ? `Display ${value.id}` : undefined,
  confidence: 0.9,
  reason: `Fixture ${value.visualRecommendation}.`,
});
const analysis: SermonAnalysis = {
  version: 'v1.3.1-fixture',
  projectId: fixture.projectId,
  supportingPassages: [],
  sections: fixture.sections.map(section),
  mainPoints: [],
  keyStatements: [],
  illustrations: [],
  stories: [],
  testimonies: [],
  questions: [],
  applications: [],
  prayerMoments: [],
  emotionalMoments: [],
  confidence: 0.9,
};

for (const [width, height, orientation, outputWidth, outputHeight] of [
  [1080, 1920, 'portrait', 1080, 1920],
  [1080, 1918, 'portrait', 1080, 1920],
  [1920, 1080, 'landscape', 1920, 1080],
  [1280, 720, 'landscape', 1920, 1080],
] as const) {
  const format = createVideoFormatProfile(width, height);
  assert.equal(format.orientation, orientation);
  assert.equal(format.width, outputWidth);
  assert.equal(format.height, outputHeight);
  assert.equal(format.fitMode, 'contain');
}
assert.deepEqual(effectiveVideoDimensions({ streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] }), { width: 1080, height: 1920 });

const policy = applyRetentionPolicy(analysis, fixture.projectId, 'fixture-hash', fixture.source.durationSeconds);
const brollPolicyOperation = policy.editPlan.operations.find((operation) => operation.id === 'policy-story');
assert.equal(brollPolicyOperation?.type, 'director-placeholder', 'B-roll recommendation was silently removed by policy.');
const punchInOperation = policy.editPlan.operations.find((operation) => operation.id === 'policy-question');
assert.equal(punchInOperation?.type, 'speaker-position');
assert.equal(punchInOperation?.type === 'speaker-position' ? punchInOperation.position : undefined, 'punch-in');
assert(policy.editPlan.operations.some((operation) => operation.id === 'policy-prayer' && operation.type === 'no-change'));

const emptyMedia = { schemaVersion: '1', indexerVersion: '1', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', roots: [], assets: [] };
const beats: ReviewWorkspaceData['beats'] = analysis.sections.map((item) => {
  const originalOperation = policy.editPlan.operations.find((operation) => operation.id === `policy-${item.id}`);
  return {
    section: item,
    originalOperation,
    brollDecision: item.id === 'story'
      ? { intent: { sectionId: item.id, start: item.start, end: item.end, decision: 'search' as const, reason: 'Fixture search.' }, candidates: [], decision: 'no-suitable-asset' as const, reason: 'No approved media.' }
      : undefined,
    candidates: [],
    requiredReview: originalOperation?.type !== 'no-change',
    noBroll: originalOperation?.type === 'no-change',
  };
});
const initial = createInitialReviewState({ projectId: fixture.projectId, aiPlan: policy.editPlan, beats }, sha256Browser(JSON.stringify(policy.editPlan)));
const workspace: ReviewWorkspaceData = {
  projectId: fixture.projectId,
  title: 'Editorial short fixture',
  languageProfile: 'bn',
  preview: { controlUrl: '', directorUrl: '', durationSeconds: 60, sourceStart: 0, sourceEnd: 60 },
  analysis,
  aiPlan: policy.editPlan,
  mediaIndex: emptyMedia,
  beats,
  qa: { status: 'PASS', failures: [] },
  evidence: { explanationChain: '', placementEvidence: '', beforeFrame: '', duringFrame: '', afterFrame: '' },
  initialReview: initial,
};
assert(evaluateReviewReadiness(workspace, initial, 60).blockers.some((blocker) => blocker.includes('unresolved image-broll')));

const keepPastor = applyReviewAction(initial, 'story', 'keep-pastor');
const keepPastorDecision = keepPastor.decisions.find((decision) => decision.beatId === 'story');
assert.match(keepPastorDecision?.reviewerReason ?? '', /Keep Pastor — static/);
assert(!deriveApprovedEditPlan(policy.editPlan, keepPastor).operations.some((operation) => operation.id === 'policy-story'));

const asset: MediaAsset = {
  id: 'asset-story',
  path: '/fixture/story.jpg',
  relativePath: 'story.jpg',
  fileName: 'story.jpg',
  kind: 'image',
  mimeType: 'image/jpeg',
  sizeBytes: 100,
  modifiedAt: '2026-09-09T00:00:00.000Z',
  width: 1080,
  height: 1920,
  aspectRatio: 1080 / 1920,
  hasAudio: false,
  tags: ['story'],
  categories: ['illustration'],
  searchTerms: ['story'],
  rightsStatus: 'owned',
  rightsSource: 'library-root-default',
  libraryRootId: 'fixture',
  libraryPolicyVersion: '1',
  usable: true,
  unusableReasons: [],
};
const brollOperation: EditOperation = {
  id: 'broll-story',
  type: 'broll',
  sourceStart: 0,
  sourceEnd: 10,
  start: 45,
  end: 55,
  assetId: asset.id,
  mode: 'full-screen',
  muted: true,
  reason: 'Rights-safe fixture.',
  confidence: 0.9,
};
const resolvedReview = applyReviewAction(initial, 'story', 'replace-broll', { operation: brollOperation });
const resolvedPlan = deriveApprovedEditPlan(policy.editPlan, resolvedReview, 'approved');
assert(resolvedPlan.operations.some((operation) => operation.id === brollOperation.id));
assert.deepEqual(auditPlanRealization(resolvedPlan, [asset]).unsupportedOperations, []);
const unsafeWorkspace: ReviewWorkspaceData = { ...workspace, mediaIndex: { ...emptyMedia, assets: [{ ...asset, rightsStatus: 'unknown' }] } };
assert(evaluateReviewReadiness(unsafeWorkspace, resolvedReview, 60).blockers.some((blocker) => blocker.includes('rights')));

const coverageOnlyPlan: EditPlan = {
  ...policy.editPlan,
  status: 'approved',
  operations: policy.editPlan.operations.filter((operation) => operation.type === 'no-change'),
};
const coverageOnly = summarizeEditorialActivity(coverageOnlyPlan, 60, 100);
assert.equal(coverageOnly.canonicalCoveragePercent, 100);
assert.equal(coverageOnly.meaningfulEditCount, 0);
const keepPastorSummary = summarizeEditorialActivity(deriveApprovedEditPlan(policy.editPlan, keepPastor, 'approved'), 60, 100, keepPastor);
assert.equal(keepPastorSummary.canonicalCoveragePercent, 100);
assert(keepPastorSummary.keepPastorDuration > 0);

const functionalReview = { ...initial, purpose: 'functional-test' as const };
assert.throws(() => assertFunctionalReviewIsolation(functionalReview), /cannot be persisted/);
assert.equal(initial.purpose, 'editorial');

const supportedPlan: EditPlan = {
  ...policy.editPlan,
  status: 'approved',
  operations: [
    { id: 'graphic-main', type: 'sermon-point', start: 8, end: 18, text: 'Main point', position: 'right', style: 'keyword', reason: 'Fixture', confidence: 0.9 },
    brollOperation,
  ],
};
const realized = auditPlanRealization(supportedPlan, [asset]);
assert.deepEqual(realized.renderedOperations, ['graphic-main', 'broll-story']);
const dropped = auditPlanRealization(supportedPlan, [asset], ['graphic-main']);
assert.deepEqual(dropped.droppedOperations.map((item) => item.operationId), ['broll-story']);
const supportedOperations: EditOperation[] = [
  { id: 'no-change', type: 'no-change', start: 0, end: 1, mode: 'canonical-no-change', reason: 'Fixture', confidence: 1 },
  { id: 'speaker-full', type: 'speaker-position', start: 1, end: 2, position: 'full', reason: 'Fixture', confidence: 1 },
  { id: 'speaker-left', type: 'speaker-position', start: 2, end: 3, position: 'left', reason: 'Fixture', confidence: 1 },
  { id: 'speaker-right', type: 'speaker-position', start: 3, end: 4, position: 'right', reason: 'Fixture', confidence: 1 },
  { id: 'punch-in', type: 'speaker-position', start: 4, end: 5, position: 'punch-in', reason: 'Fixture', confidence: 1 },
  { id: 'caption', type: 'caption', start: 5, end: 6, text: 'Caption', reason: 'Fixture', confidence: 1 },
  { id: 'sermon-point', type: 'sermon-point', start: 6, end: 7, text: 'Point', position: 'right', style: 'keyword', reason: 'Fixture', confidence: 1 },
  { id: 'scripture', type: 'sermon-point', start: 7, end: 8, text: 'John 3:16', position: 'right', style: 'scripture', reason: 'Fixture', confidence: 1 },
  brollOperation,
];
const completeContract = auditPlanRealization({ ...supportedPlan, operations: supportedOperations }, [asset]);
assert.deepEqual(completeContract.renderedOperations, supportedOperations.map((operation) => operation.id));
assert.equal(completeContract.droppedOperations.length, 0);
assert.equal(completeContract.unsupportedOperations.length, 0);

const barrenPlan: EditPlan = {
  ...policy.editPlan,
  status: 'approved',
  operations: [{ id: 'only-edit', type: 'sermon-point', start: 8, end: 18, text: 'One edit', position: 'right', style: 'keyword', reason: 'Fixture', confidence: 0.9 }],
};
const barrenQuality = evaluateEditorialQuality({
  analysis,
  approvedPlan: barrenPlan,
  mediaAssets: [],
  durationSeconds: 60,
  canonicalCoveragePercent: 100,
  format: createVideoFormatProfile(1080, 1918),
  sourceWidth: 1080,
  sourceHeight: 1918,
});
assert.equal(barrenQuality.passed, false);
assert(barrenQuality.failures.some((failure) => failure.includes('only 1 meaningful edit')));

const prayerSection = section({ id: 'prayer-only', start: 0, end: 60, type: 'prayer', intensity: 'reverent-calm', visualRecommendation: 'none' });
const prayerAnalysis = { ...analysis, sections: [prayerSection] };
const prayerPlan: EditPlan = {
  ...policy.editPlan,
  operations: [{ id: 'prayer-static', type: 'no-change', start: 0, end: 60, mode: 'keep-pastor-static', reason: 'Reverent prayer.', confidence: 1 }],
  status: 'approved',
};
const prayerQuality = evaluateEditorialQuality({
  analysis: prayerAnalysis,
  approvedPlan: prayerPlan,
  mediaAssets: [],
  durationSeconds: 60,
  canonicalCoveragePercent: 100,
  format: createVideoFormatProfile(1080, 1920),
  sourceWidth: 1080,
  sourceHeight: 1920,
});
assert.equal(prayerQuality.passed, true, prayerQuality.failures.join('; '));

const summary = summarizeReviewWorkspace(workspace, resolvedReview);
assert(summary.broll >= 1);
assert(summary.noChangeDuration > 0);
const trace = traceCreativeOperations(workspace, resolvedReview, resolvedPlan, auditPlanRealization(resolvedPlan, [asset]));
assert.equal(trace.find((item) => item.beatId === 'story')?.rendererOperation, 'REALIZED');

const temporary = await mkdtemp(resolve(tmpdir(), 'ai-video-editor-format-'));
try {
  const store = new ProductProjectStore(temporary);
  const capabilities: ProductCapabilities = {
    checkedAt: new Date().toISOString(),
    node: { state: 'AVAILABLE', detail: 'fixture' },
    ffmpeg: { state: 'UNAVAILABLE', detail: 'fixture' },
    ffprobe: { state: 'UNAVAILABLE', detail: 'fixture' },
    director: { state: 'UNAVAILABLE', detail: 'fixture' },
    transcription: { state: 'NOT_CONFIGURED', detail: 'fixture' },
    youtube: { state: 'UNAVAILABLE', detail: 'fixture' },
    render: { state: 'UNAVAILABLE', detail: 'fixture' },
  };
  const orchestrator = new ProductOrchestrator(store, temporary, { capabilities: async () => capabilities });
  await orchestrator.initialize();
  const project = await orchestrator.createProject({ title: 'Portrait format propagation', source: { type: 'local-video', fileName: 'portrait.mp4' } });
  await writeFile(resolve(store.sourceDirectory(project.workflow.projectId), 'portrait.mp4'), 'fixture');
  const attached = await orchestrator.attachUploadedSource(project.workflow.projectId, {
    kind: 'local-video',
    fileName: 'portrait.mp4',
    relativePath: 'source/portrait.mp4',
    sizeBytes: 7,
    width: 1080,
    height: 1918,
    immutable: true,
  });
  assert.equal(attached.workflow.render.format.orientation, 'portrait');
  assert.deepEqual([attached.workflow.render.width, attached.workflow.render.height], [1080, 1920]);
  const unknownProject = await orchestrator.createProject({ title: 'Unknown format', source: { type: 'local-video', fileName: 'unknown.mp4' } });
  await writeFile(resolve(store.sourceDirectory(unknownProject.workflow.projectId), 'unknown.mp4'), 'fixture');
  const unknown = await orchestrator.attachUploadedSource(unknownProject.workflow.projectId, {
    kind: 'local-video',
    fileName: 'unknown.mp4',
    relativePath: 'source/unknown.mp4',
    sizeBytes: 7,
    immutable: true,
  });
  assert.equal(unknown.workflow.stages.ingest.status, 'blocked');
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: 'PASS',
  checks: [
    'portrait and landscape format selection',
    'non-destructive contain framing',
    'source metadata propagation',
    'rotated display dimensions and unknown-format blocking',
    'B-roll recommendation remains explicit',
    'unresolved B-roll review blocker',
    'rights-safe B-roll realization',
    'Keep Pastor static decision',
    'canonical coverage versus editorial activity',
    'functional review isolation',
    'approved operation realization and drop detection',
    'barren 60-second editorial QA failure',
    'reverent prayer density exemption',
    'review workspace summary and creative trace',
  ],
}, null, 2));
