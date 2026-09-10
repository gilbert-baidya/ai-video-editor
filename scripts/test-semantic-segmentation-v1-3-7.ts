import assert from 'node:assert/strict';
import { detectCoarseSegmentation, validateAIResponse, semanticAnalysisPromptFor, visualDecisionPromptFor } from '../src/director.js';
import { evaluateAssetRelevance } from '../src/broll-selection.js';
import type { MediaAsset } from '../src/contracts.js';

async function run() {
  console.log('Testing semantic boundary and granularity mapping...');
  const fakeAiResponse = {
    overallSemanticRole: 'story',
    sections: [
      {
        sectionType: 'story',
        secondaryType: 'setup',
        semanticFunction: 'setup',
        boundaryReason: 'topic change',
        startIndex: 0,
        endIndex: 2,
        semanticConfidence: 0.9,
        semanticEvidence: 'Start of the story'
      },
      {
        sectionType: 'story',
        secondaryType: 'main-point',
        semanticFunction: 'turning-point',
        boundaryReason: 'conflict introduced',
        startIndex: 3,
        endIndex: 5,
        semanticConfidence: 0.9,
        semanticEvidence: 'The conflict'
      }
    ],
    overallConfidence: 0.95
  };

  const parsed = validateAIResponse(fakeAiResponse, 10);
  assert.equal(parsed.overallSemanticRole, 'story', 'Overall role preserved');
  assert.equal(parsed.sections[0].semanticFunction, 'setup', 'Semantic function preserved');
  assert.equal(parsed.sections[1].boundaryReason, 'conflict introduced', 'Boundary reason preserved');

  console.log('Testing coarse segmentation detection...');
  const fakeAnalysisSingle = {
    version: '1.0',
    projectId: 'test',
    supportingPassages: [],
    mainPoints: [],
    keyStatements: [],
    illustrations: [],
    sections: [
      { id: '1', start: 0, end: 72, transcriptText: '', sourceSegmentIds: [], type: 'story' as const, confidence: 1 }
    ]
  };
  const coarseDiag = detectCoarseSegmentation(fakeAnalysisSingle, 72);
  assert.equal(coarseDiag.coarseSegmentationRisk, 'EXTREMELY_COARSE', 'Single giant section detected as EXTREMELY_COARSE');

  const fakeAnalysisMultiple = {
    ...fakeAnalysisSingle,
    sections: [
      { id: '1', start: 0, end: 30, transcriptText: '', sourceSegmentIds: [], type: 'story' as const, confidence: 1 },
      { id: '2', start: 30, end: 50, transcriptText: '', sourceSegmentIds: [], type: 'main-point' as const, confidence: 1 },
      { id: '3', start: 50, end: 72, transcriptText: '', sourceSegmentIds: [], type: 'application' as const, confidence: 1 }
    ]
  };
  const normalDiag = detectCoarseSegmentation(fakeAnalysisMultiple, 72);
  assert.equal(normalDiag.coarseSegmentationRisk, 'NORMAL', 'Multiple sections detected as NORMAL');

  console.log('Testing B-roll asset relevance matching...');
  const peterAsset: MediaAsset = {
    id: 'peter-prison',
    relativePath: 'peter.jpg',
    fileName: 'peter.jpg',
    kind: 'image',
    width: 1920,
    height: 1080,
    usable: true,
    rightsStatus: 'approved',
    rightsBasis: 'generated',
    categories: ['scripture'],
    tags: ['peter', 'prison', 'angel'],
    searchTerms: ['peter', 'prison', 'chains'],
    description: 'Peter escaping from prison with an angel'
  };

  const intentKingFamine = {
    subject: 'king and citizens',
    action: 'responding to severe famine',
    setting: 'ancient biblical city',
    mood: 'desperation and crisis',
    visualPurpose: 'illustrate the narrative crisis',
    exclusions: ['Peter in prison', 'modern city']
  };

  const mismatchRelevance = evaluateAssetRelevance(intentKingFamine, peterAsset);
  assert.equal(mismatchRelevance, 'MISMATCH', 'Peter prison asset mismatches famine/king intent due to exclusions');

  const famineAsset: MediaAsset = {
    ...peterAsset,
    id: 'famine',
    description: 'A king and citizens in an ancient biblical city during a severe famine',
    tags: ['king', 'famine', 'ancient', 'city'],
    searchTerms: ['king', 'famine', 'desperation'],
  };
  const highRelevance = evaluateAssetRelevance(intentKingFamine, famineAsset);
  assert.equal(highRelevance, 'HIGH', 'Relevant asset achieves HIGH relevance');

  const intentMissingExclusionMatch = {
    ...intentKingFamine,
    exclusions: ['modern city']
  };
  // Wait, if exclusions don't match, peter might just get LOW instead of MISMATCH. Let's check:
  const lowRelevance = evaluateAssetRelevance(intentMissingExclusionMatch, peterAsset);
  assert.equal(lowRelevance, 'LOW', 'Irrelevant asset achieves LOW relevance if not explicitly excluded');

  console.log('All tests passed.');
}

run().catch(console.error);
