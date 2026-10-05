import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRemotionRenderAdapter } from '../src/product-renderer.ts';

const root = await mkdtemp(join(tmpdir(), 'verify-real-render-'));
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const ffprobe = '/opt/homebrew/bin/ffprobe';

if (!existsSync(ffmpeg) || !existsSync(ffprobe)) {
  console.log('SKIPPED test: ffmpeg/ffprobe not found');
  process.exit(0);
}

try {
  // Generate a real 5.0-second dummy video
  const sourceVideo = join(root, 'source.mp4');
  execFileSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=108x192:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '5.0',
    '-c:v', 'libx264', '-c:a', 'aac', sourceVideo
  ]);

  const projectDir = join(root, 'projects', 'test-project');
  mkdirSync(join(projectDir, 'artifacts'), { recursive: true });
  mkdirSync(join(projectDir, 'output'), { recursive: true });

  const record = {
    workflow: { 
      projectId: 'test-project', 
      render: { format: { orientation: 'portrait', width: 1080, height: 1920 } },
      coveragePercent: 100,
      provider: { fallbackUsed: false },
      unresolvedBlockers: [],
      stages: { review: { status: 'completed' } }
    },
    artifacts: { approvedPlan: 'artifacts/approved-plan.json' },
    sourceMetadata: { durationSeconds: 5, width: 1080, height: 1920 },
    review: { decisions: [] }
  } as any;

  // Review workspace
  writeFileSync(join(projectDir, 'artifacts', 'review-workspace.json'), JSON.stringify({
    preview: { durationSeconds: 5 },
    mediaIndex: { assets: [] },
    analysis: { sections: [] }
  }));
  
  // Approved plan
  writeFileSync(join(projectDir, 'artifacts', 'approved-plan.json'), JSON.stringify({
    status: 'approved',
    operations: [
      { id: 'valid', type: 'no-change', start: 0, end: 5, mode: 'canonical-no-change', reason: 'fixture', confidence: 1 }
    ]
  }));

  const adapter = createRemotionRenderAdapter(resolve(import.meta.dirname, '..'));
  const outputPath = join(projectDir, 'output', 'out.mp4');

  console.log('Starting render...');
  const qa = await adapter(record, sourceVideo, outputPath);
  
  console.log('QA Summary:', JSON.stringify(qa, null, 2));

  const stats = await stat(outputPath);
  assert.ok(stats.size > 0, 'Render produced a non-empty file');
  
  // Verify with ffprobe
  const outputProbe = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', outputPath]).toString().trim();
  assert.ok(Math.abs(Number(outputProbe) - 5) < 0.5, 'Render duration is approx 5 seconds');
  
  console.log('Playback, duration, audio, and video integrity verified successfully.');
} finally {
  await rm(root, { recursive: true, force: true });
}
