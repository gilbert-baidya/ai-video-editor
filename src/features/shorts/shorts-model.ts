export interface ExtractedShort {
  id: string;
  title: string;
  subtitle: string;
  hookExplanation: string;
  viralScore: number;
  sourceSegmentIds: string[];
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  durationEstimateSeconds: number;
  aiSuggestedStartSeconds?: number;
  aiSuggestedEndSeconds?: number;
  boundaryAdjustmentReason?: string;
  targetDuration: 30 | 60 | 90 | 120;
}

export interface ShortsExtractionInput {
  projectId: string;
  canonicalTranscriptHash: string;
  segments: { id: string; start: number; end: number; text: string }[];
  maxShortsToExtract?: number;
}

export interface ShortsExtractionResult {
  shorts: ExtractedShort[];
  model: string;
  provider: string;
  runtimeMs: number;
}
