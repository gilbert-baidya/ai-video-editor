import React, { useCallback, useMemo, useState } from 'react';
import { DirectorReviewWorkspace, type ReviewDataPayload } from './DirectorReviewWorkspace.tsx';
import {
  canRenderProject,
  createProductProject,
  finalQaPassed,
  recoverProductProject,
  renderBlockers,
  updateProductStage,
  type FinalQaSummary,
  type ProductProjectState,
  type ProductStage,
  type ProjectSource,
} from './product-workflow.ts';

type ProductView = 'home' | 'new-project' | 'director' | 'review' | 'render' | 'qa';

export interface AiVideoEditorWorkspaceProps {
  data: ReviewDataPayload;
  onCreateProject?: (source: ProjectSource) => Promise<void>;
  onRender?: (
    project: ProductProjectState,
    onProgress: (progress: number, stage: string) => void,
  ) => Promise<FinalQaSummary>;
}

const stageLabels: Array<{ stage: ProductStage; label: string }> = [
  { stage: 'ingest', label: 'Preparing sermon' },
  { stage: 'transcript', label: 'Loading transcript' },
  { stage: 'director', label: 'Understanding sermon and planning visuals' },
  { stage: 'review', label: 'Preparing Director review' },
  { stage: 'render', label: 'Rendering sermon' },
  { stage: 'qa', label: 'Checking final video' },
];

function persistedProject(data: ReviewDataPayload): ProductProjectState {
  const key = `ai-video-editor:project:${data.projectId}`;
  try {
    const stored = window.localStorage.getItem(key);
    const recovered = stored ? recoverProductProject(JSON.parse(stored) as unknown) : undefined;
    if (recovered) return recovered;
  } catch { /* Unavailable or corrupt browser storage falls back to artifact-derived state. */ }

  const execution = data.directorExecution;
  const project = createProductProject({
    projectId: data.projectId,
    title: data.title,
    source: { type: 'local-video', fileName: data.preview.controlUrl, durationSeconds: data.preview.durationSeconds },
    provider: {
      name: execution?.provider ?? data.aiPlan.createdBy.provider,
      model: execution?.model ?? data.aiPlan.createdBy.model,
      status: execution?.providerStatus ?? 'NOT_CONFIGURED',
      fallbackUsed: execution?.fallbackUsed ?? false,
    },
  });
  const covered = execution?.canonicalCoverageComplete ? 100 : execution?.coverage?.report.coveragePercent ?? 0;
  let ready = updateProductStage(project, 'ingest', { status: 'completed', cacheReused: true });
  ready = updateProductStage(ready, 'transcript', { status: 'completed', cacheReused: true });
  ready = updateProductStage(ready, 'director', { status: 'completed', cacheReused: true });
  ready = updateProductStage(ready, 'review', { status: 'running', progress: 0 });
  return { ...ready, coveragePercent: covered };
}

