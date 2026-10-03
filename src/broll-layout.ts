import type { EditOperation, MediaAsset, MediaAssetKind } from './contracts.ts';

export type BrollOperation = Extract<EditOperation, { type: 'broll' }>;
export type BrollLayout = 'FULL_FRAME_MEDIA' | 'SPLIT_SCREEN';

const TOLERANCE = 0.001;

export function isSplitMode(mode: BrollOperation['mode'] | undefined): mode is 'split-left' | 'split-right' {
  return mode === 'split-left' || mode === 'split-right';
}

// A B-roll operation is split-screen only when the split was explicitly approved: either the operation
// itself is a split-screen visual type or it carries a V3 placement decision for a side region.
export function brollLayout(operation: Pick<BrollOperation, 'mode' | 'visualType'>): BrollLayout {
  if (operation.visualType === 'image-broll' || operation.visualType === 'video-broll') return 'FULL_FRAME_MEDIA';
  if (operation.visualType === 'split-screen') return 'SPLIT_SCREEN';
  return isSplitMode(operation.mode) ? 'SPLIT_SCREEN' : 'FULL_FRAME_MEDIA';
}

export function expectedBrollKind(visualType: BrollOperation['visualType']): MediaAssetKind | undefined {
  if (visualType === 'image-broll') return 'image';
  if (visualType === 'video-broll') return 'video';
  return undefined;
}

// The Director shows long semantic sections as a focused beat rather than a section-wide takeover.
export function defaultBrollWindow(start: number, end: number): { start: number; end: number } {
  const sectionDuration = end - start;
  if (sectionDuration <= 10) return { start, end };
  const targetDuration = Math.max(4, Math.min(8, sectionDuration * 0.4));
  const windowStart = start + (sectionDuration - targetDuration) / 2;
  return { start: windowStart, end: windowStart + targetDuration };
}

export interface BrollValidationContext {
  durationSeconds?: number;
  section?: { start: number; end: number };
}

export function validateBrollOperation(operation: BrollOperation, asset: MediaAsset | undefined, context: BrollValidationContext = {}): string[] {
  const failures: string[] = [];
  const id = operation.id;
  const isSplit = isSplitMode(operation.mode);
  if (operation.mode !== 'full-screen' && !isSplit) failures.push(`B-roll timing: ${id} has an unknown layout mode "${String(operation.mode)}".`);
  if ((operation.visualType === 'image-broll' || operation.visualType === 'video-broll') && isSplit) {
    failures.push(`Layout violation: ${operation.visualType} must be FULL_FRAME_MEDIA, but was rendered as ${operation.mode}.`);
  }
  if (operation.visualType === 'split-screen' && !isSplit) {
    failures.push(`Layout violation: split-screen must be SPLIT_SCREEN layout, but was rendered as ${operation.mode}.`);
  }
  if (isSplit && operation.visualType === undefined && !operation.placement) {
    failures.push(`Layout violation: ${id} uses ${operation.mode} without an explicit split-screen approval.`);
  }
  if (operation.visualType !== undefined && !['image-broll', 'video-broll', 'split-screen'].includes(operation.visualType)) {
    failures.push(`B-roll compatibility: ${id} has non-B-roll visual type ${operation.visualType}.`);
  }
  if (operation.muted !== true) failures.push(`B-roll audio: ${id} must mute B-roll source audio so the original sermon audio stays continuous.`);
  if (!Number.isFinite(operation.start) || !Number.isFinite(operation.end) || operation.start < 0 || operation.end <= operation.start) {
    failures.push(`B-roll timing: ${id} has an invalid window ${operation.start}–${operation.end}.`);
  } else {
    if (context.durationSeconds !== undefined && operation.end > context.durationSeconds + TOLERANCE) failures.push(`B-roll timing: ${id} ends after the ${context.durationSeconds.toFixed(2)}-second timeline.`);
    if (context.section && (operation.start < context.section.start - TOLERANCE || operation.end > context.section.end + TOLERANCE)) {
      failures.push(`B-roll timing: ${id} window ${operation.start.toFixed(2)}–${operation.end.toFixed(2)} falls outside its semantic section ${context.section.start.toFixed(2)}–${context.section.end.toFixed(2)}.`);
    }
  }
  if (asset) {
    const expected = expectedBrollKind(operation.visualType);
    if (expected && asset.kind !== expected) failures.push(`B-roll compatibility: ${id} is ${operation.visualType} but asset ${asset.id} is a ${asset.kind}.`);
  }
  return failures;
}

export function findOverlappingBroll(operations: EditOperation[]): Array<[string, string]> {
  const broll = operations.filter((operation): operation is BrollOperation => operation.type === 'broll');
  const pairs: Array<[string, string]> = [];
  for (let left = 0; left < broll.length; left += 1) {
    for (let right = left + 1; right < broll.length; right += 1) {
      if (broll[left].start < broll[right].end && broll[right].start < broll[left].end) pairs.push([broll[left].id, broll[right].id]);
    }
  }
  return pairs;
}

export interface FrameVisuals {
  pastorVisible: boolean;
  broll?: {
    operation: BrollOperation;
    asset: MediaAsset;
    layout: BrollLayout;
    side: 'left' | 'right';
    // Composition time at which the B-roll clip's own timeline begins.
    startSeconds: number;
  };
}

// The Pastor <Video> stays mounted even when hidden so the original sermon audio never pauses.
export function resolveFrameVisuals(operations: EditOperation[], seconds: number, assets: MediaAsset[]): FrameVisuals {
  const operation = operations.find((candidate): candidate is BrollOperation => candidate.type === 'broll' && seconds >= candidate.start && seconds < candidate.end);
  const asset = operation ? assets.find((candidate) => candidate.id === operation.assetId) : undefined;
  if (!operation || !asset) return { pastorVisible: true };
  const layout = brollLayout(operation);
  return {
    pastorVisible: layout !== 'FULL_FRAME_MEDIA',
    broll: { operation, asset, layout, side: operation.mode === 'split-left' ? 'left' : 'right', startSeconds: operation.start },
  };
}
