const fs = require('fs');
let content = fs.readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

const strToReplace = `  const qaSummary = await evaluateFinalQa(renderProj, store.projectDirectory(projectId));
  assert.ok(qaSummary.editorial.realization.renderedOperations.includes('broll-section-1'), 'asset resolves in renderer and dropped operation detected correctly');
  assert.strictEqual(qaSummary.status, 'PASS', 'Editorial QA contract remains unchanged');`;

const replacement = `  let finalProj = await store.get(projectId);
  while(finalProj.workflow.stages.qa.status !== 'completed' && finalProj.workflow.stages.qa.status !== 'failed') {
    await new Promise(r => setTimeout(r, 500));
    finalProj = await store.get(projectId);
  }
  if (finalProj.workflow.stages.qa.status === 'failed') console.error(finalProj.workflow.stages.qa.error);
  assert.strictEqual(finalProj.workflow.stages.qa.status, 'completed', 'QA completes successfully');
  
  assert.ok(finalProj.qa?.editorial?.realization?.renderedOperations.includes('broll-section-1'), 'asset resolves in renderer and dropped operation detected correctly');
  assert.strictEqual(finalProj.qa?.status, 'PASS', 'Editorial QA contract remains unchanged');`;

content = content.replace(strToReplace, replacement);

// And we still need to replace `let renderProj = await store.get(projectId); ...` because that skipped `orchestrator.startStage('render')`
const oldRender = `  // Render
  // we mock output so qa can find it
  writeFileSync(resolve(store.projectDirectory(projectId), 'output/final-sermon.mp4'), 'mock-video-content');
  // write trace so QA thinks broll was rendered
  writeFileSync(resolve(store.projectDirectory(projectId), 'output/trace.json'), JSON.stringify({ renderedOperations: ['broll-section-1'] }));
  
  let renderProj = await store.get(projectId);
  renderProj.workflow.stages.render = { status: 'completed', progress: 100, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
  await store.save(renderProj);
  
  // Because startStage launches a sub-process we will just directly invoke QA logic or just use startStage and wait for background to finish since render is 'completed'
  // But wait, the mock renderer returns \`true\`, and it updates the stage in the worker. We can just set it to completed!
  
  await orchestrator.startStage(projectId, 'qa');`;

const newRender = `  // Render
  // we mock output so qa can find it
  writeFileSync(resolve(store.projectDirectory(projectId), 'output/final-sermon.mp4'), 'mock-video-content');
  await orchestrator.startStage(projectId, 'render');`;
  
content = content.replace(oldRender, newRender);

fs.writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
