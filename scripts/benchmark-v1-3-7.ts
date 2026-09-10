import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { GeminiDirectorProvider } from '../src/director-gemini.js';
import type { TranscriptDocument, SermonAnalysis } from '../src/contracts.js';
import { config } from 'dotenv';
import { detectCoarseSegmentation } from '../src/director.js';
config({ path: '.env.local' });

async function run() {
  const provider = new GeminiDirectorProvider();
  
  // Need to find the canonical transcript from v1.3.6
  // Or just load the one from a local fixture/project
  // Wait, I can use the fixture from test
  const content = await readFile('.runtime/projects/project-fdd3f9fb-94c3-4be0-8c59-990397b619a9/artifacts/transcript.json', 'utf8').catch(() => null);
  if (!content) {
    console.error('Could not find fixture transcript!');
    process.exit(1);
  }
  const transcript: TranscriptDocument = JSON.parse(content);

  for (let i = 1; i <= 3; i++) {
    console.log(`\n--- RUN ${i} ---`);
    const started = Date.now();
    const result = await provider.analyze({
      transcript,
      segments: transcript.segments,
      projectId: transcript.projectId,
      projectDuration: transcript.segments.at(-1)?.end ?? 0,
      primarySegmentIds: transcript.segments.map(s => s.id)
    });
    const latency = Date.now() - started;

    if (result.providerResult !== 'ai-success' && result.providerResult !== 'ai-retry-success') {
      console.log(`Failed: ${result.error}`);
      continue;
    }
    
    const analysis: SermonAnalysis = result.analysis!;
    const diag = detectCoarseSegmentation(analysis, transcript.segments.at(-1)?.end ?? 0);
    
    console.log(`Sections: ${analysis.sections.length}`);
    console.log(`Types: ${analysis.sections.map(s => s.type).join(', ')}`);
    console.log(`Functions: ${analysis.sections.map(s => s.semanticFunction).join(', ')}`);
    console.log(`Longest section: ${diag.longestSectionDuration.toFixed(2)}s`);
    console.log(`Story preserved: ${analysis.overallSemanticRole === 'story'}`);
    console.log(`Schema validity: ${result.attempts.some(a => a.schema === 'pass') ? 'PASS' : 'FAIL'}`);
    console.log(`Latency: ${latency}ms`);
    
    if (i === 1) {
      console.log('\nVisual Pass (Run 1 only):');
      analysis.sections.forEach((sec, idx) => {
        console.log(`\nSection ${idx + 1}: ${sec.type} (${sec.start.toFixed(1)}s - ${sec.end.toFixed(1)}s)`);
        console.log(`Visual Rec: ${sec.visualRecommendation}`);
        if (sec.brollIntent) {
          console.log(`B-roll Intent Subject: ${sec.brollIntent.subject}`);
        }
      });
    }
  }
}
run();
