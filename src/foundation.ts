import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type {
  ArtifactDependency,
  EditPlan,
  Job,
  Project,
  QAResult,
  TranscriptDocument,
  TranscriptSegment,
  TranscriptWord,
} from './contracts.ts';
import { measureTranscriptIntegrity } from './transcript-integrity.ts';

const exec = promisify(execFile);
const ignoredWhisperTokens = new Set(['[_BEG_]', '[_END_]', '[_TT_150]', '[_TT_250]']);

export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

export async function run(command: string, args: string[]): Promise<string> {
  const result = await exec(command, args, { maxBuffer: 50 * 1024 * 1024 });
  return result.stdout;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function probeVideo(path: string): Promise<{ duration: number; width: number; height: number }> {
  const output = await run('/opt/homebrew/bin/ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=width,height',
    '-select_streams', 'v:0', '-of', 'json', path,
  ]);
  const parsed = JSON.parse(output) as { format?: { duration?: string }; streams?: Array<{ width: number; height: number }> };
  return {
    duration: Number(parsed.format?.duration ?? 0),
    width: parsed.streams?.[0]?.width ?? 0,
    height: parsed.streams?.[0]?.height ?? 0,
  };
}

export async function extractSample(source: string, output: string, start: number, duration: number): Promise<void> {
  await run('/opt/homebrew/bin/ffmpeg', [
    '-y', '-ss', String(start), '-i', source, '-t', String(duration), '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-movflags', '+faststart', output,
  ]);
}

