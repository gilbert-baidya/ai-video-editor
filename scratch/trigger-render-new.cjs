const { ProductProjectStore } = require('../src/product-store.ts');
const { ProductOrchestrator } = require('../src/product-orchestrator.ts');
const { createRemotionRenderAdapter } = require('../src/product-renderer.ts');
const { resolve } = require('path');

async function main() {
  const appRoot = resolve(process.cwd());
  const store = new ProductProjectStore(resolve(appRoot, '.runtime', 'projects'));
  const orchestrator = new ProductOrchestrator(store, appRoot, {
    render: createRemotionRenderAdapter(appRoot)
  });
  
  const projectId = 'project-fc5ca7f3-7844-4d46-aa7b-ee8e548c3531'; // The new one
  
  console.log('Triggering render for', projectId);
  await orchestrator.startStage(projectId, 'render');
  
  let proj = await store.get(projectId);
  while (proj.workflow.stages.render.status !== 'completed' && proj.workflow.stages.render.status !== 'failed') {
    await new Promise(r => setTimeout(r, 2000));
    proj = await store.get(projectId);
    console.log(`Render Progress: ${proj.workflow.stages.render.progress}%`);
  }
  console.log('Final Status:', proj.workflow.stages.render.status);
  if (proj.workflow.stages.render.error) console.log('Error:', proj.workflow.stages.render.error);
}

main().catch(console.error);
