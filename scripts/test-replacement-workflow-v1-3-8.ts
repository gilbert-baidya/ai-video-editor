import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { EditOperation, EditPlan, SermonAnalysis, SermonSection } from '../src/contracts.ts';
import { resolveFrameVisuals } from '../src/broll-layout.ts';
import { applyReviewAction, buildBrollReplacementOperation, createInitialReviewState, type ReviewBeat, type ReviewState } from '../src/director-review.ts';
import { auditPlanRealization } from '../src/editorial-quality.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { ProductProjectStore } from '../src/product-store.ts';
import { sha256Browser } from '../src/sha256.ts';

// Plan shape from the persisted validation project: B-roll 0–10 and 26.5–34.5, Pastor punch-in 51–72.
const section = (id: string, start: number, end: number, visualRecommendation: SermonSection['visualRecommendation']): SermonSection => ({
  id, start, end, transcriptText: id, sourceSegmentIds: [`seg-${id}`], type: 'story', intensity: 'story-illustration', confidence: 0.9, reason: 'fixture', visualRecommendation,
});
const sections = [section('section-1', 0, 10, 'image-broll'), section('section-2', 10, 51, 'image-broll'), section('section-3', 51, 72, 'speaker-punch-in')];
const planOperations: EditOperation[] = [
  { id: 'policy-section-1', type: 'director-placeholder', start: 0, end: 10, visualType: 'image-broll', reason: 'fixture', confidence: 0.9 },
  { id: 'policy-section-2', type: 'director-placeholder', start: 26.5, end: 34.5, visualType: 'image-broll', reason: 'fixture', confidence: 0.9 },
  { id: 'policy-section-3', type: 'speaker-position', start: 51, end: 72, position: 'punch-in', reason: 'fixture', confidence: 0.9 },
];

const root = await mkdtemp(join(tmpdir(), 'replacement-'));
const store = new ProductProjectStore(resolve(root, 'projects'));
let renders = 0;
const orchestrator = new ProductOrchestrator(store, process.cwd(), {
  capabilities: async () => ({ render: { state: 'AVAILABLE', detail: 'stub' } }) as any,
  probeSource: async () => ({ durationSeconds: 72, containerDurationSeconds: 72, videoDurationSeconds: 72, audioDurationSeconds: 72, durationSource: 'ffprobe', width: 1080, height: 1920 }),
  render: async (_record, _source, outputPath) => {
    renders += 1;
    writeFileSync(outputPath, `render-${renders}`);
    return { video: true, audio: true, directorCoverage: true, brollRights: true, placement: true, bengaliGraphics: true, reviewReadiness: true, editorialQuality: true, mediaIntegrity: true, outputPath: 'final-sermon.mp4' };
  },
});

const created = await orchestrator.createProject({ title: 'Replacement workflow', source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true } });
const projectId = created.workflow.projectId;
const aiPlan: EditPlan = { schemaVersion: '2.0', projectId, sourceTranscriptHash: 'hash', operations: planOperations, status: 'draft', createdBy: { provider: 'fixture', model: 'fixture' } };
const analysis = { sections, projectId } as unknown as SermonAnalysis;
const beats: ReviewBeat[] = sections.map((s, index) => ({ section: s, originalOperation: aiPlan.operations[index], requiredReview: true, noBroll: false, candidates: [] }));

