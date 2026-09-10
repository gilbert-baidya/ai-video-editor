import type {
  BrollDecision,
  EditOperation,
  EditPlan,
  MediaAsset,
  MediaCandidate,
  MediaIndex,
  PlacementDecision,
  SermonAnalysis,
  SermonSection,
} from './contracts.ts';
import type { DirectorExecutionProvenance, DirectorExecutionSource } from './director-execution.ts';
import { sha256Browser as sha256 } from './sha256.ts';
import type { PolicyDecisionRecord } from './visual-policy.ts';
import type { DirectorQualitySummary } from './editorial-opportunity.ts';
import type { DirectorEditorialEnrichmentResult } from './director-enrichment.ts';

function validateReviewPlan(plan: EditPlan, duration: number): string[] {
  const failures: string[] = [];
  for (const operation of plan.operations) {
    if (operation.start < 0 || operation.end <= operation.start) failures.push(`${operation.id}: invalid time range`);
    if (operation.end > duration) failures.push(`${operation.id}: exceeds media duration`);
  }
  for (let index = 0; index < plan.operations.length; index += 1) {
    for (let next = index + 1; next < plan.operations.length; next += 1) {
      const left = plan.operations[index];
      const right = plan.operations[next];
      if (left.type !== 'caption' && right.type !== 'caption' && left.start < right.end && right.start < left.end) failures.push(`${left.id}/${right.id}: illegal overlap`);
    }
  }
  return failures;
}

export type ReviewStatus = 'pending' | 'accepted' | 'modified' | 'rejected';
export type ReviewAction = 'accept' | 'reject' | 'keep-pastor' | 'modify' | 'replace-broll' | 'approve-text' | 'revert';

export interface ReviewDecision {
  beatId: string;
  status: ReviewStatus;
  originalOperation?: EditOperation;
  reviewedOperation?: EditOperation;
  reviewerReason?: string;
  approvedDisplayText?: string;
  reviewedAt?: string;
  safeNoChange?: boolean;
  originalProvenance: DirectorExecutionSource;
  provenance: DirectorExecutionSource | 'human-override';
  resolution?: 'accepted' | 'modified' | 'rejected' | 'keep-pastor-static';
}

export interface ReviewState {
  schemaVersion: '1.0';
  projectId: string;
  sourceEditPlanHash: string;
  decisions: ReviewDecision[];
  updatedAt: string;
  purpose?: 'editorial' | 'functional-test';
}

export interface ReviewBeat {
  section: SermonSection;
  originalOperation?: EditOperation;
  brollDecision?: BrollDecision;
  selectedAsset?: MediaAsset;
  placement?: PlacementDecision;
  candidates: Array<MediaCandidate & { asset?: MediaAsset }>;
  requiredReview: boolean;
  noBroll: boolean;
  provenance?: DirectorExecutionProvenance;
}

export interface ReviewReadiness {
  ready: boolean;
  label: 'READY FOR FINAL RENDER' | 'REVIEW BLOCKED';
  blockers: string[];
  warnings: string[];
}

export interface ReviewWorkspaceData {
  projectId: string;
  title: string;
  languageProfile: 'bn' | 'en' | 'mixed';
  preview: {
    controlUrl: string;
    directorUrl: string;
    durationSeconds: number;
    sourceStart: number;
    sourceEnd: number;
  };
  analysis: SermonAnalysis;
  directorExecution?: DirectorExecutionProvenance;
  aiPlan: EditPlan;
  mediaIndex: MediaIndex;
  beats: ReviewBeat[];
  qa: { status: string; failures: string[]; [key: string]: unknown };
  evidence: {
    explanationChain: string;
    placementEvidence: string;
    beforeFrame: string;
    duringFrame: string;
    afterFrame: string;
  };
  initialReview: ReviewState;
  policyRecords?: PolicyDecisionRecord[];
  directorQuality?: DirectorQualitySummary;
  editorialEnrichment?: Pick<DirectorEditorialEnrichmentResult, 'outcome' | 'enrichmentAttemptCount' | 'error'> & {
    provider?: string;
    model?: string;
    cacheReused: boolean;
  };
}

export interface ReviewedWorkspaceData extends ReviewWorkspaceData {
  review: ReviewState;
  approvedPlan: EditPlan;
  readiness: ReviewReadiness;
}

function operationBeatId(operation: EditOperation): string | undefined {
  if (operation.type === 'broll') return operation.id.replace(/^broll-/, '');
  if (operation.id.startsWith('policy-')) return operation.id.replace(/^policy-/, '');
  if (operation.id.startsWith('visual-')) return operation.id.replace(/^visual-/, '');
  if (operation.id.startsWith('beat-')) return operation.id.replace(/^beat-/, '');
  return undefined;
}

