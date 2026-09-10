const fs = require('fs');
let content = fs.readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

const oldRender = `  let renderProj = await store.get(projectId);
  renderProj.workflow.stages.render = { status: 'completed', progress: 100, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
  await store.save(renderProj);`;

const newRender = `  await orchestrator.startStage(projectId, 'render');
  let renderProj = await store.get(projectId);
  while(renderProj.workflow.stages.render.status !== 'completed' && renderProj.workflow.stages.render.status !== 'failed') {
    await new Promise(r => setTimeout(r, 500));
    renderProj = await store.get(projectId);
  }`;

content = content.replace(oldRender, newRender);
fs.writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
