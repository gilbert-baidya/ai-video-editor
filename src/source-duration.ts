import type { EditPlan, TranscriptDocument } from './contracts.ts';

export const SOURCE_DURATION_TOLERANCE_SECONDS = 0.5;

function finiteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatDurationSeconds(value: number): string {
  return value.toFixed(3).replace(/\.0+$/u, '').replace(/(\.\d*?)0+$/u, '$1');
}

export function sourceDurationMismatchMessage(physicalSeconds: number, requiredSeconds: number): string {
  return `Source duration mismatch: Physical footage is ${formatDurationSeconds(physicalSeconds)} seconds, but the approved timeline requires ${formatDurationSeconds(requiredSeconds)} seconds. Rendering is blocked.`;
}

export function sourceDurationMismatchDiagnostic(physicalSeconds: number, requiredSeconds: number): string {
  return `SOURCE_DURATION_MISMATCH: ${sourceDurationMismatchMessage(physicalSeconds, requiredSeconds)}`;
}

export function transcriptEndSeconds(transcript: TranscriptDocument): number {
  const boundaries = transcript.segments.flatMap((segment) => [
    segment.end,
    ...segment.words.map((word) => word.end),
  ]);
  if (transcript.sentences) boundaries.push(...transcript.sentences.map((sentence) => sentence.end));
  return boundaries.filter(finiteTime).reduce((latest, value) => Math.max(latest, value), 0);
}

export function planEndSeconds(plan: EditPlan): number {
  return plan.operations.reduce((latest, operation) => finiteTime(operation.end) ? Math.max(latest, operation.end) : latest, 0);
}

export function validateTranscriptTiming(
  transcript: TranscriptDocument,
  physicalSeconds: number,
  toleranceSeconds = SOURCE_DURATION_TOLERANCE_SECONDS,
): string[] {
  const failures: string[] = [];
  if (!finiteTime(physicalSeconds) || physicalSeconds <= 0) {
    return ['TRANSCRIPT_SOURCE_DURATION_UNVERIFIED: Transcript timing cannot be accepted until ffprobe verifies a positive physical source duration.'];
  }
  const transcriptEnd = transcriptEndSeconds(transcript);
  if (transcriptEnd > physicalSeconds + toleranceSeconds) {
    failures.push(`TRANSCRIPT_SOURCE_DURATION_MISMATCH: Transcript ends at ${formatDurationSeconds(transcriptEnd)} seconds, but physical source is ${formatDurationSeconds(physicalSeconds)} seconds.`);
  }

  let previousStart = -1;
  for (const segment of transcript.segments) {
    if (!finiteTime(segment.start) || !finiteTime(segment.end) || segment.start < 0 || segment.end <= segment.start) {
      failures.push(`TRANSCRIPT_TIMING_INVALID: Segment ${segment.id} has an invalid ${String(segment.start)}-${String(segment.end)} second range.`);
      continue;
    }
    if (segment.start < previousStart) failures.push(`TRANSCRIPT_TIMING_INVALID: Segment ${segment.id} is out of chronological order.`);
    previousStart = segment.start;
    for (const word of segment.words) {
      if (!finiteTime(word.start) || !finiteTime(word.end) || word.start < 0 || word.end < word.start) {
        failures.push(`TRANSCRIPT_TIMING_INVALID: Word ${word.id} has an invalid ${String(word.start)}-${String(word.end)} second range.`);
      } else if (word.start < segment.start - toleranceSeconds || word.end > segment.end + toleranceSeconds) {
        failures.push(`TRANSCRIPT_TIMING_INVALID: Word ${word.id} falls outside segment ${segment.id}.`);
      }
    }
  }

  for (const sentence of transcript.sentences ?? []) {
    if (!finiteTime(sentence.start) || !finiteTime(sentence.end) || sentence.start < 0 || sentence.end <= sentence.start) {
      failures.push(`TRANSCRIPT_TIMING_INVALID: Sentence ${sentence.id} has an invalid ${String(sentence.start)}-${String(sentence.end)} second range.`);
    }
  }

  return [...new Set(failures)];
}

export function validatePlanTiming(
  plan: EditPlan,
  physicalSeconds: number,
  requiredTimelineSeconds = planEndSeconds(plan),
  toleranceSeconds = SOURCE_DURATION_TOLERANCE_SECONDS,
): string[] {
  const failures: string[] = [];
  if (!finiteTime(physicalSeconds) || physicalSeconds <= 0) {
    return ['SOURCE_DURATION_UNVERIFIED: Edit Plan timing cannot be approved until ffprobe verifies a positive physical source duration.'];
  }
  if (!finiteTime(requiredTimelineSeconds) || requiredTimelineSeconds < 0) {
    failures.push('EDIT_PLAN_TIMING_INVALID: The approved timeline duration is not a finite non-negative number.');
  } else if (requiredTimelineSeconds > physicalSeconds + toleranceSeconds) {
    failures.push(sourceDurationMismatchDiagnostic(physicalSeconds, requiredTimelineSeconds));
  }
  for (const operation of plan.operations) {
    if (!finiteTime(operation.start) || !finiteTime(operation.end) || operation.start < 0 || operation.end <= operation.start) {
      failures.push(`EDIT_PLAN_TIMING_INVALID: Operation ${operation.id} has an invalid ${String(operation.start)}-${String(operation.end)} second range.`);
    } else if (operation.end > physicalSeconds + toleranceSeconds) {
      failures.push(`SOURCE_DURATION_MISMATCH: Operation ${operation.id} ends at ${formatDurationSeconds(operation.end)} seconds, but physical source is ${formatDurationSeconds(physicalSeconds)} seconds. Rendering is blocked.`);
    }
  }
  return [...new Set(failures)];
}