export function operationForBeat(plan: EditPlan, beatId: string): EditOperation | undefined {
  return plan.operations.find((operation) => operationBeatId(operation) === beatId);
}

export function createInitialReviewState(data: Pick<ReviewWorkspaceData, 'projectId' | 'aiPlan' | 'beats' | 'directorExecution'>, sourceEditPlanHash: string): ReviewState {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    projectId: data.projectId,
    sourceEditPlanHash,
    decisions: data.beats.map((beat) => {
      const originalProvenance = beat.provenance?.source ?? data.directorExecution?.source ?? (data.aiPlan.createdBy.provider.includes('deterministic') ? 'deterministic-fallback' : 'ai');
      return {
        beatId: beat.section.id,
        status: beat.requiredReview ? 'pending' : 'accepted',
        originalOperation: beat.originalOperation,
        reviewedOperation: beat.requiredReview ? undefined : beat.originalOperation,
        reviewerReason: beat.requiredReview ? undefined : 'No visual operation: speaker-led state is preserved by policy.',
        safeNoChange: !beat.requiredReview,
        originalProvenance,
        provenance: originalProvenance,
        reviewedAt: beat.requiredReview ? undefined : now,
        resolution: beat.requiredReview ? undefined : 'accepted',
      };
    }),
    updatedAt: now,
    purpose: 'editorial',
  };
}

function reviewedOperationFor(decision: ReviewDecision): EditOperation | undefined {
  if (decision.status === 'rejected') {
    if (decision.resolution !== 'keep-pastor-static' || !decision.originalOperation) return undefined;
    return {
      id: `keep-pastor-${decision.beatId}`,
      type: 'no-change',
      start: decision.originalOperation.start,
      end: decision.originalOperation.end,
      mode: 'keep-pastor-static',
      reason: decision.reviewerReason ?? 'Keep Pastor — static.',
      confidence: 1,
    };
  }
  if (decision.status === 'modified') return decision.reviewedOperation;
  return decision.originalOperation;
}

export function deriveApprovedEditPlan(aiPlan: EditPlan, review: ReviewState, status: EditPlan['status'] = 'approved'): EditPlan {
  if (review.projectId !== aiPlan.projectId) throw new Error('Review project does not match the Edit Plan.');
  if (review.sourceEditPlanHash !== sha256(JSON.stringify(aiPlan))) throw new Error('Review state belongs to a different Edit Plan.');
  const decisions = new Map(review.decisions.map((decision) => [decision.beatId, decision]));
  const operations = aiPlan.operations.flatMap((operation): EditOperation[] => {
    const beatId = operationBeatId(operation);
    if (!beatId) return [operation];
    const decision = decisions.get(beatId);
    if (!decision) return [operation];
    const resolved = reviewedOperationFor(decision);
    if (!resolved) return [];
    if (decision.approvedDisplayText && (resolved.type === 'sermon-point' || resolved.type === 'full-screen-card' || resolved.type === 'caption')) {
      return [{ ...resolved, text: decision.approvedDisplayText, textTrust: 'approved-display' as const }];
    }
    return [resolved];
  });
  return { ...aiPlan, operations, status };
}

export function isReviewStateCompatible(data: Pick<ReviewWorkspaceData, 'projectId' | 'aiPlan'>, value: unknown): value is ReviewState {
  if (!value || typeof value !== 'object') return false;
  const review = value as Partial<ReviewState>;
  return review.schemaVersion === '1.0'
    && review.projectId === data.projectId
    && review.sourceEditPlanHash === sha256(JSON.stringify(data.aiPlan))
    && Array.isArray(review.decisions)
    && review.purpose !== 'functional-test';
}

