import { join } from 'node:path';
import { readJson, writeJson } from '../src/foundation.ts';
import type { EditPlan } from '../src/contracts.ts';

interface RenderResult { durationSeconds: number }

const root = import.meta.dirname;

async function main(): Promise<void> {
  const editPlan = await readJson<EditPlan>(join(root, '..', 'artifacts', 'foundation-sample', 'edit-plan.json'));
  const render = await readJson<RenderResult>(join(root, '..', 'artifacts', 'foundation-sample', 'render-result.json'));
  const captions = editPlan.operations.filter((operation) => operation.type === 'caption');
  const bounded = captions.every((operation) => operation.start >= 0 && operation.end > operation.start && operation.end <= render.durationSeconds);
  const readableBangla = captions.every((operation) => /[\u0980-\u09FF]/u.test(operation.text));
  const proof = {
    schemaVersion: '1.0',
    source: 'existing validated foundation Edit Plan and Remotion render result',
    captionCount: captions.length,
    boundedByRenderedDuration: bounded,
    readableBanglaTextPresent: readableBangla,
    captionIntervals: captions.map((operation) => ({ start: operation.start, end: operation.end, text: operation.text })),
    flickerCheck: 'NOT AUTOMATED; requires visual playback review',
    faceObstructionCheck: 'NOT AUTOMATED; existing renderer places captions at bottom safe area',
    result: bounded && readableBangla ? 'PASS WITH VISUAL REVIEW PENDING' : 'FAIL',
  };
  await writeJson(join(root, '..', 'artifacts', 'caption-timing-proof.json'), proof);
  console.log(JSON.stringify(proof, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });