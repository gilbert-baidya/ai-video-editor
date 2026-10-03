import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EditOperation } from '../src/contracts.ts';
import { DirectorReviewWorkspace } from '../src/DirectorReviewWorkspace.tsx';
import { applyReviewAction, updateReview } from '../src/director-review.ts';
import { parseProjectApiRoute } from '../src/product-http.ts';
import { AppShell, navItems } from '../src/editor/AppShell.tsx';
import { DirectorPanel } from '../src/editor/DirectorPanel.tsx';
import { EditingWorkspaceView, noHandlers, type WorkspaceViewProps } from '../src/editor/EditingWorkspace.tsx';
import { ExportPanel } from '../src/editor/ExportPanel.tsx';
import { OperationInspector } from '../src/editor/OperationInspector.tsx';
import { Splitter } from '../src/editor/Splitter.tsx';
import { Timeline, TRACK_LABEL_WIDTH, rulerTicks } from '../src/editor/Timeline.tsx';
import { LAYOUT_LIMITS, buildPipeline, clampLayout, defaultLayout, rulerScale, buildTimeline, clampTime, computeBrollStatus, describeOperation, exportStatus, findClip, formatTimecode, loadEditingProject, operationById, previewFrameAt, reconcileTimeline, sameDecisions, timeToX, xToTime, beatForOperation } from '../src/editor/editor-model.ts';
import type { EditorSession } from '../src/editor/useEditorSession.ts';
import { computePeaks } from '../src/editor/waveform.ts';
import { PROJECT_ID, approvedPlan, approvedReview, asset, buildWorkspace, projectRecord } from './editor-fixtures.ts';

const { workspace } = buildWorkspace();
const review = approvedReview(workspace);
const plan = approvedPlan(workspace, review);
const assetUrl = (id: string) => `/api/projects/${PROJECT_ID}/asset?assetId=${id}`;

// ── Project loading ──────────────────────────────────────────────
const client = (overrides: Partial<Parameters<typeof loadEditingProject>[0]> = {}) => ({ getProject: async () => projectRecord(), reviewWorkspace: async () => workspace, ...overrides });
const ready = await loadEditingProject(client(), PROJECT_ID);
assert.equal(ready.kind, 'ready');
assert.equal(ready.kind === 'ready' && ready.workspace.projectId, PROJECT_ID, 'workspace data comes from the backend payload');
const noPlan = await loadEditingProject(client({ getProject: async () => projectRecord({ stages: { ingest: { status: 'completed' } } }) }), PROJECT_ID);
assert.equal(noPlan.kind, 'no-plan');
assert.match(noPlan.kind === 'no-plan' ? noPlan.reason : '', /Director plan is not-started/);
const noSource = await loadEditingProject(client({ getProject: async () => projectRecord({ stages: {}, noSource: true }) }), PROJECT_ID);
assert.match(noSource.kind === 'no-plan' ? noSource.reason : '', /No source video/);
const failedDirector = await loadEditingProject(client({ getProject: async () => projectRecord({ stages: { director: { status: 'failed', error: 'provider quota exceeded' } } }) }), PROJECT_ID);
assert.match(failedDirector.kind === 'no-plan' ? failedDirector.reason : '', /provider quota exceeded/, 'backend failure text is shown, not hidden');
const lost = await loadEditingProject(client({ getProject: async () => { throw new Error('Project not found: x'); } }), 'x');
assert.deepEqual(lost, { kind: 'error', message: 'Project not found: x' });
const brokenWorkspace = await loadEditingProject(client({ reviewWorkspace: async () => { throw new Error('Director workspace is unavailable.'); } }), PROJECT_ID);
assert.equal(brokenWorkspace.kind, 'error');
assert.ok(brokenWorkspace.kind === 'error' && brokenWorkspace.project, 'the project stays available when only the workspace fails');

