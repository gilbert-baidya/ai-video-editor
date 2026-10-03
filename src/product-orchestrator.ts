import { randomUUID } from 'node:crypto';
import { access, readFile, stat, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, isAbsolute, resolve } from 'node:path';
import type { EditPlan, TranscriptDocument } from './contracts.ts';
import { OllamaDirectorProvider, DirectorProvider } from './director.ts';
import { GeminiDirectorProvider } from './director-gemini.ts';
import { runFullSermonDirector } from './full-sermon-director.ts';
import { extractAudio, transcribeAndAlign } from './foundation.ts';
import type {
  CreateProjectRequest,
  ProductCapabilities,
  ProductJob,
  ProductProjectRecord,
  SourceMetadata,
} from './product-api.ts';
import { discoverCapabilities } from './product-capabilities.ts';
import { ProductProjectStore } from './product-store.ts';
import { beginRenderRevision, canRenderProject, recordPlanChangeRevision, createProductProject, finalQaPassed, rerenderBlockers, updateProductStage, type FinalQaSummary, type ProductStage } from './product-workflow.ts';
import { fingerprintExistingSource, parseYouTubeUrl, probeSource } from './source-ingestion.ts';
import { applyRetentionPolicy } from './visual-policy.ts';
import { canonicalTranscriptHash } from './sermon-chunking.ts';
import { attachAssetCandidate, createInitialReviewState, deriveApprovedEditPlan, isReviewStateCompatible, updateReview, type ReviewWorkspaceData } from './director-review.ts';
import { importImageAsset, verifyAssetOnDisk } from './media-import.ts';
import type { MediaAsset } from './contracts.ts';
import type { ReviewDataPayload } from './DirectorReviewWorkspace.tsx';
import { buildBrollIntents, decideBroll } from './broll-selection.ts';
import { sha256Browser } from './sha256.ts';
import { assertFunctionalReviewIsolation, auditPlanRealization, traceCreativeOperations } from './editorial-quality.ts';
import { createVideoFormatProfile } from './video-format.ts';

export interface ProductStageAdapters {
  capabilities?: () => Promise<ProductCapabilities>;
  transcribe?: (sourcePath: string, projectId: string, artifactDirectory: string) => Promise<TranscriptDocument>;
  analyze?: (transcript: TranscriptDocument, cacheRoot: string) => Promise<{
    analysis: unknown;
    reviewWorkspace?: ReviewDataPayload;
    provenance: ProductProjectRecord['workflow']['provider'];
    coveragePercent: number;
    cacheReused: boolean;
  }>;
  render?: (record: ProductProjectRecord, sourcePath: string, outputPath: string) => Promise<FinalQaSummary>;
}

function safeTitle(value: string): string {
  const title = value.normalize('NFC').trim();
  if (!title || title.length > 160) throw new Error('Project title must be between 1 and 160 characters.');
  return title;
}

