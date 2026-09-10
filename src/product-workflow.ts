import type { DirectorExecutionProvenance } from './director-execution.ts';
import { defaultVideoFormatProfile, type VideoFormatProfile } from './video-format.ts';
import type { EditorialQualityResult } from './editorial-quality.ts';

export type ProductProjectStatus =
  | 'NEW'
  | 'INGESTING'
  | 'TRANSCRIBING'
  | 'ANALYZING'
  | 'DIRECTOR_READY'
  | 'REVIEW_REQUIRED'
  | 'READY_TO_RENDER'
  | 'RENDERING'
  | 'QA'
  | 'COMPLETED'
  | 'FAILED';

export type ProductStage = 'ingest' | 'transcript' | 'director' | 'review' | 'render' | 'qa';
export type ProductStageStatus = 'not-started' | 'running' | 'completed' | 'blocked' | 'failed';

export type ProjectSource =
  | { type: 'local-video'; fileName: string; sizeBytes?: number; durationSeconds?: number }
  | { type: 'youtube-url'; url: string; ingestionAvailable: boolean };

export interface ProductStageRecord {
  status: ProductStageStatus;
  progress: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  cacheReused?: boolean;
}

export interface RenderConfiguration {
  width: number;
  height: number;
  fps: number;
  codec: 'H.264';
  audio: '48kHz stereo AAC';
  format: VideoFormatProfile;
}

export interface FinalQaSummary {
  video: boolean;
  audio: boolean;
  directorCoverage: boolean;
  brollRights: boolean;
  placement: boolean;
  bengaliGraphics: boolean;
  reviewReadiness: boolean;
  editorialQuality: boolean;
  editorial?: EditorialQualityResult;
  outputPath?: string;
}

export interface ProductProjectState {
  schemaVersion: '1.2';
  projectId: string;
  title: string;
  source: ProjectSource;
  status: ProductProjectStatus;
  stages: Record<ProductStage, ProductStageRecord>;
  provider: {
    name: string;
    model?: string;
    status: DirectorExecutionProvenance['providerStatus'];
    fallbackUsed: boolean;
  };
  coveragePercent: number;
  unresolvedBlockers: string[];
  render: RenderConfiguration;
  qa?: FinalQaSummary;
  createdAt: string;
  updatedAt: string;
}

export const productStages: ProductStage[] = ['ingest', 'transcript', 'director', 'review', 'render', 'qa'];

const defaultStage = (): ProductStageRecord => ({ status: 'not-started', progress: 0 });

export function createProductProject(input: {
  projectId: string;
  title: string;
  source: ProjectSource;
  provider?: ProductProjectState['provider'];
  now?: string;
}): ProductProjectState {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: '1.2',
    projectId: input.projectId,
    title: input.title,
    source: input.source,
    status: 'NEW',
    stages: {
      ingest: defaultStage(),
      transcript: defaultStage(),
      director: defaultStage(),
      review: defaultStage(),
      render: defaultStage(),
      qa: defaultStage(),
    },
    provider: input.provider ?? { name: 'Not configured', status: 'NOT_CONFIGURED', fallbackUsed: false },
    coveragePercent: 0,
    unresolvedBlockers: [],
    render: { width: 1920, height: 1080, fps: 30, codec: 'H.264', audio: '48kHz stereo AAC', format: defaultVideoFormatProfile() },
    createdAt: now,
    updatedAt: now,
  };
}

const statusForRunningStage: Record<ProductStage, ProductProjectStatus> = {
  ingest: 'INGESTING',
  transcript: 'TRANSCRIBING',
  director: 'ANALYZING',
  review: 'REVIEW_REQUIRED',
  render: 'RENDERING',
  qa: 'QA',
};

export function updateProductStage(
  project: ProductProjectState,
  stage: ProductStage,
  update: Partial<ProductStageRecord>,
  now = new Date().toISOString(),
): ProductProjectState {
  const previous = project.stages[stage];
  const next = { ...previous, ...update };
  if (next.progress < 0 || next.progress > 100) throw new Error(`${stage}: progress must be between 0 and 100.`);
  if (next.status === 'completed') next.progress = 100;
  if (next.status === 'running' && !next.startedAt) next.startedAt = now;
  if (next.status === 'completed' && !next.completedAt) next.completedAt = now;
  if (next.status === 'failed' && !next.error) throw new Error(`${stage}: failed stage requires an error.`);

  let status = project.status;
  if (next.status === 'running') status = statusForRunningStage[stage];
  if (next.status === 'failed') status = 'FAILED';
  if (stage === 'director' && next.status === 'completed') status = 'DIRECTOR_READY';
  if (stage === 'review' && next.status !== 'completed') status = 'REVIEW_REQUIRED';
  if (stage === 'review' && next.status === 'completed') status = 'READY_TO_RENDER';
  if (stage === 'render' && next.status === 'completed') status = 'QA';
  if (stage === 'qa' && next.status === 'completed') status = 'COMPLETED';

  return { ...project, status, stages: { ...project.stages, [stage]: next }, updatedAt: now };
}

export function renderBlockers(project: ProductProjectState): string[] {
  const blockers = [...project.unresolvedBlockers];
  if (project.stages.director.status !== 'completed') blockers.push('Director plan is not ready.');
  if (project.stages.review.status !== 'completed') blockers.push('Human review is incomplete.');
  if (project.coveragePercent < 100) blockers.push(`AI canonical coverage is ${project.coveragePercent}%; 100% is required.`);
  if (project.provider.fallbackUsed) blockers.push('Director output includes deterministic fallback.');
  return [...new Set(blockers)];
}

export function canRenderProject(project: ProductProjectState): boolean {
  return renderBlockers(project).length === 0 && project.status === 'READY_TO_RENDER';
}

export function recoverProductProject(value: unknown): ProductProjectState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const project = value as Partial<ProductProjectState>;
  if (project.schemaVersion !== '1.2' || typeof project.projectId !== 'string' || !project.stages) return undefined;
  if (!productStages.every((stage) => project.stages?.[stage])) return undefined;
  const render = project.render;
  if (!render) return undefined;
  const format = render.format ?? defaultVideoFormatProfile();
  return { ...project, render: { ...render, format } } as ProductProjectState;
}

export function finalQaPassed(qa: FinalQaSummary): boolean {
  return qa.video && qa.audio && qa.directorCoverage && qa.brollRights
    && qa.placement && qa.bengaliGraphics && qa.reviewReadiness && qa.editorialQuality;
}
