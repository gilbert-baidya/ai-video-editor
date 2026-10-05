import React, { useEffect, useRef } from 'react';
import { productClient } from '../product-client.ts';
import type { ExtractedShort } from '../features/shorts/shorts-model.ts';
import type { ShortWorkflowState } from '../product-workflow.ts';
import type { EditorSession } from './useEditorSession.ts';
import { formatTimecode } from './editor-model.ts';
import { CheckCircleIcon, DownloadIcon, FilmIcon, SparklesIcon } from './Icons.tsx';

function ShortPreview({ src, short, rendered = false }: { src: string; short: ExtractedShort; rendered?: boolean }): React.ReactElement {
  const video = useRef<HTMLVideoElement>(null);
  const start = rendered ? 0 : short.sourceStartSeconds;
  const end = rendered ? Number.POSITIVE_INFINITY : short.sourceEndSeconds;

  useEffect(() => {
    const element = video.current;
    if (!element || !Number.isFinite(start)) return;
    const seek = () => { element.currentTime = start; };
    if (element.readyState >= 1) seek();
    else element.addEventListener('loadedmetadata', seek, { once: true });
    return () => element.removeEventListener('loadedmetadata', seek);
  }, [src, start]);

  return <video
    ref={video}
    controls
    preload="metadata"
    src={src}
    aria-label={rendered ? `Exported Short: ${short.title}` : `Source preview: ${short.title}`}
    onPlay={(event) => {
      if (!rendered && (event.currentTarget.currentTime < start || event.currentTarget.currentTime >= end)) event.currentTarget.currentTime = start;
    }}
    onTimeUpdate={(event) => {
      if (!rendered && event.currentTarget.currentTime >= end) {
        event.currentTarget.pause();
        event.currentTarget.currentTime = start;
      }
    }}
    style={{ width: '100%', aspectRatio: '9 / 16', maxHeight: 430, background: '#050708', objectFit: 'contain' }}
  />;
}

function statusLabel(state: ShortWorkflowState | undefined): { label: string; color: string } {
  if (!state) return { label: 'Recommended', color: '#94A3B8' };
  if (state.renderStatus === 'running') return { label: 'Rendering', color: '#FBBF24' };
  if (state.renderStatus === 'failed') return { label: 'Export failed', color: '#F87171' };
  if (state.renderStatus === 'completed' && state.output?.qaStatus === 'PASS') return { label: 'Export ready', color: '#34D399' };
  if (state.approvalStatus === 'approved') return { label: 'Approved', color: '#34D399' };
  if (state.approvalStatus === 'rejected') return { label: 'Rejected', color: '#F87171' };
  return { label: 'Awaiting approval', color: '#94A3B8' };
}

export const ShortsReviewScreen: React.FC<{
  session: EditorSession;
  onOpenAdvancedEditor: () => void;
}> = ({ session, onOpenAdvancedEditor }) => {
  const { workspace, project } = session;
  const shorts = workspace?.shorts ?? [];

  if (!workspace || !project) return <div className="ve-page"><p>Loading Shorts…</p></div>;
  const projectId = project.workflow.projectId;

  return <section className="ve-page" data-screen="shorts-review" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
    <header className="ve-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div><small>REVIEW &amp; APPROVE</small><h1>Recommended Shorts</h1><p className="ve-note">Preview the exact source range, approve it, then export. Each Short is tracked and downloaded independently.</p></div>
      <button className="btn-secondary" onClick={onOpenAdvancedEditor} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 6 }}><FilmIcon size={16} />Advanced Timeline Editor</button>
    </header>
    {session.actionError && <div className="ve-banner error" role="alert">{session.actionError}<button type="button" onClick={session.clearError}>Dismiss</button></div>}

    {shorts.length === 0 ? <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>No validated Short recommendations are available.</div> :
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 24 }}>
        {shorts.map((short, index) => {
          const state = project.workflow.shorts?.[short.id];
          const status = statusLabel(state);
          const approved = state?.approvalStatus === 'approved';
          const exported = state?.renderStatus === 'completed' && state.output?.qaStatus === 'PASS';
          const sourcePreviewAvailable = Number.isFinite(short.sourceStartSeconds) && Number.isFinite(short.sourceEndSeconds) && short.sourceEndSeconds > short.sourceStartSeconds;
          const outputUrl = productClient.shortOutputUrl(projectId, short.id);
          return <article key={short.id} data-short-id={short.id} data-approval-status={state?.approvalStatus ?? 'pending'} data-render-status={state?.renderStatus ?? 'not-started'} className="clip-review-card" style={{ flexDirection: 'column', gap: 0, padding: 0, border: `1px solid ${approved ? 'var(--border-accent)' : 'var(--border-subtle)'}`, boxShadow: approved ? '0 0 16px rgba(99, 102, 241, 0.2)' : 'none' }}>
            <div style={{ position: 'relative', width: '100%', background: '#000', borderBottom: '1px solid var(--border-default)' }}>
              {exported ? <ShortPreview src={outputUrl} short={short} rendered /> : sourcePreviewAvailable ? <ShortPreview src={productClient.sourceUrl(projectId)} short={short} /> : <div style={{ aspectRatio: '9 / 16', display: 'grid', placeItems: 'center', background: '#050708', color: '#94A3B8' }}>Preview timestamps unavailable</div>}
              
              <div style={{ position: 'absolute', top: 12, right: 12 }}>
                 <span className="clip-score-badge"><SparklesIcon size={12} /> Viral Score: {short.viralScore}/10</span>
              </div>
            </div>
            
            <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>{short.title}</h3>
                <span data-short-status className={`status-badge ${approved ? 'completed' : state?.renderStatus === 'running' ? 'analyzing' : state?.approvalStatus === 'rejected' ? 'failed' : 'draft'}`} style={{ fontSize: '12px' }}>{status.label}</span>
              </div>
              <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-secondary)' }}>{short.subtitle}</p>
              
              <div style={{ background: 'var(--bg-sidebar)', borderRadius: '8px', padding: '14px', marginBottom: '20px', border: '1px solid var(--border-default)' }}>
                <h4 style={{ margin: '0 0 6px', fontSize: '13px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}><SparklesIcon size={14} style={{ color: "var(--accent-primary)" }} /> Why this hook works</h4>
                <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{short.hookExplanation}</p>
              </div>
              
              <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
                <span className="tag-pill"><FilmIcon size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} /> {short.durationEstimateSeconds.toFixed(1)}s duration</span>
                <span className="tag-pill">Source: {formatTimecode(short.sourceStartSeconds)} - {formatTimecode(short.sourceEndSeconds)}</span>
              </div>
              
              {state?.error && <div style={{ background: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5', fontSize: '13px', marginBottom: '16px' }}>{state.error}</div>}
              {state?.output && <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '16px' }}>Output: {state.output.width}×{state.output.height} · QA: {state.output.qaStatus}</div>}
              
              <div style={{ marginTop: 'auto', display: 'flex', gap: '10px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                {!exported && (
                  <>
                    <button type="button" data-action="approve-short" onClick={() => void session.reviewShort(short.id, true)} disabled={session.busy || approved} className={approved ? "btn-secondary" : "btn-primary"} style={{ flex: 1, padding: '10px', display: 'flex', justifyContent: 'center' }}>
                      {approved ? 'Approved' : <><CheckCircleIcon size={16} style={{ marginRight: '6px' }} /> Approve</>}
                    </button>
                    <button type="button" data-action="reject-short" onClick={() => void session.reviewShort(short.id, false)} disabled={session.busy || state?.renderStatus === 'running' || approved} className="btn-secondary" style={{ padding: '10px 16px' }}>Reject</button>
                  </>
                )}
                {!exported && approved && (
                  <button type="button" data-action="export-short" onClick={() => void session.runStage('render', { shortId: short.id })} disabled={session.busy || state?.renderStatus === 'running'} className="btn-primary" style={{ flex: 1, padding: '10px' }}>
                    {state?.renderStatus === 'running' ? 'Rendering…' : 'Export Short'}
                  </button>
                )}
                {exported && <a data-action="download-short" href={outputUrl} download={state.output?.fileName} className="btn-primary" style={{ flex: 1, textAlign: 'center', textDecoration: 'none', padding: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}><DownloadIcon size={16} /> Download MP4</a>}
              </div>
            </div>
          </article>;
        })}
      </div>}
  </section>;
};
