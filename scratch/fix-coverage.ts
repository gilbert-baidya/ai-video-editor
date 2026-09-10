import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');
content = content.replace(
  `  proj.workflow.stages.director = { status: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };`,
  `  proj.workflow.stages.director = { status: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };\n  proj.workflow.coveragePercent = 100;\n  proj.workflow.status = 'READY_TO_RENDER';`
);
writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
