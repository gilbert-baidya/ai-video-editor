import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { EditPlan, SermonAnalysis, SermonSection } from '../src/contracts.ts';
import { applyReviewAction, attachAssetCandidate, buildBrollReplacementOperation, createInitialReviewState, type ReviewBeat } from '../src/director-review.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { ProductProjectStore } from '../src/product-store.ts';
import { beginRenderRevision, createProductProject, rerenderBlockers, updateProductStage } from '../src/product-workflow.ts';
import { sha256Browser } from '../src/sha256.ts';
import { applyRetentionPolicy } from '../src/visual-policy.ts';

// --- Workflow primitives ---
const base = createProductProject({ projectId: 'project-x', title: 'x', source: { type: 'local-video', fileName: 'x.mp4' } });
let wf = base;
for (const stage of ['ingest', 'transcript', 'director', 'review', 'render'] as const) wf = updateProductStage(wf, stage, { status: 'completed' });
wf = { ...wf, coveragePercent: 100 };
assert.ok(rerenderBlockers(wf).some((b) => b.includes('does not permit a re-render')), 'a project awaiting QA cannot be re-rendered');
const completed = updateProductStage(wf, 'qa', { status: 'completed' });
assert.equal(completed.status, 'COMPLETED');
assert.deepEqual(rerenderBlockers(completed), []);
assert.ok(rerenderBlockers(base).length > 0, 'a fresh project cannot be re-rendered');
assert.throws(() => beginRenderRevision(completed, { reason: '  ', approvedPlanHash: 'h' }), /requires a stated reason/);
assert.throws(() => beginRenderRevision({ ...completed, coveragePercent: 80 }, { reason: 'x', approvedPlanHash: 'h' }), /coverage is 80%/);
assert.throws(() => beginRenderRevision({ ...completed, provider: { ...completed.provider, fallbackUsed: true } }, { reason: 'x', approvedPlanHash: 'h' }), /fallback/);
assert.throws(() => beginRenderRevision({ ...completed, stages: { ...completed.stages, review: { status: 'blocked', progress: 50 } } }, { reason: 'x', approvedPlanHash: 'h' }), /review must remain completed/);
const reopened = beginRenderRevision(completed, { reason: 'deterministic renderer fix', approvedPlanHash: 'h', previousQaStatus: 'PASS', archivedOutputPath: 'output/revisions/final-sermon.r1.mp4' }, '2026-10-02T00:00:00.000Z');
assert.equal(reopened.status, 'READY_TO_RENDER');
assert.equal(reopened.stages.render.status, 'not-started');
assert.equal(reopened.stages.qa.status, 'not-started');
assert.equal(reopened.stages.review.status, 'completed', 'review approval is preserved');
assert.equal(reopened.renderRevisions?.length, 1);
assert.equal(reopened.renderRevisions?.[0].revision, 2);
assert.equal(reopened.renderRevisions?.[0].previousStages.render.status, 'completed', 'the previous render outcome is kept in history');
assert.equal(reopened.renderRevisions?.[0].previousStages.qa.status, 'completed');
assert.equal(reopened.renderRevisions?.[0].previousQaStatus, 'PASS');

// --- Orchestrator flow with a stub renderer (no Remotion, no AI, no real media) ---
const root = await mkdtemp(join(tmpdir(), 'rerender-'));
const store = new ProductProjectStore(resolve(root, 'projects'));
let renderCount = 0;
let failNext = false;
const orchestrator = new ProductOrchestrator(store, process.cwd(), {
  capabilities: async () => ({ render: { state: 'AVAILABLE', detail: 'stub' } }) as any,
  probeSource: async () => ({ durationSeconds: 60, containerDurationSeconds: 60, videoDurationSeconds: 60, audioDurationSeconds: 60, durationSource: 'ffprobe', width: 1080, height: 1920 }),
  render: async (_record, _source, outputPath) => {
    renderCount += 1;
    if (failNext) { failNext = false; throw new Error('simulated renderer failure'); }
    writeFileSync(outputPath, `render-${renderCount}`);
    return { video: true, audio: true, directorCoverage: true, brollRights: true, placement: true, bengaliGraphics: true, reviewReadiness: true, editorialQuality: true, mediaIntegrity: true, outputPath: 'final-sermon.mp4' };
  },
});

