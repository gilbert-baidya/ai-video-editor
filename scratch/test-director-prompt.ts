import { resolve } from 'path';
import { readFileSync } from 'fs';
import { OllamaDirectorProvider } from '../src/director.ts';

async function main() {
  const provider = new OllamaDirectorProvider('ollama', 'qwen3:30b');
  
  const transcriptJson = JSON.parse(readFileSync('.runtime/projects/project-51df3dce-3f5e-4a28-b065-35a9bec59fcc/artifacts/transcript.json', 'utf8'));
  const segments = transcriptJson.segments;
  
  const input = {
    projectId: 'test',
    transcript: { projectId: 'test', segments },
    segments,
    primarySegmentIds: segments.map((s: any) => s.id)
  };
  
  const result = await provider.analyze(input as any);
  console.log(JSON.stringify(result.analysis, null, 2));
  console.log(JSON.stringify(result.attempts, null, 2));
}

main().catch(console.error);
