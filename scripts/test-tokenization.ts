import { join } from 'node:path';
import { ensureDirectory, readJson, writeJson } from '../src/foundation.js';

interface Corpus { phrases: Array<{ text: string; category: string }> }

const root = import.meta.dirname;

function codePoints(text: string): string[] {
  return Array.from(text).filter((character) => /\p{Script=Bengali}/u.test(character));
}

function graphemes(text: string): string[] {
  return Array.from(new Intl.Segmenter('bn', { granularity: 'grapheme' }).segment(text), (part) => part.segment);
}

async function main(): Promise<void> {
  await ensureDirectory(join(root, '..', 'artifacts'));
  const corpus = await readJson<Corpus>(join(root, '..', 'fixtures', 'bangla-alignment-corpus.json'));
  const results = corpus.phrases.map((phrase) => {
    const graphemeClusters = graphemes(phrase.text);
    const sourceCharacters = codePoints(phrase.text).length;
    const damaged = graphemeClusters.some((cluster) => /[\u0980-\u09FF]/u.test(cluster) && cluster.normalize('NFC') !== cluster);
    return { ...phrase, graphemeCount: graphemeClusters.length, bengaliCodePointCount: sourceCharacters, damaged, graphemeClusters };
  });
  const report = { schemaVersion: '1.0', passed: results.every((result) => !result.damaged), results };
  await writeJson(join(root, '..', 'artifacts', 'bangla-tokenization.json'), report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });