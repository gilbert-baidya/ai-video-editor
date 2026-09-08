import type {
  EditOperation,
  EditPlan,
  SermonAnalysis,
  SermonSection,
  SermonSectionType,
  TranscriptDocument,
  TranscriptSegment,
  VideoBeat,
  VisualIntensity,
  VisualRecommendation,
} from './contracts.ts';
import { resolveDisplayText, type ContentTrustPolicy } from './content-trust.ts';
import { sha256, validatePlan } from './foundation.ts';
import { measureTranscriptIntegrity } from './transcript-integrity.ts';

export interface DirectorInput {
  transcript: TranscriptDocument;
  segments: TranscriptSegment[];
  projectDuration: number;
  projectId: string;
}

export interface AISermonSection {
  sectionType: SermonSectionType;
  startSegment: number;
  endSegment: number;
  intensity: VisualIntensity;
  suggestedDisplayText?: string;
  scriptureReference?: string;
  visualRecommendation: VisualRecommendation;
  confidence: number;
  reason: string;
}

export interface AISermonResponse {
  sections: AISermonSection[];
  overallConfidence: number;
}

export interface ProviderAttempt {
  attempt: number;
  parse: 'pass' | 'fail';
  schema: 'pass' | 'fail';
  segmentReferences: 'pass' | 'fail';
  semanticOutput: 'pass' | 'fail';
  runtimeMs: number;
  error?: string;
}

export interface DirectorProviderResult {
  providerResult: 'ai-success' | 'ai-retry-success' | 'provider-unavailable' | 'provider-failure' | 'deterministic-fallback';
  provider: string;
  model: string;
  runtimeMs: number;
  attempts: ProviderAttempt[];
  rawResponses: Array<{ attempt: number; field: 'response' | 'thinking'; text: string }>;
  analysis?: SermonAnalysis;
  error?: string;
}

export interface DirectorProviderAvailability {
  available: boolean;
  reason?: string;
  checkedAt: string;
}

export interface DirectorProviderConfig {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  attempts?: number;
  disableThinking?: boolean;
}

export interface DirectorProvider {
  name: string;
  model: string;
  cacheIdentity: string;
  checkAvailability?(): Promise<DirectorProviderAvailability>;
  analyze(input: DirectorInput): Promise<DirectorProviderResult>;
}

export const DIRECTOR_PROMPT_SCHEMA_VERSION = 'director-prompt-schema-v1.1';

const sectionTypes = new Set<SermonSectionType>(['introduction', 'scripture-reading', 'teaching', 'main-point', 'illustration', 'story', 'testimony', 'question', 'application', 'transition', 'prayer', 'emotional-ministry', 'conclusion', 'altar-call']);
const intensities = new Set<VisualIntensity>(['reverent-calm', 'normal-teaching', 'story-illustration', 'emphasis']);
const visualRecommendations = new Set<VisualRecommendation>(['speaker-full', 'speaker-left', 'speaker-right', 'speaker-punch-in', 'scripture-card', 'title-card', 'keyword-graphic', 'image-broll', 'video-broll', 'motion-graphic', 'split-screen', 'none']);

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function optionalStringValue(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return stringValue(value, name);
}

