import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, relative, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { EditPlan } from './contracts.ts';
import type { ProductStageAdapters } from './product-orchestrator.ts';
import type { MediaAsset, SermonAnalysis } from './contracts.ts';
import type { ReviewDataPayload } from './DirectorReviewWorkspace.tsx';
import { createRendererPlan, evaluateEditorialQuality } from './editorial-quality.ts';

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
    const mediaAssets: MediaAsset[] = [];
    for (const asset of sourceMediaAssets) {
      const target = resolve(publicRuntime, `media-${asset.id.replace(/[^a-zA-Z0-9_-]/g, '-')}${extname(asset.path)}`);
      await copyFile(asset.path, target);
      mediaAssets.push({ ...asset, path: `public/${relative(resolve(appRoot, 'public'), target)}` });
    }
    const renderPlan = createRendererPlan(plan, mediaAssets);
    const serveUrl = await bundle({ entryPoint: resolve(appRoot, 'src/entry.tsx'), publicDir: resolve(appRoot, 'public') });
    const durationSeconds = record.sourceMetadata?.durationSeconds;
    if (!durationSeconds || durationSeconds <= 0) throw new Error('Source duration must be known before rendering.');
    const inputProps = {
      sourcePath: relative(resolve(appRoot, 'public'), publicSource),
      editPlan: renderPlan.plan,
      graphicFontSize: 62,
      durationSeconds,
      mediaAssets,
      videoFormat: record.workflow.render.format,
    };
    const composition = await selectComposition({ serveUrl, id: 'BanglaFoundation', inputProps });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      audioCodec: 'aac',
      outputLocation: outputPath,
      inputProps,
      x264Preset: 'veryfast',
    });
    const output = await stat(outputPath);
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
      video: output.size > 0,
      audio: output.size > 0,
      directorCoverage: record.workflow.coveragePercent === 100 && !record.workflow.provider.fallbackUsed,
      brollRights: !record.workflow.unresolvedBlockers.some((item) => item.toLowerCase().includes('rights')),
      placement: !record.workflow.unresolvedBlockers.some((item) => item.toLowerCase().includes('placement')),
      bengaliGraphics: !record.workflow.unresolvedBlockers.some((item) => item.toLowerCase().includes('bengali')),
      reviewReadiness: record.workflow.stages.review.status === 'completed',
      editorialQuality: editorial.passed,
      editorial,
      outputPath: basename(outputPath),
    };
  };
}
