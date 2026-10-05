import React, { useEffect, useRef, useState } from 'react';
import { operationBeatId } from '../director-review.ts';
import { productClient } from '../product-client.ts';
import { DirectorPanel } from './DirectorPanel.tsx';
import { LibraryPanel } from './LibraryPanel.tsx';
import { OperationInspector } from './OperationInspector.tsx';
import { PreviewPlayer } from './PreviewPlayer.tsx';
import { Splitter } from './Splitter.tsx';
import { Timeline } from './Timeline.tsx';
import { useLayoutPrefs } from './useLayoutPrefs.ts';
import { LAYOUT_LIMITS, LIBRARY_MIN_VIEWPORT, STACKED_VIEWPORT, beatForOperation, buildPipeline, buildTimeline, clampTime, computeBrollStatus, findClip, operationById, previewFrameAt, reconcileTimeline, sourceDurationBlockers, type LayoutPrefs, type TimelineClip, type Viewport } from './editor-model.ts';
import type { EditorSession } from './useEditorSession.ts';
import { loadWaveform } from './waveform.ts';

export type RightTab = 'director' | 'inspect';

export interface WorkspaceHandlers {
  onSeek: (seconds: number) => void;
  onTick: (seconds: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSelectClip: (clip: TimelineClip) => void;
  onSelectBeat: (beatId: string) => void;
  onZoom: (pixelsPerSecond: number | undefined) => void;
  onTab: (tab: RightTab) => void;
  onPreviewOperation: () => void;
  onOpenReview: (beatId?: string) => void;
  onGoExport: () => void;
  onGoDirector: () => void;
  onSourceDuration: (seconds: number) => void;
}

export interface WorkspaceViewProps {
  session: EditorSession;
  time: number;
  seekToken: number;
  playing: boolean;
  selectedClipId?: string;
  pixelsPerSecond?: number;
  rightTab: RightTab;
  layout: LayoutPrefs;
  viewport: Viewport;
  onLayout: (patch: Partial<LayoutPrefs>) => void;
  onLayoutReset: (key: keyof LayoutPrefs) => void;
  measuredSourceSeconds?: number;
  peaks?: number[];
  waveformNote?: string;
  handlers: WorkspaceHandlers;
}

const noop = () => undefined;
export const noHandlers: WorkspaceHandlers = { onSeek: noop, onTick: noop, onPlayingChange: noop, onSelectClip: noop, onSelectBeat: noop, onZoom: noop, onTab: noop, onPreviewOperation: noop, onOpenReview: noop, onGoExport: noop, onGoDirector: noop, onSourceDuration: noop };

export const EditingWorkspaceView: React.FC<WorkspaceViewProps> = ({ session, time, seekToken, playing, selectedClipId, pixelsPerSecond, rightTab, layout, viewport, onLayout, onLayoutReset, measuredSourceSeconds, peaks, waveformNote, handlers }) => {
  const { project, workspace, review, resolved, phase } = session;
  if (phase === 'loading') return <div className="ve-state" data-state="loading" role="status"><div className="ve-spinner" /><b>Loading project…</b></div>;
  if (phase === 'error') return <div className="ve-state error" data-state="error" role="alert"><b>The project could not be opened</b><p>{session.message}</p><button type="button" onClick={() => void session.reload()}>Try again</button></div>;
  if (phase === 'no-plan' || !project || !workspace || !review || !resolved) {
    return <div className="ve-state" data-state="no-plan"><b>{project?.workflow.title ?? 'Project'} has no editable plan yet</b><p>{session.message}</p><button type="button" className="primary" onClick={handlers.onGoDirector}>Open AI Director</button></div>;
  }

  const plan = resolved.approvedPlan;
  const assets = workspace.mediaIndex.assets;
  const recordedSourceDuration = project.sourceMetadata?.durationSeconds;
  const sourceDuration = project.sourceDurationValidation?.physicalDurationSeconds ?? recordedSourceDuration;
  const model = buildTimeline({ plan, assets, durationSeconds: workspace.preview.durationSeconds, sourceDurationSeconds: measuredSourceSeconds ?? sourceDuration, review });
  const frame = previewFrameAt(plan, assets, time);
  const clip = findClip(model, selectedClipId);
  const operation = operationById(plan, clip?.operationId);
  const beat = beatForOperation(operation, workspace.beats);
  const decision = beat ? review.decisions.find((item) => item.beatId === beat.section.id) : undefined;
  const assetUrl = (assetId: string) => productClient.assetUrl(project.workflow.projectId, assetId);
  const orientation = project.workflow.render.format.orientation;
  const durationBlockers = sourceDurationBlockers(project);
  const issues = [...new Set([
    ...durationBlockers,
    ...reconcileTimeline({ planDurationSeconds: workspace.preview.durationSeconds, sourceMetadataSeconds: recordedSourceDuration, physicalSourceSeconds: project.sourceDurationValidation?.physicalDurationSeconds, measuredSourceSeconds }),
  ])];
  const statuses = Object.fromEntries(review.decisions.map((item) => [item.beatId, item.status]));
  const steps = buildPipeline(project, computeBrollStatus(plan, workspace.beats, review));
  const rendered = ['completed', 'failed'].includes(project.workflow.stages.render.status);
  const stacked = viewport.width < STACKED_VIEWPORT;
  const showLibrary = viewport.width >= LIBRARY_MIN_VIEWPORT;
  const gridStyle = stacked ? undefined : { gridTemplateColumns: `${showLibrary ? `${layout.left}px 8px ` : ''}minmax(0,1fr) 8px ${layout.right}px` };
  const activeBeatId = beat?.section.id ?? workspace.beats.find((candidate) => time >= candidate.section.start && time < candidate.section.end)?.section.id;

  return <div className="ve-editor" data-state="ready" data-project-id={project.workflow.projectId}>
    <header className="ve-editor-bar">
      <div className="ve-crumbs"><span>Projects</span><i>›</i><b>{project.workflow.title}</b><i>›</i><span>Review & Edit</span></div>
      <div className="ve-bar-chips">
        <span className="ve-chip">{durationBlockers.length ? 'SOURCE DURATION MISMATCH' : project.workflow.status.replaceAll('_', ' ')}</span>
        <span className={`ve-chip ${resolved.readiness.ready && !durationBlockers.length ? 'status-accepted' : 'status-pending'}`}>{durationBlockers.length ? 'RENDER BLOCKED' : resolved.readiness.label}</span>
        <span className="ve-chip">{orientation} {project.workflow.render.format.width}×{project.workflow.render.format.height}</span>
        {session.saving && <span className="ve-chip status-modified" role="status">Saving…</span>}
      </div>
      <button type="button" className="ve-export-button" onClick={handlers.onGoExport}>Export Video</button>
    </header>
    {issues.length > 0 && <div className="ve-banner" role="alert"><b>Timeline / source mismatch.</b> {issues.join(' ')}</div>}
    {rendered && <div className="ve-banner info">This project has already been rendered. Saving a change to the approved plan archives that render and reopens export.</div>}
    {session.actionError && <div className="ve-banner error" role="alert">{session.actionError}<button type="button" onClick={session.clearError}>Dismiss</button></div>}
    <div className="ve-editor-grid" style={gridStyle}>
      {showLibrary && <><aside className="ve-panel ve-left"><LibraryPanel assets={assets} plan={plan} beats={workspace.beats} statuses={statuses} selectedBeatId={activeBeatId} assetUrl={assetUrl} onSelectBeat={(next) => handlers.onSelectBeat(next.section.id)} /></aside>
      <Splitter orientation="vertical" label="Resize scene library" direction="grow-before" value={layout.left} min={LAYOUT_LIMITS.left.min} max={viewport.width * LAYOUT_LIMITS.left.maxShare} onChange={(left) => onLayout({ left })} onReset={() => onLayoutReset('left')} /></>}
      <main className="ve-center" style={{ gridTemplateRows: stacked ? undefined : `minmax(0,1fr) auto ${layout.timeline}px` }}>
        <PreviewPlayer
          sourceUrl={project.sourceMetadata?.relativePath ? productClient.sourceUrl(project.workflow.projectId) : undefined}
          assetUrl={assetUrl}
          frame={frame}
          time={time}
          seekToken={seekToken}
          playing={playing}
          durationSeconds={model.durationSeconds}
          sourceDurationSeconds={measuredSourceSeconds ?? sourceDuration}
          orientation={orientation}
          onPlayingChange={handlers.onPlayingChange}
          onTick={handlers.onTick}
          onSeek={handlers.onSeek}
          onSourceDuration={handlers.onSourceDuration}
        />
        <Splitter orientation="horizontal" label="Resize preview and timeline" direction="grow-after" value={layout.timeline} min={LAYOUT_LIMITS.timeline.min} max={viewport.height * LAYOUT_LIMITS.timeline.maxShare} onChange={(timeline) => onLayout({ timeline })} onReset={() => onLayoutReset('timeline')} />
        <Timeline model={model} selectedClipId={selectedClipId} time={time} playing={playing} pixelsPerSecond={pixelsPerSecond} onZoom={handlers.onZoom} onSelectClip={handlers.onSelectClip} onSeek={handlers.onSeek} assetUrl={assetUrl} peaks={peaks} waveformNote={waveformNote} />
      </main>
      <Splitter orientation="vertical" label="Resize AI Director panel" direction="grow-after" value={layout.right} min={LAYOUT_LIMITS.right.min} max={viewport.width * LAYOUT_LIMITS.right.maxShare} onChange={(right) => onLayout({ right })} onReset={() => onLayoutReset('right')} />
      <aside className="ve-panel ve-right">
        <div className="ve-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={rightTab === 'director'} className={rightTab === 'director' ? 'active' : ''} onClick={() => handlers.onTab('director')}>AI Director</button>
          <button type="button" role="tab" aria-selected={rightTab === 'inspect'} className={rightTab === 'inspect' ? 'active' : ''} onClick={() => handlers.onTab('inspect')}>Inspector</button>
        </div>
        {rightTab === 'director'
          ? <DirectorPanel
            steps={steps}
            beats={workspace.beats}
            review={review}
            selectedBeatId={activeBeatId}
            blockers={resolved.readiness.blockers}
            busy={session.busy}
            onSelectBeat={(next) => handlers.onSelectBeat(next.section.id)}
            onOpenReview={() => handlers.onOpenReview(activeBeatId)}
            onOpenExport={handlers.onGoExport}
          />
          : <OperationInspector clip={clip} operation={operation} assets={assets} beat={beat} decision={decision} assetUrl={assetUrl} saving={session.saving} sourceDurationSeconds={measuredSourceSeconds ?? sourceDuration} onPreview={handlers.onPreviewOperation} onOpenReview={handlers.onOpenReview} onAct={(beatId, action, options) => void session.act(beatId, action, options)} />}
      </aside>
    </div>
  </div>;
};

export const EditingWorkspace: React.FC<{
  session: EditorSession;
  onOpenReview: (beatId?: string) => void;
  onGoExport: () => void;
  onGoDirector: () => void;
}> = ({ session, onOpenReview, onGoExport, onGoDirector }) => {
  const duration = session.workspace?.preview.durationSeconds ?? 0;
  const [clock, setClock] = useState({ time: 0, seek: 0 });
  const [playing, setPlaying] = useState(false);
  const [range, setRange] = useState<{ start: number; end: number }>();
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const [rightTab, setRightTab] = useState<RightTab>('director');
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number | undefined>(undefined);
  const orientation = session.project?.workflow.render.format.orientation ?? 'landscape';
  const prefs = useLayoutPrefs(orientation);
  const [measured, setMeasured] = useState<number>();
  const [wave, setWave] = useState<{ peaks?: number[]; note?: string }>({});
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const projectId = session.project?.workflow.projectId;
  const hasSource = Boolean(session.project?.sourceMetadata?.relativePath);

  useEffect(() => {
    if (session.phase !== 'ready' || !projectId || !hasSource) return;
    let cancelled = false;
    setWave({});
    void loadWaveform(productClient.sourceUrl(projectId)).then((result) => {
      if (!cancelled) setWave(result.kind === 'ready' ? { peaks: result.peaks } : { note: `Waveform unavailable: ${result.reason}` });
    });
    return () => { cancelled = true; };
  }, [session.phase, projectId, hasSource]);

  const seek = (seconds: number) => setClock((current) => ({ time: clampTime(seconds, duration), seek: current.seek + 1 }));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== 'Space' || target?.closest('input, textarea, select, button')) return;
      event.preventDefault();
      setPlaying((current) => !current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const plan = session.resolved?.approvedPlan;
  const handlers: WorkspaceViewProps['handlers'] = {
    onSeek: (seconds) => { setRange(undefined); seek(seconds); },
    onTick: (seconds) => {
      setClock((current) => ({ ...current, time: seconds }));
      const active = rangeRef.current;
      if (active && seconds >= active.end) { setPlaying(false); setRange(undefined); }
    },
    onPlayingChange: (next) => { if (!next) setRange(undefined); setPlaying(next); },
    onSelectClip: (clip) => { setSelectedClipId(clip.id); setRightTab('inspect'); setRange(undefined); seek(clip.start); },
    onSelectBeat: (beatId) => {
      const operation = plan?.operations.find((candidate) => operationBeatId(candidate) === beatId);
      const beat = session.workspace?.beats.find((candidate) => candidate.section.id === beatId);
      setSelectedClipId(operation ? `clip-${operation.id}` : undefined);
      setRightTab('inspect');
      setRange(undefined);
      if (beat) seek(operation?.start ?? beat.section.start);
    },
    onZoom: setPixelsPerSecond,
    onTab: setRightTab,
    onPreviewOperation: () => {
      const operation = plan?.operations.find((candidate) => `clip-${candidate.id}` === selectedClipId);
      if (!operation) return;
      setRange({ start: operation.start, end: operation.end });
      seek(operation.start);
      setPlaying(true);
    },
    onOpenReview,
    onGoExport,
    onGoDirector,
    onSourceDuration: setMeasured,
  };
  return <EditingWorkspaceView session={session} time={clock.time} seekToken={clock.seek} playing={playing} selectedClipId={selectedClipId} pixelsPerSecond={pixelsPerSecond} rightTab={rightTab} layout={prefs.layout} viewport={prefs.viewport} onLayout={prefs.update} onLayoutReset={prefs.reset} measuredSourceSeconds={measured} peaks={wave.peaks} waveformNote={wave.note} handlers={handlers} />;
};
