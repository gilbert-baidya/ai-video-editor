export const FOUNDATION_SCHEMA_VERSION = '1.0';

export type LanguageProfile = 'bn' | 'en' | 'mixed';

export type TranscriptTextSource = 'local-asr' | 'existing-project' | 'manual' | 'hybrid-reviewed';
export type TimingConfidence = 'word-safe' | 'sentence-safe' | 'segment-safe' | 'review';
export type VisualIntensity = 'reverent-calm' | 'normal-teaching' | 'story-illustration' | 'emphasis';
export type VisualRecommendation = 'speaker-full' | 'speaker-left' | 'speaker-right' | 'speaker-punch-in' | 'caption' | 'scripture-card' | 'title-card' | 'keyword-graphic' | 'image-broll' | 'video-broll' | 'motion-graphic' | 'split-screen' | 'none';
export type EditorialIntent = 'PRESERVE_SPEAKER' | 'EMPHASIZE_SPEAKER' | 'SHOW_KEY_TEXT' | 'SHOW_SCRIPTURE' | 'USE_CONTEXTUAL_VISUAL' | 'VISUAL_RESET';
export type DisplayTextTrust = 'canonical-transcript' | 'ai-suggested-unapproved' | 'approved-display' | 'scripture-reference-needs-review' | 'verified-scripture';


export type SermonSectionType = 'introduction' | 'scripture-reading' | 'teaching' | 'main-point' | 'illustration' | 'story' | 'testimony' | 'question' | 'application' | 'transition' | 'prayer' | 'emotional-ministry' | 'conclusion' | 'altar-call';

export interface ScriptureReference {
  rawText: string;
  normalizedReference?: string;
  start: number;
  end: number;
  confidence: number;
  verificationStatus: 'detected' | 'needs-review' | 'verified';
}

export interface SermonSection {
  id: string;
  start: number;
  end: number;
  transcriptText: string;
  sourceSegmentIds: string[];
  type: SermonSectionType; // primary
  secondaryType?: SermonSectionType;
  semanticConfidence?: number;
  semanticEvidence?: string;
  intensity?: VisualIntensity;
  suggestedDisplayText?: string;
  scriptureReference?: string;
  editorialIntent?: EditorialIntent;
  visualRecommendation?: VisualRecommendation;
  confidence: number;
  reason: string;
}

export interface SermonPoint {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  reason: string;
}

export interface KeyStatement {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  reason: string;
}

export interface SermonMoment {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  reason: string;
}

export interface SermonAnalysis {
  version: string;
  projectId: string;
  title?: string;
  mainTheme?: string;
  mainPassage?: ScriptureReference;
  supportingPassages: ScriptureReference[];
  sections: SermonSection[];
  mainPoints: SermonPoint[];
  keyStatements: KeyStatement[];
  illustrations: SermonMoment[];
  stories: SermonMoment[];
  testimonies: SermonMoment[];
  questions: SermonMoment[];
  applications: SermonMoment[];
  prayerMoments: SermonMoment[];
  emotionalMoments: SermonMoment[];
  conclusion?: SermonSection;
  altarCall?: SermonSection;
  confidence: number;
}

export interface Project {
  id: string;
  name: string;
  source: SourceAsset;
  languageProfile: LanguageProfile;
  createdAt: string;
  updatedAt: string;
}

export interface SourceAsset {
  id: string;
  path: string;
  durationSeconds: number;
  width: number;
  height: number;
  immutable: true;
  sha256?: string;
}

export type MediaAssetKind = 'image' | 'video';
export type MediaRightsStatus = 'approved' | 'unknown' | 'restricted';
export type MediaRightsBasis = 'owned' | 'permission' | 'generated' | 'public-domain' | 'licensed' | 'unknown';

export interface MediaLibraryRoot {
  id: string;
  path: string;
  label: string;
  defaultRightsStatus: MediaRightsStatus;
  rightsPolicyVersion: string;
  recursive: boolean;
  enabled: boolean;
}

export interface MediaAsset {
  id: string;
  path: string;
  relativePath: string;
  fileName: string;
  kind: MediaAssetKind;
  mimeType: string;
  sizeBytes: number;
  modifiedAt: string;
  contentHash?: string;
  durationSeconds?: number;
  width: number;
  height: number;
  aspectRatio: number;
  codec?: string;
  frameRate?: number;
  hasAudio: boolean;
  tags: string[];
  categories: string[];
  description?: string;
  searchTerms: string[];
  thumbnailPath?: string;
  rightsStatus: MediaRightsStatus;
  rightsBasis: MediaRightsBasis;
  rightsNote?: string;
  rightsConfirmedAt?: string;
  libraryRootId: string;
  libraryPolicyVersion: string;
  usable: boolean;
  unusableReasons: string[];
}