const project = await orchestrator.createProject({ title: 'Re-render fixture', source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true } });
const projectId = project.workflow.projectId;
const section: SermonSection = { id: 'section-1', start: 10, end: 51, transcriptText: 'fixture', sourceSegmentIds: ['segment-1'], type: 'story', intensity: 'story-illustration', confidence: 0.9, reason: 'fixture', visualRecommendation: 'image-broll' };
const analysis = { sections: [section], projectId } as unknown as SermonAnalysis;
const policy = applyRetentionPolicy(analysis, projectId, 'hash', 60);
const beat: ReviewBeat = { section, originalOperation: policy.editPlan.operations[0], requiredReview: true, noBroll: false, candidates: [] };

let record = await store.get(projectId);
const done = { status: 'completed' as const, progress: 100, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
record.workflow.stages.ingest = done; record.workflow.stages.transcript = done; record.workflow.stages.director = done;
record.workflow.coveragePercent = 100;
record.workflow.status = 'DIRECTOR_READY';
record.sourceMetadata = { kind: 'local-video', durationSeconds: 60, width: 1080, height: 1920, relativePath: 'source/mock.mp4', immutable: true } as any;
record.artifacts.transcript = 'artifacts/transcript.json';
mkdirSync(resolve(store.projectDirectory(projectId), 'source'), { recursive: true });
writeFileSync(resolve(store.projectDirectory(projectId), 'source/mock.mp4'), 'video');
writeFileSync(resolve(store.artifactDirectory(projectId), 'transcript.json'), JSON.stringify({ segments: [{ id: 'segment-1', start: 0, end: 60, text: 'fixture', language: 'en', words: [] }] }));
await store.save(record);

const initialReview = createInitialReviewState({ projectId, aiPlan: policy.editPlan, beats: [beat], directorExecution: undefined }, sha256Browser(JSON.stringify(policy.editPlan)));
const workspace = { projectId, title: 'x', languageProfile: 'en', preview: { controlUrl: '', directorUrl: '', durationSeconds: 60, sourceStart: 0, sourceEnd: 60 }, analysis, aiPlan: policy.editPlan, mediaIndex: { schemaVersion: '1', indexerVersion: '1', createdAt: '', updatedAt: '', roots: [], assets: [] }, beats: [beat], qa: { status: 'PASS', failures: [] }, evidence: {}, initialReview, assetPreviewUrls: {} };
writeFileSync(resolve(store.artifactDirectory(projectId), 'review-workspace.json'), JSON.stringify(workspace));

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x04, 0x00, 0x04, 0x00, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]), Buffer.alloc(2048, 7)]);
const imagePath = join(root, 'illustration.png');
await writeFile(imagePath, jpeg);
const asset = await orchestrator.importLocalAsset(projectId, { path: imagePath, description: 'illustration', rightsStatus: 'approved', rightsBasis: 'generated', rightsNote: 'Generated for this fixture.' });
assert.equal(asset.mimeType, 'image/jpeg');
assert.equal(asset.width, 1024);
assert.equal(asset.height, 1024);
const stored = JSON.parse(readFileSync(resolve(store.artifactDirectory(projectId), 'review-workspace.json'), 'utf8'));
assert.equal(stored.mediaIndex.assets.length, 1);
assert.equal(stored.beats[0].candidates[0].assetId, asset.id, 'imported asset is offered as a candidate on the B-roll beat');

const replaced = applyReviewAction(initialReview, 'section-1', 'replace-broll', { operation: buildBrollReplacementOperation(attachAssetCandidate([beat], asset)[0], asset) });
await assert.rejects(orchestrator.rerender(projectId, 'too early'), /Re-render blocked/, 'cannot re-render before any render exists');
const reviewed = await orchestrator.saveReview(projectId, replaced);
assert.equal(reviewed.workflow.stages.review.status, 'completed');
const approvedPath = resolve(store.artifactDirectory(projectId), 'approved-plan.json');
const approvedBefore = readFileSync(approvedPath, 'utf8');
const approvedOps = (JSON.parse(approvedBefore) as EditPlan).operations;
assert.equal(approvedOps[0].start, 26.5, 'approved window survives saveReview');
assert.equal(approvedOps[0].end, 34.5);

