import type { EditOperation, EditPlan, MediaAsset, SpeakerPosition } from '../contracts.ts';
import { resolveFrameVisuals, type FrameVisuals } from '../broll-layout.ts';
import type { ReviewDataPayload } from '../DirectorReviewWorkspace.tsx';
import { operationBeatId, type ReviewBeat, type ReviewState } from '../director-review.ts';
import type { ProductProjectRecord } from '../product-api.ts';
import { canRenderProject, finalQaPassed, renderBlockers, rerenderBlockers, type ProductStageStatus } from '../product-workflow.ts';

// ───────────────────────── Time helpers ─────────────────────────

export function clampTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(Math.max(0, seconds), Math.max(0, duration));
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
}

export const timeToX = (seconds: number, pixelsPerSecond: number): number => seconds * pixelsPerSecond;
export const xToTime = (x: number, pixelsPerSecond: number, duration: number): number => clampTime(x / pixelsPerSecond, duration);

// ───────────────────────── Timeline ─────────────────────────

export type TrackId = 'broll' | 'captions' | 'framing' | 'video' | 'audio';
export type ClipKind = 'broll-image' | 'broll-video' | 'broll-split' | 'broll-unresolved' | 'caption' | 'sermon-point' | 'full-screen-card' | 'framing' | 'source' | 'audio' | 'no-source';
export type ReviewStatusLabel = 'pending' | 'accepted' | 'modified' | 'rejected';

export interface TimelineClip {
  id: string;
  operationId?: string;
  track: TrackId;
  kind: ClipKind;
  start: number;
  end: number;
  label: string;
  sublabel?: string;
  assetId?: string;
  beatId?: string;
  status?: ReviewStatusLabel;
}

export interface TimelineTrack {
  id: TrackId;
  code: string;
  label: string;
  clips: TimelineClip[];
}

export interface TimelineModel {
  durationSeconds: number;
  sourceDurationSeconds?: number;
  tracks: TimelineTrack[];
}

export interface TimelineInput {
  plan: EditPlan;
  assets: MediaAsset[];
  durationSeconds: number;
  sourceDurationSeconds?: number;
  review?: ReviewState;
}

function statusFor(operation: EditOperation, review: ReviewState | undefined): { beatId?: string; status?: ReviewStatusLabel } {
  const beatId = operationBeatId(operation);
  if (!beatId) return {};
  const decision = review?.decisions.find((item) => item.beatId === beatId);
  return { beatId, status: decision?.status };
}

function operationClip(operation: EditOperation, assets: MediaAsset[], review: ReviewState | undefined): TimelineClip | undefined {
  const link = statusFor(operation, review);
  const base = { id: `clip-${operation.id}`, operationId: operation.id, start: operation.start, end: operation.end, ...link };
  if (operation.type === 'broll') {
    const asset = assets.find((candidate) => candidate.id === operation.assetId);
    const split = operation.visualType === 'split-screen' || (operation.visualType === undefined && operation.mode !== 'full-screen');
    return { ...base, track: 'broll', kind: split ? 'broll-split' : asset?.kind === 'video' ? 'broll-video' : 'broll-image', label: asset?.fileName ?? operation.assetId, sublabel: split ? 'Split-screen' : 'Full-frame', assetId: operation.assetId };
  }
  if (operation.type === 'director-placeholder') {
    return { ...base, track: 'broll', kind: 'broll-unresolved', label: 'Unresolved B-roll', sublabel: operation.visualType };
  }
  if (operation.type === 'caption') return { ...base, track: 'captions', kind: 'caption', label: operation.text, sublabel: 'Caption' };
  if (operation.type === 'sermon-point') return { ...base, track: 'captions', kind: 'sermon-point', label: operation.text || 'Sermon point', sublabel: operation.style.replace(/^director-v2-/u, '') };
  if (operation.type === 'full-screen-card') return { ...base, track: 'captions', kind: 'full-screen-card', label: operation.text, sublabel: 'Full-screen card' };
  if (operation.type === 'speaker-position') return { ...base, track: 'framing', kind: 'framing', label: operation.position === 'punch-in' ? 'Punch-in' : `Speaker ${operation.position}`, sublabel: 'Framing' };
  return undefined;
}

export function buildTimeline(input: TimelineInput): TimelineModel {
  const planEnd = input.plan.operations.reduce((end, operation) => Math.max(end, operation.end), 0);
  const durationSeconds = Math.max(input.durationSeconds, planEnd, input.sourceDurationSeconds ?? 0);
  const clips = input.plan.operations.flatMap((operation) => {
    const clip = operationClip(operation, input.assets, input.review);
    return clip ? [clip] : [];
  });
  const byTrack = (track: TrackId) => clips.filter((clip) => clip.track === track).sort((left, right) => left.start - right.start);
  const sourceEnd = Math.min(input.sourceDurationSeconds ?? durationSeconds, durationSeconds);
  const video: TimelineClip[] = [{ id: 'clip-source', track: 'video', kind: 'source', start: 0, end: sourceEnd, label: 'Original sermon footage', sublabel: 'Pastor' }];
  const audio: TimelineClip[] = [{ id: 'clip-audio', track: 'audio', kind: 'audio', start: 0, end: sourceEnd, label: 'Sermon audio', sublabel: 'Original · continuous' }];
  if (sourceEnd < durationSeconds - 0.05) {
    video.push({ id: 'clip-no-source', track: 'video', kind: 'no-source', start: sourceEnd, end: durationSeconds, label: 'No source footage', sublabel: `Source ends at ${formatTimecode(sourceEnd)}` });
    audio.push({ id: 'clip-no-audio', track: 'audio', kind: 'no-source', start: sourceEnd, end: durationSeconds, label: 'No source audio' });
  }
  return {
    durationSeconds,
    sourceDurationSeconds: input.sourceDurationSeconds,
    tracks: [
      { id: 'broll', code: 'V2', label: 'B-roll', clips: byTrack('broll') },
      { id: 'captions', code: 'T1', label: 'Captions & titles', clips: byTrack('captions') },
      { id: 'framing', code: 'FX', label: 'Framing', clips: byTrack('framing') },
      { id: 'video', code: 'V1', label: 'Main video', clips: video },
      { id: 'audio', code: 'A1', label: 'Audio', clips: audio },
    ],
  };
}

export function findClip(model: TimelineModel, clipId: string | undefined): TimelineClip | undefined {
  return clipId ? model.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId) : undefined;
}

// ───────────────────────── Preview frame ─────────────────────────

export interface PreviewFrame {
  seconds: number;
  pastorVisible: boolean;
  broll?: FrameVisuals['broll'];
  speakerPosition: SpeakerPosition | 'center';
  caption?: { id: string; text: string };
  sermonPoint?: { id: string; text: string; label: string };
  fullScreenCard?: { id: string; text: string };
}

export function previewFrameAt(plan: EditPlan, assets: MediaAsset[], seconds: number): PreviewFrame {
  const active = <T extends EditOperation['type']>(type: T) => plan.operations.find((operation): operation is Extract<EditOperation, { type: T }> => operation.type === type && seconds >= operation.start && seconds < operation.end);
  const visuals = resolveFrameVisuals(plan.operations, seconds, assets);
  const speaker = active('speaker-position');
  const caption = active('caption');
  const point = active('sermon-point');
  const card = active('full-screen-card');
  return {
    seconds,
    pastorVisible: visuals.pastorVisible,
    broll: visuals.broll,
    speakerPosition: speaker?.position ?? 'center',
    caption: caption ? { id: caption.id, text: caption.text } : undefined,
    sermonPoint: point ? { id: point.id, text: point.text, label: point.style.includes('scripture') ? 'SCRIPTURE REFERENCE' : 'SERMON POINT' } : undefined,
    fullScreenCard: card ? { id: card.id, text: card.text } : undefined,
  };
}

// ───────────────────────── Timeline reconciliation ─────────────────────────