function numberValue(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

export function validateAIResponse(value: unknown, segmentCount: number): AISermonResponse {
  const root = objectValue(value, 'AI response');
  if (!Array.isArray(root.sections)) throw new Error('AI response sections must be an array.');
  const sections = root.sections.map((candidate, index) => {
    const item = objectValue(candidate, `sections[${index}]`);
    const sectionType = stringValue(item.sectionType, `sections[${index}].sectionType`) as SermonSectionType;
    const intensity = stringValue(item.intensity, `sections[${index}].intensity`) as VisualIntensity;
    const visualRecommendation = stringValue(item.visualRecommendation, `sections[${index}].visualRecommendation`) as VisualRecommendation;
    if (!sectionTypes.has(sectionType)) throw new Error(`Unsupported section type: ${sectionType}`);
    if (!intensities.has(intensity)) throw new Error(`Unsupported intensity: ${intensity}`);
    if (!visualRecommendations.has(visualRecommendation)) throw new Error(`Unsupported visual recommendation: ${visualRecommendation}`);
    const startSegment = numberValue(item.startSegment, `sections[${index}].startSegment`);
    const endSegment = numberValue(item.endSegment, `sections[${index}].endSegment`);
    const confidence = numberValue(item.confidence, `sections[${index}].confidence`);
    if (!Number.isInteger(startSegment) || !Number.isInteger(endSegment) || startSegment < 0 || endSegment < startSegment || endSegment >= segmentCount) throw new Error(`Invalid segment range at sections[${index}]: ${startSegment}-${endSegment}`);
    if (confidence < 0 || confidence > 1) throw new Error(`Invalid confidence at sections[${index}].confidence`);
    return {
      sectionType,
      startSegment,
      endSegment,
      intensity,
      visualRecommendation,
      suggestedDisplayText: optionalStringValue(item.suggestedDisplayText, `sections[${index}].suggestedDisplayText`),
      scriptureReference: optionalStringValue(item.scriptureReference, `sections[${index}].scriptureReference`),
      confidence,
      reason: stringValue(item.reason, `sections[${index}].reason`),
    };
  });
  const overallConfidence = numberValue(root.overallConfidence, 'overallConfidence');
  if (overallConfidence < 0 || overallConfidence > 1) throw new Error('Invalid overallConfidence.');
  for (let index = 1; index < sections.length; index += 1) {
    if (sections[index].startSegment <= sections[index - 1].endSegment) throw new Error(`Sections must be ordered and non-overlapping at sections[${index}].`);
  }
  return { sections, overallConfidence };
}

export function validateDirectorInput(input: DirectorInput): void {
  if (input.projectId !== input.transcript.projectId) throw new Error('Director project ID does not match the canonical transcript.');
  if (input.segments.length !== input.transcript.segments.length) throw new Error('Director segments do not match the canonical transcript segment count.');
  for (let index = 0; index < input.segments.length; index += 1) {
    const supplied = input.segments[index];
    const canonical = input.transcript.segments[index];
    if (supplied.id !== canonical.id || supplied.start !== canonical.start || supplied.end !== canonical.end || supplied.text !== canonical.text) throw new Error(`Director segment ${index} does not match the canonical transcript.`);
  }
  const integrity = measureTranscriptIntegrity(input.transcript.originalTranscript, input.transcript.segments);
  if (integrity.status !== 'PASS' && !input.transcript.approved && input.transcript.textSource !== 'hybrid-reviewed') throw new Error(`Canonical transcript integrity requires review (${integrity.status}).`);
}

function resolveSection(aiSection: AISermonSection, index: number, segments: TranscriptSegment[]): SermonSection {
  const selected = segments.slice(aiSection.startSegment, aiSection.endSegment + 1);
  if (!selected.length || selected.length !== aiSection.endSegment - aiSection.startSegment + 1) throw new Error(`Cannot resolve AI segment range ${aiSection.startSegment}-${aiSection.endSegment}.`);
  const sourceSegmentIds = selected.map((segment) => segment.id);
  return {
    id: `section-${sha256(sourceSegmentIds.join('|')).slice(0, 12)}`,
    start: selected[0].start,
    end: selected[selected.length - 1].end,
    transcriptText: selected.map((segment) => segment.text).join(' '),
    sourceSegmentIds,
    type: aiSection.sectionType,
    intensity: aiSection.intensity,
    suggestedDisplayText: aiSection.suggestedDisplayText,
    scriptureReference: aiSection.scriptureReference,
    visualRecommendation: aiSection.visualRecommendation,
    confidence: aiSection.confidence,
    reason: aiSection.reason,
  };
}

export function resolveAIResponse(response: AISermonResponse, input: DirectorInput): SermonAnalysis {
  validateDirectorInput(input);
  const sections = response.sections.map((item, index) => resolveSection(item, index, input.segments));
  const moments = (type: SermonSectionType) => sections.filter((section) => section.type === type).map((section) => ({ id: section.id, text: section.suggestedDisplayText ?? section.transcriptText, start: section.start, end: section.end, confidence: section.confidence, reason: section.reason }));
  const mainPoint = sections.find((section) => section.type === 'main-point');
  const passage = sections.find((section) => section.scriptureReference);
  return {
    version: '1.1',
    projectId: input.projectId,
    title: mainPoint?.suggestedDisplayText,
    mainTheme: mainPoint?.suggestedDisplayText,
    mainPassage: passage?.scriptureReference ? { rawText: passage.scriptureReference, normalizedReference: passage.scriptureReference, start: passage.start, end: passage.end, confidence: passage.confidence, verificationStatus: 'needs-review' } : undefined,
    supportingPassages: [],
    sections,
    mainPoints: moments('main-point'),
    keyStatements: [],
    illustrations: moments('illustration'),
    stories: moments('story'),
    testimonies: moments('testimony'),
    questions: moments('question'),
    applications: moments('application'),
    prayerMoments: moments('prayer'),
    emotionalMoments: moments('emotional-ministry'),
    conclusion: sections.find((section) => section.type === 'conclusion'),
    altarCall: sections.find((section) => section.type === 'altar-call'),
    confidence: response.overallConfidence,
  };
}

export function promptFor(input: DirectorInput): string {
  const segments = input.segments.map((segment, index) => JSON.stringify({ index, canonicalId: segment.id, text: segment.text })).join('\n');
  return [
    'You are a reverent Bengali sermon semantic extractor.',
    'Return only one JSON object. Do not include markdown, prose, timestamps, project IDs, or source IDs.',
    'Use inclusive numbered transcript segment ranges. The application resolves identity and timing.',
    'Respect that prayer, Scripture, altar call, and emotional ministry often need speaker-full or none.',
    'Allowed sectionType: introduction, scripture-reading, teaching, main-point, illustration, story, testimony, question, application, transition, prayer, emotional-ministry, conclusion, altar-call.',
    'Allowed intensity: reverent-calm, normal-teaching, story-illustration, emphasis.',
    'Allowed visualRecommendation: speaker-full, speaker-left, speaker-right, speaker-punch-in, scripture-card, title-card, keyword-graphic, image-broll, video-broll, motion-graphic, split-screen, none.',
    'JSON shape: {"sections":[{"sectionType":"main-point","startSegment":0,"endSegment":0,"intensity":"emphasis","suggestedDisplayText":"optional Bengali label","scriptureReference":"optional","visualRecommendation":"keyword-graphic","confidence":0.0,"reason":"required"}],"overallConfidence":0.0}.',
    'Do not omit required fields. Use empty sections only if the transcript has no meaningful semantic structure.',
    `Numbered transcript segments:\n${segments}`,
  ].join('\n');
}

export class OllamaDirectorProvider implements DirectorProvider {
  name = 'ollama';
  model: string;
  cacheIdentity: string;
  private endpoint: string;
  private timeoutMs: number;
  private maxAttempts: number;
  private disableThinking: boolean;

  constructor(config: DirectorProviderConfig = {}) {
    this.model = config.model ?? process.env.SERMON_DIRECTOR_MODEL ?? 'qwen3:30b';
    this.endpoint = config.endpoint ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
    this.timeoutMs = config.timeoutMs ?? 900_000;
    this.maxAttempts = config.attempts ?? 2;
    this.disableThinking = config.disableThinking ?? true;
    this.cacheIdentity = sha256(JSON.stringify({
      adapter: 'ollama-director-v1.1',
      endpoint: this.endpoint,
      model: this.model,
      timeoutMs: this.timeoutMs,
      attempts: this.maxAttempts,
      disableThinking: this.disableThinking,
      promptSchema: DIRECTOR_PROMPT_SCHEMA_VERSION,
    }));
  }

  async checkAvailability(): Promise<DirectorProviderAvailability> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 5_000));
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, { signal: controller.signal });
      if (!response.ok) return { available: false, reason: `Ollama health check returned HTTP ${response.status}.`, checkedAt: new Date().toISOString() };
      const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
      const models = payload.models?.map((item) => item.name ?? item.model).filter((item): item is string => Boolean(item)) ?? [];
      const available = models.some((item) => item === this.model || item.startsWith(`${this.model}:`));
      return {
        available,
        reason: available ? undefined : `Ollama is reachable, but model ${this.model} is not installed.`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? `Ollama is unavailable: ${error.message}` : `Ollama is unavailable: ${String(error)}`,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async analyze(input: DirectorInput): Promise<DirectorProviderResult> {
    validateDirectorInput(input);
    const started = Date.now();
    const attempts: ProviderAttempt[] = [];
    const rawResponses: DirectorProviderResult['rawResponses'] = [];
    let lastError = 'Unknown structured-output failure';
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const attemptStarted = Date.now();
      const record: ProviderAttempt = { attempt, parse: 'fail', schema: 'fail', segmentReferences: 'fail', semanticOutput: 'fail', runtimeMs: 0 };
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const requestBody = { model: this.model, prompt: promptFor(input), stream: false, format: 'json', think: this.disableThinking ? false : undefined, options: { temperature: 0.1 } };
        let response: Response;
        try {
          response = await fetch(`${this.endpoint}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody), signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        const payload = await response.json() as { response?: string; thinking?: string };
        const candidates: Array<{ field: 'response' | 'thinking'; text?: string }> = [{ field: 'response', text: payload.response }, { field: 'thinking', text: payload.thinking }];
        let parsed: unknown;
        for (const candidate of candidates) {
          if (!candidate.text?.trim()) continue;
          rawResponses.push({ attempt, field: candidate.field, text: candidate.text });
          try {
            parsed = JSON.parse(candidate.text);
            record.parse = 'pass';
            break;
          } catch {
            lastError = `Attempt ${attempt}: ${candidate.field} was not parseable JSON`;
          }
        }
        if (record.parse !== 'pass') throw new Error(lastError);
        const semantic = validateAIResponse(parsed, input.segments.length);
        record.schema = 'pass';
        record.segmentReferences = 'pass';
        record.semanticOutput = semantic.sections.length ? 'pass' : 'fail';
        if (record.semanticOutput !== 'pass') throw new Error('AI response contained no semantic sections.');
        record.runtimeMs = Date.now() - attemptStarted;
        attempts.push(record);
        return { providerResult: attempt === 1 ? 'ai-success' : 'ai-retry-success', provider: this.name, model: this.model, runtimeMs: Date.now() - started, attempts, rawResponses, analysis: resolveAIResponse(semantic, input) };
      } catch (error) {
        record.runtimeMs = Date.now() - attemptStarted;
        record.error = error instanceof Error ? error.message : String(error);
        lastError = record.error;
        attempts.push(record);
      }
    }
    return { providerResult: 'provider-failure', provider: this.name, model: this.model, runtimeMs: Date.now() - started, attempts, rawResponses, error: lastError };
  }
}

export function deterministicFallbackAnalysis(input: DirectorInput): SermonAnalysis {
  validateDirectorInput(input);
  if (!input.segments.length) throw new Error('Deterministic fallback requires at least one canonical transcript segment.');
  return resolveAIResponse({
    overallConfidence: 0.5,
    sections: [{
      sectionType: 'teaching',
      startSegment: 0,
      endSegment: input.segments.length - 1,
      intensity: 'normal-teaching',
      visualRecommendation: 'speaker-full',
      confidence: 0.5,
      reason: 'Deterministic fallback retains the speaker and canonical segment-safe timing.',
    }],
  }, input);
}

function fallbackIntensity(type: SermonSectionType): VisualIntensity {
  if (type === 'prayer' || type === 'scripture-reading' || type === 'altar-call' || type === 'emotional-ministry' || type === 'conclusion') return 'reverent-calm';
  if (type === 'illustration' || type === 'story' || type === 'testimony') return 'story-illustration';
  if (type === 'main-point' || type === 'application') return 'emphasis';
  return 'normal-teaching';
}

function fallbackVisual(type: SermonSectionType): VisualRecommendation {
  if (type === 'prayer' || type === 'scripture-reading' || type === 'altar-call' || type === 'emotional-ministry') return 'none';
  if (type === 'main-point') return 'keyword-graphic';
  if (type === 'story' || type === 'illustration' || type === 'testimony') return 'image-broll';
  if (type === 'application') return 'speaker-left';
  return 'speaker-full';
}

function intentFor(type: SermonSectionType): VideoBeat['intent'] {
  if (type === 'prayer') return 'prayer';
  if (type === 'main-point') return 'keyword';
  if (type === 'story') return 'story';
  if (type === 'illustration') return 'illustration';
  if (type === 'emotional-ministry') return 'emotion';
  return 'conclusion';
}

export function generateVisualBeats(analysis: SermonAnalysis, trustPolicy?: ContentTrustPolicy): VideoBeat[] {
  return analysis.sections.map((section) => {
    const display = resolveDisplayText(section, analysis, trustPolicy);
    return ({
    id: `beat-${section.id}`,
    start: section.start,
    end: section.end,
    transcriptText: section.transcriptText,
    intent: intentFor(section.type),
    visualType: section.visualRecommendation ?? fallbackVisual(section.type),
    intensity: section.intensity ?? fallbackIntensity(section.type),
    suggestedDisplayText: display.text,
    displayTextTrust: display.trust,
    scriptureReference: section.scriptureReference,
    searchQuery: section.visualRecommendation === 'image-broll' || section.visualRecommendation === 'video-broll' ? section.suggestedDisplayText ?? section.transcriptText.slice(0, 100) : undefined,
    priority: section.type === 'main-point' ? 0.9 : 0.6,
    confidence: section.confidence,
    reason: section.reason,
    });
  }).sort((left, right) => left.start - right.start);
}

export function createDirectorEditPlan(beats: VideoBeat[], input: DirectorInput, analysisProvider: string, model: string): EditPlan {
  const operations: EditOperation[] = beats.flatMap((beat): EditOperation[] => {
    if (beat.visualType === 'speaker-left' || beat.visualType === 'speaker-right') return [{ id: beat.id, type: 'speaker-position', start: beat.start, end: beat.end, position: beat.visualType === 'speaker-left' ? 'left' : 'right', reason: beat.reason, confidence: beat.confidence }];
    if (beat.visualType === 'keyword-graphic' || beat.visualType === 'title-card') return [{ id: beat.id, type: 'sermon-point', start: beat.start, end: beat.end, text: beat.suggestedDisplayText ?? beat.transcriptText, textTrust: beat.displayTextTrust ?? 'canonical-transcript', position: 'right', style: 'director-v1', reason: beat.reason, confidence: beat.confidence }];
    if (beat.visualType === 'none' || beat.visualType === 'speaker-full' || beat.visualType === 'speaker-punch-in') return [];
    return [{ id: beat.id, type: 'director-placeholder', start: beat.start, end: beat.end, visualType: beat.visualType, text: beat.suggestedDisplayText, textTrust: beat.displayTextTrust, searchQuery: beat.searchQuery, reason: beat.reason, confidence: beat.confidence }];
  });
  return { schemaVersion: '1.1', projectId: input.projectId, sourceTranscriptHash: sha256(input.transcript.originalTranscript), operations, status: 'draft', createdBy: { provider: analysisProvider, model } };
}

export function validateDirector(analysis: SermonAnalysis, beats: VideoBeat[], plan: EditPlan, duration: number): string[] {
  const failures = validatePlan(plan, duration);
  for (const beat of beats) {
    if (beat.start < 0 || beat.end <= beat.start || beat.end > duration) failures.push(`${beat.id}: invalid range`);
    if (!intensities.has(beat.intensity)) failures.push(`${beat.id}: invalid intensity`);
    if (!visualRecommendations.has(beat.visualType)) failures.push(`${beat.id}: invalid visual type`);
    if (beat.confidence < 0 || beat.confidence > 1) failures.push(`${beat.id}: invalid confidence`);
    if (!beat.reason.trim()) failures.push(`${beat.id}: missing reason`);
  }
  if (analysis.sections.some((item) => item.start < 0 || item.end <= item.start || item.end > duration)) failures.push('analysis: invalid section range');
  const density = beats.filter((beat) => beat.visualType !== 'none' && beat.visualType !== 'speaker-full').length / Math.max(duration / 60, 1);
  if (density > 8) failures.push(`director: event density ${density.toFixed(2)} per minute is too high`);
  const repeatableNoChange = new Set<VisualRecommendation>(['none', 'speaker-full']);
  for (let index = 1; index < beats.length; index += 1) if (!repeatableNoChange.has(beats[index].visualType) && beats[index].visualType === beats[index - 1].visualType && beats[index].start - beats[index - 1].end < 10) failures.push(`${beats[index].id}: repeated visual type too close to previous beat`);
  return failures;
}

export function directorDependencyNames(): string[] {
  return ['canonical-transcript', 'director-policy', 'provider-model-config', 'prompt-schema', 'sermon-analysis', 'visual-intensity-map', 'beatmap', 'edit-plan', 'render'];
}
