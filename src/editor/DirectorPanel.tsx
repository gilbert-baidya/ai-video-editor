import React from 'react';
import type { ReviewBeat, ReviewState } from '../director-review.ts';
import type { PipelineStep } from './editor-model.ts';
import { formatTimecode } from './editor-model.ts';

export interface DirectorPanelProps {
  steps: PipelineStep[];
  beats: ReviewBeat[];
  review: ReviewState;
  selectedBeatId?: string;
  blockers: string[];
  busy: boolean;
  onSelectBeat: (beat: ReviewBeat) => void;
  onRunAnalyze?: () => void;
  onRunPlan?: () => void;
  onOpenReview: () => void;
  onOpenExport: () => void;
}

const statusText: Record<PipelineStep['status'], string> = { 'not-started': 'Not started', running: 'Running', completed: 'Complete', blocked: 'Needs attention', failed: 'Failed' };

function stepAction(step: PipelineStep, props: DirectorPanelProps): { label: string; run: () => void; disabled?: boolean } | undefined {
  if (step.id === 'analyze' && step.status !== 'completed' && step.status !== 'running') return props.onRunAnalyze && { label: step.status === 'failed' ? 'Retry' : 'Run', run: props.onRunAnalyze, disabled: props.busy };
  if (step.id === 'plan' && step.status !== 'completed' && step.status !== 'running') return props.onRunPlan && { label: step.status === 'failed' ? 'Retry' : 'Generate', run: props.onRunPlan, disabled: props.busy };
  if (step.id === 'broll' && step.status === 'blocked') return { label: 'Resolve', run: props.onOpenReview };
  if (step.id === 'review' && step.status !== 'not-started') return { label: step.status === 'completed' ? 'Open' : 'Review', run: props.onOpenReview };
  if (step.id === 'export' && props.steps.find((item) => item.id === 'review')?.status === 'completed') return { label: 'Export', run: props.onOpenExport };
  return undefined;
}

export const DirectorPanel: React.FC<DirectorPanelProps> = (props) => {
  const { steps, beats, review, selectedBeatId, blockers, onSelectBeat } = props;
  const decisions = new Map(review.decisions.map((decision) => [decision.beatId, decision]));
  return <div className="ve-director">
    <ol className="ve-pipeline" aria-label="AI Director workflow">
      {steps.map((step, index) => {
        const action = stepAction(step, props);
        return <li key={step.id} className={`ve-step status-${step.status}`} data-step={step.id} data-status={step.status}>
          <span className="ve-step-index">{step.status === 'completed' ? '✓' : index + 1}</span>
          <div className="ve-step-body">
            <div className="ve-step-title"><b>{step.label}</b><span className="ve-chip">{statusText[step.status]}</span></div>
            <small>{step.detail}</small>
            {step.status === 'running' && step.progress !== undefined && <progress max={100} value={step.progress} aria-label={`${step.label} progress`} />}
            {step.error && <p className="ve-warning" role="alert">{step.error}</p>}
          </div>
          {action && <button type="button" disabled={action.disabled} onClick={action.run}>{action.label}</button>}
        </li>;
      })}
    </ol>
    {blockers.length > 0 && <div className="ve-blockers" role="status"><b>Review blockers</b>{blockers.slice(0, 6).map((blocker) => <span key={blocker}>⚠ {blocker}</span>)}{blockers.length > 6 && <span>+ {blockers.length - 6} more</span>}</div>}
    <h4 className="ve-subhead">Director recommendations</h4>
    <ul className="ve-recommendations">
      {beats.map((beat) => {
        const decision = decisions.get(beat.section.id);
        return <li key={beat.section.id}>
          <button type="button" className={beat.section.id === selectedBeatId ? 'selected' : ''} data-beat-id={beat.section.id} onClick={() => onSelectBeat(beat)}>
            <span className="ve-time">{formatTimecode(beat.section.start)}–{formatTimecode(beat.section.end)}</span>
            <b>{beat.section.visualRecommendation ?? 'speaker-full'}</b>
            <small>{beat.section.type}{beat.requiredReview ? '' : ' · no change'}</small>
            {decision && <span className={`ve-chip status-${decision.status}`}>{decision.status}</span>}
          </button>
        </li>;
      })}
      {!beats.length && <li className="ve-note">The Director produced no scenes.</li>}
    </ul>
  </div>;
};
