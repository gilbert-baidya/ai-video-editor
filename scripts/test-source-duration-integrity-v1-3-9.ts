import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { EditPlan, TranscriptDocument } from '../src/contracts.ts';
import type { ReviewDataPayload } from '../src/DirectorReviewWorkspace.tsx';
import { updateReview, type ReviewState } from '../src/director-review.ts';
import { exportStatus } from '../src/editor/editor-model.ts';
import type { ProductProjectRecord } from '../src/product-api.ts';
import { createProductProject, updateProductStage } from '../src/product-workflow.ts';
import { probeSource } from '../src/source-ingestion.ts';
import { sha256Browser } from '../src/sha256.ts';
import { sourceDurationMismatchMessage, validatePlanTiming, validateTranscriptTiming } from '../src/source-duration.ts';

const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const ffprobe = '/opt/homebrew/bin/ffprobe';
if (!existsSync(ffmpeg) || !existsSync(ffprobe)) {
  console.log('SKIPPED source-duration-integrity-v1-3-9: ffmpeg/ffprobe are unavailable.');
  process.exit(0);
}

const root = await mkdtemp(resolve(tmpdir(), 'source-duration-integrity-v1-3-9-'));
try {
  const sourcePath = resolve(root, 'synthetic-60s.mp4');
  execFileSync(ffmpeg, [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:size=108x192:rate=1:d=60',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=60.014',
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    sourcePath,
  ]);

  const physical = await probeSource(sourcePath, { state: 'AVAILABLE', detail: `${ffprobe} is available.` });
  assert.equal(physical.durationSource, 'ffprobe');
  assert.ok(Math.abs(Number(physical.videoDurationSeconds) - 60) < 0.05, 'video stream is approximately 60 seconds');
  assert.ok(Math.abs(Number(physical.audioDurationSeconds) - 60.014) < 0.05, 'audio stream is approximately 60.014 seconds');
  assert.ok(Math.abs(Number(physical.containerDurationSeconds) - 60.014) < 0.05, 'container duration is approximately 60.014 seconds');
  assert.equal(physical.durationSeconds, physical.containerDurationSeconds, 'container duration is the authoritative source timeline when available');
  const physicalSeconds = Number(physical.durationSeconds);

  const transcript = (end: number): TranscriptDocument => ({
    schemaVersion: '1.0', projectId: 'project-duration-fixture', originalTranscript: 'Synthetic fixture.', aiSuggestedDisplayText: 'Synthetic fixture.', approvedDisplayText: 'Synthetic fixture.', language: 'en', textSource: 'manual', approved: true, timingConfidence: 'segment-safe', source: 'sermonclip-reference', model: 'none',
    segments: [{ id: 'segment-1', start: 0, end, text: 'Synthetic fixture.', language: 'en', words: [{ id: 'word-1', text: 'fixture', start: 59, end, language: 'en' }] }],
    immutableOriginal: true, alignment: { provider: 'fixture', status: 'verified', limitations: [] },
  });
  assert.deepEqual(validateTranscriptTiming(transcript(60), physicalSeconds), [], 'valid transcript boundaries are accepted');
  assert.match(validateTranscriptTiming(transcript(72), physicalSeconds).join(' '), /TRANSCRIPT_SOURCE_DURATION_MISMATCH/, '72-second transcript is rejected');

  const plan = (end: number): EditPlan => ({
    schemaVersion: '1.1', projectId: 'project-duration-fixture', sourceTranscriptHash: 'fixture', status: 'approved', createdBy: { provider: 'fixture', model: 'none' },
    operations: [{ id: 'source-continuity', type: 'no-change', start: 0, end, mode: 'canonical-no-change', reason: 'Synthetic duration fixture.', confidence: 1 }],
  });
  assert.deepEqual(validatePlanTiming(plan(60), physicalSeconds, 60), [], 'valid plan boundaries are accepted');
  assert.match(validatePlanTiming(plan(72), physicalSeconds, 72).join(' '), /SOURCE_DURATION_MISMATCH/, '72-second Edit Plan is rejected');

  const workspace = (timelineEnd: number): ReviewDataPayload => {
    const aiPlan = plan(timelineEnd);
    const review: ReviewState = { schemaVersion: '1.0', projectId: aiPlan.projectId, sourceEditPlanHash: sha256Browser(JSON.stringify(aiPlan)), decisions: [], updatedAt: '2026-10-03T00:00:00.000Z', purpose: 'editorial' };
    return {
      projectId: aiPlan.projectId, title: 'Synthetic 60-second fixture', languageProfile: 'en',
      preview: { controlUrl: '', directorUrl: '', durationSeconds: timelineEnd, sourceStart: 0, sourceEnd: timelineEnd },
      analysis: { projectId: aiPlan.projectId, sections: [] } as never,
      aiPlan, mediaIndex: { schemaVersion: '1', indexerVersion: 'fixture', createdAt: '', updatedAt: '', roots: [], assets: [] }, beats: [], qa: { status: 'PASS', failures: [] }, evidence: { explanationChain: '', placementEvidence: '', beforeFrame: '', duringFrame: '', afterFrame: '' }, initialReview: review, assetPreviewUrls: {},
    };
  };
  const validWorkspace = workspace(60);
  assert.equal(updateReview(validWorkspace, validWorkspace.initialReview, physicalSeconds).readiness.ready, true, 'legitimate 60-second review is approvable');
  const invalidWorkspace = workspace(72);
  const invalidReview = updateReview(invalidWorkspace, invalidWorkspace.initialReview, physicalSeconds);
  assert.equal(invalidReview.readiness.ready, false, 'impossible Director timeline remains blocked');
  assert.match(invalidReview.readiness.blockers.join(' '), /SOURCE_DURATION_MISMATCH/);

  let workflow = createProductProject({ projectId: 'project-duration-fixture', title: 'Synthetic 60-second fixture', source: { type: 'local-video', fileName: 'synthetic-60s.mp4' } });
  for (const stage of ['ingest', 'transcript', 'director', 'review'] as const) workflow = updateProductStage(workflow, stage, { status: 'completed' });
  workflow = { ...workflow, coveragePercent: 100, provider: { name: 'fixture', status: 'SUCCESS', fallbackUsed: false } };
  const record: ProductProjectRecord = {
    schemaVersion: '1.3', workflow, artifacts: {}, jobs: [], cacheReuse: {},
    sourceMetadata: { kind: 'local-video', durationSeconds: physicalSeconds, containerDurationSeconds: physical.containerDurationSeconds, videoDurationSeconds: physical.videoDurationSeconds, audioDurationSeconds: physical.audioDurationSeconds, durationSource: 'ffprobe', relativePath: 'source/synthetic-60s.mp4', immutable: true },
    sourceDurationValidation: { status: 'verified', physicalDurationSeconds: physicalSeconds, metadataDurationSeconds: physicalSeconds, transcriptEndSeconds: 60, approvedTimelineEndSeconds: 60, toleranceSeconds: 0.5, failures: [], checkedAt: '2026-10-03T00:00:00.000Z' },
  };
  assert.equal(exportStatus(record).state, 'READY', 'legitimate synthetic project is ready for render testing');

  const mismatchMessage = sourceDurationMismatchMessage(physicalSeconds, 72);
  const invalidRecord: ProductProjectRecord = {
    ...record,
    sourceDurationValidation: { ...record.sourceDurationValidation!, status: 'mismatch', metadataDurationSeconds: 72, transcriptEndSeconds: 72, approvedTimelineEndSeconds: 72, failures: [mismatchMessage] },
  };
  const verdict = exportStatus(invalidRecord);
  assert.equal(verdict.state, 'NOT_READY');
  assert.equal(verdict.canRender, false);
  assert.equal(verdict.detail, mismatchMessage);

  console.log(JSON.stringify({
    status: 'PASS', suite: 'source-duration-integrity-v1-3-9',
    fixture: { physicalSeconds, videoSeconds: physical.videoDurationSeconds, audioSeconds: physical.audioDurationSeconds, isolatedRoot: root },
    checks: ['ffprobe ingestion metadata', 'valid transcript boundary', '72-second transcript rejection', 'valid plan boundary', '72-second plan rejection', 'review approval gate', 'truthful export readiness'],
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
