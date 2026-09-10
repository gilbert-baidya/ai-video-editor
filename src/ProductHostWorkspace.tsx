import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DirectorReviewWorkspace, type ReviewDataPayload } from './DirectorReviewWorkspace.tsx';
import type { ReviewState } from './director-review.ts';
import { productClient } from './product-client.ts';
import type { ProductCapabilities, ProductProjectRecord } from './product-api.ts';
import { renderBlockers, type ProductStage, type ProjectSource } from './product-workflow.ts';
import { formatProfileLabel } from './video-format.ts';

type View = 'projects' | 'new' | 'project' | 'review';

const actionLabels: Partial<Record<ProductStage, string>> = {
  ingest: 'INGEST',
  transcript: 'TRANSCRIBE',
  director: 'ANALYZE SERMON',
  render: 'RENDER SERMON',
  qa: 'FINAL QA',
};

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function capabilityTone(state: string): string {
  return state === 'AVAILABLE' ? 'available' : state === 'DEGRADED' ? 'degraded' : 'unavailable';
}

export const ProductHostWorkspace: React.FC = () => {
  const [view, setView] = useState<View>('projects');
  const [projects, setProjects] = useState<ProductProjectRecord[]>([]);
  const [project, setProject] = useState<ProductProjectRecord>();
  const [capabilities, setCapabilities] = useState<ProductCapabilities>();
  const [reviewData, setReviewData] = useState<ReviewDataPayload>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reviewSaveChain = useRef(Promise.resolve());

  async function refresh(projectId?: string): Promise<void> {
    const list = await productClient.listProjects();
    setProjects(list);
    if (projectId) setProject(await productClient.getProject(projectId));
  }

  useEffect(() => {
    void Promise.all([productClient.listProjects(), productClient.capabilities()])
      .then(([items, detected]) => { setProjects(items); setCapabilities(detected); })
      .catch((reason) => setError(message(reason)));
  }, []);

  async function runStage(stage: ProductStage): Promise<void> {
    if (!project) return;
    setBusy(true);
    setError('');
    try {
      await productClient.startStage(project.workflow.projectId, stage);
      for (;;) {
        await new Promise((done) => setTimeout(done, 500));
        const current = await productClient.getProject(project.workflow.projectId);
        setProject(current);
        const state = current.workflow.stages[stage].status;
        if (state !== 'running' && state !== 'not-started') {
          if (state === 'failed') setError(current.workflow.stages[stage].error ?? `${stage} failed.`);
          break;
        }
      }
      await refresh(project.workflow.projectId);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function openReview(): Promise<void> {
    if (!project) return;
    setBusy(true);
    setError('');
    try {
      setReviewData(await productClient.reviewWorkspace(project.workflow.projectId));
      setView('review');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveReview(review: ReviewState): Promise<void> {
    if (!project || !reviewData) return;
    reviewSaveChain.current = reviewSaveChain.current
      .then(async () => {
        const saved = await productClient.saveReview(project.workflow.projectId, review);
        setProject(saved);
      })
      .catch((reason: unknown) => setError(message(reason)));
    await reviewSaveChain.current;
  }

  const blockers = useMemo(() => project ? renderBlockers(project.workflow) : [], [project]);
  if (view === 'review' && reviewData) {
    return <div className="product-shell">
      <button className="review-back" onClick={() => setView('project')}>← Back to project</button>
      <DirectorReviewWorkspace data={reviewData} onReviewStateChange={(review) => void saveReview(review)} />
    </div>;
  }

  return <div className="product-shell">
    <nav className="product-nav">
      <button className="product-brand" onClick={() => setView('projects')}><span>✦</span><b>AI VIDEO EDITOR</b></button>
      <button className={view === 'projects' ? 'active' : ''} onClick={() => setView('projects')}>Projects</button>
      <button className={view === 'new' ? 'active' : ''} onClick={() => setView('new')}>New Project</button>
      <div className="nav-provider"><small>LOCAL HOST</small><b>{capabilities?.node.state ?? 'CHECKING'}</b><span>V1.3 orchestration</span></div>
    </nav>
    {error && <div className="host-error" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {view === 'projects' && <section className="product-screen">
      <div className="screen-heading"><span>PROJECTS</span><h1>Sermon editing projects</h1><p>Project metadata, jobs, artifacts, review, and QA are persisted by the local product host.</p></div>
      <div className="capability-grid">{capabilities && Object.entries(capabilities).filter(([name]) => name !== 'checkedAt').map(([name, item]) => {
        if (name === 'director') {
          const dirCap = item as ProductCapabilities['director'];
          return (
            <div key={name}>
              <small>AI DIRECTOR</small>
              <b className={capabilityTone(dirCap.state)}>{dirCap.provider === 'gemini' ? 'Gemini 3.1 Pro' : 'Ollama Qwen'}</b>
              <span>Status: {dirCap.state === 'AVAILABLE' ? 'Connected' : 'Unavailable'}</span>
              <span>Fallback: {dirCap.ollamaAvailable ? 'Local Qwen available' : 'Unavailable'}</span>
            </div>
          );
        }
        const capability = item as ProductCapabilities['node'];
        return <div key={name}><small>{name.toUpperCase()}</small><b className={capabilityTone(capability.state)}>{capability.state}</b><span>{capability.detail}</span></div>;
      })}</div>
      <div className="project-list">{projects.map((item) => <button key={item.workflow.projectId} onClick={() => { setProject(item); setView('project'); }}><b>{item.workflow.title}</b><span>{item.workflow.status.replaceAll('_', ' ')}</span><small>{item.workflow.updatedAt}</small></button>)}</div>
      {!projects.length && <p className="empty-state">No projects yet. Create one to begin.</p>}
    </section>}
    {view === 'new' && <NewProject onCreated={(created) => { setProject(created); void refresh(); setView('project'); }} capabilities={capabilities} />}
    {view === 'project' && project && <section className="product-screen">
      <div className="screen-heading"><span>PROJECT</span><h1>{project.workflow.title}</h1><p>{project.sourceMetadata?.fileName ?? (project.workflow.source.type === 'youtube-url' ? project.workflow.source.url : 'Awaiting source upload')}</p></div>
      <div className="project-overview host-overview"><small>CURRENT STATUS</small><strong>{project.workflow.status.replaceAll('_', ' ')}</strong><span>Project ID: {project.workflow.projectId}</span></div>
      <div className="format-grid">
        <div><small>SOURCE</small><b>{project.sourceMetadata?.width && project.sourceMetadata.height ? `${project.sourceMetadata.width}×${project.sourceMetadata.height}` : 'Pending metadata'}</b><span>{project.sourceMetadata?.width && project.sourceMetadata.height ? (project.sourceMetadata.width < project.sourceMetadata.height ? 'Portrait' : 'Landscape') : 'Orientation pending'}</span></div>
        <div><small>OUTPUT</small><b>{formatProfileLabel(project.workflow.render.format).split(' · ')[0]}</b><span>{project.workflow.render.format.orientation === 'portrait' ? 'Portrait' : 'Landscape'} · Preserve source framing</span></div>
      </div>
      <div className="workflow-row">{Object.entries(project.workflow.stages).map(([name, stage]) => <button key={name} disabled={busy} onClick={() => {
        if (name === 'review') void openReview();
        else if (actionLabels[name as ProductStage]) void runStage(name as ProductStage);
      }}><span className={`stage-dot ${stage.status}`} /><b>{name === 'director' ? 'AI Director' : name}</b><small>{stage.status} · {stage.progress}%{stage.cacheReused ? ' · cache reused' : ''}</small></button>)}</div>
      <div className="project-actions">
        {project.workflow.stages.director.status === 'completed' && <button className="gold-button" disabled={busy} onClick={() => void openReview()}>OPEN DIRECTOR REVIEW</button>}
        {project.workflow.stages.review.status === 'completed' && <button className="gold-button" disabled={busy || blockers.length > 0} onClick={() => void runStage('render')}>RENDER SERMON</button>}
        {project.workflow.stages.render.status === 'completed' && <button className="gold-button" disabled={busy} onClick={() => void runStage('qa')}>FINAL QA</button>}
        {project.output?.qaStatus === 'PASS' && <a className="gold-button" href={`/api/projects/${project.workflow.projectId}/output`} target="_blank" rel="noreferrer">SHOW OUTPUT</a>}
      </div>
      {blockers.length > 0 && <div className="render-blockers">{blockers.map((item) => <span key={item}>⚠ {item}</span>)}</div>}
      {project.output && <div className="output-path"><small>FINAL VIDEO · {project.output.qaStatus}</small><code>{project.output.fileName} · {(project.output.sizeBytes / 1024 / 1024).toFixed(1)} MB · {project.output.width}×{project.output.height}</code></div>}
      {project.qa?.editorial && <div className={`editorial-result ${project.qa.editorial.passed ? 'pass' : 'fail'}`}><small>EDITORIAL QUALITY</small><b>{project.qa.editorial.passed ? 'PASS' : 'REQUIRES ATTENTION'}</b><span>{project.qa.editorial.activity.meaningfulEditCount} meaningful edits · {project.qa.editorial.activity.eventsPerMinute} per minute</span>{project.qa.editorial.failures.map((failure) => <p key={failure}>{failure}</p>)}</div>}
      {project.jobs.length > 0 && <details className="host-jobs"><summary>Job diagnostics</summary>{project.jobs.slice().reverse().map((job) => <div key={job.jobId}><code>{job.jobId}</code><span>{job.stage} · {job.status} · {job.progress ?? 0}%</span>{job.error && <b>{job.error}</b>}</div>)}</details>}
    </section>}
  </div>;
};

function NewProject({ onCreated, capabilities }: { onCreated: (project: ProductProjectRecord) => void; capabilities?: ProductCapabilities }): React.ReactElement {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ProjectSource['type']>('local-video');
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const source: ProjectSource = type === 'local-video'
        ? { type, fileName: file!.name, sizeBytes: file!.size }
        : { type, url: url.trim(), ingestionAvailable: capabilities?.youtube.state === 'AVAILABLE' };
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
  return <section className="product-screen">
    <div className="screen-heading"><span>NEW PROJECT</span><h1>Start a sermon edit</h1><p>The original source is streamed to an app-managed directory, fingerprinted, and kept immutable.</p></div>
    <div className="source-form">
      <label>Project title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="source-choice">
        <button className={type === 'local-video' ? 'active' : ''} onClick={() => setType('local-video')}><b>Local video</b><span>Stream a sermon recording to this Mac</span></button>
        <button className={type === 'youtube-url' ? 'active' : ''} onClick={() => setType('youtube-url')}><b>YouTube URL</b><span>{capabilities?.youtube.detail ?? 'Checking capability…'}</span></button>
      </div>
      {type === 'local-video'
        ? <label>Choose sermon video<input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0])} /></label>
        : <label>YouTube URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>}
      {progress > 0 && <div className="render-progress"><div style={{ width: `${progress}%` }} /><span>Uploading · {progress}%</span></div>}
      <button className="gold-button" disabled={!valid || busy} onClick={() => void create()}>CREATE PROJECT</button>
      {error && <p className="source-message">{error}</p>}
    </div>
  </section>;
}
