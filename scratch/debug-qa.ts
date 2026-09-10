import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace(
  `assert.strictEqual(finalProj.workflow.stages.qa.status, 'completed', 'QA completes successfully');`,
  `if (finalProj.workflow.stages.qa.status === 'failed') console.error(finalProj.workflow.stages.qa.error);\n  assert.strictEqual(finalProj.workflow.stages.qa.status, 'completed', 'QA completes successfully');`
);

writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