// ── Timeline reflects the real Edit Plan ─────────────────────────
assert.deepEqual(plan.operations.map((o) => o.id), ['broll-section-1', 'caption-1', 'broll-section-2', 'policy-section-3'], 'approved plan after Review replacement');
const model = buildTimeline({ plan, assets: [asset], durationSeconds: 72, sourceDurationSeconds: 72, review });
assert.deepEqual(model.tracks.map((t) => t.id), ['broll', 'captions', 'framing', 'video', 'audio']);
const byId = (id: string) => model.tracks.flatMap((t) => t.clips).find((c) => c.operationId === id)!;
assert.deepEqual([byId('broll-section-1').start, byId('broll-section-1').end], [0, 10]);
assert.deepEqual([byId('broll-section-2').start, byId('broll-section-2').end], [26.5, 34.5], 'sub-window is not expanded');
assert.equal(byId('broll-section-2').track, 'broll');
assert.equal(byId('broll-section-2').kind, 'broll-image');
assert.equal(byId('broll-section-2').label, 'illustration.jpg');
assert.equal(byId('caption-1').track, 'captions');
assert.equal(byId('caption-1').label, 'Fixture caption');
assert.equal(byId('policy-section-3').track, 'framing');
assert.equal(byId('policy-section-3').label, 'Punch-in');
const operationClips = model.tracks.flatMap((t) => t.clips).filter((c) => c.operationId);
assert.equal(operationClips.length, plan.operations.length, 'every plan operation appears exactly once and nothing decorative is added');
assert.ok(operationClips.every((clip) => plan.operations.some((o) => o.id === clip.operationId)));
assert.equal(model.tracks.find((t) => t.id === 'video')!.clips.length, 1);
assert.equal(model.tracks.find((t) => t.id === 'audio')!.clips[0].sublabel, 'Original · continuous');
assert.equal(byId('broll-section-1').status, 'modified', 'review status flows to the clip');
assert.equal(byId('policy-section-3').status, 'accepted');
const aiModel = buildTimeline({ plan: workspace.aiPlan, assets: [], durationSeconds: 72, review: workspace.initialReview });
assert.equal(aiModel.tracks[0].clips.every((c) => c.kind === 'broll-unresolved' && c.status === 'pending'), true, 'unresolved recommendations are marked, not shown as media');

// Source shorter than the approved timeline is shown honestly.
const short = buildTimeline({ plan, assets: [asset], durationSeconds: 72, sourceDurationSeconds: 60, review });
const noFootage = short.tracks.find((t) => t.id === 'video')!.clips.find((c) => c.kind === 'no-source')!;
assert.deepEqual([noFootage.start, noFootage.end], [60, 72]);
assert.equal(short.tracks.find((t) => t.id === 'audio')!.clips.some((c) => c.kind === 'no-source'), true);
assert.equal(short.tracks.find((t) => t.id === 'video')!.clips[0].end, 60);
assert.equal(reconcileTimeline({ planDurationSeconds: 72, sourceMetadataSeconds: 72, measuredSourceSeconds: 72 }).length, 0);
const mismatch = reconcileTimeline({ planDurationSeconds: 72, sourceMetadataSeconds: 72, measuredSourceSeconds: 60 });
assert.ok(mismatch.some((m) => m.includes('60.0 s') && m.includes('does not exist')));
assert.ok(mismatch.some((m) => m.includes('disagrees with the playable source')));

// ── Preview/timeline synchronisation ─────────────────────────────
const at = (seconds: number) => previewFrameAt(plan, [asset], seconds);
assert.equal(at(5).pastorVisible, false, '5 s: full-frame B-roll');
assert.equal(at(5).broll?.layout, 'FULL_FRAME_MEDIA');
assert.equal(at(5).broll?.asset.id, asset.id);
assert.equal(at(30).pastorVisible, false, '30 s: full-frame B-roll');
assert.equal(at(45).pastorVisible, true, '45 s: Pastor');
assert.equal(at(45).broll, undefined);
assert.equal(at(45).speakerPosition, 'center');
assert.equal(at(60).speakerPosition, 'punch-in', '60 s: punch-in');
assert.equal(at(60).pastorVisible, true);
assert.equal(at(26.49).pastorVisible, true);
assert.equal(at(26.5).pastorVisible, false, 'B-roll starts exactly at its approved window');
assert.equal(at(34.5).pastorVisible, true, 'and ends exactly at its approved end');
assert.equal(at(14).caption?.text, 'Fixture caption', 'approved caption content is shown in the preview');
assert.equal(at(25).caption, undefined);
assert.equal(clampTime(80, 72), 72);
assert.equal(clampTime(-3, 72), 0);
assert.equal(clampTime(Number.NaN, 72), 0);
assert.equal(formatTimecode(26.5), '00:26.5');
assert.equal(formatTimecode(65.04), '01:05.0');
assert.equal(xToTime(timeToX(26.5, 12), 12, 72), 26.5, 'x↔time round-trips');
assert.equal(xToTime(5000, 12, 72), 72, 'scrubbing beyond the end clamps');

