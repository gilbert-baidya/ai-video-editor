import { GoogleGenAI, Type } from '@google/genai';
import { readFile } from 'node:fs/promises';
import type { TranscriptionInput, TranscriptionProvider } from './transcription-provider.ts';
import type { TranscriptDocument, TranscriptSegment, TranscriptWord } from '../../contracts.ts';

type ProviderWord = { text?: string; start?: number; end?: number };
type ProviderSegment = {
  start?: number;
  end?: number;
  text?: string;
  language?: string;
  words?: ProviderWord[];
};

function languageProfile(value: string | undefined): 'bn' | 'en' | 'mixed' {
  return value === 'bn' || value === 'en' || value === 'mixed' ? value : 'mixed';
}

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  name = 'gemini-cloud-asr';
  private readonly modelName = process.env.GEMINI_ASR_MODEL || 'gemini-3.1-pro-preview';

  async transcribe(input: TranscriptionInput): Promise<TranscriptDocument> {
    if (!(input.physicalDurationSeconds > 0)) throw new Error('Cloud transcription requires a verified physical source duration.');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const audioBytes = (await readFile(input.audioPath)).toString('base64');
    const languageHint = input.language === 'bn'
      ? 'The recording is primarily Bengali and may code-switch into English.'
      : input.language === 'en'
        ? 'The recording is primarily English.'
        : 'The recording may contain Bengali, English, and natural Bengali-English code-switching.';
    const response = await ai.models.generateContent({
      model: this.modelName,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: audioBytes, mimeType: 'audio/wav' } },
          {
            text: `Listen to this audio. ${languageHint} Transcribe, do not translate. Bengali speech MUST use Bengali script. Preserve words spoken in English as English Latin text, including names, Bible references, and complete English phrases; do not transliterate English into Bengali. Return JSON with a segments array. Each segment must contain text, language (bn, en, or mixed), start, end, and words. Each word must contain text, start, and end. Use seconds, not percentages or normalized 0-1 values. Segment and word timestamps must remain within the verified physical duration of ${input.physicalDurationSeconds.toFixed(3)} seconds. Do not invent a repeated tail or speech after the source ends. Leave real pauses between segments when present.`,
          },
        ],
      }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                  language: { type: Type.STRING },
                  words: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                      },
                      required: ['text', 'start', 'end'],
                    },
                  },
                },
                required: ['start', 'end', 'text'],
              },
            },
          },
          required: ['segments'],
        },
      },
    });
    const parsed = JSON.parse(response.text ?? '{"segments":[]}') as { segments?: ProviderSegment[] };
    if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) throw new Error('Gemini ASR returned no transcript segments.');

    const segments: TranscriptSegment[] = [];
    let wordTimingLimitation = false;
    let previousStart = -1;
    for (let index = 0; index < parsed.segments.length; index += 1) {
      const raw = parsed.segments[index];
      const text = raw.text?.trim() ?? '';
      const start = Number(raw.start);
      const end = Number(raw.end);
      if (!text) continue;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > input.physicalDurationSeconds || start < previousStart) {
        throw new Error(`Gemini ASR returned an invalid segment range ${String(raw.start)}-${String(raw.end)}.`);
      }
      const segmentLanguage = languageProfile(raw.language);
      const normalizedWords: TranscriptWord[] = [];
      let invalidWordTiming = false;
      for (const [wordIndex, word] of (raw.words ?? []).entries()) {
        const wordStart = Number(word.start);
        const wordEnd = Number(word.end);
        if (!word.text?.trim() || !Number.isFinite(wordStart) || !Number.isFinite(wordEnd)
          || wordStart < start || wordEnd <= wordStart || wordEnd > end) {
          invalidWordTiming = true;
          break;
        }
        normalizedWords.push({
          id: `word-${index + 1}-${wordIndex + 1}`,
          text: word.text.trim(),
          start: wordStart,
          end: wordEnd,
          language: segmentLanguage,
        });
      }
      const words = invalidWordTiming ? undefined : normalizedWords;
      if (invalidWordTiming) wordTimingLimitation = true;
      segments.push({
        id: `segment-${segments.length + 1}`,
        start,
        end,
        text,
        language: segmentLanguage,
        ...(words ? { words } : {}),
      });
      previousStart = start;
    }
    if (!segments.length) throw new Error('Gemini ASR returned no non-empty transcript segments.');
    const originalTranscript = segments.map((segment) => segment.text).join(' ');
    const hasBn = segments.some((segment) => segment.language === 'bn' || segment.language === 'mixed');
    const hasEn = segments.some((segment) => segment.language === 'en' || segment.language === 'mixed');
    const language = hasBn && hasEn ? 'mixed' : hasBn ? 'bn' : 'en';
    return {
      schemaVersion: '1.2',
      projectId: input.projectId,
      originalTranscript,
      aiSuggestedDisplayText: originalTranscript,
      approvedDisplayText: originalTranscript,
      language,
      textSource: 'cloud-asr',
      transcriptionProvider: this.name,
      transcriptionModel: this.modelName,
      approved: false,
      timingConfidence: segments.some((segment) => (segment.words ?? []).length > 0) ? 'word-safe' : 'segment-safe',
      source: 'cloud-asr',
      model: this.modelName,
      segments,
      immutableOriginal: true,
      alignment: {
        provider: this.name,
        status: segments.some((segment) => (segment.words ?? []).length > 0) && !wordTimingLimitation ? 'verified' : 'partial',
        limitations: wordTimingLimitation
          ? ['The provider returned malformed optional word timing; segment timing was retained without fabricated replacement words.']
          : segments.some((segment) => (segment.words ?? []).length > 0)
            ? []
            : ['The provider returned segment timing without word timing.'],
      },
    };
  }
}
