import { resolve } from 'node:path';
import type { SermonAnalysis, TranscriptDocument } from '../src/contracts.ts';
import { compareDirectorResults, measureDirectorResult } from '../src/director-comparison.ts';
import { OllamaDirectorProvider } from '../src/director.ts';
import { runFullSermonDirector } from '../src/full-sermon-director.ts';
import { canonicalTranscriptHash } from '../src/sermon-chunking.ts';
import { ensureDirectory, readJson, sha256, writeJson } from '../src/foundation.ts';

const root = resolve(import.meta.dirname, '..');
const v1Root = resolve(root, 'artifacts/full-sermon-pilot-v1');
const artifacts = resolve(root, 'artifacts/full-sermon-pilot-v1-1');
const model = process.env.SERMON_DIRECTOR_MODEL ?? 'qwen3:30b';
const endpoint = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const providerMode = process.env.SERMON_DIRECTOR_PROVIDER ?? 'auto';
const duration = 2560;

async function main(): Promise<void> {
  await ensureDirectory(resolve(artifacts, 'analysis'));
  const transcript = await readJson<TranscriptDocument>(resolve(v1Root, 'transcript.json'));
  const baselineFallback = await readJson<SermonAnalysis>(resolve(v1Root, 'analysis/sermon-analysis.json'));
  const transcriptHash = canonicalTranscriptHash(transcript);
  const legacyTranscriptHash = sha256(transcript.originalTranscript);
  const provider = providerMode === 'none' ? undefined : new OllamaDirectorProvider({
    endpoint,
    model,
    attempts: 2,
    timeoutMs: 900_000,
    disableThinking: true,
  });
  const configuration = {
    transcriptHash,
    providerMode,
    provider: provider?.name ?? 'none',
    model: provider?.model ?? 'none',
    chunking: 'sentence-aware-v1.1',
    reconciliation: 'canonical-policy-v1.1',
  };
  const configHash = sha256(JSON.stringify(configuration));
  const result = await runFullSermonDirector(transcript, {
    provider,
    cacheRoot: resolve(artifacts, 'cache'),
  });
  const allChunksLive = result.chunkExecutions.every(({ execution }) => execution.provenance.source === 'ai');
  const fallbackChunkCount = result.chunkExecutions.filter(({ execution }) => execution.provenance.fallbackUsed).length;
  const fallbackProvenance = {
    ...result.provenance,
    source: 'deterministic-fallback' as const,
    provider: 'deterministic-fallback',
    model: 'full-sermon-pilot-v1',
    providerStatus: 'NOT_CONFIGURED' as const,
    fallbackUsed: true,
    fallbackReason: 'V1 deterministic baseline.',
    durationMs: 0,
    schemaValidation: 'NOT_RUN' as const,
    canonicalRangeValidation: 'NOT_RUN' as const,
    attempts: [],
  };
  const comparison = compareDirectorResults(
    measureDirectorResult(baselineFallback, fallbackProvenance, duration, transcriptHash),
    measureDirectorResult(result.reconciliation.analysis, result.provenance, duration, transcriptHash),
  );
  const ledgers = result.chunkExecutions.map(({ chunk, execution, cache, durationMs }) => ({
    ...chunk,
    providerResult: execution.providerResult?.providerResult ?? 'deterministic-fallback',
    provider: execution.provenance.provider,
    model: execution.provenance.model,
    runtimeMs: execution.provenance.durationMs,
    orchestrationMs: durationMs,
    attempts: execution.provenance.attempts,
    structuredOutput: execution.provenance.schemaValidation === 'PASS' && execution.provenance.canonicalRangeValidation === 'PASS',
    fallback: execution.provenance.fallbackUsed,
    fallbackReason: execution.provenance.fallbackReason,
    sectionCount: execution.analysis.sections.length,
    cache,
  }));
  const payload = {
    configHash,
    configuration,
    architectureVersion: 'provider-neutral-v1.1',
    transcriptHash,
    providerMode,
    model: provider?.model,
    endpoint: provider ? endpoint : undefined,
    chunks: ledgers,
    totalRuntimeMs: result.provenance.durationMs,
    allChunksLive,
    fallbackChunkCount,
    provenance: result.provenance,
    analysis: result.reconciliation.analysis,
    merge: { records: result.reconciliation.records, sectionProvenance: result.reconciliation.sectionProvenance },
    sectionProvenance: result.reconciliation.sectionProvenance,
    comparison,
  };

  await writeJson(resolve(artifacts, 'analysis/live-ai-result.json'), payload);
  await writeJson(resolve(artifacts, 'analysis/sermon-analysis.json'), result.reconciliation.analysis);
  await writeJson(resolve(artifacts, 'analysis/chunks.json'), ledgers);
  await writeJson(resolve(artifacts, 'analysis/global-merge.json'), payload.merge);
  await writeJson(resolve(artifacts, 'analysis/ai-vs-fallback.json'), comparison);
  await writeJson(resolve(artifacts, 'analysis/fallback-provenance.json'), fallbackProvenance);
  await writeJson(resolve(artifacts, 'analysis/director-provenance.json'), result.provenance);
  await writeJson(resolve(artifacts, 'analysis/provider-probe.json'), {
    provider: result.provenance.provider,
    model: result.provenance.model,
    status: result.provenance.providerStatus,
    source: result.provenance.source,
    fallbackUsed: result.provenance.fallbackUsed,
    fallbackReason: result.provenance.fallbackReason,
    runtimeMs: result.provenance.durationMs,
    schemaValidation: result.provenance.schemaValidation,
    canonicalRangeValidation: result.provenance.canonicalRangeValidation,
  });
  await writeJson(resolve(artifacts, 'analysis/source-integrity.json'), {
    transcriptReusedFrom: resolve(v1Root, 'transcript.json'),
    transcriptHash,
    transcriptHashMatchesV1: legacyTranscriptHash === (await readJson<{ transcriptHash: string }>(resolve(v1Root, 'cache.json'))).transcriptHash,
    retranscribed: false,
    canonicalIdentityControlledByApplication: true,
  });
  console.log(JSON.stringify({
    providerStatus: result.provenance.providerStatus,
    fallbackUsed: result.provenance.fallbackUsed,
    fallbackReason: result.provenance.fallbackReason,
    allChunksLive,
    fallbackChunkCount,
    chunks: result.chunks.length,
    sections: result.reconciliation.analysis.sections.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
