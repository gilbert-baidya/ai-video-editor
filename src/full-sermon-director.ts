import type { TranscriptDocument } from './contracts.ts';
import {
  combineDirectorProvenance,
  DeterministicDirectorFallback,
  executeDirector,
  type DirectorExecutionProvenance,
  type DirectorExecutionResult,
} from './director-execution.ts';
import { validateDirectorInput, type DirectorProvider, type DirectorProviderResult } from './director.ts';
import {
  createChunkDirectorInput,
  createSermonChunks,
  defaultSermonChunkConfig,
  reconcileChunkAnalyses,
  canonicalTranscriptHash,
  type ChunkReconciliationResult,
  type SermonChunk,
  type SermonChunkConfig,
} from './sermon-chunking.ts';
import { runCachedStage, type StageRunResult } from './stage-cache.ts';
import { DIRECTOR_COVERAGE_CONTRACT_VERSION } from './canonical-coverage.ts';
import { sha256 } from './foundation.ts';

export interface FullSermonDirectorOptions {
  provider?: DirectorProvider;
  fallback?: DeterministicDirectorFallback;
  chunkConfig?: SermonChunkConfig;
  cacheRoot?: string;
  /** Bounded AI coverage-repair attempts per chunk. Defaults to 1. */
  maxCoverageRepairAttempts?: number;
}

export interface FullSermonChunkExecution {
  chunk: SermonChunk;
  execution: DirectorExecutionResult;
  cache: StageRunResult<DirectorExecutionResult>['cache'];
  durationMs: number;
}

export interface FullSermonDirectorResult {
  chunks: SermonChunk[];
  chunkExecutions: FullSermonChunkExecution[];
  reconciliation: ChunkReconciliationResult;
  provenance: DirectorExecutionProvenance;
  coverage: FullSermonCoverageSummary;
}

export interface FullSermonCoverageSummary {
  contractVersion: string;
  primaryCanonicalSegmentCount: number;
  aiCoveredPrimarySegmentCount: number;
  deterministicGapFilledSegmentCount: number;
  deterministicGapFilledSegmentIds: string[];
  coveragePercent: number;
  canonicalCoverageComplete: boolean;
  coverageRepairAttempts: number;
  coverageRepairSuccesses: number;
  providerChunkCount: number;
  providerSuccessCount: number;
}

async function uncached<T>(execute: () => Promise<T>): Promise<StageRunResult<T>> {
  const started = Date.now();
  return { value: await execute(), cache: { hit: false, key: 'disabled', path: '' }, durationMs: Date.now() - started };
}

