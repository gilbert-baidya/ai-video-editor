const fs = require('fs');

let content = fs.readFileSync('scripts/execute-e2e-v1-3-5.ts', 'utf8');

const replacement = `  console.log('\\n--- Rendering ---');
  await orchestrator.startStage(projectId, 'render');
  let proj = await store.get(projectId);`;

content = content.replace(`  console.log('\\n--- Rendering ---');
  let proj = await store.get(projectId);`, replacement);

fs.writeFileSync('scripts/execute-e2e-v1-3-5.ts', content);
