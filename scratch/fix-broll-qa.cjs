const fs = require('fs');
let content = fs.readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

content = content.replace("editorial: {} as any,\n      // editorial: {\n        planHash: 'hash', workspaceCompatibility: 'compatible',\n        realization: { schemaVersion: '1.0', droppedOperations: [], unsupportedOperations: [], renderedOperations: ['broll-section-1'], durationMatches: true, warnings: [] }\n      }", "editorial: { planHash: 'hash', workspaceCompatibility: 'compatible', realization: { schemaVersion: '1.0', droppedOperations: [], unsupportedOperations: [], renderedOperations: ['broll-section-1'], durationMatches: true, warnings: [] } } as any");

fs.writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
