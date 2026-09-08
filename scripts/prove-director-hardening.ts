import { join } from 'node:path';
import { readJson, sha256, writeJson, ensureDirectory } from '../src/foundation.ts';
import type { SermonAnalysis, TranscriptDocument, TranscriptSegment } from '../src/contracts.ts';
import { OllamaDirectorProvider, createDirectorEditPlan, directorDependencyNames, generateVisualBeats, resolveAIResponse, validateAIResponse, validateDirector, type AISermonResponse, type DirectorInput, type DirectorProviderResult } from '../src/director.ts';
import { executeDirector } from '../src/director-execution.ts';

interface SourceSegment { startTime: number; endTime: number; text: string }
interface SourceTranscript { segments: SourceSegment[] }

const root = import.meta.dirname;
const fixtureStart = 4000;
const fixtureEnd = 4400;
const sourceTranscript = join(root, '..', '..', '..', 'sermonclip-studio', 'Projects', 'GOLDEN-E2E---Intervention-Sermon-2', 'Transcript', 'transcript.json');
const artifactRoot = join(root, '..', 'artifacts', 'director-structured-output');
const runCount = Number(process.env.DIRECTOR_RUNS ?? 3);
const model = process.env.SERMON_DIRECTOR_MODEL ?? 'qwen3:30b';
const providerAttempts = Number(process.env.DIRECTOR_ATTEMPTS ?? 1);

function canonicalFixture(source: SourceTranscript): { transcript: TranscriptDocument; segments: TranscriptSegment[] } {
  const segments = source.segments.filter((segment) => segment.startTime >= fixtureStart && segment.endTime <= fixtureEnd).map((segment) => ({
    id: `source-segment-${Math.round(segment.startTime)}`,
    start: segment.startTime - fixtureStart,
    end: segment.endTime - fixtureStart,
    text: segment.text.trim(),
    language: 'bn' as const,
    confidence: 0.72,
    words: [],
  }));
  const originalTranscript = segments.map((segment) => segment.text).join(' ');
  const transcript: TranscriptDocument = {
    schemaVersion: '1.0', projectId: 'director-structured-output-proof', originalTranscript, aiSuggestedDisplayText: originalTranscript, approvedDisplayText: originalTranscript,
    language: 'bn', textSource: 'existing-project', transcriptionProvider: 'SermonClip persisted transcript', transcriptionModel: 'existing-project-transcript', approved: false, timingConfidence: 'segment-safe', source: 'sermonclip-reference', model: 'existing-project-transcript', segments, immutableOriginal: true,
    alignment: { provider: 'source-segment-timing', status: 'partial', limitations: ['No Bengali word-level forced alignment.'] },
  };
  return { transcript, segments };
}

function fallbackResponse(): AISermonResponse {
  return {
    overallConfidence: 0.76,
    sections: [
      { sectionType: 'prayer', startSegment: 0, endSegment: 3, intensity: 'reverent-calm', visualRecommendation: 'none', confidence: 0.75, reason: 'The congregation is described praying for Peter.' },
      { sectionType: 'story', startSegment: 4, endSegment: 10, intensity: 'story-illustration', visualRecommendation: 'image-broll', suggestedDisplayText: 'পিতরের কারাগার থেকে মুক্তি', confidence: 0.78, reason: 'The source narrates Peter leaving prison and arriving at the praying congregation.' },
      { sectionType: 'main-point', startSegment: 11, endSegment: 11, intensity: 'emphasis', visualRecommendation: 'keyword-graphic', suggestedDisplayText: 'হস্তক্ষেপ', confidence: 0.9, reason: 'The source explicitly introduces intervention as the sermon point.' },
      { sectionType: 'illustration', startSegment: 12, endSegment: 16, intensity: 'story-illustration', visualRecommendation: 'image-broll', suggestedDisplayText: 'প্রেসার কুকার', confidence: 0.86, reason: 'The pressure-cooker illustration is developed across these segments.' },
      { sectionType: 'application', startSegment: 17, endSegment: 19, intensity: 'emphasis', visualRecommendation: 'speaker-left', suggestedDisplayText: 'চাপের মধ্যেও নিশ্চিন্ত থাকা', confidence: 0.74, reason: 'The closing segments apply pressure and peaceful sleep to the listener.' },
    ],
  };
}