// Reports disagreements between the approved timeline and the media that actually exists; never hides them.
export function reconcileTimeline(input: { planDurationSeconds: number; sourceMetadataSeconds?: number; measuredSourceSeconds?: number }): string[] {
  const issues: string[] = [];
  const tolerance = 0.5;
  const { planDurationSeconds: plan, sourceMetadataSeconds: metadata, measuredSourceSeconds: measured } = input;
  if (metadata !== undefined && Math.abs(metadata - plan) > tolerance) issues.push(`The approved timeline runs to ${plan.toFixed(1)} s but the recorded source duration is ${metadata.toFixed(1)} s.`);
  if (measured !== undefined && Math.abs(measured - plan) > tolerance) issues.push(`The source video in the browser is ${measured.toFixed(1)} s long but the approved timeline runs to ${plan.toFixed(1)} s. Footage after ${measured.toFixed(1)} s does not exist.`);
  if (metadata !== undefined && measured !== undefined && Math.abs(metadata - measured) > tolerance) issues.push(`Recorded source duration (${metadata.toFixed(1)} s) disagrees with the playable source (${measured.toFixed(1)} s).`);
  return issues;
}

// ───────────────────────── Operation inspector ─────────────────────────

export interface OperationDetails {
  title: string;
  rows: Array<[string, string]>;
  text?: string;
  textTrust?: string;
  warnings: string[];
}

const seconds = (value: number) => `${value.toFixed(2)} s`;

export function describeOperation(operation: EditOperation, assets: MediaAsset[], beat?: ReviewBeat): OperationDetails {
  const rows: Array<[string, string]> = [
    ['Operation', operation.id],
    ['Type', operation.type],
    ['Window', `${seconds(operation.start)} → ${seconds(operation.end)} (${seconds(operation.end - operation.start)})`],
    ['Confidence', `${Math.round(operation.confidence * 100)}%`],
    ['Reason', operation.reason],
  ];
  const warnings: string[] = [];
  let title = operation.type.replaceAll('-', ' ');
  let text: string | undefined;
  let textTrust: string | undefined;
  if (operation.type === 'broll') {
    const asset = assets.find((candidate) => candidate.id === operation.assetId);
    title = operation.visualType === 'split-screen' ? 'Split-screen B-roll' : 'Full-frame B-roll';
    rows.push(['Visual type', operation.visualType ?? 'unspecified'], ['Layout', operation.mode], ['B-roll audio', operation.muted ? 'Muted — sermon audio continues' : 'NOT muted'], ['Sermon-source range', `${seconds(operation.sourceStart)} → ${seconds(operation.sourceEnd)}`]);
    if (asset) rows.push(['Asset', asset.fileName], ['Kind', `${asset.kind} · ${asset.mimeType}`], ['Dimensions', `${asset.width}×${asset.height}`], ['Size', `${asset.sizeBytes.toLocaleString()} bytes`], ['SHA-256', asset.contentHash ? `${asset.contentHash.slice(0, 16)}…` : 'missing'], ['Rights', `${asset.rightsStatus} · ${asset.rightsBasis}`], ['Technically usable', asset.usable ? 'yes' : `no — ${asset.unusableReasons.join('; ')}`]);
    else warnings.push(`Asset ${operation.assetId} is missing from the media index.`);
    if (operation.muted !== true) warnings.push('B-roll audio is not muted.');
  } else if (operation.type === 'director-placeholder') {
    title = 'Unresolved B-roll';
    rows.push(['Recommendation', operation.visualType]);
    warnings.push('No approved asset is attached. Replace the media or choose Keep Pastor before rendering.');
  } else if (operation.type === 'caption' || operation.type === 'sermon-point' || operation.type === 'full-screen-card') {
    title = operation.type === 'caption' ? 'Caption' : operation.type === 'sermon-point' ? 'Sermon point' : 'Full-screen card';
    text = operation.text;
    textTrust = operation.textTrust ?? 'unspecified';
    rows.push(['Text trust', textTrust]);
    if (operation.type !== 'caption') rows.push(['Style', operation.style]);
    if (textTrust !== 'approved-display' && textTrust !== 'canonical-transcript') warnings.push('Display text is not yet approved.');
  } else if (operation.type === 'speaker-position') {
    title = operation.position === 'punch-in' ? 'Speaker punch-in' : 'Speaker framing';
    rows.push(['Position', operation.position]);
  } else if (operation.type === 'no-change') {
    title = 'Pastor held static';
    rows.push(['Mode', operation.mode]);
  }
  if (beat) rows.push(['Scene', `${beat.section.id} · ${beat.section.type} · ${seconds(beat.section.start)} → ${seconds(beat.section.end)}`]);
  return { title, rows, text, textTrust, warnings };
}