const record = await store.get(projectId);
const done = { status: 'completed' as const, progress: 100, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
Object.assign(record.workflow.stages, { ingest: done, transcript: done, director: done });
record.workflow.coveragePercent = 100;
record.workflow.status = 'DIRECTOR_READY';
record.sourceMetadata = { kind: 'local-video', durationSeconds: 72, width: 1080, height: 1920, relativePath: 'source/mock.mp4', immutable: true } as any;
record.artifacts.transcript = 'artifacts/transcript.json';
mkdirSync(resolve(store.projectDirectory(projectId), 'source'), { recursive: true });
writeFileSync(resolve(store.projectDirectory(projectId), 'source/mock.mp4'), 'video');
writeFileSync(resolve(store.artifactDirectory(projectId), 'transcript.json'), JSON.stringify({ segments: [{ id: 'segment-1', start: 0, end: 72, text: 'fixture', language: 'en', words: [] }] }));
await store.save(record);
const initialReview = createInitialReviewState({ projectId, aiPlan, beats, directorExecution: undefined }, sha256Browser(JSON.stringify(aiPlan)));
const workspacePath = resolve(store.artifactDirectory(projectId), 'review-workspace.json');
writeFileSync(workspacePath, JSON.stringify({ projectId, title: 'x', languageProfile: 'en', preview: { controlUrl: '', directorUrl: '', durationSeconds: 72, sourceStart: 0, sourceEnd: 72 }, analysis, aiPlan, mediaIndex: { schemaVersion: '1', indexerVersion: '1', createdAt: '', updatedAt: '', roots: [], assets: [] }, beats, qa: { status: 'PASS', failures: [] }, evidence: {}, initialReview, assetPreviewUrls: {} }));

const jpeg = (height: number, fill: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, 0x04, 0x00, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]), Buffer.alloc(2048, fill)]);
const importAsset = async (name: string, bytes: Buffer, description: string) => {
  const path = join(root, name);
  await writeFile(path, bytes);
  return orchestrator.importLocalAsset(projectId, { path, description, rightsStatus: 'approved', rightsBasis: 'generated', rightsNote: 'Generated for this fixture.' });
};
const currentBeats = (): ReviewBeat[] => JSON.parse(readFileSync(workspacePath, 'utf8')).beats;
const approvedPlanPath = resolve(store.artifactDirectory(projectId), 'approved-plan.json');
const approvedPlan = (): EditPlan => JSON.parse(readFileSync(approvedPlanPath, 'utf8'));
const brollOps = (plan: EditPlan) => plan.operations.filter((o): o is Extract<EditOperation, { type: 'broll' }> => o.type === 'broll');
const replace = (review: ReviewState, sectionId: string, asset: Awaited<ReturnType<typeof importAsset>>) => {
  const beat = currentBeats().find((b) => b.section.id === sectionId)!;
  return applyReviewAction(review, sectionId, 'replace-broll', { operation: buildBrollReplacementOperation(beat, asset) });
};
const expectFrames = (plan: EditPlan, assets: any[], label: string) => {
  const at = (seconds: number) => resolveFrameVisuals(plan.operations, seconds, assets);
  assert.equal(at(5).pastorVisible, false, `${label}: 5 s full-frame B-roll`);
  assert.equal(at(5).broll?.layout, 'FULL_FRAME_MEDIA');
  assert.equal(at(30).pastorVisible, false, `${label}: 30 s full-frame B-roll`);
  assert.equal(at(30).broll?.layout, 'FULL_FRAME_MEDIA');
  assert.equal(at(45).pastorVisible, true, `${label}: 45 s Pastor full-frame`);
  assert.equal(at(45).broll, undefined);
  assert.equal(at(60).pastorVisible, true, `${label}: 60 s Pastor`);
  assert.equal(at(60).broll, undefined);
  const punch = plan.operations.find((o) => o.type === 'speaker-position' && 60 >= o.start && 60 < o.end);
  assert.equal(punch?.type === 'speaker-position' ? punch.position : undefined, 'punch-in', `${label}: 60 s Pastor punch-in`);
};

// 1. First approval and render.
const assetA = await importAsset('a.png', jpeg(1024, 1), 'first illustration');
assert.ok(currentBeats().every((b) => b.section.visualRecommendation !== 'image-broll' || b.candidates.some((c) => c.assetId === assetA.id)));
let review = replace(replace(initialReview, 'section-1', assetA), 'section-2', assetA);
review = applyReviewAction(review, 'section-3', 'accept');
let project = await orchestrator.saveReview(projectId, review);
assert.equal(project.workflow.stages.review.status, 'completed');
assert.equal(project.workflow.status, 'READY_TO_RENDER');
await orchestrator.startStage(projectId, 'render');
await orchestrator.waitForStage(projectId, 'render');
project = await store.get(projectId);
assert.equal(project.workflow.status, 'COMPLETED');
assert.equal(project.workflow.renderRevisions, undefined, 'a first render creates no revision');
const firstPlan = approvedPlan();
assert.deepEqual(brollOps(firstPlan).map((o) => [o.start, o.end]), [[0, 10], [26.5, 34.5]]);
assert.equal(project.workflow.lastRenderedPlanHash, sha256Browser(JSON.stringify(firstPlan)));
expectFrames(firstPlan, [assetA], 'first plan');
assert.equal(auditPlanRealization(firstPlan, [assetA], undefined, 72).unsupportedOperations.length, 0);

// 2. Re-saving the identical review on a COMPLETED project must not invalidate the finished render.
project = await orchestrator.saveReview(projectId, review);
assert.equal(project.workflow.status, 'COMPLETED', 'unchanged plan keeps the completed outcome');
assert.equal(project.workflow.renderRevisions, undefined);
assert.equal(project.output?.qaStatus, 'PASS');

