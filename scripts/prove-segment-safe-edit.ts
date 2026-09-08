import { join } from 'node:path';
import { readJson, writeJson } from '../src/foundation.js';
import { editBoundaryPolicy } from '../src/alignment.ts';

interface SourceSegment { startTime: number; endTime: number; text: string }
interface SourceTranscript { segments: SourceSegment[] }

const root = import.meta.dirname;
const sourceTranscript = join(root, '..', '..', '..', 'sermonclip-studio', 'Projects', 'GOLDEN-E2E---Intervention-Sermon-2', 'Transcript', 'transcript.json');

async function main(): Promise<void> {
  const transcript = await readJson<SourceTranscript>(sourceTranscript);
  const segment = transcript.segments.find((candidate) => candidate.startTime === 4080);
  if (!segment) throw new Error('Expected authoritative source segment at 4080 seconds.');
  const words = segment.text.trim().split(/\s+/);
  const proof = {
    schemaVersion: '1.0',
    source: sourceTranscript,
    boundaryPolicy: editBoundaryPolicy('low'),
    start: segment.startTime,
    end: segment.endTime,
    duration: segment.endTime - segment.startTime,
    sourceText: segment.text.trim(),
    firstSpokenTokenPreserved: words[0] ?? '',
    finalSpokenTokenPreserved: words.at(-1) ?? '',
    sentenceSafe: false,
    result: 'SEGMENT-SAFE FALLBACK',
    reason: 'Low-confidence alignment forbids destructive word cuts; authoritative segment bounds are retained until Bengali forced alignment is available.',
  };
  await writeJson(join(root, '..', 'artifacts', 'segment-safe-edit-proof.json'), proof);
  console.log(JSON.stringify(proof, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });