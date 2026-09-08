import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { applyRetentionToBrollIntents, BROLL_PREVIEW_MAPPING_VERSION, createPlacedBrollOperations, mapSourceRangeToPreview, validateBrollPreview } from '../src/broll-preview.ts';
import { decideBroll, rankMediaCandidates } from '../src/broll-selection.ts';
import type { BrollDecision, BrollIntent, EditPlan, MediaLibraryRoot, PlacementDecision, SermonAnalysis, TranscriptDocument } from '../src/contracts.ts';
import { applyRetentionPolicy } from '../src/visual-policy.ts';
import { deterministicFallbackAnalysis, generateVisualBeats, OllamaDirectorProvider, validateAIResponse, validateDirectorInput, type DirectorInput } from '../src/director.ts';
import { executeDirector } from '../src/director-execution.ts';
import { createQa, ensureDirectory, sha256, writeJson } from '../src/foundation.ts';
import { indexLocalMedia, MEDIA_INDEXER_VERSION, normalizeMediaSearchTerms } from '../src/media-library.ts';
import { PLACEMENT_ALGORITHM_VERSION, representativeSampleTimes, resolveBrollPlacement, resolveVisualPlacements, TEXT_FIT_ALGORITHM_VERSION, VISUAL_SAMPLING_VERSION } from '../src/visual-intelligence.ts';
import { resolvedOperationFontSize } from '../src/render-presentation.ts';

const root = resolve(import.meta.dirname, '..');
const artifactRoot = join(root, 'artifacts', 'sol-foundation-fixes');

function transcript(): TranscriptDocument {
  const segments = [
    { id: 'segment-1', start: 0, end: 10, text: 'বিশ্বাসের কথা', language: 'bn' as const, words: [{ id: 'word-1', text: 'বিশ্বাসের', start: 0, end: 1, language: 'bn' as const }] },
    { id: 'segment-2', start: 10, end: 20, text: 'বাইবেলের শিক্ষা', language: 'bn' as const, words: [{ id: 'word-2', text: 'বাইবেলের', start: 10, end: 11, language: 'bn' as const }] },
  ];
  return {
    schemaVersion: '1.0', projectId: 'sol-foundation-fixes', originalTranscript: segments.map((segment) => segment.text).join(' '),
    aiSuggestedDisplayText: 'AI suggestion', approvedDisplayText: '', language: 'bn', textSource: 'existing-project',
    transcriptionProvider: 'fixture', transcriptionModel: 'fixture', approved: false, timingConfidence: 'segment-safe', source: 'sermonclip-reference', model: 'fixture',
    segments, immutableOriginal: true, alignment: { provider: 'fixture', status: 'partial', limitations: ['Segment-safe proof fixture.'] },
  };
}

function directorInput(): DirectorInput {
  const canonical = transcript();
  return { transcript: canonical, segments: canonical.segments, projectDuration: 20, projectId: canonical.projectId };
}

function analysis(section: SermonAnalysis['sections'][number], mainPassage?: SermonAnalysis['mainPassage']): SermonAnalysis {
  return {
    version: 'fix-proof-v1', projectId: 'sol-foundation-fixes', mainPassage, supportingPassages: [], sections: [section],
    mainPoints: [], keyStatements: [], illustrations: [], stories: [], testimonies: [], questions: [], applications: [], prayerMoments: [], emotionalMoments: [], confidence: 0.8,
  };
}

function placement(beatId: string): PlacementDecision {
  return {
    beatId, requestedVisual: 'image-broll', decision: 'place', selectedRegion: 'left',
    candidateRegions: [{ region: 'left', score: 0.8, blockedBy: [], reason: 'Clear split region.', availableArea: 0.1 }],
    reason: 'V3 selected a safe split region.', visualEvidence: ['fixture-frame.png'],
    textFit: { fontSize: 44, maxLines: 3, lineCount: 1, fits: true },
  };
}

async function main(): Promise<void> {
  await ensureDirectory(artifactRoot);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'sol-foundation-fixes-'));
  try {
    const mediaPath = join(temporaryRoot, 'বাইবেল.mp4');
    await copyFile(join(root, 'public', 'proof-source.mp4'), mediaPath);
    const outputDirectory = join(temporaryRoot, 'index');
    const indexPath = join(outputDirectory, 'index.json');
    const makeRoot = (rights: MediaLibraryRoot['defaultRightsStatus'], rightsPolicyVersion: string): MediaLibraryRoot => ({
      id: 'proof-root', path: temporaryRoot, label: 'Proof root', defaultRightsStatus: rights, rightsPolicyVersion, recursive: false, enabled: true,
    });

    const approvedFirst = await indexLocalMedia({ roots: [makeRoot('approved', 'rights-v1')], outputDirectory });
    assert.equal(approvedFirst.index.assets[0]?.rightsStatus, 'approved');
    const unknownSecond = await indexLocalMedia({ roots: [makeRoot('unknown', 'rights-v2')], outputDirectory, previousIndexPath: indexPath });
    assert.equal(unknownSecond.cache.reused, 0);
    assert.equal(unknownSecond.index.assets[0]?.rightsStatus, 'unknown');
    assert.equal(unknownSecond.index.assets[0]?.libraryPolicyVersion, 'rights-v2');

    const intent: BrollIntent = {
      sectionId: 'section-bible', start: 100, end: 120, decision: 'search', reason: 'Fixture Bible illustration.',
      search: { concept: 'বাইবেল', sectionId: 'section-bible', sectionType: 'illustration', desiredMedia: 'either', semanticTags: ['বাইবেল'], avoidTerms: [], preferredCategories: ['scripture'], allowUnknownRights: false },
    };
    assert.equal(decideBroll(unknownSecond.index, intent).decision, 'no-suitable-asset');

    const approvedThird = await indexLocalMedia({ roots: [makeRoot('approved', 'rights-v3')], outputDirectory, previousIndexPath: indexPath });
    assert.equal(approvedThird.cache.reused, 0);
    assert.equal(approvedThird.index.assets[0]?.rightsStatus, 'approved');
    const approvedFourth = await indexLocalMedia({ roots: [makeRoot('approved', 'rights-v3')], outputDirectory, previousIndexPath: indexPath });
    assert.equal(approvedFourth.cache.reused, 1);
    await writeJson(indexPath, { ...approvedFourth.index, indexerVersion: 'obsolete-indexer-version' });
    const versionChanged = await indexLocalMedia({ roots: [makeRoot('approved', 'rights-v3')], outputDirectory, previousIndexPath: indexPath });
    assert.equal(versionChanged.cache.reused, 0);
    const selected = decideBroll(versionChanged.index, intent);
    assert.equal(selected.decision, 'selected');
    assert.ok(rankMediaCandidates(versionChanged.index, intent.search!)[0].semanticScore > 0);
    const multilingualIndex = {
      ...versionChanged.index,
      assets: versionChanged.index.assets.map((asset) => ({
        ...asset,
        tags: ['Bible', 'বাইবেল', 'Scripture'],
        searchTerms: ['bible', 'বাইবেল', 'scripture'],
      })),
    };
    const englishIntent = { ...intent.search!, concept: 'scripture', semanticTags: ['scripture'] };
    assert.ok(rankMediaCandidates(multilingualIndex, englishIntent)[0].semanticScore > 0);
    assert.ok(versionChanged.index.assets[0].tags.includes('বাইবেল'));
    assert.ok(versionChanged.index.assets[0].searchTerms.includes('বাইবেল'));
    const banglaConcepts = ['প্রার্থনা', 'বাইবেল', 'বিশ্বাস', 'বাংলাদেশ', 'পরিবার', 'গির্জা', 'উপাসনা', 'প্রকৃতি', 'মিশন', 'অনুগ্রহ'];
    assert.deepEqual(normalizeMediaSearchTerms(banglaConcepts), banglaConcepts);

    const preview = { sourceStart: 80, sourceEnd: 200 };
    assert.deepEqual(mapSourceRangeToPreview(100, 120, preview), { sourceStart: 100, sourceEnd: 120, visibleSourceStart: 100, visibleSourceEnd: 120, previewStart: 20, previewEnd: 40 });
    const selectedDecision = selected as BrollDecision;
    const selectedPlacement = placement(selectedDecision.intent.sectionId);
    const operations = createPlacedBrollOperations([selectedDecision], [selectedPlacement], preview);
    assert.equal(operations[0]?.type, 'broll');
    assert.equal(operations[0]?.start, 20);
    assert.equal(operations[0]?.end, 40);
    assert.equal(operations[0]?.type === 'broll' ? operations[0].mode : undefined, 'split-left');
    assert.equal(operations[0]?.type === 'broll' ? operations[0].placement?.beatId : undefined, selectedDecision.intent.sectionId);
    const operationId = `broll-${selectedDecision.intent.sectionId}`;
    assert.deepEqual(validateBrollPreview([selectedDecision], operations, [selectedPlacement], versionChanged.index, preview, { renderedOperationIds: new Set([operationId]), visibleOperationIds: new Set([operationId]) }), []);
    const missingVisibilityFailures = validateBrollPreview([selectedDecision], operations, [selectedPlacement], versionChanged.index, preview, { renderedOperationIds: new Set([operationId]), visibleOperationIds: new Set() });
    assert.ok(missingVisibilityFailures.some((failure) => failure.includes('visibility evidence is missing')));

    const outsideDecision: BrollDecision = { ...selectedDecision, intent: { ...selectedDecision.intent, start: 260, end: 340 } };
    const outsideOperations = createPlacedBrollOperations([outsideDecision], [selectedPlacement], preview);
    const outsideFailures = validateBrollPreview([outsideDecision], outsideOperations, [selectedPlacement], versionChanged.index, preview, { renderedOperationIds: new Set(), visibleOperationIds: new Set() });
    assert.equal(outsideOperations.length, 0);
    assert.ok(outsideFailures.some((failure) => failure.includes('does not intersect')));
    const bypassFailures = validateBrollPreview([selectedDecision], createPlacedBrollOperations([selectedDecision], [], preview), [], versionChanged.index, preview, { renderedOperationIds: new Set(), visibleOperationIds: new Set() });
    assert.ok(bypassFailures.some((failure) => failure.includes('no V3 placement')));
    const calmAnalysis = analysis({
      id: 'section-bible', start: 100, end: 120, transcriptText: 'নীরব প্রার্থনা', sourceSegmentIds: ['segment-1'], type: 'illustration', intensity: 'reverent-calm', visualRecommendation: 'image-broll', confidence: 0.8, reason: 'Calm proof.',
    });
    const calmPolicy = applyRetentionPolicy(calmAnalysis, 'sol-foundation-fixes', sha256('calm'), 120);
    assert.equal(applyRetentionToBrollIntents([intent], calmPolicy)[0].decision, 'no-broll');

    assert.deepEqual(representativeSampleTimes(20, 40, 120), [20, 30, 40]);
    assert.equal(resolveBrollPlacement('missing-evidence', 'image-broll', []).decision, 'review');
    const textOperation: Extract<EditPlan['operations'][number], { type: 'sermon-point' }> = {
      id: 'text-fit', type: 'sermon-point', start: 0, end: 2, text: 'বাংলা', textTrust: 'canonical-transcript', position: 'right', style: 'proof', placement: selectedPlacement, reason: 'Proof.', confidence: 1,
    };
    assert.equal(resolvedOperationFontSize(textOperation, 62), 44);
    const visualCacheKey = sha256(JSON.stringify({ sampling: VISUAL_SAMPLING_VERSION, placement: PLACEMENT_ALGORITHM_VERSION, textFit: TEXT_FIT_ALGORITHM_VERSION, previewMapping: BROLL_PREVIEW_MAPPING_VERSION }));
    const changedSamplingCacheKey = sha256(JSON.stringify({ sampling: `${VISUAL_SAMPLING_VERSION}-changed`, placement: PLACEMENT_ALGORITHM_VERSION, textFit: TEXT_FIT_ALGORITHM_VERSION, previewMapping: BROLL_PREVIEW_MAPPING_VERSION }));
    assert.notEqual(visualCacheKey, changedSamplingCacheKey);

    const mainPoint = analysis({
      id: 'main-point', start: 0, end: 10, transcriptText: 'বিশ্বাসের কথা', sourceSegmentIds: ['segment-1'], type: 'main-point', intensity: 'emphasis', suggestedDisplayText: 'AI লেখা', visualRecommendation: 'keyword-graphic', confidence: 0.8, reason: 'Proof.',
    });
    const previewBeat = generateVisualBeats(mainPoint)[0];
    const finalBeat = generateVisualBeats(mainPoint, { mode: 'final' })[0];
    assert.equal(previewBeat.displayTextTrust, 'ai-suggested-unapproved');
    assert.equal(finalBeat.displayTextTrust, 'canonical-transcript');
    assert.equal(finalBeat.suggestedDisplayText, 'বিশ্বাসের কথা');
    const previewPolicy = applyRetentionPolicy(mainPoint, 'sol-foundation-fixes', sha256('main-point'), 10);
    const previewPlacement = resolveVisualPlacements(previewPolicy, mainPoint, [{ beatId: previewPolicy.records[0].segment, time: 5, imagePath: 'fixture-frame.png', width: 1920, height: 1080, faces: [], occupied: [], detector: 'fixture' }]);
    assert.equal(previewPlacement.editPlan.operations.find((operation) => operation.type === 'sermon-point' || operation.type === 'full-screen-card')?.textTrust, 'ai-suggested-unapproved');

    const scripture = analysis({
      id: 'scripture', start: 0, end: 10, transcriptText: 'যোহন তিন অধ্যায়', sourceSegmentIds: ['segment-1'], type: 'scripture-reading', intensity: 'reverent-calm', suggestedDisplayText: 'Fabricated verse text', scriptureReference: 'John 3:16', visualRecommendation: 'scripture-card', confidence: 0.8, reason: 'Proof.',
    }, { rawText: 'John 3:16', normalizedReference: 'John 3:16', start: 0, end: 10, confidence: 0.8, verificationStatus: 'needs-review' });
    const scripturePolicy = applyRetentionPolicy(scripture, 'sol-foundation-fixes', sha256('scripture'), 10, undefined, { mode: 'final' });
    assert.equal(scripturePolicy.records[0].displayText, 'John 3:16');
    assert.equal(scripturePolicy.records[0].displayTextTrust, 'scripture-reference-needs-review');
    assert.notEqual(scripturePolicy.records[0].displayText, 'Fabricated verse text');

    const validInput = directorInput();
    assert.doesNotThrow(() => validateDirectorInput(validInput));
    assert.throws(() => validateDirectorInput({ ...validInput, segments: [{ ...validInput.segments[0], text: 'changed' }, validInput.segments[1]] }), /canonical transcript/);
    assert.throws(() => validateAIResponse({ overallConfidence: 0.8, sections: [
      { sectionType: 'teaching', startSegment: 0, endSegment: 1, intensity: 'normal-teaching', visualRecommendation: 'speaker-full', confidence: 0.8, reason: 'One.' },
      { sectionType: 'main-point', startSegment: 1, endSegment: 1, intensity: 'emphasis', visualRecommendation: 'keyword-graphic', confidence: 0.8, reason: 'Overlap.' },
    ] }, 2), /ordered and non-overlapping/);
    assert.ok(deterministicFallbackAnalysis(validInput).sections.length > 0);
    const providerFallback = await executeDirector(validInput, { provider: new OllamaDirectorProvider({ endpoint: 'http://127.0.0.1:1', attempts: 1, timeoutMs: 100 }) });
    assert.equal(providerFallback.provenance.source, 'deterministic-fallback');
    assert.ok(providerFallback.analysis.sections.length);

    const qaPlan: EditPlan = { schemaVersion: 'proof', projectId: validInput.projectId, sourceTranscriptHash: sha256(validInput.transcript.originalTranscript), operations: [], status: 'draft', createdBy: { provider: 'proof', model: 'proof' } };
    assert.equal(createQa(validInput.transcript, qaPlan, validInput.projectDuration).passed, false);

    const result = {
      status: 'PASS',
      sourceMedia: basename(mediaPath),
      rightsCache: { indexerVersion: MEDIA_INDEXER_VERSION, approvedToUnknownReused: unknownSecond.cache.reused, downgradedStatus: unknownSecond.index.assets[0].rightsStatus, unknownToApprovedReused: approvedThird.cache.reused, stableApprovedReused: approvedFourth.cache.reused, obsoleteIndexerReused: versionChanged.cache.reused },
      banglaSearch: { query: 'বাইবেল', matchedAssetId: selected.selectedAssetId, banglaOnlyAssetSelected: true, originalTags: versionChanged.index.assets[0].tags, normalizedSearchTerms: versionChanged.index.assets[0].searchTerms, multilingualOriginalTags: multilingualIndex.assets[0].tags, preservedConceptVocabulary: banglaConcepts, englishStillMatches: true, matchingMethod: 'normalized exact metadata terms with the existing synonym expansion' },
      previewMapping: mapSourceRangeToPreview(100, 120, preview),
      outsidePreviewFailures: outsideFailures,
      missingVisibilityFailures,
      placement: { retentionSuppressesCalmBroll: true, operationMode: operations[0]?.type === 'broll' ? operations[0].mode : undefined, evidence: selectedPlacement.visualEvidence, bypassFailures },
      sampling: { version: VISUAL_SAMPLING_VERSION, beat: [20, 40], samples: representativeSampleTimes(20, 40, 120) },
      algorithms: { placement: PLACEMENT_ALGORITHM_VERSION, textFit: TEXT_FIT_ALGORITHM_VERSION, previewMapping: BROLL_PREVIEW_MAPPING_VERSION, visualCacheKey, changedSamplingCacheKey, versionChangeInvalidatesKey: visualCacheKey !== changedSamplingCacheKey },
      textFit: { resolvedFontSize: resolvedOperationFontSize(textOperation, 62) },
      trust: { preview: previewBeat.displayTextTrust, v3Operation: previewPlacement.editPlan.operations.find((operation) => operation.type === 'sermon-point' || operation.type === 'full-screen-card')?.textTrust, final: finalBeat.displayTextTrust, scripture: scripturePolicy.records[0].displayTextTrust },
      director: { canonicalMismatchRejected: true, overlapRejected: true, fallbackHasAnalysis: Boolean(providerFallback.analysis) },
      qa: { preRenderPassed: createQa(validInput.transcript, qaPlan, validInput.projectDuration).passed },
    };
    await writeJson(join(artifactRoot, 'regression-proof.json'), result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});