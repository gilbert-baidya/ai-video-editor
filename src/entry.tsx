import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FoundationComposition, type FoundationProps } from './Root.tsx';

export const RemotionRoot: React.FC = () => (
  <Composition<any, FoundationProps>
    id="BanglaFoundation"
    component={FoundationComposition}
    durationInFrames={120 * 30}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.durationSeconds ?? 120) * 30) })}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ sourcePath: '', editPlan: { schemaVersion: '1.0', projectId: 'foundation-sample', sourceTranscriptHash: '', operations: [], status: 'validated', createdBy: { provider: 'local', model: 'local' } }, graphicFontSize: 64 }}
  />
);

registerRoot(RemotionRoot);
