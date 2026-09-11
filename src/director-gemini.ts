import { detectCoarseSegmentation } from './director.js';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import type {
  DirectorProvider,
  DirectorProviderResult,
  DirectorProviderAvailability,
  DirectorInput,
  ProviderAttempt,
  DirectorEditorialEnrichmentRequest,
} from './director.ts';
import {
  DIRECTOR_PROMPT_SCHEMA_VERSION,
  validateDirectorInput,
  semanticAnalysisPromptFor,
  validateClassificationAmbiguity,
  semanticReconciliationPromptFor,
  visualDecisionPromptFor,
  editorialEnrichmentPromptFor,
  validateAIResponse,
  resolveAIResponse,
} from './director.ts';
import { resolvePrimarySegmentIds, validateCanonicalCoverage } from './canonical-coverage.ts';
import { sha256 } from './foundation.ts';

const semanticSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    overallSemanticRole: { type: Type.STRING, description: "The overarching narrative form (e.g. 'story', 'teaching')." },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sectionType: { type: Type.STRING },
          secondaryType: { type: Type.STRING },
          semanticFunction: { type: Type.STRING, description: "The narrative function of this specific section (e.g. 'setup', 'problem', 'conflict', 'turning-point', 'main-point', 'application', 'conclusion')." },
          startIndex: { type: Type.INTEGER, description: "Integer index of the starting segment (0-based array index, NOT a timestamp)." },
          endIndex: { type: Type.INTEGER, description: "Integer index of the ending segment (0-based array index, NOT a timestamp)." },
          semanticConfidence: { type: Type.NUMBER },
          semanticEvidence: { type: Type.STRING },
          boundaryReason: { type: Type.STRING, description: "Why does this section start here? E.g., 'topic shift', 'conflict introduced', 'rhetorical question'." },
        },
        required: ["sectionType", "semanticFunction", "startIndex", "endIndex", "semanticConfidence", "semanticEvidence", "boundaryReason"]
      }
    },
    overallConfidence: { type: Type.NUMBER }
  },
  required: ["overallSemanticRole", "sections", "overallConfidence"]
};

const visualSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sectionType: { type: Type.STRING },
          secondaryType: { type: Type.STRING },
          startIndex: { type: Type.INTEGER, description: "MUST exactly match the startIndex index from the input semantic classification. Do NOT output timestamps." },
          endIndex: { type: Type.INTEGER, description: "MUST exactly match the endIndex index from the input semantic classification. Do NOT output timestamps." },
          planningContext: {
            type: Type.OBJECT,
            description: "Reflect on the recent visual treatment history BEFORE making a decision for this section.",
            properties: {
              previousVisualType: { type: Type.STRING },
              previousEditorialIntent: { type: Type.STRING },
              secondsSinceLastMeaningfulEdit: { type: Type.NUMBER },
              recentBrollCount: { type: Type.INTEGER },
              recentTextCount: { type: Type.INTEGER },
              recentReframeCount: { type: Type.INTEGER }
            }
          },
          intensity: { type: Type.STRING },
          editorialIntent: { type: Type.STRING },
          suggestedDisplayText: { type: Type.STRING },
          scriptureReference: { type: Type.STRING },
          visualRecommendation: { type: Type.STRING },
          brollIntent: {
            type: Type.OBJECT,
            properties: {
              subject: { type: Type.STRING },
              action: { type: Type.STRING },
              setting: { type: Type.STRING },
              mood: { type: Type.STRING },
              visualPurpose: { type: Type.STRING },
              exclusions: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["subject", "action", "setting", "mood", "visualPurpose", "exclusions"]
          },
          confidence: { type: Type.NUMBER },
          reason: { type: Type.STRING }
        },
        required: ["sectionType", "startIndex", "endIndex", "intensity", "editorialIntent", "visualRecommendation", "confidence", "reason"]
      }
    },
    overallConfidence: { type: Type.NUMBER }
  },
  required: ["sections", "overallConfidence"]
};

export class GeminiDirectorProvider implements DirectorProvider {
  name = 'gemini';
  model: string;
  cacheIdentity: string;
  private maxAttempts: number;

  constructor() {
    this.model = process.env.GEMINI_DIRECTOR_MODEL || 'gemini-3.1-pro-preview';
    this.maxAttempts = 2;
    this.cacheIdentity = sha256(JSON.stringify({
      adapter: 'gemini-director-v1.0',
      model: this.model,
      attempts: this.maxAttempts,
      promptSchema: DIRECTOR_PROMPT_SCHEMA_VERSION,
    }));
  }

  async checkAvailability(): Promise<DirectorProviderAvailability> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return {
        available: false,
        reason: 'GEMINI_API_KEY environment variable is missing.',
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      available: true,
      checkedAt: new Date().toISOString(),
    };
  }

  private async generate(
    input: DirectorInput,
    prompt: string,
    phase: 'analysis' | 'coverage-repair' | 'editorial-enrichment',
    requiredSegmentIds: string[],
    schema: Schema,
    attemptLimit = this.maxAttempts,
  ): Promise<DirectorProviderResult> {
    validateDirectorInput(input);
    const started = Date.now();
    const attempts: ProviderAttempt[] = [];
    const rawResponses: DirectorProviderResult['rawResponses'] = [];
    let lastError = 'Unknown structured-output failure';
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { providerResult: 'provider-unavailable', provider: this.name, model: this.model, runtimeMs: 0, attempts: [], rawResponses: [], error: 'GEMINI_API_KEY missing' };
    }
    const ai = new GoogleGenAI({ apiKey });

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      const attemptStarted = Date.now();
      const record: ProviderAttempt & { inputTokenCount?: number; outputTokenCount?: number; totalTokenCount?: number; errorCategory?: string } = { attempt, parse: 'fail', schema: 'fail', segmentReferences: 'fail', semanticOutput: 'fail', canonicalCoverage: 'not-run', runtimeMs: 0, phase };
      try {
        const response = await ai.models.generateContent({
          model: this.model,
          contents: prompt,
          config: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: schema,
          }
        });

        if (response.usageMetadata) {
          record.inputTokenCount = response.usageMetadata.promptTokenCount;
          record.outputTokenCount = response.usageMetadata.candidatesTokenCount;
          record.totalTokenCount = response.usageMetadata.totalTokenCount;
        }

        const text = response.text || '';
        rawResponses.push({ attempt, field: 'response', text });

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
          record.parse = 'pass';
        } catch {
          lastError = `Attempt ${attempt}: response was not parseable JSON`;
          throw new Error(lastError);
        }

        const semantic = validateAIResponse(parsed, input.segments.length);
        record.schema = 'pass';
        record.segmentReferences = 'pass';
        record.semanticOutput = semantic.sections.length ? 'pass' : 'fail';
        if (record.semanticOutput !== 'pass') throw new Error('AI response contained no semantic sections.');
        const analysis = resolveAIResponse(semantic, input);
        const coverage = validateCanonicalCoverage(analysis.sections, { segments: input.segments, primarySegmentIds: requiredSegmentIds });
        record.canonicalCoverage = coverage.complete ? 'pass' : 'fail';
        record.runtimeMs = Date.now() - attemptStarted;
        if (!coverage.complete) {
          attempts.push(record);
          lastError = `Attempt ${attempt}: canonical coverage incomplete. ${coverage.failures.join(' ')}`;
          record.error = lastError;
          record.errorCategory = 'COVERAGE';
          continue;
        }
        attempts.push(record);
        return { providerResult: attempt === 1 ? 'ai-success' : 'ai-retry-success', provider: this.name, model: this.model, runtimeMs: Date.now() - started, attempts, rawResponses, analysis };
      } catch (error) {
        record.runtimeMs = Date.now() - attemptStarted;
        record.error = error instanceof Error ? error.message : String(error);
        lastError = record.error;
        if (record.error.includes('JSON')) record.errorCategory = 'SCHEMA';
        else if (record.error.includes('fetch') || record.error.includes('network') || record.error.includes('timeout')) record.errorCategory = 'NETWORK';
        else if (record.error.includes('429')) record.errorCategory = 'RATE_LIMIT';
        else if (record.error.includes('401') || record.error.includes('403')) record.errorCategory = 'AUTH';
        else record.errorCategory = 'MODEL';
        attempts.push(record);
      }
    }
    return { providerResult: 'provider-failure', provider: this.name, model: this.model, runtimeMs: Date.now() - started, attempts, rawResponses, error: lastError };
  }

  async analyze(input: DirectorInput): Promise<DirectorProviderResult> {
    const required = resolvePrimarySegmentIds(input.segments, input.primarySegmentIds);

    // Pass 1: Semantics
    let semanticResult = await this.generate(input, semanticAnalysisPromptFor(input), 'analysis', required, semanticSchema);
    if (semanticResult.providerResult !== 'ai-success' && semanticResult.providerResult !== 'ai-retry-success') return semanticResult;

    // Diagnostics and Coarse Segmentation check
    const diagnostics = detectCoarseSegmentation(semanticResult.analysis!, input.projectDuration);

    if (diagnostics.coarseSegmentationRisk !== 'NORMAL') {
      const reason = `Coarse segmentation detected (${diagnostics.coarseSegmentationRisk}). The timeline is ${input.projectDuration}s but produced ${diagnostics.sectionCount} section(s). The longest is ${diagnostics.longestSectionDuration}s. Refine boundaries where semantic intent changes (e.g., from 'story' to 'main-point', or new story event).`;
      const reconResult = await this.generate(input, semanticAnalysisPromptFor(input, reason), 'analysis', required, semanticSchema, 1);
      if (reconResult.providerResult === 'ai-success' || reconResult.providerResult === 'ai-retry-success') {
        semanticResult = reconResult;
      }
    } else {
      // Check for ambiguity
      let ambiguous = false;
      for (const sec of semanticResult.analysis!.sections) {
        if (validateClassificationAmbiguity(sec)) {
          ambiguous = true;
          break;
        }
      }

      if (ambiguous) {
        const reconResult = await this.generate(input, semanticReconciliationPromptFor(input, semanticResult.analysis!.sections), 'analysis', required, semanticSchema, 1);
        if (reconResult.providerResult === 'ai-success' || reconResult.providerResult === 'ai-retry-success') {
          semanticResult = reconResult;
        }
      }
    }

    // Pass 2: Visuals
    const visualResult = await this.generate(input, visualDecisionPromptFor(input, semanticResult.analysis!), 'analysis', required, visualSchema);
    if (visualResult.providerResult !== 'ai-success' && visualResult.providerResult !== 'ai-retry-success') return visualResult;

    // Combine Semantics and Visuals
    const finalSections = semanticResult.analysis!.sections.map(semSec => {
      const visSec = visualResult.analysis!.sections.find(v => v.start === semSec.start && v.end === semSec.end) || visualResult.analysis!.sections.find(v => v.id === semSec.id);
      if (!visSec) return semSec;
      return {
        ...semSec,
        intensity: visSec.intensity,
        visualRecommendation: visSec.visualRecommendation,
        brollIntent: visSec.brollIntent,
        suggestedDisplayText: visSec.suggestedDisplayText,
        scriptureReference: visSec.scriptureReference,
        confidence: visSec.confidence,
        reason: visSec.reason
      };
    });

    return {
      providerResult: semanticResult.providerResult === 'ai-retry-success' || visualResult.providerResult === 'ai-retry-success' ? 'ai-retry-success' : 'ai-success',
      provider: this.name,
      model: this.model,
      runtimeMs: semanticResult.runtimeMs + visualResult.runtimeMs,
      attempts: [...semanticResult.attempts, ...visualResult.attempts],
      rawResponses: [...semanticResult.rawResponses, ...visualResult.rawResponses],
      analysis: { ...semanticResult.analysis!, sections: finalSections }
    };
  }

  async enrichEditorial(request: DirectorEditorialEnrichmentRequest): Promise<DirectorProviderResult> {
    const input = { ...request.input, primarySegmentIds: request.eligibleSegmentIds };
    const required = resolvePrimarySegmentIds(input.segments, input.primarySegmentIds);
    const visualResult = await this.generate(
      input,
      editorialEnrichmentPromptFor({ ...request, input }),
      'editorial-enrichment',
      required,
      visualSchema,
      1,
    );

    if (visualResult.providerResult !== 'ai-success' && visualResult.providerResult !== 'ai-retry-success') return visualResult;

    // Combine Semantics and Visuals for ONLY the sections the AI returned
    const finalSections = visualResult.analysis!.sections
      .filter(visSec => visSec.sourceSegmentIds.some(id => request.eligibleSegmentIds.includes(id)))
      .map(visSec => {
      const semSec = request.currentAnalysis.sections.find(s => s.start === visSec.start && s.end === visSec.end) || request.currentAnalysis.sections.find(s => s.id === visSec.id);
      if (!semSec) return visSec;
      return {
        ...semSec,
        intensity: visSec.intensity,
        visualRecommendation: visSec.visualRecommendation,
        reason: visSec.reason,
        brollIntent: visSec.brollIntent
      };
    });

    return { ...visualResult, analysis: { ...request.currentAnalysis, sections: finalSections } };
  }
}
