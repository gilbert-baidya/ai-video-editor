import type { DisplayTextTrust, SermonSection, SpeakerPosition, VisualLayout, VisualRecommendation } from './contracts.ts';
import type { EditOperation, EditPlan, SermonAnalysis } from './contracts.ts';
import { resolveDisplayText, type ContentTrustPolicy } from './content-trust.ts';

export type PolicyDecision = 'ACCEPT' | 'MODIFY' | 'SUPPRESS' | 'REVIEW';

export interface VisualHistory {
  lastVisualType?: VisualRecommendation;
  lastSpeakerPosition?: SpeakerPosition;
  secondsSinceLastVisualChange: number;
  recentGraphicTypes: string[];
}

export interface VisualBudget {
  durationSeconds: number;
  recommendedMinEvents: number;
  recommendedMaxEvents: number;
  currentEvents: number;
}

export interface RetentionPolicyConfig {
  version: string;
  speakerCooldownSeconds: number;
  graphicCooldownSeconds: number;
  calmCooldownSeconds: number;
  maxEventsPerMinute: number;
  maxGraphicLines: number;
}

export interface PolicyDecisionRecord {
  sectionId: string;
  segment: string;
  start: number;
  end: number;
  section: SermonSection['type'];
  intensity: SermonSection['intensity'];
  aiRecommendation: VisualRecommendation;
  policyDecision: PolicyDecision;
  resolvedDecision: VisualRecommendation | 'keep-current';
  layout: VisualLayout;
  displayText?: string;
  displayTextTrust: DisplayTextTrust;
  reason: string;
  confidence: number;
}

export interface VisualPolicyResult {
  records: PolicyDecisionRecord[];
  editPlan: EditPlan;
  budget: VisualBudget;
  warnings: string[];
}

export const defaultRetentionPolicy: RetentionPolicyConfig = {
  version: 'reverent-retention-v2.1',
  speakerCooldownSeconds: 18,
  graphicCooldownSeconds: 36,
  calmCooldownSeconds: 45,
  maxEventsPerMinute: 8,
  maxGraphicLines: 3,
};

function layoutFor(recommendation: VisualRecommendation, graphic: boolean): VisualLayout {
  if (recommendation === 'speaker-left') return { speakerPosition: 'left', graphicRegion: graphic ? 'right' : undefined, safeZoneProfile: '16:9-speaker-left' };
  if (recommendation === 'speaker-right') return { speakerPosition: 'right', graphicRegion: graphic ? 'left' : undefined, safeZoneProfile: '16:9-speaker-right' };
  if (recommendation === 'speaker-punch-in') return { speakerPosition: 'punch-in', graphicRegion: graphic ? 'upper-right' : undefined, safeZoneProfile: '16:9-punch-in' };
  if (recommendation === 'speaker-full') return { speakerPosition: 'full', graphicRegion: graphic ? 'upper-right' : undefined, safeZoneProfile: '16:9-full' };
  if (recommendation === 'scripture-card') return { speakerPosition: 'full', graphicRegion: 'upper-right', safeZoneProfile: '16:9-scripture' };
  if (recommendation === 'keyword-graphic' || recommendation === 'title-card') return { speakerPosition: 'full', graphicRegion: 'upper-right', safeZoneProfile: '16:9-graphic' };
  if (recommendation === 'motion-graphic') return { speakerPosition: 'full', graphicRegion: 'upper-right', safeZoneProfile: '16:9-motion-graphic' };
  return { speakerPosition: 'full', safeZoneProfile: '16:9-no-change' };
}

function sectionGraphic(section: SermonSection): boolean {
  return section.visualRecommendation === 'scripture-card' || section.visualRecommendation === 'keyword-graphic' || section.visualRecommendation === 'title-card' || section.visualRecommendation === 'motion-graphic';
}

function finalOperation(record: PolicyDecisionRecord): EditOperation[] {
  if (record.resolvedDecision === 'keep-current' || record.resolvedDecision === 'none' || record.resolvedDecision === 'speaker-full' || record.resolvedDecision === 'speaker-punch-in') return record.resolvedDecision === 'speaker-punch-in' ? [{ id: `policy-${record.segment}`, type: 'speaker-position', start: record.start, end: record.end, position: 'center', reason: record.reason, confidence: record.confidence }] : [];
  if (record.resolvedDecision === 'speaker-left' || record.resolvedDecision === 'speaker-right') return [{ id: `policy-${record.segment}`, type: 'speaker-position', start: record.start, end: record.end, position: record.resolvedDecision === 'speaker-left' ? 'left' : 'right', reason: record.reason, confidence: record.confidence }];
  if (record.resolvedDecision === 'scripture-card' || record.resolvedDecision === 'keyword-graphic' || record.resolvedDecision === 'title-card' || record.resolvedDecision === 'motion-graphic') return [{ id: `policy-${record.segment}`, type: 'sermon-point', start: record.start, end: record.end, text: record.displayText ?? '', textTrust: record.displayTextTrust, position: 'right', style: `director-v2-${record.resolvedDecision}`, graphicRegion: record.layout.graphicRegion, layout: record.layout, reason: record.reason, confidence: record.confidence }];
  return [];
}

function makeBudget(durationSeconds: number, currentEvents: number): VisualBudget {
  return { durationSeconds, recommendedMinEvents: Math.max(1, Math.floor(durationSeconds / 90)), recommendedMaxEvents: Math.max(4, Math.ceil(durationSeconds / 25)), currentEvents };
}

