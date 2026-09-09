import {
  deterministicFallbackAnalysis,
  validateDirectorInput,
  type DirectorInput,
  type DirectorProvider,
  type DirectorProviderAvailability,
  type DirectorProviderResult,
  type ProviderAttempt,
} from './director.ts';
import {
  mergeCoverageRepair,
  resolvePrimarySegmentIds,
  validateCanonicalCoverage,
  type CanonicalCoverageReport,
} from './canonical-coverage.ts';
import type { SermonAnalysis } from './contracts.ts';

export type DirectorExecutionSource = 'ai' | 'deterministic-fallback' | 'mixed';
/**
 * NOT_CONFIGURED: no provider/model configuration exists.
 * UNAVAILABLE: a configured provider could not be reached.
 * FAILED: the provider executed but produced no usable result.
 * PARTIAL: the provider succeeded but deterministic fallback was still required somewhere.
 * MIXED: an aggregate of several units with differing outcomes.
 * SUCCESS: valid, complete provider result with no fallback.
 * AVAILABLE: retained alias of SUCCESS for existing consumers.
 */
export type DirectorProviderStatus = 'SUCCESS' | 'AVAILABLE' | 'PARTIAL' | 'MIXED' | 'UNAVAILABLE' | 'FAILED' | 'NOT_CONFIGURED';

export function isDirectorSuccessStatus(status: DirectorProviderStatus): boolean {
  return status === 'SUCCESS' || status === 'AVAILABLE';
}

export interface DirectorCoverageProvenance {
  report: CanonicalCoverageReport;
  repairAttempts: number;
  repairSuccesses: number;
  deterministicGapFilledSegmentIds: string[];
}

export interface DirectorExecutionProvenance {
  source: DirectorExecutionSource;
  provider: string;
  model?: string;
  providerStatus: DirectorProviderStatus;
  fallbackUsed: boolean;
  fallbackReason?: string;
  durationMs: number;
  schemaValidation: 'PASS' | 'FAIL' | 'NOT_RUN';
  canonicalRangeValidation: 'PASS' | 'FAIL' | 'NOT_RUN';
  canonicalCoverageValidation: 'PASS' | 'FAIL' | 'NOT_RUN';
  canonicalCoverageComplete: boolean;
  coverage?: DirectorCoverageProvenance;
  attempts: ProviderAttempt[];
}

export interface DirectorExecutionResult {
  analysis: SermonAnalysis;
  provenance: DirectorExecutionProvenance;
  providerResult?: DirectorProviderResult;
}

export interface DirectorExecutionOptions {
  provider?: DirectorProvider;
  fallback?: DeterministicDirectorFallback;
  /** Bounded number of AI coverage-repair requests. Defaults to 1. Never loops indefinitely. */
  maxCoverageRepairAttempts?: number;
}

function aggregateStatus(items: DirectorExecutionProvenance[]): DirectorProviderStatus {
  if (items.every((item) => isDirectorSuccessStatus(item.providerStatus))) return 'SUCCESS';
  if (items.some((item) => isDirectorSuccessStatus(item.providerStatus) || item.providerStatus === 'PARTIAL' || item.providerStatus === 'MIXED')) return 'MIXED';
  if (items.some((item) => item.providerStatus === 'FAILED')) return 'FAILED';
  if (items.some((item) => item.providerStatus === 'UNAVAILABLE')) return 'UNAVAILABLE';
  return 'NOT_CONFIGURED';
}

export function combineDirectorProvenance(items: DirectorExecutionProvenance[]): DirectorExecutionProvenance {
  if (!items.length) throw new Error('Cannot combine empty Director provenance.');
  const sources = new Set(items.map((item) => item.source));
  const providers = [...new Set(items.map((item) => item.provider))];
  const models = [...new Set(items.map((item) => item.model).filter((item): item is string => Boolean(item)))];
  const schemaStates = new Set(items.map((item) => item.schemaValidation));
  const rangeStates = new Set(items.map((item) => item.canonicalRangeValidation));
  const coverageStates = new Set(items.map((item) => item.canonicalCoverageValidation));
  const coverageItems = items.map((item) => item.coverage).filter((item): item is DirectorCoverageProvenance => Boolean(item));
  return {
    source: sources.size === 1 ? items[0].source : 'mixed',
    provider: providers.join(', '),
    model: models.join(', ') || undefined,
    providerStatus: aggregateStatus(items),
    fallbackUsed: items.some((item) => item.fallbackUsed),
    fallbackReason: [...new Set(items.map((item) => item.fallbackReason).filter((item): item is string => Boolean(item)))].join(' ') || undefined,
    durationMs: items.reduce((total, item) => total + item.durationMs, 0),
    schemaValidation: schemaStates.size === 1 ? items[0].schemaValidation : schemaStates.has('FAIL') ? 'FAIL' : 'NOT_RUN',
    canonicalRangeValidation: rangeStates.size === 1 ? items[0].canonicalRangeValidation : rangeStates.has('FAIL') ? 'FAIL' : 'NOT_RUN',
    canonicalCoverageValidation: coverageStates.size === 1 ? items[0].canonicalCoverageValidation : coverageStates.has('FAIL') ? 'FAIL' : 'NOT_RUN',
    canonicalCoverageComplete: items.every((item) => item.canonicalCoverageComplete),
    coverage: coverageItems.length ? {
      report: coverageItems[0].report,
      repairAttempts: coverageItems.reduce((total, item) => total + item.repairAttempts, 0),
      repairSuccesses: coverageItems.reduce((total, item) => total + item.repairSuccesses, 0),
      deterministicGapFilledSegmentIds: [...new Set(coverageItems.flatMap((item) => item.deterministicGapFilledSegmentIds))],
    } : undefined,
    attempts: items.flatMap((item) => item.attempts),
  };
}

export class DeterministicDirectorFallback {
  readonly name = 'deterministic-fallback';
  readonly model = 'canonical-segment-safe-v1.2';
  readonly cacheIdentity = 'deterministic-fallback-canonical-segment-safe-v1.2';

  execute(input: DirectorInput, reason: string, durationMs = 0, providerResult?: DirectorProviderResult): DirectorExecutionResult {
    const started = Date.now();
    const analysis = deterministicFallbackAnalysis(input);
    const primarySegmentIds = resolvePrimarySegmentIds(input.segments, input.primarySegmentIds);
    return {
      analysis,
      providerResult,
      provenance: {
        source: 'deterministic-fallback',
        provider: providerResult?.provider ?? this.name,
        model: providerResult?.model ?? this.model,
        providerStatus: providerResult?.providerResult === 'provider-failure' ? 'FAILED' : providerResult?.providerResult === 'provider-unavailable' ? 'UNAVAILABLE' : 'NOT_CONFIGURED',
        fallbackUsed: true,
        fallbackReason: reason,
        durationMs: durationMs + Date.now() - started,
        schemaValidation: providerResult?.attempts.some((attempt) => attempt.schema === 'pass') ? 'PASS' : providerResult?.attempts.length ? 'FAIL' : 'NOT_RUN',
        canonicalRangeValidation: providerResult?.attempts.some((attempt) => attempt.segmentReferences === 'pass') ? 'PASS' : providerResult?.attempts.length ? 'FAIL' : 'NOT_RUN',
        canonicalCoverageValidation: 'NOT_RUN',
        canonicalCoverageComplete: false,
        coverage: {
          report: validateCanonicalCoverage([], { segments: input.segments, primarySegmentIds }),
          repairAttempts: 0,
          repairSuccesses: 0,
          deterministicGapFilledSegmentIds: primarySegmentIds,
        },
        attempts: providerResult?.attempts ?? [],
      },
    };
  }
}

const sectionTypes = new Set(['introduction', 'scripture-reading', 'teaching', 'main-point', 'illustration', 'story', 'testimony', 'question', 'application', 'transition', 'prayer', 'emotional-ministry', 'conclusion', 'altar-call']);
const intensities = new Set(['reverent-calm', 'normal-teaching', 'story-illustration', 'emphasis']);
const visualRecommendations = new Set(['speaker-full', 'speaker-left', 'speaker-right', 'speaker-punch-in', 'scripture-card', 'title-card', 'keyword-graphic', 'image-broll', 'video-broll', 'motion-graphic', 'split-screen', 'none']);

