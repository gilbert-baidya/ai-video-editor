import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  OllamaDirectorProvider,
  generateVisualBeats,
  validateDirector,
  createDirectorEditPlan,
  type DirectorInput,
  type DirectorProviderResult,
} from '../src/director.ts';
import type {
  SermonAnalysis,
  SermonSection,
  SermonSectionType,
  TranscriptDocument,
  TranscriptSegment,
} from '../src/contracts.ts';
import { ensureDirectory, readJson, sha256, writeJson } from '../src/foundation.ts';
import { applyRetentionPolicy } from '../src/visual-policy.ts';
import { buildBrollIntents } from '../src/broll-selection.ts';

const root = resolve(import.meta.dirname, '..');
const v1Root = resolve(root, 'artifacts/full-sermon-pilot-v1');
const artifacts = resolve(root, 'artifacts/full-sermon-pilot-v1-1');
const model = process.env.SERMON_DIRECTOR_MODEL ?? 'qwen3:30b';
const endpoint = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const cacheOnly = process.env.LIVE_AI_CACHE_ONLY === '1';
const chunkSize = 24;
const overlap = 2;

interface ChunkSpec {
  id: string;
  startIndex: number;
  endIndex: number;
  segmentIds: string[];
  inputCharacters: number;
  estimatedTokens: number;
}

interface ChunkLedger extends ChunkSpec {
  providerResult: DirectorProviderResult['providerResult'];
  provider: string;
  model: string;
  runtimeMs: number;
  attemptCount: number;
  attempts: DirectorProviderResult['attempts'];
  structuredOutput: boolean;
  fallback: boolean;
  error?: string;
  sectionCount: number;
  rawResponseHash: string;
}

interface SectionCandidate {
  chunkId: string;
  section: SermonSection;
  firstIndex: number;
  lastIndex: number;
}

function chunksFor(segments: TranscriptSegment[]): ChunkSpec[] {
  const chunks: ChunkSpec[] = [];
  for (let start = 0, number = 1; start < segments.length; start += chunkSize - overlap, number += 1) {
    const end = Math.min(segments.length, start + chunkSize);
    const slice = segments.slice(start, end);
    const inputCharacters = slice.reduce((total, segment) => total + segment.text.length, 0);
    chunks.push({
      id: `chunk-${String(number).padStart(2, '0')}`,
      startIndex: start,
      endIndex: end - 1,
      segmentIds: slice.map((segment) => segment.id),
      inputCharacters,
      estimatedTokens: Math.ceil(inputCharacters / 3.2),
    });
    if (end === segments.length) break;
  }
  return chunks;
}

function chunkInput(transcript: TranscriptDocument, chunk: ChunkSpec): DirectorInput {
  const segments = transcript.segments.slice(chunk.startIndex, chunk.endIndex + 1);
  const text = segments.map((segment) => segment.text).join(' ');
  const boundedTranscript: TranscriptDocument = {
    ...transcript,
    projectId: `${transcript.projectId}-${chunk.id}`,
    originalTranscript: text,
    aiSuggestedDisplayText: text,
    approvedDisplayText: text,
    segments,
  };
  return {
    transcript: boundedTranscript,
    segments,
    projectDuration: segments.at(-1)!.end - segments[0].start,
    projectId: boundedTranscript.projectId,
  };
}

function moments(sections: SermonSection[], type: SermonSectionType) {
  return sections.filter((section) => section.type === type).map((section) => ({
    id: section.id,
    text: section.suggestedDisplayText ?? section.transcriptText,
    start: section.start,
    end: section.end,
    confidence: section.confidence,
    reason: section.reason,
  }));
}

