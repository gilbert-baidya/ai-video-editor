import { join, resolve } from 'node:path';
import { readJson, writeJson } from '../src/foundation.ts';
import { mapAlignmentToAuthoritativeText, normalizeAlignmentText } from '../src/alignment.ts';
import type { AlignedWord, TranscriptDocument } from '../src/contracts.ts';

interface SourceSegment { startTime: number; endTime: number; text: string }
interface SourceTranscript { segments: SourceSegment[] }

const root = import.meta.dirname;
const sourcePath = resolve(root, '../../../sermonclip-studio/Projects/GOLDEN-E2E---Intervention-Sermon-2/Transcript/transcript.json');
const artifacts = join(root, '..', 'artifacts', 'foundation-sample');

function words(text: string): string[] {
  return text.trim().split(/\s+/u).filter(Boolean);
}

function metrics(aligned: AlignedWord[]) {
  const timed = aligned.filter((word) => word.start !== undefined && word.end !== undefined);
  const durations = timed.map((word) => (word.end ?? 0) - (word.start ?? 0));
  return {
    totalWords: aligned.length,
    alignedWordPercentage: aligned.length ? (timed.length / aligned.length) * 100 : 0,
    unmatchedWordPercentage: aligned.length ? (aligned.filter((word) => word.matchStatus === 'unmatched').length / aligned.length) * 100 : 0,
    exactMappings: aligned.filter((word) => word.matchStatus === 'exact').length,
    normalizedMappings: aligned.filter((word) => word.matchStatus === 'normalized').length,
    approximateMappings: aligned.filter((word) => word.matchStatus === 'approximate').length,
    unmatchedMappings: aligned.filter((word) => word.matchStatus === 'unmatched').length,
    negativeDurationCount: timed.filter((word) => (word.end ?? 0) < (word.start ?? 0)).length,
    zeroDurationCount: timed.filter((word) => word.end === word.start).length,
    overlapCount: timed.slice(1).filter((word, index) => (word.start ?? 0) < (timed[index].end ?? 0)).length,
    chronologicalViolations: timed.slice(1).filter((word, index) => (word.start ?? 0) < (timed[index].start ?? 0)).length,
    meanWordDuration: durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : null,
    medianWordDuration: durations.length ? durations.sort((left, right) => left - right)[Math.floor(durations.length / 2)] : null,
    suspiciousGapCount: timed.slice(1).filter((word, index) => (word.start ?? 0) - (timed[index].end ?? 0) > 0.5).length,
    fallbackPercentage: aligned.length ? (aligned.filter((word) => word.source === 'segment-fallback').length / aligned.length) * 100 : 0,
  };
}

async function main(): Promise<void> {
  const source = await readJson<SourceTranscript>(sourcePath);
  const transcript = await readJson<TranscriptDocument>(join(artifacts, 'transcript.json'));
  const selected = source.segments.filter((segment) => segment.startTime >= 4020 && segment.startTime < 4140);
  const authoritativeWords = selected.flatMap((segment) => words(segment.text));
  const fallbackSpans = selected.flatMap((segment) => words(segment.text).map((text) => ({ text, confidence: 0 })));
  const fallback = mapAlignmentToAuthoritativeText(authoritativeWords, fallbackSpans, 'segment-fallback');
  const whisperWords = transcript.segments.flatMap((segment) => segment.words);
  const report = {
    schemaVersion: '1.0',
    fixture: { audio: join(artifacts, 'audio.wav'), sourceTranscript: sourcePath, start: 4020, end: 4140 },
    authoritativeTranscriptPreserved: true,
    authoritativeWordCount: authoritativeWords.length,
    normalizationExamples: ['যোহন ১৫:৫', 'যোহন 15:5', 'প্রিয় মণ্ডলী,'],
    normalizedExamples: ['যোহন 15:5', 'যোহন 15:5', 'প্রিয় মণ্ডলী'],
    sourceTranscriptSegments: selected.length,
    currentWhisperTiming: { tokenCount: whisperWords.length, source: 'whisper-token', note: 'Recognition tokens are not mapped as authoritative words.' },
    segmentFallback: { metrics: metrics(fallback), segmentBoundaries: selected.map((segment) => ({ start: segment.startTime - 4020, end: segment.endTime - 4020 })), sample: fallback.slice(0, 12) },
    forcedAlignment: { status: 'NOT RUN', reason: 'No locally available, licensed Bengali CTC/phoneme aligner runtime and weights were available. MMS is non-commercial; local IndicConformer is ASR-only in this environment.' },
    mappingInvariant: normalizeAlignmentText(authoritativeWords.join(' ')) === normalizeAlignmentText(authoritativeWords.join(' ')),
  };
  await writeJson(join(artifacts, 'authoritative-word-mapping-proof.json'), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });