import type { EditOperation, EditPlan, GraphicRegion, PlacementDecision, SafeZoneScore, SermonAnalysis, SafeZoneRegion, VisualFrameAnalysis, VisualRect, VisualRegion } from './contracts.ts';
import type { VisualPolicyResult } from './visual-policy.ts';

export interface PlacementConfig {
  minimumScore: number;
  minimumFontSize: number;
  maximumFontSize: number;
  maxLines: number;
  titleSafeMargin: number;
}

export const defaultPlacementConfig: PlacementConfig = {
  minimumScore: 0.52,
  minimumFontSize: 34,
  maximumFontSize: 62,
  maxLines: 3,
  titleSafeMargin: 0.045,
};

export const VISUAL_SAMPLING_VERSION = 'beat-relative-sampling-v2';
export const PLACEMENT_ALGORITHM_VERSION = 'safe-zone-placement-v2';
export const TEXT_FIT_ALGORITHM_VERSION = 'bangla-text-fit-v2';

export function representativeSampleTimes(start: number, end: number, mediaDuration: number, frameDuration = 1 / 30): number[] {
  if (start < 0 || end <= start || mediaDuration <= 0) throw new Error(`Invalid visual sampling range: ${start}-${end} of ${mediaDuration}.`);
  const legalEnd = Math.max(0, mediaDuration - frameDuration);
  const boundedStart = Math.min(start, legalEnd);
  const boundedEnd = Math.min(end, legalEnd);
  return [...new Set([boundedStart, (boundedStart + boundedEnd) / 2, boundedEnd].map((time) => Number(time.toFixed(3))))];
}

const candidateRects: Record<SafeZoneRegion, VisualRect> = {
  left: { x: 0.05, y: 0.25, width: 0.30, height: 0.34 },
  right: { x: 0.65, y: 0.25, width: 0.30, height: 0.34 },
  'upper-left': { x: 0.05, y: 0.08, width: 0.34, height: 0.22 },
  'upper-right': { x: 0.61, y: 0.08, width: 0.34, height: 0.22 },
  'lower-left': { x: 0.05, y: 0.68, width: 0.34, height: 0.20 },
  'lower-right': { x: 0.61, y: 0.68, width: 0.34, height: 0.20 },
  center: { x: 0.30, y: 0.35, width: 0.40, height: 0.28 },
};

function intersectionArea(a: VisualRect, b: VisualRect): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function overlapRatio(candidate: VisualRect, occupied: VisualRect): number {
  return intersectionArea(candidate, occupied) / Math.max(candidate.width * candidate.height, 0.0001);
}

function fitText(text: string | undefined, region: VisualRect, config: PlacementConfig): PlacementDecision['textFit'] {
  const characterCount = Array.from(text ?? '').length;
  const maxCharactersPerLine = Math.max(8, Math.floor((region.width * 1920) / (config.maximumFontSize * 0.72)));
  const lineCount = Math.max(1, Math.ceil(characterCount / maxCharactersPerLine));
  const fontSize = Math.min(config.maximumFontSize, Math.max(config.minimumFontSize, Math.floor((region.width * 1920) / Math.max(characterCount, 1) * 0.62)));
  return { fontSize, maxLines: config.maxLines, lineCount, fits: lineCount <= config.maxLines && fontSize >= config.minimumFontSize };
}

function regionPreference(region: SafeZoneRegion, subject: VisualRegion | undefined, occupied: VisualRegion[]): number {
  const center = candidateRects[region].x + candidateRects[region].width / 2;
  let score = 0.52;
  if (subject?.classification === 'right' && center < 0.5) score += 0.22;
  if (subject?.classification === 'left' && center > 0.5) score += 0.22;
  if (subject?.classification === 'center' && (region === 'upper-left' || region === 'upper-right')) score += 0.08;
  if (region === 'lower-left' || region === 'lower-right') score -= 0.04;
  if (occupied.some((item) => item.kind === 'screen' && item.classification === 'left' && center < 0.5)) score -= 0.12;
  if (occupied.some((item) => item.kind === 'screen' && item.classification === 'right' && center > 0.5)) score -= 0.12;
  return score;
}

