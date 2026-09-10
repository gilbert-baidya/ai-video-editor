import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace(
  `  proj.sourceMetadata = { durationSeconds: 60, width: 1080, height: 1920 } as any;`,
  `  proj.sourceMetadata = { durationSeconds: 60, width: 1080, height: 1920, relativePath: 'source/mock.mp4' } as any;
  import { mkdirSync } from 'fs';
  mkdirSync(resolve(store.projectDirectory(projectId), 'source'), { recursive: true });
  writeFileSync(resolve(store.projectDirectory(projectId), 'source/mock.mp4'), 'video');`
);

writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