// ── Timeline rendering: positions, playhead, selection ───────────
const timelineProps = { model, time: 30, playing: false, pixelsPerSecond: 12, onZoom: () => undefined, onSelectClip: () => undefined, onSeek: () => undefined, assetUrl };
const html = renderToStaticMarkup(<Timeline {...timelineProps} selectedClipId="clip-broll-section-2" />);
const clipStyle = (operationId: string) => html.match(new RegExp(`style="left:([\\d.]+)(?:px)?;width:([\\d.]+)(?:px)?"[^>]*data-operation-id="${operationId}"`));
const sub = clipStyle('broll-section-2');
assert.ok(sub, 'B-roll clip is rendered with its operation id');
assert.equal(Number(sub[1]), 26.5 * 12, 'B-roll left edge = start × zoom');
assert.equal(Number(sub[2]), 8 * 12, 'B-roll width = duration × zoom');
assert.equal(Number(clipStyle('broll-section-1')![1]), 0);
assert.match(html, /data-operation-id="broll-section-2"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-operation-id="broll-section-2"/, 'selection is reflected');
assert.match(html, /class="[^"]*selected[^"]*"[^>]*data-clip-id="clip-broll-section-2"|data-clip-id="clip-broll-section-2"[^>]*class="[^"]*selected/);
assert.match(html, new RegExp(`class="ve-playhead" data-time="30" style="left:${TRACK_LABEL_WIDTH + 30 * 12}px"`), 'playhead sits at time × zoom');
assert.equal((renderToStaticMarkup(<Timeline {...timelineProps} time={45} />).match(/class="ve-playhead" data-time="45" style="left:(\d+)px"/) ?? [])[1], String(TRACK_LABEL_WIDTH + 45 * 12), 'playhead follows the preview time');
assert.ok(html.includes('data-track="broll"') && html.includes('data-track="captions"') && html.includes('data-track="video"') && html.includes('data-track="audio"'));
assert.doesNotMatch(html, /data-operation-id="clip-source"/, 'the source clip is not a selectable operation');
assert.equal(findClip(model, 'clip-caption-1')?.label, 'Fixture caption');

