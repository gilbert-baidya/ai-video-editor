import type { SermonAnalysis, SermonSection, SermonSectionType, TranscriptDocument, TranscriptSegment, VisualRecommendation } from './contracts.ts';
import { combineDirectorProvenance, type DirectorExecutionProvenance, type DirectorExecutionResult } from './director-execution.ts';
import type { DirectorInput } from './director.ts';
import { sha256 } from './foundation.ts';

export interface SermonChunkConfig {
  targetSegments: number;
  maxSegments: number;
  overlapSegments: number;
  sentenceLookback: number;
}

export interface SermonChunk {
  id: string;
  ordinal: number;
  startIndex: number;
  endIndex: number;
  contextStartIndex: number;
  contextEndIndex: number;
  segmentIds: string[];
  contextSegmentIds: string[];
  start: number;
  end: number;
  inputCharacters: number;
  estimatedTokens: number;
}

export interface ChunkAnalysisResult {
  chunk: SermonChunk;
  execution: DirectorExecutionResult;
}

export interface ReconciliationRecord {
  type: 'gap-fill' | 'overlap-conflict' | 'duplicate-visual-suppression' | 'cooldown-suppression' | 'reverent-suppression' | 'density-suppression';
  segmentId?: string;
  sectionId?: string;
  resolution: string;
  details?: unknown;
}

export interface ChunkReconciliationResult {
  analysis: SermonAnalysis;
  records: ReconciliationRecord[];
  sectionProvenance: Record<string, DirectorExecutionProvenance>;
}

export function canonicalTranscriptHash(transcript: TranscriptDocument): string {
  return sha256(JSON.stringify({
    projectId: transcript.projectId,
    segments: transcript.segments.map(({ id, start, end, text }) => ({ id, start, end, text })),
  }));
}

export const defaultSermonChunkConfig: SermonChunkConfig = {
  targetSegments: 22,
  maxSegments: 28,
  overlapSegments: 2,
  sentenceLookback: 5,
};

