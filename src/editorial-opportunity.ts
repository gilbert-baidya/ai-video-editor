import type { SermonAnalysis, SermonSection, VisualRecommendation } from './contracts.ts';

export type VisualOpportunityLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type ReverenceSensitivity = 'NORMAL' | 'ELEVATED' | 'PROTECTED';

export interface EditorialOpportunity {
  sectionId: string;
  semanticType: SermonSection['type'];
  intensity: SermonSection['intensity'];
  reverenceSensitivity: ReverenceSensitivity;
  visualOpportunity: VisualOpportunityLevel;
  eligibleVisualTypes: VisualRecommendation[];
  currentRecommendation: VisualRecommendation;
  reason: string;
}

export type DirectorQualityStatus = 'NORMAL' | 'LOW-ACTIVITY' | 'ENRICHED';
export type StaticRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DirectorQualitySummary {
  status: DirectorQualityStatus;
  totalSections: number;
  eligibleSections: number;
  meaningfulRecommendations: number;
  noChangeSections: number;
  speakerFullSections: number;
  brollRecommendations: number;
  captionRecommendations: number;
  reframes: number;
  graphics: number;
  scripture: number;
  storySectionsWithoutTreatment: number;
  visualVarietyScore: number;
  staticRisk: StaticRisk;
  longestEligibleUntreatedSeconds: number;
  enrichmentTriggered: boolean;
  enrichmentAttemptCount: number;
  reason: string;
}

const protectedTypes = new Set<SermonSection['type']>(['prayer', 'scripture-reading', 'altar-call', 'emotional-ministry']);
const meaningfulVisuals = new Set<VisualRecommendation>([
  'speaker-left',
  'speaker-right',
  'speaker-punch-in',
  'caption',
  'scripture-card',
  'title-card',
  'keyword-graphic',
  'image-broll',
  'video-broll',
  'motion-graphic',
  'split-screen',
]);

export function isMeaningfulRecommendation(recommendation: VisualRecommendation | undefined): boolean {
  return recommendation !== undefined && meaningfulVisuals.has(recommendation);
}

function opportunityFor(section: SermonSection): Pick<EditorialOpportunity, 'reverenceSensitivity' | 'visualOpportunity' | 'eligibleVisualTypes' | 'reason'> {
  if (protectedTypes.has(section.type)) {
    return {
      reverenceSensitivity: 'PROTECTED',
      visualOpportunity: section.type === 'scripture-reading' ? 'MEDIUM' : 'LOW',
      eligibleVisualTypes: section.type === 'scripture-reading' ? ['speaker-full', 'scripture-card', 'none'] : ['speaker-full', 'none'],
      reason: `${section.type} is protected by Reverent Retention and is excluded from activity-driven enrichment.`,
    };
  }
  if (section.type === 'main-point') return { reverenceSensitivity: 'NORMAL', visualOpportunity: 'HIGH', eligibleVisualTypes: ['keyword-graphic', 'caption', 'speaker-punch-in', 'speaker-left', 'speaker-right', 'speaker-full', 'none'], reason: 'A main point can benefit from concise emphasis or a restrained reframe.' };
  if (section.type === 'question') return { reverenceSensitivity: 'NORMAL', visualOpportunity: 'HIGH', eligibleVisualTypes: ['caption', 'speaker-punch-in', 'keyword-graphic', 'speaker-left', 'speaker-right', 'speaker-full', 'none'], reason: 'A rhetorical question is a strong semantic emphasis opportunity.' };
  if (section.type === 'story' || section.type === 'illustration' || section.type === 'testimony') return { reverenceSensitivity: 'NORMAL', visualOpportunity: 'HIGH', eligibleVisualTypes: ['image-broll', 'video-broll', 'caption', 'speaker-punch-in', 'speaker-left', 'speaker-right', 'speaker-full', 'none'], reason: 'Concrete narrative content should actively consider contextual B-roll or a restrained speaker-led alternative.' };
  if (section.intensity === 'emphasis') return { reverenceSensitivity: 'NORMAL', visualOpportunity: 'HIGH', eligibleVisualTypes: ['speaker-punch-in', 'caption', 'keyword-graphic', 'speaker-left', 'speaker-right', 'speaker-full', 'none'], reason: 'Strong emphasis supports a concise key phrase or visual reset.' };
  if (section.type === 'teaching' || section.type === 'application') return { reverenceSensitivity: 'NORMAL', visualOpportunity: 'MEDIUM', eligibleVisualTypes: ['caption', 'speaker-left', 'speaker-right', 'speaker-punch-in', 'keyword-graphic', 'speaker-full', 'none'], reason: 'Ordinary teaching may use occasional semantic captions or subtle reframing.' };
  return { reverenceSensitivity: 'ELEVATED', visualOpportunity: 'MEDIUM', eligibleVisualTypes: ['caption', 'speaker-left', 'speaker-right', 'speaker-punch-in', 'speaker-full', 'none'], reason: 'A restrained speaker-led variation may improve section clarity.' };
}

export function buildEditorialOpportunities(analysis: SermonAnalysis): EditorialOpportunity[] {
  return analysis.sections.map((section) => ({
    sectionId: section.id,
    semanticType: section.type,
    intensity: section.intensity,
    currentRecommendation: section.visualRecommendation ?? 'speaker-full',
    ...opportunityFor(section),
  }));
}

