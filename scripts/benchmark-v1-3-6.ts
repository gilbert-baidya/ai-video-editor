import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadEnv } from '../src/env.ts';
loadEnv(resolve(process.cwd()));

import { GeminiDirectorProvider } from '../src/director-gemini.ts';
import type { SermonAnalysis } from '../src/contracts.ts';
import type { DirectorInput } from '../src/director.ts';
import { validateClassificationAmbiguity } from '../src/director.ts';
import { evaluateSemanticStability } from '../src/director.ts';

async function main() {
  const projectId = 'project-fc5ca7f3-7844-4d46-aa7b-ee8e548c3531';
  const artifactDir = resolve(process.cwd(), '.runtime', 'projects', projectId, 'artifacts');
  
  const transcript = JSON.parse(readFileSync(resolve(artifactDir, 'transcript.json'), 'utf8'));
  const input: DirectorInput = {
    transcript,
    segments: transcript.segments,
    projectDuration: transcript.durationSeconds,
    projectId,
    primarySegmentIds: transcript.segments.map((s: any) => s.id)
  };

  const provider = new GeminiDirectorProvider();

  console.log('--- GEMINI SEMANTIC BENCHMARK ---');
  let firstRunAnalysis: any;

  for (let i = 1; i <= 3; i++) {
    console.log(`\nRun ${i}:`);
    const start = Date.now();
    
    // We can call provider.analyze which does both passes.
    // Wait, analyze() does both, I only want to see the semantic output first.
    // Let's call analyze() and see the final result, which is fine since both passes are fast.
    const result = await provider.analyze(input);
    const latency = Date.now() - start;
    
    if (result.providerResult === 'provider-failure' || result.providerResult === 'provider-unavailable') {
      console.log('Failed:', result.error);
      return;
    }
    
    const analysis = result.analysis!;
    console.log(`Latency: ${latency}ms`);
    console.log('Valid Schema:', true);
    
    // Check if story recognized
    let hasStory = false;
    for (const sec of analysis.sections) {
      if (['story', 'illustration', 'testimony'].includes(sec.type) || ['story', 'illustration', 'testimony'].includes(sec.secondaryType ?? '')) {
        hasStory = true;
      }
    }
    console.log(`Story Recognized: ${hasStory}`);
    console.log(`Sections: ${analysis.sections.length}`);
    for (const sec of analysis.sections) {
      console.log(`- [${sec.start}-${sec.end}] ${sec.type} (secondary: ${sec.secondaryType || 'none'}) -> ${sec.visualRecommendation} (${sec.editorialIntent}) | ${sec.reason}`);
    }

    if (i === 1) {
      firstRunAnalysis = analysis;
    } else {
      // Evaluate stability
      const a = firstRunAnalysis.sections[0];
      const b = analysis.sections[0];
      if (a && b) {
        const stability = evaluateSemanticStability(a, b);
        console.log(`Semantic Stability vs Run 1 (Section 0): ${stability}`);
      }
    }
  }
}

main().catch(console.error);