export interface MediaIndex {
  schemaVersion: string;
  indexerVersion: string;
  createdAt: string;
  updatedAt: string;
  roots: MediaLibraryRoot[];
  assets: MediaAsset[];
}

export interface MediaSearchIntent {
  concept: string;
  sectionId: string;
  sectionType: SermonSectionType;
  desiredMedia: 'image' | 'video' | 'either';
  semanticTags: string[];
  avoidTerms: string[];
  preferredCategories?: string[];
  allowUnknownRights: boolean;
}

export interface MediaCandidate {
  assetId: string;
  score: number;
  semanticScore: number;
  categoryScore: number;
  technicalScore: number;
  rightsScore: number;
  repetitionPenalty: number;
  reasons: string[];
  eligible: boolean;
}

export interface BrollIntent {
  sectionId: string;
  start: number;
  end: number;
  decision: 'search' | 'no-broll';
  reason: string;
  search?: MediaSearchIntent;
}

export interface MediaUsageHistory {
  assetId: string;
  projectId: string;
  sectionId: string;
  start: number;
  end: number;
  usedAt: string;
}

export interface BrollDecision {
  intent: BrollIntent;
  candidates: MediaCandidate[];
  selectedAssetId?: string;
  decision: 'selected' | 'no-suitable-asset' | 'no-broll';
  reason: string;
}

export interface TranscriptWord {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  language?: LanguageProfile;
  sourceText?: string;
  rawStart?: number;
  rawEnd?: number;
  normalizationApplied?: boolean;
}

export interface AlignmentInput {
  audioPath: string;
  transcript: TranscriptDocument;
  rawAlignmentPath?: string;
}

export type AlignmentMatchStatus = 'exact' | 'normalized' | 'approximate' | 'unmatched';

export interface AlignedWord {
  originalText: string;
  normalizedMatchText?: string;
  start?: number;
  end?: number;
  confidence: number;
  source: 'forced-alignment' | 'whisper-token' | 'segment-fallback';
  matchStatus: AlignmentMatchStatus;
}

export type AlignmentConfidence = 'high' | 'medium' | 'low';

export interface AlignmentMetrics {
  totalSegments: number;
  totalTokens: number;
  chronological: boolean;
  zeroDurationTokenCount: number;
  negativeDurationTokenCount: number;
  overlappingTokenCount: number;
  tokenOutsideSegmentCount: number;
  largeGapCount: number;
  suspiciouslyLongTokenCount: number;
  normalizedTokenCount: number;
  normalizedTokenPercentage: number;
}

export interface AlignmentSample {
  segmentId: string;
  start: number;
  end: number;
  text: string;
  duration: number;
  source: string;
  confidence?: number;
  normalizationApplied: boolean;
}

export interface AlignmentResult {
  provider: string;
  transcript: TranscriptDocument;
  alignedWords?: AlignedWord[];
  metrics: AlignmentMetrics;
  samples: AlignmentSample[];
  confidence: AlignmentConfidence;
  limitations: string[];
}

export interface AlignmentService {
  align(input: AlignmentInput): Promise<AlignmentResult>;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  language: LanguageProfile;
  confidence?: number;
  words: TranscriptWord[];
}

export interface TranscriptDocument {
  schemaVersion: string;
  projectId: string;
  originalTranscript: string;
  aiSuggestedDisplayText: string;
  approvedDisplayText: string;
  language: string;
  textSource: TranscriptTextSource;
  transcriptionProvider?: string;
  transcriptionModel?: string;
  approved: boolean;
  timingConfidence: TimingConfidence;
  source: 'whisper-cli' | 'sermonclip-reference';
  model: string;
  segments: TranscriptSegment[];
  immutableOriginal: true;
  alignment: {
    provider: string;
    status: 'verified' | 'partial' | 'failed';
    limitations: string[];
  };
  sentences?: TranscriptSentence[];
}

export interface TranscriptSentence {
  id: string;
  text: string;
  start: number;
  end: number;
  sourceSegmentIds: string[];
  confidence: 'high' | 'medium' | 'low';
}

export type SpeakerPosition = 'full' | 'left' | 'right' | 'center' | 'punch-in';
export type GraphicRegion = 'left' | 'right' | 'upper-left' | 'upper-right' | 'lower-left' | 'lower-right' | 'center';

export interface VisualLayout {
  speakerPosition: SpeakerPosition;
  graphicRegion?: GraphicRegion;
  captionRegion?: GraphicRegion;
  safeZoneProfile: string;
}

