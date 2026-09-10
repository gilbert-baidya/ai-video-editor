import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace(
  `console.log("BLOCKERS:", savedUnknown.workflow.unresolvedBlockers);`,
  `console.log("ASSET:", assetUnknown); console.log("BLOCKERS:", savedUnknown.workflow.unresolvedBlockers);`
);

writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
