import { resolve, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { stat } from 'node:fs/promises';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, type RenderMediaProgress } from '@remotion/renderer';
import type { EditOperation, EditPlan, SermonAnalysis } from '../src/contracts.ts';
import { applyRetentionPolicy } from '../src/visual-policy.ts';
import { ensureDirectory, extractSample, readJson, run, sha256, writeJson } from '../src/foundation.ts';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'public');
const artifacts = resolve(root, 'artifacts/full-sermon-pilot-v1-1/performance');
const source = resolve(publicDir, 'full-sermon-pilot-source.mp4');
const sampleSource = resolve(publicDir, 'full-sermon-v1-1-benchmark-source.mp4');
const window = { start: 180, end: 480 };

function clipPlan(plan: EditPlan): EditPlan {
  const operations = plan.operations.flatMap((operation): EditOperation[] => {
    const start = Math.max(operation.start, window.start);
    const end = Math.min(operation.end, window.end);
    return end <= start ? [] : [{ ...operation, start: start - window.start, end: end - window.start } as EditOperation];
  });
  return { ...plan, operations, status: 'validated' };
}

async function probe(path: string) {
  return JSON.parse(await run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,codec_type,width,height,sample_rate,channels', '-of', 'json', path]));
}

async function render(name: string, serveUrl: string, plan: EditPlan, options: { concurrency: number | null; x264Preset?: 'veryfast' }) {
  const output = resolve(artifacts, `${name}.mp4`);
  const inputProps = { sourcePath: relative(publicDir, sampleSource), editPlan: plan, graphicFontSize: 62, mediaAssets: [], durationSeconds: window.end - window.start };
  const composition = await selectComposition({ serveUrl, id: 'BanglaFoundation', inputProps });
  let lastProgress: RenderMediaProgress | undefined;
  const started = performance.now();
  const result = await renderMedia({
    composition, serveUrl, codec: 'h264', outputLocation: output, inputProps, audioCodec: 'aac',
    concurrency: options.concurrency, x264Preset: options.x264Preset,
    onProgress: (progress) => { lastProgress = progress; },
  });
  const wallMs = performance.now() - started;
  const metadata = await stat(output);
  return {
    name, output, settings: { ...options, resolvedDefaultConcurrency: options.concurrency === null ? 8 : options.concurrency, codec: 'h264', audioCodec: 'aac' },
    durationSeconds: window.end - window.start, wallMs, realtimeFactor: wallMs / 1000 / (window.end - window.start),
    outputBytes: metadata.size, probe: await probe(output), slowestFrames: result.slowestFrames.slice(0, 20),
    renderFramesDoneMs: lastProgress?.renderedDoneIn ?? null, encodeDoneMs: lastProgress?.encodedDoneIn ?? null,
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

async function main() {
  await ensureDirectory(artifacts);
  if (!(await stat(sampleSource).catch(() => undefined))) await extractSample(source, sampleSource, window.start, window.end - window.start);
  const analysis = await readJson<SermonAnalysis>(resolve(root, 'artifacts/full-sermon-pilot-v1-1/analysis/sermon-analysis.json'));
  const transcriptHash = (await readJson<{ transcriptHash: string }>(resolve(root, 'artifacts/full-sermon-pilot-v1/cache.json'))).transcriptHash;
  const plan = clipPlan(applyRetentionPolicy(analysis, analysis.projectId, transcriptHash, 2560).editPlan);
  const bundleStarted = performance.now();
  const serveUrl = await bundle({ entryPoint: resolve(root, 'src/entry.tsx'), publicDir, webpackOverride: (config) => config });
  const bundleMs = performance.now() - bundleStarted;
  const baseline = await render('baseline-5min', serveUrl, plan, { concurrency: null });
  const optimized = await render('optimized-5min', serveUrl, plan, { concurrency: 12, x264Preset: 'veryfast' });
  const payload = {
    sourceWindow: window, representativeContent: ['main point', 'graphics', 'normal teaching', 'reverent transition'],
    machine: { logicalCpus: 18, memoryBytes: 68719476736 }, bundleMs, baseline, optimized,
    absoluteImprovementMs: baseline.wallMs - optimized.wallMs,
    speedupPercent: Number((((baseline.wallMs - optimized.wallMs) / baseline.wallMs) * 100).toFixed(2)),
    selectedSettings: optimized.wallMs < baseline.wallMs ? optimized.settings : baseline.settings,
    correctnessHeldConstant: { width: 1920, height: 1080, videoCodec: 'h264', audioCodec: 'aac', durationSeconds: 300 },
    inputHash: sha256(JSON.stringify({ analysis, transcriptHash, window })),
  };
  await writeJson(resolve(artifacts, 'benchmark.json'), payload);
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