export function validateResolvedDirectorAnalysis(analysis: SermonAnalysis, input: DirectorInput): string[] {
  const failures: string[] = [];
  if (!analysis || typeof analysis !== 'object') return ['Analysis must be an object.'];
  const candidate = analysis as Partial<SermonAnalysis>;
  const canonicalIndex = new Map(input.segments.map((segment, index) => [segment.id, index]));
  if (typeof candidate.version !== 'string' || !candidate.version) failures.push('Analysis version is missing.');
  if (candidate.projectId !== input.projectId) failures.push('Analysis project ID does not match the Director input.');
  if (!Array.isArray(candidate.supportingPassages)) failures.push('Analysis supportingPassages must be an array.');
  if (!Array.isArray(candidate.sections)) return [...failures, 'Analysis sections must be an array.'];
  if (!candidate.sections.length) failures.push('Analysis contains no semantic sections.');
  if (!Number.isFinite(candidate.confidence) || candidate.confidence! < 0 || candidate.confidence! > 1) failures.push('Analysis confidence is outside 0-1.');
  for (const section of candidate.sections) {
    if (typeof section.id !== 'string' || !section.id) failures.push('Analysis section ID is missing.');
    if (typeof section.transcriptText !== 'string') failures.push(`${section.id}: transcript text is invalid.`);
    if (typeof section.reason !== 'string' || !section.reason.trim()) failures.push(`${section.id}: reason is missing.`);
    if (!sectionTypes.has(section.type)) failures.push(`${section.id}: section type is invalid.`);
    if (section.intensity !== undefined && !intensities.has(section.intensity)) failures.push(`${section.id}: intensity is invalid.`);
    if (section.visualRecommendation !== undefined && !visualRecommendations.has(section.visualRecommendation)) failures.push(`${section.id}: visual recommendation is invalid.`);
    if (!Array.isArray(section.sourceSegmentIds)) {
      failures.push(`${section.id}: source segment IDs must be an array.`);
      continue;
    }
    const indices = section.sourceSegmentIds.map((id) => canonicalIndex.get(id));
    if (!indices.length || indices.some((index) => index === undefined)) {
      failures.push(`${section.id}: contains an unknown canonical segment ID.`);
      continue;
    }
    const resolved = indices as number[];
    if (resolved.some((index, position) => position > 0 && index !== resolved[position - 1] + 1)) failures.push(`${section.id}: canonical segment range is not contiguous.`);
    const canonical = resolved.map((index) => input.segments[index]);
    if (section.start !== canonical[0].start || section.end !== canonical.at(-1)!.end) failures.push(`${section.id}: timing does not match its canonical segment range.`);
    if (section.transcriptText !== canonical.map((segment) => segment.text).join(' ')) failures.push(`${section.id}: text does not match its canonical segment range.`);
    if (!Number.isFinite(section.confidence) || section.confidence < 0 || section.confidence > 1) failures.push(`${section.id}: confidence is outside 0-1.`);
  }
  for (let index = 1; index < candidate.sections.length; index += 1) {
    if (candidate.sections[index].start < candidate.sections[index - 1].end) failures.push(`${candidate.sections[index].id}: sections are not ordered and non-overlapping.`);
  }
  return failures;
}

async function availabilityFor(provider: DirectorProvider): Promise<DirectorProviderAvailability> {
  if (!provider.checkAvailability) return { available: true, checkedAt: new Date().toISOString() };
  return provider.checkAvailability();
}

