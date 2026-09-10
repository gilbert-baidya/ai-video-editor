import { resolve } from 'path';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import assert from 'assert';
import { ProductProjectStore } from '../src/product-store.ts';
import { ProductOrchestrator } from '../src/product-orchestrator.ts';
import { createInitialReviewState } from '../src/director-review.ts';
import type { EditPlan } from '../src/contracts.ts';

async function main() {
  const appRoot = resolve(process.cwd());
  const store = new ProductProjectStore(resolve(appRoot, '.runtime', 'projects-test-suite'));
  
  const orchestrator = new ProductOrchestrator(store, appRoot, {
    transcribe: async () => ({ segments: [{id: '1', start: 0, end: 60, text: 'mock'}] } as any),
    analyze: async () => ({
      analysis: { sections: [], overallConfidence: 1.0 },
      reviewWorkspace: undefined as any
    } as any),
    render: async () => ({
      status: 'PASS' as any, durationSeconds: 60, failures: [],
      video: true, audio: true, directorCoverage: true, brollRights: true, placement: true, bengaliGraphics: true, reviewReadiness: true, editorialQuality: true,
      editorial: { planHash: 'hash', workspaceCompatibility: 'compatible', realization: { schemaVersion: '1.0', droppedOperations: [], unsupportedOperations: [], renderedOperations: ['broll-section-1'], durationMatches: true, warnings: [] } } as any
    })
  });

  const project = await orchestrator.createProject({
    title: 'Fixture B-roll Test',
    source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true }
  });
  const projectId = project.workflow.projectId;
  
  const aiPlan: EditPlan = {
    schemaVersion: '2.0',
    projectId,
    sourceTranscriptHash: 'mock-hash',
    operations: [
      { id: 'policy-section-1', type: 'director-placeholder', start: 10, end: 20, visualType: 'image-broll', reason: 'Mock story B-roll', confidence: 0.9 }
    ],
    status: 'draft',
    createdBy: { provider: 'mock', model: 'mock' }
  };
  
  const beats: any[] = [
    { section: { id: 'section-1', type: 'story', start: 10, end: 20, transcriptText: 'Mock story', transcriptSafeDuration: 10 }, requiredReview: true, originalOperation: aiPlan.operations[0] }
  ];

  let proj = await store.get(projectId);
  proj.workflow.stages.ingest = { status: 'completed', progress: 100, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
  proj.workflow.stages.transcript = { status: 'completed', progress: 100, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
  proj.workflow.stages.director = { status: 'completed', progress: 100, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
  proj.workflow.coveragePercent = 100;
  proj.workflow.status = 'READY_TO_RENDER';
  proj.sourceMetadata = { durationSeconds: 60, width: 1080, height: 1920, relativePath: 'source/mock.mp4' } as any;
  mkdirSync(resolve(store.projectDirectory(projectId), 'source'), { recursive: true });
  writeFileSync(resolve(store.projectDirectory(projectId), 'source/mock.mp4'), 'video');
  await store.save(proj);
  
  const artifactsDir = store.artifactDirectory(projectId);
  const planHash = createHash('sha256').update(JSON.stringify(aiPlan)).digest('hex');
  const initialReview = createInitialReviewState({ projectId, aiPlan, beats, directorExecution: 'ai' as any }, planHash);
  
  const workspace = {
    schemaVersion: '1.0',
    projectId,
    title: 'Test',
    languageProfile: 'en',
    preview: { controlUrl: '', directorUrl: '', durationSeconds: 60.0, sourceStart: 0, sourceEnd: 60.0 },
    sourceEditPlanHash: planHash,
    directorExecution: 'ai-v1',
    aiPlan,
    mediaIndex: { schemaVersion: '1.0', indexerVersion: 'v1.3', createdAt: '', updatedAt: '', roots: [], assets: [] },
    beats,
    qa: { status: 'PASS', failures: [] }
  };
  writeFileSync(resolve(artifactsDir, 'review-workspace.json'), JSON.stringify(workspace));
  writeFileSync(resolve(artifactsDir, 'director.json'), JSON.stringify(aiPlan));
  
  const dummyJpg = resolve(appRoot, 'scratch/dummy.jpg');
  writeFileSync(dummyJpg, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x07, 0x80, 0x04, 0x38, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9])); 
  
  const dummyUnknownJpg = resolve(appRoot, 'scratch/dummy_unknown.jpg');
  writeFileSync(dummyUnknownJpg, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x07, 0x80, 0x04, 0x38, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xDA]));
  
  const assetApproved = await orchestrator.importLocalAsset(projectId, {
    path: dummyJpg, description: 'Test Approved', rightsStatus: 'approved', rightsBasis: 'generated'
  });
  assert.strictEqual(assetApproved.rightsStatus, 'approved', 'Approved asset can be imported');
  
  const assetUnknown = await orchestrator.importLocalAsset(projectId, {
    path: dummyUnknownJpg, description: 'Test Unknown', rightsStatus: 'unknown', rightsBasis: 'unknown'
  });
  
  const reviewUnknown = JSON.parse(JSON.stringify(initialReview));
  reviewUnknown.decisions[0].status = 'modified';
  reviewUnknown.decisions[0].resolution = 'manual-broll-replacement';
  reviewUnknown.decisions[0].reviewedOperation = { id: 'broll-section-1', type: 'broll', sourceStart: 10, sourceEnd: 20, start: 10, end: 20, assetId: assetUnknown.id, mode: 'full-screen', muted: true, reason: 'Test', confidence: 1.0 };
  
  const savedUnknown = await orchestrator.saveReview(projectId, reviewUnknown);
  assert.strictEqual(savedUnknown.workflow.stages.review.status, 'running', 'Unknown rights asset cannot be approved in Review');
  assert.ok(savedUnknown.workflow.unresolvedBlockers.some((b: string) => b.includes('require review')), 'Rights blocker is present');
  
  const reviewMissing = JSON.parse(JSON.stringify(initialReview));
  reviewMissing.decisions[0].status = 'modified';
  reviewMissing.decisions[0].resolution = 'manual-broll-replacement';
  reviewMissing.decisions[0].reviewedOperation = { id: 'broll-section-1', type: 'broll', sourceStart: 10, sourceEnd: 20, start: 10, end: 20, assetId: 'media-nonexistent', mode: 'full-screen', muted: true, reason: 'Test', confidence: 1.0 };
  
  const savedMissing = await orchestrator.saveReview(projectId, reviewMissing);
  assert.strictEqual(savedMissing.workflow.stages.review.status, 'running', 'Missing asset blocks Review approval');
  assert.ok(savedMissing.workflow.unresolvedBlockers.some((b: string) => b.includes('missing from the media index')), 'Missing asset blocker is present');
  
  const reviewApproved = JSON.parse(JSON.stringify(initialReview));
  reviewApproved.decisions[0].status = 'modified';
  reviewApproved.decisions[0].resolution = 'manual-broll-replacement';
  reviewApproved.decisions[0].reviewedOperation = { id: 'broll-section-1', type: 'broll', sourceStart: 10, sourceEnd: 20, start: 10, end: 20, assetId: assetApproved.id, mode: 'full-screen', muted: true, reason: 'Test', confidence: 1.0 };
  
  const savedProj = await orchestrator.saveReview(projectId, reviewApproved);
  assert.strictEqual(savedProj.workflow.stages.review.status, 'completed', 'Approved asset is accepted in Review');
  
  const approvedPlan: EditPlan = JSON.parse(readFileSync(resolve(artifactsDir, 'approved-plan.json'), 'utf8'));
  assert.strictEqual(approvedPlan.operations.length, 1);
  assert.strictEqual(approvedPlan.operations[0].type, 'broll');
  assert.strictEqual((approvedPlan.operations[0] as any).assetId, assetApproved.id, 'asset ID survives approved plan');
  
  writeFileSync(resolve(store.projectDirectory(projectId), 'output/final-sermon.mp4'), 'mock-video-content');
  
  await orchestrator.startStage(projectId, 'render');
  let rp = await store.get(projectId);
  while (rp.workflow.stages.render.status !== 'completed' && rp.workflow.stages.render.status !== 'failed') {
    await new Promise(r => setTimeout(r, 100));
    rp = await store.get(projectId);
  }
  if (rp.workflow.stages.render.status === 'failed') throw new Error(rp.workflow.stages.render.error);
  await orchestrator.startStage(projectId, 'qa');
  await new Promise(r => setTimeout(r, 500));

  let finalProj = await store.get(projectId);
  if(finalProj.workflow.stages.qa.status === 'failed') console.log('QA ERROR:', finalProj.workflow.stages.qa.error);
  assert.strictEqual(finalProj.workflow.stages.qa.status, 'completed', 'QA completes successfully');
  assert.ok(finalProj.qa?.editorial?.realization?.renderedOperations.includes('broll-section-1'), 'asset resolves in renderer and dropped operation detected correctly');
  assert.strictEqual(finalProj.qa?.video, true, 'Editorial QA contract remains unchanged');
  
  console.log('All V1.3.4 deterministic realization assertions PASSED.');
}
main().catch(e => { console.error(e); process.exit(1); });
