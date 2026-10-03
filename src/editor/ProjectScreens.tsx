import React from 'react';
import type { ProductCapabilities } from '../product-api.ts';
import { productClient } from '../product-client.ts';
import { DirectorPanel } from './DirectorPanel.tsx';
import { ExportPanel } from './ExportPanel.tsx';
import { AssetCard, ImportAssetForm } from './LibraryPanel.tsx';
import { CapabilityStrip } from './ProjectsDashboard.tsx';
import { buildPipeline, computeBrollStatus, reconcileTimeline } from './editor-model.ts';
import type { EditorSession } from './useEditorSession.ts';

const Missing: React.FC<{ title: string; session: EditorSession; hint: string }> = ({ title, session, hint }) => <div className="ve-state" data-state={session.phase}>
  <b>{title}</b><p>{session.phase === 'loading' ? 'Loading…' : session.message ?? hint}</p>
</div>;

export const DirectorScreen: React.FC<{ session: EditorSession; onOpenReview: () => void; onOpenExport: () => void }> = ({ session, onOpenReview, onOpenExport }) => {
  const { project, workspace, review, resolved } = session;
  if (!project) return <section className="ve-page"><Missing title="AI Director" session={session} hint="Open a project first." /></section>;
  const steps = buildPipeline(project, workspace && review && resolved ? computeBrollStatus(resolved.approvedPlan, workspace.beats, review) : undefined);
  const ingestDone = project.workflow.stages.ingest.status === 'completed';
  const provider = project.workflow.provider;
  const quality = workspace?.directorQuality;
  const confirmCloud = () => window.confirm('Generating the plan sends the transcript to the configured cloud AI provider and may incur usage cost. Continue?');
  return <section className="ve-page" data-screen="director">
    <header className="ve-page-head"><div><small>AI DIRECTOR</small><h1>{project.workflow.title}</h1></div></header>
    {session.actionError && <div className="ve-banner error" role="alert">{session.actionError}<button type="button" onClick={session.clearError}>Dismiss</button></div>}
    <div className="ve-two-col">
      <div className="ve-card-panel">
        <DirectorPanel
          steps={steps}
          beats={workspace?.beats ?? []}
          review={review ?? { schemaVersion: '1.0', projectId: project.workflow.projectId, sourceEditPlanHash: '', decisions: [], updatedAt: '' }}
          blockers={resolved?.readiness.blockers ?? []}
          busy={session.busy}
          onSelectBeat={onOpenReview}
          onRunAnalyze={() => void session.runStage(ingestDone ? 'transcript' : 'ingest')}
          onRunPlan={() => { if (confirmCloud()) void session.runStage('director'); }}
          onOpenReview={onOpenReview}
          onOpenExport={onOpenExport}
        />
      </div>
      <div className="ve-card-panel">
        <h3>Director provenance</h3>
        <dl className="ve-facts">
          <dt>Provider</dt><dd>{provider.name}{provider.model ? ` · ${provider.model}` : ''}</dd>
          <dt>Provider status</dt><dd>{provider.status}</dd>
          <dt>Fallback used</dt><dd>{provider.fallbackUsed ? 'Yes — render is blocked until resolved' : 'No'}</dd>
          <dt>Transcript coverage</dt><dd>{project.workflow.coveragePercent}%</dd>
          {quality && <><dt>Director quality</dt><dd>{quality.status}</dd></>}
          {workspace?.editorialEnrichment && <><dt>Enrichment</dt><dd>{workspace.editorialEnrichment.outcome} · {workspace.editorialEnrichment.enrichmentAttemptCount} attempt(s)</dd></>}
          <dt>Cache reused</dt><dd>{Object.entries(project.cacheReuse).filter(([, reused]) => reused).map(([stage]) => stage).join(', ') || 'none'}</dd>
        </dl>
        {!workspace && <p className="ve-note">{session.message ?? 'The Director plan has not been generated yet.'}</p>}
      </div>
    </div>
  </section>;
};

