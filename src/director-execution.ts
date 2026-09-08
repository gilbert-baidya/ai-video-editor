import {
  deterministicFallbackAnalysis,
  validateDirectorInput,
  type DirectorInput,
  type DirectorProvider,
  type DirectorProviderAvailability,
  type DirectorProviderResult,
  type ProviderAttempt,
} from './director.ts';
import type { SermonAnalysis } from './contracts.ts';

export type DirectorExecutionSource = 'ai' | 'deterministic-fallback' | 'mixed';
export type DirectorProviderStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'FAILED' | 'NOT_CONFIGURED';

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
}

export function combineDirectorProvenance(items: DirectorExecutionProvenance[]): DirectorExecutionProvenance {
  if (!items.length) throw new Error('Cannot combine empty Director provenance.');
  const sources = new Set(items.map((item) => item.source));
  const providers = [...new Set(items.map((item) => item.provider))];
  const models = [...new Set(items.map((item) => item.model).filter((item): item is string => Boolean(item)))];
  const schemaStates = new Set(items.map((item) => item.schemaValidation));
  const rangeStates = new Set(items.map((item) => item.canonicalRangeValidation));
  return {
    source: sources.size === 1 ? items[0].source : 'mixed',
    provider: providers.join(', '),
    model: models.join(', ') || undefined,
    providerStatus: items.every((item) => item.providerStatus === 'AVAILABLE')
      ? 'AVAILABLE'
      : items.some((item) => item.providerStatus === 'FAILED')
        ? 'FAILED'
        : items.some((item) => item.providerStatus === 'UNAVAILABLE')
          ? 'UNAVAILABLE'
          : 'NOT_CONFIGURED',
    fallbackUsed: items.some((item) => item.fallbackUsed),
    fallbackReason: [...new Set(items.map((item) => item.fallbackReason).filter((item): item is string => Boolean(item)))].join(' ') || undefined,
    durationMs: items.reduce((total, item) => total + item.durationMs, 0),
    schemaValidation: schemaStates.size === 1 ? items[0].schemaValidation : schemaStates.has('FAIL') ? 'FAIL' : 'NOT_RUN',
    canonicalRangeValidation: rangeStates.size === 1 ? items[0].canonicalRangeValidation : rangeStates.has('FAIL') ? 'FAIL' : 'NOT_RUN',
    attempts: items.flatMap((item) => item.attempts),
  };
}

export class DeterministicDirectorFallback {
  readonly name = 'deterministic-fallback';
  readonly model = 'canonical-segment-safe-v1.1';
  readonly cacheIdentity = 'deterministic-fallback-canonical-segment-safe-v1.1';

  execute(input: DirectorInput, reason: string, durationMs = 0, providerResult?: DirectorProviderResult): DirectorExecutionResult {
    const started = Date.now();
    const analysis = deterministicFallbackAnalysis(input);
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

  return {
    analysis: providerResult.analysis,
    providerResult,
    provenance: {
      source: 'ai',
      provider: providerResult.provider,
      model: providerResult.model,
      providerStatus: 'AVAILABLE',
      fallbackUsed: false,
      durationMs: providerResult.runtimeMs,
      schemaValidation: providerResult.attempts.some((attempt) => attempt.schema === 'pass') ? 'PASS' : 'FAIL',
      canonicalRangeValidation: providerResult.attempts.some((attempt) => attempt.segmentReferences === 'pass') ? 'PASS' : 'FAIL',
      attempts: providerResult.attempts,
    },
  };
}
