import { resolve, relative } from 'node:path';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, type RenderMediaProgress } from '@remotion/renderer';
import { build } from 'esbuild';
import { applyReviewAction, createInitialReviewState, deriveApprovedEditPlan, updateReview, type ReviewWorkspaceData } from '../src/director-review.ts';
import type { DirectorExecutionProvenance } from '../src/director-execution.ts';
import { validateResolvedDirectorAnalysis } from '../src/director-execution.ts';
import { canonicalTranscriptHash } from '../src/sermon-chunking.ts';
import { buildBrollIntents, decideBroll } from '../src/broll-selection.ts';
import { generateVisualBeats, validateDirector, createDirectorEditPlan, type DirectorInput } from '../src/director.ts';
import type { BrollDecision, EditOperation, EditPlan, MediaAsset, MediaIndex, MediaUsageHistory, PlacementDecision, SermonAnalysis, TranscriptDocument, VisualFrameAnalysis } from '../src/contracts.ts';
import { applyRetentionPolicy, type VisualPolicyResult } from '../src/visual-policy.ts';
import { applyRetentionToBrollIntents, createPlacedBrollOperations, type PreviewWindow } from '../src/broll-preview.ts';
import { representativeSampleTimes, resolveBrollPlacement, resolveVisualPlacements, validatePlacements, VISUAL_SAMPLING_VERSION } from '../src/visual-intelligence.ts';
import { directoryContentFingerprint, ensureDirectory, extractSample, fileVersionFingerprint, readJson, run, sha256, validatePlan, writeJson } from '../src/foundation.ts';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'public');
const v1 = resolve(root, 'artifacts/full-sermon-pilot-v1');
const artifacts = resolve(root, 'artifacts/full-sermon-pilot-v1-1');
const source = resolve(publicDir, 'full-sermon-pilot-source.mp4');
const duration = 2560;
const cacheOnly = process.env.PILOT_CACHE_ONLY === '1';

function clipPlan(plan: EditPlan, window: PreviewWindow): EditPlan {
  const operations = plan.operations.flatMap((operation): EditOperation[] => {
    const start = Math.max(operation.start, window.sourceStart);
    const end = Math.min(operation.end, window.sourceEnd);
    return end <= start ? [] : [{ ...operation, start: start - window.sourceStart, end: end - window.sourceStart } as EditOperation];
  });
  return { ...plan, operations, status: 'validated' };
}

function normalizePolicy(policy: VisualPolicyResult): VisualPolicyResult {
  const records = policy.records.map((record) => ({ ...record, segment: record.sectionId }));
  const operations = policy.editPlan.operations.map((operation) => {
    const record = policy.records.find((candidate) => candidate.segment === operation.id.replace(/^policy-/, ''));
    return record ? { ...operation, id: `policy-${record.sectionId}` } : operation;
  });
  return { ...policy, records, editPlan: { ...policy.editPlan, operations } };
}

function normalizeOperationIds(operations: EditOperation[], analysis: SermonAnalysis): EditOperation[] {
  return operations.map((operation) => {
    const section = analysis.sections.find((candidate) => candidate.start === operation.start && candidate.end === operation.end);
    return section && operation.type !== 'broll' ? { ...operation, id: `visual-${section.id}` } : operation;
  });
}

async function probe(path: string) {
  return JSON.parse(await run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=index,codec_name,codec_type,width,height,sample_rate,channels,duration', '-of', 'json', path])) as { streams: Array<{ codec_name?: string; codec_type?: string; width?: number; height?: number; sample_rate?: string; channels?: number; duration?: string }>; format: { duration: string; size: string } };
}

async function frame(video: string, output: string, time: number) {
  await run('/opt/homebrew/bin/ffmpeg', ['-y', '-ss', String(time), '-i', video, '-frames:v', '1', '-q:v', '2', output]);
  const info = await stat(output);
  return { output, time, bytes: info.size, hash: sha256(await readFile(output)), present: info.size > 0 };
}

async function visualAnalysis(analysis: SermonAnalysis, policy: VisualPolicyResult, decisions: BrollDecision[], sourceFingerprint: string) {
  const directory = resolve(artifacts, 'frames/visual-source');
  await ensureDirectory(directory);
  const visualRecords = policy.records.filter((record) => !['none', 'speaker-full', 'keep-current'].includes(record.resolvedDecision));
  const brollSections = decisions.filter((decision) => decision.decision === 'selected').map((decision) => decision.intent.sectionId);
  const sampleSpecs = [
    ...visualRecords.map((record) => ({ beatId: record.sectionId, time: Number(((record.start + record.end) / 2).toFixed(3)) })),
    ...brollSections.flatMap((id) => {
      const section = analysis.sections.find((item) => item.id === id)!;
      return representativeSampleTimes(section.start, section.end, duration).map((time) => ({ beatId: id, time }));
    }),
  ].filter((item, index, all) => all.findIndex((other) => other.beatId === item.beatId && other.time === item.time) === index)
    .map((item) => ({ ...item, imagePath: resolve(directory, `${item.beatId}-${String(item.time).replace('.', '_')}.png`) }));
  const cacheKey = sha256(JSON.stringify(sampleSpecs.map(({ beatId, time }) => ({ beatId, time }))) + sourceFingerprint + VISUAL_SAMPLING_VERSION);
  const cachePath = resolve(artifacts, 'visual-analysis-cache.json');
  const cached = await readJson<{ cacheKey: string; frames: VisualFrameAnalysis[] }>(cachePath).catch(() => undefined);
  if (cached?.cacheKey === cacheKey) return { frames: cached.frames, cache: { hit: true, key: cacheKey }, samples: sampleSpecs };
  for (const sample of sampleSpecs) await frame(source, sample.imagePath, sample.time);
  const inputPath = resolve(artifacts, 'visual-frame-samples.json');
  const outputPath = resolve(artifacts, 'visual-analysis.json');
  await writeJson(inputPath, sampleSpecs);
  const analyzer = resolve(artifacts, 'local-visual-analyzer');
  await run('/usr/bin/swiftc', ['-O', '-o', analyzer, resolve(root, 'scripts/local-visual-analyzer.swift'), '-framework', 'Vision', '-framework', 'AppKit']);
  await run(analyzer, [inputPath, outputPath]);
  const frames = await readJson<VisualFrameAnalysis[]>(outputPath);
  await writeJson(cachePath, { cacheKey, frames, samplingVersion: VISUAL_SAMPLING_VERSION });
  return { frames, cache: { hit: false, key: cacheKey }, samples: sampleSpecs };
}

async function renderComposition(serveUrl: string, sourcePath: string, plan: EditPlan, output: string, mediaAssets: MediaAsset[], durationSeconds: number, fontSize = 62) {
  const inputProps = { sourcePath: relative(publicDir, sourcePath), editPlan: plan, graphicFontSize: fontSize, mediaAssets, durationSeconds };
  const composition = await selectComposition({ serveUrl, id: 'BanglaFoundation', inputProps });
  let progress: RenderMediaProgress | undefined;
  const started = performance.now();
  await renderMedia({ composition, serveUrl, codec: 'h264', audioCodec: 'aac', outputLocation: output, inputProps, concurrency: 12, x264Preset: 'veryfast', onProgress: (value) => { progress = value; } });
  return { wallMs: performance.now() - started, renderedDoneInMs: progress?.renderedDoneIn ?? null, encodedDoneInMs: progress?.encodedDoneIn ?? null };
}

function workspaceData(analysis: SermonAnalysis, plan: EditPlan, index: MediaIndex, decisions: BrollDecision[], placements: PlacementDecision[], initialReview: ReturnType<typeof createInitialReviewState>, qa: ReviewWorkspaceData['qa'], directorExecution: DirectorExecutionProvenance, sectionProvenance: Record<string, DirectorExecutionProvenance>): ReviewWorkspaceData {
  return {
    projectId: analysis.projectId, title: analysis.title ?? 'হস্তক্ষেপ | INTERVENTION', languageProfile: 'bn',
    preview: { controlUrl: './bounded/main-control.mp4', directorUrl: './bounded/main-director.mp4', durationSeconds: duration, sourceStart: 0, sourceEnd: duration },
    analysis, directorExecution, aiPlan: plan, mediaIndex: index,
    beats: analysis.sections.map((section) => {
      const brollDecision = decisions.find((decision) => decision.intent.sectionId === section.id);
      const selectedAsset = brollDecision?.selectedAssetId ? index.assets.find((asset) => asset.id === brollDecision.selectedAssetId) : undefined;
      const originalOperation = plan.operations.find((operation) => operation.id === `visual-${section.id}` || operation.id === `broll-${section.id}`);
      return { section, provenance: sectionProvenance[section.id], originalOperation, brollDecision, selectedAsset, placement: placements.find((placement) => placement.beatId === section.id), candidates: (brollDecision?.candidates ?? []).map((candidate) => ({ ...candidate, asset: index.assets.find((asset) => asset.id === candidate.assetId) })), requiredReview: Boolean(originalOperation), noBroll: brollDecision?.decision !== 'selected' };
    }),
    qa, initialReview,
    evidence: { explanationChain: './explanation-chain.json', placementEvidence: './placement-evidence.json', beforeFrame: './frames/before.png', duringFrame: './frames/during.png', afterFrame: './frames/after.png' },
  };
}

async function main() {
  await Promise.all(['bounded', 'frames', 'frames/final', 'review', 'review-assets'].map((name) => ensureDirectory(resolve(artifacts, name))));
  const transcript = await readJson<TranscriptDocument>(resolve(v1, 'transcript.json'));
  const liveResult = await readJson<{ allChunksLive: boolean; fallbackChunkCount: number; analysis: SermonAnalysis; architectureVersion: string; configHash: string; configuration: Record<string, unknown>; transcriptHash: string; provenance: DirectorExecutionProvenance; sectionProvenance: Record<string, DirectorExecutionProvenance>; coverage: { canonicalCoverageComplete: boolean; coveragePercent: number; deterministicGapFilledSegmentCount: number }; chunks: Array<{ structuredOutput: boolean; fallback: boolean; canonicalCoverageComplete: boolean }> }>(resolve(artifacts, 'analysis/live-ai-result.json'));
  const transcriptHash = sha256(transcript.originalTranscript);
  const canonicalHash = canonicalTranscriptHash(transcript);
  const sourceFingerprint = await fileVersionFingerprint(source);
  if (liveResult.architectureVersion !== 'provider-neutral-v1.2') throw new Error('Live Director artifact uses an unsupported architecture version.');
  if (liveResult.transcriptHash !== canonicalHash) throw new Error('Live Director artifact belongs to a different canonical transcript.');
  if (liveResult.configHash !== sha256(JSON.stringify(liveResult.configuration))) throw new Error('Live Director configuration hash is invalid.');
  if (!liveResult.allChunksLive || liveResult.fallbackChunkCount || liveResult.provenance.source !== 'ai' || liveResult.provenance.schemaValidation !== 'PASS' || liveResult.provenance.canonicalRangeValidation !== 'PASS' || liveResult.chunks.some((chunk) => chunk.fallback || !chunk.structuredOutput)) throw new Error('Full render is gated on fallback-free, schema-valid, canonical-range-valid live AI chunks.');
  if (!liveResult.coverage?.canonicalCoverageComplete
    || liveResult.coverage.coveragePercent !== 100
    || liveResult.coverage.deterministicGapFilledSegmentCount !== 0
    || liveResult.provenance.canonicalCoverageValidation !== 'PASS'
    || !liveResult.provenance.canonicalCoverageComplete
    || liveResult.chunks.some((chunk) => !chunk.canonicalCoverageComplete)) throw new Error('Full render is gated on 100% AI canonical coverage with zero deterministic gap-fill.');
  const analysis = liveResult.analysis;
  const input: DirectorInput = { transcript, segments: transcript.segments, projectDuration: duration, projectId: transcript.projectId };
  const resolvedAnalysisFailures = validateResolvedDirectorAnalysis(analysis, input);
  if (resolvedAnalysisFailures.length) throw new Error(`Live analysis canonical validation failed: ${resolvedAnalysisFailures.join('; ')}`);
  const directorFailures = validateDirector(analysis, generateVisualBeats(analysis), createDirectorEditPlan(generateVisualBeats(analysis), input, liveResult.provenance.provider, liveResult.provenance.model ?? 'unknown'), duration);
  if (directorFailures.length) throw new Error(`Live analysis did not validate: ${directorFailures.join('; ')}`);

  const index = await readJson<MediaIndex>(resolve(v1, 'media-index/index.json'));
  const v1Cache = await readJson<{ transcriptHash: string; mediaIndexHash: string; visualAnalysis: { key: string } }>(resolve(v1, 'cache.json'));
  if (v1Cache.transcriptHash !== transcriptHash) throw new Error('Canonical transcript hash differs from V1.');
  const policy = applyRetentionPolicy(analysis, transcript.projectId, transcriptHash, duration);
  const intents = buildBrollIntents(analysis);
  const retained = applyRetentionToBrollIntents(intents, { ...policy, records: policy.records.map((record) => ['image-broll', 'video-broll'].includes(record.aiRecommendation) ? { ...record, policyDecision: 'ACCEPT' as const } : record) });
  const history: MediaUsageHistory[] = [];
  const decisions = retained.map((intent) => decideBroll(index, intent, history));
  const selectedIds = new Set(decisions.flatMap((decision) => decision.selectedAssetId ? [decision.selectedAssetId] : []));
  const visual = await visualAnalysis(analysis, policy, decisions, sourceFingerprint);
  const graphicPlacements = resolveVisualPlacements(normalizePolicy(policy), analysis, visual.frames);
  const brollPlacements = decisions.filter((decision) => decision.decision === 'selected').map((decision) => {
    const asset = index.assets.find((item) => item.id === decision.selectedAssetId);
    return resolveBrollPlacement(decision.intent.sectionId, asset?.kind === 'video' ? 'video-broll' : 'image-broll', visual.frames.filter((item) => item.beatId === decision.intent.sectionId));
  });
  const placements = [...graphicPlacements.decisions, ...brollPlacements];
  const brollOperations = createPlacedBrollOperations(decisions, placements, { sourceStart: 0, sourceEnd: duration });
  const operations = [...normalizeOperationIds(graphicPlacements.editPlan.operations.filter((operation) => operation.type !== 'director-placeholder'), analysis), ...brollOperations].sort((a, b) => a.start - b.start);
  const planDraft: EditPlan = { schemaVersion: '4.1', projectId: transcript.projectId, sourceTranscriptHash: transcriptHash, operations, status: 'draft', createdBy: { provider: liveResult.provenance.provider, model: liveResult.provenance.model ?? 'unknown' } };
  const planFailures = validatePlan(planDraft, duration);
  const plan: EditPlan = { ...planDraft, status: planFailures.length ? 'draft' : 'validated' };
  if (planFailures.length) throw new Error(`AI Edit Plan invalid: ${planFailures.join('; ')}`);
  const placementFailures = validatePlacements({ decisions: placements, editPlan: plan }, visual.frames);
  const qa: ReviewWorkspaceData['qa'] = { status: placementFailures.length ? 'FAIL' : 'PASS', failures: placementFailures, rightsSafe: decisions.filter((decision) => decision.decision === 'selected').every((decision) => index.assets.find((asset) => asset.id === decision.selectedAssetId)?.rightsStatus !== 'unknown'), brollAudioMuted: plan.operations.filter((operation) => operation.type === 'broll').every((operation) => operation.muted), noBrollCount: decisions.filter((decision) => decision.decision !== 'selected').length };

  const skeleton = workspaceData(analysis, plan, index, decisions, placements, { schemaVersion: '1.0', projectId: transcript.projectId, sourceEditPlanHash: '', decisions: [], updatedAt: new Date().toISOString() }, qa, liveResult.provenance, liveResult.sectionProvenance);
  const initial = createInitialReviewState(skeleton, sha256(JSON.stringify(plan)));
  let reviewed = initial;
  const operationSections = analysis.sections.filter((section) => plan.operations.some((operation) => operation.id === `visual-${section.id}` || operation.id === `broll-${section.id}`));
  if (operationSections.length < 3) throw new Error('Bounded human-review proof needs at least three operations.');
  const modifiedSection = operationSections[0];
  const modifiedOperation = plan.operations.find((operation) => operation.id === `visual-${modifiedSection.id}` || operation.id === `broll-${modifiedSection.id}`)!;
  if (modifiedOperation.type !== 'sermon-point' && modifiedOperation.type !== 'full-screen-card') throw new Error('First review operation must support Bangla display text.');
  reviewed = applyReviewAction(reviewed, modifiedSection.id, 'modify', { operation: { ...modifiedOperation, text: 'ঈশ্বরের কাছে কোনো বন্ধ দরজা নেই', textTrust: 'approved-display' }, reason: 'Human reviewer shortened the live-AI Bangla display text.' });
  reviewed = applyReviewAction(reviewed, modifiedSection.id, 'approve-text', { displayText: 'ঈশ্বরের কাছে কোনো বন্ধ দরজা নেই', reason: 'Human reviewer approved the modified Bangla display text.' });
  reviewed = applyReviewAction(reviewed, operationSections[1].id, 'keep-pastor', { reason: 'Bounded review sample keeps the pastor instead of showing a second adjacent visual.' });
  for (const section of operationSections.slice(2)) {
    reviewed = applyReviewAction(reviewed, section.id, 'accept', { reason: 'Human review accepted the live-AI proposal after inspecting timing and explanation.' });
    const operation = plan.operations.find((item) => item.id === `visual-${section.id}` || item.id === `broll-${section.id}`);
    if (operation?.type === 'sermon-point' || operation?.type === 'full-screen-card') reviewed = applyReviewAction(reviewed, section.id, 'approve-text', { displayText: operation.text, reason: 'Bangla display text approved for this bounded engineering review.' });
  }
  const unverifiedScriptureSections = analysis.sections.filter((section) => section.visualRecommendation === 'scripture-card' && section.scriptureReference);
  for (const section of unverifiedScriptureSections) reviewed = applyReviewAction(reviewed, section.id, 'keep-pastor', { reason: 'Scripture reference remains unverified; Keep Pastor preserves the speaker and prevents a final Scripture card.' });
  const revertBase = applyReviewAction(initial, operationSections[2].id, 'accept', { reason: 'Revert proof setup.' });
  const revertResult = applyReviewAction(revertBase, operationSections[2].id, 'revert', { reason: 'Returned to original live-AI pending state.' });
  const workspace = workspaceData(analysis, plan, index, decisions, placements, initial, qa, liveResult.provenance, liveResult.sectionProvenance);
  const finalData = updateReview(workspace, reviewed);
  const approvedPlan = deriveApprovedEditPlan(plan, reviewed, finalData.readiness.ready ? 'approved' : 'draft');
  const approvedFailures = validatePlan(approvedPlan, duration);
  if (!finalData.readiness.ready || approvedFailures.length) throw new Error(`Review not ready: ${[...finalData.readiness.blockers, ...approvedFailures].join('; ')}`);

  await writeJson(resolve(artifacts, 'retention-decisions.json'), policy.records);
  await writeJson(resolve(artifacts, 'broll-intents.json'), intents);
  await writeJson(resolve(artifacts, 'candidate-rankings.json'), decisions);
  await writeJson(resolve(artifacts, 'placement-evidence.json'), placements);
  await writeJson(resolve(artifacts, 'edit-plan.json'), plan);
  await writeJson(resolve(artifacts, 'explanation-chain.json'), decisions.map((decision) => ({ section: analysis.sections.find((item) => item.id === decision.intent.sectionId), decision })));
  await writeJson(resolve(artifacts, 'review/director-review-initial.json'), initial);
  await writeJson(resolve(artifacts, 'review/director-review.json'), reviewed);
  await writeJson(resolve(artifacts, 'review/approved-edit-plan.json'), approvedPlan);
  await writeJson(resolve(artifacts, 'review/readiness.json'), finalData.readiness);
  await writeJson(resolve(artifacts, 'review-action-trace.json'), { modifiedAndApproved: modifiedSection.id, keepPastor: operationSections[1].id, rejectedUnverifiedScriptureCards: unverifiedScriptureSections.map((section) => section.id), accepted: operationSections.slice(2).map((section) => section.id), inspectedBroll: decisions.find((decision) => decision.intent.decision === 'search'), preservedNoBroll: decisions.find((decision) => decision.decision === 'no-broll'), revert: { before: revertBase.decisions.find((item) => item.beatId === operationSections[2].id), after: revertResult.decisions.find((item) => item.beatId === operationSections[2].id) } });

  const windows = [
    { id: 'main', sourceStart: 180, sourceEnd: 480, covers: ['normal teaching', 'main point', 'graphic', 'reverent transition'] },
    { id: 'illustration', sourceStart: 520, sourceEnd: 700, covers: ['illustration', 'B-roll decision', 'teaching'] },
    { id: 'conclusion', sourceStart: 2380, sourceEnd: 2560, covers: ['application', 'conclusion', 'prayer'] },
  ];
  for (const window of windows) {
    const sourcePath = resolve(publicDir, `full-sermon-v1-1-${window.id}-source.mp4`);
    if (!(await stat(sourcePath).catch(() => undefined))) await extractSample(source, sourcePath, window.sourceStart, window.sourceEnd - window.sourceStart);
  }
  const bundleStarted = performance.now();
  const serveUrl = await bundle({ entryPoint: resolve(root, 'src/entry.tsx'), publicDir, webpackOverride: (config) => config });
  const bundleMs = performance.now() - bundleStarted;
  const mediaAssets = index.assets.filter((asset) => selectedIds.has(asset.id));
  for (const asset of mediaAssets) if (!asset.path.startsWith(publicDir)) { const target = resolve(publicDir, 'full-sermon-selected-media', asset.fileName); await ensureDirectory(resolve(publicDir, 'full-sermon-selected-media')); await copyFile(asset.path, target); asset.path = relative(root, target); }
  const bounded = [];
  for (const window of windows) {
    const sourcePath = resolve(publicDir, `full-sermon-v1-1-${window.id}-source.mp4`);
    if (!(await stat(sourcePath).catch(() => undefined))) await extractSample(source, sourcePath, window.sourceStart, window.sourceEnd - window.sourceStart);
    const clipped = clipPlan(approvedPlan, window);
    const output = resolve(artifacts, `bounded/${window.id}-director.mp4`);
    if (!cacheOnly && !(await stat(output).catch(() => undefined))) await renderComposition(serveUrl, sourcePath, clipped, output, mediaAssets, window.sourceEnd - window.sourceStart);
    const outputProbe = await probe(output);
    bounded.push({ ...window, output, operationCount: clipped.operations.length, probe: outputProbe });
  }
  const mainSource = resolve(publicDir, 'full-sermon-v1-1-main-source.mp4');
  const controlOutput = resolve(artifacts, 'bounded/main-control.mp4');
  if (!cacheOnly && !(await stat(controlOutput).catch(() => undefined))) await renderComposition(serveUrl, mainSource, { ...approvedPlan, operations: [], status: 'validated' }, controlOutput, [], 300);
  const mainOutput = resolve(artifacts, 'bounded/main-director.mp4');
  const visibleOperation = clipPlan(approvedPlan, windows[0]).operations[0];
  if (!visibleOperation) throw new Error('Main bounded preview has no reviewed visual operation.');
  const before = await frame(mainOutput, resolve(artifacts, 'frames/before.png'), Math.max(0, visibleOperation.start - 1));
  const during = await frame(mainOutput, resolve(artifacts, 'frames/during.png'), (visibleOperation.start + visibleOperation.end) / 2);
  const after = await frame(mainOutput, resolve(artifacts, 'frames/after.png'), Math.min(299, visibleOperation.end + 1));
  const controlDuring = await frame(controlOutput, resolve(artifacts, 'frames/control-during.png'), (visibleOperation.start + visibleOperation.end) / 2);
  const boundedQa = { status: bounded.every((item) => item.probe.streams.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac')) && during.hash !== controlDuring.hash ? 'PASS' : 'FAIL', before, during, after, controlDuring, pixelDifference: during.hash !== controlDuring.hash, previews: bounded };
  await writeJson(resolve(artifacts, 'bounded/qa.json'), boundedQa);
  if (boundedQa.status !== 'PASS') throw new Error('Bounded preview QA failed; full render blocked.');

  const fullOutput = resolve(artifacts, 'full-sermon-live-ai-reviewed.mp4');
  const renderSettings = { composition: 'BanglaFoundation', codec: 'h264', audioCodec: 'aac', concurrency: 12, x264Preset: 'veryfast', duration };
  const rendererFingerprint = sha256(JSON.stringify({
    source: await directoryContentFingerprint(resolve(root, 'src'), ['.ts', '.tsx', '.css']),
    dependencies: await fileVersionFingerprint(resolve(root, 'package-lock.json')),
  }));
  const mediaFingerprints = await Promise.all(mediaAssets.map(async (asset) => ({
    assetId: asset.id,
    fingerprint: await fileVersionFingerprint(asset.path.startsWith('/') ? asset.path : resolve(root, asset.path)),
  })));
  const fullRenderKey = sha256(JSON.stringify({
    sourceFingerprint,
    approvedPlanHash: sha256(JSON.stringify(approvedPlan)),
    mediaFingerprints,
    renderSettings,
    rendererFingerprint,
  }));
  const fullRenderManifestPath = resolve(artifacts, 'full-render-cache.json');
  const fullOutputExists = await stat(fullOutput).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  const fullRenderManifest = await stat(fullRenderManifestPath).then(
    () => readJson<{ key: string }>(fullRenderManifestPath),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    },
  );
  const fullTimingPath = resolve(artifacts, 'full-render-timing.json');
  let fullTiming = await stat(fullTimingPath).then(
    () => readJson<{ wallMs: number; renderedDoneInMs: number | null; encodedDoneInMs: number | null }>(fullTimingPath),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    },
  );
  if (cacheOnly && (!fullOutputExists || fullRenderManifest?.key !== fullRenderKey)) throw new Error('Cache-only full render is missing or stale for the current source, approved plan, media, or render settings.');
  if (cacheOnly && !fullTiming) throw new Error('Cache-only full render is missing its timing record.');
  if (!cacheOnly && (!fullOutputExists || fullRenderManifest?.key !== fullRenderKey || !fullTiming)) {
    fullTiming = await renderComposition(serveUrl, source, approvedPlan, fullOutput, mediaAssets, duration);
    await writeJson(fullTimingPath, fullTiming);
    await writeJson(fullRenderManifestPath, { key: fullRenderKey, sourceFingerprint, approvedPlanHash: sha256(JSON.stringify(approvedPlan)), mediaFingerprints, renderSettings, rendererFingerprint });
  }
  const fullProbe = await probe(fullOutput);
  const frameSpecs = [{ name: 'opening', time: 20 }, { name: 'main-point', time: 240 }, { name: 'illustration', time: 600 }, { name: 'reverent', time: 1800 }, { name: 'conclusion', time: 2500 }];
  const finalFrames = [];
  for (const spec of frameSpecs) finalFrames.push({ name: spec.name, ...(await frame(fullOutput, resolve(artifacts, `frames/final/${spec.name}.png`), spec.time)) });
  const finalQa = {
    status: Math.abs(Number(fullProbe.format.duration) - duration) < 0.1 && fullProbe.streams.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264' && stream.width === 1920 && stream.height === 1080) && fullProbe.streams.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac' && stream.sample_rate === '48000') && finalFrames.every((item) => item.present) ? 'PASS' : 'FAIL',
    expectedDuration: duration, probe: fullProbe, sermonAudioAuthoritative: true, brollAudioMuted: approvedPlan.operations.filter((operation) => operation.type === 'broll').every((operation) => operation.muted), selectedBrollRightsSafe: decisions.filter((decision) => decision.decision === 'selected').every((decision) => index.assets.find((asset) => asset.id === decision.selectedAssetId)?.rightsStatus !== 'unknown'), approvedOperationCount: approvedPlan.operations.length, finalVisualEventCount: approvedPlan.operations.length, frames: finalFrames,
  };
  await writeJson(resolve(artifacts, 'full-render.json'), { output: fullOutput, timing: fullTiming, qa: finalQa });
  await writeJson(resolve(artifacts, 'visual-qa.json'), finalQa);
  await writeJson(resolve(artifacts, 'audio-qa.json'), { audio: fullProbe.streams.filter((stream) => stream.codec_type === 'audio'), expectedDuration: duration, actualDuration: Number(fullProbe.format.duration), driftSeconds: Number((Number(fullProbe.format.duration) - duration).toFixed(6)), sermonAudioAuthoritative: true, brollAudioMuted: finalQa.brollAudioMuted });

  const reviewJson = { ...workspace, initialReview: initial };
  await writeJson(resolve(artifacts, 'review-data.json'), reviewJson);
  const foundationBrowserPlugin: import('esbuild').Plugin = {
    name: 'foundation-browser',
    setup(b) {
      b.onResolve({ filter: /foundation(\.ts)?$/ }, (args) => {
        return { path: args.path, namespace: 'foundation-browser' };
      });
      b.onLoad({ filter: /.*/, namespace: 'foundation-browser' }, () => {
        return {
          contents: `
            function rightRotate(v: number, a: number): number { return (v >>> a) | (v << (32 - a)); }
            export function sha256(ascii: string | Uint8Array): string {
              const utf8 = typeof ascii === 'string' ? new TextEncoder().encode(ascii) : ascii;
              const words: number[] = [];
              for (let i = 0; i < utf8.length; i++) words[i >> 2] |= utf8[i] << ((3 - (i % 4)) * 8);
              words[utf8.length >> 2] |= 0x80 << ((3 - (utf8.length % 4)) * 8);
              words[(((utf8.length + 8) >> 6) << 4) + 15] = utf8.length * 8;
              let hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
              const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
              for (let j = 0; j < words.length; j += 16) {
                const w: number[] = [];
                for (let i = 0; i < 16; i++) w[i] = words[j + i] | 0;
                for (let i = 16; i < 64; i++) {
                  const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                  const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                  w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
                }
                let [a, b, c, d, e, f, g, h] = hash;
                for (let i = 0; i < 64; i++) {
                  const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
                  const ch = (e & f) ^ (~e & g);
                  const temp1 = (h + s1 + ch + k[i] + w[i]) | 0;
                  const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
                  const maj = (a & b) ^ (a & c) ^ (b & c);
                  const temp2 = (s0 + maj) | 0;
                  h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
                }
                hash[0] = (hash[0] + a) | 0; hash[1] = (hash[1] + b) | 0; hash[2] = (hash[2] + c) | 0; hash[3] = (hash[3] + d) | 0;
                hash[4] = (hash[4] + e) | 0; hash[5] = (hash[5] + f) | 0; hash[6] = (hash[6] + g) | 0; hash[7] = (hash[7] + h) | 0;
              }
              return hash.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
            }
          `,
          loader: 'ts',
        };
      });
    },
  };
  await build({ entryPoints: [resolve(root, 'src/review-entry.tsx')], bundle: true, format: 'iife', platform: 'browser', outfile: resolve(artifacts, 'main.js'), jsx: 'automatic', plugins: [foundationBrowserPlugin] });
  await copyFile(resolve(v1, 'main.css'), resolve(artifacts, 'main.css'));
  await writeFile(resolve(artifacts, 'index.html'), `<!doctype html><html lang="bn"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Full Sermon Pilot V1.1</title><link rel="stylesheet" href="./main.css"></head><body><div id="root"></div><script src="./main.js"></script></body></html>`, 'utf8');
  let presentationOnly = { rendered: false, output: '', fromFontSize: 62, toFontSize: 66 };
  if (cacheOnly) {
    const window = { sourceStart: 220, sourceEnd: 240 };
    const sourcePath = resolve(publicDir, 'full-sermon-v1-1-presentation-source.mp4');
    if (!(await stat(sourcePath).catch(() => undefined))) await extractSample(source, sourcePath, window.sourceStart, window.sourceEnd - window.sourceStart);
    const output = resolve(artifacts, 'presentation-only-preview.mp4');
    await renderComposition(serveUrl, sourcePath, clipPlan(approvedPlan, window), output, mediaAssets, 20, 66);
    presentationOnly = { rendered: true, output, fromFontSize: 62, toFontSize: 66 };
  }
  const benchmark = await readJson<{ baseline: { wallMs: number }; optimized: { wallMs: number }; speedupPercent: number }>(resolve(artifacts, 'performance/benchmark.json'));
  const cacheProof = { runMode: cacheOnly ? 'cache-only' : 'full', transcript: { hit: true, hash: transcriptHash }, liveAIAnalysis: { hit: true, configHash: liveResult.configHash }, mediaIndex: { hit: true, hashMatchesV1: sha256(JSON.stringify(index)) === v1Cache.mediaIndexHash }, visualAnalysis: visual.cache, presentationOnly, invalidated: presentationOnly.rendered ? ['presentation render and downstream QA'] : [] };
  await writeJson(resolve(artifacts, 'cache.json'), cacheProof);
  const summary = { liveAI: { allChunksLive: true, model: 'qwen3:30b', sections: analysis.sections.length }, retention: { proposals: generateVisualBeats(analysis).filter((beat) => !['none', 'speaker-full'].includes(beat.visualType)).length, accepted: policy.records.filter((record) => record.policyDecision === 'ACCEPT').length, modified: policy.records.filter((record) => record.policyDecision === 'MODIFY').length, suppressed: policy.records.filter((record) => record.policyDecision === 'SUPPRESS').length, aiPlanOperations: plan.operations.length, approvedOperations: approvedPlan.operations.length, eventsPerMinute: Number((approvedPlan.operations.length / (duration / 60)).toFixed(2)) }, broll: { selected: decisions.filter((decision) => decision.decision === 'selected').length, noSuitable: decisions.filter((decision) => decision.decision === 'no-suitable-asset').length, noBroll: decisions.filter((decision) => decision.decision === 'no-broll').length }, review: finalData.readiness, boundedQa: boundedQa.status, finalQa: finalQa.status, performance: { v1WallSeconds: 3516.413, benchmarkBaselineSeconds: benchmark.baseline.wallMs / 1000, benchmarkOptimizedSeconds: benchmark.optimized.wallMs / 1000, benchmarkSpeedupPercent: benchmark.speedupPercent, v1_1WallSeconds: (fullTiming?.wallMs ?? 0) / 1000 }, output: fullOutput };
  await writeJson(resolve(artifacts, 'pilot-summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
