import React from 'react';
import { CheckIcon, ChevronRightIcon } from './Icons.tsx';

export type WorkflowStep = 'source' | 'analyze' | 'review' | 'export';

interface TopWorkflowBarProps {
  currentStep: WorkflowStep;
  onSelectStep?: (step: WorkflowStep) => void;
  activeProjectTitle?: string;
  isComplete: (step: WorkflowStep) => boolean;
}

export const TopWorkflowBar: React.FC<TopWorkflowBarProps> = ({
  currentStep,
  onSelectStep,
  activeProjectTitle,
  isComplete
}) => {
  const steps: { key: WorkflowStep; label: string; stepNumber: number }[] = [
    { key: 'source', label: '1. Source', stepNumber: 1 },
    { key: 'analyze', label: '2. Analyze', stepNumber: 2 },
    { key: 'review', label: '3. Review', stepNumber: 3 },
    { key: 'export', label: '4. Export', stepNumber: 4 }
  ];

  const getStepStatus = (step: { key: WorkflowStep; stepNumber: number }, index: number) => {
    const isCompleted = isComplete(step.key);
    if (step.key === currentStep) return isCompleted ? 'completed active' : 'active';
    if (isCompleted) return 'completed';
    const currentIndex = steps.findIndex(s => s.key === currentStep);
    if (index < currentIndex) return 'completed';
    return 'upcoming';
  };

  return (
    <header className="top-workflow-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
          Workflow
        </span>
        {activeProjectTitle && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            • <strong style={{ color: '#E2E8F0', marginLeft: '4px' }}>{activeProjectTitle}</strong>
          </span>
        )}
      </div>

      <div className="workflow-steps-container">
        {steps.map((step, idx) => {
          const status = getStepStatus(step, idx);
          const complete = isComplete(step.key);
          return (
            <React.Fragment key={step.key}>
              <div
                className={`workflow-step ${status}`}
                onClick={() => onSelectStep && onSelectStep(step.key)}
                style={{ cursor: onSelectStep ? 'pointer' : 'default' }}
              >
                <div className="workflow-step-num">
                  {complete ? <CheckIcon size={12} /> : step.stepNumber}
                </div>
                <span>{step.label.replace(/^\d+\.\s*/, '')}</span>
              </div>
              {idx < steps.length - 1 && (
                <ChevronRightIcon size={14} className="workflow-divider" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
          Mode: Local AI Editor
        </span>
      </div>
    </header>
  );
};

