const fs = require('fs');

let content = fs.readFileSync('scripts/execute-e2e-v1-3-5.ts', 'utf8');

const replacement = `  console.log('\\n--- Creating Project ---');
  let brollDecision = null;
  let projectId = '';
  let reviewData = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    const project = await orchestrator.createProject({
      title: \`V1.3.5 Real E2E Closure Attempt \${attempt}\`,
      source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true }
    });
    projectId = project.workflow.projectId;
    console.log(\`Attempt \${attempt} Project ID: \${projectId}\`);
    
    let proj = await store.get(projectId);
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
    }
    if (proj.workflow.stages.director.status === 'failed') {
      console.log('Director failed. Retrying whole pipeline...');
      continue;
    }
    
    try {
      reviewData = JSON.parse(readFileSync(resolve(store.artifactDirectory(projectId), 'review-workspace.json'), 'utf8'));
      brollDecision = reviewData.beats.find((b: any) => b.section.type === 'story' || b.originalOperation?.visualType === 'image-broll');
      if (brollDecision) {
        console.log('Found story/image-broll beat!');
        break;
      }
    } catch (e) {}
    console.log('No story beat found. Retrying...');
  }
  
  if (!brollDecision) throw new Error('Could not find story/image-broll beat in review workspace after 3 attempts');`;

// I'll manually piece this together since regex is tricky here.
