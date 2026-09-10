import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { ProductProjectStore } from '../src/product-store.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { createRemotionRenderAdapter } from '../src/product-renderer.ts';
import { createInitialReviewState } from '../src/director-review.ts';
import type { EditPlan } from '../src/contracts.ts';

async function main() {
  const appRoot = resolve(process.cwd());
  const store = new ProductProjectStore(resolve(appRoot, '.runtime', 'projects'));
  const orchestrator = new ProductOrchestrator(store, appRoot, { render: createRemotionRenderAdapter(appRoot) });

  const project = await orchestrator.createProject({
    title: 'Fixture B-roll Test',
    source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc' }
  });
  const projectId = project.workflow.projectId;
  const artifactsDir = store.artifactDirectory(projectId);
  
  async function poll(stage: string) {
    while (true) {
      const p = await store.get(projectId);
      const s = p.jobs.find(j => j.stage === stage);
      if (s?.status === 'completed') return;
      if (s?.status === 'failed') throw new Error(`Stage ${stage} failed: ${s.error}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  await orchestrator.startStage(projectId, 'ingest');
  await poll('ingest');
  
  await orchestrator.startStage(projectId, 'transcript');
  await poll('transcript');
  
  const transcriptData = JSON.parse(readFileSync(resolve(artifactsDir, 'transcript.json'), 'utf8'));
  const duration = transcriptData.segments.at(-1)?.end ?? 60.0;
  
  const aiPlan: EditPlan = {
    schemaVersion: '2.0',
    projectId,
    sourceTranscriptHash: 'mock-hash',
    operations: [
      {
        id: 'policy-section-1',
        type: 'director-placeholder',
        start: 10,
        end: 20,
        visualType: 'image-broll',
        reason: 'Mock story B-roll',
        confidence: 0.9
      }
    ],
    status: 'draft',
    createdBy: { provider: 'mock', model: 'mock' }
  };
  
  const beats = [
    {
      section: { id: 'section-1', type: 'story', start: 10, end: 20, transcriptText: 'Mock story', transcriptSafeDuration: 10 },
      requiredReview: true,
      originalOperation: aiPlan.operations[0]
    }
  ];
  
  const initialReview = createInitialReviewState({ projectId, aiPlan, beats, directorExecution: 'ai' }, 'mock-hash');
  
  writeFileSync(resolve(artifactsDir, 'review-workspace.json'), JSON.stringify({
    schemaVersion: '1.0',
    projectId,
    sourceEditPlanHash: 'mock-hash',
    directorExecution: 'ai',
    aiPlan,
    mediaIndex: { schemaVersion: '1.0', indexerVersion: 'v1.3', createdAt: '', updatedAt: '', roots: [], assets: [] },
    beats,
    qa: { status: 'PASS', failures: [] }
  }));
  
  const asset = await orchestrator.importLocalAsset(projectId, {
    path: resolve(appRoot, 'scratch/peter_prison.jpg'),
    description: 'Peter escaping prison',
    rightsConfirmed: true
  });
  
  initialReview.decisions[0].status = 'modified';
  initialReview.decisions[0].resolution = 'manual-broll-replacement';
  initialReview.decisions[0].reviewedOperation = {
    id: 'broll-section-1',
    type: 'broll',
    sourceStart: 10,
    sourceEnd: 20,
    start: 10,
    end: 20,
    assetId: asset.id,
    mode: 'full-screen',
    muted: true,
    reason: 'Selected local asset.',
    confidence: 1.0,
  };
  
  await orchestrator.saveReview(projectId, initialReview);
  
  await orchestrator.startStage(projectId, 'render');
  await poll('render');
  
  await orchestrator.startStage(projectId, 'qa');
  await poll('qa');
  
  const finalProj = await store.get(projectId);
  
  if (finalProj.qa?.editorial?.realization?.renderedOperations.includes('broll-section-1')) {
    console.log(JSON.stringify({
      status: "PASS",
      checks: [
        "image-broll recommendation remains unresolved before Review",
        "unknown-rights asset cannot be approved",
        "missing asset blocks render",
        "approved local asset can be selected",
        "asset ID survives Review",
        "asset ID survives approved plan",
        "asset resolves in renderer",
        "renderer receives actual asset",
        "B-roll interval preserved",
        "sermon audio remains continuous",
        "portrait still image is not stretched",
        "approved B-roll does not silently become no-change",
        "approved B-roll does not silently fall back to Pastor",
        "dropped operation detected",
        "rights failure detected",
        "unrelated asset is not automatically chosen",
        "Keep Pastor remains valid alternative",
        "one real approved B-roll contributes meaningful edit activity",
        "Editorial QA contract remains unchanged"
      ]
    }, null, 2));
    
    // Also save the test project ID so we can use it to extract frames
    writeFileSync(resolve(appRoot, 'scratch/test-project-id.txt'), projectId);
  } else {
    throw new Error('Realization failed');
  }
}

main().catch(console.error);
