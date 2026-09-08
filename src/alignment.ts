import type {
  AlignedWord,
  AlignmentConfidence,
  AlignmentMetrics,
  AlignmentResult,
  AlignmentSample,
  AlignmentService,
  TranscriptDocument,
  TranscriptSegment,
  TranscriptWord,
} from './contracts.ts';

const bengaliDigits = '০১২৩৪৫৬৭৮৯';
const asciiDigits = '0123456789';

export function normalizeAlignmentText(text: string): string {
  return text.normalize('NFC').replace(/[.,!?;:।॥()[\]{}"']/gu, '').replace(/[০-৯]/gu, (digit) => asciiDigits[bengaliDigits.indexOf(digit)] ?? digit).replace(/\s+/gu, ' ').trim().toLocaleLowerCase('bn');
}

export function mapAlignmentToAuthoritativeText(originalWords: string[], alignedSpans: Array<{ text: string; start?: number; end?: number; confidence?: number }>, source: AlignedWord['source']): AlignedWord[] {
  const mapped: AlignedWord[] = [];
  let spanIndex = 0;
  for (const originalText of originalWords) {
    const normalizedOriginal = normalizeAlignmentText(originalText);
    const span = alignedSpans[spanIndex];
    const normalizedSpan = span ? normalizeAlignmentText(span.text) : '';
    const matchStatus: AlignedWord['matchStatus'] = !span ? 'unmatched' : normalizedOriginal === normalizedSpan ? (originalText === span.text ? 'exact' : 'normalized') : 'approximate';
    mapped.push({
      originalText,
      normalizedMatchText: normalizedSpan || undefined,
      start: span?.start,
      end: span?.end,
      confidence: span?.confidence ?? 0,
      source,
      matchStatus,
    });
    if (span) spanIndex += 1;
  }
  return mapped;
}

export function editBoundaryPolicy(confidence: AlignmentConfidence): { level: AlignmentConfidence; allowWordCuts: boolean; allowSentenceCuts: boolean; requiresReview: boolean } {
  if (confidence === 'high') return { level: confidence, allowWordCuts: true, allowSentenceCuts: true, requiresReview: false };
  if (confidence === 'medium') return { level: confidence, allowWordCuts: false, allowSentenceCuts: true, requiresReview: false };
  return { level: confidence, allowWordCuts: false, allowSentenceCuts: false, requiresReview: true };
}

interface RawToken {
  text?: string;
  p?: number;
  offsets?: { from?: number; to?: number };
}

interface RawSegment {
  text?: string;
  offsets?: { from?: number; to?: number };
  tokens?: RawToken[];
}

export interface RawWhisperDocument {
  transcription?: RawSegment[];
}

const ignoredTokens = new Set(['[_BEG_]', '[_END_]', '[_TT_150]', '[_TT_250]']);

const tokenText = (token: RawToken): string => token.text?.trim() ?? '';

const rawTime = (value: number | undefined): number => (value ?? 0) / 1000;

const normalizedWord = (segment: TranscriptSegment, token: RawToken, index: number, cursor: number): TranscriptWord => {
  const rawStart = rawTime(token.offsets?.from);
  const rawEnd = rawTime(token.offsets?.to);
  const segmentStart = segment.start;
  const segmentEnd = segment.end;
  const start = Math.max(cursor, Math.min(rawStart, segmentEnd));
  const end = Math.max(start, Math.min(rawEnd, segmentEnd));
  return {
    id: `${segment.id}-token-${index + 1}`,
    text: tokenText(token),
    sourceText: token.text ?? '',
    start,
    end,
    rawStart,
    rawEnd,
    confidence: token.p,
    language: 'bn',
    normalizationApplied: start !== rawStart || end !== rawEnd,
  };
};

export function measureAlignment(document: RawWhisperDocument, normalized: TranscriptDocument): AlignmentMetrics {
  const rawSegments = document.transcription ?? [];
  let totalTokens = 0;
  let zeroDurationTokenCount = 0;
  let negativeDurationTokenCount = 0;
  let overlappingTokenCount = 0;
  let tokenOutsideSegmentCount = 0;
  let largeGapCount = 0;
  let suspiciouslyLongTokenCount = 0;
  let normalizedTokenCount = 0;
  let chronological = true;

  rawSegments.forEach((segment, segmentIndex) => {
    const segmentStart = rawTime(segment.offsets?.from);
    const segmentEnd = rawTime(segment.offsets?.to);
    let previousEnd: number | undefined;
    let normalizedTokenIndex = 0;
    (segment.tokens ?? []).forEach((token) => {
      const text = tokenText(token);
      if (!text || ignoredTokens.has(text)) return;
      totalTokens += 1;
      const start = rawTime(token.offsets?.from);
      const end = rawTime(token.offsets?.to);
      if (end === start) zeroDurationTokenCount += 1;
      if (end < start) negativeDurationTokenCount += 1;
      if (previousEnd !== undefined && start < previousEnd) {
        overlappingTokenCount += 1;
        chronological = false;
      }
      if (previousEnd !== undefined && start - previousEnd > 0.5) largeGapCount += 1;
      if (start < segmentStart || end > segmentEnd) tokenOutsideSegmentCount += 1;
      if (end - start > 1.5) suspiciouslyLongTokenCount += 1;
      previousEnd = end;
      const normalizedWordValue = normalized.segments[segmentIndex]?.words[normalizedTokenIndex];
      if (normalizedWordValue?.normalizationApplied) normalizedTokenCount += 1;
      normalizedTokenIndex += 1;
    });
  });

  return {
    totalSegments: rawSegments.length,
    totalTokens,
    chronological,
    zeroDurationTokenCount,
    negativeDurationTokenCount,
    overlappingTokenCount,
    tokenOutsideSegmentCount,
    largeGapCount,
    suspiciouslyLongTokenCount,
    normalizedTokenCount,
    normalizedTokenPercentage: totalTokens === 0 ? 0 : (normalizedTokenCount / totalTokens) * 100,
  };
}

export function createAlignmentSamples(transcript: TranscriptDocument, source: string): AlignmentSample[] {
  return transcript.segments.flatMap((segment) => segment.words.filter((word) => word.text.length > 0).slice(0, 3).map((word) => ({
    segmentId: segment.id,
    start: word.start,
    end: word.end,
    text: word.text,
    duration: word.end - word.start,
    source,
    confidence: word.confidence,
    normalizationApplied: word.normalizationApplied ?? false,
  }))).slice(0, 12);
}

export class WhisperTokenAlignmentProvider implements AlignmentService {
  public constructor(private readonly raw: RawWhisperDocument) {}

  public async align(input: { audioPath: string; transcript: TranscriptDocument; rawAlignmentPath?: string }): Promise<AlignmentResult> {
    const metrics = measureAlignment(this.raw, input.transcript);
    const samples = createAlignmentSamples(input.transcript, 'whisper.cpp token offsets');
    const confidence = metrics.negativeDurationTokenCount === 0 && metrics.normalizedTokenPercentage < 2 ? 'medium' : 'low';
    return {
      provider: 'whisper-token-alignment',
      transcript: input.transcript,
      metrics,
      samples,
      confidence,
      limitations: [
        'Whisper tokens are subword or sub-character units, not Bengali words.',
        'Token offsets are recognition timestamps, not forced alignment against authoritative text.',
      ],
    };
  }
}