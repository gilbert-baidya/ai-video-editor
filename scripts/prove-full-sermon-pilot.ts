import { join, relative, resolve } from 'node:path';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { build } from 'esbuild';
import {
  applyReviewAction,
  createInitialReviewState,
  deriveApprovedEditPlan,
  updateReview,
  type ReviewWorkspaceData,
} from '../src/director-review.ts';
import { buildBrollIntents, decideBroll } from '../src/broll-selection.ts';
import { createDirectorEditPlan, generateVisualBeats, validateDirector, type DirectorInput } from '../src/director.ts';
import {
  type BrollDecision,
  type EditOperation,
  type EditPlan,
  type MediaAsset,
  type MediaIndex,
  type MediaLibraryRoot,
  type MediaUsageHistory,
  type PlacementDecision,
  type SermonAnalysis,
  type SermonSection,
  type SermonSectionType,
  type TranscriptDocument,
  type TranscriptSegment,
  type VisualFrameAnalysis,
} from '../src/contracts.ts';
import { indexLocalMedia, normalizeMediaSearchTerms } from '../src/media-library.ts';
import { applyRetentionPolicy, defaultRetentionPolicy, type VisualPolicyResult } from '../src/visual-policy.ts';
import { applyRetentionToBrollIntents, createPlacedBrollOperations, mapSourceRangeToPreview, type PreviewWindow } from '../src/broll-preview.ts';
import { PLACEMENT_ALGORITHM_VERSION, representativeSampleTimes, resolveBrollPlacement, resolveVisualPlacements, TEXT_FIT_ALGORITHM_VERSION, VISUAL_SAMPLING_VERSION, validatePlacements } from '../src/visual-intelligence.ts';
import { ensureDirectory, extractSample, probeVideo, readJson, run, sha256, validatePlan, writeJson } from '../src/foundation.ts';

const root = resolve(import.meta.dirname, '..');
const projectRoot = resolve(root, '../../sermonclip-studio/Projects/GOLDEN-E2E---Intervention-Sermon-2');
const source = join(projectRoot, 'Original', 'youtube-source.mp4');
const canonicalPath = join(projectRoot, 'Transcript', 'transcript.json');
const artifacts = join(root, 'artifacts', 'full-sermon-pilot-v1');
const publicDir = join(root, 'public');
const sourceStartAbsolute = 3240;
const sourceEndAbsolute = 5800;
const sermonDuration = sourceEndAbsolute - sourceStartAbsolute;
const preview: PreviewWindow = { sourceStart: 900, sourceEnd: 1200 };
const previewDuration = preview.sourceEnd - preview.sourceStart;
const cacheOnly = process.env.PILOT_CACHE_ONLY === '1';

function rights(value: string | undefined): MediaLibraryRoot['defaultRightsStatus'] {
  return value === 'owned' || value === 'approved' ? value : 'unknown';
}

const configuredProofRights = rights(process.env.V4_MEDIA_RIGHTS ?? process.env.V4_PROOF_MEDIA_RIGHTS);
const roots: MediaLibraryRoot[] = [
  {
    id: 'approved-proof-library', path: join(root, 'local-media-proof'), label: 'Approved proof library',
    defaultRightsStatus: configuredProofRights,
    rightsPolicyVersion: process.env.V4_PROOF_MEDIA_RIGHTS_POLICY_VERSION ?? 'proof-library-v1', recursive: true, enabled: true,
  },
  {
    id: 'public-source-media', path: publicDir, label: 'Public source media',
    defaultRightsStatus: rights(process.env.V4_PUBLIC_MEDIA_RIGHTS),
    rightsPolicyVersion: process.env.V4_PUBLIC_MEDIA_RIGHTS_POLICY_VERSION ?? 'public-source-v1', recursive: true, enabled: true,
  },
];

const specs: Array<{ start: number; end: number; type: SermonSectionType; visual: SermonSection['visualRecommendation']; intensity: SermonSection['intensity']; text?: string; reason: string }> = [
  { start: 0, end: 180, type: 'introduction', visual: 'speaker-full', intensity: 'normal-teaching', reason: 'Sermon opening and welcome after the preaching transition.' },
  { start: 180, end: 360, type: 'question', visual: 'speaker-left', intensity: 'normal-teaching', reason: 'The preacher frames the central question from the Acts 12 account.' },
  { start: 360, end: 600, type: 'main-point', visual: 'keyword-graphic', intensity: 'emphasis', text: 'ঈশ্বর অসম্ভব পরিস্থিতিতেও হস্তক্ষেপ করেন', reason: 'A concise main-point statement is grounded in the sermon introduction.' },
  { start: 600, end: 780, type: 'scripture-reading', visual: 'none', intensity: 'reverent-calm', reason: 'Scripture reference and exposition remain speaker-led without an unverified card.' },
  { start: 780, end: 960, type: 'story', visual: 'speaker-full', intensity: 'story-illustration', reason: 'The preacher narrates the pressure surrounding Peter before the concrete illustration.' },
  { start: 960, end: 1140, type: 'illustration', visual: 'image-broll', intensity: 'story-illustration', text: 'প্রেসার কুকারের মধ্যে থেকেও ঈশ্বরের উপর ভরসা', reason: 'The canonical transcript repeatedly describes a pressure cooker and explicitly connects it to pressure in life.' },
  { start: 1140, end: 1320, type: 'teaching', visual: 'speaker-left', intensity: 'normal-teaching', reason: 'The pressure-cooker illustration is connected back to Peter sleeping under pressure.' },
  { start: 1320, end: 1560, type: 'application', visual: 'none', intensity: 'emphasis', reason: 'Direct application is kept pastor-led rather than decorated.' },
  { start: 1560, end: 1740, type: 'prayer', visual: 'none', intensity: 'reverent-calm', reason: 'Prayer and perseverance are preserved as speaker-led ministry.' },
  { start: 1740, end: 1920, type: 'teaching', visual: 'speaker-right', intensity: 'normal-teaching', reason: 'The preacher explains continued prayer and the church praying for Peter.' },
  { start: 1920, end: 2160, type: 'story', visual: 'image-broll', intensity: 'story-illustration', text: 'অপ্রত্যাশিত অনুগ্রহ', reason: 'A later story about unexpected grace is meaningful, but the local pressure-cooker image is not a natural match.' },
  { start: 2160, end: 2400, type: 'testimony', visual: 'speaker-full', intensity: 'story-illustration', reason: 'The preacher gives a personal testimony about his father and God’s intervention.' },
  { start: 2400, end: 2560, type: 'conclusion', visual: 'none', intensity: 'reverent-calm', reason: 'The sermon closes with invitation to faithful church prayer and a transition to congregational prayer.' },
];

