import type { BrollDecision, BrollIntent, EditOperation, MediaIndex, PlacementDecision } from './contracts.ts';
import { rightsAllowsAutomation } from './media-library.ts';
import type { VisualPolicyResult } from './visual-policy.ts';

export const BROLL_PREVIEW_MAPPING_VERSION = 'source-preview-mapping-v1';

export interface PreviewWindow {
  sourceStart: number;
  sourceEnd: number;
}

export interface PreviewRangeMapping {
  sourceStart: number;
  sourceEnd: number;
  visibleSourceStart: number;
  visibleSourceEnd: number;
  previewStart: number;
  previewEnd: number;
}

export interface BrollRenderEvidence {
  renderedOperationIds: Set<string>;
  visibleOperationIds: Set<string>;
}

export function applyRetentionToBrollIntents(intents: BrollIntent[], policy: VisualPolicyResult): BrollIntent[] {
  return intents.map((intent) => {
    const record = policy.records.find((candidate) => candidate.sectionId === intent.sectionId);
    if (!record || (record.policyDecision !== 'SUPPRESS' && record.policyDecision !== 'REVIEW')) return intent;
    return {
      sectionId: intent.sectionId,
      start: intent.start,
      end: intent.end,
      decision: 'no-broll',
      reason: `Reverent Retention ${record.policyDecision.toLowerCase()}: ${record.reason}`,
    };
  });
}

export function mapSourceRangeToPreview(sourceStart: number, sourceEnd: number, preview: PreviewWindow): PreviewRangeMapping | undefined {
  if (sourceStart < 0 || sourceEnd <= sourceStart || preview.sourceStart < 0 || preview.sourceEnd <= preview.sourceStart) return undefined;
  const visibleSourceStart = Math.max(sourceStart, preview.sourceStart);
  const visibleSourceEnd = Math.min(sourceEnd, preview.sourceEnd);
  if (visibleSourceEnd <= visibleSourceStart) return undefined;
  return {
    sourceStart,
    sourceEnd,
    visibleSourceStart,
    visibleSourceEnd,
    previewStart: visibleSourceStart - preview.sourceStart,
    previewEnd: visibleSourceEnd - preview.sourceStart,
  };
}

function modeForPlacement(placement: PlacementDecision): Extract<EditOperation, { type: 'broll' }>['mode'] | undefined {
  if (placement.decision === 'full-screen') return 'full-screen';
  if (placement.decision !== 'place') return undefined;
  if (placement.selectedRegion === 'left') return 'split-left';
  if (placement.selectedRegion === 'right') return 'split-right';
  return undefined;
}

export function createPlacedBrollOperations(decisions: BrollDecision[], placements: PlacementDecision[], preview: PreviewWindow): EditOperation[] {
  return decisions.flatMap((decision): EditOperation[] => {
    if (decision.decision !== 'selected' || !decision.selectedAssetId) return [];
    const mapping = mapSourceRangeToPreview(decision.intent.start, decision.intent.end, preview);
    const placement = placements.find((candidate) => candidate.beatId === decision.intent.sectionId);
    const mode = placement && modeForPlacement(placement);
    if (!mapping || !placement || !mode) return [];
    return [{
      id: `broll-${decision.intent.sectionId}`,
      type: 'broll',
      sourceStart: mapping.sourceStart,
      sourceEnd: mapping.sourceEnd,
      start: mapping.previewStart,
      end: mapping.previewEnd,
      assetId: decision.selectedAssetId,
      mode,
      placement,
      muted: true,
      reason: `${decision.reason} ${placement.reason}`,
      confidence: decision.candidates.find((candidate) => candidate.assetId === decision.selectedAssetId)?.score ?? 0,
    }];
  });
}

export function validateBrollPreview(decisions: BrollDecision[], operations: EditOperation[], placements: PlacementDecision[], index: MediaIndex, preview: PreviewWindow, evidence: BrollRenderEvidence): string[] {
  const failures: string[] = [];
  const duration = preview.sourceEnd - preview.sourceStart;
  for (const decision of decisions.filter((item) => item.decision === 'selected')) {
    const operationId = `broll-${decision.intent.sectionId}`;
    const mapping = mapSourceRangeToPreview(decision.intent.start, decision.intent.end, preview);
    const placement = placements.find((candidate) => candidate.beatId === decision.intent.sectionId);
    const operation = operations.find((candidate) => candidate.id === operationId && candidate.type === 'broll');
    const asset = index.assets.find((candidate) => candidate.id === decision.selectedAssetId);
    if (!mapping) failures.push(`${operationId}: selected B-roll does not intersect the preview source range.`);
    if (!asset) failures.push(`${operationId}: selected asset is missing from the media index.`);
    if (asset && !asset.usable) failures.push(`${operationId}: selected asset is not technically usable.`);
    if (asset && !rightsAllowsAutomation(asset.rightsStatus)) failures.push(`${operationId}: selected asset rights no longer permit automation.`);
    if (!placement) failures.push(`${operationId}: selected B-roll has no V3 placement decision.`);
    if (placement?.decision === 'review' || placement?.decision === 'suppress') failures.push(`${operationId}: V3 placement did not authorize rendering.`);
    if (!operation) failures.push(`${operationId}: selected B-roll is not included in the render plan.`);
    if (operation?.type === 'broll') {
      if (operation.assetId !== decision.selectedAssetId) failures.push(`${operationId}: render plan asset does not match the selection decision.`);
      if (operation.end <= operation.start) failures.push(`${operationId}: mapped B-roll has no positive visible duration.`);
      if (operation.start < 0 || operation.end > duration) failures.push(`${operationId}: mapped B-roll falls outside the Remotion composition.`);
      if (operation.sourceStart !== decision.intent.start || operation.sourceEnd !== decision.intent.end) failures.push(`${operationId}: canonical source timing was not preserved.`);
      if (!evidence.renderedOperationIds.has(operationId)) failures.push(`${operationId}: render completion evidence is missing.`);
      if (!evidence.visibleOperationIds.has(operationId)) failures.push(`${operationId}: rendered-frame visibility evidence is missing.`);
    }
  }
  return failures;
}