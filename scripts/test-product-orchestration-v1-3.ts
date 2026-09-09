import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { EditPlan, TranscriptDocument } from '../src/contracts.ts';
import type { ProductCapabilities } from '../src/product-api.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { parseProjectApiRoute } from '../src/product-http.ts';
import { ProductProjectStore, assertProjectId, assertWithinRoot, sanitizeFileName } from '../src/product-store.ts';
import { parseYouTubeUrl, streamUpload } from '../src/source-ingestion.ts';

const root = await mkdtemp(resolve(tmpdir(), 'ai-video-editor-v1-3-'));

const capabilities: ProductCapabilities = {
  checkedAt: new Date().toISOString(),
  node: { state: 'AVAILABLE', detail: 'test' },
  ffmpeg: { state: 'AVAILABLE', detail: '/test/ffmpeg is available.' },
  ffprobe: { state: 'UNAVAILABLE', detail: 'fixture deliberately unavailable' },
  director: { state: 'AVAILABLE', detail: 'mock provider available' },
  transcription: { state: 'AVAILABLE', detail: 'mock transcription available' },
  youtube: { state: 'UNAVAILABLE', detail: 'yt-dlp is unavailable in the office fixture' },
  render: { state: 'AVAILABLE', detail: 'mock renderer available' },
};

function transcript(projectId: string): TranscriptDocument {
  return {
    schemaVersion: '1.0',
    projectId,
    originalTranscript: 'বিশ্বাসে স্থির থাকুন।',
    aiSuggestedDisplayText: 'বিশ্বাসে স্থির থাকুন।',
    approvedDisplayText: 'বিশ্বাসে স্থির থাকুন।',
    language: 'bn',
    textSource: 'local-asr',
    transcriptionProvider: 'mock-whisper',
    transcriptionModel: 'office-fixture',
    approved: false,
    timingConfidence: 'segment-safe',
    source: 'whisper-cli',
    model: 'office-fixture',
    segments: [{ id: 'canonical-1', start: 0, end: 2, text: 'বিশ্বাসে স্থির থাকুন।', language: 'bn', words: [] }],
    immutableOriginal: true,
    alignment: { provider: 'mock', status: 'verified', limitations: [] },
  };
}

let transcriptionCalls = 0;
let analysisCalls = 0;
let failAnalysis = true;
const store = new ProductProjectStore(root);
const orchestrator = new ProductOrchestrator(store, root, {
  capabilities: async () => capabilities,
  transcribe: async (_source, projectId) => {
    transcriptionCalls += 1;
    return transcript(projectId);
  },
  analyze: async () => {
    analysisCalls += 1;
    if (failAnalysis) throw new Error('Intentional Director fixture failure.');
    return {
      analysis: { fixture: true },
      provenance: { name: 'mock-ai', model: 'fixture-v1', status: 'SUCCESS', fallbackUsed: false },
      coveragePercent: 100,
      cacheReused: analysisCalls > 2,
    };
  },
  render: async (record, _source, output) => {
    await writeFile(output, Buffer.from('tiny-render-fixture'));
    return {
      video: true,
      audio: true,
      directorCoverage: record.workflow.coveragePercent === 100,
      brollRights: true,
      placement: true,
      bengaliGraphics: true,
      reviewReadiness: true,
      outputPath: output,
    };
  },
});

