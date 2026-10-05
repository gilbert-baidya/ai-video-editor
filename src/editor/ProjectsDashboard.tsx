import React from 'react';
import type { ProductCapabilities, ProductProjectRecord } from '../product-api.ts';
import { formatTimecode, sourceDurationBlockers } from './editor-model.ts';
import { HomeIcon, PlusCircleIcon, FolderIcon, DownloadIcon, SettingsIcon, FilmIcon, YoutubeIcon, HardDriveIcon, ArrowRightIcon } from './Icons.tsx';

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

const getFriendlyStatus = (project: ProductProjectRecord) => {
  const blockers = sourceDurationBlockers(project);
  if (blockers.length > 0) return { label: 'Render Blocked', class: 'failed' };

  if (project.workflow.outputTarget === 'shorts') {
    const shorts = Object.values(project.workflow.shorts ?? {});
    if (shorts.length > 0) {
      if (shorts.every(s => s.renderStatus === 'completed')) return { label: 'Completed', class: 'completed' };
      if (shorts.some(s => s.renderStatus === 'running')) return { label: 'Export In Progress', class: 'ready-to-export' };
      return { label: 'Ready for Review', class: 'ready-to-export' };
    }
    if (project.workflow.stages.director.status === 'completed') return { label: 'Ready for Review', class: 'ready-to-export' };
    if (project.workflow.stages.director.status === 'running') return { label: 'Analyzing', class: 'analyzing' };
    if (project.workflow.stages.transcript.status === 'completed') return { label: 'Ready to Analyze', class: 'ready-to-analyze' };
    if (project.workflow.stages.transcript.status === 'running') return { label: 'Transcribing', class: 'analyzing' };
    if (project.workflow.stages.ingest.status === 'completed') return { label: 'Ready for Transcript', class: 'draft' };
    if (project.workflow.stages.ingest.status === 'running') return { label: 'Importing', class: 'analyzing' };
  } else {
    // Advanced Workflow
    if (project.workflow.stages.render.status === 'completed') return { label: 'Completed', class: 'completed' };
    if (project.workflow.stages.render.status === 'running') return { label: 'Export In Progress', class: 'ready-to-export' };
    if (project.workflow.stages.review.status === 'completed') return { label: 'Ready to Export', class: 'ready-to-export' };
    if (project.workflow.stages.director.status === 'completed') return { label: 'Review Complete', class: 'ready-to-export' };
  }

  return { label: 'New', class: 'draft' };
};

const formatRelativeTime = (isoString?: string) => {
  if (!isoString) return 'Recently';
  try {
    const date = new Date(isoString);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 2) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return 'Recently';
  }
};

export const ProjectsDashboard: React.FC<{
  projects: ProductProjectRecord[];
  capabilities?: ProductCapabilities;
  loading: boolean;
  error?: string;
  onOpen: (project: ProductProjectRecord) => void;
  onNew: () => void;
}> = ({ projects, capabilities, loading, error, onOpen, onNew }) => {
  return (
    <div className="view-content-wrapper">
      <div className="view-header">
        <div className="header-title-group">
          <h1>Sermon Projects</h1>
          <p>Saved local projects and sermon video workspaces</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary" onClick={onNew}>
            <PlusCircleIcon size={18} />
            <span>+ New Sermon Project</span>
          </button>
        </div>
      </div>
      
      {error && <div className="ve-banner error" role="alert">{error}</div>}
      
      <CapabilityStrip capabilities={capabilities} />

      {loading && <div className="ve-state" data-state="loading" role="status"><div className="ve-spinner" /><b>Loading projects…</b></div>}
      
      {!loading && !projects.length && !error && (
        <div className="ve-state" data-state="empty">
          <b>No projects yet</b>
          <p>Import a sermon video to begin. The original source is stored immutably and fingerprinted.</p>
          <button type="button" className="btn-primary" onClick={onNew}>Import a sermon</button>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="project-grid">
          {projects.map((item) => {
            const meta = item.sourceMetadata;
            const displayedDuration = item.sourceDurationValidation?.physicalDurationSeconds ?? meta?.durationSeconds;
            const status = getFriendlyStatus(item);
            
            // Re-use some hash from ID for stable random gradient
            const colorId = (item.workflow.projectId.charCodeAt(10) || 0) % 5;
            const gradients = [
              'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
              'linear-gradient(135deg, #1e3b2c 0%, #0f1a2a 100%)',
              'linear-gradient(135deg, #3b1e32 0%, #0f172a 100%)',
              'linear-gradient(135deg, #3b2c1e 0%, #0f172a 100%)',
              'linear-gradient(135deg, #1e283b 0%, #0f1b2a 100%)',
            ];

            return (
              <div
                key={item.workflow.projectId}
                className="project-card"
                onClick={() => onOpen(item)}
                style={{ cursor: 'pointer' }}
              >
                <div
                  className="project-thumbnail"
                  style={{ background: gradients[colorId] }}
                >
                  <div className="project-source-badge">
                    {item.workflow.source.type === 'youtube-url' ? (
                      <>
                        <YoutubeIcon size={13} />
                        <span>YouTube</span>
                      </>
                    ) : (
                      <>
                        <HardDriveIcon size={13} />
                        <span>Local Video</span>
                      </>
                    )}
                  </div>
                  {displayedDuration && (
                    <div className="project-duration-badge">
                      {formatTimecode(displayedDuration)}
                    </div>
                  )}
                </div>

                <div className="project-body">
                  <div className="project-header-row" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1, paddingRight: '8px' }}>
                      <h4 className="project-title">{item.workflow.title}</h4>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={`status-badge ${status.class}`} style={
                        status.class === 'analyzing' ? { background: 'rgba(99, 102, 241, 0.15)', color: '#A5B4FC' } : 
                        status.class === 'ready-to-analyze' ? { background: 'rgba(99, 102, 241, 0.12)', color: '#A5B4FC' } : {}
                      }>{status.label}</span>
                    </div>
                  </div>
                  
                  <div className="project-metadata">
                    {formatRelativeTime(item.workflow.updatedAt)}
                    {meta?.width && meta.height ? ` · ${meta.width}×${meta.height}` : ''}
                  </div>
                  
                  <div className="project-footer">
                    <div className="clips-count-indicator">
                      {item.workflow.outputTarget === 'shorts' ? (
                        <>
                          <FilmIcon size={14} />
                          <span>Shorts Workflow</span>
                        </>
                      ) : (
                        <>
                          <FilmIcon size={14} />
                          <span>Advanced Workflow</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
