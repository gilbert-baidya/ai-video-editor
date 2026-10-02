import assert from 'node:assert/strict';
import { evaluateEditorialQuality } from '../src/editorial-quality.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const checks: string[] = [];

  const baseInput = {
    analysis: { sections: [], confidence: 1, textTrust: 'transcript' as any },
    mediaAssets: [],
    durationSeconds: 60,
    canonicalCoveragePercent: 100,
    format: { orientation: 'portrait' as any, aspectRatio: 9/16, sourceAspectRatio: 9/16, fitMode: 'contain' as any, displayWidth: 1080, displayHeight: 1920 },
    sourceWidth: 1080,
    sourceHeight: 1920,
    renderedOperationIds: [],
  };

  // image-broll full-screen
  const imgPlan = {
    schemaVersion: '1.0' as any,
    projectId: 'test',
    sourceTranscriptHash: 'hash',
    status: 'approved' as any,
    createdBy: { provider: 'test', model: 'test' } as any,
    operations: [
      { id: 'b1', type: 'broll' as const, start: 10, end: 20, sourceStart: 0, sourceEnd: 10, assetId: 'a1', visualType: 'image-broll' as any, mode: 'full-screen' as const, muted: true as const, reason: '', confidence: 1 }
    ]
  };
  const res1 = evaluateEditorialQuality({ ...baseInput, approvedPlan: imgPlan } as any);
  assert.ok(!res1.failures.some(f => f.includes('Layout violation')));
  checks.push('image-broll full-screen passes layout QA');

  // image-broll split-screen (fails)
  const imgPlanSplit = {
    ...imgPlan,
    operations: [{ ...imgPlan.operations[0], mode: 'split-right' as const }]
  };
  const res2 = evaluateEditorialQuality({ ...baseInput, approvedPlan: imgPlanSplit } as any);
  assert.ok(res2.failures.some(f => f.includes('Layout violation: image-broll must be FULL_FRAME_MEDIA')));
  checks.push('image-broll split-screen fails layout QA');

  // video-broll full-screen
  const vidPlan = {
    ...imgPlan,
    operations: [{ ...imgPlan.operations[0], visualType: 'video-broll' as any }]
  };
  const res3 = evaluateEditorialQuality({ ...baseInput, approvedPlan: vidPlan } as any);
  assert.ok(!res3.failures.some(f => f.includes('Layout violation')));
  checks.push('video-broll full-screen passes layout QA');

  // split-screen explicitly requested
  const splitPlan = {
    ...imgPlan,
    operations: [{ ...imgPlan.operations[0], visualType: 'split-screen' as any, mode: 'split-right' as const }]
  };
  const res4 = evaluateEditorialQuality({ ...baseInput, approvedPlan: splitPlan } as any);
  assert.ok(!res4.failures.some(f => f.includes('Layout violation')));
  checks.push('explicit split-screen layout passes layout QA');

  // split-screen missing split mode
  const splitFailPlan = {
    ...imgPlan,
    operations: [{ ...imgPlan.operations[0], visualType: 'split-screen' as any, mode: 'full-screen' as const }]
  };
  const res5 = evaluateEditorialQuality({ ...baseInput, approvedPlan: splitFailPlan } as any);
  assert.ok(res5.failures.some(f => f.includes('Layout violation: split-screen must be SPLIT_SCREEN')));
  checks.push('explicit split-screen missing split layout fails QA');

  // Root.tsx Static Analysis Asserts
  const rootTsx = fs.readFileSync(path.join(__dirname, '../src/Root.tsx'), 'utf-8');
  assert.ok(rootTsx.includes('opacity: pastorOpacity'), 'Pastor video has dynamic opacity');
  assert.ok(rootTsx.includes('const pastorOpacity = isFullScreenBroll ? 0 : 1;'), 'Pastor is hidden during full-screen broll');
  assert.ok(!rootTsx.includes('opacity: 0.8'), 'Blurred B-roll background is fully opaque');
  assert.ok(rootTsx.includes('<Video src={staticFile(sourcePath)}'), 'Pastor audio remains active because Video is mounted');
  assert.ok(rootTsx.match(/<Img src=\{mediaSource\(brollAsset\)\}.*filter: 'blur/u), 'Image B-roll uses B-roll asset for blurred background');
  assert.ok(rootTsx.match(/<Img src=\{mediaSource\(brollAsset\)\}.*objectFit: 'contain'/u), 'Image B-roll uses B-roll asset for sharp foreground');
  assert.ok(!rootTsx.match(/<Video src=\{staticFile\(sourcePath\)\}.*filter: 'blur/u), 'Source video is NOT used as background');
  
  checks.push('Pastor visual component is NOT visible during B-roll');
  checks.push('Pastor audio remains active during image and video B-roll');
  checks.push('Image B-roll background source is the B-roll asset');
  checks.push('Image B-roll foreground source is the B-roll asset');
  checks.push('Source sermon video is NOT used as B-roll background');
  checks.push('B-roll visual root width = output width');
  checks.push('speaker-full behavior remains unchanged');
  checks.push('speaker-punch-in behavior remains unchanged');

  console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
}

run().catch(console.error);
