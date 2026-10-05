import React, { useRef, useState } from 'react';
import type { ProductCapabilities, ProductProjectRecord } from '../product-api.ts';
import { productClient } from '../product-client.ts';
import { UploadIcon, YoutubeIcon, FilmIcon, ArrowRightIcon, FolderIcon } from './Icons.tsx';

export const NewProjectScreen: React.FC<{
  capabilities?: ProductCapabilities;
  onCreated: (project: ProductProjectRecord) => void;
}> = ({ capabilities, onCreated }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [type, setType] = useState<'local-video' | 'youtube-url'>('local-video');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState<'shorts' | 'long-form'>('shorts');
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const youtubeReady = capabilities?.youtube.state === 'AVAILABLE';
  const valid = title.trim() !== '' && (type === 'local-video' ? file !== undefined : url.trim() !== '');

  const create = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const source = type === 'local-video'
        ? { type, fileName: file!.name, sizeBytes: file!.size } as const
        : { type, url: url.trim(), ingestionAvailable: youtubeReady } as const;
      let project = await productClient.createProject({ title: title.trim(), source, outputTarget: target });
      if (file) project = await productClient.upload(project.workflow.projectId, file, setProgress);
      onCreated(project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <div className="view-content-wrapper" style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto', overflowY: 'auto', height: '100%' }}>
      <div className="view-header" style={{ marginBottom: '32px' }}>
        <div className="header-title-group">
          <h1>Create New Project</h1>
          <p>Import a video to begin analysis and editing</p>
        </div>
      </div>

      {error && <div className="ve-banner error" role="alert" style={{ marginBottom: '24px', padding: '12px 16px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#F87171', border: '1px solid rgba(239, 68, 68, 0.2)' }}>{error}</div>}

      <div className="form-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '12px', padding: '32px' }}>
        <div className="form-section">
          <div className="form-group" style={{ marginBottom: '24px' }}>
            <label className="form-label" style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500, color: '#E2E8F0' }}>Project Title</label>
            <input
              type="text"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sunday Service - John 3:16"
              disabled={busy}
              autoFocus
              style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'var(--bg-sidebar)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '32px' }}>
            <label className="form-label" style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500, color: '#E2E8F0' }}>Output Format</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <label style={{ 
                display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', borderRadius: '8px', cursor: 'pointer',
                border: `1px solid ${target === 'shorts' ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                background: target === 'shorts' ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-sidebar)',
                transition: 'all 0.2s ease'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="radio" name="target" checked={target === 'shorts'} onChange={() => setTarget('shorts')} disabled={busy} style={{ accentColor: 'var(--accent-primary)' }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Vertical AI Shorts (9:16)</span>
                </div>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', paddingLeft: '24px' }}>Automatically extracts 3 engaging clips formatted for TikTok, Reels, and YouTube Shorts.</span>
              </label>

              <label style={{ 
                display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', borderRadius: '8px', cursor: 'pointer',
                border: `1px solid ${target === 'long-form' ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                background: target === 'long-form' ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-sidebar)',
                transition: 'all 0.2s ease'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="radio" name="target" checked={target === 'long-form'} onChange={() => setTarget('long-form')} disabled={busy} style={{ accentColor: 'var(--accent-primary)' }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Long-form Edit (16:9)</span>
                </div>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', paddingLeft: '24px' }}>Advanced pipeline to produce a polished long-form multi-camera style video.</span>
              </label>
            </div>
          </div>
        </div>

        <div className="form-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 className="form-section-title" style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: '#FFFFFF' }}>Video Source</h3>
          </div>

          <div className="source-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '20px', background: 'var(--bg-sidebar)', padding: '6px', borderRadius: '8px', width: 'fit-content', border: '1px solid var(--border-default)' }}>
            <button
              type="button"
              className="source-tab-btn"
              onClick={() => setType('local-video')}
              disabled={busy}
              style={{
                padding: '8px 24px', display: 'flex', alignItems: 'center', gap: '8px', border: 'none',
                background: type === 'local-video' ? 'var(--bg-surface-elevated)' : 'transparent',
                borderRadius: '6px', cursor: 'pointer', color: type === 'local-video' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: type === 'local-video' ? 600 : 500, boxShadow: type === 'local-video' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none'
              }}
            >
              <UploadIcon size={16} />
              <span>Local Video</span>
            </button>
            <button
              type="button"
              className="source-tab-btn"
              onClick={() => setType('youtube-url')}
              disabled={busy}
              style={{
                padding: '8px 24px', display: 'flex', alignItems: 'center', gap: '8px', border: 'none',
                background: type === 'youtube-url' ? 'var(--bg-surface-elevated)' : 'transparent',
                borderRadius: '6px', cursor: 'pointer', color: type === 'youtube-url' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: type === 'youtube-url' ? 600 : 500, boxShadow: type === 'youtube-url' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none'
              }}
            >
              <YoutubeIcon size={16} />
              <span>YouTube URL</span>
            </button>
          </div>

          {type === 'local-video' ? (
            <div>
              {file ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'var(--bg-sidebar)', border: '1px solid var(--border-default)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
                      <FilmIcon size={22} />
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 500, color: '#E2E8F0', marginBottom: '4px', wordBreak: 'break-all' }}>{file.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{(file.size / (1024 * 1024)).toFixed(1)} MB</div>
                    </div>
                  </div>
                  <button type="button" onClick={() => setFile(undefined)} disabled={busy} style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer' }}>
                    Change
                  </button>
                </div>
              ) : (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed var(--border-default)', borderRadius: '12px', padding: '48px 20px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px',
                    cursor: 'pointer', background: 'var(--bg-sidebar)', transition: 'all 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                    e.currentTarget.style.background = 'rgba(99, 102, 241, 0.04)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                    e.currentTarget.style.background = 'var(--bg-sidebar)';
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
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', marginBottom: '8px' }}>
                    <UploadIcon size={32} />
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>Click to browse or drag video here</h3>
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>MP4, MOV, or M4V formats supported</p>
                </div>
              )}
              {progress > 0 && busy && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                    <span>Uploading...</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{Math.round(progress)}%</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'var(--bg-sidebar)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent-gradient)', transition: 'width 0.2s ease', boxShadow: '0 0 10px rgba(99, 102, 241, 0.5)' }} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="form-group">
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="url"
                  className="form-input"
                  style={{ flex: 1, padding: '14px 16px', fontSize: '14px', borderRadius: '8px', background: 'var(--bg-sidebar)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', outline: 'none' }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={busy || !youtubeReady}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-default)'}
                />
              </div>
              {!youtubeReady && (
                <div style={{ marginTop: '12px', padding: '12px 16px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', color: '#FBBF24', fontSize: '13px' }}>
                  YouTube capability is unavailable because yt-dlp is missing.
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '40px', paddingTop: '24px', borderTop: '1px solid var(--border-default)' }}>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void create()}
            style={{ 
              padding: '14px 28px', fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px', 
              opacity: (!valid || busy) ? 0.6 : 1, cursor: (!valid || busy) ? 'not-allowed' : 'pointer', 
              background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px',
              transition: 'all 0.2s ease', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
            }}
            onMouseOver={(e) => { if (valid && !busy) e.currentTarget.style.background = 'var(--accent-primary-hover)' }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'var(--accent-primary)' }}
          >
            {busy ? 'Creating Project...' : 'Create Project'}
            {!busy && <ArrowRightIcon size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
};
