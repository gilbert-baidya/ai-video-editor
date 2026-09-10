import type { SermonAnalysis, SermonSection, VisualRecommendation, EditorialIntent } from './contracts.ts';

const protectedTypes = new Set(['prayer', 'scripture-reading', 'altar-call', 'emotional-ministry', 'conclusion']);

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

export type ReverenceSensitivity = 'NORMAL' | 'ELEVATED' | 'PROTECTED';
export type VisualOpportunityLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EditorialOpportunity {
  sectionId: string;
  semanticType: string;
  intensity?: string;
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
  
  totalStorySections: number;
  eligibleStorySections: number;
  treatedStorySections: number;
  untreatedStorySections: number;
  untreatedStorySectionIds: string[];
  deliberateSpeakerLedStories: number;
  
  decisionConsistencyFailures: number;
  inconsistentSectionIds: string[];
  enrichmentTriggerReasons: string[];
  
  visualVarietyScore: number;
  staticRisk: StaticRisk;
  longestEligibleUntreatedSeconds: number;
  
  enrichmentTriggered: boolean;
  enrichmentAttemptCount: number;
  reason: string;
}

export type StoryTreatmentStatus = 'treated' | 'untreated' | 'deliberate-speaker-led' | 'not-a-story';

export function determineStoryTreatment(section: SermonSection): StoryTreatmentStatus {
  if (!['story', 'illustration', 'testimony', 'narrative'].includes(section.type)) return 'not-a-story';
  
  if (isMeaningfulRecommendation(section.visualRecommendation)) return 'treated';
  if (section.editorialIntent === 'PRESERVE_SPEAKER') return 'deliberate-speaker-led';
  
  return 'untreated';
}

export function validateDecisionConsistency(section: SermonSection): boolean {
  const intent = section.editorialIntent;
  const rec = section.visualRecommendation ?? 'speaker-full';
  
  if (intent === 'USE_CONTEXTUAL_VISUAL' && !['image-broll', 'video-broll', 'motion-graphic'].includes(rec)) return false;
  if (intent === 'EMPHASIZE_SPEAKER' && !['speaker-punch-in', 'speaker-left', 'speaker-right'].includes(rec)) return false;
  if (intent === 'SHOW_KEY_TEXT' && !['caption', 'keyword-graphic', 'title-card'].includes(rec)) return false;
  if (intent === 'SHOW_SCRIPTURE' && rec !== 'scripture-card') return false;
  
  const rLower = section.reason.toLowerCase();
  if ((rLower.includes('contextual b-roll enhances') || rLower.includes('requires contextual b-roll')) && !['image-broll', 'video-broll'].includes(rec)) return false;
  if ((rLower.includes('punch-in') && rLower.includes('emphasize')) && rec !== 'speaker-punch-in') return false;
  if ((rLower.includes('scripture reference') && rLower.includes('display')) && rec === 'speaker-full') return false;
  
  return true;
}

function opportunityFor(section: SermonSection): Pick<EditorialOpportunity, 'reverenceSensitivity' | 'visualOpportunity' | 'eligibleVisualTypes' | 'reason'> {
  if (protectedTypes.has(section.type)) {
    return {
      reverenceSensitivity: 'PROTECTED',
      visualOpportunity: section.type === 'scripture-reading' ? 'MEDIUM' : 'LOW',
      eligibleVisualTypes: section.type === 'scripture-reading' ? ['speaker-full', 'scripture-card', 'none'] : ['speaker-full', 'none'],
      reason: `${section.type} is protected by Reverent Retention.`,
    };
  }
  if (section.type === 'main-point') return { reverenceSensitivity: 'NORMAL', visualOpportunity: 'HIGH', eligibleVisualTypes: ['keyword-graphic', 'caption', 'speaker-punch-in', 'speaker-left', 'speaker-right', 'speaker-full', 'none'], reason: 'A main point can benefit from concise emphasis or a restrained reframe.' };
  if (section.type === 'question') return { reverenceSensitivity: 'NORMAL', visualOpportunity: 'HIGH', eligibleVisualTypes: ['caption', 'speaker-punch-in', 'keyword-graphic', 'speaker-left', 'speaker-right', 'speaker-full', 'none'], reason: 'A rhetorical question is a strong semantic emphasis opportunity.' };
  if (['story', 'illustration', 'testimony', 'narrative'].includes(section.type)) return { reverenceSensitivity: 'NORMAL', visualOpportunity: 'HIGH', eligibleVisualTypes: ['image-broll', 'video-broll', 'caption', 'speaker-punch-in', 'speaker-left', 'speaker-right', 'speaker-full', 'none'], reason: 'Concrete narrative content should actively consider contextual B-roll or a restrained speaker-led alternative.' };
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
  options: { enrichmentTriggered?: boolean; enrichmentAttemptCount?: number; enrichmentTriggerReasons?: string[] } = {},
): DirectorQualitySummary {
  const opportunities = buildEditorialOpportunities(analysis);
  const eligible = opportunities.filter((item) => item.reverenceSensitivity !== 'PROTECTED' && item.visualOpportunity !== 'LOW');
  const meaningful = analysis.sections.filter((section) => isMeaningfulRecommendation(section.visualRecommendation));
  const meaningfulEligible = meaningful.filter((section) => eligible.some((item) => item.sectionId === section.id));
  const eligibleDuration = analysis.sections.filter((section) => eligible.some((item) => item.sectionId === section.id)).reduce((total, section) => total + section.end - section.start, 0);
  const longestEligibleUntreatedSeconds = longestUntreatedRun(analysis, opportunities);
  const uniqueVisuals = new Set(meaningfulEligible.map((section) => section.visualRecommendation));
  const visualVarietyScore = eligible.length ? Number((uniqueVisuals.size / Math.min(eligible.length, 5)).toFixed(3)) : 1;
  
  let treatedStorySections = 0;
  let untreatedStorySections = 0;
  let deliberateSpeakerLedStories = 0;
  let eligibleStorySections = 0;
  const untreatedStorySectionIds: string[] = [];
  let totalStorySections = 0;
  
  let decisionConsistencyFailures = 0;
  const inconsistentSectionIds: string[] = [];

  for (const section of analysis.sections) {
    if (!validateDecisionConsistency(section)) {
      decisionConsistencyFailures++;
      inconsistentSectionIds.push(section.id);
    }
    const treatment = determineStoryTreatment(section);
    if (treatment !== 'not-a-story') {
      totalStorySections++;
      eligibleStorySections++;
      if (treatment === 'treated') treatedStorySections++;
      else if (treatment === 'deliberate-speaker-led') deliberateSpeakerLedStories++;
      else {
        untreatedStorySections++;
        untreatedStorySectionIds.push(section.id);
      }
    }
  }

  const lowActivity = (
    (eligibleDuration >= 30 && meaningfulEligible.length <= 1)
    || longestEligibleUntreatedSeconds >= 30
    || (eligible.length >= 3 && visualVarietyScore === 0)
  );

  const enrichmentTriggerReasons = options.enrichmentTriggerReasons ?? [];
  if (lowActivity && !enrichmentTriggerReasons.includes('LOW_ACTIVITY')) enrichmentTriggerReasons.push('LOW_ACTIVITY');
  if (untreatedStorySections > 0 && !enrichmentTriggerReasons.includes('UNTREATED_STORY')) enrichmentTriggerReasons.push('UNTREATED_STORY');
  if (decisionConsistencyFailures > 0 && !enrichmentTriggerReasons.includes('DECISION_CONTRADICTION')) enrichmentTriggerReasons.push('DECISION_CONTRADICTION');
  
  const enrichmentTriggered = options.enrichmentTriggered ?? (enrichmentTriggerReasons.length > 0);
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
    
    totalStorySections,
    eligibleStorySections,
    treatedStorySections,
    untreatedStorySections,
    untreatedStorySectionIds,
    deliberateSpeakerLedStories,
    
    decisionConsistencyFailures,
    inconsistentSectionIds,
    enrichmentTriggerReasons,
    
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
  return buildEditorialOpportunities(analysis).filter((opportunity) => {
    const section = analysis.sections.find(s => s.id === opportunity.sectionId)!;
    const untreatedStory = determineStoryTreatment(section) === 'untreated';
    const inconsistent = !validateDecisionConsistency(section);
    const lowActivityCandidate = opportunity.reverenceSensitivity !== 'PROTECTED' && opportunity.visualOpportunity !== 'LOW' && !isMeaningfulRecommendation(opportunity.currentRecommendation);
    return untreatedStory || inconsistent || lowActivityCandidate;
  });
}
