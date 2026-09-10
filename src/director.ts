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
import { resolvePrimarySegmentIds, validateCanonicalCoverage } from './canonical-coverage.ts';
import { sha256, validatePlan } from './foundation.ts';
import { measureTranscriptIntegrity } from './transcript-integrity.ts';
import type { EditorialOpportunity } from './editorial-opportunity.ts';

export interface DirectorInput {
  transcript: TranscriptDocument;
  segments: TranscriptSegment[];
  projectDuration: number;
  projectId: string;
  /**
   * Canonical segment IDs the provider must cover with explicit decisions. Segments outside
   * this list are context-only overlap belonging to an adjacent chunk. Defaults to every segment.
   */
  primarySegmentIds?: string[];
}

export interface AISermonSection {
  sectionType: SermonSectionType;
  secondaryType?: SermonSectionType;
  semanticConfidence?: number;
  semanticEvidence?: string;
  semanticFunction?: string;
  boundaryReason?: string;
  brollIntent?: AIBrollIntent;
  
  startSegment: number;
  endSegment: number;
  
  intensity: VisualIntensity;
  suggestedDisplayText?: string;
  scriptureReference?: string;
  visualRecommendation: VisualRecommendation;
  confidence: number;
  reason: string;
}

import type { AIBrollIntent } from './contracts.ts';
export interface AISermonResponse {
  overallSemanticRole?: string;
  sections: AISermonSection[];
  overallConfidence: number;
}

export interface ProviderAttempt {
  attempt: number;
  parse: 'pass' | 'fail';
  schema: 'pass' | 'fail';
  segmentReferences: 'pass' | 'fail';
  semanticOutput: 'pass' | 'fail';
  canonicalCoverage?: 'pass' | 'fail' | 'not-run';
  runtimeMs: number;
  phase?: 'analysis' | 'coverage-repair' | 'editorial-enrichment';
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

export interface DirectorCoverageRepairRequest {
  input: DirectorInput;
  missingSegmentIds: string[];
  missingSegmentIndices: number[];
  attempt: number;
}

export interface DirectorEditorialEnrichmentRequest {
  input: DirectorInput;
  currentAnalysis: SermonAnalysis;
  opportunities: EditorialOpportunity[];
  eligibleSegmentIds: string[];
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
  /**
   * Optional bounded coverage repair. Providers that implement this are asked for decisions
   * covering ONLY the uncovered primary canonical segments.
   */
  repairCoverage?(request: DirectorCoverageRepairRequest): Promise<DirectorProviderResult>;
  /** Optional single bounded pass for semantically eligible sections in an editorially barren plan. */
  enrichEditorial?(request: DirectorEditorialEnrichmentRequest): Promise<DirectorProviderResult>;
}

export const DIRECTOR_PROMPT_SCHEMA_VERSION = 'director-prompt-schema-v1.3.2';

const sectionTypes = new Set<SermonSectionType>(['introduction', 'scripture-reading', 'teaching', 'main-point', 'illustration', 'story', 'testimony', 'question', 'application', 'transition', 'prayer', 'emotional-ministry', 'conclusion', 'altar-call']);
const intensities = new Set<VisualIntensity>(['reverent-calm', 'normal-teaching', 'story-illustration', 'emphasis']);
const visualRecommendations = new Set<VisualRecommendation>(['speaker-full', 'speaker-left', 'speaker-right', 'speaker-punch-in', 'caption', 'scripture-card', 'title-card', 'keyword-graphic', 'image-broll', 'video-broll', 'motion-graphic', 'split-screen', 'none']);

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
    const intensity = (item.intensity ? stringValue(item.intensity, `sections[${index}].intensity`) : 'normal-teaching') as VisualIntensity;
    const visualRecommendation = (item.visualRecommendation ? stringValue(item.visualRecommendation, `sections[${index}].visualRecommendation`) : 'speaker-full') as VisualRecommendation;
    if (!sectionTypes.has(sectionType)) throw new Error(`Unsupported section type: ${sectionType}`);
    if (!intensities.has(intensity)) throw new Error(`Unsupported intensity: ${intensity}`);
    if (!visualRecommendations.has(visualRecommendation)) throw new Error(`Unsupported visual recommendation: ${visualRecommendation}`);
    const startSegmentRaw = item.startSegment ?? item.startIndex;
    if (startSegmentRaw === undefined) throw new Error(`Missing startSegment or startIndex at sections[${index}]`);
    const startSegment = numberValue(startSegmentRaw, `sections[${index}].startSegment`);
    const endSegmentRaw = item.endSegment ?? item.endIndex;
    if (endSegmentRaw === undefined) throw new Error(`Missing endSegment or endIndex at sections[${index}]`);
    const endSegment = numberValue(endSegmentRaw, `sections[${index}].endSegment`);
    const confidence = item.confidence ? numberValue(item.confidence, `sections[${index}].confidence`) : 1.0;
    const semanticConfidence = item.semanticConfidence ? numberValue(item.semanticConfidence, `sections[${index}].semanticConfidence`) : confidence;
    if (!Number.isInteger(startSegment) || !Number.isInteger(endSegment) || startSegment < 0 || endSegment < startSegment) throw new Error(`Invalid segment range at sections[${index}]: ${startSegment}-${endSegment}`);
    if (startSegment >= segmentCount || endSegment >= segmentCount) throw new Error(`Invalid segment range at sections[${index}]: ${startSegment}-${endSegment}`);
    if (confidence < 0 || confidence > 1) throw new Error(`Invalid confidence at sections[${index}].confidence`);
    const bIntent = item.brollIntent as any;
    const brollIntent = bIntent ? {
      subject: stringValue(bIntent.subject, `sections[${index}].brollIntent.subject`),
      action: stringValue(bIntent.action, `sections[${index}].brollIntent.action`),
      setting: stringValue(bIntent.setting, `sections[${index}].brollIntent.setting`),
      mood: stringValue(bIntent.mood, `sections[${index}].brollIntent.mood`),
      visualPurpose: stringValue(bIntent.visualPurpose, `sections[${index}].brollIntent.visualPurpose`),
      exclusions: Array.isArray(bIntent.exclusions) ? bIntent.exclusions.map((e: any) => String(e)) : []
    } : undefined;

