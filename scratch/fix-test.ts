import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace(
  `  await assert.rejects(
    orchestrator.saveReview(projectId, reviewUnknown),
    /Cannot use unapproved media/i,
    'Unknown rights asset cannot be approved in Review'
  );`,
  `  const savedUnknown = await orchestrator.saveReview(projectId, reviewUnknown);
  assert.strictEqual(savedUnknown.workflow.stages.review.status, 'running', 'Unknown rights asset cannot be approved in Review');
  assert.ok(savedUnknown.workflow.unresolvedBlockers.some(b => b.includes('selected media rights require review')), 'Rights blocker is present');`
);

content = content.replace(
  `  await assert.rejects(
    orchestrator.saveReview(projectId, reviewMissing),
    /Asset media-nonexistent not found/i,
    'Missing asset blocks Review approval'
  );`,
  `  const savedMissing = await orchestrator.saveReview(projectId, reviewMissing);
  assert.strictEqual(savedMissing.workflow.stages.review.status, 'running', 'Missing asset blocks Review approval');
  assert.ok(savedMissing.workflow.unresolvedBlockers.some(b => b.includes('missing from the media index')), 'Missing asset blocker is present');`
);

writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
