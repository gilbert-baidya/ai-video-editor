import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace(
  `  await orchestrator.startStage(projectId, 'qa');`,
  `  let rp = await store.get(projectId);
  if (rp.workflow.stages.render.status === 'failed') throw new Error(rp.workflow.stages.render.error);
  await orchestrator.startStage(projectId, 'qa');`
);

writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
