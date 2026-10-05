import React, { useState, useRef } from 'react';
import type { ProductCapabilities, ProductProjectRecord } from '../product-api.ts';
import { productClient } from '../product-client.ts';
import type { ProjectSource } from '../product-workflow.ts';
import { UploadIcon, YoutubeIcon, FilmIcon, PlusCircleIcon, ArrowRightIcon } from './Icons.tsx';

const message = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export const NewProjectScreen: React.FC<{ capabilities?: ProductCapabilities; onCreated: (project: ProductProjectRecord) => void }> = ({ capabilities, onCreated }) => {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ProjectSource['type']>('local-video');
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [outputTarget, setOutputTarget] = useState<'long-form' | 'shorts'>('shorts');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const youtubeReady = capabilities?.youtube.state === 'AVAILABLE';

  async function create(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const source: ProjectSource = type === 'local-video'
        ? { type, fileName: file!.name, sizeBytes: file!.size }
        : { type, url: url.trim(), ingestionAvailable: youtubeReady };
      let project = await productClient.createProject({ title, source, outputTarget });
      if (file) project = await productClient.upload(project.workflow.projectId, file, setProgress);
      onCreated(project);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  const valid = title.trim() && (type === 'local-video' ? Boolean(file) : Boolean(url.trim()));

  return (
    <div className="view-container">
      <div className="view-header">
        <h1>New AI Video Project</h1>
        <p className="view-subtitle">Import a video source to generate optimized shorts.</p>
      </div>

      <div className="form-container" style={{ maxWidth: '800px' }}>
        {error && (
          <div className="ve-banner error" role="alert" style={{ marginBottom: '24px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#F87171', padding: '12px 16px', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        <div className="form-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 className="form-section-title">1. Project Details</h3>
          </div>
          
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label">Project Title</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. My Awesome Video"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Goal</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, padding: '12px', background: outputTarget === 'shorts' ? 'rgba(99, 102, 241, 0.1)' : 'transparent', border: `1px solid ${outputTarget === 'shorts' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, borderRadius: '8px' }}>
                <input type="radio" name="goal" value="shorts" checked={outputTarget === 'shorts'} onChange={() => setOutputTarget('shorts')} disabled={busy} />
                <span style={{ color: 'var(--text-primary)' }}>Extract Shorts (Multiple Clips)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, padding: '12px', background: outputTarget === 'long-form' ? 'rgba(99, 102, 241, 0.1)' : 'transparent', border: `1px solid ${outputTarget === 'long-form' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, borderRadius: '8px' }}>
                <input type="radio" name="goal" value="long-form" checked={outputTarget === 'long-form'} onChange={() => setOutputTarget('long-form')} disabled={busy} />
                <span style={{ color: 'var(--text-primary)' }}>Full Long-form Edit (Timeline)</span>
              </label>
            </div>
          </div>
        </div>

        <hr style={{ borderColor: 'var(--border-subtle)', margin: '24px 0' }} />

        <div className="form-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 className="form-section-title">2. Video Source</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Local file or YouTube</span>
          </div>

          <div className="source-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <button
              type="button"
              className={`source-tab-btn ${type === 'local-video' ? 'active' : ''}`}
              onClick={() => setType('local-video')}
              disabled={busy}
              style={{
                flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                background: type === 'local-video' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                border: `1px solid ${type === 'local-video' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                borderRadius: '8px', cursor: 'pointer', color: type === 'local-video' ? 'var(--text-primary)' : 'var(--text-muted)'
              }}
            >
              <UploadIcon size={16} />
              <span>Local Video</span>
            </button>
            <button
              type="button"
              className={`source-tab-btn ${type === 'youtube-url' ? 'active' : ''}`}
              onClick={() => setType('youtube-url')}
              disabled={busy}
              style={{
                flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                background: type === 'youtube-url' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                border: `1px solid ${type === 'youtube-url' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                borderRadius: '8px', cursor: 'pointer', color: type === 'youtube-url' ? 'var(--text-primary)' : 'var(--text-muted)'
              }}
            >
              <YoutubeIcon size={16} />
              <span>YouTube URL</span>
            </button>
          </div>

          {type === 'local-video' ? (
            <div>
              {file ? (
                <div className="file-selected-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
                      <FilmIcon size={22} />
                    </div>
                    <div>
                      <div style={{ fontSize: '13.5px', fontWeight: 500, color: '#E2E8F0', marginBottom: '2px', wordBreak: 'break-all' }}>{file.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{(file.size / (1024 * 1024)).toFixed(1)} MB</div>
                    </div>
                  </div>
                  <button type="button" className="btn-secondary" onClick={() => setFile(undefined)} disabled={busy} style={{ padding: '6px 12px', fontSize: '12px' }}>
                    Change
                  </button>
                </div>
              ) : (
                <div 
                  className="upload-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed var(--border-subtle)', borderRadius: '12px', padding: '40px 20px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px',
                    cursor: 'pointer', background: 'var(--bg-surface)', transition: 'all 0.2s ease'
                  }}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept="video/mp4,video/quicktime,video/x-m4v,video/*"
                    onChange={(e) => {
                      if (e.target.files?.[0]) setFile(e.target.files[0]);
                    }}
                  />
                  <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', marginBottom: '8px' }}>
                    <UploadIcon size={28} />
                  </div>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>Click to browse or drag video here</h3>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>MP4, MOV, or M4V formats supported</p>
                </div>
              )}
              {progress > 0 && busy && (
                <div style={{ marginTop: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '8px' }}>
                    <span>Uploading...</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg, #6366F1, #818CF8)', transition: 'width 0.2s ease' }} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">YouTube Video URL</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="url"
                  className="form-input"
                  style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={busy || !youtubeReady}
                />
              </div>
              {!youtubeReady && (
                <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', color: '#FBBF24', fontSize: '12.5px' }}>
                  YouTube capability is unavailable because yt-dlp is missing.
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
          <button
            type="button"
            className="btn-primary"
            disabled={!valid || busy}
            onClick={() => void create()}
            style={{ padding: '12px 24px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', opacity: (!valid || busy) ? 0.6 : 1, cursor: (!valid || busy) ? 'not-allowed' : 'pointer', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px' }}
          >
            {busy ? 'Creating Project...' : 'Create Project'}
            {!busy && <ArrowRightIcon size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
};