    return {
      sectionType,
      secondaryType: item.secondaryType ? stringValue(item.secondaryType, `sections[${index}].secondaryType`) as any : undefined,
      semanticConfidence,
      semanticEvidence: item.semanticEvidence ? stringValue(item.semanticEvidence, `sections[${index}].semanticEvidence`) : '',
      semanticFunction: item.semanticFunction ? stringValue(item.semanticFunction, `sections[${index}].semanticFunction`) : undefined,
      boundaryReason: item.boundaryReason ? stringValue(item.boundaryReason, `sections[${index}].boundaryReason`) : undefined,
      brollIntent,
      startSegment,
      endSegment,
      intensity,
      visualRecommendation,
      suggestedDisplayText: optionalStringValue(item.suggestedDisplayText, `sections[${index}].suggestedDisplayText`),
      scriptureReference: optionalStringValue(item.scriptureReference, `sections[${index}].scriptureReference`),
      confidence,
      reason: item.reason ? stringValue(item.reason, `sections[${index}].reason`) : 'Semantic pass',
    };
  });
  const overallConfidence = root.overallConfidence ? numberValue(root.overallConfidence, 'overallConfidence') : 1.0;
  if (overallConfidence < 0 || overallConfidence > 1) throw new Error('Invalid overallConfidence.');
  const overallSemanticRole = root.overallSemanticRole ? stringValue(root.overallSemanticRole, 'overallSemanticRole') : undefined;
  for (let index = 1; index < sections.length; index += 1) {
    if (sections[index].startSegment <= sections[index - 1].endSegment) throw new Error(`Sections must be ordered and non-overlapping at sections[${index}].`);
  }
  return { overallSemanticRole, sections, overallConfidence };
}

