import { resolve } from 'path';
import { readFileSync } from 'fs';
import { ProductProjectStore } from '../src/product-store.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { createRemotionRenderAdapter } from '../src/product-renderer.ts';

async function main() {
  const appRoot = resolve(process.cwd());
  const store = new ProductProjectStore(resolve(appRoot, '.runtime', 'projects-test-suite'));
  const orchestrator = new ProductOrchestrator(store, appRoot, {
    render: createRemotionRenderAdapter({} as any)
  });

  for (let i = 1; i <= 3; i++) {
    console.log(`\\n--- RUN ${i} ---`);
    const project = await orchestrator.createProject({
      title: `V1.3.5 Benchmark Run ${i}`,
      source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true }
    });
    
    let currentProj = await store.get(project.workflow.projectId);
    console.log(`Project ID: ${project.workflow.projectId}`);
    
    // Wait for director stage
    while (currentProj.workflow.stages.director.status !== 'completed' && currentProj.workflow.stages.director.status !== 'failed') {
      await new Promise(r => setTimeout(r, 2000));
      currentProj = await store.get(project.workflow.projectId);
    }
    
    if (currentProj.workflow.stages.director.status === 'failed') {
      console.log('Director failed:', currentProj.workflow.stages.director.error);
    } else {
      const directorJson = JSON.parse(readFileSync(resolve(store.artifactDirectory(project.workflow.projectId), 'director.json'), 'utf8'));
      console.log('Semantic Types:');
      directorJson.operations.forEach((op: any) => {
        console.log(`- ${op.visualType}: ${op.reason} (Primary: ${op.reason.includes('story') ? 'story' : 'unknown'}) - Wait, the plan only has visual output.`);
      });
      
      const workspace = JSON.parse(readFileSync(resolve(store.artifactDirectory(project.workflow.projectId), 'review-workspace.json'), 'utf8'));
      console.log('Beats Semantics:');
      workspace.beats.forEach((b: any) => {
         console.log(`- Type: ${b.section.type}, Secondary: ${b.section.secondaryType}, Evid: ${b.section.semanticEvidence}`);
      });
    }
  }
}

main().catch(console.error);