function fallbackAnalysis(input: DirectorInput): SermonAnalysis {
  return resolveAIResponse(validateAIResponse(fallbackResponse(), input.segments.length), input);
}

function diagnostic(analysis: SermonAnalysis, beats: ReturnType<typeof generateVisualBeats>, providerResult: string): string {
  const rows = beats.map((beat) => {
    const section = analysis.sections.find((candidate) => candidate.start === beat.start && candidate.end === beat.end);
    return `| ${formatTime(beat.start)}-${formatTime(beat.end)} | ${section?.type ?? 'unknown'} | ${beat.intensity} | ${beat.visualType} | ${beat.suggestedDisplayText ?? ''} | ${beat.reason.replace(/\|/gu, '/')} | ${beat.confidence.toFixed(2)} |`;
  });
  return ['# AI Director Structured Output Diagnostic', '', `Provider result: ${providerResult}`, '', '| TIME | AI SECTION TYPE | VISUAL INTENSITY | VISUAL RECOMMENDATION | DISPLAY TEXT | REASON | CONFIDENCE |', '|---|---|---|---|---|---|---|', ...rows, '', `Events: ${beats.length}`, `Non-empty visual events: ${beats.filter((beat) => beat.visualType !== 'none' && beat.visualType !== 'speaker-full').length}`, 'B-roll remains placeholder-only.'].join('\n');
}

function formatTime(seconds: number): string { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }

async function main(): Promise<void> {
  const source = await readJson<SourceTranscript>(sourceTranscript);
  const fixture = canonicalFixture(source);
  const input: DirectorInput = { transcript: fixture.transcript, segments: fixture.segments, projectDuration: fixtureEnd - fixtureStart, projectId: fixture.transcript.projectId };
  const canonicalHashBefore = sha256(fixture.transcript.originalTranscript);
  const runs: Array<{ run: number; result: DirectorProviderResult; analysis: SermonAnalysis; fallbackUsed: boolean }> = [];
  for (let run = 1; run <= runCount; run += 1) {
    const execution = await executeDirector(input, { provider: new OllamaDirectorProvider({ model, attempts: providerAttempts, disableThinking: true }) });
    const result = execution.providerResult ?? {
      providerResult: 'deterministic-fallback' as const,
      provider: execution.provenance.provider,
      model: execution.provenance.model ?? 'canonical-segment-safe-v1.1',
      runtimeMs: execution.provenance.durationMs,
      attempts: execution.provenance.attempts,
      rawResponses: [],
      analysis: execution.analysis,
    };
    runs.push({ run, result, analysis: execution.analysis, fallbackUsed: execution.provenance.fallbackUsed });
  }
  const successful = runs.find((run) => !run.fallbackUsed);
  const selected = successful ?? runs[0];
  const analysis = selected.analysis;
  const beats = generateVisualBeats(analysis);
  const plan = createDirectorEditPlan(beats, input, selected.result.providerResult, selected.result.model);
  const qaFailures = validateDirector(analysis, beats, plan, input.projectDuration);
  const canonicalHashAfter = sha256(fixture.transcript.originalTranscript);
  if (canonicalHashBefore !== canonicalHashAfter) qaFailures.push('canonical transcript hash changed');
  const calmActivityWarnings = beats.filter((beat) => beat.intensity === 'reverent-calm' && beat.visualType !== 'none' && beat.visualType !== 'speaker-full').map((beat) => `${beat.id}: calm section uses ${beat.visualType}`);
  const noChangeBeatCount = beats.filter((beat) => beat.visualType === 'none' || beat.visualType === 'speaker-full').length;
  const qa = {
    status: qaFailures.length ? 'REVIEW' : 'PASS', failures: qaFailures, parseSuccessCount: runs.filter((run) => run.result.attempts.some((attempt) => attempt.parse === 'pass')).length,
    schemaSuccessCount: runs.filter((run) => run.result.attempts.some((attempt) => attempt.schema === 'pass')).length,
    segmentReferenceSuccessCount: runs.filter((run) => run.result.attempts.some((attempt) => attempt.segmentReferences === 'pass')).length,
    semanticSuccessCount: runs.filter((run) => !run.fallbackUsed).length,
    fallbackCount: runs.filter((run) => run.fallbackUsed).length,
    eventCount: beats.length,
    nonEmptyVisualEventCount: beats.filter((beat) => beat.visualType !== 'none' && beat.visualType !== 'speaker-full').length,
    eventsPerMinute: Number((beats.filter((beat) => beat.visualType !== 'none' && beat.visualType !== 'speaker-full').length / (input.projectDuration / 60)).toFixed(2)),
    noChangeBeatCount,
    calmActivityWarnings,
    dependencyPath: directorDependencyNames(),
    wordDestructiveEdits: false,
  };
  const cache = {
    canonicalTranscriptHash: canonicalHashBefore,
    policyHash: sha256(JSON.stringify({ version: 'director-policy-v1.1', noChangeAllowed: true, intensities: ['reverent-calm', 'normal-teaching', 'story-illustration', 'emphasis'] })),
    providerConfigHash: sha256(JSON.stringify({ provider: 'ollama', endpoint: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434', model, disableThinking: true })),
    promptSchemaHash: sha256('ai-sermon-section-v1.1-numbered-segments'),
    analysisHash: sha256(JSON.stringify(analysis)),
    beatmapHash: sha256(JSON.stringify(beats)),
    editPlanHash: sha256(JSON.stringify(plan)),
    styleInputsAffect: ['render'],
  };
  const dryRun = { status: qaFailures.length ? 'REVIEW' : 'READY', canonicalTranscriptHash: canonicalHashBefore, operationCount: plan.operations.length, operations: plan.operations, unsupportedOperations: plan.operations.filter((operation) => operation.type === 'director-placeholder').map((operation) => operation.id), note: 'No B-roll was retrieved and no renderer behavior was changed.' };
  await ensureDirectory(join(artifactRoot, 'analysis'));
  await ensureDirectory(join(artifactRoot, 'edit'));
  await ensureDirectory(join(artifactRoot, 'qa'));
  await writeJson(join(artifactRoot, 'input-transcript.json'), fixture.transcript);
  await writeJson(join(artifactRoot, 'analysis', 'ai-provider-response.json'), runs.map((run) => ({ run: run.run, providerResult: run.result.providerResult, provider: run.result.provider, model: run.result.model, runtimeMs: run.result.runtimeMs, attempts: run.result.attempts, rawResponses: run.result.rawResponses, error: run.result.error })));
  await writeJson(join(artifactRoot, 'analysis', 'sermon-analysis.json'), analysis);
  await writeJson(join(artifactRoot, 'edit', 'beatmap.json'), beats);
  await writeJson(join(artifactRoot, 'edit', 'edit-plan.json'), plan);
  await writeJson(join(artifactRoot, 'edit', 'dry-run-diff.json'), dryRun);
  await writeJson(join(artifactRoot, 'qa', 'director-structured-output.json'), qa);
  await writeJson(join(artifactRoot, 'cache.json'), cache);
  await writeJson(join(artifactRoot, 'benchmark.json'), { model, fixtureStart, fixtureEnd, inputSegmentCount: input.segments.length, inputCharacters: fixture.transcript.originalTranscript.length, runs: runs.map((run) => ({ run: run.run, providerResult: run.result.providerResult, runtimeMs: run.result.runtimeMs, attempts: run.result.attempts, fallbackUsed: run.fallbackUsed })) });
  await import('node:fs/promises').then(({ writeFile }) => writeFile(join(artifactRoot, 'semantic-review.md'), diagnostic(analysis, beats, selected.result.providerResult), 'utf8'));
  console.log(JSON.stringify({ model, runCount, selectedProviderResult: selected.result.providerResult, runtimesMs: runs.map((run) => run.result.runtimeMs), qa }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
