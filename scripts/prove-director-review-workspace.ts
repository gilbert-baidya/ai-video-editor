import { join, relative, resolve } from 'node:path';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { applyReviewAction, createInitialReviewState, deriveApprovedEditPlan, updateReview, type ReviewWorkspaceData } from '../src/director-review.ts';
import type { BrollDecision, EditPlan, MediaIndex, SermonAnalysis, SermonSection, TranscriptDocument } from '../src/contracts.ts';
import { ensureDirectory, readJson, run, sha256, validatePlan, writeJson } from '../src/foundation.ts';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'artifacts', 'director-review-workspace-v1');
const v4Artifacts = join(root, 'artifacts', 'director-v4-local-broll');
const priorArtifacts = join(root, 'artifacts', 'director-structured-output');
const previewDuration = 120;

function urlFor(filePath: string): string {
  const path = relative(root, filePath).split('/').map(encodeURIComponent).join('/');
  return `/artifacts/${path.replace(/^artifacts\//u, '')}`;
}

async function renderReviewed(plan: EditPlan, outputPath: string, mediaIndex: MediaIndex): Promise<void> {
  const entry = await bundle({ entryPoint: join(root, 'src/entry.tsx'), publicDir: join(root, 'public'), webpackOverride: (config) => config });
  const inputProps = { sourcePath: 'director-v4-preview-source.mp4', editPlan: plan, graphicFontSize: 62, mediaAssets: mediaIndex.assets };
  const composition = await selectComposition({ serveUrl: entry, id: 'BanglaFoundation', inputProps });
  await renderMedia({ composition, serveUrl: entry, codec: 'h264', outputLocation: outputPath, inputProps, audioCodec: 'aac' });
}

async function captureFrame(videoPath: string, outputPath: string, time: number): Promise<void> {
  await run('/opt/homebrew/bin/ffmpeg', ['-y', '-ss', String(time), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outputPath]);
}

function sourceHash(transcript: TranscriptDocument): string {
  return sha256(transcript.originalTranscript);
}

