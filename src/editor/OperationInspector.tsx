import React, { useState } from 'react';
import type { EditOperation, MediaAsset } from '../contracts.ts';
import { buildBrollReplacementOperation, type ReviewAction, type ReviewBeat, type ReviewDecision } from '../director-review.ts';
import { describeOperation, formatTimecode, type TimelineClip } from './editor-model.ts';

export interface InspectorProps {
  clip?: TimelineClip;
  operation?: EditOperation;
  assets: MediaAsset[];
  beat?: ReviewBeat;
  decision?: ReviewDecision;
  assetUrl: (assetId: string) => string;
  saving: boolean;
  sourceDurationSeconds?: number;
  onPreview: () => void;
  onOpenReview: (beatId?: string) => void;
  onAct: (beatId: string, action: ReviewAction, options?: { operation?: EditOperation; reason?: string }) => void;
}

const BROLL_RECOMMENDATIONS = ['image-broll', 'video-broll', 'split-screen'];

export const OperationInspector: React.FC<InspectorProps> = ({ clip, operation, assets, beat, decision, assetUrl, saving, sourceDurationSeconds, onPreview, onOpenReview, onAct }) => {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  if (!clip) return <div className="ve-empty"><b>Nothing selected</b><span>Select an operation on the timeline, or a scene in the library, to inspect it.</span></div>;
  if (!operation) {
    return <div className="ve-inspector" data-inspector="source">
      <h3>{clip.label}</h3>
      <dl><dt>Track</dt><dd>{clip.kind === 'audio' || clip.kind === 'no-source' ? 'Audio / source' : 'Main video'}</dd><dt>Window</dt><dd>{formatTimecode(clip.start)} → {formatTimecode(clip.end)}</dd>{sourceDurationSeconds !== undefined && <><dt>Source duration</dt><dd>{sourceDurationSeconds.toFixed(2)} s</dd></>}</dl>
      <p className="ve-note">{clip.kind === 'no-source' ? 'The approved timeline extends past the available source media.' : 'Original sermon media is immutable and is never edited. Sermon audio plays continuously under B-roll.'}</p>
    </div>;
  }
  const details = describeOperation(operation, assets, beat);
  const isBroll = operation.type === 'broll' || operation.type === 'director-placeholder';
  const canReplace = beat !== undefined && (isBroll || BROLL_RECOMMENDATIONS.includes(beat.section.visualRecommendation ?? ''));
  const candidates = beat?.candidates.filter((candidate) => candidate.eligible && candidate.asset) ?? [];
  const act = (action: ReviewAction, options?: { operation?: EditOperation; reason?: string }) => { if (beat) onAct(beat.section.id, action, options); };

  const replace = (asset: MediaAsset) => {
    if (!beat) return;
    try {
      const next = buildBrollReplacementOperation(beat, asset, `Selected ${asset.fileName} in the editing workspace.`);
      setError('');
      setPicking(false);
      onAct(beat.section.id, 'replace-broll', { operation: next, reason: next.reason });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <div className="ve-inspector" data-inspector={operation.type} data-operation-id={operation.id}>
    <div className="ve-inspector-head"><h3>{details.title}</h3>{decision && <span className={`ve-chip status-${decision.status}`}>{decision.status}</span>}</div>
    {operation.type === 'broll' && assets.find((asset) => asset.id === operation.assetId) && <img className="ve-inspector-thumb" src={assetUrl(operation.assetId)} alt="Selected B-roll" />}
    {details.text && <blockquote className="ve-quote">{details.text}</blockquote>}
    {details.warnings.map((warning) => <p key={warning} className="ve-warning" role="alert">⚠ {warning}</p>)}
    <dl>{details.rows.map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>)}</dl>
    <div className="ve-actions">
      <button type="button" onClick={onPreview}>▶ Preview operation</button>
      {beat && <button type="button" onClick={() => onOpenReview(beat.section.id)}>Open in Review</button>}
    </div>
    {beat && decision
      ? <div className="ve-actions ve-review-actions" data-review-actions>
        {decision.status === 'pending' && <button type="button" className="primary" disabled={saving} onClick={() => act('accept')}>Approve</button>}
        {canReplace && <button type="button" disabled={saving} onClick={() => setPicking(!picking)}>Replace media</button>}
        <button type="button" disabled={saving} onClick={() => act('keep-pastor')}>Keep Pastor — static</button>
        {isBroll && <button type="button" disabled={saving} onClick={() => act('reject', { reason: 'Reviewer rejected the B-roll in the editing workspace.' })}>Reject B-roll</button>}
        {decision.status !== 'pending' && <button type="button" className="quiet" disabled={saving} onClick={() => act('revert')}>Revert to AI</button>}
      </div>
      : <p className="ve-note">This operation is not linked to a reviewable scene, so it is shown read-only.</p>}
    {picking && <div className="ve-picker">
      <small>REPLACE WITH INDEXED, RIGHTS-APPROVED MEDIA</small>
      {candidates.map((candidate) => <button type="button" key={candidate.assetId} onClick={() => candidate.asset && replace(candidate.asset)}><img src={assetUrl(candidate.assetId)} alt="" /><span><b>{candidate.asset?.fileName}</b><small>{candidate.asset?.width}×{candidate.asset?.height} · {candidate.asset?.kind}</small></span></button>)}
      {!candidates.length && <p className="ve-note">No eligible media is available for this scene. Import media in the Media Library first.</p>}
      {error && <p className="ve-warning" role="alert">{error}</p>}
    </div>}
  </div>;
};