// ── Inspector shows real metadata and connected actions ──────────
const brollOp = operationById(plan, 'broll-section-2')!;
const beat = beatForOperation(brollOp, workspace.beats)!;
assert.equal(beat.section.id, 'section-2');
const details = describeOperation(brollOp, [asset], beat);
const row = (key: string) => details.rows.find(([k]) => k === key)?.[1];
assert.match(row('Window')!, /26\.50 s → 34\.50 s \(8\.00 s\)/);
assert.match(row('B-roll audio')!, /Muted — sermon audio continues/);
assert.equal(row('Layout'), 'full-screen');
assert.equal(row('Asset'), 'illustration.jpg');
assert.match(row('Rights')!, /approved · owned/);
assert.match(row('Sermon-source range')!, /26\.50 s → 34\.50 s/);
const decision = review.decisions.find((d) => d.beatId === 'section-2');
const acts: Array<[string, string]> = [];
const inspector = renderToStaticMarkup(<OperationInspector clip={findClip(model, 'clip-broll-section-2')} operation={brollOp} assets={[asset]} beat={beat} decision={decision} assetUrl={assetUrl} saving={false} onPreview={() => undefined} onOpenReview={(id) => acts.push(['review', id ?? ''])} onAct={(id, action) => acts.push([id, action])} />);
assert.match(inspector, /data-operation-id="broll-section-2"/);
assert.match(inspector, /Replace media/);
assert.match(inspector, /Keep Pastor — static/);
assert.match(inspector, /Open in Review/);
assert.match(inspector, /Preview operation/);
const unlinked = renderToStaticMarkup(<OperationInspector clip={findClip(model, 'clip-caption-1')} operation={operationById(plan, 'caption-1')} assets={[asset]} assetUrl={assetUrl} saving={false} onPreview={() => undefined} onOpenReview={() => undefined} onAct={() => undefined} />);
assert.match(unlinked, /Fixture caption/);
assert.match(unlinked, /not linked to a reviewable scene/);
assert.doesNotMatch(unlinked, /Keep Pastor/, 'no editing control is advertised for an operation that cannot be edited');
assert.match(renderToStaticMarkup(<OperationInspector clip={undefined} assets={[]} assetUrl={assetUrl} saving={false} onPreview={() => undefined} onOpenReview={() => undefined} onAct={() => undefined} />), /Nothing selected/);
const placeholderOp = workspace.aiPlan.operations[0];
const placeholderHtml = renderToStaticMarkup(<OperationInspector clip={findClip(aiModel, 'clip-policy-section-1')} operation={placeholderOp} assets={[]} beat={workspace.beats[0]} decision={workspace.initialReview.decisions[0]} assetUrl={assetUrl} saving={false} onPreview={() => undefined} onOpenReview={() => undefined} onAct={() => undefined} />);
assert.match(placeholderHtml, /Unresolved B-roll/);
assert.match(placeholderHtml, /No approved asset is attached/);
assert.match(placeholderHtml, />Approve</, 'a pending decision can be approved');

