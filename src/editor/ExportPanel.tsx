import React, { useState } from 'react';
import type { ProductProjectRecord } from '../product-api.ts';
import { exportStatus, type ExportState } from './editor-model.ts';

export interface ExportPanelProps {
  project: ProductProjectRecord;
  timelineIssues: string[];
  busy: boolean;
  outputUrl: string;
  onExport: () => void;
  onRerender: (reason: string) => void;
  onRunQa: () => void;
}

const tone: Record<ExportState, 'good' | 'warn' | 'bad' | 'info'> = { NOT_READY: 'warn', READY: 'info', RENDERING: 'info', AWAITING_QA: 'warn', FAILED: 'bad', QA_FAILED: 'bad', QA_PASSED: 'good' };

export const ExportPanel: React.FC<ExportPanelProps> = ({ project, timelineIssues, busy, outputUrl, onExport, onRerender, onRunQa }) => {
  const verdict = exportStatus(project);
  const [reason, setReason] = useState('');
  const stages = project.workflow.stages;
  const history = project.workflow.renderRevisions ?? [];
  return <div className="ve-export" data-export-state={verdict.state}>
    <div className={`ve-export-status tone-${tone[verdict.state]}`}>
      <small>EXPORT STATUS</small>
      <h2>{verdict.headline}</h2>
      <p>{verdict.detail}</p>
      {verdict.state === 'RENDERING' && (verdict.progress !== undefined ? <progress max={100} value={verdict.progress} aria-label="Render progress" /> : <progress aria-label="Render in progress" />)}
    </div>
    {timelineIssues.length > 0 && <div className="ve-blockers" role="alert"><b>Timeline / source mismatch</b>{timelineIssues.map((issue) => <span key={issue}>⚠ {issue}</span>)}<span>The backend validates this before rendering; this editor never bypasses it.</span></div>}
    {verdict.state === 'NOT_READY' && verdict.blockers.length > 0 && <div className="ve-blockers"><b>Render blockers</b>{verdict.blockers.map((blocker) => <span key={blocker}>⚠ {blocker}</span>)}</div>}
    <div className="ve-actions">
      {verdict.canRender && <button type="button" className="primary" disabled={busy} onClick={onExport}>Export Video</button>}
      {stages.render.status === 'completed' && stages.qa.status !== 'completed' && stages.qa.status !== 'running' && <button type="button" disabled={busy} onClick={onRunQa}>Run final QA</button>}
    </div>
    {!verdict.canRender && verdict.canRerender && <div className="ve-rerender">
      <b>Render again (approved plan unchanged)</b>
      <p className="ve-note">Archives the previous output, records a revision, and reuses the approved plan.</p>
      <input value={reason} placeholder="Reason, e.g. renderer fix" onChange={(event) => setReason(event.target.value)} aria-label="Re-render reason" />
      <button type="button" disabled={busy || !reason.trim()} onClick={() => onRerender(reason.trim())}>Re-render</button>
    </div>}
    {verdict.gates.length > 0 && <div className="ve-gates"><h4>Quality gates</h4><ul>{verdict.gates.map((gate) => <li key={gate.label} className={gate.ok ? 'ok' : 'fail'}>{gate.ok ? '✓' : '✕'} {gate.label}</li>)}</ul></div>}
    {verdict.failures.length > 0 && <div className="ve-failures"><h4>Failure details</h4>{verdict.failures.map((failure) => <p key={failure}>{failure}</p>)}</div>}
    {project.output && <div className="ve-output">
      <small>OUTPUT FILE</small>
      <code>{project.output.fileName} · {(project.output.sizeBytes / 1024 / 1024).toFixed(1)} MB · {project.output.width}×{project.output.height}</code>
      {verdict.state === 'QA_PASSED'
        ? <a className="ve-link" href={outputUrl} target="_blank" rel="noreferrer">Open output for human review</a>
        : <span className="ve-warning">This file is not a verified export (QA: {project.output.qaStatus}). Do not publish it.</span>}
    </div>}
    {history.length > 0 && <div className="ve-history"><h4>Render history</h4><ol>{history.map((entry) => <li key={entry.revision}><b>Revision {entry.revision}</b> · {entry.reason}<small>Previous render {entry.previousStages.render.status}, QA {entry.previousStages.qa.status}{entry.previousQaStatus ? ` (${entry.previousQaStatus})` : ''}{entry.archivedOutputPath ? ` · archived at ${entry.archivedOutputPath}` : ''}</small></li>)}</ol></div>}
  </div>;
};
