import React from 'react';
import { AbsoluteFill, Img, Video, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { EditPlan, GraphicRegion, MediaAsset, SpeakerPosition } from './contracts.ts';
import { resolvedOperationFontSize } from './render-presentation.ts';

export interface FoundationProps extends Record<string, unknown> {
  sourcePath: string;
  editPlan: EditPlan;
  graphicFontSize: number;
  mediaAssets?: MediaAsset[];
}

function positionStyle(position: SpeakerPosition | 'center'): React.CSSProperties {
  if (position === 'left') return { transform: 'translateX(-7%) scale(1.08)' };
  if (position === 'right') return { transform: 'translateX(7%) scale(1.08)' };
  if (position === 'punch-in') return { transform: 'scale(1.12)' };
  return { transform: 'scale(1.06)' };
}

function regionStyle(region: GraphicRegion | undefined): React.CSSProperties {
  if (region === 'left') return { left: 90, right: 'auto', textAlign: 'left' };
  if (region === 'upper-left') return { left: 90, right: 'auto', top: 170, textAlign: 'left' };
  if (region === 'lower-left') return { left: 90, right: 'auto', bottom: 180, textAlign: 'left' };
  if (region === 'center') return { left: 260, right: 260, top: 360, textAlign: 'center' };
  if (region === 'lower-right') return { left: 'auto', right: 90, bottom: 180, textAlign: 'right' };
  return { left: 'auto', right: 90, top: 170, textAlign: 'right' };
}

function graphicLabel(style: string): string {
  if (style.includes('scripture')) return 'SCRIPTURE REFERENCE';
  if (style.includes('keyword')) return 'KEYWORD';
  if (style.includes('motion')) return 'APPLICATION';
  return 'SERMON POINT';
}

function mediaSource(asset: MediaAsset): string {
  return asset.path.startsWith('public/') ? staticFile(asset.path.slice('public/'.length)) : asset.path;
}

export const FoundationComposition: React.FC<FoundationProps> = ({ sourcePath, editPlan, graphicFontSize, mediaAssets = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const speaker = editPlan.operations.find((operation) => operation.type === 'speaker-position' && seconds >= operation.start && seconds < operation.end);
  const graphic = editPlan.operations.find((operation) => operation.type === 'sermon-point' && seconds >= operation.start && seconds < operation.end);
  const fullScreen = editPlan.operations.find((operation) => operation.type === 'full-screen-card' && seconds >= operation.start && seconds < operation.end);
  const broll = editPlan.operations.find((operation) => operation.type === 'broll' && seconds >= operation.start && seconds < operation.end);
  const caption = editPlan.operations.find((operation) => operation.type === 'caption' && seconds >= operation.start && seconds < operation.end);
  const speakerPosition = speaker?.type === 'speaker-position' ? speaker.position : 'center';
  const graphicRegion = graphic?.type === 'sermon-point' ? graphic.graphicRegion : undefined;
  const layout = graphic?.type === 'sermon-point' ? graphic.layout : undefined;
  const resolvedGraphicFontSize = resolvedOperationFontSize(graphic?.type === 'sermon-point' ? graphic : undefined, graphicFontSize);
  const resolvedFullScreenFontSize = resolvedOperationFontSize(fullScreen?.type === 'full-screen-card' ? fullScreen : undefined, 86);
  const brollAsset = broll?.type === 'broll' ? mediaAssets.find((asset) => asset.id === broll.assetId) : undefined;
  return (
    <AbsoluteFill style={{ backgroundColor: '#101820', fontFamily: 'Noto Sans Bengali, sans-serif' }}>
      <Video src={staticFile(sourcePath)} style={{ width: '100%', height: '100%', objectFit: 'cover', ...positionStyle(speakerPosition) }} />
      {broll?.type === 'broll' && brollAsset && broll.mode === 'full-screen' && brollAsset.kind === 'video' && <Video src={mediaSource(brollAsset)} volume={0} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      {broll?.type === 'broll' && brollAsset && broll.mode === 'full-screen' && brollAsset.kind === 'image' && <Img src={mediaSource(brollAsset)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      {broll?.type === 'broll' && brollAsset && broll.mode !== 'full-screen' && <div style={{ position: 'absolute', top: 0, bottom: 0, width: '50%', overflow: 'hidden', ...(broll.mode === 'split-left' ? { left: 0 } : { right: 0 }) }}>{brollAsset.kind === 'video' ? <Video src={mediaSource(brollAsset)} volume={0} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Img src={mediaSource(brollAsset)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>}
      {fullScreen?.type === 'full-screen-card' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 120, color: '#fff', fontSize: resolvedFullScreenFontSize, fontWeight: 700, lineHeight: 1.25, textAlign: 'center', backgroundColor: 'rgba(10, 20, 25, 0.9)' }}>{fullScreen.text}</div>}
      {graphic?.type === 'sermon-point' && <div style={{ position: 'absolute', maxWidth: 650, padding: '18px 24px', borderLeft: '4px solid #d4a84f', color: '#fff', fontSize: resolvedGraphicFontSize, fontWeight: 700, lineHeight: 1.35, textShadow: '0 3px 12px #000', backgroundColor: 'rgba(10, 20, 25, 0.62)', ...regionStyle(graphicRegion ?? layout?.graphicRegion) }}><div style={{ color: '#d4a84f', fontSize: Math.max(18, resolvedGraphicFontSize * 0.32), letterSpacing: 1, marginBottom: 8 }}>{graphicLabel(graphic.style)}</div>{graphic.text}</div>}
      {caption?.type === 'caption' && <div style={{ position: 'absolute', left: 100, right: 100, bottom: 100, color: '#fff', fontSize: 44, textAlign: 'center', textShadow: '0 3px 10px #000' }}>{caption.text}</div>}
    </AbsoluteFill>
  );
};