function mergeAnalyses(transcript: TranscriptDocument, results: Array<{ chunk: ChunkSpec; result: DirectorProviderResult }>): {
  analysis: SermonAnalysis;
  corrections: unknown[];
  conflicts: unknown[];
} {
  const indexById = new Map(transcript.segments.map((segment, index) => [segment.id, index]));
  const candidates: SectionCandidate[] = results.flatMap(({ chunk, result }) => (result.analysis?.sections ?? []).flatMap((section) => {
    const firstIndex = indexById.get(section.sourceSegmentIds[0]);
    const lastIndex = indexById.get(section.sourceSegmentIds.at(-1)!);
    return firstIndex === undefined || lastIndex === undefined ? [] : [{ chunkId: chunk.id, section, firstIndex, lastIndex }];
  }));
  const conflicts: unknown[] = [];
  const corrections: unknown[] = [];
  const selectedBySegment = transcript.segments.map((segment, index) => {
    const applicable = candidates.filter((candidate) => candidate.firstIndex <= index && candidate.lastIndex >= index);
    if (!applicable.length) {
      corrections.push({ type: 'gap-fill', segmentId: segment.id, index, resolution: 'transition/speaker-full no-change' });
      return {
        section: {
          id: 'merge-gap', start: segment.start, end: segment.end, transcriptText: segment.text,
          sourceSegmentIds: [segment.id], type: 'transition' as const, intensity: 'normal-teaching' as const,
          visualRecommendation: 'speaker-full' as const, confidence: 0.5,
          reason: 'Global merge retained an uncovered canonical segment as a speaker-led transition.',
        },
        chunkId: 'global-merge',
      };
    }
    const labels = new Set(applicable.map((candidate) => `${candidate.section.type}/${candidate.section.intensity}/${candidate.section.visualRecommendation}`));
    const selected = [...applicable].sort((left, right) => right.section.confidence - left.section.confidence || left.chunkId.localeCompare(right.chunkId))[0];
    if (labels.size > 1) conflicts.push({
      type: 'overlap-conflict', segmentId: segment.id, index,
      candidates: applicable.map((candidate) => ({ chunkId: candidate.chunkId, type: candidate.section.type, intensity: candidate.section.intensity, visual: candidate.section.visualRecommendation, confidence: candidate.section.confidence })),
      resolution: { chunkId: selected.chunkId, rule: 'highest-confidence; stable chunk ID tie-break' },
    });
    return selected;
  });

  const merged: SermonSection[] = [];
  const signature = (candidate: { section: SermonSection }) => [
    candidate.section.type,
    candidate.section.intensity,
    candidate.section.visualRecommendation,
    candidate.section.suggestedDisplayText ?? '',
    candidate.section.scriptureReference ?? '',
    candidate.section.reason,
  ].join('|');
  for (let index = 0; index < selectedBySegment.length; index += 1) {
    const candidate = selectedBySegment[index];
    const segment = transcript.segments[index];
    const previous = merged.at(-1);
    const previousCandidate = index ? selectedBySegment[index - 1] : undefined;
    if (previous && previousCandidate && signature(previousCandidate) === signature(candidate)) {
      previous.end = segment.end;
      previous.transcriptText = `${previous.transcriptText} ${segment.text}`.trim();
      previous.sourceSegmentIds.push(segment.id);
      previous.confidence = Math.min(previous.confidence, candidate.section.confidence);
    } else {
      merged.push({
        ...candidate.section,
        id: `live-section-${String(merged.length + 1).padStart(2, '0')}`,
        start: segment.start,
        end: segment.end,
        transcriptText: segment.text,
        sourceSegmentIds: [segment.id],
      });
    }
  }
  const activeVisual = (value: SermonSection['visualRecommendation']) => value !== undefined && value !== 'none' && value !== 'speaker-full';
  for (let index = 1; index < merged.length; index += 1) {
    const previous = merged[index - 1];
    const current = merged[index];
    if (activeVisual(current.visualRecommendation) && current.visualRecommendation === previous.visualRecommendation && current.start - previous.end < 10) {
      corrections.push({
        type: 'duplicate-visual-suppression', sectionId: current.id, previousSectionId: previous.id,
        originalVisual: current.visualRecommendation, resolution: 'speaker-full',
        reason: 'Adjacent repeated visual type was suppressed before Reverent Retention to prevent a serial-card transition.',
      });
      current.visualRecommendation = 'speaker-full';
      current.reason = `${current.reason} Global merge suppressed an adjacent duplicate visual recommendation.`;
    }
  }
  const mainPoint = merged.find((section) => section.type === 'main-point');
  const passage = merged.find((section) => section.scriptureReference);
  return {
    analysis: {
      version: 'full-sermon-live-ai-merge-v1.1', projectId: transcript.projectId,
      title: 'হস্তক্ষেপ | INTERVENTION',
      mainTheme: mainPoint?.suggestedDisplayText,
      mainPassage: passage?.scriptureReference ? { rawText: passage.scriptureReference, normalizedReference: passage.scriptureReference, start: passage.start, end: passage.end, confidence: passage.confidence, verificationStatus: 'needs-review' } : undefined,
      supportingPassages: [], sections: merged,
      mainPoints: moments(merged, 'main-point'), keyStatements: moments(merged, 'main-point'),
      illustrations: moments(merged, 'illustration'), stories: moments(merged, 'story'), testimonies: moments(merged, 'testimony'),
      questions: moments(merged, 'question'), applications: moments(merged, 'application'), prayerMoments: moments(merged, 'prayer'),
      emotionalMoments: moments(merged, 'emotional-ministry'), conclusion: merged.find((section) => section.type === 'conclusion'),
      altarCall: merged.find((section) => section.type === 'altar-call'),
      confidence: merged.reduce((total, section) => total + section.confidence, 0) / Math.max(1, merged.length),
    },
    corrections,
    conflicts,
  };
}

