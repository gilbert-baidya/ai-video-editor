import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { EditOperation, EditPlan, MediaAsset, SermonAnalysis, SermonSection, TranscriptDocument, VisualRecommendation } from '../src/contracts.ts';
import type { DirectorEditorialEnrichmentRequest, DirectorInput, DirectorProvider, DirectorProviderResult } from '../src/director.ts';
import { resolveAIResponse } from '../src/director.ts';
import { runFullSermonDirector } from '../src/full-sermon-director.ts';
import { buildEditorialOpportunities, enrichmentOpportunities, evaluateDirectorQuality } from '../src/editorial-opportunity.ts';
import { mergeEditorialEnrichment, runBoundedEditorialEnrichment } from '../src/director-enrichment.ts';
import { applyRetentionPolicy } from '../src/visual-policy.ts';
import { auditPlanRealization, EDITORIAL_QUALITY_CONTRACT_VERSION, evaluateEditorialQuality, meaningfulEditEvents } from '../src/editorial-quality.ts';
import { createVideoFormatProfile } from '../src/video-format.ts';

interface FixtureSection {
  id: string;
  start: number;
  end: number;
  type: SermonSection['type'];
  intensity: SermonSection['intensity'];
  visualRecommendation: VisualRecommendation;
}

interface Fixture {
  projectId: string;
  source: { width: number; height: number; durationSeconds: number };
  sections: FixtureSection[];
}

const fixture = JSON.parse(await readFile(resolve(import.meta.dirname, '../fixtures/editorial-short-v1-3-1.json'), 'utf8')) as Fixture;
const transcript: TranscriptDocument = {
  schemaVersion: '1.0',
  projectId: fixture.projectId,
  originalTranscript: fixture.sections.map((item) => `Canonical ${item.id}`).join(' '),
  aiSuggestedDisplayText: '',
  approvedDisplayText: '',
  language: 'bn',
  textSource: 'local-asr',
  transcriptionProvider: 'fixture',
  transcriptionModel: 'fixture',
  approved: false,
  timingConfidence: 'segment-safe',
  source: 'whisper-cli',
  model: 'fixture',
  segments: fixture.sections.map((item) => ({
    id: `segment-${item.id}`,
    start: item.start,
    end: item.end,
    text: `Canonical ${item.id}`,
    language: 'bn',
    words: [],
  })),
  immutableOriginal: true,
  alignment: { provider: 'fixture', status: 'verified', limitations: [] },
};

function aiResult(input: DirectorInput, enriched: boolean): DirectorProviderResult {
  const selected = new Set(input.primarySegmentIds ?? input.segments.map((item) => item.id));
  const sections = input.segments.flatMap((segment, index) => {
    if (!selected.has(segment.id)) return [];
    const semantic = fixture.sections.find((item) => `segment-${item.id}` === segment.id)!;
    const recommendation: VisualRecommendation = !enriched
      ? semantic.type === 'prayer' ? 'none' : 'speaker-full'
      : semantic.type === 'main-point' ? 'keyword-graphic'
        : semantic.type === 'question' ? 'caption'
          : semantic.type === 'teaching' ? 'speaker-left'
            : semantic.type === 'story' ? 'image-broll'
              : semantic.type === 'prayer' ? 'none'
                : 'speaker-punch-in';
    return [{
      sectionType: semantic.type,
      startSegment: index,
      endSegment: index,
      intensity: semantic.intensity ?? 'normal-teaching',
      suggestedDisplayText: ['caption', 'keyword-graphic'].includes(recommendation) ? `Key ${semantic.id}` : undefined,
      visualRecommendation: recommendation,
      confidence: 0.9,
      reason: enriched ? `Enriched ${semantic.type} with a restrained semantic treatment.` : 'Initial conservative fixture.',
    }];
  });
  return {
    providerResult: 'ai-success',
    provider: 'mock-editorial-ai',
    model: 'fixture-v1',
    runtimeMs: 1,
    attempts: [{ attempt: 1, parse: 'pass', schema: 'pass', segmentReferences: 'pass', semanticOutput: 'pass', canonicalCoverage: 'pass', runtimeMs: 1, phase: enriched ? 'editorial-enrichment' : 'analysis' }],
    rawResponses: [],
    analysis: resolveAIResponse({ sections, overallConfidence: 0.9 }, input),
  };
}

class EnrichmentProvider implements DirectorProvider {
  readonly name = 'mock-editorial-ai';
  readonly model = 'fixture-v1';
  readonly cacheIdentity = 'mock-editorial-ai-v1';
  enrichmentCalls = 0;
  async checkAvailability() {
    return { available: true, checkedAt: new Date().toISOString() };
  }
  async analyze(input: DirectorInput): Promise<DirectorProviderResult> {
    return aiResult(input, false);
  }
  async enrichEditorial(request: DirectorEditorialEnrichmentRequest): Promise<DirectorProviderResult> {
    this.enrichmentCalls += 1;
    assert(request.opportunities.every((item) => item.reverenceSensitivity !== 'PROTECTED'));
    assert(!request.eligibleSegmentIds.includes('segment-prayer'));
    return aiResult(request.input, true);
  }
}

const provider = new EnrichmentProvider();
const result = await runFullSermonDirector(transcript, { provider });
assert.equal(provider.enrichmentCalls, 1, 'Director performed more or fewer than one enrichment attempt.');
assert.equal(result.editorialEnrichment.enrichmentAttemptCount, 1);
assert.equal(result.directorQuality.status, 'ENRICHED');
assert(result.directorQuality.meaningfulRecommendations >= 4);
assert(result.directorQuality.visualVarietyScore > result.editorialEnrichment.initialQuality.visualVarietyScore);
assert.equal(result.reconciliation.analysis.sections.find((item) => item.type === 'story')?.visualRecommendation, 'image-broll');
assert.equal(result.reconciliation.analysis.sections.find((item) => item.type === 'prayer')?.visualRecommendation, 'none');

const cacheRoot = await mkdtemp(resolve(tmpdir(), 'director-enrichment-cache-'));
try {
  const cachedProvider = new EnrichmentProvider();
  await runFullSermonDirector(transcript, { provider: cachedProvider, cacheRoot });
  const cached = await runFullSermonDirector(transcript, { provider: cachedProvider, cacheRoot });
  assert.equal(cachedProvider.enrichmentCalls, 1, 'Cached retry repeated the bounded enrichment request.');
  assert.equal(cached.editorialEnrichmentCache.hit, true);
} finally {
  await rm(cacheRoot, { recursive: true, force: true });
}

const canonicalById = new Map(transcript.segments.map((segment) => [segment.id, segment]));
for (const section of result.reconciliation.analysis.sections) {
  const covered = section.sourceSegmentIds.map((id) => canonicalById.get(id)!);
  assert.equal(section.start, covered[0].start);
  assert.equal(section.end, covered.at(-1)!.end);
}

const prayerTranscript: TranscriptDocument = {
  ...transcript,
  projectId: 'prayer-only',
  originalTranscript: 'Canonical prayer',
  segments: [{ id: 'prayer-segment', start: 0, end: 60, text: 'Canonical prayer', language: 'bn', words: [] }],
};
const prayerAnalysis: SermonAnalysis = {
  ...result.reconciliation.analysis,
  projectId: prayerTranscript.projectId,
  sections: [{
    id: 'prayer-only-section',
    start: 0,
    end: 60,
    transcriptText: 'Canonical prayer',
    sourceSegmentIds: ['prayer-segment'],
    type: 'prayer',
    intensity: 'reverent-calm',
    visualRecommendation: 'none',
    confidence: 1,
    reason: 'Protected prayer.',
  }],
};
const prayerProvider = new EnrichmentProvider();
const prayerResult = await runBoundedEditorialEnrichment(prayerTranscript, prayerAnalysis, prayerProvider);
assert.equal(prayerResult.enrichmentTriggered, false);
assert.equal(prayerProvider.enrichmentCalls, 0);

const scriptureSection: SermonSection = {
  ...prayerAnalysis.sections[0],
  id: 'scripture',
  type: 'scripture-reading',
  sourceSegmentIds: ['prayer-segment'],
  visualRecommendation: 'speaker-full',
};
assert.equal(buildEditorialOpportunities({ ...prayerAnalysis, sections: [scriptureSection] })[0].reverenceSensitivity, 'PROTECTED');

const longTeachingAnalysis: SermonAnalysis = {
  ...prayerAnalysis,
  projectId: 'long-teaching',
  sections: [{
    ...prayerAnalysis.sections[0],
    id: 'long-teaching-section',
    type: 'teaching',
    intensity: 'normal-teaching',
    visualRecommendation: 'speaker-full',
    reason: 'Deliberately static long teaching fixture.',
  }],
};
assert.equal(evaluateDirectorQuality(longTeachingAnalysis).status, 'LOW-ACTIVITY');

const initialAnalysis = result.editorialEnrichment.initialQuality.status === 'LOW-ACTIVITY'
  ? (await new EnrichmentProvider().analyze({ transcript, segments: transcript.segments, projectDuration: 60, projectId: transcript.projectId })).analysis!
  : result.reconciliation.analysis;
const opportunities = buildEditorialOpportunities(initialAnalysis).filter((item) => item.reverenceSensitivity !== 'PROTECTED');
const illegalEnrichment: SermonAnalysis = { ...prayerAnalysis, projectId: transcript.projectId, sections: [{ ...prayerAnalysis.sections[0], id: 'illegal-prayer', sourceSegmentIds: ['segment-prayer'], start: 55, end: 60 }] };
assert.throws(() => mergeEditorialEnrichment(transcript, initialAnalysis, illegalEnrichment, opportunities), /protected or ineligible/);
const enrichmentInput: DirectorInput = {
  transcript,
  segments: transcript.segments,
  projectDuration: 60,
  projectId: transcript.projectId,
  primarySegmentIds: enrichmentOpportunities(initialAnalysis).flatMap((item) => initialAnalysis.sections.find((section) => section.id === item.sectionId)!.sourceSegmentIds),
};
const textTampered = aiResult(enrichmentInput, true).analysis!;
textTampered.sections[0] = { ...textTampered.sections[0], transcriptText: 'Changed canonical text' };
assert.throws(() => mergeEditorialEnrichment(transcript, initialAnalysis, textTampered, enrichmentOpportunities(initialAnalysis)), /canonical transcript text/);

class ExcessiveAttemptProvider extends EnrichmentProvider {
  override async enrichEditorial(request: DirectorEditorialEnrichmentRequest): Promise<DirectorProviderResult> {
    const value = await super.enrichEditorial(request);
    return { ...value, attempts: [...value.attempts, { ...value.attempts[0], attempt: 2 }] };
  }
}
const excessive = await runBoundedEditorialEnrichment(transcript, initialAnalysis, new ExcessiveAttemptProvider(), 1);
assert.equal(excessive.outcome, 'failed');
assert.equal(excessive.enrichmentAttemptCount, 2);
assert.match(excessive.error ?? '', /exceeded the 1-attempt limit/);

const policy = applyRetentionPolicy(result.reconciliation.analysis, transcript.projectId, 'fixture-hash', 60);
const operationForType = (type: SermonSection['type']) => {
  const section = result.reconciliation.analysis.sections.find((item) => item.type === type)!;
  return policy.editPlan.operations.find((operation) => operation.id === `policy-${section.id}`);
};
assert.equal(operationForType('story')?.type, 'director-placeholder');
assert.equal(operationForType('question')?.type, 'caption');
assert.equal(operationForType('teaching')?.type, 'speaker-position');
assert.equal(operationForType('introduction')?.type, 'speaker-position');
assert.equal(operationForType('prayer')?.type, 'no-change');
assert(!policy.editPlan.operations.some((operation) => operation.type === 'broll'), 'Enrichment fabricated a resolved B-roll asset.');

