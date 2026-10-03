import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EditOperation, EditPlan, SermonAnalysis, SermonSection } from '../src/contracts.ts';
import { applyReviewAction, buildBrollReplacementOperation, createInitialReviewState, type ReviewBeat } from '../src/director-review.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { discoverCapabilities } from '../src/product-capabilities.ts';
import { ProductProjectStore } from '../src/product-store.ts';
import { fingerprintExistingSource } from '../src/source-ingestion.ts';
import { sha256Browser } from '../src/sha256.ts';

// Development-only fixture for inspecting the editing workspace. It uses the real product pipeline with stub
// adapters (no AI provider, Whisper or renderer is called) and synthetic ffmpeg media. Never used for real sermons.
const appRoot = process.cwd();
const root = resolve(appRoot, '.runtime', 'ui-fixture');
const ffmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'].find((candidate) => { try { execFileSync(candidate, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!ffmpeg) throw new Error('ffmpeg is required to create the synthetic fixture media.');
const ffmpegPath: string = ffmpeg;

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const store = new ProductProjectStore(resolve(root, 'projects'));
const detected = await discoverCapabilities({ root: appRoot });

const section = (id: string, start: number, end: number, type: SermonSection['type'], visualRecommendation: SermonSection['visualRecommendation'], text: string): SermonSection => ({
  id, start, end, transcriptText: text, sourceSegmentIds: [`segment-${id}`], type, intensity: 'story-illustration', confidence: 0.88, reason: 'UI fixture scene.', visualRecommendation,
});
const sections = [
  section('section-1', 0, 10, 'introduction', 'image-broll', 'Fixture scene one — an opening illustration.'),
  section('section-2', 10, 51, 'story', 'image-broll', 'Fixture scene two — a longer story section with a short illustrative beat.'),
  section('section-3', 51, 72, 'application', 'speaker-punch-in', 'Fixture scene three — the closing application.'),
];
const operations = (): EditOperation[] => [
  { id: 'policy-section-1', type: 'director-placeholder', start: 0, end: 10, visualType: 'image-broll', reason: 'Fixture opening illustration.', confidence: 0.88 },
  { id: 'caption-fixture', type: 'caption', start: 12, end: 20, text: 'Synthetic fixture caption', textTrust: 'approved-display', reason: 'Fixture caption.', confidence: 0.9 },
  { id: 'policy-section-2', type: 'director-placeholder', start: 26.5, end: 34.5, visualType: 'image-broll', reason: 'Fixture story illustration.', confidence: 0.88 },
  { id: 'policy-section-3', type: 'speaker-position', start: 51, end: 72, position: 'punch-in', reason: 'Fixture closing punch-in.', confidence: 0.88 },
];

let projectId = '';
const orchestrator = new ProductOrchestrator(store, appRoot, {
  capabilities: async () => ({ ...(await discoverCapabilities({ root: appRoot })), transcription: { state: 'AVAILABLE', detail: 'UI fixture (stub)' } }),
  transcribe: async () => ({ projectId, language: 'en', segments: [{ id: 'segment-1', start: 0, end: 72, text: 'Synthetic fixture transcript.' }] }) as any,
  analyze: async () => {
    const analysis = { sections, projectId, title: 'UI fixture sermon (synthetic)' } as unknown as SermonAnalysis;
    const aiPlan: EditPlan = { schemaVersion: '2.0', projectId, sourceTranscriptHash: 'ui-fixture', operations: operations(), status: 'draft', createdBy: { provider: 'ui-fixture', model: 'none' } };
    const beats: ReviewBeat[] = sections.map((s) => ({ section: s, originalOperation: aiPlan.operations.find((operation) => operation.id === `policy-${s.id}`), requiredReview: true, noBroll: false, candidates: [] }));
    const initialReview = createInitialReviewState({ projectId, aiPlan, beats, directorExecution: undefined }, sha256Browser(JSON.stringify(aiPlan)));
    const reviewWorkspace = {
      projectId, title: 'UI fixture sermon (synthetic)', languageProfile: 'en' as const,
      preview: { controlUrl: `/api/projects/${projectId}/source`, directorUrl: `/api/projects/${projectId}/source`, durationSeconds: 72, sourceStart: 0, sourceEnd: 72 },
      analysis, aiPlan, mediaIndex: { schemaVersion: '1.0', indexerVersion: 'ui-fixture', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), roots: [], assets: [] },
      beats, qa: { status: 'PASS', failures: [] }, evidence: { explanationChain: '', placementEvidence: '', beforeFrame: '', duringFrame: '', afterFrame: '' }, initialReview, assetPreviewUrls: {},
    };
    return { analysis, reviewWorkspace: reviewWorkspace as any, provenance: { name: 'UI fixture (no AI call)', model: 'none', status: 'AVAILABLE' as const, fallbackUsed: false }, coveragePercent: 100, cacheReused: false };
  },
});
await orchestrator.initialize();

async function seedFullProject(label: string, width: number, height: number) {
  const fileName = `ui-fixture-${label}.mp4`;
  const created = await orchestrator.createProject({ title: `SYNTHETIC UI FIXTURE — ${label} — not a real sermon`, source: { type: 'local-video', fileName } });
  projectId = created.workflow.projectId;
  const sourcePath = resolve(store.sourceDirectory(projectId), fileName);
  execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=30`, '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '72', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '34', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourcePath]);
  await orchestrator.attachUploadedSource(projectId, { kind: 'local-video', fileName, mimeType: 'video/mp4', sizeBytes: statSync(sourcePath).size, sha256: await fingerprintExistingSource(sourcePath), relativePath: `source/${fileName}`, immutable: true });
  for (const stage of ['ingest', 'transcript', 'director'] as const) {
    await orchestrator.startStage(projectId, stage);
    await orchestrator.waitForStage(projectId, stage);
  }

  const imagePath = resolve(root, `fixture-illustration-${label}.jpg`);
  execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1024x1024:rate=1', '-frames:v', '1', '-pix_fmt', 'yuvj420p', imagePath]);
  const asset = await orchestrator.importLocalAsset(projectId, { path: imagePath, description: 'Synthetic fixture illustration', rightsStatus: 'approved', rightsBasis: 'generated', rightsNote: 'Synthetic ffmpeg test pattern created for UI inspection.' });
  const workspace = JSON.parse(readFileSync(resolve(store.artifactDirectory(projectId), 'review-workspace.json'), 'utf8'));
  let review = workspace.initialReview;
  for (const id of ['section-1', 'section-2']) {
    const beat = workspace.beats.find((candidate: ReviewBeat) => candidate.section.id === id);
    review = applyReviewAction(review, id, 'replace-broll', { operation: buildBrollReplacementOperation(beat, asset) });
  }
  review = applyReviewAction(review, 'section-3', 'accept');
  return orchestrator.saveReview(projectId, review);
}

const seeded = [await seedFullProject('portrait', 1080, 1920), await seedFullProject('landscape', 1920, 1080)];
await orchestrator.createProject({ title: 'SYNTHETIC UI FIXTURE — empty project', source: { type: 'local-video', fileName: 'pending.mp4' } });
writeFileSync(resolve(root, 'README.txt'), 'Synthetic UI fixture. Start with: PRODUCT_RUNTIME_ROOT=.runtime/ui-fixture/projects npm run dev:product\n');
console.log(JSON.stringify({ projects: seeded.map((record) => ({ projectId: record.workflow.projectId, title: record.workflow.title, status: record.workflow.status, review: record.workflow.stages.review.status })), runtime: resolve(root, 'projects') }, null, 2));
