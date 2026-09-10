const fs = require('fs');

let content = fs.readFileSync('scripts/execute-e2e-v1-3-5.ts', 'utf8');
content = content.replace(
  "sectionId: brollDecision.section.id,",
  "beatId: brollDecision.beatId,"
);

// We should also add provenance
content = content.replace(
  "status: 'modified',",
  "status: 'approved',\n        originalProvenance: brollDecision.provenance?.source || 'ai',\n        provenance: 'human-override',"
);

fs.writeFileSync('scripts/execute-e2e-v1-3-5.ts', content);
