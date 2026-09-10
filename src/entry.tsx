import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FoundationComposition, type FoundationProps } from './Root.tsx';
import { defaultVideoFormatProfile } from './video-format.ts';

export const RemotionRoot: React.FC = () => (
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
);

registerRoot(RemotionRoot);
