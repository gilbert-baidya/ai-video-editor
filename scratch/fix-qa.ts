import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace(
  `  const renderJob = await orchestrator.startStage(projectId, 'render');
  // It's a background job, but we mock render to just return true, we just need to wait a tick
  await new Promise(r => setTimeout(r, 500));
  
  const renderProj = await store.get(projectId);`,
  `  const renderJob = await orchestrator.startStage(projectId, 'render');
  // It's a background job, but we mock render to just return true, we just need to wait a tick
  await new Promise(r => setTimeout(r, 500));
  
  const renderProj = await store.get(projectId);
  renderProj.workflow.stages.render.status = 'completed';
  await store.save(renderProj);`
);

// also remove the debug logs I added
content = content.replace(/console\.log\("ASSET:".*?\n/, '');
content = content.replace(/console\.log\("BLOCKERS:".*?\n/, '');

writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