const formatDuration = (seconds?: number): string => {
  if (seconds === undefined) return 'Pending inspection';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

const sourceLabel = (source: ProjectSource): string => source.type === 'local-video' ? source.fileName : source.url;

function StatusPill({ passed, children }: { passed: boolean; children: React.ReactNode }): React.ReactElement {
  return <span className={`product-pill ${passed ? 'pass' : 'block'}`}>{children}</span>;
}

function NewProjectScreen({ onCreate }: { onCreate?: (source: ProjectSource) => Promise<void> }): React.ReactElement {
  const [sourceType, setSourceType] = useState<ProjectSource['type']>('local-video');
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const source: ProjectSource | undefined = sourceType === 'local-video'
    ? file ? { type: 'local-video', fileName: file.name, sizeBytes: file.size } : undefined
    : url.trim() ? { type: 'youtube-url', url: url.trim(), ingestionAvailable: Boolean(onCreate) } : undefined;

  async function create(): Promise<void> {
    if (!source) return;
    if (!onCreate) {
      setMessage(source.type === 'youtube-url'
        ? 'YouTube ingestion is not configured. The URL was not downloaded.'
        : 'Project ingestion service is not attached to this static Review Workspace.');
      return;
    }
    setMessage('Preparing project…');
    try {
      await onCreate(source);
      setMessage('Project created. Ingestion has started.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return <section className="product-screen">
    <div className="screen-heading"><span>NEW PROJECT</span><h1>Start a sermon edit</h1><p>Choose the original sermon source. The source remains immutable throughout editing.</p></div>
    <div className="source-choice">
      <button className={sourceType === 'local-video' ? 'active' : ''} onClick={() => setSourceType('local-video')}><b>Local video</b><span>Upload an existing sermon recording</span></button>
      <button className={sourceType === 'youtube-url' ? 'active' : ''} onClick={() => setSourceType('youtube-url')}><b>YouTube URL</b><span>Uses a configured ingestion service</span></button>
    </div>
    <div className="source-form">
      {sourceType === 'local-video'
        ? <label>Choose sermon video<input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0])} /></label>
        : <label>YouTube URL<input type="url" value={url} placeholder="https://www.youtube.com/watch?v=…" onChange={(event) => setUrl(event.target.value)} /></label>}
      {file && <div className="source-summary"><b>{file.name}</b><span>{(file.size / 1024 / 1024).toFixed(1)} MB · Duration inspected during ingest</span></div>}
      <button className="gold-button" disabled={!source} onClick={() => void create()}>Create project</button>
      {message && <p className="source-message">{message}</p>}
    </div>
  </section>;
}

export const AiVideoEditorWorkspace: React.FC<AiVideoEditorWorkspaceProps> = ({ data, onCreateProject, onRender }) => {
  const [view, setView] = useState<ProductView>('home');
  const [project, setProject] = useState<ProductProjectState>(() => persistedProject(data));
  const [renderStage, setRenderStage] = useState('Waiting to render');
  const persist = useCallback((next: ProductProjectState) => {
    setProject(next);
    try { window.localStorage.setItem(`ai-video-editor:project:${next.projectId}`, JSON.stringify(next)); } catch { /* Persistence remains best-effort in restricted preview contexts. */ }
  }, []);

  const blockers = useMemo(() => renderBlockers(project), [project]);
  const qaRows = project.qa ? [
    ['VIDEO', project.qa.video],
    ['AUDIO', project.qa.audio],
    ['DIRECTOR COVERAGE', project.qa.directorCoverage],
    ['B-ROLL RIGHTS', project.qa.brollRights],
    ['PLACEMENT', project.qa.placement],
    ['BENGALI GRAPHICS', project.qa.bengaliGraphics],
    ['REVIEW READINESS', project.qa.reviewReadiness],
  ] as const : [];

  function onReviewStateChange(_: unknown, ready: boolean): void {
    const current = project.stages.review;
    if ((ready && current.status === 'completed') || (!ready && current.status === 'running')) return;
    persist(updateProductStage(project, 'review', ready
      ? { status: 'completed', progress: 100 }
      : { status: 'running', progress: Math.max(current.progress, 1) }));
  }

  async function render(): Promise<void> {
    if (!onRender || !canRenderProject(project)) return;
    let next = updateProductStage(project, 'render', { status: 'running', progress: 0 });
    persist(next);
    try {
      const qa = await onRender(next, (progress, stage) => {
        setRenderStage(stage);
        next = updateProductStage(next, 'render', { status: 'running', progress });
        persist(next);
      });
      next = updateProductStage(next, 'render', { status: 'completed' });
      next = updateProductStage({ ...next, qa }, 'qa', { status: finalQaPassed(qa) ? 'completed' : 'failed', error: finalQaPassed(qa) ? undefined : 'One or more final QA gates failed.' });
      persist(next);
      setView('qa');
    } catch (reason) {
      persist(updateProductStage(next, 'render', { status: 'failed', error: reason instanceof Error ? reason.message : String(reason) }));
    }
  }

  return <div className="product-shell">
    <nav className="product-nav">
      <button className="product-brand" onClick={() => setView('home')}><span>✦</span><b>AI VIDEO EDITOR</b></button>
      {[
        ['home', 'Project'],
        ['new-project', 'New Project'],
        ['director', 'Director'],
        ['review', 'Review'],
        ['render', 'Render'],
        ['qa', 'Final QA'],
      ].map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id as ProductView)}>{label}</button>)}
      <div className="nav-provider"><small>AI DIRECTOR</small><b>{project.provider.name}</b><span>{project.provider.model ?? 'No model'} · {project.provider.status}</span></div>
    </nav>

    {view === 'home' && <section className="product-screen">
      <div className="screen-heading"><span>PROJECT</span><h1>{project.title}</h1><p>{sourceLabel(project.source)} · {formatDuration(project.source.type === 'local-video' ? project.source.durationSeconds : undefined)}</p></div>
      <div className="project-status-grid">
        <div className="project-overview"><small>CURRENT STATUS</small><strong>{project.status.replaceAll('_', ' ')}</strong><span>Completed stages are persisted and reusable after reopening.</span></div>
        <div><small>TRANSCRIPT</small><b>{project.stages.transcript.status}</b></div>
        <div><small>DIRECTOR</small><b>{project.stages.director.status}</b></div>
        <div><small>REVIEW</small><b>{project.stages.review.status}</b></div>
        <div><small>RENDER</small><b>{project.stages.render.status}</b></div>
        <div><small>AI COVERAGE</small><b>{project.coveragePercent.toFixed(1)}%</b></div>
      </div>
      <div className="workflow-row">{stageLabels.map(({ stage, label }) => <button key={stage} onClick={() => setView(stage === 'ingest' || stage === 'transcript' ? 'home' : stage === 'director' ? 'director' : stage)}><span className={`stage-dot ${project.stages[stage].status}`} /> <b>{label}</b><small>{project.stages[stage].status}{project.stages[stage].cacheReused ? ' · cache reused' : ''}</small></button>)}</div>
    </section>}

    {view === 'new-project' && <NewProjectScreen onCreate={onCreateProject} />}

    {view === 'director' && <section className="product-screen">
      <div className="screen-heading"><span>AI DIRECTOR</span><h1>Director plan</h1><p>Friendly stages on the surface; complete provider provenance and safety diagnostics remain available.</p></div>
      <div className="director-provider-card"><div><small>PROVIDER</small><b>{project.provider.name}</b><span>{project.provider.model ?? 'No model configured'}</span></div><StatusPill passed={!project.provider.fallbackUsed}>{project.provider.status}</StatusPill><div><small>CANONICAL COVERAGE</small><b>{project.coveragePercent.toFixed(1)}%</b><span>{project.provider.fallbackUsed ? 'Fallback used — review required' : 'AI-originated decisions'}</span></div></div>
      <div className="pipeline-list">{stageLabels.slice(0, 4).map(({ stage, label }, index) => <div key={stage}><span>{String(index + 1).padStart(2, '0')}</span><b>{label}</b><StatusPill passed={project.stages[stage].status === 'completed'}>{project.stages[stage].status}</StatusPill></div>)}</div>
      <button className="gold-button" onClick={() => setView('review')}>Review Director plan</button>
    </section>}

    {view === 'review' && <DirectorReviewWorkspace data={data} onReviewStateChange={onReviewStateChange} />}

    {view === 'render' && <section className="product-screen">
      <div className="screen-heading"><span>RENDER</span><h1>Render sermon</h1><p>Rendering starts only after Director, human-review, coverage, and rights gates are clear.</p></div>
      <div className="render-grid">
        <div><small>DIRECTOR</small><StatusPill passed={project.stages.director.status === 'completed'}>{project.stages.director.status === 'completed' ? 'READY' : 'NOT READY'}</StatusPill></div>
        <div><small>HUMAN REVIEW</small><StatusPill passed={project.stages.review.status === 'completed'}>{project.stages.review.status === 'completed' ? 'COMPLETE' : 'INCOMPLETE'}</StatusPill></div>
        <div><small>UNRESOLVED BLOCKERS</small><b>{blockers.length}</b></div>
        <div><small>AI COVERAGE</small><b>{project.coveragePercent.toFixed(1)}%</b></div>
        <div><small>B-ROLL RIGHTS</small><StatusPill passed={!blockers.some((item) => item.toLowerCase().includes('rights'))}>{blockers.some((item) => item.toLowerCase().includes('rights')) ? 'BLOCKER' : 'SAFE'}</StatusPill></div>
        <div><small>OUTPUT</small><b>{project.render.width}×{project.render.height} · {project.render.fps} fps</b><span>{project.render.codec} · {project.render.audio}</span></div>
      </div>
      {blockers.length > 0 && <div className="render-blockers">{blockers.map((blocker) => <span key={blocker}>⚠ {blocker}</span>)}</div>}
      {project.stages.render.status === 'running' && <div className="render-progress"><div style={{ width: `${project.stages.render.progress}%` }} /><span>{project.stages.render.progress}% · {renderStage}</span></div>}
      {!onRender && <p className="service-note">Render service is not attached to this static workspace. No render has been simulated.</p>}
      <button className="gold-button" disabled={!onRender || !canRenderProject(project)} onClick={() => void render()}>Render sermon</button>
    </section>}

    {view === 'qa' && <section className="product-screen">
      <div className="screen-heading"><span>FINAL QA</span><h1>{project.qa ? (finalQaPassed(project.qa) ? 'Sermon ready to export' : 'QA requires attention') : 'Awaiting final render'}</h1></div>
      {project.qa ? <><div className="qa-list">{qaRows.map(([label, passed]) => <div key={label}><b>{label}</b><StatusPill passed={passed}>{passed ? 'PASS' : 'FAIL'}</StatusPill></div>)}</div>{project.qa.outputPath && <div className="output-path"><small>FINAL OUTPUT</small><code>{project.qa.outputPath}</code></div>}</> : <p className="empty-state">Complete a gated render to generate the final QA summary.</p>}
    </section>}
  </div>;
};
