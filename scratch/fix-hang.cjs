const fs = require('fs');
let content = fs.readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');
content = content.replace(
  "  let finalProj = await store.get(projectId);\n  while(finalProj.workflow.stages.qa.status !== 'completed' && finalProj.workflow.stages.qa.status !== 'failed') {",
  "  await orchestrator.startStage(projectId, 'qa');\n  let finalProj = await store.get(projectId);\n  while(finalProj.workflow.stages.qa.status !== 'completed' && finalProj.workflow.stages.qa.status !== 'failed') {"
);
fs.writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