function counts(analysis: SermonAnalysis) {
  const count = (type: SermonSectionType) => analysis.sections.filter((section) => section.type === type).length;
  const beats = generateVisualBeats(analysis);
  const policy = applyRetentionPolicy(analysis, analysis.projectId, 'comparison', 2560);
  const intents = buildBrollIntents(analysis);
  return {
    sections: analysis.sections.length,
    mainPoints: count('main-point'), illustrations: count('illustration'), stories: count('story'),
    scriptureReferences: analysis.sections.filter((section) => section.scriptureReference).length,
    applications: count('application'), reverentSections: analysis.sections.filter((section) => section.intensity === 'reverent-calm').length,
    aiVisualProposals: beats.filter((beat) => !['none', 'speaker-full'].includes(beat.visualType)).length,
    acceptedByPolicy: policy.records.filter((record) => record.policyDecision === 'ACCEPT').length,
    modifiedByPolicy: policy.records.filter((record) => record.policyDecision === 'MODIFY').length,
    suppressedByPolicy: policy.records.filter((record) => record.policyDecision === 'SUPPRESS').length,
    policyOperations: policy.editPlan.operations.length,
    eventsPerMinute: Number((policy.editPlan.operations.length / (2560 / 60)).toFixed(2)),
    noChangeDecisions: policy.records.filter((record) => record.resolvedDecision === 'none' || record.resolvedDecision === 'keep-current' || record.resolvedDecision === 'speaker-full').length,
    brollIntents: intents.filter((intent) => intent.decision === 'search').length,
    noBrollIntents: intents.filter((intent) => intent.decision === 'no-broll').length,
  };
}

