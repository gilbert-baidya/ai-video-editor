import { resolve } from 'path';
import { readFileSync, copyFileSync, writeFileSync, mkdirSync } from 'fs';
import { ProductProjectStore } from '../src/product-store.ts';
import { sha256Browser } from '../src/sha256.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { createRemotionRenderAdapter } from '../src/product-renderer.ts';
import { loadEnv } from '../src/env.ts';

async function main() {
  const appRoot = resolve(process.cwd());
  loadEnv(appRoot);
  const store = new ProductProjectStore(resolve(appRoot, '.runtime', 'projects'));
  
  const orchestrator = new ProductOrchestrator(store, appRoot, {
    render: createRemotionRenderAdapter(appRoot)
  });
  
  console.log('\n--- Creating Project ---');
  let projectId = '';
  let brollDecision: any = null;
  let reviewData: any = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const project = await orchestrator.createProject({
      title: `V1.3.6 Gemini Primary E2E Attempt ${attempt}`,
      source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true }
    });
    projectId = project.workflow.projectId;
    console.log(`\nAttempt ${attempt} Project ID: ${projectId}`);
    
    console.log('--- Seeding Artifacts from Baseline ---');
    const baselineDir = resolve(appRoot, '.runtime', 'projects', 'project-fc5ca7f3-7844-4d46-aa7b-ee8e548c3531', 'artifacts');
    const baselineProj = await store.get('project-fc5ca7f3-7844-4d46-aa7b-ee8e548c3531');
    const newDir = store.artifactDirectory(projectId);
    mkdirSync(newDir, { recursive: true });
    
    const baselineTranscript = JSON.parse(readFileSync(resolve(baselineDir, 'transcript.json'), 'utf8'));
    baselineTranscript.projectId = projectId;
    writeFileSync(resolve(newDir, 'transcript.json'), JSON.stringify(baselineTranscript));
    try { copyFileSync(resolve(baselineDir, 'source-16khz.wav'), resolve(newDir, 'source-16khz.wav')); } catch (e) {}
    
    
    const baselineSourceDir = resolve(appRoot, '.runtime', 'projects', 'project-fc5ca7f3-7844-4d46-aa7b-ee8e548c3531', 'source');
    const newSourceDir = resolve(appRoot, '.runtime', 'projects', projectId, 'source');
    mkdirSync(newSourceDir, { recursive: true });
    try { copyFileSync(resolve(baselineSourceDir, 'lPN9AWaTuEc.mp4'), resolve(newSourceDir, 'lPN9AWaTuEc.mp4')); } catch (e) {}

    let proj = await store.get(projectId);
    proj.workflow.stages.ingest.status = 'completed';
    proj.workflow.stages.transcript.status = 'completed';
    proj.artifacts.transcript = 'artifacts/transcript.json';
            proj.sourceMetadata = baselineProj.sourceMetadata;
    await store.save(proj);


    console.log('--- Starting Director ---');
    await orchestrator.startStage(projectId, 'director');
    while (proj.workflow.stages.director.status !== 'completed' && proj.workflow.stages.director.status !== 'failed') {
      await new Promise(r => setTimeout(r, 2000));
      proj = await store.get(projectId);
    }
    if (proj.workflow.stages.director.status === 'failed') {
      console.log('Director failed, retrying...');
      continue;
    }
    
    reviewData = JSON.parse(readFileSync(resolve(newDir, 'review-workspace.json'), 'utf8'));
    brollDecision = reviewData.beats.find((b: any) => b.section.type === 'story' || b.originalOperation?.visualType === 'image-broll');
    
    if (brollDecision) {
      console.log('Found story/image-broll beat!');
      break;
    }
    console.log('No story/image-broll beat found. Retrying...');
  }
  
  if (!brollDecision) throw new Error('Could not find story/image-broll beat after 5 attempts.');

  console.log('\n--- Importing Asset ---');
  const peterAssetPath = '/Users/gilbert.baidya/.gemini/antigravity/brain/020fc799-ee18-4707-aa7e-b20a687164ff/peter_prison_1789016090350.jpg';
  const asset = await orchestrator.importLocalAsset(projectId, {
    path: peterAssetPath,
    description: 'Peter in prison',
    rightsStatus: 'approved',
    rightsBasis: 'generated'
  });
  console.log('Imported Asset:', asset.id);
  
  console.log('\n--- Saving Review ---');
  const reviewPayload = {
    schemaVersion: '1.0',
    projectId: projectId,
    sourceEditPlanHash: sha256Browser(JSON.stringify(reviewData.aiPlan)),
    updatedAt: new Date().toISOString(),
    decisions: [
      {
        beatId: brollDecision.section.id,
        status: 'modified',
        originalProvenance: brollDecision.provenance?.source || 'ai',
        provenance: 'human-override',
        resolution: 'manual-broll-replacement',
        reviewedOperation: {
          id: brollDecision.originalOperation?.id || 'op-1',
          type: 'broll',
          sourceStart: brollDecision.section.start,
          sourceEnd: brollDecision.section.end,
          start: brollDecision.section.start,
          end: brollDecision.section.end,
          assetId: asset.id,
          mode: 'full-screen',
          muted: true,
          reason: 'Manual review',
          confidence: 1.0
        }
      }
    ]
  };
  
  const savedProj = await orchestrator.saveReview(projectId, reviewPayload as any);
  console.log('Review Saved Status:', savedProj.workflow.stages.review.status);
  if (savedProj.workflow.stages.review.status !== 'completed') throw new Error('Review failed to complete');
  
  console.log('\n--- Rendering ---');
  let proj = await store.get(projectId);
  await orchestrator.startStage(projectId, 'render');
  while (proj.workflow.stages.render.status !== 'completed' && proj.workflow.stages.render.status !== 'failed') {
    await new Promise(r => setTimeout(r, 5000));
    proj = await store.get(projectId);
    console.log(`Render Progress: ${proj.workflow.stages.render.progress}%`);
  }
  
  if (proj.workflow.stages.render.status === 'failed') throw new Error('Render failed: ' + proj.workflow.stages.render.error);
  
  console.log('\n--- QA ---');
  while (proj.workflow.stages.qa.status !== 'completed' && proj.workflow.stages.qa.status !== 'failed') {
    await new Promise(r => setTimeout(r, 2000));
    proj = await store.get(projectId);
  }
  
  if (proj.workflow.stages.qa.status === 'failed') throw new Error('QA failed: ' + proj.workflow.stages.qa.error);
  
  console.log('QA Passed:', proj.qa?.video);
  console.log('Output File:', proj.output?.relativePath);
  console.log('\n--- E2E Closure Complete ---');
}
main().catch(console.error);
