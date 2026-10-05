import type { TranscriptDocument, TranscriptSegment } from '../../contracts.ts';
import type { ExtractedShort } from './shorts-model.ts';

const MAX_START_EXPANSION_SECONDS = 12;
const MAX_END_EXPANSION_SECONDS = 15;
const SENTENCE_PAUSE_SECONDS = 0.25;
const NATURAL_PAUSE_SECONDS = 0.85;
const MAX_SHORT_SECONDS = 120;

function isSentenceTerminated(text: string): boolean {
  return /(?:[।!?！？]|(?<!\.)\.)["'’”)\]]*\s*$/u.test(text.trim());
}

function speechEnd(segment: TranscriptSegment): number {
  const timedWords = (segment.words ?? []).filter((word) => word.end > word.start);
  return timedWords.at(-1)?.end ?? segment.end;
}

function hasNaturalBoundaryAfter(
  segments: TranscriptSegment[],
  index: number,
  physicalDurationSeconds: number,
): boolean {
  const segment = segments[index];
  const next = segments[index + 1];
  if (index === segments.length - 1) return isSentenceTerminated(segment.text);
  const endOfSpeech = speechEnd(segment);
  if (endOfSpeech > physicalDurationSeconds) return false;
  const pause = (next?.start ?? physicalDurationSeconds) - endOfSpeech;
  return (isSentenceTerminated(segment.text) && pause >= SENTENCE_PAUSE_SECONDS)
    || pause >= NATURAL_PAUSE_SECONDS;
}

function assertNotInsideWord(
  segments: TranscriptSegment[],
  segmentIndex: number,
  time: number,
  edge: 'start' | 'end',
): void {
  const word = (segments[segmentIndex].words ?? []).find((item) =>
    item.start < time && item.end > time,
  );
  if (word) throw new Error(`Short ${edge} falls inside transcript word ${word.id}.`);
}

export function correctShortBoundaries(
  short: ExtractedShort,
  transcript: TranscriptDocument,
  physicalDurationSeconds: number,
): ExtractedShort {
  if (!Number.isFinite(physicalDurationSeconds) || physicalDurationSeconds <= 0) {
    throw new Error('A verified physical source duration is required to validate Short boundaries.');
  }
  const segments = transcript.segments;
  const firstIndex = segments.findIndex((segment) => segment.id === short.sourceSegmentIds[0]);
  const lastIndex = segments.findIndex((segment) => segment.id === short.sourceSegmentIds.at(-1));
  if (firstIndex < 0 || lastIndex < firstIndex) throw new Error(`Short ${short.id} has invalid transcript segment references.`);
  if (short.sourceSegmentIds.length !== lastIndex - firstIndex + 1) {
    throw new Error(`Short ${short.id} must reference one continuous transcript range.`);
  }
  if (segments.slice(firstIndex, lastIndex + 1).some((segment, index) => segment.id !== short.sourceSegmentIds[index])) {
    throw new Error(`Short ${short.id} must reference transcript segments in source order.`);
  }

  const suggestedStart = short.aiSuggestedStartSeconds ?? short.sourceStartSeconds;
  const suggestedEnd = short.aiSuggestedEndSeconds ?? short.sourceEndSeconds;
  let safeFirstIndex = firstIndex;
  if (firstIndex > 0 && !hasNaturalBoundaryAfter(segments, firstIndex - 1, physicalDurationSeconds)) {
    let boundaryIndex = -1;
    for (let index = firstIndex - 2; index >= 0; index -= 1) {
      if (suggestedStart - segments[index + 1].start > MAX_START_EXPANSION_SECONDS) break;
      if (hasNaturalBoundaryAfter(segments, index, physicalDurationSeconds)) {
        boundaryIndex = index;
        break;
      }
    }
    if (boundaryIndex < 0) {
      throw new Error(`Short ${short.id} starts mid-thought and no nearby natural opening boundary was found.`);
    }
    safeFirstIndex = boundaryIndex + 1;
  }

  let safeLastIndex = lastIndex;
  while (!hasNaturalBoundaryAfter(segments, safeLastIndex, physicalDurationSeconds)) {
    const nextIndex = safeLastIndex + 1;
    if (nextIndex >= segments.length
      || segments[nextIndex].start - suggestedEnd > MAX_END_EXPANSION_SECONDS
      || segments[nextIndex].start >= physicalDurationSeconds) {
      throw new Error(`Short ${short.id} ends during active speech and no nearby complete-thought boundary was found.`);
    }
    safeLastIndex = nextIndex;
  }

  let safeStart = segments[safeFirstIndex].start;
  let safeEnd = Math.min(segments[safeLastIndex].end, physicalDurationSeconds);
  const firstWord = (segments[safeFirstIndex].words ?? []).find((word) => word.end > word.start);
  if (firstWord && safeStart > firstWord.start && safeStart < firstWord.end) safeStart = firstWord.start;
  assertNotInsideWord(segments, safeFirstIndex, safeStart, 'start');

  const lastWord = (segments[safeLastIndex].words ?? []).filter((word) => word.end > word.start).at(-1);
  if (lastWord && safeEnd > lastWord.start && safeEnd < lastWord.end) safeEnd = lastWord.end;
  if (safeEnd > physicalDurationSeconds) safeEnd = physicalDurationSeconds;
  assertNotInsideWord(segments, safeLastIndex, safeEnd, 'end');
  if (safeStart < 0 || safeEnd <= safeStart || safeEnd > physicalDurationSeconds) {
    throw new Error(`Short ${short.id} has no valid physical range within the source duration.`);
  }
  if (safeEnd - safeStart > MAX_SHORT_SECONDS) {
    throw new Error(`Short ${short.id} would exceed the 120-second limit after preserving complete speech.`);
  }

  const sourceSegmentIds = segments.slice(safeFirstIndex, safeLastIndex + 1).map((segment) => segment.id);
  const adjustedStart = Math.abs(safeStart - suggestedStart) > 0.01;
  const adjustedEnd = Math.abs(safeEnd - suggestedEnd) > 0.01;
  const reasons = [
    adjustedStart ? 'Opening moved to preserve the complete thought.' : '',
    adjustedEnd ? 'Ending extended to preserve complete speech.' : '',
  ].filter(Boolean);
  return {
    ...short,
    sourceSegmentIds,
    sourceStartSeconds: safeStart,
    sourceEndSeconds: safeEnd,
    durationEstimateSeconds: safeEnd - safeStart,
    aiSuggestedStartSeconds: suggestedStart,
    aiSuggestedEndSeconds: suggestedEnd,
    boundaryAdjustmentReason: reasons.length ? reasons.join(' ') : undefined,
  };
}