const sentenceEnd = /[.!?।॥]["'’”)]?\s*$/u;
const reverentTypes = new Set<SermonSectionType>(['scripture-reading', 'prayer', 'emotional-ministry', 'altar-call']);
const activeVisuals = new Set<VisualRecommendation>(['speaker-left', 'speaker-right', 'speaker-punch-in', 'scripture-card', 'title-card', 'keyword-graphic', 'image-broll', 'video-broll', 'motion-graphic', 'split-screen']);

function boundaryAt(segments: TranscriptSegment[], start: number, config: SermonChunkConfig): number {
  const desired = Math.min(segments.length - 1, start + config.targetSegments - 1);
  const maximum = Math.min(segments.length - 1, start + config.maxSegments - 1);
  for (let index = desired; index >= Math.max(start, desired - config.sentenceLookback); index -= 1) {
    if (sentenceEnd.test(segments[index].text)) return index;
  }
  for (let index = desired + 1; index <= maximum; index += 1) {
    if (sentenceEnd.test(segments[index].text)) return index;
  }
  return desired;
}

export function createSermonChunks(segments: TranscriptSegment[], config: SermonChunkConfig = defaultSermonChunkConfig): SermonChunk[] {
  if (!Number.isInteger(config.targetSegments) || config.targetSegments < 1) throw new Error('targetSegments must be a positive integer.');
  if (!Number.isInteger(config.maxSegments) || config.maxSegments < config.targetSegments) throw new Error('maxSegments must be at least targetSegments.');
  if (!Number.isInteger(config.overlapSegments) || config.overlapSegments < 0 || config.overlapSegments >= config.targetSegments) throw new Error('overlapSegments must be non-negative and smaller than targetSegments.');
  const chunks: SermonChunk[] = [];
  for (let startIndex = 0, ordinal = 1; startIndex < segments.length; ordinal += 1) {
    const endIndex = boundaryAt(segments, startIndex, config);
    const contextStartIndex = Math.max(0, startIndex - config.overlapSegments);
    const contextEndIndex = Math.min(segments.length - 1, endIndex + config.overlapSegments);
    const primary = segments.slice(startIndex, endIndex + 1);
    const context = segments.slice(contextStartIndex, contextEndIndex + 1);
    const identity = `${primary[0].id}|${primary.at(-1)!.id}`;
    const inputCharacters = context.reduce((total, segment) => total + segment.text.length, 0);
    chunks.push({
      id: `chunk-${String(ordinal).padStart(3, '0')}-${sha256(identity).slice(0, 10)}`,
      ordinal,
      startIndex,
      endIndex,
      contextStartIndex,
      contextEndIndex,
      segmentIds: primary.map((segment) => segment.id),
      contextSegmentIds: context.map((segment) => segment.id),
      start: primary[0].start,
      end: primary.at(-1)!.end,
      inputCharacters,
      estimatedTokens: Math.ceil(inputCharacters / 3.2),
    });
    startIndex = endIndex + 1;
  }
  return chunks;
}

export function createChunkDirectorInput(transcript: TranscriptDocument, chunk: SermonChunk): DirectorInput {
  const segments = transcript.segments.slice(chunk.contextStartIndex, chunk.contextEndIndex + 1);
  if (segments.map((segment) => segment.id).join('|') !== chunk.contextSegmentIds.join('|')) throw new Error(`${chunk.id}: canonical context segments changed.`);
  const text = segments.map((segment) => segment.text).join(' ').trim();
  const boundedTranscript: TranscriptDocument = {
    ...transcript,
    projectId: `${transcript.projectId}-${chunk.id}`,
    originalTranscript: text,
    aiSuggestedDisplayText: text,
    approvedDisplayText: text,
    segments,
  };
  return { transcript: boundedTranscript, segments, projectDuration: segments.at(-1)!.end, projectId: boundedTranscript.projectId };
}

function choiceForSegment(candidates: Array<{ chunk: SermonChunk; section: SermonSection; execution: DirectorExecutionResult }>): { chunk: SermonChunk; section: SermonSection; execution: DirectorExecutionResult } {
  return [...candidates].sort((left, right) => {
    const leftReverent = reverentTypes.has(left.section.type) ? 1 : 0;
    const rightReverent = reverentTypes.has(right.section.type) ? 1 : 0;
    return rightReverent - leftReverent
      || right.section.confidence - left.section.confidence
      || left.chunk.ordinal - right.chunk.ordinal
      || left.section.id.localeCompare(right.section.id);
  })[0];
}

function moment(sections: SermonSection[], type: SermonSectionType) {
  return sections.filter((section) => section.type === type).map((section) => ({
    id: section.id,
    text: section.suggestedDisplayText ?? section.transcriptText,
    start: section.start,
    end: section.end,
    confidence: section.confidence,
    reason: section.reason,
  }));
}

export function reconcileChunkAnalyses(
  transcript: TranscriptDocument,
  results: ChunkAnalysisResult[],
  options: { cooldownSeconds?: number; maxEventsPerMinute?: number } = {},
): ChunkReconciliationResult {
  const cooldownSeconds = options.cooldownSeconds ?? 10;
  const maxEventsPerMinute = options.maxEventsPerMinute ?? 8;
  const records: ReconciliationRecord[] = [];
  const segmentIndex = new Map(transcript.segments.map((segment, index) => [segment.id, index]));
  const candidates = results.flatMap(({ chunk, execution }) => execution.analysis.sections.flatMap((section) => {
    const indices = section.sourceSegmentIds.map((id) => segmentIndex.get(id));
    if (indices.some((index) => index === undefined)) {
      records.push({ type: 'overlap-conflict', sectionId: section.id, resolution: 'discarded non-canonical range', details: section.sourceSegmentIds });
      return [];
    }
    return [{ chunk, section, execution }];
  }));

  const selected = transcript.segments.map((segment) => {
    const applicable = candidates.filter(({ section }) => section.sourceSegmentIds.includes(segment.id));
    if (!applicable.length) {
      records.push({ type: 'gap-fill', segmentId: segment.id, resolution: 'speaker-full canonical no-change' });
      const fallbackSection: SermonSection = {
        id: `section-${sha256(segment.id).slice(0, 12)}`,
        start: segment.start,
        end: segment.end,
        transcriptText: segment.text,
        sourceSegmentIds: [segment.id],
        type: 'transition',
        intensity: 'normal-teaching',
        visualRecommendation: 'speaker-full',
        confidence: 0.5,
        reason: 'Reconciliation retained an uncovered canonical segment as a speaker-led no-change section.',
      };
      return {
        chunk: undefined,
        section: fallbackSection,
      };
    }
    const chosen = choiceForSegment(applicable);
    if (applicable.some((candidate) => candidate.section.id !== chosen.section.id)) {
      records.push({
        type: 'overlap-conflict',
        segmentId: segment.id,
        resolution: `selected ${chosen.section.id} by reverence, confidence, and stable chunk order`,
        details: applicable.map((candidate) => ({ chunkId: candidate.chunk.id, sectionId: candidate.section.id, confidence: candidate.section.confidence })),
      });
    }
    return chosen;
  });

  const sections: SermonSection[] = [];
  const provenanceBySegment = new Map<string, { key: string; provenance: DirectorExecutionProvenance }>();
  for (let index = 0; index < selected.length; index += 1) {
    const segment = transcript.segments[index];
    const selection = selected[index];
    const candidate = selection.section;
    if ('execution' in selection) provenanceBySegment.set(segment.id, { key: selection.chunk.id, provenance: selection.execution.provenance });
    const previous = sections.at(-1);
    const signature = `${candidate.type}|${candidate.intensity}|${candidate.visualRecommendation}|${candidate.suggestedDisplayText ?? ''}|${candidate.scriptureReference ?? ''}|${candidate.reason}`;
    const previousSignature = previous ? `${previous.type}|${previous.intensity}|${previous.visualRecommendation}|${previous.suggestedDisplayText ?? ''}|${previous.scriptureReference ?? ''}|${previous.reason}` : undefined;
    if (previous && signature === previousSignature) {
      previous.end = segment.end;
      previous.transcriptText = `${previous.transcriptText} ${segment.text}`.trim();
      previous.sourceSegmentIds.push(segment.id);
      previous.id = `section-${sha256(previous.sourceSegmentIds.join('|')).slice(0, 12)}`;
      previous.confidence = Math.min(previous.confidence, candidate.confidence);
    } else {
      sections.push({ ...candidate, id: `section-${sha256(segment.id).slice(0, 12)}`, start: segment.start, end: segment.end, transcriptText: segment.text, sourceSegmentIds: [segment.id] });
    }
  }

  let lastVisualEnd = Number.NEGATIVE_INFINITY;
  let lastVisual: VisualRecommendation | undefined;
  let eventCount = 0;
  const duration = Math.max(1, transcript.segments.at(-1)!.end - transcript.segments[0].start);
  const eventLimit = Math.max(1, Math.floor(duration / 60 * maxEventsPerMinute));
  for (const section of sections) {
    const visual = section.visualRecommendation ?? 'speaker-full';
    if (reverentTypes.has(section.type) && activeVisuals.has(visual) && visual !== 'scripture-card') {
      records.push({ type: 'reverent-suppression', sectionId: section.id, resolution: 'speaker-full' });
      section.visualRecommendation = 'speaker-full';
      section.intensity = 'reverent-calm';
      continue;
    }
    if (!activeVisuals.has(visual)) continue;
    if (visual === lastVisual) {
      records.push({ type: 'duplicate-visual-suppression', sectionId: section.id, resolution: 'speaker-full' });
      section.visualRecommendation = 'speaker-full';
      continue;
    }
    if (section.start - lastVisualEnd < cooldownSeconds) {
      records.push({ type: 'cooldown-suppression', sectionId: section.id, resolution: 'speaker-full' });
      section.visualRecommendation = 'speaker-full';
      continue;
    }
    if (eventCount >= eventLimit) {
      records.push({ type: 'density-suppression', sectionId: section.id, resolution: 'speaker-full' });
      section.visualRecommendation = 'speaker-full';
      continue;
    }
    eventCount += 1;
    lastVisual = visual;
    lastVisualEnd = section.end;
  }

  const mainPoint = sections.find((section) => section.type === 'main-point');
  const passage = sections.find((section) => section.scriptureReference);
  const sectionProvenance: Record<string, DirectorExecutionProvenance> = Object.fromEntries(sections.map((section) => {
    const provenanceEntries = section.sourceSegmentIds.map((id) => provenanceBySegment.get(id)).filter((item): item is { key: string; provenance: DirectorExecutionProvenance } => Boolean(item));
    const provenance = [...new Map(provenanceEntries.map((item) => [item.key, item.provenance])).values()];
    const resolved: DirectorExecutionProvenance = provenance.length ? combineDirectorProvenance(provenance) : {
      source: 'deterministic-fallback',
      provider: 'deterministic-fallback',
      model: 'canonical-gap-fill-v1.1',
      providerStatus: 'NOT_CONFIGURED',
      fallbackUsed: true,
      fallbackReason: 'No provider recommendation covered this canonical segment.',
      durationMs: 0,
      schemaValidation: 'NOT_RUN',
      canonicalRangeValidation: 'NOT_RUN',
      attempts: [],
    };
    return [section.id, resolved];
  }));
  return {
    records,
    sectionProvenance,
    analysis: {
      version: 'full-sermon-provider-neutral-v1.1',
      projectId: transcript.projectId,
      title: mainPoint?.suggestedDisplayText,
      mainTheme: mainPoint?.suggestedDisplayText,
      mainPassage: passage?.scriptureReference ? { rawText: passage.scriptureReference, normalizedReference: passage.scriptureReference, start: passage.start, end: passage.end, confidence: passage.confidence, verificationStatus: 'needs-review' } : undefined,
      supportingPassages: [],
      sections,
      mainPoints: moment(sections, 'main-point'),
      keyStatements: moment(sections, 'main-point'),
      illustrations: moment(sections, 'illustration'),
      stories: moment(sections, 'story'),
      testimonies: moment(sections, 'testimony'),
      questions: moment(sections, 'question'),
      applications: moment(sections, 'application'),
      prayerMoments: moment(sections, 'prayer'),
      emotionalMoments: moment(sections, 'emotional-ministry'),
      conclusion: sections.find((section) => section.type === 'conclusion'),
      altarCall: sections.find((section) => section.type === 'altar-call'),
      confidence: sections.reduce((total, section) => total + section.confidence, 0) / Math.max(1, sections.length),
    },
  };
}