function scoreCandidate(region: SafeZoneRegion, frames: VisualFrameAnalysis[], text: string | undefined, config: PlacementConfig): SafeZoneScore & { fit: PlacementDecision['textFit'] } {
  const candidate = candidateRects[region];
  const blockedBy = new Set<string>();
  let total = 0;
  let availableArea = 0;
  let fit = fitText(text, candidate, config);
  for (const frame of frames) {
    let score = regionPreference(region, frame.subject, frame.occupied);
    for (const face of frame.faces) {
      const overlap = overlapRatio(candidate, face);
      if (overlap > 0.08) { score -= 0.70 * overlap; blockedBy.add('face'); }
    }
    if (frame.subject) {
      const overlap = overlapRatio(candidate, frame.subject);
      if (overlap > 0.12) { score -= 0.48 * overlap; blockedBy.add('subject'); }
    }
    for (const occupied of frame.occupied) {
      const overlap = overlapRatio(candidate, occupied);
      if (overlap > 0.12) { score -= occupied.kind === 'screen' ? 0.52 * overlap : 0.40 * overlap; blockedBy.add(occupied.kind ?? 'occupied-region'); }
    }
    if (region === 'lower-left' || region === 'lower-right') { score -= 0.18; blockedBy.add('caption-safe-area'); }
    if (candidate.x < config.titleSafeMargin || candidate.y < config.titleSafeMargin || candidate.x + candidate.width > 1 - config.titleSafeMargin || candidate.y + candidate.height > 1 - config.titleSafeMargin) score -= 0.12;
    if (!fit.fits) { score -= 0.28; blockedBy.add('text-fit'); }
    total += Math.max(0, Math.min(1, score));
    availableArea += candidate.width * candidate.height * Math.max(0, Math.min(1, score));
    fit = fitText(text, candidate, config);
  }
  const score = frames.length ? total / frames.length : 0;
  return { region, score: Number(score.toFixed(4)), blockedBy: [...blockedBy], reason: blockedBy.size ? `Penalized by ${[...blockedBy].join(', ')}.` : 'Clear title-safe candidate with available visual area.', availableArea: Number(availableArea.toFixed(4)), fit };
}

export interface PlacementResult {
  decisions: PlacementDecision[];
  editPlan: EditPlan;
}

export function resolveBrollPlacement(beatId: string, requestedVisual: 'image-broll' | 'video-broll', frames: VisualFrameAnalysis[], config: PlacementConfig = defaultPlacementConfig): PlacementDecision {
  if (!frames.length) {
    return {
      beatId,
      requestedVisual,
      candidateRegions: [],
      decision: 'review',
      reason: 'B-roll placement requires visual frame evidence.',
      visualEvidence: [],
      textFit: { fontSize: config.maximumFontSize, maxLines: config.maxLines, lineCount: 1, fits: true },
    };
  }
  const candidates = (['left', 'right'] as SafeZoneRegion[])
    .map((region) => scoreCandidate(region, frames, undefined, config))
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (best && best.score >= config.minimumScore) {
    return {
      beatId,
      requestedVisual,
      candidateRegions: candidates,
      selectedRegion: best.region,
      decision: 'place',
      reason: `V3 visual evidence selected ${best.region} for split-screen B-roll: ${best.reason}`,
      visualEvidence: frames.map((frame) => frame.imagePath),
      textFit: best.fit,
    };
  }
  return {
    beatId,
    requestedVisual,
    candidateRegions: candidates,
    decision: 'full-screen',
    reason: 'V3 visual evidence found no safe split-screen region; full-screen B-roll is the resolved fallback.',
    visualEvidence: frames.map((frame) => frame.imagePath),
    textFit: best?.fit ?? { fontSize: config.maximumFontSize, maxLines: config.maxLines, lineCount: 1, fits: true },
  };
}

function operationFor(record: VisualPolicyResult['records'][number], placement: PlacementDecision): EditOperation[] {
  if (placement.decision === 'full-screen') return [{ id: `visual-${record.segment}`, type: 'full-screen-card', start: record.start, end: record.end, text: record.displayText ?? '', textTrust: record.displayTextTrust, style: `director-v3-${record.aiRecommendation}`, placement, reason: placement.reason, confidence: record.confidence }];
  if (placement.decision !== 'place' || !placement.selectedRegion) return [];
  return [{ id: `visual-${record.segment}`, type: 'sermon-point', start: record.start, end: record.end, text: record.displayText ?? '', textTrust: record.displayTextTrust, position: 'right', style: `director-v3-${record.aiRecommendation}`, graphicRegion: placement.selectedRegion, layout: { ...record.layout, graphicRegion: placement.selectedRegion, safeZoneProfile: `visual-intelligence-${placement.selectedRegion}` }, placement, reason: placement.reason, confidence: record.confidence }];
}