export const MediaScreen: React.FC<{ session: EditorSession }> = ({ session }) => {
  const { project, workspace, resolved } = session;
  if (!project || !workspace) return <section className="ve-page"><Missing title="Media Library" session={session} hint="A Director plan is required before media can be imported." /></section>;
  const assetUrl = (assetId: string) => productClient.assetUrl(project.workflow.projectId, assetId);
  return <section className="ve-page" data-screen="media">
    <header className="ve-page-head"><div><small>MEDIA LIBRARY</small><h1>{workspace.mediaIndex.assets.length} asset(s)</h1></div></header>
    {session.actionError && <div className="ve-banner error" role="alert">{session.actionError}<button type="button" onClick={session.clearError}>Dismiss</button></div>}
    <div className="ve-two-col wide-left">
      <div className="ve-assets large">
        {workspace.mediaIndex.assets.map((asset) => <AssetCard key={asset.id} asset={asset} plan={resolved?.approvedPlan} assetUrl={assetUrl} />)}
        {!workspace.mediaIndex.assets.length && <p className="ve-note">Nothing imported yet.</p>}
      </div>
      <div className="ve-card-panel"><ImportAssetForm busy={session.busy} onImport={session.importAsset} /></div>
    </div>
  </section>;
};

export const ExportScreen: React.FC<{ session: EditorSession }> = ({ session }) => {
  const { project, workspace } = session;
  if (!project) return <section className="ve-page"><Missing title="Render / Export" session={session} hint="Open a project first." /></section>;
  const issues = reconcileTimeline({ planDurationSeconds: workspace?.preview.durationSeconds ?? project.sourceMetadata?.durationSeconds ?? 0, sourceMetadataSeconds: workspace ? project.sourceMetadata?.durationSeconds : undefined });
  return <section className="ve-page" data-screen="export">
    <header className="ve-page-head"><div><small>RENDER / EXPORT</small><h1>{project.workflow.title}</h1></div></header>
    {session.actionError && <div className="ve-banner error" role="alert">{session.actionError}<button type="button" onClick={session.clearError}>Dismiss</button></div>}
    <div className="ve-card-panel">
      <ExportPanel project={project} timelineIssues={issues} busy={session.busy} outputUrl={productClient.outputUrl(project.workflow.projectId)} onExport={() => void session.runStage('render')} onRerender={(reason) => void session.rerender(reason)} onRunQa={() => void session.runStage('qa')} />
    </div>
  </section>;
};

export const SettingsScreen: React.FC<{ capabilities?: ProductCapabilities; session: EditorSession }> = ({ capabilities, session }) => {
  const { project } = session;
  return <section className="ve-page" data-screen="settings">
    <header className="ve-page-head"><div><small>SETTINGS</small><h1>Host &amp; diagnostics</h1></div></header>
    <h3>Local capabilities</h3>
    <CapabilityStrip capabilities={capabilities} />
    {capabilities && <div className="ve-card-panel"><dl className="ve-facts">{Object.entries(capabilities).filter(([key]) => key !== 'checkedAt').map(([key, value]) => { const item = value as { state: string; detail: string }; return <React.Fragment key={key}><dt>{key}</dt><dd>{item.state} — {item.detail}</dd></React.Fragment>; })}<dt>Checked</dt><dd>{capabilities.checkedAt}</dd></dl></div>}
    <h3>Project diagnostics</h3>
    {!project ? <p className="ve-note">Open a project to see its stage records, jobs and artifacts.</p> : <div className="ve-card-panel">
      <dl className="ve-facts"><dt>Project ID</dt><dd><code>{project.workflow.projectId}</code></dd><dt>Status</dt><dd>{project.workflow.status}</dd>{Object.entries(project.workflow.stages).map(([name, stage]) => <React.Fragment key={name}><dt>{name}</dt><dd>{stage.status} · {stage.progress}%{stage.error ? ` · ${stage.error}` : ''}</dd></React.Fragment>)}<dt>Artifacts</dt><dd>{Object.entries(project.artifacts).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'none'}</dd></dl>
      {project.jobs.length > 0 && <details><summary>Job history ({project.jobs.length})</summary>{project.jobs.slice().reverse().map((job) => <p key={job.jobId}><code>{job.jobId}</code> {job.stage} · {job.status} · {job.progress ?? 0}%{job.error ? ` — ${job.error}` : ''}</p>)}</details>}
      {project.qa && <details><summary>Raw QA record</summary><pre>{JSON.stringify(project.qa, null, 2)}</pre></details>}
    </div>}
  </section>;
};
