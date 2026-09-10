const fs = require('fs');
let content = fs.readFileSync('src/contracts.ts', 'utf8');
content = content.replace(
  "semanticConfidence: number;\n  semanticEvidence: string;",
  "semanticConfidence?: number;\n  semanticEvidence?: string;"
);
fs.writeFileSync('src/contracts.ts', content);
