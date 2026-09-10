import assert from 'assert';
import { determineStoryTreatment } from '../src/editorial-opportunity.ts';
import type { SermonSection } from '../src/contracts.ts';
import { validateClassificationAmbiguity, evaluateSemanticStability } from '../src/director.ts';

async function main() {
  const storyPrimary: SermonSection = {
    id: '1', start: 0, end: 10, transcriptText: 'text', sourceSegmentIds: [],
    type: 'story', secondaryType: 'main-point', semanticConfidence: 1, semanticEvidence: 'evidence', reason: 'r', confidence: 1
  };
  assert.notStrictEqual(determineStoryTreatment(storyPrimary), 'not-a-story', 'story + main-point receives story opportunity');

  const storySecondary: SermonSection = {
    id: '2', start: 0, end: 10, transcriptText: 'text', sourceSegmentIds: [],
    type: 'main-point', secondaryType: 'story', semanticConfidence: 1, semanticEvidence: 'evidence', reason: 'r', confidence: 1
  };
  assert.notStrictEqual(determineStoryTreatment(storySecondary), 'not-a-story', 'main-point + story receives story opportunity');
  
  const ambiguous = validateClassificationAmbiguity({
    type: 'main-point', semanticEvidence: 'This section recounts the events of Paul traveling to Rome.'
  });
  assert.strictEqual(ambiguous, true, 'ambiguous narrative classification detected');
  
  const notAmbiguous = validateClassificationAmbiguity({
    type: 'main-point', semanticEvidence: 'The pastor explains three theological points.'
  });
  assert.strictEqual(notAmbiguous, false, 'unambiguous classification passes');
  
  const run1 = { type: 'story', secondaryType: 'main-point' };
  const run2 = { type: 'main-point', secondaryType: 'story' };
  const run3 = { type: 'prayer' };
  
  assert.strictEqual(evaluateSemanticStability(run1, run1), 'STABLE', 'stable classification accepted');
  assert.strictEqual(evaluateSemanticStability(run1, run2), 'COMPATIBLE_VARIATION', 'compatible variation accepted');
  assert.strictEqual(evaluateSemanticStability(run1, run3), 'UNSTABLE', 'incompatible variation flagged');
  
  console.log('PASS');
}
main().catch(e => { console.error(e); process.exit(1); });
