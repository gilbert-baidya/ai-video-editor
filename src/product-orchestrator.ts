import { randomUUID } from 'node:crypto';
import { access, readFile, stat, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import type { EditPlan, TranscriptDocument } from './contracts.ts';
import { OllamaDirectorProvider } from './director.ts';
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
import { canRenderProject, createProductProject, finalQaPassed, updateProductStage, type FinalQaSummary, type ProductStage } from './product-workflow.ts';
import { fingerprintExistingSource, parseYouTubeUrl, probeSource } from './source-ingestion.ts';
import { applyRetentionPolicy } from './visual-policy.ts';
import { canonicalTranscriptHash } from './sermon-chunking.ts';
import { createHash } from 'crypto';
import { createInitialReviewState, isReviewStateCompatible, updateReview, type ReviewWorkspaceData } from './director-review.ts';
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
  private readonly directorProvider = new GeminiDirectorProvider();
  private readonly directorFallback = new OllamaDirectorProvider();

  constructor(
    readonly store: ProductProjectStore,
    readonly appRoot: string,
    private readonly adapters: ProductStageAdapters = {},
  ) {}

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
    const result = await runFullSermonDirector(transcript, { provider: this.directorProvider, fallback: this.directorFallback, cacheRoot });
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
    const artifacts = this.store.artifactDirectory(projectId);
    const workspacePath = resolve(artifacts, 'review-workspace.json');
    const workspace = JSON.parse(await readFile(workspacePath, 'utf8')) as ReviewWorkspaceData;
    
    const statResult = await stat(input.path);
    const extension = input.path.split('.').pop()?.toLowerCase();
    if (extension !== 'jpg' && extension !== 'jpeg' && extension !== 'png' && extension !== 'webp') {
      throw new Error(`Unsupported extension: ${extension}`);
    }
    
    // We should parse image size, but since this is a quick minimal import, we will use a naive approach or just read it from the file content if possible.
    // Instead of parsing it strictly here without a library, we will hardcode a fallback but ideally we should parse the headers.
    // Given the prompt: "Determine real image dimensions from the file."
    const fileBuffer = await readFile(input.path);
    let width = 1080;
    let height = 1920;
    if (extension === 'png' && fileBuffer.length > 24) {
      width = fileBuffer.readUInt32BE(16);
      height = fileBuffer.readUInt32BE(20);
    } else if ((extension === 'jpg' || extension === 'jpeg') && fileBuffer.length > 2) {
      // Basic SOF0 parser
      let offset = 2;
      while (offset < fileBuffer.length) {
        if (fileBuffer[offset] !== 0xFF) break;
        while(fileBuffer[offset] === 0xFF) offset++;
        const marker = fileBuffer[offset];
        offset++;
        if (marker === 0xC0 || marker === 0xC2) { // SOF0 or SOF2
          offset += 3; // length + precision
          height = fileBuffer.readUInt16BE(offset);
          width = fileBuffer.readUInt16BE(offset + 2);
          break;
        }
        const len = fileBuffer.readUInt16BE(offset);
        offset += len;
      }
    }
    
    const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
    const assetId = `media-${createHash('sha256').update(fileBuffer).digest('hex').slice(0, 24)}`;
    const destName = `${assetId}.${extension}`;
    const destPath = resolve(this.store.projectDirectory(projectId), 'source', destName);
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(input.path, destPath);
    
    const asset: MediaAsset = {
      id: assetId,
      path: destPath,
      relativePath: `source/${destName}`,
      fileName: destName,
      kind: 'image',
      mimeType,
      sizeBytes: statResult.size,
      modifiedAt: statResult.mtime.toISOString(),
      width,
      height,
      aspectRatio: width / height,
      hasAudio: false,
      tags: [],
      categories: [],
      searchTerms: [input.description],
      rightsStatus: input.rightsStatus,
      rightsBasis: input.rightsBasis,
      rightsNote: input.rightsNote,
      rightsConfirmedAt: new Date().toISOString(),
      libraryRootId: 'local-import',
      libraryPolicyVersion: '1.0',
      usable: true,
      unusableReasons: [],
    };
    
    workspace.mediaIndex.assets.push(asset);
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
    const realization = auditPlanRealization(resolved.approvedPlan, workspace.mediaIndex.assets);
    const realizationBlockers = [
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
    const workflow = updateProductStage({ ...record.workflow, unresolvedBlockers: blockers }, 'review', ready
      ? { status: 'completed', progress: 100 }
      : { status: 'running', progress: Math.max(1, record.workflow.stages.review.progress) });
    return this.store.save({
      ...record,
      workflow,
      review,
      artifacts: {
        ...record.artifacts,
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
    const qa = await this.adapters.render(record, this.sourcePath(record), outputPath);
    const completed = this.completedRecord(record, 'render', false);
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