export async function executeDirector(input: DirectorInput, options: DirectorExecutionOptions = {}): Promise<DirectorExecutionResult> {
  validateDirectorInput(input);
  const fallback = options.fallback ?? new DeterministicDirectorFallback();
  if (!options.provider) return fallback.execute(input, 'No configured Director AI provider is available.');

  const started = Date.now();
  let availability: DirectorProviderAvailability;
  try {
    availability = await availabilityFor(options.provider);
  } catch (error) {
    availability = {
      available: false,
      reason: error instanceof Error ? `Director provider availability check failed: ${error.message}` : `Director provider availability check failed: ${String(error)}`,
      checkedAt: new Date().toISOString(),
    };
  }
  if (!availability.available) {
    const providerResult: DirectorProviderResult = {
      providerResult: 'provider-unavailable',
      provider: options.provider.name,
      model: options.provider.model,
      runtimeMs: Date.now() - started,
      attempts: [],
      rawResponses: [],
      error: availability.reason,
    };
    return fallback.execute(input, availability.reason ?? 'Configured Director AI provider is unavailable.', providerResult.runtimeMs, providerResult);
  }

  let providerResult: DirectorProviderResult;
  try {
    providerResult = await options.provider.analyze(input);
  } catch (error) {
    providerResult = {
      providerResult: 'provider-failure',
      provider: options.provider.name,
      model: options.provider.model,
      runtimeMs: Date.now() - started,
      attempts: [],
      rawResponses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!providerResult.analysis || !['ai-success', 'ai-retry-success'].includes(providerResult.providerResult)) {
    return fallback.execute(input, providerResult.error ?? 'Director AI provider did not return a valid analysis.', providerResult.runtimeMs, providerResult);
  }
  const validationFailures = validateResolvedDirectorAnalysis(providerResult.analysis, input);
  const providerClaimsValid = providerResult.attempts.some((attempt) => attempt.schema === 'pass' && attempt.segmentReferences === 'pass' && attempt.semanticOutput === 'pass');
  if (validationFailures.length || !providerClaimsValid) {
    const failedResult: DirectorProviderResult = {
      ...providerResult,
      providerResult: 'provider-failure',
      error: validationFailures.length ? `Director output validation failed: ${validationFailures.join(' ')}` : 'Director provider did not report a fully valid structured-output attempt.',
    };
    return fallback.execute(input, failedResult.error ?? 'Director output validation failed.', failedResult.runtimeMs, failedResult);
  }

  const primarySegmentIds = resolvePrimarySegmentIds(input.segments, input.primarySegmentIds);
  const target = { segments: input.segments, primarySegmentIds };
  let analysis = providerResult.analysis;
  let coverage = validateCanonicalCoverage(analysis.sections, target);
  const maxRepairAttempts = Math.max(0, options.maxCoverageRepairAttempts ?? 1);
  const repairAttempts: ProviderAttempt[] = [];
  let repairAttemptCount = 0;
  let repairSuccessCount = 0;
  let repairRuntimeMs = 0;

  // Bounded, explicit coverage repair. Never loops beyond maxRepairAttempts.
  while (!coverage.complete && coverage.status === 'INCOMPLETE' && repairAttemptCount < maxRepairAttempts && options.provider.repairCoverage) {
    repairAttemptCount += 1;
    const missingSegmentIds = coverage.missingPrimaryIds;
    const positions = new Map(input.segments.map((segment, index) => [segment.id, index]));
    let repair: DirectorProviderResult;
    try {
      repair = await options.provider.repairCoverage({
        input,
        missingSegmentIds,
        missingSegmentIndices: missingSegmentIds.map((id) => positions.get(id)!).sort((left, right) => left - right),
        attempt: repairAttemptCount,
      });
    } catch (error) {
      repairAttempts.push({ attempt: repairAttemptCount, parse: 'fail', schema: 'fail', segmentReferences: 'fail', semanticOutput: 'fail', canonicalCoverage: 'fail', runtimeMs: 0, phase: 'coverage-repair', error: error instanceof Error ? error.message : String(error) });
      break;
    }
    repairAttempts.push(...repair.attempts.map((attempt) => ({ ...attempt, phase: 'coverage-repair' as const })));
    repairRuntimeMs += repair.runtimeMs;
    if (!repair.analysis || !['ai-success', 'ai-retry-success'].includes(repair.providerResult)) break;
    const repairFailures = validateResolvedDirectorAnalysis(repair.analysis, input);
    if (repairFailures.length) break;
    const merged = mergeCoverageRepair(analysis, repair.analysis.sections, target);
    const mergedCoverage = validateCanonicalCoverage(merged.analysis.sections, target);
    if (!merged.acceptedSections.length || mergedCoverage.status === 'INVALID') break;
    analysis = merged.analysis;
    coverage = mergedCoverage;
    if (coverage.complete) repairSuccessCount += 1;
  }

  const coverageProvenance: DirectorCoverageProvenance = {
    report: coverage,
    repairAttempts: repairAttemptCount,
    repairSuccesses: repairSuccessCount,
    deterministicGapFilledSegmentIds: coverage.complete ? [] : coverage.missingPrimaryIds,
  };
  const attempts = [...providerResult.attempts, ...repairAttempts];
  const durationMs = providerResult.runtimeMs + repairRuntimeMs;
  const resolvedProviderResult: DirectorProviderResult = { ...providerResult, analysis, attempts, runtimeMs: durationMs };

  if (!coverage.complete) {
    // Genuine AI decisions are retained, but incomplete canonical coverage can never be
    // reported as pure AI. Reconciliation deterministically gap-fills the remainder.
    return {
      analysis,
      providerResult: resolvedProviderResult,
      provenance: {
        source: 'mixed',
        provider: providerResult.provider,
        model: providerResult.model,
        providerStatus: 'PARTIAL',
        fallbackUsed: true,
        fallbackReason: `Canonical coverage incomplete after ${repairAttemptCount} bounded AI repair attempt(s). ${coverage.failures.join(' ')}`.trim(),
        durationMs,
        schemaValidation: attempts.some((attempt) => attempt.schema === 'pass') ? 'PASS' : 'FAIL',
        canonicalRangeValidation: attempts.some((attempt) => attempt.segmentReferences === 'pass') ? 'PASS' : 'FAIL',
        canonicalCoverageValidation: 'FAIL',
        canonicalCoverageComplete: false,
        coverage: coverageProvenance,
        attempts,
      },
    };
  }

  return {
    analysis,
    providerResult: resolvedProviderResult,
    provenance: {
      source: 'ai',
      provider: providerResult.provider,
      model: providerResult.model,
      providerStatus: 'SUCCESS',
      fallbackUsed: false,
      durationMs,
      schemaValidation: attempts.some((attempt) => attempt.schema === 'pass') ? 'PASS' : 'FAIL',
      canonicalRangeValidation: attempts.some((attempt) => attempt.segmentReferences === 'pass') ? 'PASS' : 'FAIL',
      canonicalCoverageValidation: 'PASS',
      canonicalCoverageComplete: true,
      coverage: coverageProvenance,
      attempts,
    },
  };
}
