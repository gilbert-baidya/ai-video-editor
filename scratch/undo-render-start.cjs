const fs = require('fs');
let content = fs.readFileSync('scripts/execute-e2e-v1-3-5.ts', 'utf8');
content = content.replace("await orchestrator.startStage(projectId, 'render');", "");
fs.writeFileSync('scripts/execute-e2e-v1-3-5.ts', content);
