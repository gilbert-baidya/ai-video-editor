const fs = require('fs');
let content = fs.readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');
content = content.replace("projectId: 'test',", "projectId,");
content = content.replace("projectId: 'test',", "projectId,");
fs.writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