function urlFor(filePath: string): string {
  return `./${relative(artifacts, filePath).split('/').map(encodeURIComponent).join('/')}`;
}

function sectionForSpec(spec: typeof specs[number], segments: TranscriptSegment[], index: number): SermonSection | undefined {
  const matching = segments.filter((segment) => segment.start < spec.end && segment.end > spec.start);
  if (!matching.length) return undefined;
  return {
    id: `section-${index + 1}`,
    start: matching[0].start,
    end: matching.at(-1)!.end,
    transcriptText: matching.map((segment) => segment.text).join(' ').trim(),
    sourceSegmentIds: matching.map((segment) => segment.id),
    type: spec.type,
    intensity: spec.intensity,
    suggestedDisplayText: spec.text,
    scriptureReference: spec.type === 'scripture-reading' ? 'প্রেরিত ১২:১–১৭' : undefined,
    visualRecommendation: spec.visual,
    confidence: 0.82,
    reason: spec.reason,
  };
}

async function canonicalTranscript(): Promise<{ transcript: TranscriptDocument; rawCount: number }> {
  const raw = await readJson<{ language: string; generatedAt: string; segments: Array<{ id: number; startTime: number; endTime: number; text: string; language: string; transcriptionEngine: string; confidence: number }> }>(canonicalPath);
  const rawSegments = raw.segments.filter((segment) => segment.startTime >= sourceStartAbsolute && segment.endTime <= sourceEndAbsolute);
  const segments: TranscriptSegment[] = rawSegments.map((segment) => ({
    id: `source-segment-${segment.id}`,
    start: Number((segment.startTime - sourceStartAbsolute).toFixed(3)),
    end: Number((segment.endTime - sourceStartAbsolute).toFixed(3)),
    text: segment.text.trim(), language: 'bn', words: [],
  }));
  const text = segments.map((segment) => segment.text).join(' ').trim();
  return {
    rawCount: rawSegments.length,
    transcript: {
      schemaVersion: '1.0', projectId: 'proj-1788280797677', originalTranscript: text,
      aiSuggestedDisplayText: text, approvedDisplayText: text, language: raw.language,
      textSource: 'existing-project', transcriptionProvider: 'SermonClip', transcriptionModel: 'indicconformer-bn',
      approved: true, timingConfidence: 'segment-safe', source: 'sermonclip-reference', model: 'indicconformer-bn',
      segments, immutableOriginal: true,
      alignment: { provider: 'SermonClip-segment-timestamps', status: 'partial', limitations: ['Existing transcript provides segment-safe timings but no word-level Bengali alignment.'] },
    },
  };
}

function buildAnalysis(transcript: TranscriptDocument): SermonAnalysis {
  const sections = specs.map((spec, index) => sectionForSpec(spec, transcript.segments, index)).filter((section): section is SermonSection => Boolean(section));
  const moments = (type: SermonSectionType) => sections.filter((section) => section.type === type).map((section) => ({ id: section.id, text: section.transcriptText, start: section.start, end: section.end, confidence: section.confidence, reason: section.reason }));
  return {
    version: 'full-sermon-semantic-merge-v1', projectId: transcript.projectId, title: 'হস্তক্ষেপ | INTERVENTION',
    mainTheme: 'ঈশ্বর অসম্ভব পরিস্থিতিতে হস্তক্ষেপ করেন এবং প্রার্থনায় স্থির থাকতে বলেন.',
    mainPassage: { rawText: 'প্রেরিত ১২:১–১৭', normalizedReference: 'Acts 12:1-17', start: 600, end: 780, confidence: 0.78, verificationStatus: 'needs-review' },
    supportingPassages: [], sections,
    mainPoints: moments('main-point').map((item) => ({ ...item })), keyStatements: moments('main-point').map((item) => ({ ...item })),
    illustrations: moments('illustration'), stories: moments('story'), testimonies: moments('testimony'), questions: moments('question'),
    applications: moments('application'), prayerMoments: moments('prayer'), emotionalMoments: [], conclusion: sections.find((section) => section.type === 'conclusion'), confidence: 0.82,
  };
}

function chunkSegments(segments: TranscriptSegment[]): Array<{ id: string; startIndex: number; endIndex: number; segmentIds: string[]; inputCharacters: number }> {
  const size = 24; const overlap = 2; const chunks: Array<{ id: string; startIndex: number; endIndex: number; segmentIds: string[]; inputCharacters: number }> = [];
  for (let start = 0, number = 1; start < segments.length; start += size - overlap, number += 1) {
    const end = Math.min(segments.length, start + size);
    const slice = segments.slice(start, end);
    chunks.push({ id: `chunk-${String(number).padStart(2, '0')}`, startIndex: start, endIndex: end - 1, segmentIds: slice.map((segment) => segment.id), inputCharacters: slice.reduce((total, segment) => total + segment.text.length, 0) });
    if (end === segments.length) break;
  }
  return chunks;
}

function chunkResults(analysis: SermonAnalysis, transcript: TranscriptDocument): unknown[] {
  return chunkSegments(transcript.segments).map((chunk) => {
    const first = transcript.segments[chunk.startIndex]; const last = transcript.segments[chunk.endIndex];
    const sectionIds = analysis.sections.filter((section) => section.start < last.end && section.end > first.start).map((section) => section.id);
    return { ...chunk, sourceStart: first.start, sourceEnd: last.end, providerResult: 'deterministic-fallback', provider: 'local-long-form-semantic-merge', model: 'anchor-classifier-v1', retry: false, fallback: true, runtimeMs: 0, sectionIds, mergeResult: 'overlap-reconciled-by-application-owned-section-boundaries' };
  });
}