export async function runFullSermonDirector(transcript: TranscriptDocument, options: FullSermonDirectorOptions = {}): Promise<FullSermonDirectorResult> {
  if (!transcript.segments.length) throw new Error('Full-sermon Director requires canonical transcript segments.');
  validateDirectorInput({ transcript, segments: transcript.segments, projectDuration: transcript.segments.at(-1)!.end, projectId: transcript.projectId });
  const ids = new Set<string>();
  for (let index = 0; index < transcript.segments.length; index += 1) {
    const segment = transcript.segments[index];
    if (ids.has(segment.id)) throw new Error(`Duplicate canonical segment ID: ${segment.id}`);
    ids.add(segment.id);
    if (segment.end <= segment.start) throw new Error(`${segment.id}: canonical segment has an invalid time range.`);
    if (index > 0 && segment.start < transcript.segments[index - 1].end) throw new Error(`${segment.id}: canonical segment timing overlaps the previous segment.`);
  }
  const transcriptHash = canonicalTranscriptHash(transcript);
  const chunkConfig = options.chunkConfig ?? defaultSermonChunkConfig;
  const chunkConfigHash = sha256(JSON.stringify(chunkConfig));
  const chunksStage = options.cacheRoot
    ? await runCachedStage(options.cacheRoot, 'sermon-chunk-generation', { transcriptHash, chunkConfigHash }, 'v1.1', async () => createSermonChunks(transcript.segments, chunkConfig))
    : await uncached(async () => createSermonChunks(transcript.segments, chunkConfig));
  const chunks = chunksStage.value;
  const chunkExecutions: FullSermonChunkExecution[] = [];
  const provider = options.provider;
  const fallback = options.fallback ?? new DeterministicDirectorFallback();
  let unavailableResult: DirectorProviderResult | undefined;

  for (const chunk of chunks) {
    const input = createChunkDirectorInput(transcript, chunk);
    const inputHash = sha256(JSON.stringify(input));
    const providerIdentity = provider?.cacheIdentity ?? 'not-configured';
    const execute = async () => {
      if (unavailableResult) return fallback.execute(input, unavailableResult.error ?? 'Configured Director AI provider is unavailable.', 0, unavailableResult);
      const result = await executeDirector(input, { provider, fallback, maxCoverageRepairAttempts: options.maxCoverageRepairAttempts });
      if (result.provenance.providerStatus === 'UNAVAILABLE' && provider) {
        unavailableResult = {
          providerResult: 'provider-unavailable',
          provider: result.provenance.provider,
          model: result.provenance.model ?? provider.model,
          runtimeMs: result.provenance.durationMs,
          attempts: result.provenance.attempts,
          rawResponses: [],
          error: result.provenance.fallbackReason,
        };
      }
      return result;
    };
    const stage = options.cacheRoot
      ? await runCachedStage(
        options.cacheRoot,
        'director-analysis',
        { inputHash, providerIdentity, fallbackIdentity: fallback.cacheIdentity, coverageContract: DIRECTOR_COVERAGE_CONTRACT_VERSION, maxCoverageRepairAttempts: String(options.maxCoverageRepairAttempts ?? 1) },
        'v1.2',
        execute,
        (value) => value.provenance.providerStatus !== 'UNAVAILABLE' && value.provenance.providerStatus !== 'FAILED',
      )
      : await uncached(execute);
    chunkExecutions.push({ chunk, execution: stage.value, cache: stage.cache, durationMs: stage.durationMs });
  }

  const reconciliationInputHash = sha256(JSON.stringify(chunkExecutions.map(({ chunk, execution }) => ({
    chunkId: chunk.id,
    analysis: execution.analysis,
    provenance: execution.provenance,
  }))));
  const reconcile = async () => reconcileChunkAnalyses(transcript, chunkExecutions);
  const reconciliationStage = options.cacheRoot
    ? await runCachedStage(options.cacheRoot, 'director-normalization', { transcriptHash, reconciliationInputHash, coverageContract: DIRECTOR_COVERAGE_CONTRACT_VERSION }, 'v1.2', reconcile)
    : await uncached(reconcile);
  const chunkProvenance = chunkExecutions.map(({ execution }) => execution.provenance);
  const reconciliation = reconciliationStage.value;
  const gapProvenance = reconciliation.records.some((record) => record.type === 'gap-fill')
    ? Object.values(reconciliation.sectionProvenance).find((item) => item.provider === 'deterministic-fallback')
    : undefined;
  const provenance = combineDirectorProvenance(gapProvenance ? [...chunkProvenance, gapProvenance] : chunkProvenance);
  const deterministicGapFilledSegmentIds = [...new Set([
    ...reconciliation.deterministicGapFilledSegmentIds,
    ...chunkProvenance.flatMap((item) => item.coverage?.deterministicGapFilledSegmentIds ?? []),
  ])].filter((id) => transcript.segments.some((segment) => segment.id === id));
  const coverage: FullSermonCoverageSummary = {
    contractVersion: DIRECTOR_COVERAGE_CONTRACT_VERSION,
    primaryCanonicalSegmentCount: reconciliation.coverage.primarySegmentCount,
    aiCoveredPrimarySegmentCount: reconciliation.coverage.coveredPrimarySegmentCount,
    deterministicGapFilledSegmentCount: deterministicGapFilledSegmentIds.length,
    deterministicGapFilledSegmentIds,
    coveragePercent: reconciliation.coverage.coveragePercent,
    canonicalCoverageComplete: reconciliation.coverage.complete && !deterministicGapFilledSegmentIds.length,
    coverageRepairAttempts: chunkProvenance.reduce((total, item) => total + (item.coverage?.repairAttempts ?? 0), 0),
    coverageRepairSuccesses: chunkProvenance.reduce((total, item) => total + (item.coverage?.repairSuccesses ?? 0), 0),
    providerChunkCount: chunkExecutions.length,
    providerSuccessCount: chunkExecutions.filter(({ execution }) => execution.provenance.source === 'ai').length,
  };
  return {
    chunks,
    chunkExecutions,
    reconciliation,
    coverage,
    provenance: {
      ...provenance,
      canonicalCoverageValidation: coverage.canonicalCoverageComplete ? provenance.canonicalCoverageValidation : 'FAIL',
      canonicalCoverageComplete: coverage.canonicalCoverageComplete,
      coverage: {
        report: reconciliation.coverage,
        repairAttempts: coverage.coverageRepairAttempts,
        repairSuccesses: coverage.coverageRepairSuccesses,
        deterministicGapFilledSegmentIds,
      },
    },
  };
}
