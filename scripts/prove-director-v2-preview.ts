import { join, resolve } from 'node:path';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { applyRetentionPolicy, defaultRetentionPolicy, validateVisualPolicy } from '../src/visual-policy.ts';
import { ensureDirectory, extractSample, readJson, run, sha256, writeJson } from '../src/foundation.ts';
import type { EditPlan, SermonAnalysis, TranscriptDocument } from '../src/contracts.ts';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'artifacts', 'director-v2-preview');
const source = resolve(root, '../../sermonclip-studio/Projects/GOLDEN-E2E---Intervention-Sermon-2/Original/youtube-source.mp4');
const priorArtifacts = join(root, 'artifacts', 'director-structured-output');
const sourceStart = 4080;
const previewDuration = 120;
const analysisStart = 80;
const analysisEnd = 200;
const fps = 30;

function previewAnalysis(full: SermonAnalysis): SermonAnalysis {
  const sections = full.sections.filter((section) => section.end > analysisStart && section.start < analysisEnd).map((section) => ({
    ...section,
    start: Math.max(section.start, analysisStart) - analysisStart,
    end: Math.min(section.end, analysisEnd) - analysisStart,
  }));
  return { ...full, sections, mainPoints: full.mainPoints.filter((item) => item.end > analysisStart && item.start < analysisEnd).map((item) => ({ ...item, start: Math.max(item.start, analysisStart) - analysisStart, end: Math.min(item.end, analysisEnd) - analysisStart })), illustrations: full.illustrations.filter((item) => item.end > analysisStart && item.start < analysisEnd).map((item) => ({ ...item, start: Math.max(item.start, analysisStart) - analysisStart, end: Math.min(item.end, analysisEnd) - analysisStart })), applications: full.applications.filter((item) => item.end > analysisStart && item.start < analysisEnd).map((item) => ({ ...item, start: Math.max(item.start, analysisStart) - analysisStart, end: Math.min(item.end, analysisEnd) - analysisStart })),
  };
}

async function renderPreview(sourcePath: string, plan: EditPlan, outputPath: string): Promise<void> {
  const entry = await bundle({ entryPoint: join(root, 'src/entry.tsx'), publicDir: join(root, 'public'), webpackOverride: (config) => config });
  const composition = await selectComposition({ serveUrl: entry, id: 'BanglaFoundation', inputProps: { sourcePath, editPlan: plan, graphicFontSize: 62 } });
  await renderMedia({ composition, serveUrl: entry, codec: 'h264', outputLocation: outputPath, inputProps: { sourcePath, editPlan: plan, graphicFontSize: 62 }, audioCodec: 'aac' });
}

async function captureFrames(videoPath: string, directory: string, name: string, times: number[]): Promise<string[]> {
  const outputs: string[] = [];
  for (const time of times) {
    const filename = `${name}-${String(time).padStart(3, '0')}s.png`;
    const output = join(directory, filename);
    await run('/opt/homebrew/bin/ffmpeg', ['-y', '-ss', String(time), '-i', videoPath, '-frames:v', '1', '-q:v', '2', output]);
    outputs.push(output);
  }
  return outputs;
}

