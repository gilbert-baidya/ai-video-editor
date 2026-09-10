import type { EditOperation, EditPlan, MediaAsset, SermonAnalysis, SermonSection } from './contracts.ts';
import type { ReviewState, ReviewWorkspaceData } from './director-review.ts';
import type { VideoFormatProfile } from './video-format.ts';

export type MeaningfulEditKind = 'layout-change' | 'broll' | 'scripture-card' | 'sermon-point' | 'caption' | 'reframe' | 'title-treatment' | 'visual-reset';

export interface MeaningfulEditEvent {
  operationId: string;
  kind: MeaningfulEditKind;
  start: number;
  end: number;
}

export interface PlanRealizationAudit {
  approvedOperations: string[];
  renderedOperations: string[];
  droppedOperations: Array<{ operationId: string; reason: string }>;
  unsupportedOperations: Array<{ operationId: string; reason: string }>;
}

export interface EditorialActivitySummary {
  canonicalCoveragePercent: number;
  meaningfulEditCount: number;
  meaningfulEditDuration: number;
  eventsPerMinute: number;
  keepPastorDuration: number;
  noChangeDuration: number;
  graphics: number;
  broll: number;
  scripture: number;
  reframes: number;
  captions: number;
}

export interface EditorialQualityResult {
  contractVersion: typeof EDITORIAL_QUALITY_CONTRACT_VERSION;
  passed: boolean;
  failures: string[];
  failureCodes: EditorialQualityFailureCode[];
  warnings: string[];
  activity: EditorialActivitySummary;
  staticStretches: Array<{ sectionId: string; start: number; end: number; reason: string }>;
  realization: PlanRealizationAudit;
}

export const EDITORIAL_QUALITY_CONTRACT_VERSION = 'editorial-quality-v1.3.1';
export type EditorialQualityFailureCode = 'FORMAT_INTEGRITY' | 'EDIT_ACTIVITY' | 'PLAN_REALIZATION' | 'TEXT_QUALITY' | 'START_END_POLISH';

export interface CreativeOperationTrace {
  beatId: string;
  directorDecision: string;
  policyDecision: string;
  reviewDecision: string;
  approvedOperation: string;
  rendererOperation: 'REALIZED' | 'DROPPED' | 'UNSUPPORTED' | 'NOT_APPLICABLE';
}

function meaningfulKind(operation: EditOperation): MeaningfulEditKind | undefined {
  if (operation.type === 'broll') return 'broll';
  if (operation.type === 'caption') return 'caption';
  if (operation.type === 'full-screen-card') return operation.style.includes('scripture') ? 'scripture-card' : 'title-treatment';
  if (operation.type === 'sermon-point') return operation.style.includes('scripture') ? 'scripture-card' : 'sermon-point';
  if (operation.type === 'speaker-position') return operation.position === 'punch-in' ? 'reframe' : operation.position === 'full' ? 'visual-reset' : 'layout-change';
  return undefined;
}

export function meaningfulEditEvents(plan: EditPlan): MeaningfulEditEvent[] {
  return plan.operations.flatMap((operation) => {
    const kind = meaningfulKind(operation);
    return kind ? [{ operationId: operation.id, kind, start: operation.start, end: operation.end }] : [];
  });
}

function realizedBroll(operation: Extract<EditOperation, { type: 'broll' }>, mediaAssets: MediaAsset[]): string | undefined {
  const asset = mediaAssets.find((candidate) => candidate.id === operation.assetId);
  if (!asset) return 'Approved B-roll asset is missing from the render media set.';
  if (!asset.usable) return 'Approved B-roll asset is technically unusable.';
  if (asset.rightsStatus !== 'approved') return `Approved B-roll rights status is ${asset.rightsStatus}.`;
  return undefined;
}