// ── Review navigation ────────────────────────────────────────────
const reviewHtml = renderToStaticMarkup(<DirectorReviewWorkspace data={workspace} initialBeatId="section-2" serverStateOnly />);
const reviewDefault = renderToStaticMarkup(<DirectorReviewWorkspace data={workspace} serverStateOnly />);
assert.notEqual(reviewHtml, reviewDefault, 'initialBeatId changes the selected scene');
const selectedCards = (markup: string) => [...new Set([...markup.matchAll(/<article class="decision-card selected[^"]*"[^>]*>.*?<span class="time-code">([^<]+)</gu)].map((m) => m[1]))];
assert.deepEqual(selectedCards(reviewHtml), ['0:10—0:51'], 'section-2 is the selected card');
assert.deepEqual(selectedCards(reviewDefault), ['0:51—1:12'], 'without initialBeatId the legacy default (section-3) is selected');

// ── Session fixtures for views ───────────────────────────────────
const session = (overrides: Partial<EditorSession>): EditorSession => ({
  phase: 'ready', project: projectRecord(), workspace, review, resolved: updateReview(workspace, review), saving: false, busy: false, actionError: '',
  reload: async () => undefined, saveReviewState: async () => undefined, act: async () => undefined, runStage: async () => undefined, rerender: async () => undefined, importAsset: async () => undefined, clearError: () => undefined, ...overrides,
});
const view = (overrides: Partial<WorkspaceViewProps> & { session?: EditorSession } = {}) => renderToStaticMarkup(<EditingWorkspaceView session={overrides.session ?? session({})} time={30} seekToken={0} playing={false} pixelsPerSecond={12} rightTab="director" layout={{ left: 240, right: 340, timeline: 300 }} viewport={{ width: 1440, height: 900 }} onLayout={() => undefined} onLayoutReset={() => undefined} handlers={noHandlers} {...overrides} />);

const full = view();
assert.match(full, /data-state="ready"/);
assert.match(full, /data-project-id="project-editor-fixture"/);
assert.match(full, /Fixture sermon/);
assert.match(full, /src="\/api\/projects\/project-editor-fixture\/source"/, 'the preview plays the project\'s own source');
assert.match(full, /data-layout="FULL_FRAME_MEDIA"/, 'full-frame B-roll is shown at 30 s');
assert.match(full, new RegExp(`src="/api/projects/${PROJECT_ID}/asset\\?assetId=media-fixture"`), 'B-roll preview uses the real asset URL');
assert.match(full, /data-pastor-visible="false"/);
assert.match(full, /Export Video/);
assert.match(full, /READY FOR FINAL RENDER/);
assert.match(full, /AI Director workflow/);
assert.doesNotMatch(full, /Ollama/i, 'no Ollama-dependent UI');
assert.doesNotMatch(view({ time: 45 }), /data-layout=/, 'no B-roll layer at 45 s');
assert.match(view({ time: 45 }), /data-pastor-visible="true"/);
assert.match(view({ time: 4 }), /Source footage ends|data-layout="FULL_FRAME_MEDIA"/);
const shortSource = view({ measuredSourceSeconds: 60, time: 65 });
assert.match(shortSource, /Source footage ends at 01:00\.0/, 'footage past the end of the source is reported, not faked');
assert.match(shortSource, /Timeline \/ source mismatch/);
assert.match(shortSource, /No source footage/);
assert.match(view({ rightTab: 'inspect', selectedClipId: 'clip-broll-section-2' }), /data-inspector="broll"/);
assert.match(view({ session: session({ project: { ...projectRecord(), workflow: { ...projectRecord().workflow, stages: { ...projectRecord().workflow.stages, render: { status: 'completed', progress: 100 } } } } }) }), /already been rendered/);

// Empty, loading and failed states
assert.match(view({ session: session({ phase: 'loading', resolved: undefined, workspace: undefined, review: undefined }) }), /data-state="loading"/);
const failed = view({ session: session({ phase: 'error', message: 'Director workspace is unavailable.', resolved: undefined, workspace: undefined, review: undefined }) });
assert.match(failed, /data-state="error"/);
assert.match(failed, /Director workspace is unavailable\./);
assert.match(failed, /Try again/);
const empty = view({ session: session({ phase: 'no-plan', message: 'No source video has been uploaded yet.', project: projectRecord({ stages: {}, noSource: true }), resolved: undefined, workspace: undefined, review: undefined }) });
assert.match(empty, /data-state="no-plan"/);
assert.match(empty, /No source video has been uploaded yet\./);
assert.match(empty, /Open AI Director/);
assert.match(view({ session: session({ actionError: 'Save failed: disk full' }) }), /Save failed: disk full/);
const noSourceView = view({ session: session({ project: projectRecord({ noSource: true }) }) });
assert.match(noSourceView, /No source video is attached to this project\./);

// ── Director pipeline reflects backend state ─────────────────────
const brollStatus = computeBrollStatus(plan, workspace.beats, review);
assert.deepEqual(brollStatus, { total: 2, resolved: 2, unresolved: 0 });
assert.deepEqual(computeBrollStatus(workspace.aiPlan, workspace.beats, workspace.initialReview), { total: 2, resolved: 0, unresolved: 2 });
const keepPastor = applyReviewAction(workspace.initialReview, 'section-1', 'keep-pastor');
assert.equal(computeBrollStatus(updateReview(workspace, keepPastor).approvedPlan, workspace.beats, keepPastor).resolved, 1, 'a deliberate Keep Pastor counts as resolved');
const steps = buildPipeline(projectRecord(), brollStatus);
assert.deepEqual(steps.map((s) => s.label), ['Analyze Sermon', 'Generate Plan', 'Match B-roll', 'Review & Edit', 'Render & Export']);
assert.deepEqual(steps.map((s) => s.status), ['completed', 'completed', 'completed', 'completed', 'not-started']);
assert.ok(steps.every((s) => s.progress === undefined), 'no progress percentage is shown for stages that are not running');
const running = buildPipeline(projectRecord({ stages: { ingest: { status: 'completed' }, transcript: { status: 'running', progress: 37 } } }));
assert.equal(running[0].status, 'running');
assert.equal(running[0].progress, 37, 'progress comes from the backend while running');
assert.equal(running[1].status, 'not-started');
const failedStep = buildPipeline(projectRecord({ stages: { ingest: { status: 'completed' }, transcript: { status: 'completed' }, director: { status: 'failed', error: 'quota' } } }));
assert.equal(failedStep[1].status, 'failed');
assert.equal(failedStep[1].error, 'quota');
assert.equal(buildPipeline(projectRecord(), { total: 2, resolved: 1, unresolved: 1 })[2].status, 'blocked');
const panel = renderToStaticMarkup(<DirectorPanel steps={steps} beats={workspace.beats} review={review} blockers={['section-2: example blocker']} busy={false} onSelectBeat={() => undefined} onOpenReview={() => undefined} onOpenExport={() => undefined} />);
assert.match(panel, /data-step="analyze" data-status="completed"/);
assert.match(panel, /data-beat-id="section-2"/);
assert.match(panel, /section-2: example blocker/);
assert.doesNotMatch(panel, /<progress/, 'no fabricated progress bars');

// ── Export status never equates a file with success ──────────────
const qaOk = { video: true, audio: true, directorCoverage: true, brollRights: true, placement: true, bengaliGraphics: true, reviewReadiness: true, editorialQuality: true, mediaIntegrity: true };
const out = (qaStatus: 'PASS' | 'FAIL') => ({ fileName: 'final-sermon.mp4', relativePath: 'output/final-sermon.mp4', durationSeconds: 72, width: 1080, height: 1920, sizeBytes: 5_000_000, qaStatus });
const withStages = (stages: NonNullable<Parameters<typeof projectRecord>[0]>['stages'], extra: Partial<ReturnType<typeof projectRecord>> = {}) => ({ ...projectRecord({ stages: { ingest: { status: 'completed' }, transcript: { status: 'completed' }, director: { status: 'completed' }, review: { status: 'completed' }, ...stages } }), ...extra });
assert.equal(exportStatus(withStages({})).state, 'READY');
assert.equal(exportStatus(withStages({})).canRender, true);
assert.equal(exportStatus(projectRecord({ stages: { ingest: { status: 'completed' } } })).state, 'NOT_READY');
assert.ok(exportStatus(projectRecord({ stages: { ingest: { status: 'completed' } } })).blockers.length > 0);
const renderingProject = { ...withStages({ render: { status: 'running', progress: 40 } }), jobs: [{ jobId: 'job-1', projectId: PROJECT_ID, stage: 'render' as const, status: 'running' as const, progress: 40, message: 'Rendering frames', startedAt: '', updatedAt: '', cancelRequested: false }] };
assert.equal(exportStatus(renderingProject).state, 'RENDERING');
assert.equal(exportStatus(renderingProject).progress, 40);
const failedRender = exportStatus(withStages({ render: { status: 'failed', error: 'Source duration must be known before rendering.' } }));
assert.equal(failedRender.state, 'FAILED');
assert.match(failedRender.detail, /Source duration must be known/, 'legitimate backend errors are shown verbatim');
assert.ok(failedRender.failures.includes('Source duration must be known before rendering.'));
const fileOnly = exportStatus(withStages({ render: { status: 'completed' } }, { output: out('PASS') }));
assert.equal(fileOnly.state, 'AWAITING_QA', 'an MP4 without QA is not a successful export');
assert.notEqual(fileOnly.state, 'QA_PASSED');
const qaFailedGate = exportStatus(withStages({ render: { status: 'completed' }, qa: { status: 'completed' } }, { output: out('PASS'), qa: { ...qaOk, audio: false } }));
assert.equal(qaFailedGate.state, 'QA_FAILED', 'a failing gate beats a PASS label');
assert.deepEqual(qaFailedGate.gates.filter((g) => !g.ok).map((g) => g.label), ['Sermon audio']);
const qaFailedStage = exportStatus(withStages({ render: { status: 'completed' }, qa: { status: 'failed', error: 'One or more required final QA gates failed.' } }, { output: out('FAIL'), qa: { ...qaOk, editorialQuality: false, editorial: { passed: false, failures: ['Edit activity: static'] } as never, audioContinuity: { verified: true, failures: ['broll-section-1: sermon audio drops out during B-roll.'] } } }));
assert.equal(qaFailedStage.state, 'QA_FAILED');
assert.ok(qaFailedStage.failures.includes('Edit activity: static'));
assert.ok(qaFailedStage.failures.some((f) => f.includes('drops out during B-roll')), 'audio continuity failures are surfaced');
const passed = exportStatus(withStages({ render: { status: 'completed' }, qa: { status: 'completed' } }, { output: out('PASS'), qa: qaOk }));
assert.equal(passed.state, 'QA_PASSED');
assert.match(passed.detail, /Human review of the exported video is still required/);
const passedNoRecord = exportStatus(withStages({ render: { status: 'completed' }, qa: { status: 'completed' } }, { output: out('PASS') }));
assert.notEqual(passedNoRecord.state, 'QA_PASSED', 'PASS without the QA record is not trusted');
const panelHtml = (project: ReturnType<typeof projectRecord>, issues: string[] = []) => renderToStaticMarkup(<ExportPanel project={project} timelineIssues={issues} busy={false} outputUrl="/out" onExport={() => undefined} onRerender={() => undefined} onRunQa={() => undefined} />);
const readyHtml = panelHtml(withStages({}));
assert.match(readyHtml, /data-export-state="READY"/);
assert.match(readyHtml, /Export Video/);
const failedHtml = panelHtml(withStages({ render: { status: 'completed' }, qa: { status: 'completed' } }, { output: out('PASS'), qa: { ...qaOk, mediaIntegrity: false } }));
assert.match(failedHtml, /QA failed — not a valid export/);
assert.match(failedHtml, /not a verified export/);
assert.doesNotMatch(failedHtml, /href="\/out"/, 'no link to open an unverified file as if it were good');
const passedHtml = panelHtml(withStages({ render: { status: 'completed' }, qa: { status: 'completed' } }, { output: out('PASS'), qa: qaOk }));
assert.match(passedHtml, /href="\/out"/);
assert.match(passedHtml, /Open output for human review/);
const mismatchHtml = panelHtml(withStages({}), reconcileTimeline({ planDurationSeconds: 72, sourceMetadataSeconds: 60 }));
assert.match(mismatchHtml, /Timeline \/ source mismatch/);
assert.match(mismatchHtml, /never bypasses it/);
const completedProject = withStages({ render: { status: 'completed' }, qa: { status: 'completed' } }, { output: out('PASS'), qa: qaOk });
completedProject.workflow = { ...completedProject.workflow, status: 'COMPLETED' };
assert.match(panelHtml(completedProject), /Render again \(approved plan unchanged\)/, 're-render is offered through the supported safe path');
assert.equal(exportStatus({ ...completedProject, workflow: { ...completedProject.workflow, renderRevisions: [] } }).canRerender, true);

// ── Shell, routing, helpers ──────────────────────────────────────
assert.deepEqual(navItems.map((n) => n.label), ['Projects', 'Import / New Project', 'AI Director', 'Review & Edit', 'Media Library', 'Render / Export', 'Settings']);
const shellEmpty = renderToStaticMarkup(<AppShell screen="projects" onNavigate={() => undefined}><i /></AppShell>);
assert.match(shellEmpty, /data-nav="editor"[^>]*disabled|disabled=""[^>]*data-nav="editor"/, 'project-scoped navigation is disabled without a project');
const shellProject = renderToStaticMarkup(<AppShell screen="editor" project={projectRecord()} onNavigate={() => undefined}><i /></AppShell>);
assert.doesNotMatch(shellProject, /data-nav="editor"[^>]*disabled/);
assert.match(shellProject, /aria-current="page"/);
assert.deepEqual(parseProjectApiRoute('/api/projects/project-abc/asset'), { projectId: 'project-abc', action: 'asset' });
assert.equal(sameDecisions(review, { ...review, updatedAt: 'later' }), true, 'timestamp-only differences are not changes');
assert.equal(sameDecisions(review, workspace.initialReview), false);
assert.deepEqual(computePeaks(new Float32Array([0, 0.5, -1, 0.25]), 2), [0.5, 1]);
assert.deepEqual(computePeaks(new Float32Array(0), 4), []);
const unchangedOps: EditOperation[] = plan.operations;
assert.equal(unchangedOps.length, 4);

// ── Adaptive layout, splitters and timeline readability ──────────
for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080], [3440, 1440]] as const) {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const layout = defaultLayout({ width, height }, orientation);
    assert.deepEqual(layout, clampLayout(layout, { width, height }), `${width}×${height} ${orientation}: defaults are already valid`);
    assert.ok(layout.timeline >= LAYOUT_LIMITS.timeline.min && layout.timeline <= height * LAYOUT_LIMITS.timeline.maxShare);
    const centre = width - (width < 1500 ? 64 : 232) - layout.left - layout.right - 24;
    assert.ok(centre >= (width <= 1280 ? 500 : orientation === 'portrait' ? 650 : 800), `${width}×${height}: the editing area keeps ${centre}px`);
    assert.ok(height - 56 - layout.timeline - 120 >= 330 || height <= 720, `${width}×${height}: preview keeps usable height`);
  }
}
assert.ok(defaultLayout({ width: 1440, height: 900 }, 'portrait').timeline < defaultLayout({ width: 1440, height: 900 }, 'landscape').timeline, 'portrait gives the preview more height');
assert.deepEqual(clampLayout({ left: 5000, right: 10, timeline: 5000 }, { width: 1440, height: 900 }), { left: 432, right: 300, timeline: 594 }, 'stored sizes are clamped to the window');
const ultra = defaultLayout({ width: 3440, height: 1440 }, 'landscape');
assert.ok(ultra.left <= 3440 * LAYOUT_LIMITS.left.maxShare && ultra.right <= 3440 * LAYOUT_LIMITS.right.maxShare, 'ultrawide panels scale up but stay bounded');
assert.ok(ultra.left > 300 && ultra.right > 600, 'ultrawide panels use the extra width');
const splitterHtml = renderToStaticMarkup(<Splitter orientation="horizontal" label="Resize preview and timeline" direction="grow-after" value={300} min={210} max={594} onChange={() => undefined} onReset={() => undefined} />);
assert.match(splitterHtml, /role="separator"/);
assert.match(splitterHtml, /aria-orientation="horizontal"/);
assert.match(splitterHtml, /aria-valuenow="300"/);
assert.match(splitterHtml, /tabindex="0"/);
const readyView = view();
assert.equal((readyView.match(/role="separator"/g) ?? []).length, 3, 'library, preview/timeline and Director panels are resizable');
assert.match(readyView, /grid-template-columns:240px 8px minmax\(0,1fr\) 8px 340px/);
assert.match(readyView, /grid-template-rows:minmax\(0,1fr\) auto 300px/, 'timeline height follows the divider');
assert.match(view({ viewport: { width: 1000, height: 800 } }), /grid-template-columns:minmax\(0,1fr\) 8px 340px/, 'the library collapses on narrow windows instead of squeezing the preview');
assert.doesNotMatch(view({ viewport: { width: 1000, height: 800 } }), /Resize scene library/);
assert.deepEqual(rulerScale(12), { major: 10, minor: 2 });
assert.deepEqual(rulerScale(80), { major: 1, minor: 0.25 });
assert.deepEqual(rulerScale(2).major, 60);
for (const pps of [4, 8, 12, 20, 40, 80, 120]) assert.ok(rulerScale(pps).major * pps >= 76 || rulerScale(pps).major === 600, `labels at ${pps} px/s are at least 76px apart`);
assert.deepEqual(rulerTicks(72, 12), [0, 10, 20, 30, 40, 50, 60, 70]);
const fitted = renderToStaticMarkup(<Timeline {...timelineProps} pixelsPerSecond={undefined} />);
assert.match(fitted, /aria-label="Zoom in"/);
assert.match(fitted, /aria-pressed="true"[^>]*>Fit/, 'Fit mode is indicated when no manual zoom is set');
assert.match(shellEmpty, /ve-app/);
assert.match(renderToStaticMarkup(<AppShell screen="editor" project={projectRecord()} onNavigate={() => undefined}><i /></AppShell>), /Collapse navigation|Expand navigation/);

console.log(JSON.stringify({ status: 'PASS', suite: 'editing-workspace' }, null, 2));
