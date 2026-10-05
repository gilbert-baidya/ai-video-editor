import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FoundationComposition, ShortComposition, type FoundationProps, type ShortProps } from './Root.tsx';
import { defaultVideoFormatProfile } from './video-format.ts';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition<any, FoundationProps>
      id="BanglaFoundation"
      component={FoundationComposition}
      durationInFrames={120 * 30}
      calculateMetadata={({ props }) => {
        const format = props.videoFormat ?? defaultVideoFormatProfile();
        return { durationInFrames: Math.ceil((props.durationSeconds ?? 120) * 30), width: format.width, height: format.height };
      }}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ sourcePath: '', editPlan: { schemaVersion: '1.0', projectId: 'foundation-sample', sourceTranscriptHash: '', operations: [], status: 'validated', createdBy: { provider: 'local', model: 'local' } }, graphicFontSize: 64, videoFormat: defaultVideoFormatProfile() }}
    />
    <Composition<any, ShortProps>
      id="BanglaShort"
      component={ShortComposition}
      durationInFrames={60 * 30}
      calculateMetadata={({ props }) => {
        return { durationInFrames: Math.max(1, Math.ceil((props.sourceEndSeconds - props.sourceStartSeconds) * 30)), width: 1080, height: 1920 };
      }}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ sourcePath: '', editPlan: { schemaVersion: '1.0', projectId: 'short-sample', sourceTranscriptHash: '', operations: [], status: 'validated', createdBy: { provider: 'local', model: 'local' } }, graphicFontSize: 64, videoFormat: defaultVideoFormatProfile(), sourceStartSeconds: 0, sourceEndSeconds: 60 }}
    />
  </>
);

registerRoot(RemotionRoot);
