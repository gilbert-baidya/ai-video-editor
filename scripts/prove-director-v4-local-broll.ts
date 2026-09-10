import { join, relative, resolve } from 'node:path';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { applyRetentionToBrollIntents, BROLL_PREVIEW_MAPPING_VERSION, createPlacedBrollOperations, mapSourceRangeToPreview, validateBrollPreview, type PreviewWindow } from '../src/broll-preview.ts';
import { buildBrollIntents, decideBroll } from '../src/broll-selection.ts';
import { indexLocalMedia } from '../src/media-library.ts';
import { ensureDirectory, extractSample, readJson, run, sha256, validatePlan, writeJson } from '../src/foundation.ts';
import { PLACEMENT_ALGORITHM_VERSION, representativeSampleTimes, resolveBrollPlacement, TEXT_FIT_ALGORITHM_VERSION, VISUAL_SAMPLING_VERSION } from '../src/visual-intelligence.ts';
import { applyRetentionPolicy, defaultRetentionPolicy } from '../src/visual-policy.ts';
import type { BrollDecision, EditPlan, MediaIndex, MediaLibraryRoot, MediaUsageHistory, PlacementDecision, SermonAnalysis, TranscriptDocument, VisualFrameAnalysis } from '../src/contracts.ts';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'artifacts', 'director-v4-local-broll');
const priorArtifacts = join(root, 'artifacts', 'director-structured-output');
const source = resolve(root, '../../sermonclip-studio/Projects/GOLDEN-E2E---Intervention-Sermon-2/Original/youtube-source.mp4');
const semanticFixtureSourceStart = 4000;
const previewDuration = 120;
const preview: PreviewWindow = {
  sourceStart: Number(process.env.V4_PREVIEW_SOURCE_START ?? 240),
  sourceEnd: Number(process.env.V4_PREVIEW_SOURCE_START ?? 240) + previewDuration,
};

function configuredRights(value: string | undefined): MediaLibraryRoot['defaultRightsStatus'] {
  return value === 'approved' ? value : 'unknown';
}

const configuredMediaRights = configuredRights(process.env.V4_MEDIA_RIGHTS ?? process.env.V4_PROOF_MEDIA_RIGHTS);

const configuredRoots: MediaLibraryRoot[] = process.env.V4_MEDIA_ROOTS
  ? process.env.V4_MEDIA_ROOTS.split(',').map((path, index) => ({
      id: `custom-local-root-${index + 1}`,
      path: resolve(path.trim()),
      label: `Custom local media root ${index + 1}`,
      defaultRightsStatus: configuredMediaRights,
      rightsPolicyVersion: process.env.V4_MEDIA_RIGHTS_POLICY_VERSION ?? 'custom-root-default-v1',
      recursive: true,
      enabled: true,
    }))
  : [
      {
        id: 'approved-proof-library',
        path: join(root, 'local-media-proof'),
        label: 'Approved proof library',
        defaultRightsStatus: configuredMediaRights,
        rightsPolicyVersion: process.env.V4_PROOF_MEDIA_RIGHTS_POLICY_VERSION ?? 'proof-library-v1',
        recursive: true,
        enabled: true,
      },
      {
        id: 'public-source-media',
        path: join(root, 'public'),
        label: 'Public source media',
        defaultRightsStatus: configuredRights(process.env.V4_PUBLIC_MEDIA_RIGHTS),
        rightsPolicyVersion: process.env.V4_PUBLIC_MEDIA_RIGHTS_POLICY_VERSION ?? 'public-source-v1',
        recursive: true,
        enabled: true,
      },
    ];

async function renderPreview(sourcePath: string, plan: EditPlan, outputPath: string, assets: import('../src/contracts.ts').MediaAsset[]): Promise<void> {
  const entry = await bundle({ entryPoint: join(root, 'src/entry.tsx'), publicDir: join(root, 'public'), webpackOverride: (config) => config });
  const inputProps = { sourcePath, editPlan: plan, graphicFontSize: 62, mediaAssets: assets };
  const composition = await selectComposition({ serveUrl: entry, id: 'BanglaFoundation', inputProps });
  await renderMedia({ composition, serveUrl: entry, codec: 'h264', outputLocation: outputPath, inputProps, audioCodec: 'aac' });
}

async function captureFrame(videoPath: string, outputPath: string, time: number): Promise<void> {
  await run('/opt/homebrew/bin/ffmpeg', ['-y', '-ss', String(time), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outputPath]);
}