async function main(): Promise<void> {
  await ensureDirectory(artifacts);
  await ensureDirectory(join(artifacts, 'review'));
  await ensureDirectory(join(artifacts, 'frames'));
  await ensureDirectory(join(artifacts, 'review-assets'));
  const analysis = await readJson<SermonAnalysis>(join(priorArtifacts, 'analysis', 'sermon-analysis.json'));
  const transcript = await readJson<TranscriptDocument>(join(priorArtifacts, 'input-transcript.json'));
  const aiPlan = await readJson<EditPlan>(join(v4Artifacts, 'edit-plan.json'));
  const mediaIndex = await readJson<MediaIndex>(join(v4Artifacts, 'media-index', 'index.json'));
  const brollDecisions = await readJson<BrollDecision[]>(join(v4Artifacts, 'candidate-rankings.json'));
  const placementEvidence = await readJson<Array<{ selectedAssetId?: string; placement?: ReviewWorkspaceData['beats'][number]['placement'] }>>(join(v4Artifacts, 'placement-evidence.json'));
  const qa = await readJson<{ status: string; failures: string[]; [key: string]: unknown }>(join(v4Artifacts, 'qa.json'));
  const previewMeta = await readJson<{ sourceStart: number; sourceEnd: number; duration: number }>(join(v4Artifacts, 'preview-meta.json'));
  const explanationChainPath = join(v4Artifacts, 'explanation-chain.json');

  const pressureCooker = mediaIndex.assets.find((asset) => asset.fileName === 'Pressure Cooker.png');
  if (!pressureCooker) throw new Error('Pressure Cooker.png is missing from the real V4.1 media index.');
  await copyFile(pressureCooker.path, join(artifacts, 'review-assets', 'Pressure Cooker.png'));
  const assetPreviewUrls: Record<string, string> = { [pressureCooker.id]: urlFor(join(artifacts, 'review-assets', 'Pressure Cooker.png')) };
  for (const asset of mediaIndex.assets) if (asset.thumbnailPath) assetPreviewUrls[asset.id] = urlFor(asset.thumbnailPath);

  const beats = analysis.sections.map((section: SermonSection) => {
    const brollDecision = brollDecisions.find((decision) => decision.intent.sectionId === section.id);
    const evidence = placementEvidence.find((item) => item.selectedAssetId === brollDecision?.selectedAssetId);
    const selectedAsset = brollDecision?.selectedAssetId ? mediaIndex.assets.find((asset) => asset.id === brollDecision.selectedAssetId) : undefined;
    const candidates = (brollDecision?.candidates ?? []).map((candidate) => ({ ...candidate, asset: mediaIndex.assets.find((asset) => asset.id === candidate.assetId) }));
    const originalOperation = aiPlan.operations.find((operation) => operation.id === `broll-${section.id}`) ?? aiPlan.operations.find((operation) => operation.id === `policy-${section.id}`);
    const noBroll = brollDecision?.decision === 'no-broll' || !brollDecision;
    return { section, originalOperation, brollDecision, selectedAsset, placement: evidence?.placement, candidates, requiredReview: Boolean(originalOperation || brollDecision?.decision === 'selected'), noBroll };
  });
  const sourceEditPlanHash = sha256(JSON.stringify(aiPlan));
  const initialReview = createInitialReviewState({ projectId: transcript.projectId, aiPlan, beats }, sourceEditPlanHash);
  const data: ReviewWorkspaceData = {
    projectId: transcript.projectId,
    title: analysis.title ?? 'Intervention Sermon — Director Review',
    languageProfile: 'bn',
    preview: { controlUrl: urlFor(join(v4Artifacts, 'control-preview.mp4')), directorUrl: urlFor(join(v4Artifacts, 'director-preview.mp4')), durationSeconds: previewDuration, sourceStart: previewMeta.sourceStart, sourceEnd: previewMeta.sourceEnd },
    analysis,
    aiPlan,
    mediaIndex,
    beats,
    qa,
    evidence: {
      explanationChain: urlFor(explanationChainPath),
      placementEvidence: urlFor(join(v4Artifacts, 'placement-evidence.json')),
      beforeFrame: urlFor(join(v4Artifacts, 'frames', 'before-broll.png')),
      duringFrame: urlFor(join(v4Artifacts, 'frames', 'during-broll.png')),
      afterFrame: urlFor(join(v4Artifacts, 'frames', 'after-broll.png')),
    },
    initialReview,
  };
  await writeJson(join(artifacts, 'review-data.json'), { ...data, assetPreviewUrls });
  await writeJson(join(artifacts, 'review', 'director-review-initial.json'), initialReview);

  // Proof state: reject the pressure-cooker takeover to Keep Pastor, reject the
  // unverified Scripture card, and explicitly approve a real Bangla display line.
  let reviewed = applyReviewAction(initialReview, 'section-3', 'keep-pastor', { reason: 'Human override proof: keep the pastor for this review pass; the AI B-roll proposal remains recoverable.' });
  reviewed = applyReviewAction(reviewed, 'section-1', 'reject', { reason: 'Keep Pastor: unverified Scripture reference is not promoted to a final card.' });
  reviewed = applyReviewAction(reviewed, 'section-2', 'approve-text', { displayText: 'প্রার্থনা করছেন আর উত্তর আপনার দরজার সামনে দাঁড়িয়ে আছে', reason: 'Approved Bangla display text derived from the canonical sermon wording.' });
  reviewed = applyReviewAction(reviewed, 'section-4', 'accept', { reason: 'Accepted the speaker-led application state with no visual takeover.' });
  const finalData = updateReview(data, reviewed);
  const approvedPlan = deriveApprovedEditPlan(aiPlan, reviewed, finalData.readiness.ready ? 'approved' : 'draft');
  const reviewedPlanFailures = validatePlan(approvedPlan, previewDuration);

  const aiPreview = join(artifacts, 'original-ai-preview.mp4');
  const reviewedPreview = join(artifacts, 'reviewed-preview.mp4');
  await copyFile(join(v4Artifacts, 'director-preview.mp4'), aiPreview);
  await renderReviewed(approvedPlan, reviewedPreview, mediaIndex);
  const originalFrame = join(artifacts, 'frames', 'original-ai-60s.png');
  const reviewedFrame = join(artifacts, 'frames', 'reviewed-60s.png');
  await captureFrame(aiPreview, originalFrame, 60);
  await captureFrame(reviewedPreview, reviewedFrame, 60);
  const renderBefore = await readFile(originalFrame);
  const renderAfter = await readFile(reviewedFrame);
  const probe = JSON.parse(await run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=codec_name,codec_type,sample_rate,channels', '-of', 'json', reviewedPreview])) as { format?: { duration?: string }; streams?: Array<{ codec_name?: string; codec_type?: string; sample_rate?: string; channels?: number }> };
  const reviewCache = {
    cacheVersion: 'director-review-cache-v1',
    unchangedInputs: {
      source: sha256(await readFile(join(v4Artifacts, 'preview-source.mp4'))),
      transcript: sourceHash(transcript),
      sermonAnalysis: sha256(JSON.stringify(analysis)),
      aiEditPlan: sourceEditPlanHash,
      mediaIndex: sha256(JSON.stringify(mediaIndex)),
      visualAnalysis: sha256(await readFile(join(v4Artifacts, 'placement-visual-analysis.json'))),
    },
    changedInput: { reviewState: sha256(JSON.stringify(reviewed)) },
    reused: ['source', 'transcript', 'sermon-analysis', 'AI semantic Director output', 'media index', 'V3 visual-analysis artifacts'],
    invalidated: ['reviewed Edit Plan', 'reviewed preview render', 'downstream QA'],
    rerun: { transcription: false, sermonAnalysis: false, mediaIndex: false, visualAnalysis: false, reviewedRender: true },
  };
  const reviewProof = {
    status: finalData.readiness.ready && reviewedPlanFailures.length === 0 ? 'PASS' : 'FAIL',
    inputArtifacts: ['real Bengali sermon analysis', 'V4.1 control and Director previews', 'V4.1 candidate rankings', 'V4.1 V3 placement evidence'],
    decisions: reviewed.decisions,
    readiness: finalData.readiness,
    reviewedPlanFailures,
    render: { originalAiPreview: aiPreview, reviewedPreview, originalFrame, reviewedFrame, changedAt60s: sha256(renderBefore) !== sha256(renderAfter), duration: Number(probe.format?.duration ?? 0), audio: probe.streams?.filter((stream) => stream.codec_type === 'audio') },
    ui: { entry: join(artifacts, 'index.html'), data: join(artifacts, 'review-data.json') },
  };
  await writeJson(join(artifacts, 'review', 'director-review.json'), reviewed);
  await writeJson(join(artifacts, 'review', 'approved-edit-plan.json'), approvedPlan);
  await writeJson(join(artifacts, 'review', 'readiness.json'), finalData.readiness);
  await writeJson(join(artifacts, 'review-cache.json'), reviewCache);
  await writeJson(join(artifacts, 'review-proof.json'), reviewProof);

  await build({ entryPoints: [join(root, 'src/review-entry.tsx')], bundle: true, format: 'iife', platform: 'browser', outfile: join(artifacts, 'main.js'), sourcemap: false, minify: false, jsx: 'automatic' });
  await writeFile(join(artifacts, 'index.html'), `<!doctype html><html lang="bn"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Director Review — ${analysis.title ?? 'Bengali Sermon'}</title><link rel="stylesheet" href="./main.css"></head><body><div id="root"></div><script src="./main.js"></script></body></html>`, 'utf8');
  console.log(JSON.stringify({ artifacts, ui: join(artifacts, 'index.html'), decisions: reviewed.decisions.length, readiness: finalData.readiness, approvedOperations: approvedPlan.operations.length, reviewedPlanFailures, changedAt60s: reviewProof.render.changedAt60s }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