function createJob(projectId: string, stage: ProductStage): ProductJob {
  const now = new Date().toISOString();
  return {
    jobId: `job-${stage}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    projectId,
    stage,
    status: 'queued',
    progress: 0,
    startedAt: now,
    updatedAt: now,
    cancelRequested: false,
  };
}

async function command(command: string, args: string[]): Promise<void> {
  await new Promise<void>((done, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? done() : reject(new Error(stderr || `${command} exited with ${code}.`)));
  });
}

async function downloadYouTube(url: string, outputDirectory: string, capabilities: ProductCapabilities): Promise<SourceMetadata> {
  if (capabilities.youtube.state !== 'AVAILABLE') throw new Error(capabilities.youtube.detail);
  const parsed = parseYouTubeUrl(url);
  const executable = capabilities.youtube.detail.split(' is available.')[0];
  const outputTemplate = resolve(outputDirectory, `${parsed.videoId}.%(ext)s`);
  await command(executable, ['--no-playlist', '--restrict-filenames', '--merge-output-format', 'mp4', '-o', outputTemplate, parsed.canonicalUrl]);
  const candidates = ['mp4', 'mkv', 'webm'].map((extension) => resolve(outputDirectory, `${parsed.videoId}.${extension}`));
  const sourcePath = (await Promise.all(candidates.map(async (path) => await access(path).then(() => path, () => undefined)))).find(Boolean);
  if (!sourcePath) throw new Error('YouTube downloader completed without producing a media file.');
  const info = await stat(sourcePath);
  return {
    kind: 'youtube-url',
    fileName: basename(sourcePath),
    canonicalUrl: parsed.canonicalUrl,
    youtubeVideoId: parsed.videoId,
    sizeBytes: info.size,
    sha256: await fingerprintExistingSource(sourcePath),
    relativePath: `source/${basename(sourcePath)}`,
    immutable: true,
  };
}

export class ProductOrchestrator {
  private readonly running = new Map<string, Promise<void>>();
  private readonly directorProvider: DirectorProvider;

  constructor(
    readonly store: ProductProjectStore,
    readonly appRoot: string,
    private readonly adapters: ProductStageAdapters = {},
  ) {
    this.directorProvider = process.env.AI_DIRECTOR_PROVIDER === 'ollama' ? new OllamaDirectorProvider() : new GeminiDirectorProvider();
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.store.recoverInterruptedJobs();
  }

  capabilities(): Promise<ProductCapabilities> {
    return this.adapters.capabilities?.() ?? discoverCapabilities({ root: this.appRoot, directorProvider: this.directorProvider });
  }

  async createProject(request: CreateProjectRequest): Promise<ProductProjectRecord> {
    const title = safeTitle(request.title);
    if (request.source.type === 'youtube-url') parseYouTubeUrl(request.source.url);
    const projectId = `project-${randomUUID()}`;
    const workflow = createProductProject({ projectId, title, source: request.source });
    return this.store.create({ schemaVersion: '1.3', workflow, artifacts: {}, jobs: [], cacheReuse: {} });
  }

  async attachUploadedSource(projectId: string, metadata: SourceMetadata): Promise<ProductProjectRecord> {
    const record = await this.store.get(projectId);
    if (record.sourceMetadata) throw new Error('Project source is immutable and has already been stored.');
    const capabilities = await this.capabilities();
    const sourcePath = resolve(this.store.projectDirectory(projectId), metadata.relativePath!);
    const probed = await probeSource(sourcePath, capabilities.ffprobe);
    const resolvedMetadata = { ...metadata, ...probed };
    const format = resolvedMetadata.width && resolvedMetadata.height ? createVideoFormatProfile(resolvedMetadata.width, resolvedMetadata.height) : undefined;
    const formattedWorkflow = {
      ...record.workflow,
      render: format ? { ...record.workflow.render, width: format.width, height: format.height, format } : record.workflow.render,
    };
    const workflow = updateProductStage(formattedWorkflow, 'ingest', format
      ? { status: 'completed', progress: 100 }
      : { status: 'blocked', progress: 100, error: 'Source orientation is unknown because effective display dimensions could not be determined.' });
    return this.store.save({ ...record, workflow, sourceMetadata: { ...resolvedMetadata, immutable: true } });
  }

  async startStage(projectId: string, stage: ProductStage): Promise<ProductJob> {
    if (this.running.has(`${projectId}:${stage}`)) throw new Error(`${stage} is already running.`);
    const record = await this.store.get(projectId);
    this.assertStageReady(record, stage);
    const job = createJob(projectId, stage);
    await this.store.addJob(projectId, job);
    const execution = this.executeStage(projectId, job);
    this.running.set(`${projectId}:${stage}`, execution);
    void execution.finally(() => this.running.delete(`${projectId}:${stage}`));
    return job;
  }

  // Renders an already-rendered project again with the approved plan unchanged (for example after a deterministic
  // renderer fix). Nothing is edited by hand: prerequisites are verified, the previous outcome is archived in the
  // revision history, and only the render and QA stages are reopened before the normal render job runs.
  async rerender(projectId: string, reason: string): Promise<ProductJob> {
    if (this.running.size && [...this.running.keys()].some((key) => key.startsWith(`${projectId}:`))) throw new Error('A stage is already running for this project.');
    const record = await this.store.get(projectId);
    const blockers = rerenderBlockers(record.workflow);
    if (blockers.length) throw new Error(`Re-render blocked: ${blockers.join(' ')}`);
    if (!record.review || !record.artifacts.approvedPlan) throw new Error('Re-render requires the persisted review and approved plan.');
    const projectDirectory = this.store.projectDirectory(projectId);
    const workspace = JSON.parse(await readFile(resolve(this.store.artifactDirectory(projectId), 'review-workspace.json'), 'utf8')) as ReviewDataPayload;
    const persisted = JSON.parse(await readFile(resolve(projectDirectory, record.artifacts.approvedPlan), 'utf8')) as EditPlan;
    const derived = deriveApprovedEditPlan(workspace.aiPlan, record.review, 'approved');
    if (persisted.status !== 'approved' || sha256Browser(JSON.stringify(persisted)) !== sha256Browser(JSON.stringify(derived))) {
      throw new Error('The persisted approved plan no longer matches the saved review; save the review again before rendering.');
    }
    const realization = auditPlanRealization(persisted, workspace.mediaIndex.assets, undefined, workspace.preview.durationSeconds);
    const unrealizable = [...realization.droppedOperations, ...realization.unsupportedOperations].map((item) => `${item.operationId}: ${item.reason}`);
    for (const operation of persisted.operations) {
      const asset = operation.type === 'broll' ? workspace.mediaIndex.assets.find((candidate) => candidate.id === operation.assetId) : undefined;
      if (asset) unrealizable.push(...(await verifyAssetOnDisk(asset)).map((issue) => `${operation.id}: ${issue}`));
    }
    if (unrealizable.length) throw new Error(`Re-render blocked: approved plan cannot be realized. ${unrealizable.join(' ')}`);

    const archivedOutputPath = await this.archiveOutput(record);
    const workflow = beginRenderRevision(record.workflow, {
      reason,
      approvedPlanHash: sha256Browser(JSON.stringify(persisted)),
      archivedOutputPath,
      previousQaStatus: record.output?.qaStatus,
    });
    await this.store.save({ ...record, workflow, qa: undefined, output: undefined, artifacts: { ...record.artifacts, render: undefined } });
    return this.startStage(projectId, 'render');
  }

  private async archiveOutput(record: ProductProjectRecord): Promise<string | undefined> {
    if (!record.artifacts.render) return undefined;
    const projectDirectory = this.store.projectDirectory(record.workflow.projectId);
    const current = resolve(projectDirectory, record.artifacts.render);
    if (!(await access(current).then(() => true, () => false))) return undefined;
    const archivedOutputPath = `output/revisions/final-sermon.r${(record.workflow.renderRevisions ?? []).length + 1}.mp4`;
    await mkdir(resolve(projectDirectory, 'output/revisions'), { recursive: true });
    await copyFile(current, resolve(projectDirectory, archivedOutputPath));
    return archivedOutputPath;
  }

  async waitForStage(projectId: string, stage: ProductStage): Promise<void> {
    await this.running.get(`${projectId}:${stage}`);
  }

  private assertStageReady(record: ProductProjectRecord, stage: ProductStage): void {
    if (stage === 'ingest') {
      if (record.workflow.source.type === 'local-video' && !record.sourceMetadata) throw new Error('Upload the local source before ingesting.');
      return;
    }
    const prerequisite: Partial<Record<ProductStage, ProductStage>> = {
      transcript: 'ingest',
      director: 'transcript',
      review: 'director',
      render: 'review',
      qa: 'render',
    };
    const required = prerequisite[stage];
    if (required && record.workflow.stages[required].status !== 'completed') throw new Error(`${required} must complete before ${stage}.`);
    if (stage === 'render' && !canRenderProject(record.workflow)) throw new Error('Render gates are not satisfied.');
  }

  private async executeStage(projectId: string, job: ProductJob): Promise<void> {
    let record = await this.store.get(projectId);
    const stage = job.stage;
    try {
      record = await this.store.updateJob(projectId, job.jobId, { status: 'running', progress: 1, message: `Starting ${stage}.` });
      record = await this.store.save({ ...record, workflow: updateProductStage(record.workflow, stage, { status: 'running', progress: 1, error: undefined }) });
      if (stage === 'ingest') record = await this.ingest(record);
      else if (stage === 'transcript') record = await this.transcribe(record);
      else if (stage === 'director') record = await this.analyze(record);
      else if (stage === 'review') throw new Error('Review is completed through persisted human decisions, not an automated job.');
      else if (stage === 'render') {
        record = await this.render(record);
        record = await this.qa(record);
      }
      else record = await this.qa(record);
      await this.store.updateJob(projectId, job.jobId, { status: 'completed', progress: 100, completedAt: new Date().toISOString(), message: `${stage} completed.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latest = await this.store.get(projectId);
      await this.store.save({ ...latest, workflow: updateProductStage(latest.workflow, stage, { status: 'failed', error: message }) });
      await this.store.updateJob(projectId, job.jobId, { status: 'failed', error: message, completedAt: new Date().toISOString() });
    }
  }

  private async ingest(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    if (record.workflow.source.type === 'youtube-url') {
      if (record.sourceMetadata) return this.complete(record, 'ingest', true);
      const metadata = await downloadYouTube(record.workflow.source.url, this.store.sourceDirectory(record.workflow.projectId), await this.capabilities());
      const sourcePath = resolve(this.store.projectDirectory(record.workflow.projectId), metadata.relativePath!);
      const probed = await probeSource(sourcePath, (await this.capabilities()).ffprobe);
      const resolvedMetadata = { ...metadata, ...probed };
      const format = resolvedMetadata.width && resolvedMetadata.height ? createVideoFormatProfile(resolvedMetadata.width, resolvedMetadata.height) : undefined;
      if (!format) {
        await this.store.save({ ...record, sourceMetadata: resolvedMetadata });
        throw new Error('Source orientation is unknown because ffprobe did not provide effective display dimensions.');
      }
      const formatted = {
        ...record,
        workflow: { ...record.workflow, render: { ...record.workflow.render, width: format.width, height: format.height, format } },
      };
      return this.store.save({ ...this.completedRecord(formatted, 'ingest', false), sourceMetadata: resolvedMetadata });
    }
    if (!record.sourceMetadata) throw new Error('Local source upload has not completed.');
    if (!record.sourceMetadata.width || !record.sourceMetadata.height) throw new Error('Source orientation must be known before ingest can complete.');
    return this.complete(record, 'ingest', true);
  }

  private async transcribe(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    if (record.artifacts.transcript && await access(resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.transcript)).then(() => true, () => false)) {
      return this.complete(record, 'transcript', true);
    }
    const capabilities = await this.capabilities();
    if (capabilities.transcription.state !== 'AVAILABLE') throw new Error(capabilities.transcription.detail);
    const sourcePath = this.sourcePath(record);
    const artifacts = this.store.artifactDirectory(record.workflow.projectId);
    const transcript = this.adapters.transcribe
      ? await this.adapters.transcribe(sourcePath, record.workflow.projectId, artifacts)
      : await this.defaultTranscribe(sourcePath, record.workflow.projectId, artifacts);
    if (transcript.projectId !== record.workflow.projectId) transcript.projectId = record.workflow.projectId;
    const path = resolve(artifacts, 'transcript.json');
    await writeFile(path, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
    return this.store.save({ ...this.completedRecord(record, 'transcript', false), artifacts: { ...record.artifacts, transcript: 'artifacts/transcript.json' } });
  }

  private async defaultTranscribe(sourcePath: string, projectId: string, artifacts: string): Promise<TranscriptDocument> {
    const audioPath = resolve(artifacts, 'source-16khz.wav');
    await extractAudio(sourcePath, audioPath);
    const transcript = await transcribeAndAlign(audioPath, resolve(artifacts, 'transcript-raw'), process.env.WHISPER_MODEL!);
    return { ...transcript, projectId };
  }

  private async analyze(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    if (!record.artifacts.transcript) throw new Error('Canonical transcript artifact is missing.');
    const transcript = JSON.parse(await readFile(resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.transcript), 'utf8')) as TranscriptDocument;
    const result = this.adapters.analyze
      ? await this.adapters.analyze(transcript, this.store.cacheDirectory(record.workflow.projectId))
      : await this.defaultAnalyze(transcript, this.store.cacheDirectory(record.workflow.projectId));
    const path = resolve(this.store.artifactDirectory(record.workflow.projectId), 'director.json');
    await writeFile(path, `${JSON.stringify(result.analysis, null, 2)}\n`, 'utf8');
    if (result.reviewWorkspace) {
      await writeFile(resolve(this.store.artifactDirectory(record.workflow.projectId), 'review-workspace.json'), `${JSON.stringify(result.reviewWorkspace, null, 2)}\n`, 'utf8');
    }
    const directorQuality = result.reviewWorkspace?.directorQuality;
    if (directorQuality) {
      await writeFile(resolve(this.store.artifactDirectory(record.workflow.projectId), 'director-quality.json'), `${JSON.stringify(directorQuality, null, 2)}\n`, 'utf8');
    }
    const directorEnrichment = result.reviewWorkspace?.editorialEnrichment;
    if (directorEnrichment) {
      await writeFile(resolve(this.store.artifactDirectory(record.workflow.projectId), 'director-enrichment.json'), `${JSON.stringify(directorEnrichment, null, 2)}\n`, 'utf8');
    }
    const completed = this.completedRecord(record, 'director', result.cacheReused);
    return this.store.save({
      ...completed,
      workflow: { ...completed.workflow, provider: result.provenance, coveragePercent: result.coveragePercent },
      artifacts: {
        ...record.artifacts,
        director: 'artifacts/director.json',
        directorQuality: directorQuality ? 'artifacts/director-quality.json' : undefined,
        directorEnrichment: directorEnrichment ? 'artifacts/director-enrichment.json' : undefined,
      },
    });
  }

  private async defaultAnalyze(transcript: TranscriptDocument, cacheRoot: string) {
    const result = await runFullSermonDirector(transcript, { provider: this.directorProvider, cacheRoot });
    const analysis = result.reconciliation.analysis;
    const duration = transcript.segments.at(-1)?.end ?? 0;
    const policy = applyRetentionPolicy(analysis, transcript.projectId, canonicalTranscriptHash(transcript), duration);
    const mediaIndex = { schemaVersion: '1.0', indexerVersion: 'product-v1.3', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), roots: [], assets: [] };
    const brollDecisions = buildBrollIntents(analysis).map((intent) => decideBroll(mediaIndex, intent));
    const beats: ReviewWorkspaceData['beats'] = analysis.sections.map((section) => {
      const originalOperation = policy.editPlan.operations.find((operation) => operation.id === `policy-${section.id}`);
      const brollDecision = brollDecisions.find((decision) => decision.intent.sectionId === section.id);
      return {
        section,
        originalOperation,
        brollDecision,
        candidates: [],
        requiredReview: originalOperation?.type !== 'no-change',
        noBroll: brollDecision?.decision === 'no-broll' || originalOperation?.type === 'no-change',
        provenance: result.provenance,
      };
    });
    const initialReview = createInitialReviewState({
      projectId: transcript.projectId,
      aiPlan: policy.editPlan,
      beats,
      directorExecution: result.provenance,
    }, sha256Browser(JSON.stringify(policy.editPlan)));
    const reviewWorkspace: ReviewDataPayload = {
      projectId: transcript.projectId,
      title: analysis.title ?? 'Untitled sermon',
      languageProfile: transcript.language === 'en' ? 'en' : transcript.language === 'bn' ? 'bn' : 'mixed',
      preview: {
        controlUrl: `/api/projects/${transcript.projectId}/source`,
        directorUrl: `/api/projects/${transcript.projectId}/source`,
        durationSeconds: duration,
        sourceStart: 0,
        sourceEnd: duration,
      },
      analysis,
      directorExecution: result.provenance,
      aiPlan: policy.editPlan,
      mediaIndex,
      beats,
      qa: { status: 'PASS', failures: [] },
      evidence: { explanationChain: '#', placementEvidence: '#', beforeFrame: '', duringFrame: '', afterFrame: '' },
      initialReview,
      policyRecords: policy.records,
      directorQuality: result.directorQuality,
      editorialEnrichment: {
        outcome: result.editorialEnrichment.outcome,
        enrichmentAttemptCount: result.editorialEnrichment.enrichmentAttemptCount,
        error: result.editorialEnrichment.error,
        provider: result.editorialEnrichment.providerResult?.provider,
        model: result.editorialEnrichment.providerResult?.model,
        cacheReused: result.editorialEnrichmentCache.hit,
      },
      assetPreviewUrls: {},
    };
    return {
      analysis: result,
      reviewWorkspace,
      provenance: {
        name: result.provenance.provider,
        model: result.provenance.model,
        status: result.provenance.providerStatus,
        fallbackUsed: result.provenance.fallbackUsed,
      },
      coveragePercent: result.coverage.coveragePercent,
      cacheReused: result.chunkExecutions.every((item) => item.cache.hit) && result.editorialEnrichmentCache.hit,
    };
  }

  async importLocalAsset(projectId: string, input: { path: string, description: string, rightsStatus: 'approved' | 'unknown' | 'restricted', rightsBasis: 'owned' | 'permission' | 'generated' | 'public-domain' | 'licensed' | 'unknown', rightsNote?: string }): Promise<MediaAsset> {
    if (typeof input.path !== 'string' || !isAbsolute(input.path)) throw new Error('Asset path must be an absolute path to a local file.');
    if (typeof input.description !== 'string' || !input.description.trim()) throw new Error('Asset description is required.');
    if (!['approved', 'unknown', 'restricted'].includes(input.rightsStatus)) throw new Error('Asset rights status is invalid.');
    if (!['owned', 'permission', 'generated', 'public-domain', 'licensed', 'unknown'].includes(input.rightsBasis)) throw new Error('Asset rights basis is invalid.');
    const workspacePath = resolve(this.store.artifactDirectory(projectId), 'review-workspace.json');
    const workspace = JSON.parse(await readFile(workspacePath, 'utf8')) as ReviewDataPayload;
    const asset = await importImageAsset({
      sourcePath: input.path,
      destinationDirectory: resolve(this.store.projectDirectory(projectId), 'media'),
      relativeDirectory: 'media',
      description: input.description.trim(),
      rightsStatus: input.rightsStatus,
      rightsBasis: input.rightsBasis,
      rightsNote: input.rightsNote,
    });
    workspace.mediaIndex.assets = [...workspace.mediaIndex.assets.filter((existing) => existing.id !== asset.id), asset];
    workspace.beats = attachAssetCandidate(workspace.beats, asset);
    await writeFile(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`, 'utf8');
    return asset;
  }

  async saveReview(projectId: string, review: ProductProjectRecord['review']): Promise<ProductProjectRecord> {
    if (!review) throw new Error('Review state is required.');
    assertFunctionalReviewIsolation(review);
    const record = await this.store.get(projectId);
    if (record.workflow.stages.director.status !== 'completed') throw new Error('Director must complete before review can be saved.');
    const artifacts = this.store.artifactDirectory(projectId);
    const workspace = JSON.parse(await readFile(resolve(artifacts, 'review-workspace.json'), 'utf8')) as ReviewDataPayload;
    if (!isReviewStateCompatible(workspace, review)) throw new Error('Review state is incompatible with the persisted Director plan.');
    const resolved = updateReview(workspace, review);
    const realization = auditPlanRealization(resolved.approvedPlan, workspace.mediaIndex.assets, undefined, workspace.preview.durationSeconds);
    const diskBlockers: string[] = [];
    for (const operation of resolved.approvedPlan.operations) {
      if (operation.type !== 'broll') continue;
      const asset = workspace.mediaIndex.assets.find((candidate) => candidate.id === operation.assetId);
      if (asset) diskBlockers.push(...(await verifyAssetOnDisk(asset)).map((issue) => `${operation.id}: ${issue}`));
    }
    const realizationBlockers = [
      ...diskBlockers,
      ...realization.droppedOperations.map((item) => `${item.operationId}: ${item.reason}`),
      ...realization.unsupportedOperations.map((item) => `${item.operationId}: ${item.reason}`),
    ];
    const blockers = [...resolved.readiness.blockers, ...realizationBlockers];
    const ready = resolved.readiness.ready && realizationBlockers.length === 0;
    const approvedPlan: EditPlan = { ...resolved.approvedPlan, status: ready ? 'approved' : 'draft' };
    const trace = traceCreativeOperations(workspace, review, approvedPlan, realization);
    await Promise.all([
      writeFile(resolve(artifacts, 'review.json'), `${JSON.stringify(review, null, 2)}\n`, 'utf8'),
      writeFile(resolve(artifacts, 'approved-plan.json'), `${JSON.stringify(approvedPlan, null, 2)}\n`, 'utf8'),
      writeFile(resolve(artifacts, 'plan-realization.json'), `${JSON.stringify(realization, null, 2)}\n`, 'utf8'),
      writeFile(resolve(artifacts, 'operation-trace.json'), `${JSON.stringify(trace, null, 2)}\n`, 'utf8'),
    ]);
    let base: ProductProjectRecord = { ...record, workflow: { ...record.workflow, unresolvedBlockers: blockers } };
    let keepsRenderOutcome = false;
    let planChanged = false;
    if (ready && ['completed', 'failed'].includes(record.workflow.stages.render.status)) {
      const planHash = sha256Browser(JSON.stringify(approvedPlan));
      if (record.workflow.lastRenderedPlanHash === planHash && record.workflow.status === 'COMPLETED') {
        // Same plan as the finished render: nothing to render again, so the completed outcome stays truthful.
        keepsRenderOutcome = true;
      } else {
        // A different plan is now approved: archive the earlier outcome and reopen render/QA before review completes.
        planChanged = true;
        const archivedOutputPath = await this.archiveOutput(record);
        base = {
          ...base,
          workflow: recordPlanChangeRevision(base.workflow, {
            reason: 'Review approved a different plan after the previous render.',
            approvedPlanHash: planHash,
            archivedOutputPath,
            previousQaStatus: record.output?.qaStatus,
          }),
          qa: undefined,
          output: undefined,
        };
      }
    }
    const workflow = keepsRenderOutcome ? base.workflow : updateProductStage(base.workflow, 'review', ready
      ? { status: 'completed', progress: 100 }
      : { status: 'running', progress: Math.max(1, record.workflow.stages.review.progress) });
    return this.store.save({
      ...base,
      workflow,
      review,
      artifacts: {
        ...base.artifacts,
        render: planChanged ? undefined : base.artifacts.render,
        review: 'artifacts/review.json',
        approvedPlan: 'artifacts/approved-plan.json',
        planRealization: 'artifacts/plan-realization.json',
        operationTrace: 'artifacts/operation-trace.json',
      },
    });
  }

  private async render(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    if (!record.artifacts.approvedPlan) throw new Error('Approved edit plan artifact is missing.');
    if (!record.sourceMetadata?.width || !record.sourceMetadata.height) throw new Error('Render is blocked because source orientation is unknown.');
    const capabilities = await this.capabilities();
    if (capabilities.render.state !== 'AVAILABLE') throw new Error(capabilities.render.detail);
    if (!this.adapters.render) throw new Error('Remotion product renderer is not configured for this host.');
    const outputPath = resolve(this.store.outputDirectory(record.workflow.projectId), 'final-sermon.mp4');
    const renderedPlan = JSON.parse(await readFile(resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.approvedPlan), 'utf8')) as EditPlan;
    const qa = await this.adapters.render(record, this.sourcePath(record), outputPath);
    const completed = this.completedRecord(record, 'render', false);
    completed.workflow = { ...completed.workflow, lastRenderedPlanHash: sha256Browser(JSON.stringify(renderedPlan)) };
    return this.store.save({ ...completed, qa, artifacts: { ...record.artifacts, render: 'output/final-sermon.mp4' } });
  }

  private async qa(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    if (!record.qa || !record.artifacts.render) throw new Error('Rendered output and QA evidence are required.');
    const outputPath = resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.render);
    const info = await stat(outputPath);
    const metadata = record.sourceMetadata;
    const passed = finalQaPassed(record.qa);
    const workflow = updateProductStage(record.workflow, 'qa', passed
      ? { status: 'completed', progress: 100 }
      : { status: 'failed', error: 'One or more required final QA gates failed.' });
    return this.store.save({
      ...record,
      workflow,
      output: {
        fileName: basename(outputPath),
        relativePath: record.artifacts.render,
        durationSeconds: metadata?.durationSeconds ?? 0,
        width: record.workflow.render.width,
        height: record.workflow.render.height,
        sizeBytes: info.size,
        qaStatus: passed ? 'PASS' : 'FAIL',
      },
    });
  }

  private sourcePath(record: ProductProjectRecord): string {
    if (!record.sourceMetadata?.relativePath) throw new Error('Immutable source artifact is missing.');
    return resolve(this.store.projectDirectory(record.workflow.projectId), record.sourceMetadata.relativePath);
  }

  private completedRecord(record: ProductProjectRecord, stage: ProductStage, cacheReused: boolean): ProductProjectRecord {
    return {
      ...record,
      workflow: updateProductStage(record.workflow, stage, { status: 'completed', progress: 100, cacheReused }),
      cacheReuse: { ...record.cacheReuse, [stage]: cacheReused },
    };
  }

  private async complete(record: ProductProjectRecord, stage: ProductStage, cacheReused: boolean): Promise<ProductProjectRecord> {
    return this.store.save(this.completedRecord(record, stage, cacheReused));
  }
}
