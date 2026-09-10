import type { ReviewState } from './director-review.ts';
import type { FinalQaSummary, ProductProjectState, ProductStage, ProjectSource } from './product-workflow.ts';

export type CapabilityState = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'DEGRADED';

export interface ProductCapability {
  state: CapabilityState;
  detail: string;
  version?: string;
}

export interface ProductCapabilities {
  checkedAt: string;
  node: ProductCapability;
  ffmpeg: ProductCapability;
  ffprobe: ProductCapability;
  director: ProductCapability;
  transcription: ProductCapability;
  youtube: ProductCapability;
  render: ProductCapability;
}

export type ProductJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface ProductJob {
  jobId: string;
  projectId: string;
  stage: ProductStage;
  status: ProductJobStatus;
  progress?: number;
  message?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  cancelRequested: boolean;
}

export interface SourceMetadata {
  kind: ProjectSource['type'];
  fileName?: string;
  canonicalUrl?: string;
  youtubeVideoId?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  sha256?: string;
  relativePath?: string;
  immutable: true;
}

export interface ProductArtifacts {
  transcript?: string;
  director?: string;
  review?: string;
  approvedPlan?: string;
  render?: string;
  planRealization?: string;
  operationTrace?: string;
}

export interface ProductProjectRecord {
  schemaVersion: '1.3';
  workflow: ProductProjectState;
  sourceMetadata?: SourceMetadata;
  artifacts: ProductArtifacts;
  review?: ReviewState;
  jobs: ProductJob[];
  qa?: FinalQaSummary;
  output?: {
    fileName: string;
    relativePath: string;
    durationSeconds: number;
    width: number;
    height: number;
    sizeBytes: number;
    qaStatus: 'PASS' | 'FAIL';
  };
  cacheReuse: Partial<Record<ProductStage, boolean>>;
}

export interface CreateProjectRequest {
  title: string;
  source: ProjectSource;
}

export interface ProductApiError {
  error: string;
  code: string;
}

export interface StageActionResponse {
  project: ProductProjectRecord;
  job: ProductJob;
}
