import React from 'react';
import type { ProductCapabilities, ProductProjectRecord } from '../product-api.ts';
import { TopWorkflowBar, type WorkflowStep } from './TopWorkflowBar.tsx';
import { FilmIcon, HomeIcon, PlusCircleIcon, FolderIcon, DownloadIcon, SettingsIcon } from './Icons.tsx';

export type Screen = 'projects' | 'new' | 'director' | 'editor' | 'media' | 'export' | 'settings';

export interface AppShellProps {
  screen: Screen;
  project?: ProductProjectRecord;
  capabilities?: ProductCapabilities;
  onNavigate: (screen: Screen) => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ screen, project, capabilities, onNavigate, children }) => {
  let currentStep: WorkflowStep = 'source';
  if (screen === 'director' || screen === 'media') currentStep = 'analyze';
  if (screen === 'editor') currentStep = 'review';
  if (screen === 'export') currentStep = 'export';

  const isComplete = (step: WorkflowStep): boolean => {
    if (!project) return false;
    const shortStates = Object.values(project.workflow.shorts ?? {});
    const approvedShorts = shortStates.filter((item) => item.approvalStatus === 'approved');
    switch (step) {
      case 'source': return project.workflow.stages.ingest.status === 'completed';
      case 'analyze': return project.workflow.stages.director.status === 'completed';
      case 'review': return project.workflow.outputTarget === 'shorts' ? approvedShorts.length > 0 : project.workflow.stages.review.status === 'completed';
      case 'export': return project.workflow.outputTarget === 'shorts'
        ? approvedShorts.length > 0 && approvedShorts.every((item) => item.renderStatus === 'completed' && item.output?.qaStatus === 'PASS')
        : project.workflow.stages.render.status === 'completed';
      default: return false;
    }
  };

  const getStatusDisplay = () => {
    if (capabilities?.node.state === 'AVAILABLE') {
      return {
        dotColor: '#10B981',
        dotGlow: '0 0 8px rgba(16, 185, 129, 0.6)',
        title: 'Local AI Ready',
        sub: `Host: ${capabilities.node.detail.substring(0, 15)}...`
      };
    }
    return {
      dotColor: '#F59E0B',
      dotGlow: '0 0 8px rgba(245, 158, 11, 0.6)',
      title: 'Checking Local AI...',
      sub: 'Please wait'
    };
  };

  const status = getStatusDisplay();

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="app-sidebar">
        <div className="sidebar-header">
          <div className="brand-badge">
            <FilmIcon size={20} />
          </div>
          <div className="brand-info">
            <span className="brand-title">AI Video Editor</span>
            <span className="brand-version">Canonical Edition v2</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-category">Workspace</div>
          
          <button
            className={`nav-item ${screen === 'projects' ? 'active' : ''}`}
            onClick={() => onNavigate('projects')}
          >
            <HomeIcon size={18} />
            <span>Dashboard</span>
          </button>

          <button
            className={`nav-item ${screen === 'new' ? 'active' : ''}`}
            onClick={() => onNavigate('new')}
          >
            <PlusCircleIcon size={18} />
            <span>New Project</span>
          </button>

          <button
            className={`nav-item ${['director', 'editor', 'media'].includes(screen) ? 'active' : ''}`}
            onClick={() => project && onNavigate('editor')}
            disabled={!project}
            style={{ opacity: project ? 1 : 0.5 }}
          >
            <FolderIcon size={18} />
            <span>Active Project</span>
          </button>

          <div className="nav-category" style={{ marginTop: '12px' }}>Library & Output</div>

          <button
            className={`nav-item ${screen === 'export' ? 'active' : ''}`}
            onClick={() => project && onNavigate('export')}
            disabled={!project}
            style={{ opacity: project ? 1 : 0.5 }}
          >
            <DownloadIcon size={18} />
            <span>Exports</span>
          </button>

          <button
            className={`nav-item ${screen === 'settings' ? 'active' : ''}`}
            onClick={() => onNavigate('settings')}
          >
            <SettingsIcon size={18} />
            <span>Settings & Health</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div
            className="engine-status-pill"
            onClick={() => onNavigate('settings')}
            style={{ cursor: 'pointer' }}
            title="System Status"
          >
            <span
              className="status-dot"
              style={{
                backgroundColor: status.dotColor,
                boxShadow: status.dotGlow
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600, color: '#E2E8F0', fontSize: '11px' }}>
                {status.title}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                {status.sub}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="app-main" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <TopWorkflowBar
          currentStep={currentStep}
          activeProjectTitle={project?.workflow.title}
          isComplete={isComplete}
          onSelectStep={(step) => {
            if (!project) return;
            if (step === 'source') onNavigate('new');
            if (step === 'analyze') onNavigate('director');
            if (step === 'review') onNavigate('editor');
            if (step === 'export') onNavigate('export');
          }}
        />
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {children}
        </div>
      </main>
    </div>
  );
};
