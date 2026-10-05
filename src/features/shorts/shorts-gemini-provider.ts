import { GoogleGenAI, Type, Schema } from '@google/genai';
import type { ExtractedShort, ShortsExtractionInput, ShortsExtractionResult } from './shorts-model.ts';
import { validateExtractedShorts, type ShortsProvider } from './shorts-extractor.ts';

export class GeminiShortsProvider implements ShortsProvider {
  name = 'gemini-shorts-extractor';
  
  constructor(private modelName: string = 'gemini-3.1-pro-preview') {}

  async extract(input: ShortsExtractionInput): Promise<ShortsExtractionResult> {
    const startMs = Date.now();
    const transcriptText = input.segments.map((s, i) => `[${i}] ${s.text}`).join('\n');
    console.log(`Transcript length: ${transcriptText.length} characters`);
    const maxShorts = input.maxShortsToExtract ?? 5;

    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        shorts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'A catchy, viral-style title for the short' },
              subtitle: { type: Type.STRING, description: 'A descriptive subtitle' },
              hookExplanation: { type: Type.STRING, description: 'Explain why the first 3 seconds will retain viewers' },
              viralScore: { type: Type.NUMBER, description: 'Estimated viral potential out of 10' },
              startSegmentIndex: { type: Type.NUMBER, description: 'The index of the first segment' },
              endSegmentIndex: { type: Type.NUMBER, description: 'The index of the last segment (inclusive)' },
              targetDuration: { type: Type.NUMBER, description: 'Target duration in seconds (30, 60, 90, or 120)' }
            },
            required: ['title', 'subtitle', 'hookExplanation', 'viralScore', 'startSegmentIndex', 'endSegmentIndex', 'targetDuration']
          }
        }
      },
      required: ['shorts']
    };

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: this.modelName,
      contents: `Extract viral shorts from this transcript:\n\n${transcriptText}`,
      config: {
        systemInstruction: `You are a world-class short-form video producer (TikTok, Reels, Shorts).
Your goal is to extract the most engaging, viral, and standalone clips from the provided transcript.
The transcript is broken down into numbered segments.

RULES:
1. Extract up to ${maxShorts} shorts.
2. A short must span at least 30 and at most 120 real physical seconds based on the supplied segment timestamps. Select the strongest semantic excerpt; do not default to the entire transcript unless it is genuinely the strongest standalone candidate. If the strongest moment is shorter than 30 seconds, include adjacent context segments until the continuous physical range is at least 30 seconds. Never return a range shorter than 30 seconds.
3. The content MUST be entirely self-contained (Standalone). It should not require external context.
3b. IMPORTANT: The selected startSegmentIndex MUST be the beginning of a complete thought or sentence. Do NOT start mid-sentence. If in doubt, starting at index 0 is highly reliable.
4. It MUST have a strong hook (the first 3-5 seconds).
5. Specify the exact continuous range of segment indices to use.
6. The content is generic video (could be a podcast, sermon, interview, or tutorial) - do not assume a specific domain unless it is evident in the text.
7. Return your response matching the specified JSON schema exactly.`,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    });

    const parsed = JSON.parse(response.text ?? '{"shorts":[]}');
    if (!Array.isArray(parsed.shorts)) throw new Error('Gemini returned an invalid Shorts response.');

    const extracted: ExtractedShort[] = parsed.shorts.map((s: any, i: number) => {
      const startIndex = Number(s.startSegmentIndex);
      const endIndex = Number(s.endSegmentIndex);
      const sourceSegmentIds: string[] = [];
      if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex < 0 || endIndex < startIndex || endIndex >= input.segments.length) {
        return {
          id: `short-${input.projectId}-${i}`,
          title: String(s.title ?? ''),
          subtitle: String(s.subtitle ?? ''),
          hookExplanation: String(s.hookExplanation ?? ''),
          viralScore: Number(s.viralScore),
          sourceSegmentIds,
          sourceStartSeconds: 0,
          sourceEndSeconds: 0,
          durationEstimateSeconds: 0,
          targetDuration: Number(s.targetDuration) as ExtractedShort['targetDuration'],
        };
      }
      for (let idx = startIndex; idx <= endIndex; idx++) {
        if (input.segments[idx]) {
          sourceSegmentIds.push(input.segments[idx].id);
        }
      }
      const estimatedDuration = input.segments[endIndex].end - input.segments[startIndex].start;
      
      return {
        id: `short-${input.projectId}-${i}`,
        title: s.title,
        subtitle: s.subtitle,
        hookExplanation: s.hookExplanation,
        viralScore: s.viralScore,
        sourceSegmentIds,
        sourceStartSeconds: input.segments[startIndex].start,
        sourceEndSeconds: input.segments[endIndex].end,
        durationEstimateSeconds: estimatedDuration,
        targetDuration: s.targetDuration
      };
    });

    const validationErrors = validateExtractedShorts(extracted, { ...input, maxShortsToExtract: maxShorts });
    if (validationErrors.length) throw new Error(`Gemini Short recommendations failed validation: ${validationErrors.join(' ')}`);

    return {
      shorts: extracted,
      model: this.modelName,
      provider: this.name,
      runtimeMs: Date.now() - startMs
    };
  }
}
