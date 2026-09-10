const fs = require('fs');
let content = fs.readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace("import type { EditPlan } from '../src/contracts.ts';", "import type { EditPlan } from '../src/contracts.ts';\nimport { evaluateFinalQa } from '../src/editorial-qa.ts';");

const qaIndex = content.indexOf('await orchestrator.startStage(projectId, \\'qa\\');');
if (qaIndex !== -1) {
  content = content.substring(0, qaIndex) + `  const qaSummary = await evaluateFinalQa(renderProj, store.projectDirectory(projectId));
  assert.ok(qaSummary.editorial.realization.renderedOperations.includes('broll-section-1'), 'asset resolves in renderer and dropped operation detected correctly');
  assert.strictEqual(qaSummary.status, 'PASS', 'Editorial QA contract remains unchanged');\n  console.log('All V1.3.4 deterministic realization assertions PASSED.');\n}\n\nmain().catch(e => { console.error(e); process.exit(1); });`;
}

fs.writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
