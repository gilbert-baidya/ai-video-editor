import { join } from 'node:path';
import { readJson, writeJson } from '../src/foundation.js';
import { createAlignmentSamples, measureAlignment, type RawWhisperDocument } from '../src/alignment.ts';
import type { TranscriptDocument } from '../src/contracts.ts';

const root = import.meta.dirname;
const artifacts = join(root, '..', 'artifacts', 'foundation-sample');

async function main(): Promise<void> {
  const raw = await readJson<RawWhisperDocument>(join(artifacts, 'whisper.json'));
  const transcript = await readJson<TranscriptDocument>(join(artifacts, 'transcript.json'));
  const report = {
    provider: 'whisper.cpp token offsets',
    version: 'whisper.cpp 1.9.2',
    model: transcript.model,
    languageOption: 'bn',
    rawJsonStructure: 'transcription[].offsets/timestamps/text/tokens[].text/offsets/p',
    tokenSemantics: 'Whisper tokenizer pieces; Bengali vowel signs and conjunct components may be separate tokens.',
    absoluteTimestampDerivation: 'raw token offsets in milliseconds divided by 1000; segment offsets use the same conversion.',
    normalization: 'clamp each token into its segment and monotonically advance a cursor; preserve rawStart/rawEnd.',
    metrics: measureAlignment(raw, transcript),
    samples: createAlignmentSamples(transcript, 'whisper.cpp token offsets'),
    notes: [
      'Punctuation and timing control tokens are present in raw JSON but excluded from non-empty token metrics.',
      'The selected real fixture has no Latin-script token; mixed-language quality remains unmeasured for this source.',
    ],
  };
  await writeJson(join(artifacts, 'alignment-audit.json'), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });