import type { SermonAnalysis, SermonSection, TranscriptSegment } from './contracts.ts';

export const DIRECTOR_COVERAGE_CONTRACT_VERSION = 'director-coverage-contract-v1.2';

export type CanonicalCoverageStatus = 'COMPLETE' | 'INCOMPLETE' | 'INVALID';

export interface CanonicalCoverageReport {
  contractVersion: string;
  status: CanonicalCoverageStatus;
  complete: boolean;
  primarySegmentIds: string[];
  contextOnlySegmentIds: string[];
  coveredPrimaryIds: string[];
  missingPrimaryIds: string[];
  duplicatePrimaryIds: string[];
  conflictingSectionIds: string[];
  invalidSegmentIds: string[];
  contextOnlyIdsUsedAsPrimary: string[];
  primarySegmentCount: number;
  coveredPrimarySegmentCount: number;
  coveragePercent: number;
  missingRanges: CanonicalCoverageRange[];
  failures: string[];
}

export interface CanonicalCoverageRange {
  startSegment: number;
  endSegment: number;
  startSegmentId: string;
  endSegmentId: string;
  segmentIds: string[];
}

export interface CanonicalCoverageTarget {
  segments: TranscriptSegment[];
  primarySegmentIds: string[];
}

function percent(covered: number, total: number): number {
  if (!total) return 100;
  return Number(((covered / total) * 100).toFixed(3));
}

export function resolvePrimarySegmentIds(segments: TranscriptSegment[], primarySegmentIds?: string[]): string[] {
  if (!primarySegmentIds) return segments.map((segment) => segment.id);
  const canonical = new Set(segments.map((segment) => segment.id));
  const unknown = primarySegmentIds.filter((id) => !canonical.has(id));
  if (unknown.length) throw new Error(`Primary canonical segment IDs are not part of the Director input: ${unknown.join(', ')}`);
  return [...primarySegmentIds];
}

export function contiguousRanges(target: CanonicalCoverageTarget, segmentIds: string[]): CanonicalCoverageRange[] {
  const index = new Map(target.segments.map((segment, position) => [segment.id, position]));
  const positions = [...new Set(segmentIds)]
    .map((id) => index.get(id))
    .filter((position): position is number => position !== undefined)
    .sort((left, right) => left - right);
  const ranges: CanonicalCoverageRange[] = [];
  for (const position of positions) {
    const previous = ranges.at(-1);
    if (previous && position === previous.endSegment + 1) {
      previous.endSegment = position;
      previous.endSegmentId = target.segments[position].id;
      previous.segmentIds.push(target.segments[position].id);
      continue;
    }
    ranges.push({
      startSegment: position,
      endSegment: position,
      startSegmentId: target.segments[position].id,
      endSegmentId: target.segments[position].id,
      segmentIds: [target.segments[position].id],
    });
  }
  return ranges;
}

/**
 * Deterministic canonical coverage validation. Structural schema validity is NOT coverage
 * validity: a provider may return a perfectly shaped response that silently omits primary
 * canonical segments, so coverage is measured separately and explicitly.
 */
