import assert from 'node:assert/strict';
import type { TranscriptDocument, TranscriptSegment } from '../src/contracts.ts';
import { normalizeWhisperText } from '../src/foundation.ts';
import { correctShortBoundaries } from '../src/features/shorts/boundary-validator.ts';
import type { ExtractedShort } from '../src/features/shorts/shorts-model.ts';
import { measureTranscriptIntegrity, transcriptQualityFailures } from '../src/transcript-integrity.ts';

function makeSegment(
  id: string,
  start: number,
  end: number,
  text: string,
  wordStart: number,
  wordEnd: number,
): TranscriptSegment {
  return {
    id,
    start,
    end,
    text,
    language: /[\u0980-\u09ff]/u.test(text) ? 'bn' : 'en',
    words: [{ id: `word-${id}`, text, start: wordStart, end: wordEnd, language: 'mixed' }],
  };
}

function makeSegmentWithoutWords(id: string, start: number, end: number, text: string): TranscriptSegment {
  return {
    id,
    start,
    end,
    text,
    language: /[\u0980-\u09ff]/u.test(text) ? 'bn' : 'en',
  };
}

function transcript(segments: TranscriptSegment[]): TranscriptDocument {
  const text = segments.map((segment) => segment.text).join(' ');
  return {
    schemaVersion: '1.0',
    projectId: 'phase7b-fixture',
    originalTranscript: text,
    aiSuggestedDisplayText: text,
    approvedDisplayText: text,
    language: 'mixed',
    textSource: 'local-asr',
    approved: false,
    timingConfidence: 'review',
    source: 'whisper-cli',
    model: 'fixture-multilingual',
    segments,
    immutableOriginal: true,
    alignment: { provider: 'fixture', status: 'partial', limitations: [] },
  };
}

const segments = [
  makeSegment('s1', 0, 13.2, 'A complete opening statement.', 0.2, 13.0),
  makeSegment('s2', 13.5, 24.9, 'The context continues without a conclusion', 13.7, 24.8),
  makeSegment('s3', 25.1, 45, 'This sentence reaches a complete thought.', 25.3, 44.7),
  makeSegment('s4', 45.8, 60, 'Speech continues actively without punctuation', 46, 59.9),
  makeSegment('s5', 60.1, 70, 'Then the speaker completes the point.', 60.3, 67),
  makeSegment('s6', 71, 80, 'A new sentence begins here.', 71.2, 79.8),
];

const candidate: ExtractedShort = {
  id: 'short-fixture',
  title: 'Complete thought',
  subtitle: 'A boundary safety fixture',
  hookExplanation: 'Test candidate.',
  viralScore: 8,
  sourceSegmentIds: ['s3', 's4'],
  sourceStartSeconds: 25.1,
  sourceEndSeconds: 60,
  durationEstimateSeconds: 34.9,
  targetDuration: 60,
};

const corrected = correctShortBoundaries(candidate, transcript(segments), 80);
assert.equal(corrected.sourceStartSeconds, 13.5, 'unsafe opening moves back to the prior speech boundary');
assert.equal(corrected.sourceEndSeconds, 70, 'active speech extends through the complete next thought');
assert.deepEqual(corrected.sourceSegmentIds, ['s2', 's3', 's4', 's5']);
assert.equal(corrected.aiSuggestedStartSeconds, 25.1);
assert.equal(corrected.aiSuggestedEndSeconds, 60);
assert.match(corrected.boundaryAdjustmentReason ?? '', /complete thought/u);

const sourceLimited = correctShortBoundaries(candidate, transcript(segments), 68);
assert.equal(sourceLimited.sourceEndSeconds, 68, 'physical duration clamps the corrected endpoint');
assert.ok(sourceLimited.sourceEndSeconds <= 68, 'corrected end never exceeds the verified source');

const segmentTimedTranscript = transcript([
  makeSegmentWithoutWords('segment-only-1', 0, 20, 'এটি একটি সম্পূর্ণ বাক্য।'),
makeSegmentWithoutWords('segment-only-2', 21, 40, 'This thought remains unfinished'),
]);
const segmentTimedCandidate: ExtractedShort = {
  ...candidate,
  id: 'segment-timed-fixture',
  sourceSegmentIds: ['segment-only-1'],
  sourceStartSeconds: 0,
  sourceEndSeconds: 20,
  durationEstimateSeconds: 20,
};
const segmentTimedCorrection = correctShortBoundaries(segmentTimedCandidate, segmentTimedTranscript, 40);
assert.equal(segmentTimedCorrection.sourceEndSeconds, 20, 'segment timing supports safe boundaries without word timing');
assert.throws(
  () => correctShortBoundaries({ ...segmentTimedCandidate, sourceSegmentIds: ['segment-only-2'], sourceStartSeconds: 21, sourceEndSeconds: 40 }, segmentTimedTranscript, 40),
  /complete-thought boundary/u,
  'unterminated final segment cannot be accepted as a complete endpoint',
);
assert.throws(
  () => correctShortBoundaries({
    ...segmentTimedCandidate,
    id: 'ellipsis-fixture',
    sourceSegmentIds: ['segment-only-2'],
    sourceStartSeconds: 21,
    sourceEndSeconds: 40,
  }, transcript([makeSegmentWithoutWords('segment-only-2', 21, 40, 'This thought trails off...')]), 40),
  /complete-thought boundary/u,
  'an ellipsis cannot be treated as a complete final thought',
);

const placeholder = '(speaking in foreign language)';
assert.equal(measureTranscriptIntegrity(placeholder, [{ text: placeholder }]).status, 'FAIL');
assert.ok(transcriptQualityFailures(placeholder, [{ text: placeholder }], 'bn').some((failure) => failure.includes('TRANSCRIPTION_PLACEHOLDER')));
const malformed = normalizeWhisperText(`বাংলা\ufffd`);
assert.equal(malformed, `বাংলা\ufffd`, 'malformed transcription markers are not silently erased');
assert.ok(transcriptQualityFailures(malformed, [{ text: malformed }], 'bn').some((failure) => failure.includes('TRANSCRIPTION_MALFORMED_UNICODE')));

const mixed = 'আমরা faith নিয়ে কথা বলি। God is faithful.';
assert.equal(normalizeWhisperText(mixed), mixed, 'native Bengali and English code-switching are preserved');
assert.deepEqual(transcriptQualityFailures(mixed, [{ text: mixed }], 'mixed'), [], 'mixed-script speech remains usable');

const english = 'The speaker explains grace and faith clearly.';
assert.equal(normalizeWhisperText(english), english);
assert.deepEqual(transcriptQualityFailures(english, [{ text: english }], 'en'), [], 'valid English transcription remains usable');

const devanagariAsr = normalizeWhisperText('आपनार कासे अमादे किसु दाबी आचे।');
assert.equal(devanagariAsr, 'आपनार कासे अमादे किसु दाबी आचे।', 'non-Bengali script is not transliterated into Bengali');
assert.ok(transcriptQualityFailures(devanagariAsr, [{ text: devanagariAsr }], 'bn').some((failure) => failure.includes('TRANSCRIPTION_SCRIPT_MISMATCH')));

console.log(JSON.stringify({
  status: 'PASS',
  suite: 'phase7b',
  checks: [
    'foreign-language placeholders fail transcript quality',
    'non-Bengali ASR script and malformed Unicode are rejected',
    'Bengali and English code-switching is preserved',
    'valid English transcription remains accepted',
    'unsafe Short opening moves to a natural boundary',
    'active-speech ending extends through the complete thought',
    'corrected end remains within physical source duration',
  ],
}, null, 2));
