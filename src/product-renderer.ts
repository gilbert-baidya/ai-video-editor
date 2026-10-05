import { copyFile, mkdir, readFile, stat, rename, rm } from 'node:fs/promises';
import { basename, extname, relative, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { EditPlan } from './contracts.ts';
import type { ProductStageAdapters } from './product-orchestrator.ts';
import type { FinalQaSummary } from './product-workflow.ts';
import type { MediaAsset, SermonAnalysis } from './contracts.ts';
import type { ReviewDataPayload } from './DirectorReviewWorkspace.tsx';
import { createRendererPlan, evaluateEditorialQuality } from './editorial-quality.ts';
import { validateMediaIntegrity, verifyAudioContinuity } from './media-integrity.ts';
import { verifyAssetOnDisk } from './media-import.ts';
import { SOURCE_DURATION_TOLERANCE_SECONDS, planEndSeconds, sourceDurationMismatchDiagnostic, validatePlanTiming } from './source-duration.ts';

export function createRemotionRenderAdapter(appRoot: string): NonNullable<ProductStageAdapters['render']> {
  return async (record, sourcePath, outputPath, payload?: any) => {
    const workspacePath = resolve(outputPath, '../..', 'artifacts/review-workspace.json');
    const workspace = JSON.parse(await readFile(workspacePath, 'utf8')) as ReviewDataPayload;
    const isShort = typeof payload?.shortId === 'string';
    let shortStart = 0;
    let shortEnd = 60;
    let plan: EditPlan;

    if (isShort) {
      const state = record.workflow.shorts?.[payload.shortId];
      if (state?.approvalStatus !== 'approved') throw new Error('Render requires an individually approved Short.');
      const short = workspace.shorts?.find((s: any) => s.id === payload.shortId);
      if (!short) throw new Error('Requested short was not found in the workspace.');
      if (!record.artifacts.transcript) throw new Error('Canonical transcript artifact is required for a Short render.');
      const transcriptPath = resolve(record.workflow.projectId ? resolve(outputPath, '../..') : '', record.artifacts.transcript!);
      const transcript = JSON.parse(await readFile(transcriptPath, 'utf8'));
      const firstSeg = transcript.segments.find((s: any) => s.id === short.sourceSegmentIds[0]);
      const lastSeg = transcript.segments.find((s: any) => s.id === short.sourceSegmentIds[short.sourceSegmentIds.length - 1]);
      if (!firstSeg || !lastSeg) throw new Error('The approved Short references transcript segments that no longer exist.');
      shortStart = firstSeg.start;
      shortEnd = lastSeg.end;
      plan = {
        schemaVersion: '2.0',
        projectId: record.workflow.projectId,
        sourceTranscriptHash: workspace.aiPlan.sourceTranscriptHash,
        status: 'approved',
        createdBy: { provider: 'human-approved-short', model: workspace.directorExecution?.model ?? 'unknown' },
        operations: short.sourceSegmentIds.map((id: string, i: number): any => {
        const seg = transcript.segments.find((s: any) => s.id === id);
        if (!seg) return null;
        return {
          id: `caption-${i}`,
          type: 'caption',
          start: seg.start,
          end: seg.end,
          text: seg.text,
          confidence: 1,
          reason: 'Generated for short'
        };
        }).filter(Boolean),
      };
    } else {
      if (!record.artifacts.approvedPlan) throw new Error('Approved plan is required for rendering.');
      const planPath = resolve(record.workflow.projectId ? resolve(outputPath, '../..') : '', record.artifacts.approvedPlan);
      plan = JSON.parse(await readFile(planPath, 'utf8')) as EditPlan;
      if (plan.status !== 'approved') throw new Error('Render requires an approved edit plan.');
    }
    
    const { discoverCapabilities } = await import('./product-capabilities.ts');
    const capabilities = await discoverCapabilities({ root: appRoot });
    const { probeSource } = await import('./source-ingestion.ts');
    const probedSource = await probeSource(sourcePath, capabilities.ffprobe);
    const durationSeconds = Number(probedSource.durationSeconds);
    if (!(durationSeconds > 0)) throw new Error('Source duration must be known before rendering.');
    if (isShort && (shortStart < 0 || shortEnd <= shortStart || shortEnd > durationSeconds + SOURCE_DURATION_TOLERANCE_SECONDS)) {
      throw new Error(`Short source range ${shortStart.toFixed(3)}–${shortEnd.toFixed(3)} exceeds the physical source duration ${durationSeconds.toFixed(3)}.`);
    }
    
    if (!isShort) {
      const requiredTimelineSeconds = Math.max(planEndSeconds(plan), Number(workspace.preview?.durationSeconds ?? 0));
      const planFailures = validatePlanTiming(plan, durationSeconds, requiredTimelineSeconds);
      if (planFailures.length) throw new Error(planFailures.join(' '));
    }
    
    const recordedDurationSeconds = record.sourceMetadata?.durationSeconds;
    if (!(Number(recordedDurationSeconds) > 0)) throw new Error('Source duration must be known before rendering.');
    if (Math.abs(Number(recordedDurationSeconds) - durationSeconds) > SOURCE_DURATION_TOLERANCE_SECONDS) {
      throw new Error(sourceDurationMismatchDiagnostic(durationSeconds, Number(recordedDurationSeconds)));
    }
    
    const referencedIds = new Set(plan.operations.filter((operation) => operation.type === 'broll').map((operation) => operation.assetId));
    const sourceMediaAssets = workspace.mediaIndex.assets.filter((asset) => referencedIds.has(asset.id));
    const missingIds = [...referencedIds].filter((id) => !sourceMediaAssets.some((asset) => asset.id === id));
    if (missingIds.length) throw new Error(`Approved B-roll asset(s) missing from the media index: ${missingIds.join(', ')}.`);
    const publicRuntime = resolve(appRoot, 'public', '.product-runtime', record.workflow.projectId);
    await mkdir(publicRuntime, { recursive: true });
    const publicSource = resolve(publicRuntime, `source${resolve(sourcePath).toLowerCase().endsWith('.mov') ? '.mov' : '.mp4'}`);
    await copyFile(sourcePath, publicSource);
    const mediaAssets: MediaAsset[] = [];
    for (const asset of sourceMediaAssets) {
      const assetIssues = await verifyAssetOnDisk(asset);
      if (assetIssues.length) throw new Error(`B-roll asset ${asset.id} failed file verification: ${assetIssues.join(' ')}`);
      const target = resolve(publicRuntime, `media-${asset.id.replace(/[^a-zA-Z0-9_-]/g, '-')}${extname(asset.path)}`);
      await copyFile(asset.path, target);
      mediaAssets.push({ ...asset, path: `public/${relative(resolve(appRoot, 'public'), target)}` });
    }
    
    const renderPlan = createRendererPlan(plan, mediaAssets, durationSeconds);
    const serveUrl = await bundle({ entryPoint: resolve(appRoot, 'src/entry.tsx'), publicDir: resolve(appRoot, 'public') });
    
    let compositionId = 'BanglaFoundation';
    const inputProps: any = {
      sourcePath: relative(resolve(appRoot, 'public'), publicSource),
      editPlan: renderPlan.plan,
      graphicFontSize: 62,
      durationSeconds,
      mediaAssets,
      videoFormat: record.workflow.render.format,
    };
    
    if (isShort) {
      compositionId = 'BanglaShort';
      inputProps.sourceStartSeconds = shortStart;
      inputProps.sourceEndSeconds = shortEnd;
    }
    
    const composition = await selectComposition({ serveUrl, id: compositionId, inputProps });
    const tempOutputPath = `${outputPath}.${process.pid}.tmp.mp4`;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      audioCodec: 'aac',
      outputLocation: tempOutputPath,
      inputProps,
      x264Preset: 'veryfast',
      pixelFormat: 'yuv420p',
    });
    let output: Awaited<ReturnType<typeof stat>>;
    let integrity: Awaited<ReturnType<typeof validateMediaIntegrity>>;
    let audioContinuity: NonNullable<FinalQaSummary['audioContinuity']>;
    try {
      output = await stat(tempOutputPath);
      if (output.size === 0) throw new Error('Render produced a zero-byte file.');


      const ffprobePath = capabilities.ffprobe.state === 'AVAILABLE' ? capabilities.ffprobe.detail.split(' is available.')[0] : 'ffprobe';
      const expectedFormat = isShort ? { ...record.workflow.render.format, width: 1080, height: 1920, orientation: 'portrait' as const } : record.workflow.render.format;
      const expectedDuration = isShort ? (shortEnd - shortStart) : durationSeconds;
      integrity = await validateMediaIntegrity(tempOutputPath, ffprobePath, expectedFormat, { expectedDurationSeconds: expectedDuration });
      if (!integrity.passed) throw new Error(`Media integrity validation failed: ${integrity.failures.join(' ')}`);

      const ffmpegPath = capabilities.ffmpeg.state === 'AVAILABLE' ? capabilities.ffmpeg.detail.split(' is available.')[0] : undefined;
      audioContinuity = ffmpegPath
        ? { verified: true, failures: await verifyAudioContinuity({ ffmpegPath, sourcePath, outputPath: tempOutputPath, windows: plan.operations.filter((operation) => operation.type === 'broll').map((operation) => ({ id: operation.id, start: operation.start, end: operation.end })) }) }
        : { verified: false, failures: ['ffmpeg is unavailable, so sermon-audio continuity could not be measured.'] };
      if (audioContinuity.verified && audioContinuity.failures.length) throw new Error(`Audio continuity validation failed: ${audioContinuity.failures.join(' ')}`);
    } catch (error) {
      await rm(tempOutputPath, { force: true });
      throw error;
    }
    await rename(tempOutputPath, outputPath);

    const editorial = evaluateEditorialQuality({
      analysis: workspace.analysis as SermonAnalysis,
      approvedPlan: plan,
      mediaAssets,
      durationSeconds: isShort ? shortEnd - shortStart : durationSeconds,
      canonicalCoveragePercent: record.workflow.coveragePercent,
      format: record.workflow.render.format,
      sourceWidth: record.sourceMetadata?.width ?? record.workflow.render.width,
      sourceHeight: record.sourceMetadata?.height ?? record.workflow.render.height,
      review: record.review,
      renderedOperationIds: renderPlan.audit.renderedOperations,
    });

    return {
      video: integrity.videoCodec === 'h264' && integrity.width > 0 && integrity.height > 0,
      audio: integrity.audioCodec === 'aac' && audioContinuity.verified && audioContinuity.failures.length === 0,
      audioContinuity,
      directorCoverage: record.workflow.coveragePercent === 100 && !record.workflow.provider.fallbackUsed,
      brollRights: !record.workflow.unresolvedBlockers.some((item) => item.toLowerCase().includes('rights')),
      placement: !record.workflow.unresolvedBlockers.some((item) => item.toLowerCase().includes('placement')),
      bengaliGraphics: !record.workflow.unresolvedBlockers.some((item) => item.toLowerCase().includes('bengali')),
      reviewReadiness: record.workflow.stages.review.status === 'completed',
      editorialQuality: editorial.passed,
      editorial,
      mediaIntegrity: integrity.passed,
      mediaExport: integrity,
      outputPath: basename(outputPath),
    };
  };
}