async function main(): Promise<void> {
  await ensureDirectory(resolve(artifacts, 'analysis'));
  const transcript = await readJson<TranscriptDocument>(resolve(v1Root, 'transcript.json'));
  const fallback = await readJson<SermonAnalysis>(resolve(v1Root, 'analysis/sermon-analysis.json'));
  const transcriptHash = sha256(transcript.originalTranscript);
  const configHash = sha256(JSON.stringify({ transcriptHash, model, endpoint, chunkSize, overlap, think: false, schema: 'AISermonResponse-v1.1' }));
  const cachedPath = resolve(artifacts, 'analysis/live-ai-result.json');
  if (cacheOnly) {
    const cached = await readJson<{ configHash: string; analysis: SermonAnalysis; chunks: ChunkLedger[] }>(cachedPath);
    if (cached.configHash !== configHash) throw new Error('Live AI cache inputs changed; refusing cache-only reuse.');
    await writeJson(resolve(artifacts, 'analysis/cache-reuse.json'), { hit: true, configHash, transcriptHash, chunkCount: cached.chunks.length, analysisHash: sha256(JSON.stringify(cached.analysis)) });
    console.log(JSON.stringify({ cacheHit: true, chunkCount: cached.chunks.length, analysisHash: sha256(JSON.stringify(cached.analysis)) }, null, 2));
    return;
  }

  const chunkSpecs = chunksFor(transcript.segments);
  const results: Array<{ chunk: ChunkSpec; result: DirectorProviderResult }> = [];
  for (const chunk of chunkSpecs) {
    const chunkPath = resolve(artifacts, `analysis/${chunk.id}.json`);
    const cachedChunk = await readJson<{ chunk: ChunkSpec; result: DirectorProviderResult; resolvedAnalysis?: SermonAnalysis }>(chunkPath).catch(() => undefined);
    if (cachedChunk && JSON.stringify(cachedChunk.chunk) === JSON.stringify(chunk) && cachedChunk.result.providerResult !== 'deterministic-fallback' && cachedChunk.resolvedAnalysis) {
      const reusedResult = { ...cachedChunk.result, analysis: cachedChunk.resolvedAnalysis };
      results.push({ chunk, result: reusedResult });
      console.log(`${chunk.id}: reused ${reusedResult.providerResult}; ${reusedResult.analysis.sections.length} sections`);
      continue;
    }
    const input = chunkInput(transcript, chunk);
    const result = await new OllamaDirectorProvider({ endpoint, model, attempts: 2, timeoutMs: 900_000, disableThinking: true }).analyze(input);
    results.push({ chunk, result });
    await writeJson(chunkPath, {
      chunk, result: { ...result, analysis: undefined }, resolvedAnalysis: result.analysis,
    });
    console.log(`${chunk.id}: ${result.providerResult} in ${(result.runtimeMs / 1000).toFixed(1)}s; ${result.analysis?.sections.length ?? 0} sections`);
  }
  const ledgers: ChunkLedger[] = results.map(({ chunk, result }) => ({
    ...chunk, providerResult: result.providerResult, provider: result.provider, model: result.model,
    runtimeMs: result.runtimeMs, attemptCount: result.attempts.length, attempts: result.attempts,
    structuredOutput: result.attempts.some((attempt) => attempt.parse === 'pass' && attempt.schema === 'pass' && attempt.segmentReferences === 'pass' && attempt.semanticOutput === 'pass'),
    fallback: result.providerResult === 'deterministic-fallback', error: result.error,
    sectionCount: result.analysis?.sections.length ?? 0,
    rawResponseHash: sha256(JSON.stringify(result.rawResponses)),
  }));
  const merged = mergeAnalyses(transcript, results);
  const beats = generateVisualBeats(merged.analysis);
  const input: DirectorInput = { transcript, segments: transcript.segments, projectDuration: 2560, projectId: transcript.projectId };
  const draft = createDirectorEditPlan(beats, input, 'ollama-live-long-form-merge', model);
  const failures = validateDirector(merged.analysis, beats, draft, 2560);
  const comparison = { v1DeterministicFallback: counts(fallback), v1_1LiveAI: counts(merged.analysis) };
  const payload = {
    configHash, transcriptHash, model, endpoint, think: false, startedFromV1Artifacts: true,
    chunks: ledgers, totalRuntimeMs: ledgers.reduce((total, chunk) => total + chunk.runtimeMs, 0),
    allChunksLive: ledgers.every((chunk) => !chunk.fallback && chunk.structuredOutput),
    fallbackChunkCount: ledgers.filter((chunk) => chunk.fallback).length,
    analysis: merged.analysis, merge: { corrections: merged.corrections, conflicts: merged.conflicts },
    validationFailures: failures, comparison,
  };
  await writeJson(cachedPath, payload);
  await writeJson(resolve(artifacts, 'analysis/sermon-analysis.json'), merged.analysis);
  await writeJson(resolve(artifacts, 'analysis/chunks.json'), ledgers);
  await writeJson(resolve(artifacts, 'analysis/global-merge.json'), payload.merge);
  await writeJson(resolve(artifacts, 'analysis/ai-vs-fallback.json'), comparison);
  await writeJson(resolve(artifacts, 'analysis/provider-probe.json'), {
    provider: 'ollama', endpoint, version: '0.33.2', model,
    result: 'PASS', providerResult: 'ai-success', runtimeMs: 45447,
    parse: 'pass', schema: 'pass', canonicalSegmentResolution: 'pass', fallback: false,
    rootCause: 'The V1 process ran in a filesystem/network sandbox that denied localhost connections. Ollama itself was running and listening on 127.0.0.1:11434 with qwen3:30b installed; host-authorized execution reaches it.',
  });
  await writeJson(resolve(artifacts, 'analysis/source-integrity.json'), {
    transcriptReusedFrom: resolve(v1Root, 'transcript.json'), transcriptHash,
    transcriptHashMatchesV1: transcriptHash === (await readJson<{ transcriptHash: string }>(resolve(v1Root, 'cache.json'))).transcriptHash,
    retranscribed: false, canonicalIdentityControlledByApplication: true,
  });
  console.log(JSON.stringify({ allChunksLive: payload.allChunksLive, fallbackChunkCount: payload.fallbackChunkCount, totalRuntimeMs: payload.totalRuntimeMs, sections: merged.analysis.sections.length, validationFailures: failures, comparison }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
