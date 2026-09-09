import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { EditPlan } from './contracts.ts';
import type { ProductStageAdapters } from './product-orchestrator.ts';

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
    const serveUrl = await bundle({ entryPoint: resolve(appRoot, 'src/entry.tsx'), publicDir: resolve(appRoot, 'public') });
    const durationSeconds = record.sourceMetadata?.durationSeconds;
    if (!durationSeconds || durationSeconds <= 0) throw new Error('Source duration must be known before rendering.');
    const inputProps = {
      sourcePath: relative(resolve(appRoot, 'public'), publicSource),
      editPlan: plan,
      graphicFontSize: 62,
      durationSeconds,
      mediaAssets: [],
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
    return {
      video: output.size > 0,
      audio: output.size > 0,
      directorCoverage: record.workflow.coveragePercent === 100 && !record.workflow.provider.fallbackUsed,
      brollRights: !record.workflow.unresolvedBlockers.some((item) => item.toLowerCase().includes('rights')),
      placement: !record.workflow.unresolvedBlockers.some((item) => item.toLowerCase().includes('placement')),
      bengaliGraphics: !record.workflow.unresolvedBlockers.some((item) => item.toLowerCase().includes('bengali')),
      reviewReadiness: record.workflow.stages.review.status === 'completed',
      outputPath: basename(outputPath),
    };
  };
}
