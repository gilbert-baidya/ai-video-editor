import React, { useState } from 'react';
import type { EditPlan, MediaAsset } from '../contracts.ts';
import type { ReviewBeat } from '../director-review.ts';
import type { ImportInput } from './useEditorSession.ts';
import { formatTimecode } from './editor-model.ts';

export interface LibraryProps {
  assets: MediaAsset[];
  plan?: EditPlan;
  beats: ReviewBeat[];
  statuses: Record<string, string>;
  selectedBeatId?: string;
  assetUrl: (assetId: string) => string;
  onSelectBeat: (beat: ReviewBeat) => void;
}

export function assetUsage(plan: EditPlan | undefined, assetId: string): Array<{ start: number; end: number }> {
  return (plan?.operations ?? []).flatMap((operation) => operation.type === 'broll' && operation.assetId === assetId ? [{ start: operation.start, end: operation.end }] : []);
}

export const AssetCard: React.FC<{ asset: MediaAsset; plan?: EditPlan; assetUrl: (id: string) => string }> = ({ asset, plan, assetUrl }) => {
  const usage = assetUsage(plan, asset.id);
  return <article className={`ve-asset ${asset.usable ? '' : 'invalid'}`} data-asset-id={asset.id}>
    <div className="ve-asset-thumb">{asset.kind === 'image' ? <img src={assetUrl(asset.id)} alt={asset.fileName} loading="lazy" /> : <video src={assetUrl(asset.id)} muted preload="metadata" />}</div>
    <b title={asset.fileName}>{asset.fileName}</b>
    <small>{asset.kind} · {asset.width}×{asset.height}{asset.durationSeconds ? ` · ${asset.durationSeconds.toFixed(1)} s` : ''}</small>
    <div className="ve-asset-flags">
      <span className={`ve-chip ${asset.rightsStatus === 'approved' ? 'status-accepted' : 'status-rejected'}`}>rights: {asset.rightsStatus}</span>
      <span className={`ve-chip ${asset.usable ? 'status-accepted' : 'status-rejected'}`}>{asset.usable ? 'valid file' : 'invalid file'}</span>
    </div>
    <small>{asset.rightsBasis}{asset.originalFileName ? ` · from ${asset.originalFileName}` : ''}</small>
    {!asset.usable && <small className="ve-warning">{asset.unusableReasons.join(' ')}</small>}
    <small>{usage.length ? `Used ${usage.map((window) => `${formatTimecode(window.start)}–${formatTimecode(window.end)}`).join(', ')}` : 'Not used in the plan'}</small>
  </article>;
};

export const LibraryPanel: React.FC<LibraryProps> = ({ assets, plan, beats, statuses, selectedBeatId, assetUrl, onSelectBeat }) => {
  const [tab, setTab] = useState<'scenes' | 'media'>('scenes');
  return <div className="ve-library">
    <div className="ve-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'scenes'} className={tab === 'scenes' ? 'active' : ''} onClick={() => setTab('scenes')}>Scenes</button>
      <button type="button" role="tab" aria-selected={tab === 'media'} className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>Media ({assets.length})</button>
    </div>
    {tab === 'scenes' && <ul className="ve-scenes">
      {beats.map((beat) => <li key={beat.section.id}><button type="button" className={beat.section.id === selectedBeatId ? 'selected' : ''} data-scene-id={beat.section.id} onClick={() => onSelectBeat(beat)}>
        <span className="ve-time">{formatTimecode(beat.section.start)} – {formatTimecode(beat.section.end)}</span>
        <b>{beat.section.type.replaceAll('-', ' ')}</b>
        <small>{beat.section.transcriptText.slice(0, 70)}{beat.section.transcriptText.length > 70 ? '…' : ''}</small>
        {statuses[beat.section.id] && <span className={`ve-chip status-${statuses[beat.section.id]}`}>{statuses[beat.section.id]}</span>}
      </button></li>)}
      {!beats.length && <li className="ve-note">No scenes yet.</li>}
    </ul>}
    {tab === 'media' && <div className="ve-assets">
      {assets.map((asset) => <AssetCard key={asset.id} asset={asset} plan={plan} assetUrl={assetUrl} />)}
      {!assets.length && <p className="ve-note">No media has been imported for this project. Use the Media Library to import an image from this Mac.</p>}
    </div>}
  </div>;
};

export const ImportAssetForm: React.FC<{ busy: boolean; onImport: (input: ImportInput) => Promise<void> }> = ({ busy, onImport }) => {
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');
  const [rightsStatus, setRightsStatus] = useState<ImportInput['rightsStatus']>('unknown');
  const [rightsBasis, setRightsBasis] = useState<ImportInput['rightsBasis']>('unknown');
  const [rightsNote, setRightsNote] = useState('');
  const valid = path.trim().startsWith('/') && description.trim().length > 0;
  return <form className="ve-import" onSubmit={(event) => { event.preventDefault(); void onImport({ path: path.trim(), description: description.trim(), rightsStatus, rightsBasis, rightsNote: rightsNote.trim() || undefined }); }}>
    <h4>Import image</h4>
    <p className="ve-note">The product host reads the file from this Mac. Format, size, dimensions and checksum are verified from the file itself; rights are never assumed.</p>
    <label>Absolute file path<input value={path} placeholder="/Users/you/Pictures/illustration.jpg" onChange={(event) => setPath(event.target.value)} /></label>
    <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="ve-form-row">
      <label>Rights status<select value={rightsStatus} onChange={(event) => setRightsStatus(event.target.value as ImportInput['rightsStatus'])}><option value="unknown">Unknown</option><option value="approved">Approved</option><option value="restricted">Restricted</option></select></label>
      <label>Rights basis<select value={rightsBasis} onChange={(event) => setRightsBasis(event.target.value as ImportInput['rightsBasis'])}>{['unknown', 'owned', 'permission', 'generated', 'public-domain', 'licensed'].map((basis) => <option key={basis} value={basis}>{basis}</option>)}</select></label>
    </div>
    <label>Rights evidence note<input value={rightsNote} placeholder="Required unless the basis is “owned”" onChange={(event) => setRightsNote(event.target.value)} /></label>
    <button type="submit" className="primary" disabled={!valid || busy}>{busy ? 'Importing…' : 'Import image'}</button>
  </form>;
};