export function auditPlanRealization(approvedPlan: EditPlan, mediaAssets: MediaAsset[], renderedOperationIds?: string[]): PlanRealizationAudit {
  const renderedOperations: string[] = [];
  const unsupportedOperations: PlanRealizationAudit['unsupportedOperations'] = [];
  for (const operation of approvedPlan.operations) {
    if (operation.type === 'director-placeholder') {
      unsupportedOperations.push({ operationId: operation.id, reason: `Unresolved ${operation.visualType} recommendation has no renderer operation.` });
      continue;
    }
    if (operation.type === 'broll') {
      const issue = realizedBroll(operation, mediaAssets);
      if (issue) {
        unsupportedOperations.push({ operationId: operation.id, reason: issue });
        continue;
      }
    }
    if (!renderedOperationIds || renderedOperationIds.includes(operation.id)) renderedOperations.push(operation.id);
  }
  const handled = new Set([...renderedOperations, ...unsupportedOperations.map((item) => item.operationId)]);
  const droppedOperations = approvedPlan.operations
    .filter((operation) => !handled.has(operation.id))
    .map((operation) => ({ operationId: operation.id, reason: 'Approved operation was not mapped into the renderer plan.' }));
  return {
    approvedOperations: approvedPlan.operations.map((operation) => operation.id),
    renderedOperations,
    droppedOperations,
    unsupportedOperations,
  };
}

export function createRendererPlan(approvedPlan: EditPlan, mediaAssets: MediaAsset[]): { plan: EditPlan; audit: PlanRealizationAudit } {
  const audit = auditPlanRealization(approvedPlan, mediaAssets);
  if (audit.droppedOperations.length || audit.unsupportedOperations.length) {
    const reasons = [...audit.droppedOperations, ...audit.unsupportedOperations].map((item) => `${item.operationId}: ${item.reason}`);
    throw new Error(`Approved plan cannot be rendered without loss. ${reasons.join(' ')}`);
  }
  return { plan: approvedPlan, audit };
}

function overlaps(operation: MeaningfulEditEvent, section: SermonSection): boolean {
  return operation.start < section.end && section.start < operation.end;
}

function eligibleForActivity(section: SermonSection): boolean {
  return ['teaching', 'main-point', 'illustration', 'story', 'testimony', 'question', 'application', 'transition', 'introduction', 'conclusion'].includes(section.type)
    && section.intensity !== 'reverent-calm';
}

export function summarizeEditorialActivity(
  plan: EditPlan,
  durationSeconds: number,
  canonicalCoveragePercent: number,
  review?: ReviewState,
): EditorialActivitySummary {
  const events = meaningfulEditEvents(plan);
  const decisions = review?.decisions ?? [];
  const keepPastorDuration = decisions
    .filter((decision) => decision.resolution === 'keep-pastor-static')
    .reduce((total, decision) => total + Math.max(0, (decision.originalOperation?.end ?? 0) - (decision.originalOperation?.start ?? 0)), 0);
  const noChangeDuration = plan.operations
    .filter((operation) => operation.type === 'no-change')
    .reduce((total, operation) => total + operation.end - operation.start, 0);
  return {
    canonicalCoveragePercent,
    meaningfulEditCount: events.length,
    meaningfulEditDuration: events.reduce((total, event) => total + event.end - event.start, 0),
    eventsPerMinute: Number((events.length / Math.max(durationSeconds / 60, Number.EPSILON)).toFixed(2)),
    keepPastorDuration,
    noChangeDuration,
    graphics: events.filter((event) => event.kind === 'sermon-point' || event.kind === 'title-treatment').length,
    broll: events.filter((event) => event.kind === 'broll').length,
    scripture: events.filter((event) => event.kind === 'scripture-card').length,
    reframes: events.filter((event) => event.kind === 'reframe' || event.kind === 'layout-change' || event.kind === 'visual-reset').length,
    captions: events.filter((event) => event.kind === 'caption').length,
  };
}