export function validateDirectorInput(input: DirectorInput): void {
  if (input.projectId !== input.transcript.projectId) throw new Error('Director project ID does not match the canonical transcript.');
  if (input.segments.length !== input.transcript.segments.length) throw new Error('Director segments do not match the canonical transcript segment count.');
  for (let index = 0; index < input.segments.length; index += 1) {
    const supplied = input.segments[index];
    const canonical = input.transcript.segments[index];
    if (supplied.id !== canonical.id || supplied.start !== canonical.start || supplied.end !== canonical.end || supplied.text !== canonical.text) throw new Error(`Director segment ${index} does not match the canonical transcript.`);
  }
  if (input.primarySegmentIds) {
    if (!input.primarySegmentIds.length) throw new Error('Director primary canonical segment IDs must not be empty.');
    const canonicalIds = new Set(input.segments.map((segment) => segment.id));
    const seen = new Set<string>();
    for (const id of input.primarySegmentIds) {
      if (!canonicalIds.has(id)) throw new Error(`Director primary canonical segment ${id} is not part of the input segments.`);
      if (seen.has(id)) throw new Error(`Director primary canonical segment ${id} is listed more than once.`);
      seen.add(id);
    }
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
    secondaryType: aiSection.secondaryType,
    semanticConfidence: aiSection.semanticConfidence,
    semanticEvidence: aiSection.semanticEvidence,
    semanticFunction: aiSection.semanticFunction,
    boundaryReason: aiSection.boundaryReason,
    brollIntent: aiSection.brollIntent,
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
    overallSemanticRole: response.overallSemanticRole,
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

export function primarySegmentIndices(input: DirectorInput): number[] {
  if (!input.primarySegmentIds) return input.segments.map((_, index) => index);
  const positions = new Map(input.segments.map((segment, index) => [segment.id, index]));
  return input.primarySegmentIds.map((id) => {
    const index = positions.get(id);
    if (index === undefined) throw new Error(`Primary canonical segment ${id} is not part of the Director input.`);
    return index;
  }).sort((left, right) => left - right);
}

function numberedSegments(input: DirectorInput): string {
  const primary = new Set(primarySegmentIndices(input));
  return input.segments.map((segment, index) => JSON.stringify({
    index,
    role: primary.has(index) ? 'primary' : 'context-only',
    canonicalId: segment.id,
    text: segment.text,
  })).join('\n');
}

const coverageRules = [
  'Segments marked "primary" are your responsibility. Every primary segment index must appear in exactly one returned section.',
  'Segments marked "context-only" belong to an adjacent chunk. Read them for meaning, but never include them in a returned range.',
  'If a primary segment needs no visual intervention, still return a section for it with visualRecommendation "speaker-full" or "none". Silence is not allowed.',
  'Sections must be ordered and must not overlap.',
];

export function promptFor(input: DirectorInput): string {
  const indices = primarySegmentIndices(input);
  return [
    'You are a reverent Bengali sermon semantic extractor.',
    'Return only one JSON object. Do not include markdown, prose, timestamps, project IDs, or source IDs.',
    'Use inclusive numbered transcript segment ranges. The application resolves identity and timing.',
    'Respect that prayer, Scripture, altar call, and emotional ministry often need speaker-full or none.',
    'Reverent Retention does not mean visual inactivity. For ordinary teaching, stories, questions, and emphasis, consider restrained captions, sermon points, punch-ins, reframes, Scripture treatments, contextual B-roll, or an intentional visual reset when semantically useful.',
    'Do not create constant cuts. Prefer a small number of meaningful, section-aware visual changes over decorative motion.',
    'Main points: actively consider a concise sermon-point, semantic caption, punch-in, or reframe.',
    'Rhetorical questions: actively consider a short emphasis caption, punch-in, or restrained reframe.',
    'Normal teaching: consider occasional concise captions or subtle reframing where comprehension benefits.',
    'Stories and illustrations: actively consider contextual B-roll first; when B-roll is not semantically justified, consider a caption, punch-in, or reframe.',
    'Strong emphasis: consider a key phrase, punch-in, or visual reset.',
    'No Change is deliberate, not the safest default. For eligible normal teaching/story/emphasis sections, explain why No Change is better than the available restrained alternatives.',
    'Your editorialIntent, visualRecommendation, and reason MUST logically agree.',
    'If your rationale says contextual B-roll is appropriate, then choose image-broll unless you explicitly justify why remaining on the speaker is better.',
    'If you select speaker-full or none for a HIGH-opportunity story, provide a specific deliberate-speaker-led justification.',
    'Do not describe one visual treatment in `reason` and select an unrelated visualRecommendation.',
    'Allowed sectionType: introduction, scripture-reading, teaching, main-point, illustration, story, testimony, question, application, transition, prayer, emotional-ministry, conclusion, altar-call.',
    'Allowed intensity: reverent-calm, normal-teaching, story-illustration, emphasis.',
    'Allowed editorialIntent: PRESERVE_SPEAKER, EMPHASIZE_SPEAKER, SHOW_KEY_TEXT, SHOW_SCRIPTURE, USE_CONTEXTUAL_VISUAL, VISUAL_RESET.',
    'Allowed visualRecommendation: speaker-full, speaker-left, speaker-right, speaker-punch-in, caption, scripture-card, title-card, keyword-graphic, image-broll, video-broll, motion-graphic, split-screen, none.',
    'JSON shape: {"sections":[{"sectionType":"main-point","startIndex":0,"endIndex":0,"intensity":"emphasis","editorialIntent":"SHOW_KEY_TEXT","suggestedDisplayText":"optional Bengali label","scriptureReference":"optional","visualRecommendation":"keyword-graphic","confidence":0.0,"reason":"required"}],"overallConfidence":0.0}.',
    'Do not omit required fields.',
    ...coverageRules,
    `Primary segment indices requiring complete coverage: ${indices.join(', ')}.`,
    `Numbered transcript segments:\n${numberedSegments(input)}`,
  ].join('\n');
}

export function coverageRepairPromptFor(input: DirectorInput, missingIndices: number[]): string {
  return [
    'You are a reverent Bengali sermon semantic extractor completing an incomplete previous answer.',
    'Return only one JSON object using the same schema as before.',
    'Return sections ONLY for the uncovered primary segment indices listed below. Do not repeat already covered segments.',
    'Every listed index must appear in exactly one returned section.',
    'If a segment needs no visual intervention, return it with visualRecommendation "speaker-full" or "none" and intent "PRESERVE_SPEAKER".',
    'JSON shape: {"sections":[{"sectionType":"teaching","startIndex":0,"endIndex":0,"intensity":"normal-teaching","editorialIntent":"PRESERVE_SPEAKER","visualRecommendation":"speaker-full","confidence":0.0,"reason":"required"}],"overallConfidence":0.0}.',
    `Uncovered primary segment indices: ${missingIndices.join(', ')}.`,
    `Numbered transcript segments (full context):\n${numberedSegments(input)}`,
  ].join('\n');
}

export function editorialEnrichmentPromptFor(request: DirectorEditorialEnrichmentRequest): string {
  const eligible = request.opportunities.map((item) => {
    const section = request.currentAnalysis.sections.find(s => s.id === item.sectionId);
    return {
      sectionId: item.sectionId,
      semanticType: item.semanticType,
      intensity: item.intensity,
      visualOpportunity: item.visualOpportunity,
      eligibleVisualTypes: item.eligibleVisualTypes,
      currentRecommendation: item.currentRecommendation,
      editorialIntent: section?.editorialIntent,
      structuredReason: item.reason,
      problemClassification: 'UNTREATED_OR_INCONSISTENT',
    };
  });
  return [
    'You are performing one bounded editorial enrichment pass for a reverent Bengali sermon edit.',
    'Return only one JSON object using the established Director schema. Return revised decisions only for the requested weak primary segments.',
    'Preserve every canonical segment identity and timing. Cover every requested primary segment exactly once.',
    'Preserve sermon meaning and Reverent Retention. Do not modify prayer, Scripture reading, altar-call, or emotional-ministry sections merely to increase activity.',
    'Inspect eligible main-point, question, teaching, story, illustration, and emphasis sections for semantically justified visual opportunities.',
    'Use restrained professional edits. Avoid repetitive visual types, meaningless cuts, fabricated Scripture, and unrelated B-roll concepts.',
    'For story or illustration content, actively consider contextual B-roll. If B-roll is not justified, consider a concise caption, punch-in, or reframe rather than defaulting automatically to No Change.',
    'Captions and sermon-point text must be short phrases grounded in the canonical transcript, not the entire transcript.',
    'No Change remains valid, but explain why it is better than the eligible restrained alternatives.',
    `Editorial opportunities:\n${JSON.stringify(eligible)}`,
    `Numbered transcript segments:\n${numberedSegments(request.input)}`,
    'JSON shape: {"sections":[{"sectionType":"teaching","startIndex":0,"endIndex":0,"intensity":"normal-teaching","suggestedDisplayText":"optional concise canonical phrase","visualRecommendation":"caption","confidence":0.0,"reason":"required"}],"overallConfidence":0.0}.',
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

  private async generate(
    input: DirectorInput,
    prompt: string,
    phase: 'analysis' | 'coverage-repair' | 'editorial-enrichment',
    requiredSegmentIds: string[],
    attemptLimit = this.maxAttempts,
  ): Promise<DirectorProviderResult> {
    validateDirectorInput(input);
    const started = Date.now();
    const attempts: ProviderAttempt[] = [];
    const rawResponses: DirectorProviderResult['rawResponses'] = [];
    let lastError = 'Unknown structured-output failure';
    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      const attemptStarted = Date.now();
      const record: ProviderAttempt = { attempt, parse: 'fail', schema: 'fail', segmentReferences: 'fail', semanticOutput: 'fail', canonicalCoverage: 'not-run', runtimeMs: 0, phase };
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const requestBody = { model: this.model, prompt, stream: false, format: 'json', think: this.disableThinking ? false : undefined, options: { temperature: 0.1 } };
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
        const analysis = resolveAIResponse(semantic, input);
        const coverage = validateCanonicalCoverage(analysis.sections, { segments: input.segments, primarySegmentIds: requiredSegmentIds });
        record.canonicalCoverage = coverage.complete ? 'pass' : 'fail';
        record.runtimeMs = Date.now() - attemptStarted;
        if (!coverage.complete) {
          attempts.push(record);
          lastError = `Attempt ${attempt}: canonical coverage incomplete. ${coverage.failures.join(' ')}`;
          record.error = lastError;
          continue;
        }
        attempts.push(record);
        return { providerResult: attempt === 1 ? 'ai-success' : 'ai-retry-success', provider: this.name, model: this.model, runtimeMs: Date.now() - started, attempts, rawResponses, analysis };
      } catch (error) {
        record.runtimeMs = Date.now() - attemptStarted;
        record.error = error instanceof Error ? error.message : String(error);
        lastError = record.error;
        attempts.push(record);
      }
    }
    return { providerResult: 'provider-failure', provider: this.name, model: this.model, runtimeMs: Date.now() - started, attempts, rawResponses, error: lastError };
  }

  async analyze(input: DirectorInput): Promise<DirectorProviderResult> {
    const required = resolvePrimarySegmentIds(input.segments, input.primarySegmentIds);
    
    // Pass 1: Semantics
    let semanticResult = await this.generate(input, semanticAnalysisPromptFor(input), 'analysis', required);
    if (semanticResult.providerResult !== 'ai-success' && semanticResult.providerResult !== 'ai-retry-success') return semanticResult;
    
    // Check for ambiguity
    let ambiguous = false;
    for (const sec of semanticResult.analysis!.sections) {
      if (validateClassificationAmbiguity(sec)) {
        ambiguous = true;
        break;
      }
    }
    
    if (ambiguous) {
      // Reconcile once
      const reconResult = await this.generate(input, semanticReconciliationPromptFor(input, semanticResult.analysis!.sections), 'analysis', required, 1);
      if (reconResult.providerResult === 'ai-success' || reconResult.providerResult === 'ai-retry-success') {
        semanticResult = reconResult;
      }
    }
    
    // Pass 2: Visuals
    const visualResult = await this.generate(input, visualDecisionPromptFor(input, semanticResult.analysis!), 'analysis', required);
    if (visualResult.providerResult !== 'ai-success' && visualResult.providerResult !== 'ai-retry-success') return visualResult;
    
    // Combine Semantics and Visuals
    const finalSections = semanticResult.analysis!.sections.map(semSec => {
      const visSec = visualResult.analysis!.sections.find(v => v.start === semSec.start && v.end === semSec.end) || visualResult.analysis!.sections.find(v => v.id === semSec.id);
      if (!visSec) return semSec;
      return {
        ...semSec,
        intensity: visSec.intensity,
        suggestedDisplayText: visSec.suggestedDisplayText,
        scriptureReference: visSec.scriptureReference,
        editorialIntent: visSec.editorialIntent,
        visualRecommendation: visSec.visualRecommendation,
        confidence: Math.min(semSec.confidence, visSec.confidence),
        reason: visSec.reason
      };
    });
    
    return {
      ...visualResult,
      attempts: [...semanticResult.attempts, ...visualResult.attempts],
      rawResponses: [...semanticResult.rawResponses, ...visualResult.rawResponses],
      analysis: {
        ...semanticResult.analysis!,
        sections: finalSections
      } as any
    };
  }

  async repairCoverage(request: DirectorCoverageRepairRequest): Promise<DirectorProviderResult> {
    return this.generate(
      request.input,
      coverageRepairPromptFor(request.input, request.missingSegmentIndices),
      'coverage-repair',
      request.missingSegmentIds,
    );
  }

  async enrichEditorial(request: DirectorEditorialEnrichmentRequest): Promise<DirectorProviderResult> {
    const input = { ...request.input, primarySegmentIds: request.eligibleSegmentIds };
    return this.generate(
      input,
      editorialEnrichmentPromptFor({ ...request, input }),
      'editorial-enrichment',
      request.eligibleSegmentIds,
      1,
    );
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
    if (beat.visualType === 'speaker-punch-in') return [{ id: beat.id, type: 'speaker-position', start: beat.start, end: beat.end, position: 'punch-in', reason: beat.reason, confidence: beat.confidence }];
    if (beat.visualType === 'caption') return [{ id: beat.id, type: 'caption', start: beat.start, end: beat.end, text: beat.suggestedDisplayText ?? beat.transcriptText, textTrust: beat.displayTextTrust ?? 'canonical-transcript', reason: beat.reason, confidence: beat.confidence }];
    if (beat.visualType === 'keyword-graphic' || beat.visualType === 'title-card') return [{ id: beat.id, type: 'sermon-point', start: beat.start, end: beat.end, text: beat.suggestedDisplayText ?? beat.transcriptText, textTrust: beat.displayTextTrust ?? 'canonical-transcript', position: 'right', style: 'director-v1', reason: beat.reason, confidence: beat.confidence }];
    if (beat.visualType === 'none' || beat.visualType === 'speaker-full') return [{ id: beat.id, type: 'no-change', start: beat.start, end: beat.end, mode: 'canonical-no-change', reason: beat.reason, confidence: beat.confidence }];
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

export function semanticAnalysisPromptFor(input: DirectorInput, refinementReason?: string): string {
  const indices = primarySegmentIndices(input);
  return [
    'You are a reverent Bengali sermon semantic extractor.',
    'Return only one JSON object. Do not include markdown, prose, timestamps, project IDs, or source IDs.',
    'Use inclusive numbered transcript segment ranges. The application resolves identity and timing.',
    'Your ONLY job is to classify the semantic nature of the content.',
    'CRITICAL: Differentiate the OVERALL STORY ARC from INTERNAL EDITORIAL BEATS.',
    'A 40-70 second narrative may have an overallSemanticRole of "story", but it MUST be broken into multiple semantic sections when meaning changes.',
    'Create boundaries when there is a: topic change, problem introduced, conflict, turning point, main point declared, rhetorical question, application, scripture, or prayer.',
    'Do NOT force the entire transcript into one giant section. Meaning determines boundaries.',
    'If a section serves multiple purposes, provide both a sectionType (primary) and a secondaryType.',
    'Allowed sectionType and secondaryType: introduction, scripture-reading, teaching, main-point, illustration, story, testimony, question, application, transition, prayer, emotional-ministry, conclusion, altar-call.',
    refinementReason ? `REFINEMENT REQUEST: ${refinementReason}` : '',
    'Do not omit required fields.',
    ...coverageRules,
    `Primary segment indices requiring complete coverage: ${indices.join(', ')}.`,
    `Numbered transcript segments:\n${numberedSegments(input)}`,
  ].join('\n');
}

export function visualDecisionPromptFor(input: DirectorInput, semantics: SermonAnalysis): string {
  const templateSections = semantics.sections.map(s => {
    const startIndex = input.segments.findIndex(seg => seg.id === s.sourceSegmentIds[0]);
    const endIndex = input.segments.findIndex(seg => seg.id === s.sourceSegmentIds[s.sourceSegmentIds.length - 1]);
    return {
      sectionType: s.type,
      startIndex,
      endIndex,
      intensity: "story-illustration",
      editorialIntent: "USE_CONTEXTUAL_VISUAL",
      suggestedDisplayText: "optional Bengali label",
      scriptureReference: "optional",
      visualRecommendation: "image-broll",
      brollIntent: { subject: "king", action: "fleeing", setting: "ancient city", mood: "desperate", visualPurpose: "illustrate story", exclusions: ["modern city"] },
      confidence: 0.9,
      reason: "Your rationale here"
    };
  });
  return [
    'You are a reverent Bengali sermon visual director.',
    'Return only one JSON object matching the provided semantic sections exactly.',
    'CRITICAL: You MUST output exactly the same number of sections as provided, and you MUST copy the exact startIndex and endIndex for each section from the input below.',
    'Do NOT change startIndex, endIndex, sectionType, or secondaryType.',
    'CRITICAL INSTRUCTION: startIndex and endIndex are integer array indices. Do NOT output timestamps.',
    'For any image-broll or video-broll recommendation, you MUST provide a detailed brollIntent.',
    'The brollIntent exclusions array MUST contain things that would be factually incorrect for the text (e.g. "Peter in prison" if the story is about a king and a famine).',
    'For each section, determine the visualRecommendation and intensity.',
    'Respect that prayer, Scripture, altar call, and emotional ministry often need speaker-full or none.',
    'Reverent Retention does not mean visual inactivity. For ordinary teaching, stories, questions, and emphasis, consider restrained captions, sermon points, punch-ins, reframes, Scripture treatments, contextual B-roll, or an intentional visual reset when semantically useful.',
    'Stories and illustrations: actively consider contextual B-roll first; when B-roll is not semantically justified, consider a caption, punch-in, or reframe.',
    'No Change is deliberate, not the safest default. For eligible normal teaching/story/emphasis sections, explain why No Change is better than the available restrained alternatives.',
    'If your rationale says contextual B-roll is appropriate, then choose image-broll unless you explicitly justify why remaining on the speaker is better.',
    'If you select speaker-full or none for a HIGH-opportunity story, provide a specific deliberate-speaker-led justification.',
    'Allowed intensity: reverent-calm, normal-teaching, story-illustration, emphasis.',
    'Allowed editorialIntent: PRESERVE_SPEAKER, EMPHASIZE_SPEAKER, SHOW_KEY_TEXT, SHOW_SCRIPTURE, USE_CONTEXTUAL_VISUAL, VISUAL_RESET.',
    'Allowed visualRecommendation: speaker-full, speaker-left, speaker-right, speaker-punch-in, caption, scripture-card, title-card, keyword-graphic, image-broll, video-broll, motion-graphic, split-screen, none.',
    `JSON shape must exactly match this structure with your decisions:\n{"sections":${JSON.stringify(templateSections)},"overallConfidence":0.9}`,
    `Numbered transcript segments:\n${numberedSegments(input)}`,
    `Stable Semantic Classification to apply visual decisions to:\n${JSON.stringify(templateSections.map(t => ({ sectionType: t.sectionType, startIndex: t.startIndex, endIndex: t.endIndex })), null, 2)}`
  ].join('\n');
}

export function semanticReconciliationPromptFor(input: DirectorInput, sections: any[]): string {
  return [
    'You are a reverent Bengali sermon semantic reconciler.',
    'Return only one JSON object updating the semantic classification of the provided sections.',
    'Some sections were flagged as AMBIGUOUS because they contain strong narrative evidence (e.g. telling a story, recounting events) but were classified only as teaching or main-point.',
    'Review the transcript and if a section is genuinely narrative, update its sectionType or secondaryType to story, illustration, or testimony.',
    'Do NOT change startIndex or endIndex boundaries. Only reconsider the semantic classification.',
    'JSON shape: {"sections":[{"sectionType":"story","secondaryType":"main-point","startIndex":0,"endIndex":0,"semanticConfidence":0.9,"semanticEvidence":"Pastor recounts the narrative"}],"overallConfidence":0.0}.',
    `Numbered transcript segments:\n${numberedSegments(input)}`,
    `Sections requiring reconciliation:\n${JSON.stringify(sections, null, 2)}`
  ].join('\n');
}

export function validateClassificationAmbiguity(section: { type: string, semanticEvidence?: string }): boolean {
  if (!section.semanticEvidence) return false;
  if (['story', 'illustration', 'testimony', 'narrative'].includes(section.type)) return false;
  const lower = section.semanticEvidence.toLowerCase();
  const narrativeKeywords = ['story', 'recount', 'event', 'action', 'narrative', 'happened', 'told a', 'telling a'];
  let matchCount = 0;
  for (const word of narrativeKeywords) {
    if (lower.includes(word)) matchCount++;
  }
  return matchCount >= 2;
}

export type SemanticStability = 'STABLE' | 'COMPATIBLE_VARIATION' | 'UNSTABLE';
export function evaluateSemanticStability(runA: { type: string, secondaryType?: string }, runB: { type: string, secondaryType?: string }): SemanticStability {
  if (runA.type === runB.type && runA.secondaryType === runB.secondaryType) return 'STABLE';
  
  const aRoles = [runA.type, runA.secondaryType].filter(Boolean);
  const bRoles = [runB.type, runB.secondaryType].filter(Boolean);
  
  // If they both preserve a narrative role, or both preserve a teaching role, they are compatible.
  const aHasNarrative = aRoles.some(r => ['story', 'illustration', 'testimony', 'narrative'].includes(r!));
  const bHasNarrative = bRoles.some(r => ['story', 'illustration', 'testimony', 'narrative'].includes(r!));
  
  if (aHasNarrative && bHasNarrative) return 'COMPATIBLE_VARIATION';
  if (!aHasNarrative && !bHasNarrative && aRoles.some(r => bRoles.includes(r!))) return 'COMPATIBLE_VARIATION';
  
  return 'UNSTABLE';
}


export interface SegmentationDiagnostics {
  sectionCount: number;
  eligibleSectionCount: number;
  averageSectionDuration: number;
  longestSectionDuration: number;
  singleSectionTimeline: boolean;
  coarseSegmentationRisk: 'NORMAL' | 'COARSE' | 'EXTREMELY_COARSE';
}

export function detectCoarseSegmentation(analysis: SermonAnalysis, transcriptDuration: number): SegmentationDiagnostics {
  const sectionCount = analysis.sections.length;
  const eligibleSections = analysis.sections.filter(s => s.type !== 'prayer' && s.type !== 'scripture-reading');
  const eligibleSectionCount = eligibleSections.length;
  const totalDuration = analysis.sections.reduce((acc, s) => acc + (s.end - s.start), 0);
  const averageSectionDuration = sectionCount > 0 ? totalDuration / sectionCount : 0;
  const longestSectionDuration = Math.max(0, ...analysis.sections.map(s => s.end - s.start));
  const singleSectionTimeline = sectionCount === 1;

  let coarseSegmentationRisk: 'NORMAL' | 'COARSE' | 'EXTREMELY_COARSE' = 'NORMAL';
  
  const functionDiversity = new Set(eligibleSections.map(s => s.semanticFunction)).size;
  const proportionLongest = transcriptDuration > 0 ? longestSectionDuration / transcriptDuration : 0;
  
  if (singleSectionTimeline && transcriptDuration > 30) {
    coarseSegmentationRisk = 'EXTREMELY_COARSE';
  } else if (proportionLongest > 0.6 && functionDiversity < 2 && transcriptDuration > 45) {
    coarseSegmentationRisk = 'COARSE';
  }

  return {
    sectionCount,
    eligibleSectionCount,
    averageSectionDuration,
    longestSectionDuration,
    singleSectionTimeline,
    coarseSegmentationRisk
  };
}
