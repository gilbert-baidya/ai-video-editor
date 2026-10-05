import { randomUUID } from 'node:crypto';
import { access, readFile, stat, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, isAbsolute, resolve } from 'node:path';
import type { EditPlan, TranscriptDocument } from './contracts.ts';
import { OllamaDirectorProvider, DirectorProvider } from './director.ts';
import { GeminiDirectorProvider } from './director-gemini.ts';
import { runFullSermonDirector } from './full-sermon-director.ts';
import { extractAudio } from './foundation.ts';
import { GeminiTranscriptionProvider } from './features/transcription/gemini-transcription-provider.ts';
import { LocalWhisperProvider } from './features/transcription/local-whisper-provider.ts';
import type {
  CreateProjectRequest,
  ProductCapabilities,
  ProductJob,
  ProductProjectRecord,
  ProductCapability,
  SourceMetadata,
  SourceDurationValidation,
} from './product-api.ts';
import { discoverCapabilities } from './product-capabilities.ts';
import { ProductProjectStore } from './product-store.ts';
import {
  beginRenderRevision,
  beginShortRender,
  canRenderProject,
  createProductProject,
  finalQaPassed,
  recommendedShortState,
  recordPlanChangeRevision,
  rerenderBlockers,
  reviewShortState,
  updateProductStage,
  type FinalQaSummary,
  type ProductStage,
} from './product-workflow.ts';
import { fingerprintExistingSource, parseYouTubeUrl, probeSource } from './source-ingestion.ts';
import { applyRetentionPolicy } from './visual-policy.ts';
import { canonicalTranscriptHash } from './sermon-chunking.ts';
import { transcriptQualityFailures } from './transcript-integrity.ts';
import { correctShortBoundaries } from './features/shorts/boundary-validator.ts';
import { validateExtractedShorts } from './features/shorts/shorts-extractor.ts';
import { attachAssetCandidate, createInitialReviewState, deriveApprovedEditPlan, isReviewStateCompatible, updateReview, type ReviewWorkspaceData } from './director-review.ts';
import { importImageAsset, verifyAssetOnDisk } from './media-import.ts';
import type { MediaAsset } from './contracts.ts';
import type { ReviewDataPayload } from './DirectorReviewWorkspace.tsx';
import { buildBrollIntents, decideBroll } from './broll-selection.ts';
import { sha256Browser } from './sha256.ts';
import { assertFunctionalReviewIsolation, auditPlanRealization, traceCreativeOperations } from './editorial-quality.ts';
import { createVideoFormatProfile } from './video-format.ts';
import {
  SOURCE_DURATION_TOLERANCE_SECONDS,
  planEndSeconds,
  sourceDurationMismatchDiagnostic,
  transcriptEndSeconds,
  validatePlanTiming,
  validateTranscriptTiming,
} from './source-duration.ts';
import type { ExtractedShort } from './features/shorts/shorts-model.ts';

export interface ProductStageAdapters {
  capabilities?: () => Promise<ProductCapabilities>;
  probeSource?: (sourcePath: string, ffprobe: ProductCapability) => Promise<Partial<SourceMetadata>>;
  transcribe?: (sourcePath: string, projectId: string, artifactDirectory: string) => Promise<TranscriptDocument>;
  analyze?: (transcript: TranscriptDocument, cacheRoot: string) => Promise<{
    analysis: unknown;
    reviewWorkspace?: ReviewDataPayload;
    provenance: ProductProjectRecord['workflow']['provider'];
    coveragePercent: number;
    cacheReused: boolean;
  }>;
  render?: (record: ProductProjectRecord, sourcePath: string, outputPath: string, payload?: any) => Promise<FinalQaSummary>;
}

function safeTitle(value: string): string {
  const title = value.normalize('NFC').trim();
  if (!title || title.length > 160) throw new Error('Project title must be between 1 and 160 characters.');
  return title;
}