export function resolveVisualPlacements(policy: VisualPolicyResult, analysis: SermonAnalysis, frames: VisualFrameAnalysis[], config: PlacementConfig = defaultPlacementConfig): PlacementResult {
  const decisions: PlacementDecision[] = [];
  const operations: EditOperation[] = [];
  for (const record of policy.records) {
    const existingGraphic = ['scripture-card', 'keyword-graphic', 'title-card', 'motion-graphic'].includes(record.resolvedDecision);
    if (!existingGraphic || record.resolvedDecision === 'keep-current') continue;
    const matchingFrames = frames.filter((frame) => frame.beatId === record.segment);
    if (!matchingFrames.length) {
      decisions.push({
        beatId: record.segment,
        requestedVisual: record.aiRecommendation,
        candidateRegions: [],
        decision: 'review',
        reason: 'Visual placement requires frame evidence.',
        visualEvidence: [],
        textFit: { fontSize: config.minimumFontSize, maxLines: config.maxLines, lineCount: 0, fits: false },
      });
      continue;
    }
    const candidates = (Object.keys(candidateRects) as SafeZoneRegion[]).map((region) => scoreCandidate(region, matchingFrames, record.displayText, config)).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const important = record.section === 'main-point' || record.section === 'scripture-reading';
    const decision: PlacementDecision = best?.score >= config.minimumScore && best.fit.fits ? { beatId: record.segment, requestedVisual: record.aiRecommendation, candidateRegions: candidates, selectedRegion: best.region, decision: 'place', reason: `Visual evidence selected ${best.region}: ${best.reason}`, visualEvidence: matchingFrames.map((frame) => frame.imagePath), textFit: best.fit } : important ? { beatId: record.segment, requestedVisual: record.aiRecommendation, candidateRegions: candidates, decision: 'full-screen', reason: 'No safe region met the visual score and text-fit thresholds; major sermon content receives a full-screen fallback.', visualEvidence: matchingFrames.map((frame) => frame.imagePath), textFit: best?.fit ?? { fontSize: config.minimumFontSize, maxLines: config.maxLines, lineCount: 0, fits: false } } : { beatId: record.segment, requestedVisual: record.aiRecommendation, candidateRegions: candidates, decision: 'suppress', reason: 'No safe region met the visual score and text-fit thresholds; minor visual activity is suppressed.', visualEvidence: matchingFrames.map((frame) => frame.imagePath), textFit: best?.fit ?? { fontSize: config.minimumFontSize, maxLines: config.maxLines, lineCount: 0, fits: false } };
    decisions.push(decision);
    operations.push(...operationFor(record, decision));
  }
  const passthrough = policy.editPlan.operations.filter((operation) => operation.type !== 'sermon-point' || !decisions.some((decision) => operation.id === `policy-${decision.beatId}`));
  return { decisions, editPlan: { ...policy.editPlan, schemaVersion: '3.0', operations: [...passthrough, ...operations] } };
}

export function validatePlacements(result: PlacementResult, frames: VisualFrameAnalysis[], config: PlacementConfig = defaultPlacementConfig): string[] {
  const failures: string[] = [];
  for (const decision of result.decisions) {
    if (decision.decision === 'place') {
      const selected = decision.candidateRegions.find((candidate) => candidate.region === decision.selectedRegion);
      if (!selected || selected.score < config.minimumScore) failures.push(`${decision.beatId}: selected region below minimum score`);
      if (!decision.textFit.fits) failures.push(`${decision.beatId}: selected text does not fit`);
      if (selected?.blockedBy.includes('face')) failures.push(`${decision.beatId}: selected region overlaps a face`);
    }
    if (!decision.visualEvidence.length) failures.push(`${decision.beatId}: missing visual evidence references`);
  }
  return failures;
}
