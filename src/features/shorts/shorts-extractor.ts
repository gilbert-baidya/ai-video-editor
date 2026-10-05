import type { ExtractedShort, ShortsExtractionInput, ShortsExtractionResult } from './shorts-model.ts';

export interface ShortsProvider {
  name: string;
  extract(input: ShortsExtractionInput): Promise<ShortsExtractionResult>;
}

export function validateExtractedShorts(shorts: ExtractedShort[], input: ShortsExtractionInput): string[] {
  const errors: string[] = [];
  const segmentIndex = new Map(input.segments.map((segment, index) => [segment.id, index]));
  const seenIds = new Set<string>();
  const maximum = input.maxShortsToExtract ?? 5;
  if (!Array.isArray(shorts) || shorts.length === 0) errors.push('The AI provider returned no Short recommendations.');
  if (shorts.length > maximum) errors.push(`The AI provider returned ${shorts.length} Shorts; at most ${maximum} are allowed.`);
  for (const short of shorts) {
    if (!short.id?.trim()) errors.push('A Short recommendation is missing its ID.');
    else if (seenIds.has(short.id)) errors.push(`Duplicate Short ID: ${short.id}.`);
    else seenIds.add(short.id);
    if (!short.title?.trim()) errors.push(`Short ${short.id || '(unknown)'} is missing a title.`);
    if (!Number.isFinite(short.viralScore) || short.viralScore < 0 || short.viralScore > 10) errors.push(`Short ${short.title} has an invalid viral score.`);
    if (![30, 60, 90, 120].includes(short.targetDuration)) errors.push(`Short ${short.title} has an invalid target duration.`);
    if (!short.sourceSegmentIds || short.sourceSegmentIds.length === 0) {
      errors.push(`Short ${short.title} has no source segments.`);
      continue;
    }
    const indices: number[] = [];
    for (const segmentId of short.sourceSegmentIds) {
      const index = segmentIndex.get(segmentId);
      if (index === undefined) {
        errors.push(`Short ${short.title} references invalid segment ID: ${segmentId}`);
      } else {
        indices.push(index);
      }
    }
    if (indices.length !== short.sourceSegmentIds.length) continue;
    for (let index = 1; index < indices.length; index += 1) {
      if (indices[index] !== indices[index - 1] + 1) {
        errors.push(`Short ${short.title} must use one continuous, ordered source range.`);
        break;
      }
    }
    const first = input.segments[indices[0]];
    const last = input.segments[indices.at(-1)!];
    const duration = short.sourceEndSeconds - short.sourceStartSeconds;
    if (!Number.isFinite(short.sourceStartSeconds) || !Number.isFinite(short.sourceEndSeconds)
      || short.sourceStartSeconds < first.start - 0.01 || short.sourceStartSeconds >= short.sourceEndSeconds
      || short.sourceEndSeconds > last.end + 0.01) {
      errors.push(`Short ${short.title} has inconsistent or out-of-segment source boundaries.`);
    }
    if (duration < 30 || duration > 120) errors.push(`Short ${short.title} is ${duration.toFixed(2)} seconds; allowed duration is 30–120 seconds.`);
    if (!Number.isFinite(short.durationEstimateSeconds) || Math.abs(short.durationEstimateSeconds - duration) > 0.25) {
      errors.push(`Short ${short.title} has inconsistent duration metadata.`);
    }
  }
  return [...new Set(errors)];
}