async function stageSelectedAssets(index: MediaIndex, decisions: BrollDecision[]): Promise<{ assets: MediaIndex['assets']; stagingDirectory: string }> {
  const selectedIds = new Set(decisions.filter((decision) => decision.decision === 'selected').map((decision) => decision.selectedAssetId).filter((assetId): assetId is string => Boolean(assetId)));
  const stagingDirectory = join(root, 'public', 'v4-selected-media');
  const assets = [];
  for (const asset of index.assets) {
    if (!selectedIds.has(asset.id) || asset.path.startsWith(join(root, 'public') + '/')) {
      assets.push(asset);
      continue;
    }
    await ensureDirectory(stagingDirectory);
    const stagedPath = join(stagingDirectory, asset.fileName);
    await copyFile(asset.path, stagedPath);
    assets.push({ ...asset, path: relative(root, stagedPath) });
  }
  return { assets, stagingDirectory };
}

async function resolveSelectedPlacements(decisions: BrollDecision[], index: MediaIndex, previewSource: string): Promise<{ placements: PlacementDecision[]; frames: VisualFrameAnalysis[] }> {
  const selected = decisions.filter((decision) => decision.decision === 'selected');
  const sampleDirectory = join(artifacts, 'frames', 'placement-source');
  await ensureDirectory(sampleDirectory);
  const samples = selected.flatMap((decision) => {
    const mapping = mapSourceRangeToPreview(decision.intent.start, decision.intent.end, preview);
    if (!mapping) return [];
    return representativeSampleTimes(mapping.previewStart, mapping.previewEnd, previewDuration).map((time) => ({
      beatId: decision.intent.sectionId,
      time,
      imagePath: join(sampleDirectory, `${decision.intent.sectionId}-${String(time).replace('.', '_')}s.png`),
    }));
  });
  for (const sample of samples) await captureFrame(previewSource, sample.imagePath, sample.time);
  let frames: VisualFrameAnalysis[] = [];
  if (samples.length) {
    const inputPath = join(artifacts, 'placement-frame-samples.json');
    const outputPath = join(artifacts, 'placement-visual-analysis.json');
    const analyzerBinary = join(artifacts, 'local-visual-analyzer');
    await writeJson(inputPath, samples);
    await run('/usr/bin/swiftc', ['-O', '-o', analyzerBinary, join(root, 'scripts', 'local-visual-analyzer.swift'), '-framework', 'Vision', '-framework', 'AppKit']);
    await run(analyzerBinary, [inputPath, outputPath]);
    frames = await readJson<VisualFrameAnalysis[]>(outputPath);
  }
  const placements = selected.map((decision) => {
    const asset = index.assets.find((candidate) => candidate.id === decision.selectedAssetId);
    return resolveBrollPlacement(decision.intent.sectionId, asset?.kind === 'video' ? 'video-broll' : 'image-broll', frames.filter((frame) => frame.beatId === decision.intent.sectionId));
  });
  return { placements, frames };
}

async function collectRenderEvidence(controlRender: string, directorRender: string, plan: EditPlan): Promise<{ renderedOperationIds: Set<string>; visibleOperationIds: Set<string>; comparisons: Array<{ operationId: string; time: number; controlHash: string; directorHash: string; visiblyDifferent: boolean }> }> {
  const renderedOperationIds = new Set<string>();
  const visibleOperationIds = new Set<string>();
  const comparisons: Array<{ operationId: string; time: number; controlHash: string; directorHash: string; visiblyDifferent: boolean }> = [];
  const evidenceDirectory = join(artifacts, 'frames', 'render-evidence');
  await ensureDirectory(evidenceDirectory);
  for (const operation of plan.operations.filter((candidate) => candidate.type === 'broll')) {
    renderedOperationIds.add(operation.id);
    const time = (operation.start + operation.end) / 2;
    const controlFrame = join(evidenceDirectory, `${operation.id}-control.png`);
    const directorFrame = join(evidenceDirectory, `${operation.id}-director.png`);
    await captureFrame(controlRender, controlFrame, time);
    await captureFrame(directorRender, directorFrame, time);
    const boundaryDirectory = join(artifacts, 'frames');
    await ensureDirectory(boundaryDirectory);
    await captureFrame(directorRender, join(boundaryDirectory, 'before-broll.png'), Math.max(0, operation.start - 1));
    await captureFrame(directorRender, join(boundaryDirectory, 'during-broll.png'), time);
    await captureFrame(directorRender, join(boundaryDirectory, 'after-broll.png'), Math.min(120 - (1 / 30), operation.end + 1));
    const controlHash = sha256(await readFile(controlFrame));
    const directorHash = sha256(await readFile(directorFrame));
    const visiblyDifferent = controlHash !== directorHash;
    if (visiblyDifferent) visibleOperationIds.add(operation.id);
    comparisons.push({ operationId: operation.id, time, controlHash, directorHash, visiblyDifferent });
  }
  return { renderedOperationIds, visibleOperationIds, comparisons };
}

