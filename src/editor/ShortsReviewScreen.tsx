import React, { useEffect, useRef } from 'react';
import { productClient } from '../product-client.ts';
import type { ExtractedShort } from '../features/shorts/shorts-model.ts';
import type { ShortWorkflowState } from '../product-workflow.ts';
import type { EditorSession } from './useEditorSession.ts';
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
          return <article key={short.id} data-short-id={short.id} data-approval-status={state?.approvalStatus ?? 'pending'} data-render-status={state?.renderStatus ?? 'not-started'} style={{ background: 'var(--bg-surface-elevated)', border: `1px solid ${approved ? 'rgba(52,211,153,.45)' : 'var(--border-subtle)'}`, borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {exported ? <ShortPreview src={outputUrl} short={short} rendered /> : sourcePreviewAvailable ? <ShortPreview src={productClient.sourceUrl(projectId)} short={short} /> : <div style={{ aspectRatio: '9 / 16', display: 'grid', placeItems: 'center', background: '#050708', color: '#94A3B8' }}>Preview timestamps unavailable</div>}
            <div style={{ padding: 16, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div><small style={{ color: 'var(--text-muted)' }}>SHORT {index + 1}</small><h3 style={{ margin: '4px 0', fontSize: 16 }}>{short.title}</h3></div>
                <span data-short-status style={{ color: status.color, fontSize: 12, fontWeight: 700 }}>{status.label}</span>
              </div>
              <p style={{ margin: '8px 0', fontSize: 13, color: 'var(--text-muted)' }}>{short.subtitle}</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}><strong style={{ color: 'var(--text-primary)' }}>Why it works:</strong> {short.hookExplanation}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                <span><FilmIcon size={13} /> {short.durationEstimateSeconds.toFixed(1)}s</span>
                <span style={{ color: '#34D399' }}><SparklesIcon size={12} /> {short.viralScore}/10</span>
              </div>
              {state?.error && <p role="alert" style={{ color: '#F87171', fontSize: 12 }}>{state.error}</p>}
              {state?.output && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{state.output.width}×{state.output.height} · {state.output.durationSeconds.toFixed(2)}s · QA {state.output.qaStatus}</p>}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!exported && <button type="button" data-action="approve-short" onClick={() => void session.reviewShort(short.id, true)} disabled={session.busy || approved} className="btn-secondary" style={{ flex: 1 }}>{approved ? 'Approved' : <><CheckCircleIcon size={14} /> Approve</>}</button>}
              {!exported && <button type="button" data-action="reject-short" onClick={() => void session.reviewShort(short.id, false)} disabled={session.busy || state?.renderStatus === 'running'} className="btn-secondary">Reject</button>}
              {!exported && <button type="button" data-action="export-short" onClick={() => void session.runStage('render', { shortId: short.id })} disabled={session.busy || !approved || state?.renderStatus === 'running'} className="btn-primary" style={{ flex: 1 }}>{state?.renderStatus === 'running' ? 'Rendering…' : 'Export Short'}</button>}
              {exported && <a data-action="download-short" href={outputUrl} download={state.output?.fileName} className="btn-primary" style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}><DownloadIcon size={14} /> Download MP4</a>}
            </div>
          </article>;
        })}
      </div>}
  </section>;
};