export interface VisualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualRegion extends VisualRect {
  confidence: number;
  classification?: 'left' | 'center' | 'right' | 'unknown';
  kind: 'subject' | 'face' | 'existing-graphic' | 'screen' | 'caption' | 'unknown';
}

export interface VisualFrameAnalysis {
  beatId: string;
  time: number;
  imagePath: string;
  width: number;
  height: number;
  faces: VisualRegion[];
  subject?: VisualRegion;
  occupied: VisualRegion[];
  detector: string;
}

export type SafeZoneRegion = Exclude<GraphicRegion, 'left' | 'right'> | 'left' | 'right';

export interface SafeZoneScore {
  region: SafeZoneRegion;
  score: number;
  blockedBy: string[];
  reason: string;
  availableArea: number;
}

export interface PlacementDecision {
  beatId: string;
  requestedVisual: string;
  candidateRegions: SafeZoneScore[];
  selectedRegion?: SafeZoneRegion;
  decision: 'place' | 'suppress' | 'full-screen' | 'review';
  reason: string;
  visualEvidence: string[];
  textFit: { fontSize: number; maxLines: number; lineCount: number; fits: boolean };
}

export interface VideoBeat {
  id: string;
  start: number;
  end: number;
  transcriptText: string;
  intent: 'speaker' | 'scripture' | 'keyword' | 'illustration' | 'story' | 'emotion' | 'transition' | 'prayer' | 'conclusion';
  visualType: VisualRecommendation;
  intensity: VisualIntensity;
  suggestedDisplayText?: string;
  displayTextTrust?: DisplayTextTrust;
  scriptureReference?: string;
  visualPrompt?: string;
  searchQuery?: string;
  priority: number;
  confidence: number;
  reason: string;
}

export type EditOperation =
  | {
      id: string;
      type: 'no-change';
      start: number;
      end: number;
      mode: 'keep-pastor-static' | 'canonical-no-change';
      reason: string;
      confidence: number;
    }
  | {
      id: string;
      type: 'speaker-position';
      start: number;
      end: number;
      position: SpeakerPosition;
      reason: string;
      confidence: number;
    }
  | {
      id: string;
      type: 'sermon-point';
      start: number;
      end: number;
      text: string;
      textTrust?: DisplayTextTrust;
      position: 'left' | 'right';
      style: string;
      graphicRegion?: GraphicRegion;
      layout?: VisualLayout;
      placement?: PlacementDecision;
      reason: string;
      confidence: number;
    }
  | {
      id: string;
      type: 'caption';
      start: number;
      end: number;
      text: string;
      textTrust?: DisplayTextTrust;
      reason: string;
      confidence: number;
    }
  | {
      id: string;
      type: 'full-screen-card';
      start: number;
      end: number;
      text: string;
      textTrust?: DisplayTextTrust;
      style: string;
      placement?: PlacementDecision;
      reason: string;
      confidence: number;
    }
  | {
      id: string;
      type: 'broll';
      sourceStart: number;
      sourceEnd: number;
      start: number;
      end: number;
      assetId: string;
      mode: 'full-screen' | 'split-left' | 'split-right';
      placement?: PlacementDecision;
      muted: true;
      reason: string;
      confidence: number;
    }
  | {
      id: string;
      type: 'director-placeholder';
      start: number;
      end: number;
      visualType: Exclude<VideoBeat['visualType'], 'speaker-full' | 'speaker-left' | 'speaker-right' | 'speaker-punch-in' | 'keyword-graphic'>;
      text?: string;
      textTrust?: DisplayTextTrust;
      searchQuery?: string;
      reason: string;
      confidence: number;
    };

export interface EditPlan {
  schemaVersion: string;
  projectId: string;
  sourceTranscriptHash: string;
  operations: EditOperation[];
  status: 'draft' | 'validated' | 'approved' | 'applied';
  createdBy: { provider: string; model: string };
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  action: string;
  projectId: string;
  status: JobStatus;
  progress: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  artifacts: string[];
}

export interface RenderResult {
  schemaVersion: string;
  projectId: string;
  outputPath: string;
  width: number;
  height: number;
  durationSeconds: number;
  editPlanHash: string;
  presentationHash: string;
}

export interface QAResult {
  schemaVersion: string;
  projectId: string;
  passed: boolean;
  transcript: { passed: boolean; failures: string[] };
  edit: { passed: boolean; failures: string[] };
  visual: { passed: boolean; failures: string[] };
  render: { passed: boolean; failures: string[] };
}

export interface ArtifactDependency {
  artifact: string;
  path: string;
  inputArtifacts: string[];
  inputHashes: Record<string, string>;
  presentationHash?: string;
  createdAt: string;
}