await orchestrator.startStage(projectId, 'render');
await orchestrator.waitForStage(projectId, 'render');
let current = await store.get(projectId);
assert.equal(current.workflow.status, 'COMPLETED');
assert.equal(readFileSync(resolve(store.projectDirectory(projectId), 'output/final-sermon.mp4'), 'utf8'), 'render-1');
await assert.rejects(orchestrator.startStage(projectId, 'render'), /Render gates are not satisfied/, 'completed projects cannot be re-rendered through the plain render stage');

// Legitimate re-render
await assert.rejects(orchestrator.rerender(projectId, '   '), /requires a stated reason/);
writeFileSync(approvedPath, approvedBefore.replace('"end": 34.5', '"end": 51'));
await assert.rejects(orchestrator.rerender(projectId, 'tampered'), /no longer matches the saved review/, 'a hand-edited approved plan is rejected');
writeFileSync(approvedPath, approvedBefore);
const assetCopy = readFileSync(asset.path);
await rm(asset.path);
await assert.rejects(orchestrator.rerender(projectId, 'asset missing'), /cannot be realized/, 'a missing B-roll file blocks the re-render');
writeFileSync(asset.path, assetCopy);

const job = await orchestrator.rerender(projectId, 'Deterministic renderer fix: full-frame image B-roll');
assert.equal(job.stage, 'render');
await orchestrator.waitForStage(projectId, 'render');
current = await store.get(projectId);
assert.equal(current.workflow.status, 'COMPLETED');
assert.equal(readFileSync(resolve(store.projectDirectory(projectId), 'output/final-sermon.mp4'), 'utf8'), 'render-2', 'the new render replaced the output');
assert.equal(readFileSync(approvedPath, 'utf8'), approvedBefore, 'the approved plan is byte-for-byte unchanged');
const revision = current.workflow.renderRevisions?.[0];
assert.ok(revision && current.workflow.renderRevisions?.length === 1);
assert.equal(revision.reason, 'Deterministic renderer fix: full-frame image B-roll');
assert.equal(revision.previousStages.render.status, 'completed');
assert.equal(revision.previousQaStatus, 'PASS');
assert.equal(readFileSync(resolve(store.projectDirectory(projectId), revision.archivedOutputPath!), 'utf8'), 'render-1', 'the previous output is archived, not overwritten');
assert.equal(current.workflow.stages.render.status, 'completed');
assert.equal(current.workflow.stages.qa.status, 'completed');
assert.equal(current.output?.qaStatus, 'PASS');
assert.equal(current.workflow.stages.review.status, 'completed', 'review approval is untouched');

// A failed render leaves the previous output intact and can be retried through the same path
failNext = true;
await orchestrator.rerender(projectId, 'second attempt');
await orchestrator.waitForStage(projectId, 'render');
current = await store.get(projectId);
assert.equal(current.workflow.status, 'FAILED');
assert.equal(current.workflow.stages.render.error, 'simulated renderer failure');
assert.equal(current.workflow.renderRevisions?.length, 2);
assert.equal(current.output, undefined, 'stale QA/output evidence is cleared while no valid render exists');
assert.equal(readFileSync(resolve(store.projectDirectory(projectId), 'output/final-sermon.mp4'), 'utf8'), 'render-2', 'the last healthy file is not destroyed by a failed render');
await orchestrator.rerender(projectId, 'retry after failure');
await orchestrator.waitForStage(projectId, 'render');
current = await store.get(projectId);
assert.equal(current.workflow.status, 'COMPLETED');
assert.equal(current.workflow.renderRevisions?.length, 3);
assert.equal(current.workflow.renderRevisions?.[2].previousStages.render.status, 'failed', 'history truthfully records the failed attempt');
assert.ok(existsSync(resolve(store.projectDirectory(projectId), 'output/revisions')));

assert.equal(await readFile(resolve(import.meta.dirname, 're-render.ts'), 'utf8').catch(() => 'absent'), 'absent', 'the unsafe scripts/re-render.ts workaround is not present');

await rm(root, { recursive: true, force: true });
console.log(JSON.stringify({ status: 'PASS', suite: 'safe-rerender-v1-3-8' }, null, 2));
