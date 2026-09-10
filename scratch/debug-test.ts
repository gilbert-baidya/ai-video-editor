import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace(
  `assert.strictEqual(savedUnknown.workflow.stages.review.status, 'running', 'Unknown rights asset cannot be approved in Review');`,
  `console.log("BLOCKERS:", savedUnknown.workflow.unresolvedBlockers); assert.strictEqual(savedUnknown.workflow.stages.review.status, 'running', 'Unknown rights asset cannot be approved in Review');`
);

writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
