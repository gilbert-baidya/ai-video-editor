import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert';
import { createRemotionRenderAdapter } from '../src/product-renderer.ts';

const root = await mkdtemp(join(tmpdir(), 'source-duration-test-'));
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const ffprobe = '/opt/homebrew/bin/ffprobe';

if (!existsSync(ffmpeg) || !existsSync(ffprobe)) {
  console.log('SKIPPED test: ffmpeg/ffprobe not found at /opt/homebrew/bin');
  process.exit(0);
}

try {
  // Generate a real 60.0-second dummy video
  const sourceVideo = join(root, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=108x192:rate=30', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '60.0', '-c:v', 'libx264', '-c:a', 'aac', sourceVideo]);

  // Create mock workspace for the renderer
  const projectDir = join(root, 'projects', 'test-project');
  mkdirSync(join(projectDir, 'artifacts'), { recursive: true });
  mkdirSync(join(projectDir, 'output'), { recursive: true });

  const record = {
    workflow: { projectId: 'test-project', render: { format: { orientation: 'portrait' } } },
    artifacts: { approvedPlan: 'artifacts/approved-plan.json' },
    sourceMetadata: { durationSeconds: 60 }
  } as any;

  // The review-workspace needs an empty mediaIndex
  writeFileSync(join(projectDir, 'artifacts', 'review-workspace.json'), JSON.stringify({ preview: { durationSeconds: 72 }, mediaIndex: { assets: [] } }));
  // The approved plan
  writeFileSync(join(projectDir, 'artifacts', 'approved-plan.json'), JSON.stringify({ status: 'approved', operations: [{ id: 'impossible', type: 'no-change', start: 60, end: 72, mode: 'canonical-no-change', reason: 'negative fixture', confidence: 1 }] }));

  // Run the adapter
  const adapter = createRemotionRenderAdapter(root);
  const outputPath = join(projectDir, 'output', 'out.mp4');

  await assert.rejects(
    adapter(record, sourceVideo, outputPath),
    /SOURCE_DURATION_MISMATCH: Source duration mismatch: Physical footage is .* seconds, but the approved timeline requires 72 seconds\. Rendering is blocked\./
  );

  // Metadata mismatch remains independently protected even when plan timing itself is valid.
  record.sourceMetadata.durationSeconds = 72;
  writeFileSync(join(projectDir, 'artifacts', 'review-workspace.json'), JSON.stringify({ preview: { durationSeconds: 60 }, mediaIndex: { assets: [] } }));
  writeFileSync(join(projectDir, 'artifacts', 'approved-plan.json'), JSON.stringify({ status: 'approved', operations: [{ id: 'valid', type: 'no-change', start: 0, end: 60, mode: 'canonical-no-change', reason: 'negative fixture', confidence: 1 }] }));
  await assert.rejects(
    adapter(record, sourceVideo, outputPath),
    /SOURCE_DURATION_MISMATCH: Source duration mismatch: Physical footage is .* seconds, but the approved timeline requires 72 seconds\. Rendering is blocked\./
  );
  console.log(JSON.stringify({ status: 'PASS', suite: 'source-duration-mismatch' }, null, 2));

} finally {
  await rm(root, { recursive: true, force: true });
}