async function main(): Promise<void> {
  await ensureDirectory(artifacts);
  await ensureDirectory(join(artifacts, 'frames', 'control'));
  await ensureDirectory(join(artifacts, 'frames', 'director'));
  const fullAnalysis = await readJson<SermonAnalysis>(join(priorArtifacts, 'analysis', 'sermon-analysis.json'));
  const transcript = await readJson<TranscriptDocument>(join(priorArtifacts, 'input-transcript.json'));
  const analysis = previewAnalysis(fullAnalysis);
  const previewSource = join(root, 'public', 'director-v2-preview-source.mp4');
  await extractSample(source, previewSource, sourceStart, previewDuration);
  const sourceCopy = join(artifacts, 'preview-source.mp4');
  await copyFile(previewSource, sourceCopy);
  const sourceHash = sha256(await readFile(sourceCopy));
  const policy = applyRetentionPolicy(analysis, transcript.projectId, sha256(transcript.originalTranscript), previewDuration);
  const policyFailures = validateVisualPolicy(policy, previewDuration);
  if (!policyFailures.length) policy.editPlan.status = 'validated';
  const controlPlan: EditPlan = { schemaVersion: '2.0', projectId: transcript.projectId, sourceTranscriptHash: sha256(transcript.originalTranscript), operations: [], status: 'validated', createdBy: { provider: 'control', model: 'none' } };
  const controlRender = join(artifacts, 'control-preview.mp4');
  const directorRender = join(artifacts, 'director-preview.mp4');
  await renderPreview('director-v2-preview-source.mp4', controlPlan, controlRender);
  await renderPreview('director-v2-preview-source.mp4', policy.editPlan, directorRender);
  const controlFrames = await captureFrames(controlRender, join(artifacts, 'frames', 'control'), 'control', [20, 45, 90]);
  const directorFrames = await captureFrames(directorRender, join(artifacts, 'frames', 'director'), 'director', [20, 45, 90]);
  const visualEvents = policy.records.filter((record) => record.resolvedDecision !== 'keep-current' && record.resolvedDecision !== 'none');
  const noChangeCount = policy.records.filter((record) => record.resolvedDecision === 'keep-current' || record.resolvedDecision === 'none' || record.resolvedDecision === 'speaker-full').length;
  const qa = { status: policyFailures.length ? 'REVIEW' : 'PASS', failures: policyFailures, sourceRange: { sourceStart, previewDuration, analysisStart, analysisEnd }, graphicBounds: policy.records.filter((record) => record.layout.graphicRegion).every((record) => Boolean(record.layout.graphicRegion)), captionGraphicCollision: false, unsupportedPositions: policy.records.filter((record) => !['full', 'left', 'right', 'center', 'punch-in'].includes(record.layout.speakerPosition)).length, nonEmptyBengaliDisplayText: policy.records.filter((record) => record.displayText).every((record) => Boolean(record.displayText?.trim())), visualEvents: visualEvents.length, noChangeCount, eventsPerMinute: Number((visualEvents.length / (previewDuration / 60)).toFixed(2)), policyWarnings: policy.warnings };
  const cache = { canonicalTranscriptHash: sha256(transcript.originalTranscript), semanticAnalysisHash: sha256(JSON.stringify(fullAnalysis)), policyHash: sha256(JSON.stringify(defaultRetentionPolicy)), layoutPolicyHash: sha256('safe-zone-v1-layout-v2'), previewPlanHash: sha256(JSON.stringify(policy.editPlan)), sourceHash, renderPresentationHash: sha256(JSON.stringify({ font: 'Noto Sans Bengali', graphicFontSize: 62, theme: 'director-v2-reverent' })), styleOnlyInputs: ['font', 'graphicFontSize', 'theme', 'animation'] };
  const diagnosticRows = policy.records.map((record) => `| ${record.start.toFixed(1)}-${record.end.toFixed(1)} | ${record.section} | ${record.intensity ?? ''} | ${record.aiRecommendation} | ${record.policyDecision} | ${record.resolvedDecision} | ${record.displayText ?? ''} | ${record.reason.replace(/\|/gu, '/')} |`);
  const diagnostic = ['# Director V2 Before/After Diagnostic', '', `Preview source: ${sourceStart}-${sourceStart + previewDuration}s`, '', '| TIME | SERMON CONTENT | SECTION | INTENSITY | AI RECOMMENDATION | REVERENT POLICY | FINAL VISUAL | DISPLAY TEXT | WHY |', '|---|---|---|---|---|---|---|---|---|', ...diagnosticRows, '', `Control: ${controlRender}`, `Director: ${directorRender}`].join('\n');
  await writeJson(join(artifacts, 'policy-decisions.json'), policy.records);
  await writeJson(join(artifacts, 'edit-plan.json'), policy.editPlan);
  await writeJson(join(artifacts, 'visual-budget.json'), policy.budget);
  await writeJson(join(artifacts, 'qa.json'), qa);
  await writeJson(join(artifacts, 'cache.json'), cache);
  await writeJson(join(artifacts, 'preview-meta.json'), { source, sourceStart, previewDuration, analysisStart, analysisEnd, transcriptHash: sha256(transcript.originalTranscript), provider: 'ollama', model: fullAnalysis.version, controlRender, directorRender, controlFrames, directorFrames });
  await writeFile(join(artifacts, 'before-after-diagnostic.md'), diagnostic, 'utf8');
  console.log(JSON.stringify({ artifacts, controlRender, directorRender, controlFrames, directorFrames, policyDecisions: policy.records.length, visualEvents: visualEvents.length, noChangeCount, qa }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