function longestUntreatedRun(analysis: SermonAnalysis, opportunities: EditorialOpportunity[]): number {
  const byId = new Map(opportunities.map((item) => [item.sectionId, item]));
  let longest = 0;
  let currentStart: number | undefined;
  let currentEnd = 0;
  for (const section of [...analysis.sections].sort((left, right) => left.start - right.start)) {
    const opportunity = byId.get(section.id);
    const untreated = opportunity?.reverenceSensitivity !== 'PROTECTED'
      && opportunity?.visualOpportunity !== 'LOW'
      && !isMeaningfulRecommendation(section.visualRecommendation);
    if (untreated) {
      if (currentStart === undefined || section.start > currentEnd + 0.001) currentStart = section.start;
      currentEnd = Math.max(currentEnd, section.end);
      longest = Math.max(longest, currentEnd - currentStart);
    } else {
      currentStart = undefined;
      currentEnd = section.end;
    }
  }
  return longest;
}

export function evaluateDirectorQuality(
  analysis: SermonAnalysis,
  options: { enrichmentTriggered?: boolean; enrichmentAttemptCount?: number } = {},
): DirectorQualitySummary {
  const opportunities = buildEditorialOpportunities(analysis);
  const eligible = opportunities.filter((item) => item.reverenceSensitivity !== 'PROTECTED' && item.visualOpportunity !== 'LOW');
  const meaningful = analysis.sections.filter((section) => isMeaningfulRecommendation(section.visualRecommendation));
  const meaningfulEligible = meaningful.filter((section) => eligible.some((item) => item.sectionId === section.id));
  const eligibleDuration = analysis.sections.filter((section) => eligible.some((item) => item.sectionId === section.id)).reduce((total, section) => total + section.end - section.start, 0);
  const longestEligibleUntreatedSeconds = longestUntreatedRun(analysis, opportunities);
  const uniqueVisuals = new Set(meaningfulEligible.map((section) => section.visualRecommendation));
  const visualVarietyScore = eligible.length ? Number((uniqueVisuals.size / Math.min(eligible.length, 5)).toFixed(3)) : 1;
  const storySectionsWithoutTreatment = analysis.sections.filter((section) =>
    ['story', 'illustration', 'testimony'].includes(section.type) && !isMeaningfulRecommendation(section.visualRecommendation)).length;
  const lowActivity = (
    (eligibleDuration >= 30 && meaningfulEligible.length <= 1)
    || longestEligibleUntreatedSeconds >= 30
    || (eligible.length >= 3 && visualVarietyScore === 0)
  );
  const enrichmentTriggered = options.enrichmentTriggered ?? false;
  const status: DirectorQualityStatus = lowActivity ? 'LOW-ACTIVITY' : enrichmentTriggered ? 'ENRICHED' : 'NORMAL';
  const staticRisk: StaticRisk = longestEligibleUntreatedSeconds >= 40 ? 'HIGH' : longestEligibleUntreatedSeconds >= 25 ? 'MEDIUM' : 'LOW';
  return {
    status,
    totalSections: analysis.sections.length,
    eligibleSections: eligible.length,
    meaningfulRecommendations: meaningfulEligible.length,
    noChangeSections: analysis.sections.filter((section) => section.visualRecommendation === 'none').length,
    speakerFullSections: analysis.sections.filter((section) => !section.visualRecommendation || section.visualRecommendation === 'speaker-full').length,
    brollRecommendations: analysis.sections.filter((section) => section.visualRecommendation === 'image-broll' || section.visualRecommendation === 'video-broll').length,
    captionRecommendations: analysis.sections.filter((section) => section.visualRecommendation === 'caption').length,
    reframes: analysis.sections.filter((section) => ['speaker-left', 'speaker-right', 'speaker-punch-in'].includes(section.visualRecommendation ?? '')).length,
    graphics: analysis.sections.filter((section) => ['keyword-graphic', 'title-card', 'motion-graphic'].includes(section.visualRecommendation ?? '')).length,
    scripture: analysis.sections.filter((section) => section.visualRecommendation === 'scripture-card').length,
    storySectionsWithoutTreatment,
    visualVarietyScore,
    staticRisk,
    longestEligibleUntreatedSeconds,
    enrichmentTriggered,
    enrichmentAttemptCount: options.enrichmentAttemptCount ?? 0,
    reason: lowActivity
      ? `${meaningfulEligible.length} meaningful recommendation(s) across ${eligible.length} eligible sections; longest untreated eligible run is ${longestEligibleUntreatedSeconds.toFixed(1)} seconds.`
      : `Director uses ${uniqueVisuals.size} meaningful visual type(s) across ${eligible.length} eligible sections without an excessive untreated run.`,
  };
}

export function enrichmentOpportunities(analysis: SermonAnalysis): EditorialOpportunity[] {
  return buildEditorialOpportunities(analysis).filter((opportunity) =>
    opportunity.reverenceSensitivity !== 'PROTECTED'
    && opportunity.visualOpportunity !== 'LOW'
    && !isMeaningfulRecommendation(opportunity.currentRecommendation));
}
