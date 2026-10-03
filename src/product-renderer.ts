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

export function createRemotionRenderAdapter(appRoot: string): NonNullable<ProductStageAdapters['render']> {
  return async (record, sourcePath, outputPath) => {
    if (!record.artifacts.approvedPlan) throw new Error('Approved plan is required for rendering.');
    const planPath = resolve(record.workflow.projectId ? resolve(outputPath, '../..') : '', record.artifacts.approvedPlan);
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as EditPlan;
    if (plan.status !== 'approved') throw new Error('Render requires an approved edit plan.');
    const publicRuntime = resolve(appRoot, 'public', '.product-runtime', record.workflow.projectId);
    await mkdir(publicRuntime, { recursive: true });
    const publicSource = resolve(publicRuntime, `source${resolve(sourcePath).toLowerCase().endsWith('.mov') ? '.mov' : '.mp4'}`);
    await copyFile(sourcePath, publicSource);
    const workspacePath = resolve(outputPath, '../..', 'artifacts/review-workspace.json');
    const workspace = JSON.parse(await readFile(workspacePath, 'utf8')) as ReviewDataPayload;
    const referencedIds = new Set(plan.operations.filter((operation) => operation.type === 'broll').map((operation) => operation.assetId));
    const sourceMediaAssets = workspace.mediaIndex.assets.filter((asset) => referencedIds.has(asset.id));
    const missingIds = [...referencedIds].filter((id) => !sourceMediaAssets.some((asset) => asset.id === id));
    if (missingIds.length) throw new Error(`Approved B-roll asset(s) missing from the media index: ${missingIds.join(', ')}.`);
    const durationSeconds = record.sourceMetadata?.durationSeconds;
    if (!durationSeconds || durationSeconds <= 0) throw new Error('Source duration must be known before rendering.');
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
    const inputProps = {
      sourcePath: relative(resolve(appRoot, 'public'), publicSource),
      editPlan: renderPlan.plan,
      graphicFontSize: 62,
      durationSeconds,
      mediaAssets,
      videoFormat: record.workflow.render.format,
    };
    const composition = await selectComposition({ serveUrl, id: 'BanglaFoundation', inputProps });
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

      const { discoverCapabilities } = await import('./product-capabilities.ts');
      const capabilities = await discoverCapabilities({ root: appRoot });
      const ffprobePath = capabilities.ffprobe.state === 'AVAILABLE' ? capabilities.ffprobe.detail.split(' is available.')[0] : 'ffprobe';
      integrity = await validateMediaIntegrity(tempOutputPath, ffprobePath, record.workflow.render.format, { expectedDurationSeconds: durationSeconds });
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
      durationSeconds,
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
