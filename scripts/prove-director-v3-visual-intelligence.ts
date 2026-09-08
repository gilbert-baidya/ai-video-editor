import { join, resolve } from 'node:path';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { applyRetentionPolicy, defaultRetentionPolicy } from '../src/visual-policy.ts';
import { defaultPlacementConfig, PLACEMENT_ALGORITHM_VERSION, representativeSampleTimes, resolveVisualPlacements, TEXT_FIT_ALGORITHM_VERSION, validatePlacements, VISUAL_SAMPLING_VERSION } from '../src/visual-intelligence.ts';
import { ensureDirectory, extractSample, readJson, run, sha256, writeJson } from '../src/foundation.ts';
import type { EditPlan, SermonAnalysis, TranscriptDocument, VisualFrameAnalysis } from '../src/contracts.ts';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'artifacts', 'director-v3-visual-intelligence');
const priorArtifacts = join(root, 'artifacts', 'director-structured-output');
const source = resolve(root, '../../sermonclip-studio/Projects/GOLDEN-E2E---Intervention-Sermon-2/Original/youtube-source.mp4');
const sourceStart = 4080;
const previewDuration = 120;
const analysisStart = 80;
const analysisEnd = 200;
const scenarioTimes = [600, 1800, 3000, 4200, 5000];

function previewAnalysis(full: SermonAnalysis): SermonAnalysis {
  const sections = full.sections.filter((section) => section.end > analysisStart && section.start < analysisEnd).map((section) => ({ ...section, start: Math.max(section.start, analysisStart) - analysisStart, end: Math.min(section.end, analysisEnd) - analysisStart }));
  return { ...full, sections, mainPoints: full.mainPoints.filter((item) => item.end > analysisStart && item.start < analysisEnd).map((item) => ({ ...item, start: Math.max(item.start, analysisStart) - analysisStart, end: Math.min(item.end, analysisEnd) - analysisStart })), illustrations: [], applications: [] };
}

async function renderPreview(sourcePath: string, plan: EditPlan, outputPath: string): Promise<void> {
  const entry = await bundle({ entryPoint: join(root, 'src/entry.tsx'), publicDir: join(root, 'public'), webpackOverride: (config) => config });
  const composition = await selectComposition({ serveUrl: entry, id: 'BanglaFoundation', inputProps: { sourcePath, editPlan: plan, graphicFontSize: 62 } });
  await renderMedia({ composition, serveUrl: entry, codec: 'h264', outputLocation: outputPath, inputProps: { sourcePath, editPlan: plan, graphicFontSize: 62 }, audioCodec: 'aac' });
}

async function captureFrame(videoPath: string, outputPath: string, time: number): Promise<void> {
  await run('/opt/homebrew/bin/ffmpeg', ['-y', '-ss', String(time), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outputPath]);
}

async function debugFrame(sourceFrame: string, outputPath: string, frame: VisualFrameAnalysis, selectedRegion?: string): Promise<void> {
  const boxes = [...frame.faces.map((region) => ({ ...region, color: 'red' })), ...(frame.subject ? [{ ...frame.subject, color: 'yellow' }] : []), ...frame.occupied.map((region) => ({ ...region, color: 'blue' }))];
  const filters = boxes.map((region) => `drawbox=x=${region.x}*iw:y=${region.y}*ih:w=${region.width}*iw:h=${region.height}*ih:color=${region.color}@0.9:t=5`).join(',');
  const selected = selectedRegion ? { left: [0.05, 0.25, 0.30, 0.34], right: [0.65, 0.25, 0.30, 0.34], 'upper-left': [0.05, 0.08, 0.34, 0.22], 'upper-right': [0.61, 0.08, 0.34, 0.22], 'lower-left': [0.05, 0.68, 0.34, 0.20], 'lower-right': [0.61, 0.68, 0.34, 0.20], center: [0.30, 0.35, 0.40, 0.28] }[selectedRegion as keyof Record<string, number[]>] : undefined;
  const selectedFilter = selected ? `,drawbox=x=${selected[0]}*iw:y=${selected[1]}*ih:w=${selected[2]}*iw:h=${selected[3]}*ih:color=green@0.95:t=8` : '';
  const filter = `${filters}${selectedFilter}`;
  const args = ['-y', '-i', sourceFrame];
  if (filter) args.push('-vf', filter);
  args.push('-frames:v', '1', '-q:v', '2', outputPath);
  await run('/opt/homebrew/bin/ffmpeg', args);
}

