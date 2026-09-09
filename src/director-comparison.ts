import type { BrollDecision, EditPlan, SermonAnalysis } from './contracts.ts';
import type { DirectorExecutionProvenance } from './director-execution.ts';
import { buildBrollIntents } from './broll-selection.ts';
import { generateVisualBeats } from './director.ts';
import { applyRetentionPolicy } from './visual-policy.ts';

export interface DirectorComparisonMetrics {
  beatCount: number;
  visualEventCount: number;
  eventsPerMinute: number;
  scriptureSectionActivity: number;
  storySectionActivity: number;
  noChangeDecisions: number;
  brollDecisions: number;
  graphicDecisions: number;
  layoutDecisions: number;
  rejectedUnsafeDecisions: number;
  schemaValid: boolean;
  canonicalRangeValid: boolean;
  canonicalCoverageComplete: boolean;
  primaryCanonicalSegmentCount: number;
  aiCoveredPrimarySegmentCount: number;
  deterministicGapFilledSegmentCount: number;
  coveragePercent: number;
  coverageRepairAttempts: number;
  coverageRepairSuccesses: number;
  providerChunkCount: number;
  providerSuccessCount: number;
  provenance: string;
  runtimeMs: number;
  fallbackUsed: boolean;
}

export interface DirectorComparison {
  fallback: DirectorComparisonMetrics;
  ai: DirectorComparisonMetrics;
  delta: Partial<Record<keyof DirectorComparisonMetrics, number | boolean>>;
}

export interface DirectorComparisonContext {
  providerChunkCount?: number;
  providerSuccessCount?: number;
}

export function measureDirectorResult(
  analysis: SermonAnalysis,
  provenance: DirectorExecutionProvenance,
  durationSeconds: number,
  sourceTranscriptHash: string,
  decisions: BrollDecision[] = [],
  context: DirectorComparisonContext = {},
): DirectorComparisonMetrics {
  const beats = generateVisualBeats(analysis);
  const policy = applyRetentionPolicy(analysis, analysis.projectId, sourceTranscriptHash, durationSeconds);
  const intents = buildBrollIntents(analysis);
  const operations: EditPlan['operations'] = policy.editPlan.operations;
  const activeSections = new Set(policy.records.filter((record) => !['none', 'speaker-full', 'keep-current'].includes(record.resolvedDecision)).map((record) => record.sectionId));
  const coverage = provenance.coverage;
  const gapFilled = coverage?.deterministicGapFilledSegmentIds.length ?? (provenance.source === 'deterministic-fallback' ? coverage?.report.primarySegmentCount ?? 0 : 0);
  return {
    beatCount: beats.length,
    visualEventCount: operations.length,
    eventsPerMinute: Number((operations.length / Math.max(durationSeconds / 60, Number.EPSILON)).toFixed(3)),
    scriptureSectionActivity: analysis.sections.filter((section) => section.type === 'scripture-reading' && activeSections.has(section.id)).length,
    storySectionActivity: analysis.sections.filter((section) => ['story', 'illustration', 'testimony'].includes(section.type) && activeSections.has(section.id)).length,
    noChangeDecisions: policy.records.filter((record) => ['none', 'speaker-full', 'keep-current'].includes(record.resolvedDecision)).length,
    brollDecisions: decisions.length ? decisions.filter((decision) => decision.decision === 'selected').length : intents.filter((intent) => intent.decision === 'search').length,
    graphicDecisions: operations.filter((operation) => operation.type === 'sermon-point' || operation.type === 'full-screen-card').length,
    layoutDecisions: operations.filter((operation) => operation.type === 'speaker-position').length,
    rejectedUnsafeDecisions: policy.records.filter((record) => record.policyDecision === 'SUPPRESS' || record.policyDecision === 'REVIEW').length
      + decisions.filter((decision) => decision.decision === 'no-suitable-asset').length,
    schemaValid: provenance.schemaValidation === 'PASS' || provenance.source === 'deterministic-fallback',
    canonicalRangeValid: provenance.canonicalRangeValidation === 'PASS' || provenance.source === 'deterministic-fallback',
    canonicalCoverageComplete: provenance.canonicalCoverageComplete,
    primaryCanonicalSegmentCount: coverage?.report.primarySegmentCount ?? 0,
    aiCoveredPrimarySegmentCount: coverage?.report.coveredPrimarySegmentCount ?? 0,
    deterministicGapFilledSegmentCount: gapFilled,
    coveragePercent: coverage?.report.coveragePercent ?? 0,
    coverageRepairAttempts: coverage?.repairAttempts ?? 0,
    coverageRepairSuccesses: coverage?.repairSuccesses ?? 0,
    providerChunkCount: context.providerChunkCount ?? 0,
    providerSuccessCount: context.providerSuccessCount ?? 0,
    provenance: provenance.source,
    runtimeMs: provenance.durationMs,
    fallbackUsed: provenance.fallbackUsed,
  };
}

export function compareDirectorResults(fallback: DirectorComparisonMetrics, ai: DirectorComparisonMetrics): DirectorComparison {
  const delta: DirectorComparison['delta'] = {};
  for (const key of Object.keys(fallback) as Array<keyof DirectorComparisonMetrics>) {
    const left = fallback[key];
    const right = ai[key];
    delta[key] = typeof left === 'number' && typeof right === 'number' ? right - left : right === left;
  }
  return { fallback, ai, delta };
}