export function validateCanonicalCoverage(sections: SermonSection[], target: CanonicalCoverageTarget): CanonicalCoverageReport {
  const canonicalIds = new Set(target.segments.map((segment) => segment.id));
  const primaryIds = target.primarySegmentIds;
  const primarySet = new Set(primaryIds);
  const contextOnlyIds = target.segments.map((segment) => segment.id).filter((id) => !primarySet.has(id));
  const contextOnlySet = new Set(contextOnlyIds);

  const failures: string[] = [];
  const invalidSegmentIds: string[] = [];
  const contextOnlyIdsUsedAsPrimary: string[] = [];
  const conflictingSectionIds: string[] = [];
  const coverageCount = new Map<string, number>();

  for (const section of sections) {
    const ids = Array.isArray(section.sourceSegmentIds) ? section.sourceSegmentIds : [];
    if (!ids.length) {
      failures.push(`${section.id}: section references no canonical segments.`);
      conflictingSectionIds.push(section.id);
      continue;
    }
    const unknown = ids.filter((id) => !canonicalIds.has(id));
    if (unknown.length) {
      invalidSegmentIds.push(...unknown);
      failures.push(`${section.id}: references unknown canonical segment IDs (${unknown.join(', ')}).`);
      conflictingSectionIds.push(section.id);
      continue;
    }
    const primaryHits = ids.filter((id) => primarySet.has(id));
    const contextHits = ids.filter((id) => contextOnlySet.has(id));
    if (contextHits.length) contextOnlyIdsUsedAsPrimary.push(...contextHits);
    if (!primaryHits.length) {
      failures.push(`${section.id}: covers only context-overlap segments and cannot satisfy primary coverage.`);
      conflictingSectionIds.push(section.id);
      continue;
    }
    for (const id of primaryHits) {
      const seen = (coverageCount.get(id) ?? 0) + 1;
      coverageCount.set(id, seen);
      if (seen === 2) conflictingSectionIds.push(section.id);
    }
  }

  const coveredPrimaryIds = primaryIds.filter((id) => (coverageCount.get(id) ?? 0) > 0);
  const missingPrimaryIds = primaryIds.filter((id) => !(coverageCount.get(id) ?? 0));
  const duplicatePrimaryIds = primaryIds.filter((id) => (coverageCount.get(id) ?? 0) > 1);
  if (duplicatePrimaryIds.length) failures.push(`Primary canonical segments were covered more than once: ${duplicatePrimaryIds.join(', ')}.`);
  if (contextOnlyIdsUsedAsPrimary.length) failures.push(`Context-overlap segments were returned as primary output: ${[...new Set(contextOnlyIdsUsedAsPrimary)].join(', ')}.`);
  if (missingPrimaryIds.length) failures.push(`Primary canonical segments were not covered: ${missingPrimaryIds.join(', ')}.`);

  const invalid = Boolean(invalidSegmentIds.length || duplicatePrimaryIds.length || contextOnlyIdsUsedAsPrimary.length || conflictingSectionIds.length);
  const status: CanonicalCoverageStatus = invalid ? 'INVALID' : missingPrimaryIds.length ? 'INCOMPLETE' : 'COMPLETE';
  return {
    contractVersion: DIRECTOR_COVERAGE_CONTRACT_VERSION,
    status,
    complete: status === 'COMPLETE',
    primarySegmentIds: primaryIds,
    contextOnlySegmentIds: contextOnlyIds,
    coveredPrimaryIds,
    missingPrimaryIds,
    duplicatePrimaryIds,
    conflictingSectionIds: [...new Set(conflictingSectionIds)],
    invalidSegmentIds: [...new Set(invalidSegmentIds)],
    contextOnlyIdsUsedAsPrimary: [...new Set(contextOnlyIdsUsedAsPrimary)],
    primarySegmentCount: primaryIds.length,
    coveredPrimarySegmentCount: coveredPrimaryIds.length,
    coveragePercent: percent(coveredPrimaryIds.length, primaryIds.length),
    missingRanges: contiguousRanges(target, missingPrimaryIds),
    failures,
  };
}

/**
 * Merges AI repair sections into an existing AI analysis. Only sections that cover
 * still-missing primary canonical segments are accepted, so a repair can never
 * overwrite or duplicate an already covered canonical decision.
 */
export function mergeCoverageRepair(
  analysis: SermonAnalysis,
  repairSections: SermonSection[],
  target: CanonicalCoverageTarget,
): { analysis: SermonAnalysis; acceptedSections: SermonSection[]; rejectedSections: SermonSection[] } {
  const order = new Map(target.segments.map((segment, index) => [segment.id, index]));
  const before = validateCanonicalCoverage(analysis.sections, target);
  const stillMissing = new Set(before.missingPrimaryIds);
  const accepted: SermonSection[] = [];
  const rejected: SermonSection[] = [];
  for (const section of repairSections) {
    const ids = Array.isArray(section.sourceSegmentIds) ? section.sourceSegmentIds : [];
    const primaryHits = ids.filter((id) => stillMissing.has(id));
    if (!ids.length || primaryHits.length !== ids.length) {
      rejected.push(section);
      continue;
    }
    for (const id of ids) stillMissing.delete(id);
    accepted.push(section);
  }
  const sections = [...analysis.sections, ...accepted].sort((left, right) => {
    const leftIndex = order.get(left.sourceSegmentIds[0]) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.sourceSegmentIds[0]) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || left.start - right.start;
  });
  return { analysis: { ...analysis, sections }, acceptedSections: accepted, rejectedSections: rejected };
}
