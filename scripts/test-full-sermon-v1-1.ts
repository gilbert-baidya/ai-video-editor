import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaIndex, SermonAnalysis, TranscriptDocument, TranscriptSegment } from '../src/contracts.ts';
import { decideBroll } from '../src/broll-selection.ts';
import { compareDirectorResults, measureDirectorResult } from '../src/director-comparison.ts';
import { executeDirector } from '../src/director-execution.ts';
import { runFullSermonDirector } from '../src/full-sermon-director.ts';
import { createInitialReviewState, applyReviewAction, deriveApprovedEditPlan, isReviewStateCompatible, type ReviewWorkspaceData } from '../src/director-review.ts';
import { resolveAIResponse, type DirectorInput, type DirectorProvider } from '../src/director.ts';
import { canonicalTranscriptHash, createSermonChunks, reconcileChunkAnalyses } from '../src/sermon-chunking.ts';
import { runCachedStage } from '../src/stage-cache.ts';
import { applyRetentionPolicy } from '../src/visual-policy.ts';
import { sha256 } from '../src/foundation.ts';

function segment(id: string, start: number, text: string): TranscriptSegment {
  return { id, start, end: start + 10, text, language: 'bn', words: [] };
}

function transcriptFixture(): TranscriptDocument {
  const texts = [
    'প্রথম বাক্যের শুরু', 'প্রথম বাক্যের শেষ।', 'দ্বিতীয় ভাবনা শুরু', 'দ্বিতীয় ভাবনা চলতে থাকে',
    'দ্বিতীয় ভাবনা শেষ।', 'পবিত্র শাস্ত্র পাঠ।', 'প্রার্থনার সময়।', 'একটি গল্প শুরু',
    'গল্পের সমাপ্তি।', 'মূল শিক্ষা শুরু', 'মূল শিক্ষা শেষ।', 'উপসংহার।',
  ];
  const segments = texts.map((text, index) => segment(`canonical-${String(index + 1).padStart(3, '0')}`, index * 10, text));
  const originalTranscript = segments.map((item) => item.text).join(' ');
  return {
    schemaVersion: '1.0',
    projectId: 'office-fixture',
    originalTranscript,
    aiSuggestedDisplayText: originalTranscript,
    approvedDisplayText: originalTranscript,
    language: 'bn',
    textSource: 'hybrid-reviewed',
    approved: true,
    timingConfidence: 'segment-safe',
    source: 'sermonclip-reference',
    model: 'fixture',
    segments,
    immutableOriginal: true,
    alignment: { provider: 'fixture', status: 'verified', limitations: [] },
  };
}

function inputFor(transcript: TranscriptDocument): DirectorInput {
  return { transcript, segments: transcript.segments, projectDuration: transcript.segments.at(-1)!.end, projectId: transcript.projectId };
}

class UnavailableProvider implements DirectorProvider {
  readonly name = 'unavailable-fixture';
  readonly model = 'none';
  readonly cacheIdentity = 'unavailable-fixture-v1';
  async checkAvailability() {
    return { available: false, reason: 'Fixture provider is intentionally unavailable.', checkedAt: new Date().toISOString() };
  }
  async analyze(): Promise<never> {
    throw new Error('Unavailable provider must never be called.');
  }
}

class MockAiProvider implements DirectorProvider {
  readonly name: string = 'mock-ai';
  readonly model: string = 'fixture-v1';
  calls = 0;
  constructor(readonly cacheIdentity: string = 'mock-ai-fixture-v1') {}
  async checkAvailability() {
    return { available: true, checkedAt: new Date().toISOString() };
  }
  async analyze(input: DirectorInput) {
    this.calls += 1;
    const started = Date.now();
    const analysis = resolveAIResponse({
      sections: [{
        sectionType: input.segments.some((item) => item.text.includes('প্রার্থনা')) ? 'prayer' : 'story',
        startSegment: 0,
        endSegment: input.segments.length - 1,
        intensity: input.segments.some((item) => item.text.includes('প্রার্থনা')) ? 'reverent-calm' : 'story-illustration',
        visualRecommendation: 'image-broll',
        confidence: 0.8,
        reason: 'Mock structured recommendation for office-safe orchestration testing.',
      }],
      overallConfidence: 0.8,
    }, input);
    return {
      providerResult: 'ai-success' as const,
      provider: this.name,
      model: this.model,
      runtimeMs: Date.now() - started,
      attempts: [{ attempt: 1, parse: 'pass' as const, schema: 'pass' as const, segmentReferences: 'pass' as const, semanticOutput: 'pass' as const, runtimeMs: 0 }],
      rawResponses: [],
      analysis,
    };
  }
}

class SparseAiProvider extends MockAiProvider {
  readonly name = 'sparse-mock-ai';
  readonly cacheIdentity = 'sparse-mock-ai-fixture-v1';
  async analyze(input: DirectorInput) {
    this.calls += 1;
    const analysis = resolveAIResponse({
      sections: [{
        sectionType: 'teaching',
        startSegment: 0,
        endSegment: 0,
        intensity: 'normal-teaching',
        visualRecommendation: 'speaker-full',
        confidence: 0.8,
        reason: 'Sparse fixture intentionally leaves canonical gaps.',
      }],
      overallConfidence: 0.8,
    }, input);
    return {
      providerResult: 'ai-success' as const,
      provider: this.name,
      model: this.model,
      runtimeMs: 1,
      attempts: [{ attempt: 1, parse: 'pass' as const, schema: 'pass' as const, segmentReferences: 'pass' as const, semanticOutput: 'pass' as const, runtimeMs: 1 }],
      rawResponses: [],
      analysis,
    };
  }
}

class ThrowingProvider implements DirectorProvider {
  readonly name = 'throwing-fixture';
  readonly model = 'fixture-v1';
  readonly cacheIdentity = 'throwing-fixture-v1';
  async checkAvailability() {
    return { available: true, checkedAt: new Date().toISOString() };
  }
  async analyze(): Promise<never> {
    throw new Error('Fixture provider execution failed.');
  }
}

class InvalidAiProvider extends MockAiProvider {
  readonly name = 'invalid-mock-ai';
  readonly cacheIdentity = 'invalid-mock-ai-fixture-v1';
  async analyze(input: DirectorInput) {
    const result = await super.analyze(input);
    return {
      ...result,
      analysis: {
        ...result.analysis,
        sections: result.analysis.sections.map((section, index) => index === 0 ? { ...section, start: section.start + 1 } : section),
      },
    };
  }
}

function analysisWithSections(transcript: TranscriptDocument, sections: SermonAnalysis['sections']): SermonAnalysis {
  return {
    version: 'fixture',
    projectId: transcript.projectId,
    supportingPassages: [],
    sections,
    mainPoints: [],
    keyStatements: [],
    illustrations: [],
    stories: [],
    testimonies: [],
    questions: [],
    applications: [],
    prayerMoments: [],
    emotionalMoments: [],
    confidence: 0.75,
  };
}

