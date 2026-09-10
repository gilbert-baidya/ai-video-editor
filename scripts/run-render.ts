import { resolve } from 'path';
import { ProductProjectStore } from '../src/product-store.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { createRemotionRenderAdapter } from '../src/product-renderer.ts';
import { loadEnv } from '../src/env.ts';

async function run() {
  const appRoot = resolve(process.cwd());
  loadEnv(appRoot);
  const store = new ProductProjectStore(resolve(appRoot, '.runtime', 'projects'));
  
  const orchestrator = new ProductOrchestrator(store, appRoot, {
    render: createRemotionRenderAdapter(appRoot)
  });

  const projectId = 'project-1e2e45fb-e6bc-453e-8071-13ca7c00ff05'; 
  console.log('Running Render & QA...');
  await orchestrator.startStage(projectId, 'render');
  
  let proj = await store.get(projectId);
  while (proj.workflow.stages.render.status !== 'completed' && proj.workflow.stages.render.status !== 'failed') {
    await new Promise(r => setTimeout(r, 5000));
    proj = await store.get(projectId);
  }

  console.log('QA Result:', JSON.stringify(proj.qa, null, 2));
}
run().catch(console.error);