export function beatForOperation(operation: EditOperation | undefined, beats: ReviewBeat[]): ReviewBeat | undefined {
  const beatId = operation ? operationBeatId(operation) : undefined;
  return beatId ? beats.find((beat) => beat.section.id === beatId) : undefined;
}

export function operationById(plan: EditPlan, operationId: string | undefined): EditOperation | undefined {
  return operationId ? plan.operations.find((operation) => operation.id === operationId) : undefined;
}

// ───────────────────────── Director pipeline ─────────────────────────

export type StepStatus = ProductStageStatus;
export interface PipelineStep {
  id: 'analyze' | 'plan' | 'broll' | 'review' | 'export';
  label: string;
  status: StepStatus;
  detail: string;
  // Only present while the backend reports the stage as running.
  progress?: number;
  error?: string;
}

export interface BrollStatus {
  total: number;
  resolved: number;
  unresolved: number;
}

const BROLL_RECOMMENDATIONS = ['image-broll', 'video-broll', 'split-screen'];

export function computeBrollStatus(plan: EditPlan, beats: ReviewBeat[], review: ReviewState): BrollStatus {
  const brollBeats = beats.filter((beat) => BROLL_RECOMMENDATIONS.includes(beat.section.visualRecommendation ?? ''));
  let resolved = 0;
  for (const beat of brollBeats) {
    const decision = review.decisions.find((item) => item.beatId === beat.section.id);
    const operation = plan.operations.find((candidate) => operationBeatId(candidate) === beat.section.id);
    if (decision?.status === 'rejected' || operation?.type === 'broll') resolved += 1;
  }
  return { total: brollBeats.length, resolved, unresolved: brollBeats.length - resolved };
}

function worst(statuses: StepStatus[]): StepStatus {
  for (const status of ['failed', 'running', 'blocked'] as const) if (statuses.includes(status)) return status;
  return statuses.every((status) => status === 'completed') ? 'completed' : 'not-started';
}

export function buildPipeline(project: ProductProjectRecord, broll?: BrollStatus): PipelineStep[] {
  const { stages } = project.workflow;
  const progressOf = (...names: Array<keyof typeof stages>) => names.map((name) => stages[name]).find((stage) => stage.status === 'running')?.progress;
  const errorOf = (...names: Array<keyof typeof stages>) => names.map((name) => stages[name]).find((stage) => stage.status === 'failed')?.error;
  const analyze = worst([stages.ingest.status, stages.transcript.status]);
  const plan = stages.director.status;
  const directorDone = plan === 'completed';
  let brollStatus: StepStatus = 'not-started';
  let brollDetail = 'Waiting for the Director plan.';
  if (directorDone && broll) {
    if (broll.total === 0) { brollStatus = 'completed'; brollDetail = 'No B-roll recommended.'; }
    else { brollStatus = broll.unresolved === 0 ? 'completed' : 'blocked'; brollDetail = `${broll.resolved} of ${broll.total} B-roll recommendation(s) resolved.`; }
  }
  const exportStep = worst([stages.render.status, stages.qa.status]);
  const coverage = project.workflow.coveragePercent;
  return [
    { id: 'analyze', label: 'Analyze Sermon', status: analyze, detail: analyze === 'completed' ? 'Source ingested and canonical transcript ready.' : `Ingest: ${stages.ingest.status} · Transcript: ${stages.transcript.status}`, progress: progressOf('ingest', 'transcript'), error: errorOf('ingest', 'transcript') },
    { id: 'plan', label: 'Generate Plan', status: plan, detail: directorDone ? `${project.workflow.provider.name}${project.workflow.provider.model ? ` · ${project.workflow.provider.model}` : ''} · ${coverage}% transcript coverage${project.workflow.provider.fallbackUsed ? ' · fallback used' : ''}` : `Director: ${plan}`, progress: progressOf('director'), error: errorOf('director') },
    { id: 'broll', label: 'Match B-roll', status: brollStatus, detail: brollDetail },
    { id: 'review', label: 'Review & Edit', status: stages.review.status, detail: stages.review.status === 'completed' ? 'Human review approved.' : `Review: ${stages.review.status}`, progress: progressOf('review'), error: errorOf('review') },
    { id: 'export', label: 'Render & Export', status: exportStep, detail: `Render: ${stages.render.status} · QA: ${stages.qa.status}`, progress: progressOf('render', 'qa'), error: errorOf('render', 'qa') },
  ];
}