try {
  await orchestrator.initialize();

  const created = await orchestrator.createProject({
    title: 'অফিস পরীক্ষা',
    source: { type: 'local-video', fileName: 'sermon.mp4', sizeBytes: 13 },
  });
  assert.match(created.workflow.projectId, /^project-[a-f0-9-]+$/);
  assert.equal((await store.list()).length, 1);

  assert.throws(() => assertProjectId('../escape'));
  assert.throws(() => assertWithinRoot(root, resolve(root, '../escape')));
  assert.equal(sanitizeFileName('../../sermon.mp4'), 'sermon.mp4');
  assert.throws(() => sanitizeFileName('..'));

  assert.deepEqual(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), {
    videoId: 'dQw4w9WgXcQ',
    canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  });
  assert.throws(() => parseYouTubeUrl('https://evil.example/watch?v=dQw4w9WgXcQ'));
  assert.throws(() => parseYouTubeUrl('http://youtube.com/watch?v=dQw4w9WgXcQ'));

  const uploadBody = Buffer.from('video-fixture');
  const request = Readable.from([uploadBody]) as IncomingMessage;
  const metadata = await streamUpload(request, store.sourceDirectory(created.workflow.projectId), '../sermon.mp4', 'video/mp4', uploadBody.length);
  assert.equal(metadata.sizeBytes, uploadBody.length);
  assert.equal((await readFile(resolve(store.sourceDirectory(created.workflow.projectId), 'sermon.mp4'))).toString(), 'video-fixture');
  assert.equal(metadata.sha256?.length, 64);
  let project = await orchestrator.attachUploadedSource(created.workflow.projectId, metadata);
  assert.equal(project.workflow.stages.ingest.status, 'completed');
  await assert.rejects(() => orchestrator.attachUploadedSource(created.workflow.projectId, metadata), /immutable/);

  const transcriptJob = await orchestrator.startStage(created.workflow.projectId, 'transcript');
  await orchestrator.waitForStage(created.workflow.projectId, 'transcript');
  project = await store.get(created.workflow.projectId);
  assert.equal(project.workflow.stages.transcript.status, 'completed');
  assert.equal(project.jobs.find((job) => job.jobId === transcriptJob.jobId)?.status, 'completed');
  assert.equal(transcriptionCalls, 1);

  await orchestrator.startStage(created.workflow.projectId, 'director');
  await orchestrator.waitForStage(created.workflow.projectId, 'director');
  project = await store.get(created.workflow.projectId);
  assert.equal(project.workflow.stages.director.status, 'failed');
  assert.match(project.workflow.stages.director.error ?? '', /Intentional/);
  assert.equal(project.workflow.stages.transcript.status, 'completed');

  failAnalysis = false;
  await orchestrator.startStage(created.workflow.projectId, 'director');
  await orchestrator.waitForStage(created.workflow.projectId, 'director');
  project = await store.get(created.workflow.projectId);
  assert.equal(project.workflow.stages.director.status, 'completed');
  assert.equal(project.workflow.provider.name, 'mock-ai');
  assert.equal(project.workflow.coveragePercent, 100);
  assert.equal(transcriptionCalls, 1, 'Retrying Director must reuse the persisted transcript.');

  const plan: EditPlan = {
    schemaVersion: '1.1',
    projectId: created.workflow.projectId,
    sourceTranscriptHash: 'fixture',
    operations: [],
    status: 'approved',
    createdBy: { provider: 'mock-ai', model: 'fixture-v1' },
  };
  project = await orchestrator.saveReview(created.workflow.projectId, {
    schemaVersion: '1.0',
    projectId: created.workflow.projectId,
    sourceEditPlanHash: 'fixture',
    decisions: [],
    updatedAt: new Date().toISOString(),
  }, plan, true, []);
  assert.equal(project.workflow.status, 'READY_TO_RENDER');

  await orchestrator.startStage(created.workflow.projectId, 'render');
  await orchestrator.waitForStage(created.workflow.projectId, 'render');
  project = await store.get(created.workflow.projectId);
  assert.equal(project.workflow.stages.render.status, 'completed');
  assert.equal(project.workflow.stages.qa.status, 'completed', 'Final QA must run automatically after render.');
  assert.equal(project.workflow.status, 'COMPLETED');
  assert.equal(project.output?.qaStatus, 'PASS');
  assert.equal(project.output?.fileName, 'final-sermon.mp4');

  const reloaded = await new ProductProjectStore(root).get(created.workflow.projectId);
  assert.equal(reloaded.review?.projectId, created.workflow.projectId);
  assert.equal(reloaded.jobs.filter((job) => job.status === 'completed').length, 3);

  const unavailable = await orchestrator.createProject({
    title: 'YouTube unavailable',
    source: { type: 'youtube-url', url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', ingestionAvailable: false },
  });
  await orchestrator.startStage(unavailable.workflow.projectId, 'ingest');
  await orchestrator.waitForStage(unavailable.workflow.projectId, 'ingest');
  const unavailableReloaded = await store.get(unavailable.workflow.projectId);
  assert.equal(unavailableReloaded.workflow.stages.ingest.status, 'failed');
  assert.match(unavailableReloaded.workflow.stages.ingest.error ?? '', /unavailable/);
  assert.equal(unavailableReloaded.sourceMetadata, undefined);

  assert.deepEqual(parseProjectApiRoute(`/api/projects/${created.workflow.projectId}/status`), {
    projectId: created.workflow.projectId,
    action: 'status',
  });
  assert.equal(parseProjectApiRoute(`/api/projects/${created.workflow.projectId}/unknown`), undefined);
  assert.throws(() => parseProjectApiRoute('/api/projects/..%2Fescape/status'));

  console.log(JSON.stringify({
    status: 'PASS',
    checks: [
      'create project and persisted reload',
      'invalid project ID and path traversal rejection',
      'streaming local source contract and immutable fingerprint',
      'YouTube URL validation and unavailable adapter truthfulness',
      'capability-driven orchestration',
      'stage progression, failure, retry, and upstream reuse',
      'provider provenance and canonical coverage',
      'review persistence and render gate',
      'mocked tiny render, QA aggregation, and export metadata',
      'API route validation',
    ],
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
