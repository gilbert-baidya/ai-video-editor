import { resolve, join } from 'path';
import { copyFile, mkdir, readFile } from 'fs/promises';
import { ProductProjectStore } from '../src/product-store.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { createRemotionRenderAdapter } from '../src/product-renderer.ts';
import { loadEnv } from '../src/env.ts';
import { writeJson, sha256 } from '../src/foundation.ts';

async function run() {
  const appRoot = resolve(process.cwd());
  loadEnv(appRoot);
  const store = new ProductProjectStore(resolve(appRoot, '.runtime', 'projects'));
  
  const orchestrator = new ProductOrchestrator(store, appRoot, {
    render: createRemotionRenderAdapter(appRoot)
  });

  const projectId = 'project-1e2e45fb-e6bc-453e-8071-13ca7c00ff05'; 
  console.log(`Resuming Project: ${projectId}`);
  
  const destWorkspace = join(process.cwd(), '.runtime', 'projects', projectId);
  const artifactsDir = join(destWorkspace, 'artifacts');

  console.log('Running Review Workspace & Injecting B-roll asset...');
  
  const asset = await orchestrator.importLocalAsset(projectId, {
    path: '/Users/gilbert.baidya/.gemini/antigravity/brain/020fc799-ee18-4707-aa7e-b20a687164ff/ancient_king_famine_1789077924966.jpg',
    description: 'An ancient biblical king in royal robes standing over a desperate city facing severe famine',
    rightsStatus: 'approved',
    rightsBasis: 'generated',
    categories: ['illustration'],
    tags: ['ancient', 'king', 'famine', 'desperate', 'city'],
  });

  const reviewPath = join(artifactsDir, 'review-workspace.json');
  const rwData = JSON.parse(await readFile(reviewPath, 'utf8'));
  
  const decisions: any[] = [];
  for (const beat of rwData.beats) {
    if (beat.originalOperation.type === 'broll') {
      decisions.push({
        beatId: beat.section.id,
        action: 'replace',
        operation: {
          ...beat.originalOperation,
          assetId: asset.id,
          sourcePath: '/Users/gilbert.baidya/.gemini/antigravity/brain/020fc799-ee18-4707-aa7e-b20a687164ff/ancient_king_famine_1789077924966.jpg', 
          framing: 'contain'
        }
      });
    } else {
      decisions.push({ beatId: beat.section.id, action: 'accept' });
    }
  }

  const reviewPayload = {
    schemaVersion: '1.0',
    projectId: rwData.projectId,
    sourceEditPlanHash: sha256(JSON.stringify(rwData.aiPlan)),
    decisions,
    reviewCompletedAt: new Date().toISOString(),
    mediaIndexSnapshot: { schemaVersion: '1.0', indexerVersion: 'v1', createdAt: '', updatedAt: '', roots: [], assets: [asset] }
  };
  
    await orchestrator.saveReview(projectId, reviewPayload as any);

  console.log('Running Render & QA...');
  await orchestrator.startStage(projectId, 'render');
  
  let proj = await store.get(projectId);
  while (proj.workflow.stages.render.status !== 'completed' && proj.workflow.stages.render.status !== 'failed') {
    await new Promise(r => setTimeout(r, 5000));
    proj = await store.get(projectId);
  }

  console.log('QA Result:', JSON.stringify(proj.qa, null, 2));
  console.log('Video Path:', resolve(artifactsDir, 'render.mp4'));
}
run().catch(console.error);