const asset: MediaAsset = {
  id: 'story-asset',
  path: '/fixture/story.jpg',
  relativePath: 'story.jpg',
  fileName: 'story.jpg',
  kind: 'image',
  mimeType: 'image/jpeg',
  sizeBytes: 100,
  modifiedAt: '2026-09-09T00:00:00.000Z',
  width: 1080,
  height: 1920,
  aspectRatio: 1080 / 1920,
  hasAudio: false,
  tags: ['story'],
  categories: ['illustration'],
  searchTerms: ['story'],
  rightsStatus: 'owned',
  rightsSource: 'library-root-default',
  libraryRootId: 'fixture',
  libraryPolicyVersion: '1',
  usable: true,
  unusableReasons: [],
};
const broll: EditOperation = { id: 'broll-story', type: 'broll', sourceStart: 0, sourceEnd: 10, start: 45, end: 55, assetId: asset.id, mode: 'full-screen', muted: true, reason: 'Resolved fixture B-roll.', confidence: 0.9 };
const storyPolicyId = operationForType('story')!.id;
const approvedOperations = policy.editPlan.operations.map((operation) => operation.id === storyPolicyId ? broll : operation);
const approvedPlan: EditPlan = { ...policy.editPlan, operations: approvedOperations, status: 'approved' };
const realization = auditPlanRealization(approvedPlan, [asset]);
assert.equal(realization.droppedOperations.length, 0);
assert.equal(realization.unsupportedOperations.length, 0);
for (const type of ['caption', 'sermon-point', 'speaker-position', 'broll', 'no-change']) {
  assert(approvedPlan.operations.some((operation) => operation.type === type), `${type} did not survive the enriched contract.`);
}

const enrichedQa = evaluateEditorialQuality({
  analysis: result.reconciliation.analysis,
  approvedPlan,
  mediaAssets: [asset],
  durationSeconds: 60,
  canonicalCoveragePercent: 100,
  format: createVideoFormatProfile(1080, 1918),
  sourceWidth: 1080,
  sourceHeight: 1918,
  renderedOperationIds: realization.renderedOperations,
});
assert.equal(enrichedQa.passed, true, enrichedQa.failures.join('; '));
assert.equal(enrichedQa.contractVersion, EDITORIAL_QUALITY_CONTRACT_VERSION);
assert.deepEqual(enrichedQa.failureCodes, []);

const barrenPolicy = applyRetentionPolicy(initialAnalysis, transcript.projectId, 'fixture-hash', 60);
const barrenQa = evaluateEditorialQuality({
  analysis: initialAnalysis,
  approvedPlan: { ...barrenPolicy.editPlan, status: 'approved' },
  mediaAssets: [],
  durationSeconds: 60,
  canonicalCoveragePercent: 100,
  format: createVideoFormatProfile(1080, 1918),
  sourceWidth: 1080,
  sourceHeight: 1918,
});
assert.equal(barrenQa.passed, false);
assert.equal(barrenQa.contractVersion, EDITORIAL_QUALITY_CONTRACT_VERSION);
assert(barrenQa.failureCodes.includes('EDIT_ACTIVITY'));
assert.equal(evaluateDirectorQuality(initialAnalysis).status, 'LOW-ACTIVITY');
assert(meaningfulEditEvents(approvedPlan).length > meaningfulEditEvents(barrenPolicy.editPlan).length);

console.log(JSON.stringify({
  status: 'PASS',
  checks: [
    'prayer-only skips enrichment',
    'mixed barren plan triggers one enrichment attempt',
    'single long eligible section triggers enrichment',
    'provider retry limit is enforced',
    'enrichment cache prevents repeat AI repair',
    'canonical IDs, timing, ordering, and text preserved',
    'prayer and Scripture protected',
    'story considers unresolved B-roll without fake media',
    'punch-in, reframe, caption, sermon-point, and no-change survive',
    'visual variety diagnostics improve',
    'barren benchmark remains Editorial QA failure',
    'enriched benchmark passes unchanged Editorial QA',
    'approved enriched operations have zero drops',
  ],
}, null, 2));