export function applyRetentionPolicy(analysis: SermonAnalysis, projectId: string, sourceTranscriptHash: string, duration: number, config: RetentionPolicyConfig = defaultRetentionPolicy, trustPolicy?: ContentTrustPolicy): VisualPolicyResult {
  const history: VisualHistory = { secondsSinceLastVisualChange: Number.POSITIVE_INFINITY, recentGraphicTypes: [] };
  const records: PolicyDecisionRecord[] = [];
  const operations: EditOperation[] = [];
  const warnings: string[] = [];
  for (const section of analysis.sections) {
    const recommendation = section.visualRecommendation ?? 'speaker-full';
    const calm = section.intensity === 'reverent-calm';
    const graphic = sectionGraphic(section);
    const layout = layoutFor(recommendation, graphic);
    const display = resolveDisplayText(section, analysis, trustPolicy);
    const displayText = display.text;
    let decision: PolicyDecision = 'ACCEPT';
    let resolved: PolicyDecisionRecord['resolvedDecision'] = recommendation;
    let reason = `Accepted ${recommendation} for ${section.type}.`;
    if (calm && ['speaker-left', 'speaker-right', 'speaker-punch-in', 'image-broll', 'video-broll', 'motion-graphic'].includes(recommendation)) {
      decision = 'SUPPRESS'; resolved = 'keep-current'; reason = `${section.type} is reverent-calm; movement and decorative activity are suppressed.`;
    } else if (graphic && (!displayText || displayText.split(/\n/u).length > config.maxGraphicLines)) {
      decision = 'REVIEW'; resolved = 'keep-current'; reason = 'Graphic display text is missing or exceeds the configured line budget.';
    } else if (graphic && history.secondsSinceLastVisualChange < (calm ? config.calmCooldownSeconds : config.graphicCooldownSeconds) && section.type !== 'main-point') {
      decision = 'MODIFY'; resolved = 'keep-current'; reason = `Graphic cooldown retained the current frame after ${history.secondsSinceLastVisualChange.toFixed(1)} seconds.`;
    } else if (['speaker-left', 'speaker-right'].includes(recommendation) && history.secondsSinceLastVisualChange < config.speakerCooldownSeconds) {
      decision = 'MODIFY'; resolved = 'keep-current'; reason = `Speaker framing cooldown retained the current frame after ${history.secondsSinceLastVisualChange.toFixed(1)} seconds.`;
    } else if (recommendation === 'image-broll' || recommendation === 'video-broll') {
      decision = 'MODIFY'; resolved = 'keep-current'; reason = 'B-roll remains a placeholder recommendation and is not shown in the normal sermon preview.';
    }
    if (display.warning) warnings.push(`${section.id}: ${display.warning}`);
    const record: PolicyDecisionRecord = { sectionId: section.id, segment: `${section.sourceSegmentIds[0]}-${section.sourceSegmentIds.at(-1)}`, start: section.start, end: section.end, section: section.type, intensity: section.intensity, aiRecommendation: recommendation, policyDecision: decision, resolvedDecision: resolved, layout, displayText, displayTextTrust: display.trust, reason, confidence: section.confidence };
    records.push(record);
    const event = finalOperation(record);
    operations.push(...event);
    const changed = resolved !== 'keep-current' && resolved !== 'none';
    if (changed) {
      history.secondsSinceLastVisualChange = 0;
      if (resolved !== 'keep-current') history.lastVisualType = resolved;
      history.lastSpeakerPosition = layout.speakerPosition;
      if (graphic) history.recentGraphicTypes.push(resolved);
    } else {
      history.secondsSinceLastVisualChange += section.end - section.start;
    }
    if (decision === 'REVIEW') warnings.push(`${record.segment}: requires human visual review`);
  }
  const currentEvents = operations.length;
  const budget = makeBudget(duration, currentEvents);
  if (currentEvents / Math.max(duration / 60, 1) > config.maxEventsPerMinute) warnings.push(`Event density exceeds ${config.maxEventsPerMinute} events per minute.`);
  return { records, editPlan: { schemaVersion: '2.0', projectId, sourceTranscriptHash, operations, status: 'draft', createdBy: { provider: 'reverent-retention-policy', model: config.version } }, budget, warnings };
}

export function validateVisualPolicy(result: VisualPolicyResult, duration: number, config: RetentionPolicyConfig = defaultRetentionPolicy): string[] {
  const failures: string[] = [];
  for (const record of result.records) {
    if (record.start < 0 || record.end <= record.start || record.end > duration) failures.push(`${record.segment}: invalid visual range`);
    if (record.layout.speakerPosition === 'left' && record.layout.graphicRegion === 'left') failures.push(`${record.segment}: graphic collides with left speaker safe zone`);
    if (record.layout.speakerPosition === 'right' && record.layout.graphicRegion === 'right') failures.push(`${record.segment}: graphic collides with right speaker safe zone`);
    if (record.displayText && record.displayText.split(/\n/u).length > config.maxGraphicLines) failures.push(`${record.segment}: display text exceeds line budget`);
  }
  if (result.editPlan.operations.some((operation) => operation.start < 0 || operation.end > duration)) failures.push('edit plan contains an out-of-range operation');
  return failures;
}