async function main(): Promise<void> {
  const transcript = transcriptFixture();
  const chunks = createSermonChunks(transcript.segments, { targetSegments: 4, maxSegments: 5, overlapSegments: 1, sentenceLookback: 2 });
  const retimedTranscript = { ...transcript, segments: transcript.segments.map((item, index) => index === 0 ? { ...item, end: item.end + 0.5 } : item) };
  assert.notEqual(canonicalTranscriptHash(transcript), canonicalTranscriptHash(retimedTranscript));
  assert.deepEqual(chunks, createSermonChunks(transcript.segments, { targetSegments: 4, maxSegments: 5, overlapSegments: 1, sentenceLookback: 2 }));
  assert.deepEqual(chunks.flatMap((chunk) => chunk.segmentIds), transcript.segments.map((item) => item.id));
  assert.ok(chunks.slice(0, -1).every((chunk) => /[.!?।॥]["'’”)]?\s*$/u.test(transcript.segments[chunk.endIndex].text)));
  assert.ok(chunks.slice(1).every((chunk) => chunk.contextStartIndex < chunk.startIndex));

  const notConfigured = await executeDirector(inputFor(transcript));
  assert.equal(notConfigured.provenance.providerStatus, 'NOT_CONFIGURED');
  assert.equal(notConfigured.provenance.fallbackUsed, true);
  assert.match(notConfigured.provenance.fallbackReason ?? '', /No configured Director AI provider/);

  const unavailable = await executeDirector(inputFor(transcript), { provider: new UnavailableProvider() });
  assert.equal(unavailable.provenance.providerStatus, 'UNAVAILABLE');
  assert.equal(unavailable.provenance.source, 'deterministic-fallback');
  const providerException = await executeDirector(inputFor(transcript), { provider: new ThrowingProvider() });
  assert.equal(providerException.provenance.providerStatus, 'FAILED');
  assert.match(providerException.provenance.fallbackReason ?? '', /execution failed/);
  const invalidProvider = await executeDirector(inputFor(transcript), { provider: new InvalidAiProvider() });
  assert.equal(invalidProvider.provenance.providerStatus, 'FAILED');
  assert.match(invalidProvider.provenance.fallbackReason ?? '', /timing does not match/);

  const cacheRoot = await mkdtemp(join(tmpdir(), 'sermon-director-v1-1-'));
  try {
    const firstProvider = new MockAiProvider();
    const first = await runFullSermonDirector(transcript, {
      provider: firstProvider,
      cacheRoot,
      chunkConfig: { targetSegments: 4, maxSegments: 5, overlapSegments: 1, sentenceLookback: 2 },
    });
    const second = await runFullSermonDirector(transcript, {
      provider: new MockAiProvider(),
      cacheRoot,
      chunkConfig: { targetSegments: 4, maxSegments: 5, overlapSegments: 1, sentenceLookback: 2 },
    });
    assert.equal(first.provenance.source, 'ai');
    assert.ok(firstProvider.calls > 0);
    assert.ok(first.chunkExecutions.every((item) => !item.cache.hit));
    assert.ok(second.chunkExecutions.every((item) => item.cache.hit));
    assert.equal(JSON.stringify(first.reconciliation.analysis), JSON.stringify(second.reconciliation.analysis));
    assert.deepEqual(first.reconciliation.analysis.sections.flatMap((section) => section.sourceSegmentIds), transcript.segments.map((item) => item.id));
    const unavailableFull = await runFullSermonDirector(transcript, {
      provider: new UnavailableProvider(),
      cacheRoot,
      chunkConfig: { targetSegments: 4, maxSegments: 5, overlapSegments: 1, sentenceLookback: 2 },
    });
    assert.ok(unavailableFull.chunkExecutions.every((item) => item.execution.provenance.provider === 'unavailable-fixture'));
    assert.ok(unavailableFull.chunkExecutions.every((item) => item.execution.provenance.providerStatus === 'UNAVAILABLE'));
    assert.ok(unavailableFull.chunkExecutions.every((item) => !item.cache.hit));
    const sparse = await runFullSermonDirector(transcript, {
      provider: new SparseAiProvider(),
      chunkConfig: { targetSegments: 4, maxSegments: 5, overlapSegments: 1, sentenceLookback: 2 },
    });
    assert.equal(sparse.provenance.source, 'mixed');
    assert.equal(sparse.provenance.fallbackUsed, true);
    assert.ok(sparse.reconciliation.records.some((record) => record.type === 'gap-fill'));
    const differentIdentityProvider = new MockAiProvider('mock-ai-fixture-v2');
    await runFullSermonDirector(transcript, {
      provider: differentIdentityProvider,
      cacheRoot,
      chunkConfig: { targetSegments: 4, maxSegments: 5, overlapSegments: 1, sentenceLookback: 2 },
    });
    assert.ok(differentIdentityProvider.calls > 0);

    let runs = 0;
    const cachedA = await runCachedStage(cacheRoot, 'media-inspection', { source: 'fixture-a' }, 'v1', async () => ({ runs: ++runs }));
    const cachedB = await runCachedStage(cacheRoot, 'media-inspection', { source: 'fixture-a' }, 'v1', async () => ({ runs: ++runs }));
    const invalidated = await runCachedStage(cacheRoot, 'media-inspection', { source: 'fixture-b' }, 'v1', async () => ({ runs: ++runs }));
    assert.equal(cachedA.cache.hit, false);
    assert.equal(cachedB.cache.hit, true);
    assert.equal(invalidated.cache.hit, false);
    assert.equal(runs, 2);
  } finally {
    await rm(cacheRoot, { recursive: true });
  }

  const firstChunk = chunks[0];
  const secondChunk = chunks[1];
  const sectionA = {
    id: 'candidate-a',
    start: transcript.segments[0].start,
    end: transcript.segments[4].end,
    transcriptText: transcript.segments.slice(0, 5).map((item) => item.text).join(' '),
    sourceSegmentIds: transcript.segments.slice(0, 5).map((item) => item.id),
    type: 'story' as const,
    intensity: 'story-illustration' as const,
    visualRecommendation: 'image-broll' as const,
    confidence: 0.9,
    reason: 'Story candidate.',
  };
  const sectionB = {
    id: 'candidate-b',
    start: transcript.segments[4].start,
    end: transcript.segments[7].end,
    transcriptText: transcript.segments.slice(4, 8).map((item) => item.text).join(' '),
    sourceSegmentIds: transcript.segments.slice(4, 8).map((item) => item.id),
    type: 'prayer' as const,
    intensity: 'reverent-calm' as const,
    visualRecommendation: 'video-broll' as const,
    confidence: 0.7,
    reason: 'Reverent overlap candidate.',
  };
  const provenance = unavailable.provenance;
  const reconciled = reconcileChunkAnalyses(transcript, [
    { chunk: firstChunk, execution: { analysis: analysisWithSections(transcript, [sectionA]), provenance } },
    { chunk: secondChunk, execution: { analysis: analysisWithSections(transcript, [sectionB]), provenance } },
  ]);
  assert.deepEqual(reconciled.analysis.sections.flatMap((section) => section.sourceSegmentIds), transcript.segments.map((item) => item.id));
  assert.ok(reconciled.records.some((record) => record.type === 'overlap-conflict'));
  assert.ok(reconciled.records.some((record) => record.type === 'reverent-suppression'));
  assert.ok(reconciled.analysis.sections.filter((section) => section.type === 'prayer').every((section) => section.visualRecommendation === 'speaker-full'));
  assert.deepEqual(reconciled, reconcileChunkAnalyses(transcript, [
    { chunk: firstChunk, execution: { analysis: analysisWithSections(transcript, [sectionA]), provenance } },
    { chunk: secondChunk, execution: { analysis: analysisWithSections(transcript, [sectionB]), provenance } },
  ]));

  const policy = applyRetentionPolicy(reconciled.analysis, transcript.projectId, sha256(transcript.originalTranscript), transcript.segments.at(-1)!.end);
  assert.ok(policy.records.filter((record) => record.section === 'prayer').every((record) => record.resolvedDecision === 'speaker-full' || record.resolvedDecision === 'keep-current'));
  const index: MediaIndex = { schemaVersion: '1', indexerVersion: 'fixture', createdAt: '', updatedAt: '', roots: [], assets: [{
    id: 'unknown-rights',
    path: '/fixture/image.png',
    relativePath: 'image.png',
    fileName: 'image.png',
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: 1,
    modifiedAt: '',
    width: 1920,
    height: 1080,
    aspectRatio: 16 / 9,
    hasAudio: false,
    tags: ['story'],
    categories: ['illustration'],
    searchTerms: ['story'],
    rightsStatus: 'unknown',
    rightsSource: 'library-root-default',
    libraryRootId: 'fixture',
    libraryPolicyVersion: '1',
    usable: true,
    unusableReasons: [],
  }] };
  const rightsDecision = decideBroll(index, {
    sectionId: 'story',
    start: 0,
    end: 10,
    decision: 'search',
    reason: 'Fixture',
    search: { concept: 'story', sectionId: 'story', sectionType: 'story', desiredMedia: 'image', semanticTags: ['story'], avoidTerms: [], allowUnknownRights: false },
  });
  assert.equal(rightsDecision.decision, 'no-suitable-asset');

  const workspace = {
    projectId: transcript.projectId,
    aiPlan: policy.editPlan,
    beats: reconciled.analysis.sections.map((section) => ({ section, candidates: [], requiredReview: false, noBroll: true })),
    directorExecution: unavailable.provenance,
  } satisfies Pick<ReviewWorkspaceData, 'projectId' | 'aiPlan' | 'beats' | 'directorExecution'>;
  const review = createInitialReviewState(workspace, 'fixture-hash');
  assert.ok(review.decisions.every((decision) => decision.provenance === 'deterministic-fallback'));
  const overridden = applyReviewAction(review, review.decisions[0].beatId, 'accept');
  assert.equal(overridden.decisions[0].provenance, 'human-override');
  const compatibleReview = createInitialReviewState(workspace, sha256(JSON.stringify(policy.editPlan)));
  assert.equal(isReviewStateCompatible(workspace, compatibleReview), true);
  assert.doesNotThrow(() => deriveApprovedEditPlan(policy.editPlan, compatibleReview));
  assert.throws(() => deriveApprovedEditPlan({ ...policy.editPlan, schemaVersion: 'changed' }, compatibleReview), /different Edit Plan/);

  const fallbackMetrics = measureDirectorResult(notConfigured.analysis, notConfigured.provenance, 120, sha256(transcript.originalTranscript));
  const aiResult = await executeDirector(inputFor(transcript), { provider: new MockAiProvider() });
  const aiMetrics = measureDirectorResult(aiResult.analysis, aiResult.provenance, 120, sha256(transcript.originalTranscript));
  const comparison = compareDirectorResults(fallbackMetrics, aiMetrics);
  assert.equal(comparison.fallback.fallbackUsed, true);
  assert.equal(comparison.ai.fallbackUsed, false);
  assert.equal(comparison.ai.schemaValid, true);
  assert.equal(comparison.ai.canonicalRangeValid, true);

  console.log(JSON.stringify({
    status: 'PASS',
    chunks: chunks.length,
    checks: [
      'provider unavailable fallback',
      'provider exception fallback',
      'central provider output validation',
      'explicit provenance',
      'canonical sentence-aware chunking',
      'canonical timing-sensitive identity',
      'deterministic reconciliation',
      'gap-fill mixed provenance',
      'reverent suppression',
      'rights hard gate',
      'review human override provenance',
      'review plan hash compatibility',
      'independent stage cache reuse and invalidation',
      'provider cache identity isolation',
      'AI-vs-fallback comparison metrics',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
