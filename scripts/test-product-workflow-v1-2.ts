import { build } from 'esbuild';
import { resolve } from 'node:path';
import {
  canRenderProject,
  createProductProject,
  finalQaPassed,
  recoverProductProject,
  renderBlockers,
  updateProductStage,
  type FinalQaSummary,
} from '../src/product-workflow.ts';
import { sha256Browser } from '../src/sha256.ts';
import { sha256Node } from '../src/sha256-node.ts';

const samples = [
  'AI Video Editor V1.2',
  'প্রভু আমাকে উদ্ধার করেছেন',
  JSON.stringify({ projectId: 'বাংলা-sermon', decisions: [{ beatId: 'section-1', status: 'accepted', text: 'বিশ্বাস' }] }),
];
for (const sample of samples) {
  if (sha256Browser(sample) !== sha256Node(sample)) throw new Error(`Browser and Node SHA-256 differ for ${sample}.`);
}
if (sha256Browser('abc') !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error('Browser SHA-256 does not match the standard vector.');

let project = createProductProject({
  projectId: 'product-v1-2',
  title: 'বাংলা উপদেশ',
  source: { type: 'local-video', fileName: 'sermon.mp4', durationSeconds: 2560 },
  provider: { name: 'Ollama', model: 'qwen3:30b', status: 'SUCCESS', fallbackUsed: false },
  now: '2026-09-09T00:00:00.000Z',
});
project = updateProductStage(project, 'ingest', { status: 'completed', cacheReused: true });
project = updateProductStage(project, 'transcript', { status: 'completed', cacheReused: true });
project = updateProductStage(project, 'director', { status: 'completed', cacheReused: true });
project = { ...project, coveragePercent: 100 };
if (!renderBlockers(project).some((blocker) => blocker.includes('Human review'))) throw new Error('Incomplete review did not block render.');
project = updateProductStage(project, 'review', { status: 'completed' });
if (!canRenderProject(project)) throw new Error('Fully reviewed, fully covered project is not render-ready.');

const recovered = recoverProductProject(JSON.parse(JSON.stringify(project)) as unknown);
if (!recovered || recovered.status !== 'READY_TO_RENDER' || !recovered.stages.transcript.cacheReused) throw new Error('Persisted project did not recover completed cached stages.');

const fallbackProject = { ...project, provider: { ...project.provider, fallbackUsed: true } };
if (canRenderProject(fallbackProject) || !renderBlockers(fallbackProject).some((blocker) => blocker.includes('fallback'))) throw new Error('Fallback provenance did not block final rendering.');

const qa: FinalQaSummary = { video: true, audio: true, directorCoverage: true, brollRights: true, placement: true, bengaliGraphics: true, reviewReadiness: true, outputPath: '/exports/sermon.mp4' };
if (!finalQaPassed(qa) || finalQaPassed({ ...qa, bengaliGraphics: false })) throw new Error('Final QA aggregation is incorrect.');

let failedWithoutError = false;
try {
  updateProductStage(project, 'render', { status: 'failed' });
} catch {
  failedWithoutError = true;
}
if (!failedWithoutError) throw new Error('Failed pipeline stage was accepted without an explicit error.');

const bundle = await build({
  entryPoints: [resolve(import.meta.dirname, '../src/review-entry.tsx')],
  bundle: true,
  write: false,
  outdir: 'office-safe-browser-bundle',
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
});
const browserCode = bundle.outputFiles.find((output) => output.path.endsWith('.js'))?.text ?? '';
if (!browserCode.includes('AI VIDEO EDITOR')) throw new Error('Product workspace is missing from browser bundle.');
if (browserCode.includes('node:crypto') || browserCode.includes('createHash')) throw new Error('Browser bundle still contains Node hashing dependencies.');

console.log(JSON.stringify({
  status: 'PASS',
  checks: [
    'ASCII SHA-256 parity',
    'Bengali SHA-256 parity',
    'JSON review-state SHA-256 parity',
    'project lifecycle',
    'render blockers',
    'fallback render gate',
    'resume/cache recovery',
    'final QA aggregation',
    'explicit stage failures',
    'browser-safe product bundle',
  ],
}, null, 2));
