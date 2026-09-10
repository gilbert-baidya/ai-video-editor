import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { ProductProjectStore } from '../src/product-store.ts';
import { sha256Browser } from '../src/sha256.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { createRemotionRenderAdapter } from '../src/product-renderer.ts';

async function main() {
  const appRoot = resolve(process.cwd());
  const store = new ProductProjectStore(resolve(appRoot, '.runtime', 'projects'));
  
  console.log('Fetching capabilities to ensure dependencies exist...');
  const orchestrator = new ProductOrchestrator(store, appRoot, {
    render: createRemotionRenderAdapter(appRoot)
  });
  
  console.log('\\n--- Creating Project ---');
  let brollDecision = null;
  let projectId = '';
  let reviewData = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    const project = await orchestrator.createProject({
      title: `V1.3.5 Real E2E Closure Attempt ${attempt}`,
      source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true }
    });
    projectId = project.workflow.projectId;
    console.log(`Attempt ${attempt} Project ID: ${projectId}`);
    
    let proj = await store.get(projectId);
    console.log('\\n--- Starting Ingest ---');
    await orchestrator.startStage(projectId, 'ingest');
    while (proj.workflow.stages.ingest.status !== 'completed' && proj.workflow.stages.ingest.status !== 'failed') {
      await new Promise(r => setTimeout(r, 2000));
      proj = await store.get(projectId);
    }
    if (proj.workflow.stages.ingest.status === 'failed') throw new Error(proj.workflow.stages.ingest.error);
    
    console.log('\\n--- Starting Transcript ---');
    await orchestrator.startStage(projectId, 'transcript');
    while (proj.workflow.stages.transcript.status !== 'completed' && proj.workflow.stages.transcript.status !== 'failed') {
      await new Promise(r => setTimeout(r, 5000));
      proj = await store.get(projectId);
    }
    if (proj.workflow.stages.transcript.status === 'failed') throw new Error(proj.workflow.stages.transcript.error);

    console.log('\\n--- Starting Director ---');
    await orchestrator.startStage(projectId, 'director');
    while (proj.workflow.stages.director.status !== 'completed' && proj.workflow.stages.director.status !== 'failed') {
      await new Promise(r => setTimeout(r, 5000));
      proj = await store.get(projectId);
    }
    if (proj.workflow.stages.director.status === 'failed') {
      console.log('Director failed. Retrying whole pipeline...');
      continue;
    }
    
    try {
      reviewData = JSON.parse(readFileSync(resolve(store.artifactDirectory(projectId), 'review-workspace.json'), 'utf8'));
      brollDecision = reviewData.beats.find((b: any) => b.section.type === 'story' || b.originalOperation?.visualType === 'image-broll');
      if (brollDecision) {
        console.log('Found story/image-broll beat!');
        break;
      }
    } catch (e) {}
    console.log('No story beat found. Retrying...');
  }
  
  if (!brollDecision) throw new Error('Could not find story/image-broll beat in review workspace after 3 attempts');

  console.log('\\n--- Importing Asset ---');
  const peterAssetPath = '/Users/gilbert.baidya/.gemini/antigravity/brain/020fc799-ee18-4707-aa7e-b20a687164ff/peter_prison_1789016090350.jpg';
  const asset = await orchestrator.importLocalAsset(projectId, {
    path: peterAssetPath,
    description: 'Peter in prison',
    rightsStatus: 'approved',
    rightsBasis: 'generated'
  });
  console.log('Imported Asset:', asset.id);
  
  console.log('\\n--- Saving Review ---');
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
          id: brollDecision.originalOperation.id,
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
  console.log('Blockers:', savedProj.workflow.unresolvedBlockers);
  if (savedProj.workflow.stages.review.status !== 'completed') throw new Error('Review failed to complete');
  
  console.log('\\n--- Rendering ---');
  let proj = await store.get(projectId);
  while (proj.workflow.stages.render.status !== 'completed' && proj.workflow.stages.render.status !== 'failed') {
    await new Promise(r => setTimeout(r, 5000));
    proj = await store.get(projectId);
    console.log(`Render Progress: ${proj.workflow.stages.render.progress}%`);
  }
  
  if (proj.workflow.stages.render.status === 'failed') throw new Error('Render failed: ' + proj.workflow.stages.render.error);
  
  console.log('\\n--- QA ---');
  while (proj.workflow.stages.qa.status !== 'completed' && proj.workflow.stages.qa.status !== 'failed') {
    await new Promise(r => setTimeout(r, 2000));
    proj = await store.get(projectId);
  }
  
  if (proj.workflow.stages.qa.status === 'failed') throw new Error('QA failed: ' + proj.workflow.stages.qa.error);
  
  console.log('QA Passed:', proj.qa?.video);
  console.log('Realized Operations:', proj.qa?.editorial?.realization?.renderedOperations);
  console.log('Output File:', proj.output?.relativePath);
  
  console.log('\\n--- E2E Closure Complete ---');
}
main().catch(console.error);
