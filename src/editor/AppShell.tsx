import React, { useState } from 'react';
import type { ProductCapabilities, ProductProjectRecord } from '../product-api.ts';

export type Screen = 'projects' | 'new' | 'director' | 'editor' | 'media' | 'export' | 'settings';

interface NavItem { id: Screen; label: string; icon: string; needsProject: boolean }

export const navItems: NavItem[] = [
  { id: 'projects', label: 'Projects', icon: '▤', needsProject: false },
  { id: 'new', label: 'Import / New Project', icon: '＋', needsProject: false },
  { id: 'director', label: 'AI Director', icon: '✦', needsProject: true },
  { id: 'editor', label: 'Review & Edit', icon: '✂', needsProject: true },
  { id: 'media', label: 'Media Library', icon: '▣', needsProject: true },
  { id: 'export', label: 'Render / Export', icon: '⬇', needsProject: true },
  { id: 'settings', label: 'Settings', icon: '⚙', needsProject: false },
];

export interface AppShellProps {
  screen: Screen;
  project?: ProductProjectRecord;
  capabilities?: ProductCapabilities;
  onNavigate: (screen: Screen) => void;
  children: React.ReactNode;
}

export const RAIL_COLLAPSE_BELOW = 1500;

export const AppShell: React.FC<AppShellProps> = ({ screen, project, capabilities, onNavigate, children }) => {
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < RAIL_COLLAPSE_BELOW);
  return <div className={`ve-app ${collapsed ? 'rail-collapsed' : ''}`}>
  <nav className="ve-rail" aria-label="Primary">
    <button type="button" className="ve-brand" onClick={() => onNavigate('projects')}><span className="ve-logo">▶</span><span className="ve-nav-label"><b>AI VIDEO EDITOR</b><small>AI Sermon Director</small></span></button>
    <ul>
      {navItems.map((item) => {
        const disabled = item.needsProject && !project;
        return <li key={item.id}><button type="button" className={screen === item.id ? 'active' : ''} aria-current={screen === item.id ? 'page' : undefined} disabled={disabled} title={disabled ? 'Open a project first' : item.label} aria-label={item.label} data-nav={item.id} onClick={() => onNavigate(item.id)}><span className="ve-nav-icon" aria-hidden>{item.icon}</span><span className="ve-nav-label">{item.label}</span></button></li>;
      })}
    </ul>
    <div className="ve-rail-foot">
      <button type="button" className="ve-rail-toggle" aria-pressed={collapsed} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '»' : '« Collapse'}</button>
      {project && <div className="ve-rail-project"><small>CURRENT PROJECT</small><b title={project.workflow.title}>{project.workflow.title}</b><span>{project.workflow.status.replaceAll('_', ' ')}</span></div>}
      <div className="ve-rail-host"><span className={`ve-dot ${capabilities ? 'on' : ''}`} />Local host {capabilities ? capabilities.node.state.toLowerCase() : 'checking…'}</div>
    </div>
  </nav>
  <div className="ve-main">{children}</div>
</div>;
};