// ───────────────────────── Export status ─────────────────────────

export type ExportState = 'NOT_READY' | 'READY' | 'RENDERING' | 'AWAITING_QA' | 'FAILED' | 'QA_FAILED' | 'QA_PASSED';
export interface ExportGate { label: string; ok: boolean }
export interface ExportVerdict {
  state: ExportState;
  headline: string;
  detail: string;
  gates: ExportGate[];
  failures: string[];
  progress?: number;
  canRender: boolean;
  canRerender: boolean;
  blockers: string[];
}

const gateLabels: Array<[keyof NonNullable<ProductProjectRecord['qa']>, string]> = [
  ['video', 'Video stream'], ['audio', 'Sermon audio'], ['directorCoverage', 'Director coverage'], ['brollRights', 'B-roll rights'], ['placement', 'Placement'],
  ['bengaliGraphics', 'Bengali graphics'], ['reviewReadiness', 'Review readiness'], ['editorialQuality', 'Editorial quality'], ['mediaIntegrity', 'Media integrity'],
];

// An MP4 existing is never evidence of success: only completed render + completed QA + every gate passing counts.
export function exportStatus(project: ProductProjectRecord): ExportVerdict {
  const { stages } = project.workflow;
  const qa = project.qa;
  const gates: ExportGate[] = qa ? gateLabels.map(([key, label]) => ({ label, ok: qa[key] === true })) : [];
  const failures: string[] = [];
  if (qa?.editorial) failures.push(...qa.editorial.failures);
  if (qa?.mediaExport?.failures) failures.push(...qa.mediaExport.failures);
  if (qa?.audioContinuity?.failures) failures.push(...qa.audioContinuity.failures);
  const blockers = renderBlockers(project.workflow);
  const canRender = canRenderProject(project.workflow);
  const canRerender = rerenderBlockers(project.workflow).length === 0;
  const base = { gates, failures, canRender, canRerender, blockers };
  const renderJob = project.jobs.slice().reverse().find((job) => job.stage === 'render' && job.status === 'running');
  if (stages.render.status === 'running' || stages.qa.status === 'running') {
    return { ...base, state: 'RENDERING', headline: 'Rendering', detail: renderJob?.message ?? 'The Remotion renderer is producing the export.', progress: renderJob?.progress ?? stages.render.progress };
  }
  if (stages.render.status === 'failed') {
    return { ...base, state: 'FAILED', headline: 'Render failed', detail: stages.render.error ?? 'The renderer reported a failure.', failures: [stages.render.error ?? 'Unknown render failure.', ...failures] };
  }
  if (stages.qa.status === 'failed' || project.output?.qaStatus === 'FAIL' || (qa && !finalQaPassed(qa))) {
    const failedGates = gates.filter((gate) => !gate.ok).map((gate) => gate.label);
    return { ...base, state: 'QA_FAILED', headline: 'QA failed — not a valid export', detail: stages.qa.error ?? `Failing gates: ${failedGates.join(', ') || 'see details'}.`, failures };
  }
  if (stages.render.status === 'completed' && stages.qa.status !== 'completed') {
    return { ...base, state: 'AWAITING_QA', headline: 'Rendered — QA not complete', detail: 'An output file exists but has not passed final QA, so it is not a verified export.' };
  }
  if (stages.qa.status === 'completed' && project.output?.qaStatus === 'PASS' && qa && finalQaPassed(qa)) {
    return { ...base, state: 'QA_PASSED', headline: 'Automated QA passed', detail: 'All automated gates passed. Human review of the exported video is still required.' };
  }
  if (canRender) return { ...base, state: 'READY', headline: 'Ready to export', detail: 'Review is approved and all render gates are satisfied.' };
  return { ...base, state: 'NOT_READY', headline: 'Not ready to export', detail: blockers[0] ?? 'Complete the earlier workflow stages first.' };
}

