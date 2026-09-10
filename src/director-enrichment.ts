import type { SermonAnalysis, TranscriptDocument } from './contracts.ts';
import type { DirectorProvider, DirectorProviderResult } from './director.ts';
import { enrichmentOpportunities, evaluateDirectorQuality, type DirectorQualitySummary, type EditorialOpportunity } from './editorial-opportunity.ts';

export interface DirectorEditorialEnrichmentResult {
  analysis: SermonAnalysis;
  initialQuality: DirectorQualitySummary;
  quality: DirectorQualitySummary;
  enrichmentTriggered: boolean;
  enrichmentAttemptCount: number;
  providerResult?: DirectorProviderResult;
  error?: string;
  outcome: 'not-needed' | 'succeeded' | 'failed' | 'unavailable';
}

function eligibleSegmentIds(analysis: SermonAnalysis, opportunities: EditorialOpportunity[]): string[] {
  const eligible = new Set(opportunities.map((item) => item.sectionId));
  return analysis.sections.filter((section) => eligible.has(section.id)).flatMap((section) => section.sourceSegmentIds);
}

export function mergeEditorialEnrichment(
  transcript: TranscriptDocument,
  original: SermonAnalysis,
  enriched: SermonAnalysis,
  opportunities: EditorialOpportunity[],
): SermonAnalysis {
  const allowedSegments = new Set(eligibleSegmentIds(original, opportunities));
  const suppliedSegments = enriched.sections.flatMap((section) => section.sourceSegmentIds);
  if (!suppliedSegments.length) throw new Error('Editorial enrichment returned no revised sections.');
  if (suppliedSegments.some((id) => !allowedSegments.has(id))) throw new Error('Editorial enrichment modified a protected or ineligible canonical segment.');
  if (new Set(suppliedSegments).size !== suppliedSegments.length) throw new Error('Editorial enrichment duplicated canonical segment identity.');
  if (suppliedSegments.length !== allowedSegments.size || [...allowedSegments].some((id) => !suppliedSegments.includes(id))) {
    throw new Error('Editorial enrichment did not cover every requested weak canonical segment.');
  }
  const canonical = new Map(transcript.segments.map((segment, index) => [segment.id, { segment, index }]));
  const opportunityBySegment = new Map<string, EditorialOpportunity>();
  for (const opportunity of opportunities) {
    const source = original.sections.find((section) => section.id === opportunity.sectionId);
    for (const id of source?.sourceSegmentIds ?? []) opportunityBySegment.set(id, opportunity);
  }
  const originalByRange = new Map(original.sections.filter((section) => section.sourceSegmentIds.some((id) => allowedSegments.has(id))).map((section) => [section.sourceSegmentIds.join('|'), section]));
  const revisions = new Map<string, SermonAnalysis['sections'][number]>();
  for (const section of enriched.sections) {
    const canonicalEntries = section.sourceSegmentIds.map((id) => canonical.get(id));
    if (canonicalEntries.some((entry) => !entry)) throw new Error('Editorial enrichment referenced an unknown canonical segment.');
    for (let index = 1; index < canonicalEntries.length; index += 1) {
      if (canonicalEntries[index]!.index !== canonicalEntries[index - 1]!.index + 1) throw new Error('Editorial enrichment canonical segments are not contiguous and ordered.');
    }
    const originalSection = originalByRange.get(section.sourceSegmentIds.join('|'));
    if (!originalSection) throw new Error('Editorial enrichment changed semantic section boundaries.');
    if (section.type !== originalSection.type || section.intensity !== originalSection.intensity) throw new Error('Editorial enrichment changed protected semantic classification.');
    if (section.start !== originalSection.start || section.end !== originalSection.end) throw new Error('Editorial enrichment changed canonical timing.');
    if (section.transcriptText !== originalSection.transcriptText) throw new Error('Editorial enrichment changed canonical transcript text.');
    const coveredOpportunities = section.sourceSegmentIds.map((id) => opportunityBySegment.get(id));
    if (coveredOpportunities.some((item) => !item)) throw new Error('Editorial enrichment has no opportunity contract for a revised segment.');
    if (coveredOpportunities.some((item) => !item!.eligibleVisualTypes.includes(section.visualRecommendation ?? 'speaker-full'))) {
      throw new Error(`Editorial enrichment selected ${section.visualRecommendation} outside the eligible visual palette.`);
    }
    if (section.visualRecommendation === 'caption') {
      const text = section.suggestedDisplayText?.trim() ?? '';
      if (!text || text.length > 120 || text.split(/\n/u).length > 2) throw new Error('Editorial enrichment caption is not a concise semantic phrase.');
      if (text === section.transcriptText.trim()) throw new Error('Editorial enrichment caption repeats the entire canonical section.');
    }
    revisions.set(section.sourceSegmentIds.join('|'), section);
  }
  if (revisions.size !== originalByRange.size) throw new Error('Editorial enrichment did not return exactly one revised decision per weak semantic section.');
  return {
    ...original,
    sections: original.sections.map((section) => {
      const revision = revisions.get(section.sourceSegmentIds.join('|'));
      return revision ? {
        ...section,
        visualRecommendation: revision.visualRecommendation,
        suggestedDisplayText: revision.suggestedDisplayText,
        reason: revision.reason,
        confidence: revision.confidence,
      } : section;
    }),
    confidence: Math.min(original.confidence, enriched.confidence),
  };
}