export function evaluateEditorialQuality(input: {
  analysis: SermonAnalysis;
  approvedPlan: EditPlan;
  mediaAssets: MediaAsset[];
  durationSeconds: number;
  canonicalCoveragePercent: number;
  format: VideoFormatProfile;
  sourceWidth: number;
  sourceHeight: number;
  review?: ReviewState;
  renderedOperationIds?: string[];
}): EditorialQualityResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const events = meaningfulEditEvents(input.approvedPlan);
  const realization = auditPlanRealization(input.approvedPlan, input.mediaAssets, input.renderedOperationIds);
  const activity = summarizeEditorialActivity(input.approvedPlan, input.durationSeconds, input.canonicalCoveragePercent, input.review);
  const sourceOrientation = input.sourceWidth < input.sourceHeight ? 'portrait' : 'landscape';
  if (sourceOrientation !== input.format.orientation) failures.push(`Format integrity: ${sourceOrientation} source was mapped to ${input.format.orientation} output.`);
  if (input.format.fitMode === 'cover' && Math.abs(input.format.sourceAspectRatio - input.format.aspectRatio) > 0.01) {
    failures.push('Format integrity: cover fitting would destructively crop a mismatched source aspect ratio.');
  }
  const eligible = input.analysis.sections.filter(eligibleForActivity).sort((left, right) => left.start - right.start);
  const eligibleWindows = eligible.reduce<Array<{ start: number; end: number; sectionIds: string[]; types: string[] }>>((windows, section) => {
    const current = windows.at(-1);
    if (current && section.start <= current.end + 0.001) {
      current.end = Math.max(current.end, section.end);
      current.sectionIds.push(section.id);
      current.types.push(section.type);
    } else windows.push({ start: section.start, end: section.end, sectionIds: [section.id], types: [section.type] });
    return windows;
  }, []);
  const eventIntervals = events.map((event) => ({ start: event.start, end: event.end })).sort((left, right) => left.start - right.start);
  const staticStretches = eligibleWindows.flatMap((window) => {
    const gaps: Array<{ start: number; end: number }> = [];
    let cursor = window.start;
    for (const event of eventIntervals) {
      if (event.end <= cursor || event.start >= window.end) continue;
      if (event.start > cursor) gaps.push({ start: cursor, end: Math.min(event.start, window.end) });
      cursor = Math.max(cursor, Math.min(event.end, window.end));
    }
    if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
    return gaps.filter((gap) => gap.end - gap.start >= 30).map((gap) => ({
      sectionId: window.sectionIds.join(','),
      start: gap.start,
      end: gap.end,
      reason: `${[...new Set(window.types)].join('/')} remains visually static for ${(gap.end - gap.start).toFixed(1)} seconds despite being eligible for editorial activity.`,
    }));
  });
  failures.push(...staticStretches.map((item) => `Edit activity: ${item.reason}`));
  if (input.durationSeconds >= 45 && activity.meaningfulEditCount <= 1 && input.analysis.sections.some(eligibleForActivity)) {
    failures.push(`Edit activity: only ${activity.meaningfulEditCount} meaningful edit reached a ${input.durationSeconds.toFixed(1)}-second eligible timeline.`);
  }
  if (realization.droppedOperations.length) failures.push(`Plan realization: ${realization.droppedOperations.length} approved operation(s) were dropped.`);
  if (realization.unsupportedOperations.length) failures.push(`Plan realization: ${realization.unsupportedOperations.length} approved operation(s) are unsupported.`);
  const repeated = events.filter((event, index) => index > 1 && event.kind === events[index - 1].kind && event.kind === events[index - 2].kind);
  if (repeated.length) warnings.push(`Repetition: ${repeated.length + 2} consecutive meaningful edits use the same visual category.`);
  for (const operation of input.approvedPlan.operations) {
    if ((operation.type === 'sermon-point' || operation.type === 'full-screen-card' || operation.type === 'caption') && (!operation.text.trim() || /^(todo|placeholder|tbd)$/i.test(operation.text.trim()))) {
      failures.push(`Text quality: ${operation.id} has missing or placeholder display text.`);
    }
    if (operation.type === 'caption') {
      if (operation.text.length > 120 || operation.text.split(/\n/u).length > 2) failures.push(`Text quality: ${operation.id} is too long for a semantic emphasis caption.`);
      const matchingSection = input.analysis.sections.find((section) => operation.start < section.end && section.start < operation.end);
      if (matchingSection && operation.text.trim() === matchingSection.transcriptText.trim()) failures.push(`Text quality: ${operation.id} repeats the entire canonical section instead of a concise emphasis phrase.`);
    }
  }
  for (const boundary of ['introduction', 'conclusion'] as const) {
    const sections = input.analysis.sections.filter((section) => section.type === boundary && section.visualRecommendation === 'title-card');
    for (const section of sections) {
      if (!events.some((event) => event.kind === 'title-treatment' && overlaps(event, section))) {
        failures.push(`Start/end polish: planned ${boundary} title treatment for ${section.id} was not realized.`);
      }
    }
  }
  const failureCodes = [...new Set(failures.map((failure): EditorialQualityFailureCode => {
    if (failure.startsWith('Format integrity:')) return 'FORMAT_INTEGRITY';
    if (failure.startsWith('Edit activity:')) return 'EDIT_ACTIVITY';
    if (failure.startsWith('Plan realization:')) return 'PLAN_REALIZATION';
    if (failure.startsWith('Text quality:')) return 'TEXT_QUALITY';
    return 'START_END_POLISH';
  }))];
  return { contractVersion: EDITORIAL_QUALITY_CONTRACT_VERSION, passed: failures.length === 0, failures, failureCodes, warnings, activity, staticStretches, realization };
}

