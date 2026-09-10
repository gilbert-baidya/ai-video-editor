import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { SermonSection, SermonAnalysis, TranscriptDocument } from '../src/contracts.ts';
import { evaluateDirectorQuality, determineStoryTreatment, validateDecisionConsistency, enrichmentOpportunities } from '../src/editorial-opportunity.ts';

const baseSection: SermonSection = {
  id: 'section-1',
  start: 0,
  end: 20,
  transcriptText: 'test',
  sourceSegmentIds: ['segment-1'],
  type: 'story',
  intensity: 'story-illustration',
  confidence: 0.9,
  reason: 'test'
};

const baseAnalysis = {
  version: '1', projectId: 'p1', supportingPassages: [], mainPoints: [], title: 'Title', shortSummary: 'Summary', targetAudience: 'All', primaryTone: 'Reverent', pastoralGoals: [], overallSummary: 'Summary'
} as unknown as SermonAnalysis;

async function run() {
  const checks: string[] = [];

  const s1: SermonSection = {
    ...baseSection,
    editorialIntent: 'USE_CONTEXTUAL_VISUAL',
    reason: 'Contextual B-roll enhances comprehension.',
    visualRecommendation: 'speaker-full'
  };
  assert.equal(validateDecisionConsistency(s1), false);
  checks.push('HIGH story + contextual-B-roll rationale + speaker-full => contradiction');

  const analysis1: SermonAnalysis = { ...baseAnalysis, sections: [s1], confidence: 0.9 };
  const q1 = evaluateDirectorQuality(analysis1);
  assert.ok(q1.enrichmentTriggered);
  assert.ok(q1.enrichmentTriggerReasons.includes('DECISION_CONTRADICTION'));
  checks.push('contradiction triggers enrichment');

  const s2: SermonSection = {
    ...baseSection,
    editorialIntent: 'VISUAL_RESET',
    reason: 'Let us just stay here.',
    visualRecommendation: 'speaker-full'
  };
  const analysis2: SermonAnalysis = { ...baseAnalysis, sections: [s2], confidence: 0.9 };
  const q2 = evaluateDirectorQuality(analysis2);
  assert.ok(q2.enrichmentTriggered);
  assert.ok(q2.enrichmentTriggerReasons.includes('UNTREATED_STORY'));
  checks.push('one untreated story triggers enrichment');

  const s3: SermonSection = {
    ...baseSection,
    id: 'section-2',
    type: 'main-point',
    editorialIntent: 'SHOW_KEY_TEXT',
    reason: 'A point.',
    visualRecommendation: 'keyword-graphic',
    start: 20,
    end: 30
  };
  const s3b: SermonSection = {
    ...baseSection,
    id: 'section-3',
    type: 'illustration',
    editorialIntent: 'SHOW_KEY_TEXT',
    reason: 'A point.',
    visualRecommendation: 'caption',
    start: 30,
    end: 40
  };
  const analysis3: SermonAnalysis = { ...baseAnalysis, sections: [s2, s3, s3b], confidence: 0.9 };
  const q3 = evaluateDirectorQuality(analysis3);
  assert.ok(q3.enrichmentTriggered);
  assert.ok(q3.enrichmentTriggerReasons.includes('UNTREATED_STORY'));
  assert.ok(!q3.enrichmentTriggerReasons.includes('LOW_ACTIVITY'));
  checks.push('graphics elsewhere cannot mask untreated story');

  const s4: SermonSection = {
    ...baseSection,
    editorialIntent: 'PRESERVE_SPEAKER',
    reason: 'This personal testimony depends on facial emotion and direct pastoral presence; contextual B-roll would reduce emotional authenticity.',
    visualRecommendation: 'speaker-full'
  };
  assert.equal(determineStoryTreatment(s4), 'deliberate-speaker-led');
  const analysis4: SermonAnalysis = { ...baseAnalysis, sections: [s3, s3b, s4], confidence: 0.9 };
  const q4 = evaluateDirectorQuality(analysis4);
  assert.equal(q4.enrichmentTriggered, false);
  checks.push('deliberate speaker-led story does not falsely trigger');

  console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
