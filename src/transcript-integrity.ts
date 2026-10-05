import type { TranscriptSegment, TranscriptSentence } from './contracts.ts';

const bengaliScript = /\p{Script=Bengali}/u;
const devanagariScript = /\p{Script=Devanagari}/u;
const latinRange = /[A-Za-z]/u;

export interface TranscriptIntegrityMetrics {
  characters: number;
  Bengali: number;
  Devanagari: number;
  Latin: number;
  unexpectedIndic: number;
  unknown: number;
  replacementCharacters: number;
  malformedUnicode: number;
  emptySegments: number;
  foreignLanguagePlaceholderCount: number;
  repeatedPhraseCount: number;
  suspiciousScriptSwitches: number;
  BengaliPercentage: number;
  DevanagariPercentage: number;
  LatinPercentage: number;
  unknownPercentage: number;
  status: 'PASS' | 'REVIEW' | 'FAIL';
}

function isLetter(character: string): boolean {
  return /\p{L}/u.test(character);
}

function percentage(value: number, total: number): number {
  return total ? Number(((value / total) * 100).toFixed(2)) : 0;
}

export function measureTranscriptIntegrity(text: string, segments: Array<{ text: string }>): TranscriptIntegrityMetrics {
  const counts = { Bengali: 0, Devanagari: 0, Latin: 0, unknown: 0 };
  let suspiciousScriptSwitches = 0;
  let previousScript = '';
  for (const character of text.normalize('NFC')) {
    const script = bengaliScript.test(character) && isLetter(character)
      ? 'Bengali'
      : devanagariScript.test(character) && isLetter(character)
        ? 'Devanagari'
        : latinRange.test(character) && isLetter(character)
          ? 'Latin'
          : isLetter(character)
            ? 'unknown'
            : '';
    if (script) {
      counts[script as keyof typeof counts] += 1;
      if (previousScript && previousScript !== script) suspiciousScriptSwitches += 1;
      previousScript = script;
    }
  }
  const letters = counts.Bengali + counts.Devanagari + counts.Latin + counts.unknown;
  const repeatedPhraseCount = (text.match(/(.{3,24})\1{2,}/gu) ?? []).length;
  const foreignLanguagePlaceholderCount = segments.filter((segment) =>
    /\(\s*speaking in (?:a )?foreign language\s*\)|\[\s*foreign language\s*\]/iu.test(segment.text),
  ).length;
  const unexpectedIndic = counts.Devanagari;
  const status = foreignLanguagePlaceholderCount > 0
    ? 'FAIL'
    : unexpectedIndic > 0 || counts.unknown > 0 || text.includes('\ufffd') || repeatedPhraseCount > 0
      ? 'REVIEW'
      : 'PASS';
  return {
    characters: text.length,
    ...counts,
    unexpectedIndic,
    malformedUnicode: [...text].filter((character) => character === '\ufffd').length,
    replacementCharacters: text.split('\ufffd').length - 1,
    emptySegments: segments.filter((segment) => !segment.text.trim()).length,
    foreignLanguagePlaceholderCount,
    repeatedPhraseCount,
    suspiciousScriptSwitches,
    BengaliPercentage: percentage(counts.Bengali, letters),
    DevanagariPercentage: percentage(counts.Devanagari, letters),
    LatinPercentage: percentage(counts.Latin, letters),
    unknownPercentage: percentage(counts.unknown, letters),
    status,
  };
}

export function transcriptQualityFailures(
  text: string,
  segments: Array<{ text: string }>,
  language: string,
): string[] {
  const failures: string[] = [];
  const metrics = measureTranscriptIntegrity(text, segments);
  if (!segments.length || !text.trim()) failures.push('TRANSCRIPTION_EMPTY: Whisper did not produce usable transcript text.');
  if (metrics.foreignLanguagePlaceholderCount) {
    failures.push('TRANSCRIPTION_PLACEHOLDER: Generic foreign-language placeholders were detected; AI analysis and captions are blocked.');
  }
  if (metrics.malformedUnicode) {
    failures.push('TRANSCRIPTION_MALFORMED_UNICODE: Replacement characters were detected; text integrity is not safe for analysis or captions.');
  }
  if (metrics.Devanagari > 0) {
    failures.push('TRANSCRIPTION_SCRIPT_MISMATCH: Devanagari ASR output cannot be treated as Bengali text; the original transcription must use the accurate native script.');
  } else if (metrics.status === 'REVIEW' && !metrics.malformedUnicode) {
    failures.push('TRANSCRIPTION_QUALITY_REVIEW: Transcript contains suspicious script, Unicode, or repeated-text output and requires a reliable transcription before analysis.');
  }
  if (language === 'bn' && metrics.Bengali === 0) {
    failures.push('TRANSCRIPTION_BENGALI_MISSING: Bengali was expected, but no Bengali-script text was produced.');
  }
  return [...new Set(failures)];
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[।!?！？])/u).map((part) => part.trim()).filter(Boolean);
}

export function buildTranscriptSentences(segments: TranscriptSegment[]): TranscriptSentence[] {
  return segments.flatMap((segment) => {
    const parts = splitSentences(segment.text);
    const hasSentenceTerminator = /[।!?！？]\s*$/u.test(segment.text);
    return (parts.length ? parts : [segment.text.trim()]).map((text, index) => ({
      id: `${segment.id}-sentence-${index + 1}`,
      text,
      start: segment.start,
      end: segment.end,
      sourceSegmentIds: [segment.id],
      confidence: parts.length === 1 && hasSentenceTerminator ? 'medium' : 'low',
    }));
  });
}

export function transcriptInvalidates(input: 'text' | 'timing' | 'presentation'): string[] {
  if (input === 'presentation') return ['render'];
  if (input === 'timing') return ['sermon-analysis', 'edit-plan', 'captions', 'render'];
  return ['sentence-segmentation', 'sermon-analysis', 'edit-plan', 'captions', 'render'];
}
