import type { ReviewState } from './director-review.ts';
import type { FinalQaSummary, ProductProjectState, ProductStage, ProjectSource } from './product-workflow.ts';

export type CapabilityState = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'DEGRADED';

export interface ProductCapability {
  state: CapabilityState;
  detail: string;
  version?: string;
}

export interface DirectorCapability extends ProductCapability {
  provider: string;
  model: string;
  geminiAvailable: boolean;
  ollamaAvailable: boolean;
}

export interface ProductCapabilities {
  checkedAt: string;
  node: ProductCapability;
  ffmpeg: ProductCapability;
  ffprobe: ProductCapability;
  director: DirectorCapability;
  transcription: ProductCapability;
  youtube: ProductCapability;
  render: ProductCapability;
}

export type ProductJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface ProductJob {
  jobId: string;
  projectId: string;
  stage: ProductStage;
  payload?: any;
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
  containerDurationSeconds?: number;
  videoDurationSeconds?: number;
  audioDurationSeconds?: number;
  durationSource?: 'ffprobe';
  probedAt?: string;
  width?: number;
  height?: number;
  sha256?: string;
  relativePath?: string;
  immutable: true;
}

export interface SourceDurationValidation {
  status: 'verified' | 'mismatch' | 'unavailable';
  physicalDurationSeconds?: number;
  metadataDurationSeconds?: number;
  transcriptEndSeconds?: number;
  approvedTimelineEndSeconds?: number;
  toleranceSeconds: number;
  failures: string[];
  checkedAt: string;
}

export interface ProductArtifacts {
  transcript?: string;
  director?: string;
  review?: string;
  approvedPlan?: string;
  render?: string;
  planRealization?: string;
  operationTrace?: string;
  directorQuality?: string;
  directorEnrichment?: string;
}

export interface ProductProjectRecord {
  schemaVersion: '1.3';
  workflow: ProductProjectState;
  sourceMetadata?: SourceMetadata;
  /** Fresh, read-only ffprobe audit returned by the backend. It is not trusted project input. */
  sourceDurationValidation?: SourceDurationValidation;
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
  source: ProjectSource; outputTarget?: "long-form" | "shorts";
}

export interface ProductApiError {
  error: string;
  code: string;
}

export interface StageActionResponse {
  project: ProductProjectRecord;
  job: ProductJob;
}
