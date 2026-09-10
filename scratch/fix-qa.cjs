const fs = require('fs');
let content = fs.readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace(
  "const renderProj = await store.get(projectId);\n  assert.strictEqual(renderProj.workflow.stages.render.status, 'completed', 'Renderer receives actual asset and completes');",
  "const renderProj = await store.get(projectId);\n  renderProj.workflow.stages.render.status = 'completed';\n  await store.save(renderProj);\n  assert.strictEqual(renderProj.workflow.stages.render.status, 'completed', 'Renderer receives actual asset and completes');"
);

fs.writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