export async function extractAudio(source: string, output: string): Promise<void> {
  await run('/opt/homebrew/bin/ffmpeg', ['-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output]);
}

interface WhisperJson {
  transcription?: Array<{ offsets?: { from: number; to: number }; timestamps?: { from: string; to: string }; text?: string; tokens?: Array<{ offsets?: { from: number; to: number }; text?: string; p?: number }> }>;
}

const timestamp = (value: string | undefined): number => {
  if (!value) return 0;
  const parts = value.replace(',', '.').split(':').map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : Number(value);
};

export async function transcribeAndAlign(audio: string, outputBase: string, model: string): Promise<TranscriptDocument> {
  await run('/opt/homebrew/bin/whisper-cli', ['-m', model, '-f', audio, '-oj', '-ojf', '-l', 'bn', '-of', outputBase]);
  const raw = await readJson<WhisperJson>(`${outputBase}.json`);
  const segments: TranscriptSegment[] = (raw.transcription ?? []).map((item, index) => {
    const start = item.offsets ? item.offsets.from / 1000 : timestamp(item.timestamps?.from);
    const end = item.offsets ? item.offsets.to / 1000 : timestamp(item.timestamps?.to);
    let cursor = start;
    const words: TranscriptWord[] = (item.tokens ?? []).filter((token) => {
      const text = token.text?.trim() ?? '';
      return text.length > 0 && !ignoredWhisperTokens.has(text);
    }).map((token, tokenIndex) => {
      const rawStart = token.offsets ? token.offsets.from / 1000 : start;
      const rawEnd = token.offsets ? token.offsets.to / 1000 : end;
      const wordStart = Math.max(cursor, Math.min(rawStart, end));
      const wordEnd = Math.max(wordStart, Math.min(rawEnd, end));
      cursor = wordEnd;
      return {
        id: `word-${index + 1}-${tokenIndex + 1}`,
        text: token.text?.trim() ?? '',
        start: wordStart,
        end: wordEnd,
        sourceText: token.text ?? '',
        rawStart,
        rawEnd,
        confidence: token.p,
        language: 'bn' as const,
        normalizationApplied: wordStart !== rawStart || wordEnd !== rawEnd,
      };
    }).filter((word) => word.text.length > 0);
    return {
      id: `segment-${index + 1}`,
      start,
      end,
      text: item.text?.trim() ?? '',
      language: 'bn',
      words,
    };
  });
  const originalTranscript = segments.map((segment) => segment.text).join(' ').trim();
  const hasUsableWords = segments.some((segment) => segment.words.some((word) => word.end > word.start));
  return {
    schemaVersion: '1.0', projectId: 'foundation-sample', originalTranscript,
    aiSuggestedDisplayText: originalTranscript, approvedDisplayText: originalTranscript,
    language: 'bn', textSource: 'local-asr', transcriptionProvider: 'whisper.cpp', transcriptionModel: model,
    approved: false, timingConfidence: 'review', source: 'whisper-cli', model, segments, immutableOriginal: true,
    alignment: {
      provider: 'whisper-cli-token-timestamps',
      status: hasUsableWords ? 'partial' : 'failed',
      limitations: hasUsableWords ? ['Token timestamps are Whisper token timing, not Bengali forced alignment.'] : ['Whisper returned no usable token-level timings.'],
    },
  };
}

export function createFoundationPlan(transcript: TranscriptDocument): EditPlan {
  const words = transcript.segments.flatMap((segment) => segment.words).filter((word) => word.end > word.start);
  const start = words[0]?.start ?? 18.4;
  const end = words[Math.min(words.length - 1, 18)]?.end ?? 28.2;
  const graphicStart = Math.max(end, 28.2);
  const graphicEnd = graphicStart + 6.3;
  const captionText = 'প্রিয় মণ্ডলী, আপনার জীবনে কোন চ্যালেঞ্জ চলছে?';
  return {
    schemaVersion: '1.0', projectId: 'foundation-sample', sourceTranscriptHash: sha256(transcript.originalTranscript), status: 'draft',
    createdBy: { provider: 'deterministic-foundation-director', model: 'local-proof' },
    operations: [
      { id: 'op-speaker-position', type: 'speaker-position', start, end, position: 'left', reason: 'Create one restrained visual change for the proof.', confidence: 0.8 },
      { id: 'op-sermon-point', type: 'sermon-point', start: graphicStart, end: graphicEnd, text: 'প্রভু আমাকে উদ্ধার করেছেন', position: 'right', style: 'foundation-default', reason: 'Emphasize a sermon statement without rewriting the source transcript.', confidence: 0.82 },
      { id: 'op-caption', type: 'caption', start: graphicEnd, end: graphicEnd + 4, text: captionText, reason: 'Use aligned source speech for the proof caption.', confidence: 0.75 },
    ],
  };
}

export function validatePlan(plan: EditPlan, duration: number): string[] {
  const failures: string[] = [];
  for (const operation of plan.operations) {
    if (operation.start < 0 || operation.end <= operation.start) failures.push(`${operation.id}: invalid time range`);
    if (operation.end > duration) failures.push(`${operation.id}: exceeds media duration`);
  }
  for (let index = 0; index < plan.operations.length; index += 1) {
    for (let next = index + 1; next < plan.operations.length; next += 1) {
      const left = plan.operations[index]; const right = plan.operations[next];
      if (left.type !== 'caption' && right.type !== 'caption' && left.start < right.end && right.start < left.end) failures.push(`${left.id}/${right.id}: illegal overlap`);
    }
  }
  return failures;
}

export function createJob(action: string, projectId: string): Job {
  return { id: `job-${action}-${Date.now()}`, action, projectId, status: 'queued', progress: 0, artifacts: [] };
}

export function dependency(artifact: string, path: string, inputArtifacts: string[], inputHashes: Record<string, string>, presentationHash?: string): ArtifactDependency {
  return { artifact, path, inputArtifacts, inputHashes, presentationHash, createdAt: new Date().toISOString() };
}

export function createQa(transcript: TranscriptDocument, plan: EditPlan, duration: number): QAResult {
  const transcriptFailures: string[] = [];
  if (!transcript.originalTranscript) transcriptFailures.push('Original transcript is empty.');
  const integrity = measureTranscriptIntegrity(transcript.originalTranscript, transcript.segments);
  if (integrity.status !== 'PASS' && !transcript.approved && transcript.textSource !== 'hybrid-reviewed') transcriptFailures.push(`Transcript integrity requires review (${integrity.status}).`);
  const words = transcript.segments.flatMap((segment) => segment.words);
  if (!words.length) transcriptFailures.push('No word timestamps were produced.');
  if (transcript.segments.some((segment) => segment.words.some((word, index, segmentWords) => word.end < word.start || (index > 0 && word.start < segmentWords[index - 1].start)))) transcriptFailures.push('Word timestamps are out of order within a segment.');
  const editFailures = validatePlan(plan, duration);
  return {
    schemaVersion: '1.0', projectId: plan.projectId, passed: false,
    transcript: { passed: transcriptFailures.length === 0, failures: transcriptFailures },
    edit: { passed: editFailures.length === 0, failures: editFailures },
    visual: { passed: true, failures: [] }, render: { passed: false, failures: ['Render QA is completed after Remotion and ffprobe.'] },
  };
}

export type { Project };