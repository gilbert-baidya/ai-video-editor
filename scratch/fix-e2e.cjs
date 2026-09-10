const fs = require('fs');
let content = fs.readFileSync('scripts/execute-e2e-v1-3-5.ts', 'utf8');

const replacement = `  let proj = await store.get(projectId);
  
  console.log('\\n--- Starting Ingest ---');
  await orchestrator.startStage(projectId, 'ingest');
  while (proj.workflow.stages.ingest.status !== 'completed' && proj.workflow.stages.ingest.status !== 'failed') {
    await new Promise(r => setTimeout(r, 2000));
    proj = await store.get(projectId);
  }
  if (proj.workflow.stages.ingest.status === 'failed') throw new Error(proj.workflow.stages.ingest.error);
  
  console.log('\\n--- Starting Transcript ---');
  await orchestrator.startStage(projectId, 'transcript');
  while (proj.workflow.stages.transcript.status !== 'completed' && proj.workflow.stages.transcript.status !== 'failed') {
    await new Promise(r => setTimeout(r, 5000));
    proj = await store.get(projectId);
  }
  if (proj.workflow.stages.transcript.status === 'failed') throw new Error(proj.workflow.stages.transcript.error);

  console.log('\\n--- Starting Director ---');
  await orchestrator.startStage(projectId, 'director');
  while (proj.workflow.stages.director.status !== 'completed' && proj.workflow.stages.director.status !== 'failed') {
    await new Promise(r => setTimeout(r, 5000));
    proj = await store.get(projectId);
    console.log('Director running...');
  }`;

content = content.replace(`  let proj = await store.get(projectId);\n  while (proj.workflow.stages.director.status !== 'completed' && proj.workflow.stages.director.status !== 'failed') {\n    await new Promise(r => setTimeout(r, 5000));\n    proj = await store.get(projectId);\n    console.log(\`Status: Ingest=\${proj.workflow.stages.ingest.status}, Transcript=\${proj.workflow.stages.transcript.status}, Director=\${proj.workflow.stages.director.status}\`);\n  }`, replacement);

fs.writeFileSync('scripts/execute-e2e-v1-3-5.ts', content);
