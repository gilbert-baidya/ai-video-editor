import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyReviewAction, updateReview, type ReviewAction, type ReviewedWorkspaceData, type ReviewState } from '../director-review.ts';
import type { EditOperation } from '../contracts.ts';
import type { ReviewDataPayload } from '../DirectorReviewWorkspace.tsx';
import type { ProductJob, ProductProjectRecord } from '../product-api.ts';
import { productClient } from '../product-client.ts';
import type { ProductStage } from '../product-workflow.ts';
import { loadEditingProject, sameDecisions, type EditorClient } from './editor-model.ts';

export type SessionPhase = 'loading' | 'ready' | 'no-plan' | 'error';
export type ImportInput = Parameters<typeof productClient.importAsset>[1];

export interface EditorSession {
  phase: SessionPhase;
  project?: ProductProjectRecord;
  workspace?: ReviewDataPayload;
  review?: ReviewState;
  resolved?: ReviewedWorkspaceData;
  message?: string;
  saving: boolean;
  busy: boolean;
  actionError: string;
  reload: () => Promise<void>;
  saveReviewState: (next: ReviewState) => Promise<void>;
  act: (beatId: string, action: ReviewAction, options?: { operation?: EditOperation; displayText?: string; reason?: string }) => Promise<void>;
  runStage: (stage: ProductStage, payload?: any) => Promise<void>;
  rerender: (reason: string) => Promise<void>;
  reviewShort: (shortId: string, approved: boolean) => Promise<void>;
  importAsset: (input: ImportInput) => Promise<void>;
  clearError: () => void;
}

const message = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const finished = (job: ProductJob): boolean => ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status);

type Client = EditorClient & Pick<typeof productClient, 'startStage' | 'saveReview' | 'rerender' | 'reviewShort' | 'importAsset'>;

// Single owner of one project's loaded data, human review state and backend actions. Views stay presentational.
export function useEditorSession(projectId: string | undefined, client: Client = productClient): EditorSession {
  const [phase, setPhase] = useState<SessionPhase>('loading');
  const [project, setProject] = useState<ProductProjectRecord>();
  const [workspace, setWorkspace] = useState<ReviewDataPayload>();
  const [review, setReview] = useState<ReviewState>();
  const [text, setText] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const chain = useRef(Promise.resolve());

  const reload = useCallback(async () => {
    if (!projectId) return;
    const result = await loadEditingProject(client, projectId);
    if (result.kind === 'ready') {
      setProject(result.project);
      setWorkspace(result.workspace);
      setReview(result.workspace.initialReview);
      setPhase('ready');
      setText(undefined);
    } else {
      setProject(result.project);
      setWorkspace(undefined);
      setReview(undefined);
      setPhase(result.kind);
      setText(result.kind === 'no-plan' ? result.reason : result.message);
    }
  }, [client, projectId]);

  useEffect(() => {
    setPhase('loading');
    setActionError('');
    void reload();
  }, [reload]);

  const resolved = useMemo(() => workspace && review
    ? updateReview(workspace, review, project?.sourceDurationValidation?.physicalDurationSeconds)
    : undefined, [project?.sourceDurationValidation?.physicalDurationSeconds, workspace, review]);

  const persist = useCallback(async (next: ReviewState, previous: ReviewState) => {
    if (!projectId) return;
    setReview(next);
    setSaving(true);
    setActionError('');
    chain.current = chain.current.then(async () => {
      try {
        setProject(await client.saveReview(projectId, next));
      } catch (reason) {
        setReview(previous);
        setActionError(message(reason));
      } finally {
        setSaving(false);
      }
    });
    await chain.current;
  }, [client, projectId]);

  const act = useCallback<EditorSession['act']>(async (beatId, action, options) => {
    if (!review) return;
    let next: ReviewState;
    try {
      next = applyReviewAction(review, beatId, action, options);
    } catch (reason) {
      setActionError(message(reason));
      return;
    }
    await persist(next, review);
  }, [persist, review]);

  // Used by the detailed Review screen. Identical decisions are never re-saved, so merely opening a
  // finished project cannot reopen its render.
  const saveReviewState = useCallback<EditorSession['saveReviewState']>(async (next) => {
    if (!review || sameDecisions(review, next)) return;
    await persist(next, review);
  }, [persist, review]);

  const track = useCallback(async (job: ProductJob) => {
    if (!projectId) return;
    for (;;) {
      await new Promise((done) => setTimeout(done, 700));
      const current = await client.getProject(projectId);
      setProject(current);
      const latest = current.jobs.find((item) => item.jobId === job.jobId);
      if (!latest || finished(latest)) {
        if (latest?.status === 'failed') setActionError(latest.error ?? 'The job failed.');
        break;
      }
    }
  }, [client, projectId]);

  const guarded = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setActionError('');
    try {
      await work();
    } catch (reason) {
      setActionError(message(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  const runStage = useCallback<EditorSession['runStage']>((stage, payload) => guarded(async () => {
    if (!projectId) return;
    await track(await client.startStage(projectId, stage, payload));
    await reload();
  }), [client, guarded, projectId, reload, track]);

  const rerender = useCallback<EditorSession['rerender']>((reason) => guarded(async () => {
    if (!projectId) return;
    await track(await client.rerender(projectId, reason));
    await reload();
  }), [client, guarded, projectId, reload, track]);

  const reviewShort = useCallback<EditorSession['reviewShort']>((shortId, approved) => guarded(async () => {
    if (!projectId) return;
    setProject(await client.reviewShort(projectId, shortId, approved));
    await reload();
  }), [client, guarded, projectId, reload]);

  const importAsset = useCallback<EditorSession['importAsset']>((input) => guarded(async () => {
    if (!projectId) return;
    await client.importAsset(projectId, input);
    await reload();
  }), [client, guarded, projectId, reload]);

  return { phase, project, workspace, review, resolved, message: text, saving, busy, actionError, reload, saveReviewState, act, runStage, rerender, reviewShort, importAsset, clearError: () => setActionError('') };
}