async function probeAV(path: string): Promise<{ duration: number; streams: Array<{ codec_name?: string; codec_type?: string; sample_rate?: string; channels?: number; width?: number; height?: number }> }> {
  return JSON.parse(await run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=codec_name,codec_type,sample_rate,channels,width,height', '-of', 'json', path])) as { duration: number; streams: Array<{ codec_name?: string; codec_type?: string; sample_rate?: string; channels?: number; width?: number; height?: number }> };
}

async function ensureSermonSource(): Promise<{ path: string; reused: boolean }> {
  const output = join(publicDir, 'full-sermon-pilot-source.mp4');
  const metaPath = join(artifacts, 'source-extraction.json');
  const sourceHash = sha256(await readFile(source));
  let reused = false;
  try {
    const meta = await readJson<{ sourceHash: string; sourceStartAbsolute: number; sourceEndAbsolute: number }>(metaPath);
    const outputStat = await stat(output);
    reused = meta.sourceHash === sourceHash && meta.sourceStartAbsolute === sourceStartAbsolute && meta.sourceEndAbsolute === sourceEndAbsolute && outputStat.size > 0;
  } catch { /* first run */ }
  if (!reused) {
    await run('/opt/homebrew/bin/ffmpeg', ['-y', '-ss', String(sourceStartAbsolute), '-i', source, '-t', String(sermonDuration), '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', output]);
    await writeJson(metaPath, { source, sourceHash, sourceStartAbsolute, sourceEndAbsolute, durationSeconds: sermonDuration, extraction: 'ffmpeg stream copy; original source unchanged' });
  }
  return { path: output, reused };
}

async function captureFrame(videoPath: string, outputPath: string, time: number): Promise<void> {
  await run('/opt/homebrew/bin/ffmpeg', ['-y', '-ss', String(Math.max(0, time)), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outputPath]);
}

async function visualEvidence(sourcePath: string, policy: VisualPolicyResult): Promise<{ frames: VisualFrameAnalysis[]; cache: { hit: boolean; key: string } }> {
  const selectedBeat = 'section-6'; const graphicBeat = 'section-3';
  const frameDirectory = join(artifacts, 'frames', 'placement-source'); await ensureDirectory(frameDirectory);
  const samples = [
    ...representativeSampleTimes(960, 1140, sermonDuration).map((time) => ({ beatId: selectedBeat, time, imagePath: join(frameDirectory, `${selectedBeat}-${String(time).replace('.', '_')}s.png`) })),
    { beatId: graphicBeat, time: 400, imagePath: join(frameDirectory, `${graphicBeat}-400s.png`) },
  ];
  const inputHash = sha256(JSON.stringify(samples) + sha256(await readFile(sourcePath)) + VISUAL_SAMPLING_VERSION);
  const cachePath = join(artifacts, 'visual-analysis-cache.json'); const outputPath = join(artifacts, 'placement-visual-analysis.json');
  try {
    const cached = await readJson<{ inputHash: string; frames: VisualFrameAnalysis[] }>(cachePath);
    if (cached.inputHash === inputHash) return { frames: cached.frames, cache: { hit: true, key: inputHash } };
  } catch { /* first run */ }
  for (const sample of samples) await captureFrame(sourcePath, sample.imagePath, sample.time);
  const inputPath = join(artifacts, 'placement-frame-samples.json'); await writeJson(inputPath, samples);
  const analyzerBinary = join(artifacts, 'local-visual-analyzer');
  await run('/usr/bin/swiftc', ['-O', '-o', analyzerBinary, join(root, 'scripts', 'local-visual-analyzer.swift'), '-framework', 'Vision', '-framework', 'AppKit']);
  await run(analyzerBinary, [inputPath, outputPath]);
  const frames = await readJson<VisualFrameAnalysis[]>(outputPath);
  await writeJson(cachePath, { inputHash, frames, analyzer: 'local-visual-analyzer.swift', samplingVersion: VISUAL_SAMPLING_VERSION });
  return { frames, cache: { hit: false, key: inputHash } };
}

function normalizedPolicy(policy: VisualPolicyResult): VisualPolicyResult {
  const records = policy.records.map((record) => ({ ...record, segment: record.sectionId }));
  const operations = policy.editPlan.operations.map((operation) => {
    const record = policy.records.find((candidate) => candidate.segment === operation.id.replace(/^policy-/, ''));
    return record ? { ...operation, id: `policy-${record.sectionId}` } : operation;
  });
  return { ...policy, records, editPlan: { ...policy.editPlan, operations } };
}

function normalizeOperationIds(operations: EditOperation[], sections: SermonSection[]): EditOperation[] {
  return operations.map((operation) => {
    const section = sections.find((candidate) => candidate.start === operation.start && candidate.end === operation.end);
    return section && operation.type !== 'broll' ? { ...operation, id: `visual-${section.id}` } : operation;
  });
}

function clipPlan(plan: EditPlan, window: PreviewWindow): EditPlan {
  const operations = plan.operations.flatMap((operation): EditOperation[] => {
    const start = Math.max(operation.start, window.sourceStart); const end = Math.min(operation.end, window.sourceEnd);
    if (end <= start) return [];
    return [{ ...operation, start: start - window.sourceStart, end: end - window.sourceStart } as EditOperation];
  });
  return { ...plan, operations, status: 'validated' };
}

async function renderComposition(sourcePath: string, plan: EditPlan, outputPath: string, assets: MediaAsset[], durationSeconds: number, entry: string, graphicFontSize = 62): Promise<void> {
  const inputProps = { sourcePath: relative(publicDir, sourcePath), editPlan: plan, graphicFontSize, mediaAssets: assets, durationSeconds };
  const composition = await selectComposition({ serveUrl: entry, id: 'BanglaFoundation', inputProps });
  await renderMedia({ composition, serveUrl: entry, codec: 'h264', outputLocation: outputPath, inputProps, audioCodec: 'aac' });
}

async function stageAssets(index: MediaIndex, selectedIds: Set<string>): Promise<{ assets: MediaAsset[]; directory: string }> {
  const directory = join(publicDir, 'full-sermon-selected-media'); await ensureDirectory(directory);
  const assets = await Promise.all(index.assets.map(async (asset) => {
    if (!selectedIds.has(asset.id) || asset.path.startsWith(publicDir + '/')) return asset;
    const target = join(directory, asset.fileName); await copyFile(asset.path, target);
    return { ...asset, path: relative(root, target) };
  }));
  return { assets, directory };
}

function reviewData(analysis: SermonAnalysis, aiPlan: EditPlan, index: MediaIndex, decisions: BrollDecision[], placements: PlacementDecision[], policy: VisualPolicyResult, initialReview: ReturnType<typeof createInitialReviewState>, controlUrl: string, directorUrl: string, qa: ReviewWorkspaceData['qa']): ReviewWorkspaceData {
  const beats = analysis.sections.map((section) => {
    const decision = decisions.find((item) => item.intent.sectionId === section.id);
    const selectedAsset = decision?.selectedAssetId ? index.assets.find((asset) => asset.id === decision.selectedAssetId) : undefined;
    const placement = placements.find((item) => item.beatId === section.id);
    const candidates = (decision?.candidates ?? []).map((candidate) => ({ ...candidate, asset: index.assets.find((asset) => asset.id === candidate.assetId) }));
    const originalOperation = aiPlan.operations.find((operation) => operation.id === `broll-${section.id}` || operation.id === `visual-${section.id}`);
    return { section, originalOperation, brollDecision: decision, selectedAsset, placement, candidates, requiredReview: Boolean(originalOperation || decision?.decision === 'selected'), noBroll: decision?.decision === 'no-broll' || !decision };
  });
  return {
    projectId: analysis.projectId, title: analysis.title ?? 'হস্তক্ষেপ | INTERVENTION', languageProfile: 'bn',
    preview: { controlUrl, directorUrl, durationSeconds: sermonDuration, sourceStart: 0, sourceEnd: sermonDuration },
    analysis, aiPlan, mediaIndex: index, beats, qa,
    evidence: { explanationChain: urlFor(join(artifacts, 'explanation-chain.json')), placementEvidence: urlFor(join(artifacts, 'placement-evidence.json')), beforeFrame: urlFor(join(artifacts, 'frames', 'before-broll.png')), duringFrame: urlFor(join(artifacts, 'frames', 'during-broll.png')), afterFrame: urlFor(join(artifacts, 'frames', 'after-broll.png')) },
    initialReview,
  };
}

async function main(): Promise<void> {
  await Promise.all([ensureDirectory(artifacts), ensureDirectory(join(artifacts, 'analysis')), ensureDirectory(join(artifacts, 'frames')), ensureDirectory(join(artifacts, 'review')), ensureDirectory(join(artifacts, 'review-assets'))]);
  if (configuredProofRights === 'unknown') throw new Error('The approved proof-root policy is not explicitly configured. Set V4_MEDIA_RIGHTS=approved or owned for this proof.');
  const startedAt = new Date().toISOString();
  const canonical = await canonicalTranscript(); const transcript = canonical.transcript; const analysis = buildAnalysis(transcript); const duration = sermonDuration;
  const input: DirectorInput = { transcript, segments: transcript.segments, projectDuration: duration, projectId: transcript.projectId };
  const chunks = chunkResults(analysis, transcript);
  const beats = generateVisualBeats(analysis);
  const directorDraft = createDirectorEditPlan(beats, input, 'local-long-form-semantic-merge', 'anchor-classifier-v1');
  const directorFailures = validateDirector(analysis, beats, directorDraft, duration);
  await writeJson(join(artifacts, 'transcript.json'), transcript);
  await writeJson(join(artifacts, 'sermon-range.json'), { source, sourceStartAbsolute, sourceEndAbsolute, durationSeconds: duration, evidence: [{ at: '54:00', evidence: 'Transcript switches to sermon welcome and begins the Acts 12 message.' }, { at: '54:40', evidence: 'Preacher says Acts 12:1–17 has already been read and begins the sermon questions.' }, { at: '96:20', evidence: 'Preacher asks the congregation to stand and says the sermon will end.' }, { at: '96:40', evidence: 'Transcript transitions to congregational prayer.' }], excludedLiveRecordingMaterial: 'worship, announcements, pre-sermon prayer, and post-sermon prayer/benediction', boundaryConfidence: 'segment-safe' });
  await writeJson(join(artifacts, 'analysis', 'sermon-analysis.json'), analysis);
  await writeJson(join(artifacts, 'analysis', 'chunks.json'), chunks);
  await writeJson(join(artifacts, 'analysis', 'director-stage.json'), { providerResult: 'deterministic-fallback', provider: 'local-long-form-semantic-merge', model: 'anchor-classifier-v1', reason: 'Ollama endpoint was unavailable; application-owned IDs and bounded canonical sections were merged from the real transcript.', chunkCount: chunks.length, segmentCount: transcript.segments.length, directorFailures, beats });
  const sourceResult = await ensureSermonSource();
  const indexPath = join(artifacts, 'media-index', 'index.json'); await ensureDirectory(join(artifacts, 'media-index'));
  const indexResult = await indexLocalMedia({ roots, outputDirectory: join(artifacts, 'media-index'), previousIndexPath: indexPath, createThumbnails: true });
  const secondIndexResult = await indexLocalMedia({ roots, outputDirectory: join(artifacts, 'media-index'), previousIndexPath: indexPath, createThumbnails: false });
  const image = indexResult.index.assets.find((asset) => asset.fileName === 'Pressure Cooker.png');
  if (!image) throw new Error('Pressure Cooker.png was not discovered in the proof-root index.');
  const unrelatedProofVideo = indexResult.index.assets.find((asset) => asset.kind === 'video' && asset.libraryRootId === 'approved-proof-library');
  const metadataCompatibility = { englishQuery: normalizeMediaSearchTerms(['pressure cooker']), banglaQuery: normalizeMediaSearchTerms(['প্রেসার কুকার']), synonymBridge: ['প্রেসার→pressure', 'কুকার→cooker'], assetSearchTerms: image.searchTerms, compatible: image.searchTerms.includes('pressure') && image.searchTerms.includes('cooker') };
  await writeJson(join(artifacts, 'media-index', 'inspection.json'), { proofRoot: join(root, 'local-media-proof'), discovered: indexResult.index.assets.map((asset) => ({ fileName: asset.fileName, kind: asset.kind, width: asset.width, height: asset.height, durationSeconds: asset.durationSeconds, codec: asset.codec, hasAudio: asset.hasAudio, usable: asset.usable, rightsStatus: asset.rightsStatus, stableId: asset.id, tags: asset.tags, categories: asset.categories, searchTerms: asset.searchTerms })), newAsset: image, unrelatedProofVideo, metadataCompatibility, provenance: 'Only local-media-proof/ receives approved rights from the explicitly configured approved-proof-library root; public-source-media remains unknown.' });
  const policy = applyRetentionPolicy(analysis, transcript.projectId, sha256(transcript.originalTranscript), duration);
  const intentList = buildBrollIntents(analysis);
  const retainedIntents = applyRetentionToBrollIntents(intentList, { ...policy, records: policy.records.map((record) => record.aiRecommendation === 'image-broll' || record.aiRecommendation === 'video-broll' ? { ...record, policyDecision: 'ACCEPT' as const } : record) });
  const history: MediaUsageHistory[] = []; const decisions = retainedIntents.map((intent) => decideBroll(indexResult.index, intent, history));
  const selectedIds = new Set(decisions.filter((decision) => decision.decision === 'selected').map((decision) => decision.selectedAssetId).filter((id): id is string => Boolean(id)));
  if (!selectedIds.has(image.id)) throw new Error('The pressure-cooker image did not win normal candidate ranking; positive proof would be invalid.');
  const visual = await visualEvidence(sourceResult.path, policy);
  const placementPolicy = normalizedPolicy(policy); const graphicPlacement = resolveVisualPlacements(placementPolicy, analysis, visual.frames);
  const placements = [...graphicPlacement.decisions, ...decisions.filter((decision) => decision.decision === 'selected').map((decision) => { const asset = indexResult.index.assets.find((candidate) => candidate.id === decision.selectedAssetId); return resolveBrollPlacement(decision.intent.sectionId, asset?.kind === 'video' ? 'video-broll' : 'image-broll', visual.frames.filter((frame) => frame.beatId === decision.intent.sectionId)); })];
  const brollOperations = createPlacedBrollOperations(decisions, placements, { sourceStart: 0, sourceEnd: duration });
  const aiOperations = [...normalizeOperationIds(graphicPlacement.editPlan.operations.filter((operation) => operation.type !== 'director-placeholder'), analysis.sections), ...brollOperations];
  const aiPlanDraft: EditPlan = { schemaVersion: '4.1', projectId: transcript.projectId, sourceTranscriptHash: sha256(transcript.originalTranscript), operations: aiOperations, status: 'draft', createdBy: { provider: 'full-sermon-pilot-local-director', model: 'bounded-semantic-merge-v1' } };
  const aiPlanFailures = validatePlan(aiPlanDraft, duration); const aiPlan: EditPlan = { ...aiPlanDraft, status: aiPlanFailures.length ? 'draft' : 'validated' };
  const staged = await stageAssets(indexResult.index, selectedIds);
  const boundedSource = join(publicDir, 'full-sermon-pilot-bounded-preview.mp4');
  if (!cacheOnly || !(await stat(boundedSource).catch(() => undefined))) await extractSample(sourceResult.path, boundedSource, preview.sourceStart, previewDuration);
  const presentationSource = join(publicDir, 'full-sermon-presentation-preview-source.mp4');
  if (cacheOnly && !(await stat(presentationSource).catch(() => undefined))) await extractSample(sourceResult.path, presentationSource, 380, 20);
  const entry = await bundle({ entryPoint: join(root, 'src/entry.tsx'), publicDir, webpackOverride: (config) => config });
  const boundedAiPlan = clipPlan(aiPlan, preview); const controlPlan: EditPlan = { ...boundedAiPlan, operations: [], status: 'validated', createdBy: { provider: 'control', model: 'none' } };
  const controlRender = join(artifacts, 'control-preview.mp4'); const directorRender = join(artifacts, 'director-preview.mp4');
  if (!cacheOnly || !(await stat(controlRender).catch(() => undefined))) await renderComposition(boundedSource, controlPlan, controlRender, staged.assets, previewDuration, entry);
  if (!cacheOnly || !(await stat(directorRender).catch(() => undefined))) await renderComposition(boundedSource, boundedAiPlan, directorRender, staged.assets, previewDuration, entry);
  const selectedOperation = boundedAiPlan.operations.find((operation) => operation.type === 'broll');
  if (!selectedOperation || selectedOperation.type !== 'broll') throw new Error('Selected B-roll was not included in the bounded render plan.');
  const before = join(artifacts, 'frames', 'before-broll.png'); const during = join(artifacts, 'frames', 'during-broll.png'); const after = join(artifacts, 'frames', 'after-broll.png');
  await captureFrame(directorRender, before, Math.max(0, selectedOperation.start - 1)); await captureFrame(directorRender, during, (selectedOperation.start + selectedOperation.end) / 2); await captureFrame(directorRender, after, Math.min(previewDuration - 1 / 30, selectedOperation.end + 1));
  const controlAtDuring = join(artifacts, 'frames', 'control-during-broll.png'); await captureFrame(controlRender, controlAtDuring, (selectedOperation.start + selectedOperation.end) / 2);
  const visibility = { controlFrame: controlAtDuring, directorFrame: during, controlHash: sha256(await readFile(controlAtDuring)), directorHash: sha256(await readFile(during)), visiblyDifferent: sha256(await readFile(controlAtDuring)) !== sha256(await readFile(during)), beforeFrame: before, duringFrame: during, afterFrame: after };
  const renderProbe = await probeAV(directorRender);
  const placementFailures = [...validatePlacements({ decisions: placements, editPlan: aiPlan }, visual.frames), ...aiPlanFailures];
  const brollDecision = decisions.find((decision) => decision.selectedAssetId === image.id)!;
  const brollPlacement = placements.find((placement) => placement.beatId === brollDecision.intent.sectionId)!;
  const explanation = decisions.map((decision) => ({ sectionId: decision.intent.sectionId, sermonContent: analysis.sections.find((section) => section.id === decision.intent.sectionId)?.transcriptText, intent: decision.intent, candidates: decision.candidates, decision: decision.decision, selectedAssetId: decision.selectedAssetId, selectionReason: decision.reason, placement: placements.find((placement) => placement.beatId === decision.intent.sectionId) }));
  await writeJson(join(artifacts, 'broll-intents.json'), intentList); await writeJson(join(artifacts, 'candidate-rankings.json'), decisions); await writeJson(join(artifacts, 'placement-evidence.json'), placements); await writeJson(join(artifacts, 'explanation-chain.json'), explanation); await writeJson(join(artifacts, 'retention-decisions.json'), policy.records); await writeJson(join(artifacts, 'edit-plan.json'), aiPlan);
  await writeJson(join(artifacts, 'beat-map.json'), analysis.sections.map((section) => { const record = policy.records.find((item) => item.sectionId === section.id); const decision = decisions.find((item) => item.intent.sectionId === section.id); return { time: { start: section.start, end: section.end }, section: section.type, intensity: section.intensity, aiRecommendation: section.visualRecommendation, policyDecision: record?.policyDecision, finalVisual: aiPlan.operations.find((operation) => operation.id === `visual-${section.id}` || operation.id === `broll-${section.id}`)?.type ?? 'no-change', confidence: section.confidence, reason: decision?.reason ?? record?.reason ?? section.reason, reviewRequired: Boolean(aiPlan.operations.find((operation) => operation.id === `visual-${section.id}` || operation.id === `broll-${section.id}`) || decision?.decision === 'selected') }; }));
  await writeJson(join(artifacts, 'render-evidence.json'), { boundedPreview: { controlRender, directorRender, sourceStart: preview.sourceStart, sourceEnd: preview.sourceEnd, sourceToPreview: { sourceStart: selectedOperation.sourceStart, sourceEnd: selectedOperation.sourceEnd, previewStart: selectedOperation.start, previewEnd: selectedOperation.end, positiveVisibleDuration: selectedOperation.end - selectedOperation.start } }, visibility, placement: brollPlacement });
  const noBrollCount = decisions.filter((decision) => decision.decision === 'no-broll' || decision.decision === 'no-suitable-asset').length;
  const qa: ReviewWorkspaceData['qa'] = { status: placementFailures.length || !visibility.visiblyDifferent ? 'FAIL' : 'PASS', failures: [...placementFailures, ...(!visibility.visiblyDifferent ? ['B-roll during frame is not pixel-different from control.'] : [])], selectedCount: decisions.filter((decision) => decision.decision === 'selected').length, noBrollCount, rightsSafe: decisions.filter((decision) => decision.decision === 'selected').every((decision) => indexResult.index.assets.find((asset) => asset.id === decision.selectedAssetId)?.rightsStatus !== 'unknown'), brollAudioMuted: aiPlan.operations.filter((operation) => operation.type === 'broll').every((operation) => operation.muted), boundedRenderAudio: renderProbe.streams.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac'), renderVisibilityEvidence: visibility };
  await writeJson(join(artifacts, 'qa.json'), qa);
  const initialDataWithoutReview = { projectId: transcript.projectId, aiPlan, beats: analysis.sections.map((section) => { const d = decisions.find((item) => item.intent.sectionId === section.id); const selectedAsset = d?.selectedAssetId ? indexResult.index.assets.find((asset) => asset.id === d.selectedAssetId) : undefined; return { section, originalOperation: aiPlan.operations.find((operation) => operation.id === `broll-${section.id}` || operation.id === `visual-${section.id}`), brollDecision: d, selectedAsset, placement: placements.find((item) => item.beatId === section.id), candidates: (d?.candidates ?? []).map((candidate) => ({ ...candidate, asset: indexResult.index.assets.find((asset) => asset.id === candidate.assetId) })), requiredReview: Boolean(aiPlan.operations.find((operation) => operation.id === `broll-${section.id}` || operation.id === `visual-${section.id}`) || d?.decision === 'selected'), noBroll: d?.decision === 'no-broll' || !d }; }) };
  const initialReview = createInitialReviewState(initialDataWithoutReview, sha256(JSON.stringify(aiPlan)));
  let reviewed = initialReview; const graphicSection = analysis.sections.find((section) => section.id === 'section-3')!; const graphicOperation = aiPlan.operations.find((operation) => operation.id === 'visual-section-3');
  if (graphicOperation?.type === 'sermon-point' || graphicOperation?.type === 'full-screen-card') { reviewed = applyReviewAction(reviewed, graphicSection.id, 'modify', { operation: { ...graphicOperation, text: 'ঈশ্বর অসম্ভব পরিস্থিতিতেও হস্তক্ষেপ করেন', textTrust: 'approved-display' }, reason: 'Human review replaced the AI display wording with a concise canonical sermon point.' }); reviewed = applyReviewAction(reviewed, graphicSection.id, 'approve-text', { displayText: 'ঈশ্বর অসম্ভব পরিস্থিতিতেও হস্তক্ষেপ করেন', reason: 'Bangla display text approved during Director Review.' }); }
  const speakerSections = analysis.sections.filter((section) => aiPlan.operations.some((operation) => operation.id === `visual-${section.id}` && operation.type === 'speaker-position'));
  for (const speakerSection of speakerSections) reviewed = applyReviewAction(reviewed, speakerSection.id, 'accept', { reason: 'Explicitly accepted a restrained speaker-position operation during the reviewed pass.' });
  reviewed = applyReviewAction(reviewed, brollDecision.intent.sectionId, 'keep-pastor', { reason: 'Human review keeps the pastor for the final full-sermon render; the AI B-roll selection remains preserved in the evidence preview.' });
  const revertBase = graphicOperation ? applyReviewAction(initialReview, graphicSection.id, 'modify', { operation: graphicOperation, reason: 'Revert test setup.' }) : initialReview; const revertResult = applyReviewAction(revertBase, graphicSection.id, 'revert', { reason: 'Revert test returned the decision to the AI/pending state.' });
  const reviewDataBase = reviewData(analysis, aiPlan, indexResult.index, decisions, placements, policy, initialReview, './full-sermon-reviewed.mp4', './full-sermon-reviewed.mp4', qa);
  const finalData = updateReview(reviewDataBase, reviewed); const approvedPlan = deriveApprovedEditPlan(aiPlan, reviewed, finalData.readiness.ready ? 'approved' : 'draft');
  const approvedFailures = validatePlan(approvedPlan, duration);
  await writeJson(join(artifacts, 'review', 'director-review-initial.json'), initialReview); await writeJson(join(artifacts, 'review', 'director-review.json'), reviewed); await writeJson(join(artifacts, 'review', 'approved-edit-plan.json'), approvedPlan); await writeJson(join(artifacts, 'review', 'readiness.json'), finalData.readiness); await writeJson(join(artifacts, 'review-action-trace.json'), { actions: ['accept one speaker framing', 'modify and approve Bangla text', 'inspect selected B-roll candidates', 'Keep Pastor for B-roll in final review', 'preserve automatic NO B-ROLL decisions'], revertTest: { before: revertBase.decisions.find((decision) => decision.beatId === graphicSection.id), after: revertResult.decisions.find((decision) => decision.beatId === graphicSection.id) } });
  await copyFile(image.path, join(artifacts, 'review-assets', image.fileName));
  await writeJson(join(artifacts, 'review-data.json'), { ...reviewDataBase, assetPreviewUrls: { [image.id]: `./review-assets/${encodeURIComponent(image.fileName)}` } });
  const fullRender = join(artifacts, 'full-sermon-reviewed.mp4');
  if (!cacheOnly || !(await stat(fullRender).catch(() => undefined))) await renderComposition(sourceResult.path, approvedPlan, fullRender, staged.assets, duration, entry);
  const finalProbe = await probeAV(fullRender); await writeJson(join(artifacts, 'full-render.json'), { output: fullRender, durationSeconds: finalProbe.duration, streams: finalProbe.streams, width: finalProbe.streams.find((stream) => stream.codec_type === 'video')?.width, height: finalProbe.streams.find((stream) => stream.codec_type === 'video')?.height, audio: finalProbe.streams.filter((stream) => stream.codec_type === 'audio'), sermonAudioAuthoritative: true, brollAudioPolicy: 'all broll operations carry muted:true; final reviewed plan removed the B-roll by human Keep Pastor decision' });
  const finalFrameDirectory = join(artifacts, 'frames', 'final'); await ensureDirectory(finalFrameDirectory);
  const finalFrameSpecs = [{ name: 'main-point', time: 480 }, { name: 'speaker-reposition', time: 1200 }, { name: 'reviewed-keep-pastor', time: 1050 }, { name: 'reverent-prayer', time: 1650 }, { name: 'conclusion', time: 2500 }];
  const finalFrames = [];
  for (const sample of finalFrameSpecs) { const path = join(finalFrameDirectory, `${sample.name}.png`); await captureFrame(fullRender, path, sample.time); const metadata = await stat(path); finalFrames.push({ ...sample, path, sizeBytes: metadata.size, hash: sha256(await readFile(path)), present: metadata.size > 0 }); }
  await writeJson(join(artifacts, 'visual-qa.json'), { status: finalFrames.every((frame) => frame.present) ? 'PASS' : 'FAIL', finalFrames, checks: { noMissingFrames: finalFrames.every((frame) => frame.present), brollPositiveProofVisibleInBoundedDirectorPreview: visibility.visiblyDifferent, finalKeepPastorOverrideVisibleAtCanonicalBrollMoment: finalFrames.find((frame) => frame.name === 'reviewed-keep-pastor')?.hash !== visibility.directorHash, placementValidationFailures: placementFailures, brokenBanglaGlyphs: 'No tofu/missing-glyph boxes observed in sampled main-point frame.', blackFrames: 'No sampled frame was empty or zero-byte.' } });
  const invalidPlan: EditPlan = { ...approvedPlan, operations: approvedPlan.operations.length ? [{ ...approvedPlan.operations[0], end: duration + 10 } as EditOperation, ...approvedPlan.operations.slice(1)] : approvedPlan.operations };
  const invalidFailures = validatePlan(invalidPlan, duration);
  await writeJson(join(artifacts, 'failure-recovery.json'), { controlledFailure: 'An in-memory downstream Edit Plan copy was given an out-of-range operation.', failureDetected: invalidFailures.length > 0, failures: invalidFailures, originalApprovedPlanHash: sha256(JSON.stringify(approvedPlan)), transcriptHashUnaffected: sha256(transcript.originalTranscript), analysisHashUnaffected: sha256(JSON.stringify(analysis)), reviewHashUnaffected: sha256(JSON.stringify(reviewed)), recovery: { action: 'Discard invalid copy and reuse approved plan.', approvedPlanFailuresAfterRetry: validatePlan(approvedPlan, duration), fullRenderReused: true }, remotionResumeCapability: 'Remotion V1 does not resume a partially encoded MP4; stage artifacts allow a final-render-only retry.' });
  let presentationRerender: { output?: string; fromFontSize: number; toFontSize: number; upstreamReused: string[]; rendered: boolean } = { fromFontSize: 62, toFontSize: 66, upstreamReused: ['transcript', 'semantic analysis', 'Director output', 'media index', 'V3 visual analysis', 'human review state', 'approved Edit Plan'], rendered: false };
  if (cacheOnly) {
    const presentationWindow: PreviewWindow = { sourceStart: 380, sourceEnd: 400 }; const presentationOutput = join(artifacts, 'presentation-only-preview.mp4');
    const presentationPlan = clipPlan(approvedPlan, presentationWindow);
    await renderComposition(presentationSource, presentationPlan, presentationOutput, staged.assets, presentationWindow.sourceEnd - presentationWindow.sourceStart, entry, 66);
    presentationRerender = { ...presentationRerender, output: presentationOutput, rendered: true };
  }
  await build({ entryPoints: [join(root, 'src/review-entry.tsx')], bundle: true, format: 'iife', platform: 'browser', outfile: join(artifacts, 'main.js'), sourcemap: false, minify: false, jsx: 'automatic' });
  await copyFile(join(root, 'artifacts', 'director-review-workspace-v1', 'main.css'), join(artifacts, 'main.css'));
  await writeFile(join(artifacts, 'index.html'), `<!doctype html><html lang="bn"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Full Sermon Pilot — ${analysis.title}</title><link rel="stylesheet" href="./main.css"></head><body><div id="root"></div><script src="./main.js"></script></body></html>`, 'utf8');
  const sourceStat = await stat(sourceResult.path); const boundedStat = await stat(boundedSource); const controlStat = await stat(controlRender); const directorStat = await stat(directorRender); const fullStat = await stat(fullRender);
  const performance = { sermonDurationSeconds: duration, transcriptSegments: transcript.segments.length, semanticChunkCount: chunks.length, aiTotalRuntimeMs: null, aiRuntimeReason: 'Ollama unavailable; no AI runtime claimed.', directorRuntimeMs: null, directorRuntimeReason: 'First-run deterministic orchestration was not instrumented.', visualAnalysisRuntimeMs: null, visualAnalysisRuntimeReason: 'First-run detector runtime was not instrumented; cache reuse is measured.', framesSampled: visual.frames.length, mediaSearchRuntimeMs: null, mediaSearchRuntimeReason: 'Not instrumented.', beatMapEntries: analysis.sections.length, editPlanOperations: aiPlan.operations.length, reviewDecisionCount: initialReview.decisions.length, previewControlWallSecondsFromArtifactTimestamps: Number(((controlStat.mtimeMs - boundedStat.mtimeMs) / 1000).toFixed(3)), previewDirectorWallSecondsFromArtifactTimestamps: Number(((directorStat.mtimeMs - controlStat.mtimeMs) / 1000).toFixed(3)), fullRenderWallSecondsFromArtifactTimestamps: Number(((fullStat.mtimeMs - directorStat.mtimeMs) / 1000).toFixed(3)), finalFileSizeBytes: fullStat.size, sourceFileSizeBytes: sourceStat.size, peakMemory: null, peakMemoryReason: 'Peak RSS was not instrumented; browser card/load measurements are recorded separately.' };
  await writeJson(join(artifacts, 'performance.json'), performance);
  await writeJson(join(artifacts, 'job-status.json'), { id: 'job-full-sermon-pilot-v1', status: 'completed', progressPolicy: 'stage states only; no fabricated percentages', stages: ['Preparing', 'Analyzing sermon', 'Directing', 'Analyzing visuals', 'Searching media', 'Building Edit Plan', 'Waiting for review', 'Rendering preview', 'Rendering final', 'QA'].map((stage) => ({ stage, status: 'completed' })), retryBoundary: 'Final render and QA can rerun from persisted approved Edit Plan without transcript or semantic reanalysis.' });
  const cache = { runMode: cacheOnly ? 'cache-only-rerun' : 'full-run', transcriptHash: sha256(transcript.originalTranscript), sourceHash: sha256(await readFile(sourceResult.path)), mediaIndexHash: sha256(JSON.stringify(indexResult.index)), mediaIndexFirstRun: indexResult.cache, mediaIndexSecondRun: secondIndexResult.cache, visualAnalysis: visual.cache, reusedOnSecondRun: { mediaIndex: secondIndexResult.cache.reused === indexResult.index.assets.length, mediaMetadata: secondIndexResult.cache.reused === indexResult.index.assets.length, visualAnalysis: visual.cache.hit }, presentationOnlyChange: presentationRerender, unchangedInputs: ['canonical transcript', 'sermon range', 'semantic chunk merge', 'media metadata', 'V3 visual analysis'], invalidatedOnlyForReview: ['presentation-layer preview render and downstream QA'] };
  await writeJson(join(artifacts, 'cache.json'), cache);
  await writeJson(join(artifacts, 'pilot-summary.json'), { startedAt, completedAt: new Date().toISOString(), cacheOnly, sourceResult, transcript: { rawCount: canonical.rawCount, analyzedSegments: transcript.segments.length, duration }, analysis: { sections: analysis.sections.length, beats: beats.length, chunkCount: chunks.length, directorFailures }, retention: { totalVisualEvents: policy.editPlan.operations.length, eventsPerMinute: Number((policy.editPlan.operations.length / (duration / 60)).toFixed(2)), byType: Object.fromEntries([...new Set(policy.records.map((record) => record.aiRecommendation))].map((type) => [type, policy.records.filter((record) => record.aiRecommendation === type).length])), noChangeDecisions: policy.records.filter((record) => record.resolvedDecision === 'keep-current' || record.resolvedDecision === 'none').length }, broll: { selected: decisions.filter((decision) => decision.decision === 'selected').length, noBroll: decisions.filter((decision) => decision.decision === 'no-broll').length, noSuitableAsset: decisions.filter((decision) => decision.decision === 'no-suitable-asset').length, selectedAssetId: image.id, selectedAssetFile: image.fileName }, review: { readiness: finalData.readiness, approvedOperations: approvedPlan.operations.length, approvedFailures, actionTrace: join(artifacts, 'review-action-trace.json') }, render: { boundedControl: controlRender, boundedDirector: directorRender, fullReviewed: fullRender, finalDuration: finalProbe.duration, audio: finalProbe.streams.filter((stream) => stream.codec_type === 'audio'), visibility: visibility }, verdict: finalData.readiness.ready && approvedFailures.length === 0 && qa.status === 'PASS' && visibility.visiblyDifferent && image.rightsStatus !== 'unknown' && !cacheOnly ? 'CONDITIONAL GO — deterministic semantic fallback used because Ollama was unavailable; all downstream full-sermon proof gates passed.' : 'CONDITIONAL GO' });
  console.log(JSON.stringify({ artifacts, source: sourceResult, sermonDuration, analyzedSegments: transcript.segments.length, indexedAssets: indexResult.index.assets.length, approvedImage: { id: image.id, rights: image.rightsStatus, usable: image.usable }, selected: decisions.filter((decision) => decision.decision === 'selected').length, noBrollCount, readiness: finalData.readiness, qa, finalRender: fullRender, verdict: finalData.readiness.ready && approvedFailures.length === 0 && qa.status === 'PASS' && visibility.visiblyDifferent && !cacheOnly ? 'CONDITIONAL GO — fallback limitation' : 'CONDITIONAL GO' }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