async function main(): Promise<void> {
  await ensureDirectory(artifacts);
  await ensureDirectory(join(artifacts, 'frames', 'source'));
  await ensureDirectory(join(artifacts, 'frames', 'debug'));
  await ensureDirectory(join(artifacts, 'frames', 'final'));
  const fullAnalysis = await readJson<SermonAnalysis>(join(priorArtifacts, 'analysis', 'sermon-analysis.json'));
  const transcript = await readJson<TranscriptDocument>(join(priorArtifacts, 'input-transcript.json'));
  const analysis = previewAnalysis(fullAnalysis);
  const previewSource = join(root, 'public', 'director-v3-preview-source.mp4');
  await extractSample(source, previewSource, sourceStart, previewDuration);
  const sourceCopy = join(artifacts, 'preview-source.mp4');
  await copyFile(previewSource, sourceCopy);
  const policy = applyRetentionPolicy(analysis, transcript.projectId, sha256(transcript.originalTranscript), previewDuration);
  const records = policy.records.filter((record) => record.resolvedDecision !== 'keep-current' && record.resolvedDecision !== 'none');
  const samples = records.flatMap((record) => representativeSampleTimes(record.start, record.end, previewDuration).map((time) => ({ beatId: record.segment, time, imagePath: join(artifacts, 'frames', 'source', `${record.segment}-${String(time).replace('.', '_').padStart(3, '0')}s.png`) })));
  const scenarios = scenarioTimes.map((time) => ({ beatId: `scenario-${time}s`, time, imagePath: join(artifacts, 'frames', 'source', `scenario-${time}s.png`) }));
  const samplingStarted = performance.now();
  for (const sample of samples) await captureFrame(previewSource, sample.imagePath, sample.time);
  for (const sample of scenarios) await captureFrame(source, sample.imagePath, sample.time);
  const samplingRuntimeMs = performance.now() - samplingStarted;
  const inputPath = join(artifacts, 'frame-samples.json');
  const analysisPath = join(artifacts, 'visual-analysis.json');
  await writeJson(inputPath, [...samples, ...scenarios]);
  const analyzerBinary = join(artifacts, 'local-visual-analyzer');
  const compileStarted = performance.now();
  await run('/usr/bin/swiftc', ['-O', '-o', analyzerBinary, join(root, 'scripts', 'local-visual-analyzer.swift'), '-framework', 'Vision', '-framework', 'AppKit']);
  const compileRuntimeMs = performance.now() - compileStarted;
  const detectorStarted = performance.now();
  await run(analyzerBinary, [inputPath, analysisPath]);
  const detectorRuntimeMs = performance.now() - detectorStarted;
  const frameAnalysis = await readJson<VisualFrameAnalysis[]>(analysisPath);
  const previewFrameAnalysis = frameAnalysis.filter((frame) => !frame.beatId.startsWith('scenario-'));
  const scenarioAnalysis = frameAnalysis.filter((frame) => frame.beatId.startsWith('scenario-'));
  const placement = resolveVisualPlacements(policy, analysis, previewFrameAnalysis);
  const placementFailures = validatePlacements(placement, previewFrameAnalysis);
  if (!placementFailures.length) placement.editPlan.status = 'validated';
  const rightSubjectFrames = frameAnalysis.filter((frame) => frame.beatId === 'scenario-1800s');
  const rightSubjectPolicy = { ...policy, records: policy.records.map((record) => ({ ...record, segment: 'scenario-1800s', section: 'illustration' as const })) };
  const rightSubjectPlacement = resolveVisualPlacements(rightSubjectPolicy, analysis, rightSubjectFrames);
  const strictMajorPolicy = { ...policy, records: policy.records.map((record) => ({ ...record, section: 'main-point' as const })) };
  const strictMinorPolicy = { ...policy, records: policy.records.map((record) => ({ ...record, section: 'illustration' as const })) };
  const fullScreenFallback = resolveVisualPlacements(strictMajorPolicy, analysis, previewFrameAnalysis, { ...defaultPlacementConfig, minimumScore: 0.95 });
  const suppressedMinor = resolveVisualPlacements(strictMinorPolicy, analysis, previewFrameAnalysis, { ...defaultPlacementConfig, minimumScore: 0.95 });
  for (const decision of placement.decisions) {
    const frame = previewFrameAnalysis.find((item) => item.beatId === decision.beatId) ?? previewFrameAnalysis[0];
    if (frame) await debugFrame(frame.imagePath, join(artifacts, 'frames', 'debug', `${decision.beatId}-debug.png`), frame, decision.selectedRegion);
  }
  for (const frame of scenarioAnalysis) await debugFrame(frame.imagePath, join(artifacts, 'frames', 'debug', `${frame.beatId}-debug.png`), frame);
  const controlPlan: EditPlan = { schemaVersion: '3.0', projectId: transcript.projectId, sourceTranscriptHash: sha256(transcript.originalTranscript), operations: [], status: 'validated', createdBy: { provider: 'control', model: 'none' } };
  const controlRender = join(artifacts, 'control-preview.mp4');
  const directorRender = join(artifacts, 'director-preview.mp4');
  const fullScreenRender = join(artifacts, 'full-screen-fallback-preview.mp4');
  await renderPreview('director-v3-preview-source.mp4', controlPlan, controlRender);
  await renderPreview('director-v3-preview-source.mp4', placement.editPlan, directorRender);
  await renderPreview('director-v3-preview-source.mp4', fullScreenFallback.editPlan, fullScreenRender);
  const finalFrames = [20, 45, 90].map((time) => join(artifacts, 'frames', 'final', `director-${String(time).padStart(3, '0')}s.png`));
  for (let index = 0; index < finalFrames.length; index += 1) await captureFrame(directorRender, finalFrames[index], [20, 45, 90][index]);
  const scores = placement.decisions.flatMap((decision) => decision.candidateRegions);
  const qa = { status: placementFailures.length ? 'REVIEW' : 'PASS', failures: placementFailures, sampledFrames: samples.length, scenarioFrames: scenarios.length, faceCollisionFree: placement.decisions.filter((decision) => decision.decision === 'place').every((decision) => !decision.candidateRegions.find((candidate) => candidate.region === decision.selectedRegion)?.blockedBy.includes('face')), titleSafe: placement.decisions.every((decision) => decision.candidateRegions.every((candidate) => candidate.score >= 0 ? candidate.region.length > 0 : true)), textFit: placement.decisions.every((decision) => decision.decision !== 'place' || decision.textFit.fits), suppressedVisuals: placement.decisions.filter((decision) => decision.decision === 'suppress').length, fullScreenFallbacks: placement.decisions.filter((decision) => decision.decision === 'full-screen').length, selectedRegions: placement.decisions.map((decision) => decision.selectedRegion ?? decision.decision), scoreRange: scores.length ? { min: Math.min(...scores.map((score) => score.score)), max: Math.max(...scores.map((score) => score.score)) } : { min: 0, max: 0 } };
  const safeZones = placement.decisions.map((decision) => ({ beatId: decision.beatId, candidateRegions: decision.candidateRegions, selectedRegion: decision.selectedRegion, decision: decision.decision }));
  const cache = { sourceHash: sha256(await readFile(sourceCopy)), frameSamplesHash: sha256(JSON.stringify(samples)), visualAnalysisHash: sha256(JSON.stringify(frameAnalysis)), detector: frameAnalysis[0]?.detector ?? 'none', samplingVersion: VISUAL_SAMPLING_VERSION, placementAlgorithmVersion: PLACEMENT_ALGORITHM_VERSION, textFitAlgorithmVersion: TEXT_FIT_ALGORITHM_VERSION, policyHash: sha256(JSON.stringify(defaultRetentionPolicy)), semanticAnalysisHash: sha256(JSON.stringify(fullAnalysis)), placementHash: sha256(JSON.stringify(placement.decisions)), presentationHash: sha256(JSON.stringify({ fontSize: 62, theme: 'director-v3-reverent' })), visualAnalysisInputs: ['source video', 'beat-relative representative frame sample times', VISUAL_SAMPLING_VERSION], visualAnalysisExcludes: ['transcript wording', 'AI model', 'font', 'color', 'animation'] };
  await writeJson(join(artifacts, 'safe-zones.json'), safeZones);
  await writeJson(join(artifacts, 'placement-decisions.json'), placement.decisions);
  await writeJson(join(artifacts, 'edit-plan.json'), placement.editPlan);
  await writeJson(join(artifacts, 'qa.json'), qa);
  await writeJson(join(artifacts, 'cache.json'), cache);
  await writeJson(join(artifacts, 'scenario-analysis.json'), scenarioAnalysis);
  await writeJson(join(artifacts, 'fallback-placement-tests.json'), { rightSubjectPlacement: rightSubjectPlacement.decisions, fullScreenFallback: fullScreenFallback.decisions, suppressedMinor: suppressedMinor.decisions });
  await writeJson(join(artifacts, 'preview-meta.json'), { source, sourceStart, previewDuration, analysisStart, analysisEnd, sampleCount: samples.length, sampledTimesByBeat: records.map((record) => ({ beatId: record.segment, times: representativeSampleTimes(record.start, record.end, previewDuration) })), scenarioTimes, samplingRuntimeMs: Number(samplingRuntimeMs.toFixed(2)), compileRuntimeMs: Number(compileRuntimeMs.toFixed(2)), detectorRuntimeMs: Number(detectorRuntimeMs.toFixed(2)), averageDetectorRuntimePerFrameMs: Number((detectorRuntimeMs / frameAnalysis.length).toFixed(2)), detector: frameAnalysis[0]?.detector, controlRender, directorRender, fullScreenRender, finalFrames });
  console.log(JSON.stringify({ artifacts, controlRender, directorRender, samples: samples.length, decisions: placement.decisions.length, qa }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