export async function runBoundedEditorialEnrichment(
  transcript: TranscriptDocument,
  initialAnalysis: SermonAnalysis,
  provider: DirectorProvider | undefined,
  maxAttempts = 1,
): Promise<DirectorEditorialEnrichmentResult> {
  const initialQuality = evaluateDirectorQuality(initialAnalysis);
  if (initialQuality.enrichmentTriggerReasons.length === 0) {
    return { analysis: initialAnalysis, initialQuality, quality: initialQuality, enrichmentTriggered: false, enrichmentAttemptCount: 0, outcome: 'not-needed' };
  }
  const opportunities = enrichmentOpportunities(initialAnalysis);
  if (!opportunities.length || !provider?.enrichEditorial || maxAttempts < 1) {
    return {
      analysis: initialAnalysis,
      initialQuality,
      quality: { ...initialQuality, enrichmentTriggered: true, enrichmentTriggerReasons: initialQuality.enrichmentTriggerReasons },
      enrichmentTriggered: true,
      enrichmentAttemptCount: 0,
      outcome: 'unavailable',
      error: 'Editorial enrichment is required, but the configured provider does not support it.',
    };
  }
  const ids = eligibleSegmentIds(initialAnalysis, opportunities);
  const input = {
    transcript,
    segments: transcript.segments,
    projectDuration: transcript.segments.at(-1)?.end ?? 0,
    projectId: transcript.projectId,
    primarySegmentIds: ids,
  };
  let providerResult: DirectorProviderResult | undefined;
  try {
    providerResult = await provider.enrichEditorial({ input, currentAnalysis: initialAnalysis, opportunities, eligibleSegmentIds: ids });
    if (providerResult.attempts.length > maxAttempts) throw new Error(`Editorial enrichment provider exceeded the ${maxAttempts}-attempt limit.`);
    if (!providerResult.analysis || !['ai-success', 'ai-retry-success'].includes(providerResult.providerResult)) {
      throw new Error(providerResult.error ?? 'Editorial enrichment provider returned no usable analysis.');
    }
    const analysis = mergeEditorialEnrichment(transcript, initialAnalysis, providerResult.analysis, opportunities);
    const enrichmentAttemptCount = providerResult.attempts.length;
    const quality = evaluateDirectorQuality(analysis, { enrichmentTriggered: true, enrichmentAttemptCount, enrichmentTriggerReasons: initialQuality.enrichmentTriggerReasons });
    return { analysis, initialQuality, quality, enrichmentTriggered: true, enrichmentAttemptCount, providerResult, outcome: 'succeeded' };
  } catch (error) {
    const enrichmentAttemptCount = providerResult?.attempts.length ?? 1;
    return {
      analysis: initialAnalysis,
      initialQuality,
      quality: { ...initialQuality, enrichmentTriggered: true, enrichmentAttemptCount, enrichmentTriggerReasons: initialQuality.enrichmentTriggerReasons },
      enrichmentTriggered: true,
      enrichmentAttemptCount,
      providerResult,
      outcome: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
