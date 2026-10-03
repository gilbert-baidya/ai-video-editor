import React, { useState } from 'react';
import type { ProductCapabilities, ProductProjectRecord } from '../product-api.ts';
import { productClient } from '../product-client.ts';
import type { ProjectSource } from '../product-workflow.ts';

const message = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export const NewProjectScreen: React.FC<{ capabilities?: ProductCapabilities; onCreated: (project: ProductProjectRecord) => void }> = ({ capabilities, onCreated }) => {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ProjectSource['type']>('local-video');
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const youtubeReady = capabilities?.youtube.state === 'AVAILABLE';

  async function create(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const source: ProjectSource = type === 'local-video'
        ? { type, fileName: file!.name, sizeBytes: file!.size }
        : { type, url: url.trim(), ingestionAvailable: youtubeReady };
      let project = await productClient.createProject({ title, source });
      if (file) project = await productClient.upload(project.workflow.projectId, file, setProgress);
      onCreated(project);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  const valid = title.trim() && (type === 'local-video' ? Boolean(file) : Boolean(url.trim()));
  return <section className="ve-page narrow" data-screen="new">
    <header className="ve-page-head"><div><small>IMPORT / NEW PROJECT</small><h1>Start a sermon edit</h1></div></header>
    <p className="ve-note">The original source is streamed to an app-managed directory, fingerprinted, and kept immutable.</p>
    <div className="ve-card-panel ve-form">
      <label>Project title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="ve-choice">
        <button type="button" className={type === 'local-video' ? 'active' : ''} onClick={() => setType('local-video')}><b>Local video</b><span>Stream a sermon recording to this Mac</span></button>
        <button type="button" className={type === 'youtube-url' ? 'active' : ''} onClick={() => setType('youtube-url')}><b>YouTube URL</b><span>{capabilities?.youtube.detail ?? 'Checking capability…'}</span></button>
      </div>
      {type === 'local-video'
        ? <label>Choose sermon video<input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0])} /></label>
        : <label>YouTube URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>}
      {progress > 0 && <progress max={100} value={progress} aria-label="Upload progress" />}
      <button type="button" className="primary" disabled={!valid || busy} onClick={() => void create()}>{busy ? 'Creating…' : 'Create project'}</button>
      {error && <p className="ve-warning" role="alert">{error}</p>}
    </div>
  </section>;
};
