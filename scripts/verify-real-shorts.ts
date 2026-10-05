import { config } from 'dotenv';
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { ProductProjectStore } from '../src/product-store.ts';
import { createRemotionRenderAdapter } from '../src/product-renderer.ts';

const appRoot = resolve(import.meta.dirname, '..');
config({ path: resolve(appRoot, '.env') });
config({ path: resolve(appRoot, '.env.local') });

const store = new ProductProjectStore(resolve(appRoot, '.runtime/projects'));
const orchestrator = new ProductOrchestrator(store, appRoot, { render: createRemotionRenderAdapter(appRoot) });
await orchestrator.initialize();

async function run() {
  const url = process.argv[2] || 'https://www.youtube.com/watch?v=NiKtZgImdlY';
  console.log(`Creating project for URL: ${url}`);
  
  const project = await orchestrator.createProject({
    title: 'Shorts E2E Test',
    source: { type: 'youtube-url', url, ingestionAvailable: true },
    outputTarget: 'shorts'
  });
  
  const projectId = project.workflow.projectId;
  console.log(`Created project ${projectId}`);
  
  console.log('Starting ingest...');
  await orchestrator.startStage(projectId, 'ingest');
  await orchestrator.waitForStage(projectId, 'ingest');
  
  console.log('Starting transcript...');
  await orchestrator.startStage(projectId, 'transcript');
  await orchestrator.waitForStage(projectId, 'transcript');
  
  console.log('Starting director (shorts extraction)...');
  await orchestrator.startStage(projectId, 'director');
  await orchestrator.waitForStage(projectId, 'director');
  
  // Read workspace
  const workspacePath = resolve(store.projectDirectory(projectId), 'artifacts/review-workspace.json');
  const workspaceStr = await readFile(workspacePath, 'utf8');
  const workspace = JSON.parse(workspaceStr);
  
  if (!workspace?.shorts || workspace.shorts.length === 0) {
    throw new Error('No shorts extracted!');
  }
  
  console.log(`Extracted ${workspace.shorts.length} shorts!`);
  
  // Use the same independent human-review operation as the application UI.
  const shortsToRender = workspace.shorts.slice(0, 3);
  for (const short of shortsToRender) {
    console.log(`Approving short ${short.id} (${short.title})...`);
    await orchestrator.reviewShort(projectId, short.id, true);
    console.log(`Rendering short ${short.id} (${short.title})...`);
    await orchestrator.startStage(projectId, 'render', { shortId: short.id });
    await orchestrator.waitForStage(projectId, 'render', { shortId: short.id });
    console.log(`Render complete for short ${short.id}.`);
  }
  
  console.log('All done!');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