// 3. COMPLETED project -> new asset -> replace one beat -> save Review.
const assetB = await importAsset('b.png', jpeg(768, 2), 'replacement illustration');
assert.notEqual(assetB.id, assetA.id);
assert.equal(assetB.height, 768);
assert.equal((await store.get(projectId)).workflow.status, 'COMPLETED', 'importing an asset alone changes no workflow state');
const replacedReview = replace(review, 'section-2', assetB);
project = await orchestrator.saveReview(projectId, replacedReview);
assert.equal(project.workflow.stages.review.status, 'completed');
assert.equal(project.workflow.status, 'READY_TO_RENDER', 'reached through the state machine, not by direct modification');
assert.equal(project.workflow.stages.render.status, 'not-started', 'stale render outcome is reopened');
assert.equal(project.workflow.stages.qa.status, 'not-started');
assert.equal(project.qa, undefined);
assert.equal(project.output, undefined, 'stale QA/output evidence is cleared');
const revision = project.workflow.renderRevisions?.[0];
assert.ok(revision && project.workflow.renderRevisions?.length === 1);
assert.equal(revision.previousStages.render.status, 'completed');
assert.equal(revision.previousQaStatus, 'PASS');
assert.equal(readFileSync(resolve(store.projectDirectory(projectId), revision.archivedOutputPath!), 'utf8'), 'render-1', 'the first output is archived');
const secondPlan = approvedPlan();
assert.deepEqual(brollOps(secondPlan).map((o) => [o.start, o.end]), [[0, 10], [26.5, 34.5]], 'replacement preserved both approved windows');
assert.deepEqual(brollOps(secondPlan).map((o) => o.assetId), [assetA.id, assetB.id]);
assert.deepEqual(secondPlan.operations.find((o) => o.type === 'speaker-position'), firstPlan.operations.find((o) => o.type === 'speaker-position'), 'the Pastor punch-in is untouched');
expectFrames(secondPlan, [assetA, assetB], 'second plan');

// 4. Which API is available now: the normal render stage, not the explicit re-render.
await assert.rejects(orchestrator.rerender(projectId, 'plain re-render after review'), /Re-render blocked: .*use the normal render stage/);
await orchestrator.startStage(projectId, 'render');
await orchestrator.waitForStage(projectId, 'render');
project = await store.get(projectId);
assert.equal(project.workflow.status, 'COMPLETED');
assert.equal(readFileSync(resolve(store.projectDirectory(projectId), 'output/final-sermon.mp4'), 'utf8'), 'render-2');
assert.equal(project.workflow.lastRenderedPlanHash, sha256Browser(JSON.stringify(secondPlan)));
assert.equal(project.workflow.renderRevisions?.length, 1);
assert.equal(project.output?.qaStatus, 'PASS');

// 5. A later renderer-only fix with the plan unchanged uses the explicit re-render path.
const planBefore = readFileSync(approvedPlanPath, 'utf8');
await orchestrator.rerender(projectId, 'Deterministic renderer fix');
await orchestrator.waitForStage(projectId, 'render');
project = await store.get(projectId);
assert.equal(project.workflow.status, 'COMPLETED');
assert.equal(project.workflow.renderRevisions?.length, 2);
assert.equal(readFileSync(approvedPlanPath, 'utf8'), planBefore);
assert.equal(readFileSync(resolve(store.projectDirectory(projectId), 'output/final-sermon.mp4'), 'utf8'), 'render-3');

// 6. A replacement that is not valid never reaches READY_TO_RENDER.
assert.throws(() => buildBrollReplacementOperation(currentBeats()[1], { ...assetB, id: 'media-bad', sizeBytes: 0 }), /not usable/);
const staleSplit = applyReviewAction(replacedReview, 'section-2', 'replace-broll', { operation: { ...brollOps(secondPlan)[1], mode: 'split-right' } });
project = await orchestrator.saveReview(projectId, staleSplit);
assert.notEqual(project.workflow.status, 'READY_TO_RENDER');
assert.ok(project.workflow.unresolvedBlockers.some((b) => b.includes('Layout violation')));
await assert.rejects(orchestrator.startStage(projectId, 'render'), /not satisfied|must complete/);

await rm(root, { recursive: true, force: true });
console.log(JSON.stringify({ status: 'PASS', suite: 'replacement-workflow-v1-3-8' }, null, 2));