function createJob(projectId: string, stage: ProductStage, payload?: any): ProductJob {
  const now = new Date().toISOString();
  return {
    jobId: `job-${stage}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    projectId,
    stage,
    payload,
    status: 'queued',
    progress: 0,
    startedAt: now,
    updatedAt: now,
    cancelRequested: false,
  };
}

function withProbeMetadata(metadata: SourceMetadata, probed: Partial<SourceMetadata>): SourceMetadata {
  return {
    ...metadata,
    durationSeconds: probed.durationSeconds,
    containerDurationSeconds: probed.containerDurationSeconds,
    videoDurationSeconds: probed.videoDurationSeconds,
    audioDurationSeconds: probed.audioDurationSeconds,
    durationSource: probed.durationSource,
    probedAt: probed.probedAt,
    sizeBytes: probed.sizeBytes ?? metadata.sizeBytes,
    width: probed.width,
    height: probed.height,
    immutable: true,
  };
}

function withoutUnverifiedProbeMetadata(metadata: SourceMetadata): SourceMetadata {
  return {
    ...metadata,
    durationSeconds: undefined,
    containerDurationSeconds: undefined,
    videoDurationSeconds: undefined,
    audioDurationSeconds: undefined,
    durationSource: undefined,
    probedAt: undefined,
    width: undefined,
    height: undefined,
    immutable: true,
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

  async getProject(projectId: string): Promise<ProductProjectRecord> {
    return this.withSourceDurationValidation(await this.store.get(projectId));
  }

  async listProjects(): Promise<ProductProjectRecord[]> {
    const records = await this.store.list();
    if (!records.some((record) => record.sourceMetadata?.relativePath)) return records;
    const ffprobeCapability = (await this.capabilities()).ffprobe;
    const audited = new Array<ProductProjectRecord>(records.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(4, records.length) }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= records.length) return;
        audited[index] = await this.withSourceDurationValidation(records[index], ffprobeCapability);
      }
    });
    await Promise.all(workers);
    return audited;
  }

  async createProject(request: CreateProjectRequest): Promise<ProductProjectRecord> {
    const title = safeTitle(request.title);
    if (request.source.type === 'youtube-url') parseYouTubeUrl(request.source.url);
    const projectId = `project-${randomUUID()}`;
    const workflow = createProductProject({ projectId, title, source: request.source, outputTarget: request.outputTarget });
    return this.store.create({ schemaVersion: '1.3', workflow, artifacts: {}, jobs: [], cacheReuse: {} });
  }

  async attachUploadedSource(projectId: string, metadata: SourceMetadata): Promise<ProductProjectRecord> {
    const record = await this.store.get(projectId);
    if (record.sourceMetadata) throw new Error('Project source is immutable and has already been stored.');
    const capabilities = await this.capabilities();
    const sourcePath = resolve(this.store.projectDirectory(projectId), metadata.relativePath!);
    let probed: Partial<SourceMetadata>;
    try {
      probed = await this.probePhysicalSource(sourcePath, capabilities.ffprobe);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const workflow = updateProductStage(record.workflow, 'ingest', { status: 'blocked', progress: 100, error: message });
      return this.store.save({ ...record, workflow, sourceMetadata: withoutUnverifiedProbeMetadata(metadata) });
    }
    const resolvedMetadata = withProbeMetadata(metadata, probed);
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

  async startStage(projectId: string, stage: ProductStage, payload?: any): Promise<ProductJob> {
    const jobKey = payload?.shortId ? `${projectId}:${stage}:${payload.shortId}` : `${projectId}:${stage}`;
    if (this.running.has(jobKey)) throw new Error(`${stage} is already running.`);
    const record = await this.store.get(projectId);
    await this.assertStageReady(record, stage, payload);
    const job = createJob(projectId, stage, payload);
    await this.store.addJob(projectId, job);
    const execution = this.executeStage(projectId, job);
    this.running.set(jobKey, execution);
    void execution.finally(() => this.running.delete(jobKey));
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
    await this.assertRenderDurationIntegrity(record, persisted, workspace);
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

  async reviewShort(projectId: string, shortId: string, approved: boolean): Promise<ProductProjectRecord> {
    const record = await this.store.get(projectId);
    if (record.workflow.outputTarget !== 'shorts') throw new Error('This project is not a Shorts project.');
    if (record.workflow.stages.director.status !== 'completed') throw new Error('Gemini analysis must complete before Shorts can be reviewed.');
    const { short, workspace } = await this.loadShortCandidate(record, shortId);
    if (approved) {
      const transcript = await this.loadTranscript(record);
      this.assertTranscriptQuality(transcript);
      const duration = await this.verifiedPhysicalDuration(record);
      const corrected = correctShortBoundaries(short, transcript, duration);
      workspace.shorts = workspace.shorts?.map((candidate) => candidate.id === short.id ? corrected : candidate);
      await writeFile(
        resolve(this.store.artifactDirectory(projectId), 'review-workspace.json'),
        `${JSON.stringify(workspace, null, 2)}\n`,
        'utf8',
      );
    }
    const now = new Date().toISOString();
    const existing = record.workflow.shorts?.[short.id] ?? recommendedShortState(now);
    const shorts = { ...(record.workflow.shorts ?? {}), [short.id]: reviewShortState(existing, approved, now) };
    const approvedCount = Object.values(shorts).filter((item) => item.approvalStatus === 'approved').length;
    const reviewProgress = approvedCount > 0 ? 100 : Math.round((Object.keys(shorts).length ? 1 / Object.keys(shorts).length : 0) * 100);
    const workflow = updateProductStage({ ...record.workflow, shorts }, 'review', approvedCount > 0
      ? { status: 'completed', progress: 100, error: undefined }
      : { status: 'running', progress: reviewProgress, error: undefined }, now);
    return this.store.save({ ...record, workflow });
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

  async waitForStage(projectId: string, stage: ProductStage, payload?: any): Promise<void> {
    const jobKey = payload?.shortId ? `${projectId}:${stage}:${payload.shortId}` : `${projectId}:${stage}`;
    await this.running.get(jobKey);
    const record = await this.store.get(projectId);
    if (stage === 'render' && payload?.shortId) {
      if (record.workflow.shorts?.[payload.shortId]?.renderStatus === 'failed') {
        throw new Error(`Short render failed: ${record.workflow.shorts[payload.shortId].error}`);
      }
    } else if (record.workflow.stages[stage].status === 'failed') {
      throw new Error(`${stage} failed: ${record.workflow.stages[stage].error}`);
    }
  }

  private async assertStageReady(record: ProductProjectRecord, stage: ProductStage, payload?: any): Promise<void> {
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
    if (stage === 'render' && payload?.shortId) {
      const { short, workspace } = await this.loadShortCandidate(record, String(payload.shortId));
      const state = record.workflow.shorts?.[short.id];
      if (state?.approvalStatus !== 'approved') throw new Error('Approve this Short in the Review screen before exporting it.');
      if (state.renderStatus === 'running') throw new Error('This Short is already rendering.');
      const physicalDuration = await this.verifiedPhysicalDuration(record);
      const transcript = await this.loadTranscript(record);
      this.assertTranscriptQuality(transcript);
      const corrected = correctShortBoundaries(short, transcript, physicalDuration);
      if (Math.abs(corrected.sourceStartSeconds - short.sourceStartSeconds) > 0.01
        || Math.abs(corrected.sourceEndSeconds - short.sourceEndSeconds) > 0.01) {
        throw new Error('The approved Short boundaries are no longer safe. Review and approve the corrected boundaries again.');
      }
      const range = this.shortRange(short, transcript);
      if (range.start < 0 || range.end > physicalDuration + SOURCE_DURATION_TOLERANCE_SECONDS || range.end <= range.start) {
        throw new Error(`Short source range ${range.start.toFixed(3)}–${range.end.toFixed(3)} exceeds the physical source duration ${physicalDuration.toFixed(3)}.`);
      }
      if (!workspace.shorts?.some((candidate) => candidate.id === short.id)) throw new Error('The approved Short is no longer present in the Director workspace.');
      return;
    }
    const required = prerequisite[stage];
    if (required && record.workflow.stages[required].status !== 'completed') throw new Error(`${required} must complete before ${stage}.`);
    if (stage === 'render') {
      if (!canRenderProject(record.workflow)) throw new Error('Render gates are not satisfied.');
      const { plan, workspace } = await this.loadApprovedPlanAndWorkspace(record);
      await this.assertRenderDurationIntegrity(record, plan, workspace);
    }
  }

  private async executeStage(projectId: string, job: ProductJob): Promise<void> {
    let record = await this.store.get(projectId);
    const stage = job.stage;
    try {
      record = await this.store.updateJob(projectId, job.jobId, { status: 'running', progress: 1, message: `Starting ${stage}.` });
      if (stage === 'render' && job.payload?.shortId) {
        const current = record.workflow.shorts?.[job.payload.shortId];
        if (!current) throw new Error('The selected Short has no persisted review state.');
        record = await this.store.save({
          ...record,
          workflow: {
            ...record.workflow,
            shorts: { ...(record.workflow.shorts || {}), [job.payload.shortId]: beginShortRender(current) },
          },
        });
      } else {
        record = await this.store.save({ ...record, workflow: updateProductStage(record.workflow, stage, { status: 'running', progress: 1, error: undefined }) });
      }
      if (stage === 'ingest') record = await this.ingest(record);
      else if (stage === 'transcript') record = await this.transcribe(record);
      else if (stage === 'director') record = await this.analyze(record);
      else if (stage === 'review') throw new Error('Review is completed through persisted human decisions, not an automated job.');
      else if (stage === 'render') {
        record = await this.render(record, job.payload);
        if (!job.payload?.shortId) record = await this.qa(record);
      }
      else record = await this.qa(record);
      await this.store.updateJob(projectId, job.jobId, { status: 'completed', progress: 100, completedAt: new Date().toISOString(), message: `${stage} completed.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latest = await this.store.get(projectId);
      if (stage === 'render' && job.payload?.shortId) {
        const now = new Date().toISOString();
        const current = latest.workflow.shorts?.[job.payload.shortId] ?? recommendedShortState(now);
        const workflow = {
          ...latest.workflow,
          shorts: {
            ...(latest.workflow.shorts || {}),
            [job.payload.shortId]: { ...current, renderStatus: 'failed' as const, error: message, completedAt: now, updatedAt: now },
          },
        };
        await this.store.save({ ...latest, workflow });
      } else {
        await this.store.save({ ...latest, workflow: updateProductStage(latest.workflow, stage, { status: 'failed', error: message }) });
      }
      await this.store.updateJob(projectId, job.jobId, { status: 'failed', error: message, completedAt: new Date().toISOString() });
    }
  }

  private async ingest(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    if (record.workflow.source.type === 'youtube-url') {
      const capabilities = await this.capabilities();
      const metadata = record.sourceMetadata ?? await downloadYouTube(record.workflow.source.url, this.store.sourceDirectory(record.workflow.projectId), capabilities);
      const sourcePath = resolve(this.store.projectDirectory(record.workflow.projectId), metadata.relativePath!);
      let probed: Partial<SourceMetadata>;
      try {
        probed = await this.probePhysicalSource(sourcePath, capabilities.ffprobe);
      } catch (error) {
        await this.store.save({ ...record, sourceMetadata: withoutUnverifiedProbeMetadata(metadata) });
        throw error;
      }
      const resolvedMetadata = withProbeMetadata(metadata, probed);
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
    const capabilities = await this.capabilities();
    const probed = await this.probePhysicalSource(this.sourcePath(record), capabilities.ffprobe);
    const resolvedMetadata = withProbeMetadata(record.sourceMetadata, probed);
    const format = createVideoFormatProfile(resolvedMetadata.width!, resolvedMetadata.height!);
    const formatted = { ...record, workflow: { ...record.workflow, render: { ...record.workflow.render, width: format.width, height: format.height, format } }, sourceMetadata: resolvedMetadata };
    return this.store.save(this.completedRecord(formatted, 'ingest', false));
  }

  private async transcribe(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    const physicalDurationSeconds = await this.verifiedPhysicalDuration(record);
    if (record.artifacts.transcript && await access(resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.transcript)).then(() => true, () => false)) {
      const transcript = JSON.parse(await readFile(resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.transcript), 'utf8')) as TranscriptDocument;
      this.assertTranscriptQuality(transcript);
      this.assertTranscriptTiming(transcript, physicalDurationSeconds);
      return this.complete(record, 'transcript', true);
    }
    const capabilities = await this.capabilities();
    if (capabilities.transcription.state !== 'AVAILABLE') throw new Error(capabilities.transcription.detail);
    const sourcePath = this.sourcePath(record);
    const artifacts = this.store.artifactDirectory(record.workflow.projectId);
    const transcript = this.adapters.transcribe
      ? await this.adapters.transcribe(sourcePath, record.workflow.projectId, artifacts)
      : await this.defaultTranscribe(sourcePath, record.workflow.projectId, artifacts, physicalDurationSeconds);
    if (transcript.projectId !== record.workflow.projectId) transcript.projectId = record.workflow.projectId;
    this.assertTranscriptQuality(transcript);
    this.assertTranscriptTiming(transcript, physicalDurationSeconds);
    const path = resolve(artifacts, 'transcript.json');
    await writeFile(path, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
    return this.store.save({ ...this.completedRecord(record, 'transcript', false), artifacts: { ...record.artifacts, transcript: 'artifacts/transcript.json' } });
  }

  private async defaultTranscribe(sourcePath: string, projectId: string, artifacts: string, physicalDurationSeconds: number): Promise<TranscriptDocument> {
    const audioPath = resolve(artifacts, 'source-16khz.wav');
    await extractAudio(sourcePath, audioPath);

    // TranscriptionProvider Abstraction (Phase 7C)
    // Select best provider: Prefer Gemini for multilingual, fallback to local Whisper if configured
    let provider;
    if (process.env.GEMINI_API_KEY) {
      provider = new GeminiTranscriptionProvider();
    } else {
      provider = new LocalWhisperProvider();
    }

    const transcript = await provider.transcribe({
      audioPath,
      projectId,
      physicalDurationSeconds,
      language: process.env.WHISPER_LANGUAGE === 'bn' || process.env.WHISPER_LANGUAGE === 'en'
        ? process.env.WHISPER_LANGUAGE
        : 'auto',
    });

    return { ...transcript, projectId };
  }

  private async analyze(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    console.log(`Entering analyze for project ${record.workflow.projectId}`);
    if (!record.artifacts.transcript) throw new Error('Canonical transcript artifact is missing.');
    const physicalDurationSeconds = await this.verifiedPhysicalDuration(record);
    const transcript = JSON.parse(await readFile(resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.transcript), 'utf8')) as TranscriptDocument;
    this.assertTranscriptQuality(transcript);
    this.assertTranscriptTiming(transcript, physicalDurationSeconds);
    const result = this.adapters.analyze
      ? await this.adapters.analyze(transcript, this.store.cacheDirectory(record.workflow.projectId))
      : await this.defaultAnalyze(transcript, this.store.cacheDirectory(record.workflow.projectId), physicalDurationSeconds, record);
    if (result.reviewWorkspace) {
      const planFailures = validatePlanTiming(result.reviewWorkspace.aiPlan, physicalDurationSeconds, result.reviewWorkspace.preview.durationSeconds);
      if (planFailures.length) throw new Error(`Director output rejected. ${planFailures.join(' ')}`);
    }
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
    const recommendedShorts = result.reviewWorkspace?.shorts ?? [];
    const shortStates = recommendedShorts.length
      ? Object.fromEntries(recommendedShorts.map((short: ExtractedShort) => [short.id, recommendedShortState(completed.workflow.updatedAt)]))
      : completed.workflow.shorts;
    return this.store.save({
      ...completed,
      workflow: { ...completed.workflow, provider: result.provenance, coveragePercent: result.coveragePercent, shorts: shortStates },
      artifacts: {
        ...record.artifacts,
        director: 'artifacts/director.json',
        directorQuality: directorQuality ? 'artifacts/director-quality.json' : undefined,
        directorEnrichment: directorEnrichment ? 'artifacts/director-enrichment.json' : undefined,
      },
    });
  }

  private async defaultAnalyze(transcript: TranscriptDocument, cacheRoot: string, physicalDurationSeconds: number, record: ProductProjectRecord) {
    console.log(`Entering defaultAnalyze. target=${record.workflow.outputTarget}`);
    if (record.workflow.outputTarget === 'shorts') {
      console.log('Using GeminiShortsProvider');
      const { GeminiShortsProvider } = await import('./features/shorts/shorts-gemini-provider.ts');
      const provider = new GeminiShortsProvider();
      const shortsInput = {
        projectId: transcript.projectId,
        canonicalTranscriptHash: canonicalTranscriptHash(transcript),
        segments: transcript.segments
      };
      const shortsResult = await provider.extract(shortsInput);
      const safeShorts = shortsResult.shorts.map((short) => correctShortBoundaries(short, transcript, physicalDurationSeconds));
      const boundaryErrors = validateExtractedShorts(safeShorts, shortsInput);
      if (boundaryErrors.length) throw new Error(`Boundary validation rejected Gemini Shorts. ${boundaryErrors.join(' ')}`);
      // Shorts extraction doesn't produce a full sermon plan, we map the first short to a draft plan to keep the pipeline intact.
      const first = safeShorts[0];
      let sourceStart = 0;
      let sourceEnd = 30;
      if (first && first.sourceSegmentIds.length > 0) {
        sourceStart = first.sourceStartSeconds;
        sourceEnd = first.sourceEndSeconds;
      }
      
      const plan: EditPlan = {
        schemaVersion: '2.0',
        projectId: transcript.projectId,
        sourceTranscriptHash: canonicalTranscriptHash(transcript),
        status: 'draft',
        createdBy: { provider: provider.name, model: shortsResult.model },
        operations: first ? [{ id: 'op1', type: 'no-change', start: sourceStart, end: sourceEnd, mode: 'canonical-no-change', reason: 'Short clip', confidence: 1 }] : []
      };
      
      const analysis = { sections: [], title: first?.title ?? 'Shorts Generation' } as any;
      const mediaIndex = { schemaVersion: '1.0', indexerVersion: 'product-v1.3', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), roots: [], assets: [] } as any;
      return { 
        analysis, 
        reviewWorkspace: {
          projectId: transcript.projectId,
          title: analysis.title,
          languageProfile: transcript.language === 'bn' || transcript.language === 'mixed' ? transcript.language : 'en',
          preview: { controlUrl: '', directorUrl: '', durationSeconds: physicalDurationSeconds, sourceStart: 0, sourceEnd: physicalDurationSeconds },
          analysis,
          directorExecution: { provider: provider.name, model: shortsResult.model, providerStatus: 'ai-success', fallbackUsed: false, timestamp: new Date().toISOString() },
          aiPlan: plan,
          mediaIndex,
          beats: [],
          qa: { status: 'PASS', failures: [] },
          evidence: { explanationChain: '#', placementEvidence: '#', beforeFrame: '', duringFrame: '', afterFrame: '' },
          initialReview: { projectId: transcript.projectId, schemaVersion: '1.0', sourceEditPlanHash: (await import('node:crypto')).createHash('sha256').update(JSON.stringify(plan)).digest('hex'), decisions: [], updatedAt: new Date().toISOString() },
          policyRecords: [],
          directorQuality: { coverageMetrics: { timelinePercent: 0, sourcePercent: 0 }, editCount: 0, editorialPasses: 0, opportunities: [] },
          editorialEnrichment: { outcome: 'bypassed', enrichmentAttemptCount: 0 },
          assetPreviewUrls: {},
          shorts: safeShorts
        },
        provenance: { name: provider.name, model: shortsResult.model, status: 'ai-success', fallbackUsed: false },
        coveragePercent: 100,
        cacheReused: false 
      } as any;
    }

    const result = await runFullSermonDirector(transcript, { provider: this.directorProvider, cacheRoot });
    const analysis = result.reconciliation.analysis;
    const duration = physicalDurationSeconds;
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
    const physicalDurationSeconds = await this.verifiedPhysicalDuration(record);
    if (!record.artifacts.transcript) throw new Error('Canonical transcript artifact is missing.');
    const transcript = JSON.parse(await readFile(resolve(this.store.projectDirectory(projectId), record.artifacts.transcript), 'utf8')) as TranscriptDocument;
    this.assertTranscriptTiming(transcript, physicalDurationSeconds);
    const artifacts = this.store.artifactDirectory(projectId);
    const workspace = JSON.parse(await readFile(resolve(artifacts, 'review-workspace.json'), 'utf8')) as ReviewDataPayload;
    if (!isReviewStateCompatible(workspace, review)) throw new Error('Review state is incompatible with the persisted Director plan.');
    const resolved = updateReview(workspace, review, physicalDurationSeconds);
    const realization = auditPlanRealization(resolved.approvedPlan, workspace.mediaIndex.assets, undefined, physicalDurationSeconds);
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

  private async render(record: ProductProjectRecord, payload?: any): Promise<ProductProjectRecord> {
    if (!record.sourceMetadata?.width || !record.sourceMetadata.height) throw new Error('Render is blocked because source orientation is unknown.');
    const capabilities = await this.capabilities();
    if (capabilities.render.state !== 'AVAILABLE') throw new Error(capabilities.render.detail);
    if (!this.adapters.render) throw new Error('Remotion product renderer is not configured for this host.');
    const shortId = typeof payload?.shortId === 'string' ? payload.shortId : undefined;
    const outputPath = resolve(this.store.outputDirectory(record.workflow.projectId), shortId ? `short-${shortId}.mp4` : 'final-sermon.mp4');

    if (!shortId && !record.artifacts.approvedPlan) throw new Error('Approved edit plan artifact is missing.');
    let renderedPlan: EditPlan | undefined;
    if (!shortId) {
      const approved = await this.loadApprovedPlanAndWorkspace(record);
      renderedPlan = approved.plan;
      await this.assertRenderDurationIntegrity(record, approved.plan, approved.workspace);
    }

    const qa = await this.adapters.render(record, this.sourcePath(record), outputPath, payload);
    if (shortId) {
      const now = new Date().toISOString();
      const current = record.workflow.shorts?.[shortId];
      if (!current || current.approvalStatus !== 'approved') throw new Error('The Short approval state changed before rendering completed.');
      const info = await stat(outputPath);
      const passed = finalQaPassed(qa);
      const media = qa.mediaExport as { durationSeconds?: number; width?: number; height?: number } | undefined;
      const artifactPath = `output/short-${shortId}.mp4`;
      const workflow = {
        ...record.workflow,
        shorts: {
          ...(record.workflow.shorts ?? {}),
          [shortId]: {
            ...current,
            renderStatus: passed ? 'completed' as const : 'failed' as const,
            artifactPath,
            qa,
            output: {
              fileName: basename(outputPath),
              relativePath: artifactPath,
              durationSeconds: Number(media?.durationSeconds ?? 0),
              width: Number(media?.width ?? 0),
              height: Number(media?.height ?? 0),
              sizeBytes: info.size,
              qaStatus: passed ? 'PASS' as const : 'FAIL' as const,
            },
            completedAt: now,
            updatedAt: now,
            error: passed ? undefined : 'One or more required final QA gates failed.',
          },
        },
        updatedAt: now,
      };
      const saved = await this.store.save({ ...record, workflow });
      if (!passed) throw new Error('Short export failed final QA.');
      return saved;
    }

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

  private async probePhysicalSource(sourcePath: string, ffprobeCapability?: ProductCapability): Promise<Partial<SourceMetadata>> {
    const ffprobeCapabilityResolved = ffprobeCapability ?? (await this.capabilities()).ffprobe;
    const probed = this.adapters.probeSource
      ? await this.adapters.probeSource(sourcePath, ffprobeCapabilityResolved)
      : await probeSource(sourcePath, ffprobeCapabilityResolved);
    if (!(Number(probed.durationSeconds) > 0)) throw new Error('Source duration cannot be verified because ffprobe did not report a positive physical duration.');
    return probed;
  }

  private async verifiedPhysicalDuration(record: ProductProjectRecord, ffprobeCapability?: ProductCapability): Promise<number> {
    const probed = await this.probePhysicalSource(this.sourcePath(record), ffprobeCapability);
    return Number(probed.durationSeconds);
  }

  private assertTranscriptTiming(transcript: TranscriptDocument, physicalDurationSeconds: number): void {
    const failures = validateTranscriptTiming(transcript, physicalDurationSeconds);
    if (failures.length) throw new Error(`Transcript timing rejected. ${failures.join(' ')}`);
  }

  private assertTranscriptQuality(transcript: TranscriptDocument): void {
    const failures = transcriptQualityFailures(transcript.originalTranscript, transcript.segments, transcript.language);
    if (failures.length) throw new Error(`Transcript quality rejected. ${failures.join(' ')}`);
  }

  private async loadApprovedPlanAndWorkspace(record: ProductProjectRecord): Promise<{ plan: EditPlan; workspace: ReviewDataPayload }> {
    if (!record.artifacts.approvedPlan) throw new Error('Approved edit plan artifact is missing.');
    const projectDirectory = this.store.projectDirectory(record.workflow.projectId);
    const [plan, workspace] = await Promise.all([
      readFile(resolve(projectDirectory, record.artifacts.approvedPlan), 'utf8').then((value) => JSON.parse(value) as EditPlan),
      readFile(resolve(this.store.artifactDirectory(record.workflow.projectId), 'review-workspace.json'), 'utf8').then((value) => JSON.parse(value) as ReviewDataPayload),
    ]);
    return { plan, workspace };
  }

  private async loadShortCandidate(record: ProductProjectRecord, shortId: string): Promise<{ short: ExtractedShort; workspace: ReviewDataPayload }> {
    const workspacePath = resolve(this.store.artifactDirectory(record.workflow.projectId), 'review-workspace.json');
    const workspace = JSON.parse(await readFile(workspacePath, 'utf8')) as ReviewDataPayload;
    const short = workspace.shorts?.find((candidate) => candidate.id === shortId);
    if (!short) throw new Error(`Recommended Short not found: ${shortId}.`);
    return { short, workspace };
  }

  private async loadTranscript(record: ProductProjectRecord): Promise<TranscriptDocument> {
    if (!record.artifacts.transcript) throw new Error('Canonical transcript artifact is missing.');
    return JSON.parse(await readFile(resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.transcript), 'utf8')) as TranscriptDocument;
  }

  private shortRange(short: ExtractedShort, transcript: TranscriptDocument): { start: number; end: number } {
    const first = transcript.segments.find((segment) => segment.id === short.sourceSegmentIds[0]);
    const last = transcript.segments.find((segment) => segment.id === short.sourceSegmentIds.at(-1));
    if (!first || !last) throw new Error(`Short ${short.id} references transcript segments that no longer exist.`);
    return { start: short.sourceStartSeconds, end: short.sourceEndSeconds };
  }

  private async assertRenderDurationIntegrity(record: ProductProjectRecord, plan: EditPlan, workspace: ReviewDataPayload): Promise<void> {
    const physicalDurationSeconds = await this.verifiedPhysicalDuration(record);
    const requiredTimelineSeconds = Math.max(planEndSeconds(plan), workspace.preview.durationSeconds);
    const planFailures = validatePlanTiming(plan, physicalDurationSeconds, requiredTimelineSeconds);
    if (planFailures.length) throw new Error(planFailures.join(' '));
    const metadataDurationSeconds = record.sourceMetadata?.durationSeconds;
    if (!(Number(metadataDurationSeconds) > 0)) throw new Error('Source duration must be known before rendering.');
    if (Math.abs(Number(metadataDurationSeconds) - physicalDurationSeconds) > SOURCE_DURATION_TOLERANCE_SECONDS) {
      throw new Error(sourceDurationMismatchDiagnostic(physicalDurationSeconds, Number(metadataDurationSeconds)));
    }
    if (record.artifacts.transcript) {
      const transcript = JSON.parse(await readFile(resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.transcript), 'utf8')) as TranscriptDocument;
      this.assertTranscriptTiming(transcript, physicalDurationSeconds);
    }
  }

  private async withSourceDurationValidation(record: ProductProjectRecord, ffprobeCapability?: ProductCapability): Promise<ProductProjectRecord> {
    if (!record.sourceMetadata?.relativePath) return record;
    const checkedAt = new Date().toISOString();
    const base: Omit<SourceDurationValidation, 'status' | 'failures'> = {
      metadataDurationSeconds: record.sourceMetadata.durationSeconds,
      toleranceSeconds: SOURCE_DURATION_TOLERANCE_SECONDS,
      checkedAt,
    };
    let physicalDurationSeconds: number;
    try {
      physicalDurationSeconds = await this.verifiedPhysicalDuration(record, ffprobeCapability);
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      return { ...record, sourceDurationValidation: { ...base, status: 'unavailable', failures: [failure] } };
    }

    const failures: string[] = [];
    const metadataDurationSeconds = record.sourceMetadata.durationSeconds;
    if (!(Number(metadataDurationSeconds) > 0)) {
      failures.push('SOURCE_METADATA_DURATION_MISSING: The project has no verified source duration metadata.');
    } else if (Math.abs(Number(metadataDurationSeconds) - physicalDurationSeconds) > SOURCE_DURATION_TOLERANCE_SECONDS) {
      failures.push(`SOURCE_METADATA_DURATION_MISMATCH: Recorded source duration is ${metadataDurationSeconds} seconds, but ffprobe reports ${physicalDurationSeconds} seconds.`);
    }

    let transcriptEnd: number | undefined;
    if (record.artifacts.transcript) {
      try {
        const transcript = JSON.parse(await readFile(resolve(this.store.projectDirectory(record.workflow.projectId), record.artifacts.transcript), 'utf8')) as TranscriptDocument;
        transcriptEnd = transcriptEndSeconds(transcript);
        failures.push(...validateTranscriptTiming(transcript, physicalDurationSeconds));
      } catch (error) {
        failures.push(`TRANSCRIPT_TIMING_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let approvedTimelineEnd: number | undefined;
    if (record.artifacts.approvedPlan) {
      try {
        const { plan, workspace } = await this.loadApprovedPlanAndWorkspace(record);
        approvedTimelineEnd = Math.max(planEndSeconds(plan), workspace.preview.durationSeconds);
        failures.push(...validatePlanTiming(plan, physicalDurationSeconds, approvedTimelineEnd));
      } catch (error) {
        failures.push(`EDIT_PLAN_TIMING_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const validation: SourceDurationValidation = {
      ...base,
      status: failures.length ? 'mismatch' : 'verified',
      physicalDurationSeconds,
      transcriptEndSeconds: transcriptEnd,
      approvedTimelineEndSeconds: approvedTimelineEnd,
      failures: [...new Set(failures)],
    };
    return { ...record, sourceDurationValidation: validation };
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
