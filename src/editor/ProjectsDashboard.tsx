import React from 'react';
import type { ProductCapabilities, ProductProjectRecord } from '../product-api.ts';
import { productStages } from '../product-workflow.ts';
import { formatTimecode } from './editor-model.ts';

const tone = (state: string): string => state === 'AVAILABLE' ? 'on' : state === 'DEGRADED' ? 'warn' : 'off';

export const CapabilityStrip: React.FC<{ capabilities?: ProductCapabilities }> = ({ capabilities }) => {
  if (!capabilities) return <div className="ve-capabilities"><span className="ve-note">Checking local capabilities…</span></div>;
  const director = capabilities.director;
  const items: Array<[string, string, string]> = [
    ['AI Director', director.state, `${director.provider} · ${director.model}`],
    ['Transcription', capabilities.transcription.state, capabilities.transcription.detail],
    ['Renderer', capabilities.render.state, capabilities.render.detail],
    ['FFmpeg', capabilities.ffmpeg.state, capabilities.ffmpeg.detail],
    ['FFprobe', capabilities.ffprobe.state, capabilities.ffprobe.detail],
    ['YouTube import', capabilities.youtube.state, capabilities.youtube.detail],
  ];
  return <div className="ve-capabilities">{items.map(([label, state, detail]) => <div key={label} title={detail}><span className={`ve-dot ${tone(state)}`} /><b>{label}</b><small>{state.replaceAll('_', ' ').toLowerCase()}</small></div>)}</div>;
};

export const ProjectsDashboard: React.FC<{
  projects: ProductProjectRecord[];
  capabilities?: ProductCapabilities;
  loading: boolean;
  error?: string;
  onOpen: (project: ProductProjectRecord) => void;
  onNew: () => void;
}> = ({ projects, capabilities, loading, error, onOpen, onNew }) => <section className="ve-page" data-screen="projects">
  <header className="ve-page-head"><div><small>PROJECTS</small><h1>Sermon projects</h1></div><button type="button" className="primary" onClick={onNew}>New project</button></header>
  <CapabilityStrip capabilities={capabilities} />
  {error && <div className="ve-banner error" role="alert">{error}</div>}
  {loading && <div className="ve-state" data-state="loading" role="status"><div className="ve-spinner" /><b>Loading projects…</b></div>}
  {!loading && !projects.length && !error && <div className="ve-state" data-state="empty"><b>No projects yet</b><p>Import a sermon video to begin. The original source is stored immutably and fingerprinted.</p><button type="button" className="primary" onClick={onNew}>Import a sermon</button></div>}
  <div className="ve-project-grid">
    {projects.map((item) => {
      const meta = item.sourceMetadata;
      return <button type="button" key={item.workflow.projectId} className={`ve-project-card status-${item.workflow.status.toLowerCase()}`} data-project-id={item.workflow.projectId} onClick={() => onOpen(item)}>
        <div className="ve-project-top"><b>{item.workflow.title}</b><span className="ve-chip">{item.workflow.status.replaceAll('_', ' ')}</span></div>
        <div className="ve-stage-dots" aria-label="Workflow stages">{productStages.map((stage) => <span key={stage} className={`ve-stage-dot ${item.workflow.stages[stage].status}`} title={`${stage}: ${item.workflow.stages[stage].status}`} />)}</div>
        <small>{meta?.width && meta.height ? `${meta.width}×${meta.height} · ${meta.width < meta.height ? 'portrait' : 'landscape'}` : 'Source metadata pending'}{meta?.durationSeconds ? ` · ${formatTimecode(meta.durationSeconds)}` : ''}</small>
        <small>Updated {new Date(item.workflow.updatedAt).toLocaleString()}</small>
        {item.output && <small className={item.output.qaStatus === 'PASS' ? 'ok' : 'bad'}>Export QA: {item.output.qaStatus}</small>}
      </button>;
    })}
  </div>
</section>;
