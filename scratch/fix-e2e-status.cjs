const fs = require('fs');

let content = fs.readFileSync('scripts/execute-e2e-v1-3-5.ts', 'utf8');
content = content.replace("status: 'approved',", "status: 'modified',");

fs.writeFileSync('scripts/execute-e2e-v1-3-5.ts', content);
