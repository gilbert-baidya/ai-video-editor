import React, { useEffect, useState } from 'react';
import { DirectorReviewWorkspace } from './DirectorReviewWorkspace.tsx';
import type { ProductCapabilities, ProductProjectRecord } from './product-api.ts';
import { productClient } from './product-client.ts';
import { AppShell, type Screen } from './editor/AppShell.tsx';
import { EditingWorkspace } from './editor/EditingWorkspace.tsx';
import { NewProjectScreen } from './editor/NewProjectScreen.tsx';
import { ProjectsDashboard } from './editor/ProjectsDashboard.tsx';
import { DirectorScreen, ExportScreen, MediaScreen, SettingsScreen } from './editor/ProjectScreens.tsx';
import { useEditorSession } from './editor/useEditorSession.ts';

const message = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

// Application host: project list, navigation and the single editing session for the selected project.
export const ProductHostWorkspace: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('projects');
  const [projects, setProjects] = useState<ProductProjectRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [capabilities, setCapabilities] = useState<ProductCapabilities>();
  const [projectId, setProjectId] = useState<string>();
  const [detailedReview, setDetailedReview] = useState<{ beatId?: string }>();
  const session = useEditorSession(projectId);

  async function refreshList(): Promise<void> {
    try {
      setProjects(await productClient.listProjects());
      setListError('');
    } catch (reason) {
      setListError(message(reason));
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    void refreshList();
    void productClient.capabilities().then(setCapabilities).catch((reason) => setListError(message(reason)));
  }, []);

  useEffect(() => { if (screen === 'projects') void refreshList(); }, [screen]);

  const open = (project: ProductProjectRecord, next: Screen = 'editor') => {
    setProjectId(project.workflow.projectId);
    setScreen(next);
  };
  const current = session.project;
  const navigate = (next: Screen) => { setDetailedReview(undefined); setScreen(next); };

  let content: React.ReactNode;
  if (detailedReview && session.workspace && session.review) {
    content = <div className="ve-legacy-review">
      <button type="button" className="ve-back" onClick={() => { setDetailedReview(undefined); void session.reload(); }}>← Back to Review & Edit</button>
      <DirectorReviewWorkspace data={session.workspace} initialBeatId={detailedReview.beatId} serverStateOnly onReviewStateChange={(review) => void session.saveReviewState(review)} />
    </div>;
  } else if (screen === 'projects') content = <ProjectsDashboard projects={projects} capabilities={capabilities} loading={listLoading} error={listError} onOpen={(project) => open(project)} onNew={() => navigate('new')} />;
  else if (screen === 'new') content = <NewProjectScreen capabilities={capabilities} onCreated={(created) => { void refreshList(); open(created, 'director'); }} />;
  else if (screen === 'editor') content = <EditingWorkspace session={session} onOpenReview={(beatId) => setDetailedReview({ beatId })} onGoExport={() => navigate('export')} onGoDirector={() => navigate('director')} />;
  else if (screen === 'director') content = <DirectorScreen session={session} onOpenReview={() => navigate('editor')} onOpenExport={() => navigate('export')} />;
  else if (screen === 'media') content = <MediaScreen session={session} />;
  else if (screen === 'export') content = <ExportScreen session={session} />;
  else content = <SettingsScreen capabilities={capabilities} session={session} />;

  return <AppShell screen={detailedReview ? 'editor' : screen} project={current} capabilities={capabilities} onNavigate={navigate}>{content}</AppShell>;
};
