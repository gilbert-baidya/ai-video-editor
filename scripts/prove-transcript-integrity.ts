import { join, resolve } from 'node:path';
import { readJson, run, writeJson } from '../src/foundation.ts';
import { buildTranscriptSentences, measureTranscriptIntegrity, transcriptInvalidates } from '../src/transcript-integrity.ts';
import type { TranscriptDocument, TranscriptSegment } from '../src/contracts.ts';

interface WhisperJson { transcription?: Array<{ offsets?: { from: number; to: number }; text?: string }> }
interface SourceSegment { startTime: number; endTime: number; text: string }
interface SourceTranscript { segments: SourceSegment[] }

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'artifacts', 'transcript-integrity');
const sourceTranscriptPath = resolve(root, '../../sermonclip-studio/Projects/GOLDEN-E2E---Intervention-Sermon-2/Transcript/transcript.json');
const audioPath = join(root, 'artifacts', 'foundation-sample', 'audio.wav');

function textOf(raw: WhisperJson): string { return (raw.transcription ?? []).map((segment) => segment.text?.trim() ?? '').filter(Boolean).join(' '); }
function scriptOf(raw: WhisperJson): Array<{ text: string }> { return (raw.transcription ?? []).map((segment) => ({ text: segment.text?.trim() ?? '' })); }
function toSegments(source: SourceTranscript): TranscriptSegment[] {
  return source.segments.filter((segment) => segment.startTime >= 4020 && segment.startTime < 4140).map((segment, index) => ({
    id: `source-segment-${index + 1}`, start: segment.startTime - 4020, end: segment.endTime - 4020, text: segment.text.trim(), language: 'bn', words: [],
  }));
}

async function main(): Promise<void> {
  const source = await readJson<SourceTranscript>(sourceTranscriptPath);
  const smallRaw = await readJson<WhisperJson>(join(root, 'artifacts', 'foundation-sample', 'whisper.json'));
  const mediumRaw = await readJson<WhisperJson>(join(artifacts, 'whisper-medium', 'output.json'));
  const referenceSegments = toSegments(source);
  const referenceText = referenceSegments.map((segment) => segment.text).join(' ');
  const candidates = [
    { id: 'whisper-small', provider: 'whisper.cpp', model: 'ggml-small.bin', modelBytes: 487601967, language: 'bn', outputFormat: 'json', segments: scriptOf(smallRaw), text: textOf(smallRaw), runtimeSeconds: null, source: 'local-asr', options: ['-oj', '-ojf', '-l bn'], prompt: null, conditionOnPreviousText: 'default' },
    { id: 'whisper-medium', provider: 'whisper.cpp', model: 'ggml-medium.bin', modelBytes: 1533763059, language: 'bn', outputFormat: 'json', segments: scriptOf(mediumRaw), text: textOf(mediumRaw), runtimeSeconds: 49.413, source: 'local-asr', options: ['-oj', '-ojf', '-l bn'], prompt: null, conditionOnPreviousText: 'default' },
    { id: 'sermonclip-reference', provider: 'existing SermonClip persisted transcript', model: 'indicconformer-bn', modelBytes: null, language: 'bn', outputFormat: 'persisted transcript JSON', segments: referenceSegments.map((segment) => ({ text: segment.text })), text: referenceText, runtimeSeconds: null, source: 'existing-project', prompt: null, conditionOnPreviousText: null },
  ];
  const integrity = Object.fromEntries(candidates.map((candidate) => [candidate.id, measureTranscriptIntegrity(candidate.text, candidate.segments)]));
  const sentences = buildTranscriptSentences(referenceSegments);
  const canonicalCandidate: TranscriptDocument = {
    schemaVersion: '1.1', projectId: 'foundation-sample', originalTranscript: referenceText,
    aiSuggestedDisplayText: referenceText, approvedDisplayText: referenceText, language: 'bn',
    textSource: 'existing-project', transcriptionProvider: 'existing SermonClip persisted transcript', transcriptionModel: 'indicconformer-bn',
    approved: false, timingConfidence: 'segment-safe', source: 'sermonclip-reference', model: 'indicconformer-bn', segments: referenceSegments,
    immutableOriginal: true, sentences, alignment: { provider: 'persisted-segment-timestamps', status: 'partial', limitations: ['Reference text has not received human language approval.', 'Sentence units inherit source segment bounds; no word timing is claimed.'] },
  };
  const sourceAudio = JSON.parse(await run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,sample_rate,channels', '-of', 'json', audioPath]));
  const report = {
    schemaVersion: '1.0', fixture: { audio: audioPath, sourceWindow: { start: 4020, end: 4140, duration: 120 }, audioMetadata: sourceAudio },
    transcriptionConfiguration: { binary: '/opt/homebrew/bin/whisper-cli', version: '1.9.2', language: 'bn', task: 'transcribe', languageDetection: 'forced by -l bn; no automatic detection flag used', translation: 'not enabled', prompt: null, conditionOnPreviousText: 'default; no explicit disabling flag supplied', decoding: 'whisper.cpp defaults; observed 5 beams + best of 5', output: ['-oj', '-ojf'] },
    sources: candidates.map(({ text, ...candidate }) => candidate),
    integrity,
    qualityComparison: { referenceIsGroundTruth: false, status: 'HUMAN LANGUAGE REVIEW REQUIRED', notes: ['Script integrity is measurable; semantic accuracy, Bible names, code-switching, and sentence completeness require Bengali listening review.', 'ASR/reference edit distance is not reported because the reference is not verified ground truth and the scripts differ materially.'] },
    canonicalStrategy: { option: 'B', source: 'existing-project', approved: false, reason: 'Preserve the existing Bengali transcript as reviewed-source candidate and attach timing metadata without promoting local ASR text.' },
    sentenceSegmentation: { count: sentences.length, sentences, timingPolicy: 'Sentence units inherit source segment bounds; units marked low when one segment contains multiple punctuation-delimited sentences.' },
    safeEditing: { wordLevel: 'disabled', sentenceLevel: 'review', segmentLevel: 'supported', sampleRanges: referenceSegments.map((segment) => ({ start: segment.start, end: segment.end, sourceSegmentIds: [segment.id], humanReview: 'HUMAN LANGUAGE REVIEW REQUIRED' })) },
    futureDirectorSupport: ['section detection', 'sermon points', 'Bible references', 'illustrations', 'stories', 'prayer', 'emotional sections', 'speaker position', 'Bangla graphics', 'Scripture cards', 'B-roll timing', 'visual intensity'],
    captions: { supported: ['sentence', 'phrase', 'segment'], karaokeWordHighlighting: 'disabled' },
    cacheInvalidation: { source: ['audio', 'transcript', 'sentence-segmentation', 'sermon-analysis', 'edit-plan', 'captions', 'render'], transcriptText: transcriptInvalidates('text'), transcriptTiming: transcriptInvalidates('timing'), presentationOnly: transcriptInvalidates('presentation') },
    recommendation: 'CONDITIONAL GO',
  };
  await writeJson(join(artifacts, 'transcript-integrity-gate.json'), report);
  await writeJson(join(artifacts, 'canonical-transcript-candidate.json'), canonicalCandidate);
  console.log(JSON.stringify({ recommendation: report.recommendation, integrity, sentenceCount: sentences.length, artifact: join(artifacts, 'transcript-integrity-gate.json') }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
