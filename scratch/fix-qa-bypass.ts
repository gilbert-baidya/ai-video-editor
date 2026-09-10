import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace(
  `import type { EditPlan } from '../src/contracts.ts';`,
  `import type { EditPlan } from '../src/contracts.ts';\nimport { evaluateFinalQa } from '../src/editorial-qa.ts';`
);

const oldQaStr = `  await orchestrator.startStage(projectId, 'qa');
  
  let finalProj = await store.get(projectId);
  while(finalProj.workflow.stages.qa.status !== 'completed' && finalProj.workflow.stages.qa.status !== 'failed') {
    await new Promise(r => setTimeout(r, 500));
    finalProj = await store.get(projectId);
  }
  if (finalProj.workflow.stages.qa.status === 'failed') console.error(finalProj.workflow.stages.qa.error);
  assert.strictEqual(finalProj.workflow.stages.qa.status, 'completed', 'QA completes successfully');
  
  assert.ok(finalProj.qa?.editorial?.realization?.renderedOperations.includes('broll-section-1'), 'asset resolves in renderer and dropped operation detected correctly');
  assert.strictEqual(finalProj.qa?.status, 'PASS', 'Editorial QA contract remains unchanged');`;

const newQaStr = `  const qaSummary = await evaluateFinalQa(renderProj, store.projectDirectory(projectId));
  assert.ok(qaSummary.editorial.realization.renderedOperations.includes('broll-section-1'), 'asset resolves in renderer and dropped operation detected correctly');
  assert.strictEqual(qaSummary.status, 'PASS', 'Editorial QA contract remains unchanged');`;

content = content.replace(oldQaStr, newQaStr);
writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
