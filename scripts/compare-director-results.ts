import { resolve } from 'node:path';
import type { SermonAnalysis } from '../src/contracts.ts';
import type { DirectorExecutionProvenance } from '../src/director-execution.ts';
import { compareDirectorResults, measureDirectorResult } from '../src/director-comparison.ts';
import { readJson, sha256, writeJson } from '../src/foundation.ts';

async function main(): Promise<void> {
  const [fallbackAnalysisPath, fallbackProvenancePath, aiAnalysisPath, aiProvenancePath, outputPath, durationValue] = process.argv.slice(2);
  if (!fallbackAnalysisPath || !fallbackProvenancePath || !aiAnalysisPath || !aiProvenancePath || !outputPath || !durationValue) {
    throw new Error('Usage: npm run compare-directors -- <fallback-analysis.json> <fallback-provenance.json> <ai-analysis.json> <ai-provenance.json> <output.json> <duration-seconds>');
  }
  const duration = Number(durationValue);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('duration-seconds must be a positive number.');
  const fallbackAnalysis = await readJson<SermonAnalysis>(resolve(fallbackAnalysisPath));
  const fallbackProvenance = await readJson<DirectorExecutionProvenance>(resolve(fallbackProvenancePath));
  const aiAnalysis = await readJson<SermonAnalysis>(resolve(aiAnalysisPath));
  const aiProvenance = await readJson<DirectorExecutionProvenance>(resolve(aiProvenancePath));
  if (fallbackAnalysis.projectId !== aiAnalysis.projectId) throw new Error('Comparison inputs must belong to the same project.');
  const transcriptHash = sha256(JSON.stringify(fallbackAnalysis.sections.flatMap((section) => section.sourceSegmentIds)));
  const comparison = compareDirectorResults(
    measureDirectorResult(fallbackAnalysis, fallbackProvenance, duration, transcriptHash),
    measureDirectorResult(aiAnalysis, aiProvenance, duration, transcriptHash),
  );
  await writeJson(resolve(outputPath), comparison);
  console.log(JSON.stringify(comparison, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
