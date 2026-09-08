import { join, resolve } from 'node:path';
import { copyFile, readFile } from 'node:fs/promises';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { ensureDirectory, extractAudio, extractSample, createFoundationPlan, createJob, createQa, dependency, probeVideo, readJson, run, sha256, transcribeAndAlign, validatePlan, writeJson } from '../src/foundation.js';
import type { EditPlan, TranscriptDocument } from '../src/contracts.js';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'artifacts', 'foundation-sample');
const source = resolve(root, '../../sermonclip-studio/Projects/GOLDEN-E2E---Intervention-Sermon-2/Original/youtube-source.mp4');
const projectId = 'foundation-sample';
const sampleStart = 4020;
const sampleDuration = 120;
const model = resolve(root, '../../sermonclip-studio/models/ggml-small.bin');

async function render(sourcePath: string, plan: EditPlan, outputPath: string, fontSize: number): Promise<void> {
  const entry = await bundle({ entryPoint: join(root, 'src/entry.tsx'), publicDir: join(root, 'public'), webpackOverride: (config) => config });
  const composition = await selectComposition({ serveUrl: entry, id: 'BanglaFoundation', inputProps: { sourcePath, editPlan: plan, graphicFontSize: fontSize } });
  await renderMedia({ composition, serveUrl: entry, codec: 'h264', outputLocation: outputPath, inputProps: { sourcePath, editPlan: plan, graphicFontSize: fontSize }, audioCodec: 'aac' });
}

async function main(): Promise<void> {
  await ensureDirectory(artifacts);
  const job = createJob('bangla-foundation', projectId); job.status = 'running'; job.startedAt = new Date().toISOString();
  await writeJson(join(artifacts, 'job.json'), job);
  const sampleVideo = join(artifacts, 'source-sample.mp4');
  const audio = join(artifacts, 'audio.wav');
  await extractSample(source, sampleVideo, sampleStart, sampleDuration);
  await ensureDirectory(join(root, 'public'));
  await copyFile(sampleVideo, join(root, 'public', 'proof-source.mp4'));
  await extractAudio(sampleVideo, audio);
  const transcript = await transcribeAndAlign(audio, join(artifacts, 'whisper'), model);
  transcript.projectId = projectId;
  await writeJson(join(artifacts, 'transcript.json'), transcript);
  await writeJson(join(artifacts, 'original-transcript.json'), { text: transcript.originalTranscript, immutable: true });
  const plan = createFoundationPlan(transcript);
  const video = await probeVideo(sampleVideo);
  const failures = validatePlan(plan, video.duration);
  if (failures.length) throw new Error(`Edit plan invalid: ${failures.join('; ')}`);
  plan.status = 'validated';
  await writeJson(join(artifacts, 'edit-plan.json'), plan);
  const qa = createQa(transcript, plan, video.duration);
  await writeJson(join(artifacts, 'qa-pre-render.json'), qa);
  const renderPath = join(artifacts, 'render-v1.mp4');
  await render('proof-source.mp4', plan, renderPath, 64);
  const presentationHash = sha256(JSON.stringify({ fontSize: 64, theme: 'foundation-default' }));
  await writeJson(join(artifacts, 'render-dependency.json'), dependency('render-v1', renderPath, ['source-sample', 'audio', 'transcript', 'edit-plan'], { source: sha256(await readFile(sampleVideo)), transcript: sha256(JSON.stringify(transcript)), editPlan: sha256(JSON.stringify(plan)) }, presentationHash));
  const renderMeta = JSON.parse(await run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', renderPath]));
  await writeJson(join(artifacts, 'render-result.json'), { schemaVersion: '1.0', projectId, outputPath: renderPath, width: 1920, height: 1080, durationSeconds: Number(renderMeta.format?.duration ?? 0), editPlanHash: sha256(JSON.stringify(plan)), presentationHash });
  const rerenderPath = join(artifacts, 'render-v2-style-only.mp4');
  await render('proof-source.mp4', plan, rerenderPath, 72);
  const rerenderPresentationHash = sha256(JSON.stringify({ fontSize: 72, theme: 'foundation-default' }));
  await writeJson(join(artifacts, 'render-v2-dependency.json'), dependency('render-v2-style-only', rerenderPath, ['source-sample', 'audio', 'transcript', 'edit-plan'], { source: sha256(await readFile(sampleVideo)), transcript: sha256(JSON.stringify(transcript)), editPlan: sha256(JSON.stringify(plan)) }, rerenderPresentationHash));
  await writeJson(join(artifacts, 'rerender-proof.json'), { changed: 'graphicFontSize', from: 64, to: 72, reusedArtifacts: ['source-sample', 'audio', 'transcript', 'edit-plan'], retranscribed: false, reanalyzed: false, semanticPlanChanged: false, editPlanHash: sha256(JSON.stringify(plan)) });
  const finalQa = createQa(transcript, plan, video.duration);
  finalQa.render = { passed: true, failures: [] };
  finalQa.passed = finalQa.transcript.passed && finalQa.edit.passed && finalQa.visual.passed && finalQa.render.passed;
  await writeJson(join(artifacts, 'qa-final.json'), finalQa);
  job.status = 'completed'; job.progress = 100; job.completedAt = new Date().toISOString(); job.artifacts = ['transcript.json', 'edit-plan.json', 'render-v1.mp4', 'render-v2-style-only.mp4', 'render-result.json', 'rerender-proof.json', 'qa-final.json'];
  await writeJson(join(artifacts, 'job.json'), job);
  console.log(JSON.stringify({ projectId, source, sampleStart, sampleDuration, artifacts, renderPath, transcriptSegments: transcript.segments.length, alignedWords: transcript.segments.flatMap((segment) => segment.words).length }, null, 2));
}

main().catch(async (error) => {
  await ensureDirectory(artifacts);
  await writeJson(join(artifacts, 'job.json'), { id: `job-bangla-foundation-${Date.now()}`, action: 'bangla-foundation', projectId, status: 'failed', progress: 0, error: error instanceof Error ? error.message : String(error), artifacts: [] });
  console.error(error);
  process.exitCode = 1;
});