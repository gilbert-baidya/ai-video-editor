import type { EditOperation, EditPlan, MediaAsset, SermonAnalysis, SermonSection } from '../src/contracts.ts';
import type { ReviewDataPayload } from '../src/DirectorReviewWorkspace.tsx';
import { applyReviewAction, buildBrollReplacementOperation, createInitialReviewState, updateReview, type ReviewBeat, type ReviewState } from '../src/director-review.ts';
import type { ProductProjectRecord } from '../src/product-api.ts';
import { createProductProject, updateProductStage } from '../src/product-workflow.ts';
import { sha256Browser } from '../src/sha256.ts';

export const PROJECT_ID = 'project-editor-fixture';

export const asset: MediaAsset = {
  id: 'media-fixture', path: '/fixture/media/illustration.jpg', relativePath: 'media/illustration.jpg', fileName: 'illustration.jpg', kind: 'image', mimeType: 'image/jpeg',
  sizeBytes: 922012, modifiedAt: '2026-01-01T00:00:00.000Z', contentHash: 'e'.repeat(64), width: 1024, height: 1024, aspectRatio: 1, hasAudio: false, tags: [], categories: [], searchTerms: [],
  rightsStatus: 'approved', rightsBasis: 'owned', libraryRootId: 'local-import', libraryPolicyVersion: '1.0', usable: true, unusableReasons: [],
};

const section = (id: string, start: number, end: number, visualRecommendation: SermonSection['visualRecommendation']): SermonSection => ({
  id, start, end, transcriptText: `Scene ${id}`, sourceSegmentIds: [`seg-${id}`], type: 'story', intensity: 'story-illustration', confidence: 0.9, reason: 'fixture', visualRecommendation,
});

export const sections = [section('section-1', 0, 10, 'image-broll'), section('section-2', 10, 51, 'image-broll'), section('section-3', 51, 72, 'speaker-punch-in')];

export const aiOperations: EditOperation[] = [
  { id: 'policy-section-1', type: 'director-placeholder', start: 0, end: 10, visualType: 'image-broll', reason: 'fixture', confidence: 0.9 },
  { id: 'caption-1', type: 'caption', start: 12, end: 20, text: 'Fixture caption', textTrust: 'approved-display', reason: 'fixture', confidence: 0.9 },
  { id: 'policy-section-2', type: 'director-placeholder', start: 26.5, end: 34.5, visualType: 'image-broll', reason: 'fixture', confidence: 0.9 },
  { id: 'policy-section-3', type: 'speaker-position', start: 51, end: 72, position: 'punch-in', reason: 'fixture', confidence: 0.9 },
];

export function buildWorkspace(): { workspace: ReviewDataPayload; aiPlan: EditPlan; beats: ReviewBeat[] } {
  const aiPlan: EditPlan = { schemaVersion: '2.0', projectId: PROJECT_ID, sourceTranscriptHash: 'hash', operations: aiOperations, status: 'draft', createdBy: { provider: 'fixture', model: 'none' } };
  const beats: ReviewBeat[] = sections.map((s) => ({
    section: s,
    originalOperation: aiPlan.operations.find((operation) => operation.id === `policy-${s.id}`),
    requiredReview: true,
    noBroll: false,
    candidates: s.visualRecommendation === 'image-broll' ? [{ assetId: asset.id, score: 0, semanticScore: 0, categoryScore: 0, technicalScore: 1, rightsScore: 1, repetitionPenalty: 0, reasons: [], eligible: true, asset }] : [],
  }));
  const initialReview = createInitialReviewState({ projectId: PROJECT_ID, aiPlan, beats, directorExecution: undefined }, sha256Browser(JSON.stringify(aiPlan)));
  const workspace = {
    projectId: PROJECT_ID, title: 'Fixture sermon', languageProfile: 'en' as const,
    preview: { controlUrl: `/api/projects/${PROJECT_ID}/source`, directorUrl: `/api/projects/${PROJECT_ID}/source`, durationSeconds: 72, sourceStart: 0, sourceEnd: 72 },
    analysis: { sections, projectId: PROJECT_ID } as unknown as SermonAnalysis, aiPlan,
    mediaIndex: { schemaVersion: '1.0', indexerVersion: 'fixture', createdAt: '', updatedAt: '', roots: [], assets: [asset] },
    beats, qa: { status: 'PASS', failures: [] }, evidence: { explanationChain: '#', placementEvidence: '#', beforeFrame: '/frame.png', duringFrame: '/frame.png', afterFrame: '/frame.png' }, initialReview, assetPreviewUrls: {},
  } as ReviewDataPayload;
  return { workspace, aiPlan, beats };
}

// The review matching the persisted validation project: both B-roll beats resolved with the asset, punch-in accepted.
export function approvedReview(workspace: ReviewDataPayload): ReviewState {
  let review = workspace.initialReview;
  for (const id of ['section-1', 'section-2']) {
    const beat = workspace.beats.find((candidate) => candidate.section.id === id)!;
    review = applyReviewAction(review, id, 'replace-broll', { operation: buildBrollReplacementOperation(beat, asset) });
  }
  return applyReviewAction(review, 'section-3', 'accept');
}

export function approvedPlan(workspace: ReviewDataPayload, review = approvedReview(workspace)): EditPlan {
  return updateReview(workspace, review).approvedPlan;
}

export function projectRecord(overrides: { stages?: Partial<Record<'ingest' | 'transcript' | 'director' | 'review' | 'render' | 'qa', Parameters<typeof updateProductStage>[2]>>; sourceDuration?: number; noSource?: boolean } = {}): ProductProjectRecord {
  let workflow = createProductProject({ projectId: PROJECT_ID, title: 'Fixture sermon', source: { type: 'local-video', fileName: 'sermon.mp4' } });
  const stages = overrides.stages ?? { ingest: { status: 'completed' }, transcript: { status: 'completed' }, director: { status: 'completed' }, review: { status: 'completed' } };
  for (const [name, update] of Object.entries(stages)) workflow = updateProductStage(workflow, name as never, update!);
  workflow = { ...workflow, coveragePercent: 100, render: { ...workflow.render, width: 1080, height: 1920, format: { ...workflow.render.format, orientation: 'portrait', width: 1080, height: 1920 } } };
  return {
    schemaVersion: '1.3', workflow, artifacts: {}, jobs: [], cacheReuse: {},
    sourceMetadata: overrides.noSource ? undefined : { kind: 'local-video', fileName: 'sermon.mp4', width: 1080, height: 1920, durationSeconds: overrides.sourceDuration ?? 72, relativePath: 'source/sermon.mp4', immutable: true },
  };
}