async function main(): Promise<void> {
  await ensureDirectory(artifacts);
  await ensureDirectory(join(artifacts, 'media-index'));
  const previewSource = join(root, 'public', 'director-v4-preview-source.mp4');
  await extractSample(source, previewSource, semanticFixtureSourceStart + preview.sourceStart, previewDuration);
  const fullAnalysis = await readJson<SermonAnalysis>(join(priorArtifacts, 'analysis', 'sermon-analysis.json'));
  const transcript = await readJson<TranscriptDocument>(join(priorArtifacts, 'input-transcript.json'));
  const indexResult = await indexLocalMedia({ roots: configuredRoots, outputDirectory: join(artifacts, 'media-index'), previousIndexPath: join(artifacts, 'media-index', 'index.json'), createThumbnails: true });
  const cacheProofDirectory = await mkdtemp(join(tmpdir(), 'director-v4-cache-proof-'));
  let cacheProof: { firstRun: { reused: number; indexed: number; removed: number }; secondRun: { reused: number; indexed: number; removed: number } };
  try {
    const firstRun = await indexLocalMedia({ roots: configuredRoots, outputDirectory: cacheProofDirectory, createThumbnails: false });
    const secondRun = await indexLocalMedia({ roots: configuredRoots, outputDirectory: cacheProofDirectory, previousIndexPath: join(cacheProofDirectory, 'index.json'), createThumbnails: false });
    cacheProof = { firstRun: firstRun.cache, secondRun: secondRun.cache };
  } finally {
    await rm(cacheProofDirectory, { recursive: true, force: true });
  }
  const retention = applyRetentionPolicy(fullAnalysis, transcript.projectId, sha256(transcript.originalTranscript), Math.max(...fullAnalysis.sections.map((section) => section.end)));
  const intents = applyRetentionToBrollIntents(buildBrollIntents(fullAnalysis), retention);
  const history: MediaUsageHistory[] = [];
  const decisions = intents.map((intent) => decideBroll(indexResult.index, intent, history));
  const selected = decisions.filter((decision) => decision.decision === 'selected');
  const placementResult = await resolveSelectedPlacements(decisions, indexResult.index, previewSource);
  const operations = createPlacedBrollOperations(decisions, placementResult.placements, preview);
  const planDraft: EditPlan = {
    schemaVersion: '4.0',
    projectId: transcript.projectId,
    sourceTranscriptHash: sha256(transcript.originalTranscript),
    operations,
    status: 'draft',
    createdBy: { provider: 'deterministic-local-broll-director', model: 'metadata-search-v2-v3-placement' },
  };
  const planFailures = validatePlan(planDraft, previewDuration);
  const plan: EditPlan = { ...planDraft, status: planFailures.length ? 'draft' : 'validated' };
  const controlPlan: EditPlan = { ...plan, operations: [], createdBy: { provider: 'control', model: 'none' } };
  const sourceCopy = join(artifacts, 'preview-source.mp4');
  await copyFile(previewSource, sourceCopy);
  const controlRender = join(artifacts, 'control-preview.mp4');
  const directorRender = join(artifacts, 'director-preview.mp4');
  const staged = await stageSelectedAssets(indexResult.index, decisions);
  let renderEvidence: Awaited<ReturnType<typeof collectRenderEvidence>>;
  try {
    await renderPreview('director-v4-preview-source.mp4', controlPlan, controlRender, staged.assets);
    await renderPreview('director-v4-preview-source.mp4', plan, directorRender, staged.assets);
    renderEvidence = await collectRenderEvidence(controlRender, directorRender, plan);
  } finally {
    await rm(staged.stagingDirectory, { recursive: true, force: true });
  }
  const probe = JSON.parse(await run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=codec_type', '-of', 'json', directorRender])) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  const qaFailures = [
    ...planFailures,
    ...validateBrollPreview(decisions, plan.operations, placementResult.placements, indexResult.index, preview, renderEvidence),
    ...selected.flatMap((decision) => decision.selectedAssetId && !indexResult.index.assets.find((asset) => asset.id === decision.selectedAssetId) ? [`${decision.intent.sectionId}: selected asset missing`] : []),
    ...(Number(probe.format?.duration ?? 0) < previewDuration - 1 ? ['Director preview duration is shorter than bounded proof duration.'] : []),
    ...(plan.operations.some((operation) => operation.type === 'broll' && operation.muted !== true) ? ['B-roll audio is not explicitly muted.'] : []),
  ];
  const cache = {
    indexerVersion: indexResult.index.indexerVersion,
    roots: configuredRoots,
    indexPath: join(artifacts, 'media-index', 'index.json'),
    indexCache: indexResult.cache,
    mediaIndexHash: sha256(JSON.stringify(indexResult.index)),
    semanticAnalysisHash: sha256(JSON.stringify(fullAnalysis)),
    transcriptHash: sha256(transcript.originalTranscript),
    visualSamplingVersion: VISUAL_SAMPLING_VERSION,
    placementAlgorithmVersion: PLACEMENT_ALGORITHM_VERSION,
    textFitAlgorithmVersion: TEXT_FIT_ALGORITHM_VERSION,
    previewMappingVersion: BROLL_PREVIEW_MAPPING_VERSION,
    previewMapping: preview,
    retentionPolicyHash: sha256(JSON.stringify(defaultRetentionPolicy)),
    presentationHash: sha256(JSON.stringify({ fontSize: 62, theme: 'director-v4-local-broll' })),
    cacheProof,
    invalidationBoundary: 'Media index changes invalidate media search; transcript and presentation changes do not rebuild file metadata.',
  };
  await writeJson(join(artifacts, 'broll-intents.json'), intents);
  await writeJson(join(artifacts, 'candidate-rankings.json'), decisions);
  await writeJson(join(artifacts, 'selected-media.json'), selected);
  await writeJson(join(artifacts, 'placement-evidence.json'), selected.map((decision) => ({ intent: decision.intent, selectedAssetId: decision.selectedAssetId, retention: retention.records.find((record) => record.sectionId === decision.intent.sectionId), placement: placementResult.placements.find((placement) => placement.beatId === decision.intent.sectionId), visualFrames: placementResult.frames.filter((frame) => frame.beatId === decision.intent.sectionId) })));
  await writeJson(join(artifacts, 'edit-plan.json'), plan);
  await writeJson(join(artifacts, 'qa.json'), { status: qaFailures.length ? 'FAIL' : 'PASS', failures: qaFailures, selectedCount: selected.length, noBrollCount: decisions.filter((decision) => decision.decision !== 'selected').length, brollAudioMuted: plan.operations.filter((operation) => operation.type === 'broll').every((operation) => operation.muted), renderHasAudio: probe.streams?.some((stream) => stream.codec_type === 'audio') ?? false, renderVisibilityEvidence: renderEvidence.comparisons });
  await writeJson(join(artifacts, 'cache.json'), cache);
  await writeJson(join(artifacts, 'explanation-chain.json'), decisions.map((decision) => ({ sectionId: decision.intent.sectionId, intent: decision.intent, retention: retention.records.find((record) => record.sectionId === decision.intent.sectionId), decision: decision.decision, selectedAssetId: decision.selectedAssetId, reason: decision.reason, placement: placementResult.placements.find((placement) => placement.beatId === decision.intent.sectionId), topCandidates: decision.candidates.slice(0, 5) })));
  await writeJson(join(artifacts, 'preview-meta.json'), { source, semanticFixtureSourceStart, sourceStart: preview.sourceStart, sourceEnd: preview.sourceEnd, absoluteSourceStart: semanticFixtureSourceStart + preview.sourceStart, absoluteSourceEnd: semanticFixtureSourceStart + preview.sourceEnd, previewStart: 0, previewEnd: previewDuration, previewDuration, controlRender, directorRender, roots: configuredRoots, duration: Number(probe.format?.duration ?? 0) });
  console.log(JSON.stringify({ artifacts, controlRender, directorRender, indexedAssets: indexResult.index.assets.length, selected: selected.length, noBroll: decisions.length - selected.length, qaFailures }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