export function applyReviewAction(state: ReviewState, beatId: string, action: ReviewAction, options: { operation?: EditOperation; displayText?: string; reason?: string } = {}): ReviewState {
  const decisions: ReviewDecision[] = state.decisions.map((decision): ReviewDecision => {
    if (decision.beatId !== beatId) return decision;
    const now = new Date().toISOString();
    if (action === 'revert') return { ...decision, status: (decision.safeNoChange ? 'accepted' : 'pending') as ReviewStatus, reviewedOperation: decision.safeNoChange ? decision.originalOperation : undefined, approvedDisplayText: undefined, reviewerReason: decision.safeNoChange ? 'No visual operation: speaker-led state is preserved by policy.' : undefined, reviewedAt: decision.safeNoChange ? now : undefined, provenance: decision.originalProvenance ?? 'ai', resolution: decision.safeNoChange ? 'accepted' : undefined };
    if (action === 'accept') return { ...decision, status: 'accepted', reviewedOperation: decision.originalOperation, reviewerReason: options.reason ?? 'Accepted the resolved Director operation.', reviewedAt: now, provenance: 'human-override', resolution: 'accepted' };
    if (action === 'reject' || action === 'keep-pastor') return { ...decision, status: 'rejected', reviewedOperation: undefined, reviewerReason: options.reason ?? (action === 'keep-pastor' ? 'Keep Pastor — static: explicitly preserve the speaker-led source without the proposed takeover.' : 'Rejected the proposed creative operation.'), reviewedAt: now, provenance: 'human-override', resolution: action === 'keep-pastor' ? 'keep-pastor-static' : 'rejected' };
    if (action === 'modify' || action === 'replace-broll') return { ...decision, status: 'modified', reviewedOperation: options.operation ?? decision.originalOperation, reviewerReason: options.reason ?? 'Modified during human review.', reviewedAt: now, provenance: 'human-override', resolution: 'modified' };
    if (action === 'approve-text') return { ...decision, status: decision.status === 'pending' ? 'modified' : decision.status, reviewedOperation: decision.reviewedOperation ?? decision.originalOperation, approvedDisplayText: options.displayText?.trim(), reviewerReason: options.reason ?? 'Display text explicitly approved by the reviewer.', reviewedAt: now, provenance: 'human-override', resolution: 'modified' };
    return decision;
  });
  return { ...state, decisions, updatedAt: new Date().toISOString() };
}

export function evaluateReviewReadiness(data: Pick<ReviewWorkspaceData, 'beats' | 'qa' | 'aiPlan' | 'mediaIndex' | 'directorQuality'>, review: ReviewState, durationSeconds: number): ReviewReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const decisions = new Map(review.decisions.map((decision) => [decision.beatId, decision]));
  for (const beat of data.beats) {
    const decision = decisions.get(beat.section.id);
    if (beat.requiredReview && (!decision || decision.status === 'pending')) blockers.push(`${beat.section.id}: human review is still pending.`);
    const resolvedOperation = decision ? reviewedOperationFor(decision) : beat.originalOperation;
    if (resolvedOperation?.type === 'broll') {
      const asset = data.mediaIndex.assets.find((candidate) => candidate.id === resolvedOperation.assetId);
      if (!asset) blockers.push(`${beat.section.id}: selected B-roll asset is missing from the media index.`);
      else {
        console.log("CHECKING RIGHTS:", asset.rightsStatus); if (asset.rightsStatus !== 'approved') { console.log("ADDING BLOCKER"); blockers.push(`${beat.section.id}: selected media rights require review.`); }
        if (!asset.usable) blockers.push(`${beat.section.id}: selected media is technically unusable.`);
      }
    }
    if (resolvedOperation?.type === 'director-placeholder') {
      blockers.push(`${beat.section.id}: unresolved ${resolvedOperation.visualType} recommendation requires an approved renderer operation or Keep Pastor.`);
    }
    if (beat.section.visualRecommendation === 'scripture-card' && decision?.status !== 'rejected' && beat.section.scriptureReference) blockers.push(`${beat.section.id}: Scripture reference is unverified; no final Scripture card may be approved.`);
    if (beat.section.suggestedDisplayText && decision?.approvedDisplayText === undefined && decision?.status !== 'rejected' && beat.originalOperation?.type === 'sermon-point') blockers.push(`${beat.section.id}: AI display text is not approved.`);
  }
  const plan = deriveApprovedEditPlan(data.aiPlan, review, 'approved');
  blockers.push(...validateReviewPlan(plan, durationSeconds));
  if (data.qa.status !== 'PASS') blockers.push(...data.qa.failures.map((failure) => `QA: ${failure}`));
  if (data.directorQuality?.status === 'LOW-ACTIVITY') warnings.push(`Director quality is LOW-ACTIVITY: ${data.directorQuality.reason}`);
  if (data.beats.some((beat) => beat.noBroll)) warnings.push('No-B-roll decisions remain active for speaker-led and application moments.');
  return { ready: blockers.length === 0, label: blockers.length === 0 ? 'READY FOR FINAL RENDER' : 'REVIEW BLOCKED', blockers, warnings };
}

export function updateReview(data: ReviewWorkspaceData, review: ReviewState): ReviewedWorkspaceData {
  const readiness = evaluateReviewReadiness(data, review, data.preview.durationSeconds);
  return { ...data, review, approvedPlan: deriveApprovedEditPlan(data.aiPlan, review, readiness.ready ? 'approved' : 'draft'), readiness };
}