// ───────────────────────── Project loading ─────────────────────────

export interface EditorClient {
  getProject(projectId: string): Promise<ProductProjectRecord>;
  reviewWorkspace(projectId: string): Promise<ReviewDataPayload>;
}

export type LoadResult =
  | { kind: 'ready'; project: ProductProjectRecord; workspace: ReviewDataPayload }
  | { kind: 'no-plan'; project: ProductProjectRecord; reason: string }
  | { kind: 'error'; message: string; project?: ProductProjectRecord };

export async function loadEditingProject(client: EditorClient, projectId: string): Promise<LoadResult> {
  let project: ProductProjectRecord;
  try {
    project = await client.getProject(projectId);
  } catch (reason) {
    return { kind: 'error', message: reason instanceof Error ? reason.message : String(reason) };
  }
  const director = project.workflow.stages.director;
  if (director.status !== 'completed') {
    const reason = director.status === 'failed' ? `The AI Director failed: ${director.error ?? 'no error recorded.'}` : project.sourceMetadata ? `The AI Director plan is ${director.status}. Run the earlier stages to generate it.` : 'No source video has been uploaded yet.';
    return { kind: 'no-plan', project, reason };
  }
  try {
    return { kind: 'ready', project, workspace: await client.reviewWorkspace(projectId) };
  } catch (reason) {
    return { kind: 'error', project, message: reason instanceof Error ? reason.message : String(reason) };
  }
}

// Review states are equal when every human decision is equal; timestamps alone never count as a change.
export function sameDecisions(left: ReviewState, right: ReviewState): boolean {
  return left.sourceEditPlanHash === right.sourceEditPlanHash && JSON.stringify(left.decisions) === JSON.stringify(right.decisions);
}

// ───────────────────────── Adaptive layout ─────────────────────────

export interface LayoutPrefs {
  left: number;
  right: number;
  timeline: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const LAYOUT_LIMITS = {
  left: { min: 200, maxShare: 0.3 },
  right: { min: 300, maxShare: 0.38 },
  timeline: { min: 210, maxShare: 0.66 },
};
export const LIBRARY_MIN_VIEWPORT = 1100;
export const STACKED_VIEWPORT = 900;

const clamp = (value: number, min: number, max: number): number => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

// Portrait video is height-bound, so it gets a shorter timeline by default; landscape is width-bound.
export function defaultLayout(viewport: Viewport, orientation: 'portrait' | 'landscape'): LayoutPrefs {
  const portrait = orientation === 'portrait';
  // A portrait stage leaves wide side margins, so the side panels take more of the width.
  return clampLayout({
    left: viewport.width * (portrait ? 0.18 : 0.15),
    right: viewport.width * (portrait ? 0.26 : 0.22),
    timeline: viewport.height * (portrait ? 0.33 : 0.38),
  }, viewport);
}

export function clampLayout(layout: LayoutPrefs, viewport: Viewport): LayoutPrefs {
  return {
    left: clamp(layout.left, LAYOUT_LIMITS.left.min, viewport.width * LAYOUT_LIMITS.left.maxShare),
    right: clamp(layout.right, LAYOUT_LIMITS.right.min, viewport.width * LAYOUT_LIMITS.right.maxShare),
    timeline: clamp(layout.timeline, LAYOUT_LIMITS.timeline.min, viewport.height * LAYOUT_LIMITS.timeline.maxShare),
  };
}

// Ruler spacing: labelled marks are never closer than ~76 px, with finer unlabelled ticks between them.
export function rulerScale(pixelsPerSecond: number): { major: number; minor: number } {
  const steps: Array<[number, number]> = [[1, 0.25], [2, 0.5], [5, 1], [10, 2], [15, 5], [30, 5], [60, 10], [120, 30], [300, 60], [600, 120]];
  const [major, minor] = steps.find(([candidate]) => candidate * pixelsPerSecond >= 76) ?? steps[steps.length - 1];
  return { major, minor };
}
