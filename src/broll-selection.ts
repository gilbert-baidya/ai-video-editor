import type {
  BrollDecision,
  BrollIntent,
  MediaCandidate,
  MediaIndex,
  MediaSearchIntent,
  MediaUsageHistory,
  SermonAnalysis,
  SermonSection,
} from './contracts.ts';
import { rightsAllowsAutomation } from './media-library.ts';

const SUPPRESSED_TYPES = new Set(['scripture-reading', 'prayer', 'emotional-ministry', 'application', 'transition', 'conclusion', 'altar-call', 'question']);
const SEARCH_TYPES = new Set(['illustration', 'story', 'testimony']);
const SYNONYMS: Record<string, string[]> = {
  pressure: ['cooker', 'stress', 'cooking', 'kitchen'],
  cooker: ['pressure', 'cooking', 'kitchen'],
  storm: ['water', 'sea', 'wave', 'rough'],
  sea: ['water', 'storm', 'wave'],
  tree: ['growth', 'garden', 'nature'],
  prayer: ['pray', 'church'],
  'প্রেসার': ['pressure', 'cooker'],
  'কুকার': ['cooker', 'pressure'],
  'কুকারের': ['cooker', 'pressure'],
  'উদাহরণ': ['example', 'illustration'],
};

function terms(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9\u0980-\u09ff]+/).filter((term) => term.length > 2);
}

function expandedTerms(values: string[]): Set<string> {
  const expanded = new Set(values.flatMap(terms));
  for (const term of [...expanded]) for (const synonym of SYNONYMS[term] ?? []) expanded.add(synonym);
  return expanded;
}

function createSearchIntent(section: SermonSection): MediaSearchIntent {
  const concept = section.suggestedDisplayText || section.transcriptText.slice(0, 160);
  const semanticTags = [...expandedTerms([concept, section.transcriptText])];
  return {
    concept,
    sectionId: section.id,
    sectionType: section.type,
    desiredMedia: section.visualRecommendation === 'image-broll' ? 'image' : section.visualRecommendation === 'video-broll' ? 'video' : 'either',
    semanticTags,
    avoidTerms: ['stock', 'logo', 'watermark', 'graphic'],
    preferredCategories: section.type === 'illustration' ? ['illustration', 'nature'] : ['nature', 'scripture'],
    allowUnknownRights: false,
  };
}

export function buildBrollIntents(analysis: SermonAnalysis): BrollIntent[] {
  return analysis.sections.map((section) => {
    if (SUPPRESSED_TYPES.has(section.type)) {
      return { sectionId: section.id, start: section.start, end: section.end, decision: 'no-broll', reason: `${section.type} is preserved as speaker-led content.` };
    }
    if (!SEARCH_TYPES.has(section.type) && section.visualRecommendation !== 'image-broll' && section.visualRecommendation !== 'video-broll') {
      return { sectionId: section.id, start: section.start, end: section.end, decision: 'no-broll', reason: 'This section does not contain a concrete visual illustration that warrants local media.' };
    }
    return { sectionId: section.id, start: section.start, end: section.end, decision: 'search', reason: 'A concrete story or illustration may benefit from one calm local visual.', search: createSearchIntent(section) };
  });
}

function scoreCandidate(index: MediaIndex, intent: MediaSearchIntent, assetId: string, history: MediaUsageHistory[]): MediaCandidate {
  const asset = index.assets.find((item) => item.id === assetId);
  if (!asset) return { assetId, score: 0, semanticScore: 0, categoryScore: 0, technicalScore: 0, rightsScore: 0, repetitionPenalty: 0, reasons: ['Asset is missing from the current index.'], eligible: false };
  const wanted = expandedTerms([intent.concept, ...intent.semanticTags]);
  const searchable = expandedTerms([asset.fileName, asset.relativePath, ...asset.tags, ...asset.categories, asset.description ?? '', ...asset.searchTerms]);
  const matches = [...wanted].filter((term) => searchable.has(term));
  const semanticScore = Math.min(1, matches.length / Math.max(1, Math.min(8, wanted.size)));
  const categoryScore = Math.min(1, (intent.preferredCategories ?? []).filter((category) => asset.categories.includes(category)).length / Math.max(1, (intent.preferredCategories ?? []).length));
  const technicalScore = asset.usable && asset.width >= 640 && asset.height >= 360 ? (intent.desiredMedia === 'either' || asset.kind === intent.desiredMedia ? 1 : 0.35) : 0;
  const rightsScore = rightsAllowsAutomation(asset.rightsStatus) ? 1 : 0;
  const repetitionPenalty = history.some((item) => item.assetId === asset.id) ? 0.35 : 0;
  const score = Math.max(0, semanticScore * 0.5 + categoryScore * 0.2 + technicalScore * 0.15 + rightsScore * 0.15 - repetitionPenalty);
  const reasons = [
    matches.length ? `Matched semantic terms: ${matches.slice(0, 5).join(', ')}.` : 'No semantic metadata match.',
    categoryScore ? `Preferred category match: ${(intent.preferredCategories ?? []).filter((category) => asset.categories.includes(category)).join(', ')}.` : 'No preferred category match.',
    technicalScore === 1 ? 'Technical dimensions and requested media type are compatible.' : technicalScore > 0 ? `Technical dimensions are renderable, but the asset is ${asset.kind} and the intent requested ${intent.desiredMedia}.` : 'Technical dimensions are not renderable.',
    rightsScore ? `Rights status ${asset.rightsStatus} permits automation.` : `Rights status ${asset.rightsStatus} requires review.`,
  ];
  if (repetitionPenalty) reasons.push('Previously used in this usage history.');
  return { assetId, score, semanticScore, categoryScore, technicalScore, rightsScore, repetitionPenalty, reasons, eligible: asset.usable && rightsScore > 0 && score >= 0.55 };
}

export function rankMediaCandidates(index: MediaIndex, intent: MediaSearchIntent, history: MediaUsageHistory[] = []): MediaCandidate[] {
  return index.assets
    .map((asset) => scoreCandidate(index, intent, asset.id, history))
    .sort((left, right) => right.score - left.score);
}

export function decideBroll(index: MediaIndex, intent: BrollIntent, history: MediaUsageHistory[] = []): BrollDecision {
  if (intent.decision === 'no-broll' || !intent.search) return { intent, candidates: [], decision: 'no-broll', reason: intent.reason };
  const candidates = rankMediaCandidates(index, intent.search, history);
  const selected = candidates.find((candidate) => candidate.eligible);
  if (!selected) return { intent, candidates, decision: 'no-suitable-asset', reason: 'No local asset met semantic relevance, technical, rights, and reuse thresholds.' };
  return { intent, candidates, selectedAssetId: selected.assetId, decision: 'selected', reason: selected.reasons.join(' ') };
}
