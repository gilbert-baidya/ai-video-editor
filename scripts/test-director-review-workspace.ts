import {
  applyReviewAction,
  createInitialReviewState,
  deriveApprovedEditPlan,
  evaluateReviewReadiness,
  type ReviewWorkspaceData,
} from '../src/director-review.ts';
import type { EditOperation, EditPlan, MediaAsset, SermonSection } from '../src/contracts.ts';
import { sha256Browser } from '../src/sha256.ts';

const section = (id: string, start: number, visualRecommendation: SermonSection['visualRecommendation'], extra: Partial<SermonSection> = {}): SermonSection => ({
  id,
  start,
  end: start + 10,
  transcriptText: `মূল বাংলা বক্তব্য ${id}`,
  sourceSegmentIds: [`segment-${id}`],
  type: visualRecommendation === 'scripture-card' ? 'scripture-reading' : 'teaching',
  visualRecommendation,
  confidence: 0.9,
  reason: 'Office-safe fixture.',
  ...extra,
});

function fixture(): ReviewWorkspaceData {
  const scripture = section('section-1', 0, 'scripture-card', { scriptureReference: 'যোহন ৩:১৬', suggestedDisplayText: 'যোহন ৩:১৬' });
  const text = section('section-2', 10, 'keyword-graphic', { suggestedDisplayText: 'বিশ্বাসে স্থির থাকুন' });
  const broll = section('section-3', 20, 'image-broll');
  const noChange = section('section-4', 30, 'speaker-full');
  const textOperation: EditOperation = { id: 'policy-section-2', type: 'sermon-point', start: 10, end: 20, text: 'বিশ্বাসে স্থির থাকুন', position: 'right', style: 'keyword', reason: 'Fixture', confidence: 0.9 };
  const brollOperation: EditOperation = { id: 'broll-section-3', type: 'broll', sourceStart: 0, sourceEnd: 5, start: 20, end: 30, assetId: 'asset-1', mode: 'full-screen', muted: true, reason: 'Fixture', confidence: 0.9 };
  const asset: MediaAsset = {
    id: 'asset-1', path: '/fixture/image.png', relativePath: 'image.png', fileName: 'image.png', kind: 'image', mimeType: 'image/png',
    sizeBytes: 100, modifiedAt: '2026-01-01T00:00:00.000Z', width: 1920, height: 1080, aspectRatio: 16 / 9, hasAudio: false,
    tags: [], categories: [], searchTerms: [], rightsStatus: 'owned', rightsSource: 'library-root-default', libraryRootId: 'root', libraryPolicyVersion: '1', usable: true, unusableReasons: [],
  };
  const aiPlan: EditPlan = {
    schemaVersion: '1.0', projectId: 'office-safe-review', sourceTranscriptHash: sha256Browser('মূল বাংলা বক্তব্য'),
    operations: [textOperation, brollOperation], status: 'draft', createdBy: { provider: 'fixture-ai', model: 'fixture-model' },
  };
  const beats: ReviewWorkspaceData['beats'] = [
    { section: scripture, candidates: [], requiredReview: true, noBroll: true },
    { section: text, originalOperation: textOperation, candidates: [], requiredReview: true, noBroll: true },
    { section: broll, originalOperation: brollOperation, selectedAsset: asset, brollDecision: { intent: { sectionId: broll.id, start: broll.start, end: broll.end, decision: 'search', reason: 'Fixture' }, candidates: [], selectedAssetId: asset.id, decision: 'selected', reason: 'Fixture' }, candidates: [], requiredReview: true, noBroll: false },
    { section: noChange, candidates: [], requiredReview: false, noBroll: true },
  ];
  const initialReview = createInitialReviewState({ projectId: aiPlan.projectId, aiPlan, beats }, sha256Browser(JSON.stringify(aiPlan)));
  initialReview.purpose = 'functional-test';
  return {
    projectId: aiPlan.projectId, title: 'Office-safe Bengali review', languageProfile: 'bn',
    preview: { controlUrl: '', directorUrl: '', durationSeconds: 40, sourceStart: 0, sourceEnd: 40 },
    analysis: { version: 'fixture', projectId: aiPlan.projectId, supportingPassages: [], sections: [scripture, text, broll, noChange], mainPoints: [], keyStatements: [], illustrations: [], stories: [], testimonies: [], questions: [], applications: [], prayerMoments: [], emotionalMoments: [], confidence: 0.9 },
    aiPlan,
    mediaIndex: { schemaVersion: '1', indexerVersion: '1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', roots: [], assets: [asset] },
    beats, qa: { status: 'PASS', failures: [] },
    evidence: { explanationChain: '', placementEvidence: '', beforeFrame: '', duringFrame: '', afterFrame: '' },
    initialReview,
  };
}

const data = fixture();
const initial = data.initialReview;
const broll = data.beats.find((beat) => beat.section.id === 'section-3');
if (!broll?.originalOperation) throw new Error('Review fixture has no B-roll AI operation.');

const accepted = applyReviewAction(initial, 'section-3', 'accept');
if (!deriveApprovedEditPlan(data.aiPlan, accepted).operations.some((operation) => operation.id === broll.originalOperation?.id)) throw new Error('Accept did not preserve B-roll.');
const rejected = applyReviewAction(accepted, 'section-3', 'reject');
if (deriveApprovedEditPlan(data.aiPlan, rejected).operations.some((operation) => operation.id === broll.originalOperation?.id)) throw new Error('Reject did not remove B-roll.');
if (applyReviewAction(accepted, 'section-3', 'modify').decisions.find((decision) => decision.beatId === 'section-3')?.status !== 'modified') throw new Error('Modify did not persist.');
if (applyReviewAction(accepted, 'section-3', 'replace-broll', { operation: broll.originalOperation }).decisions.find((decision) => decision.beatId === 'section-3')?.status !== 'modified') throw new Error('Replace did not persist.');
if (applyReviewAction(rejected, 'section-3', 'revert').decisions.find((decision) => decision.beatId === 'section-3')?.status !== 'pending') throw new Error('Revert did not restore pending.');

const canonicalBefore = data.beats.find((beat) => beat.section.id === 'section-2')!.section.transcriptText;
const approvedBengali = 'প্রার্থনা করছেন আর উত্তর আপনার দরজার সামনে দাঁড়িয়ে আছে';
const textApproved = applyReviewAction(initial, 'section-2', 'approve-text', { displayText: approvedBengali });
if (textApproved.decisions.find((decision) => decision.beatId === 'section-2')?.approvedDisplayText !== approvedBengali) throw new Error('Bengali display text changed.');
const approvedTextPlan = deriveApprovedEditPlan(data.aiPlan, textApproved);
const approvedTextOperation = approvedTextPlan.operations.find((operation) => operation.id === 'policy-section-2');
if (approvedTextOperation?.type !== 'sermon-point' || approvedTextOperation.text !== approvedBengali) {
  throw new Error('Approved Bengali display text did not reach the final Edit Plan.');
}
if (data.beats.find((beat) => beat.section.id === 'section-2')!.section.transcriptText !== canonicalBefore) throw new Error('Canonical Bengali transcript changed.');
if (!evaluateReviewReadiness(data, accepted, 40).blockers.some((blocker) => blocker.includes('section-1'))) throw new Error('Unverified Scripture did not block readiness.');

console.log(JSON.stringify({
  status: 'PASS',
  mode: 'office-safe-fixture',
  checks: ['accept', 'reject', 'modify', 'replace', 'revert', 'Bengali display text approval and plan realization', 'canonical transcript immutability', 'Scripture readiness blocker'],
}, null, 2));