export function summarizeReviewWorkspace(data: ReviewWorkspaceData, review: ReviewState): EditorialActivitySummary {
  const plan = {
    ...data.aiPlan,
    operations: review.decisions.flatMap((decision) => {
      if (decision.status === 'rejected') return [];
      return decision.reviewedOperation ?? decision.originalOperation ?? [];
    }),
  };
  return summarizeEditorialActivity(plan, data.preview.durationSeconds, data.directorExecution?.coverage?.report.coveragePercent ?? 0, review);
}

export function assertFunctionalReviewIsolation(review: ReviewState): void {
  if (review.purpose === 'functional-test') throw new Error('Functional review validation state cannot be persisted as editorial review.');
}

export function traceCreativeOperations(
  data: ReviewWorkspaceData,
  review: ReviewState,
  approvedPlan: EditPlan,
  realization: PlanRealizationAudit,
): CreativeOperationTrace[] {
  const decisions = new Map(review.decisions.map((decision) => [decision.beatId, decision]));
  const rendered = new Set(realization.renderedOperations);
  const dropped = new Set(realization.droppedOperations.map((item) => item.operationId));
  const unsupported = new Set(realization.unsupportedOperations.map((item) => item.operationId));
  return data.beats.map((beat) => {
    const decision = decisions.get(beat.section.id);
    const approved = approvedPlan.operations.find((operation) =>
      operation.id === decision?.reviewedOperation?.id
      || operation.id === decision?.originalOperation?.id
      || operation.id === `keep-pastor-${beat.section.id}`);
    return {
      beatId: beat.section.id,
      directorDecision: beat.section.visualRecommendation ?? 'speaker-full',
      policyDecision: data.policyRecords?.find((record) => record.sectionId === beat.section.id)?.policyDecision
        ?? (beat.originalOperation?.type === 'no-change' ? beat.originalOperation.mode : beat.originalOperation?.type ?? 'UNRESOLVED'),
      reviewDecision: decision?.status ?? 'missing',
      approvedOperation: approved?.type ?? (decision?.resolution === 'keep-pastor-static' ? 'KEEP_PASTOR_STATIC' : 'NONE'),
      rendererOperation: approved
        ? rendered.has(approved.id) ? 'REALIZED' : dropped.has(approved.id) ? 'DROPPED' : unsupported.has(approved.id) ? 'UNSUPPORTED' : 'NOT_APPLICABLE'
        : 'NOT_APPLICABLE',
    };
  });
}
