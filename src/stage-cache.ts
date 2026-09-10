import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sha256 } from './foundation.ts';

export const PIPELINE_STAGES = [
  'media-inspection',
  'transcript-loading',
  'canonical-transcript-normalization',
  'sermon-chunk-generation',
  'director-analysis',
  'director-normalization',
  'director-editorial-enrichment',
  'edit-plan',
  'visual-intelligence',
  'media-ranking',
  'review-overrides',
  'rendering',
  'qa',
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

export interface StageCacheRecord<T> {
  schemaVersion: '1.0';
  stage: PipelineStage;
  key: string;
  inputHashes: Record<string, string>;
  createdAt: string;
  value: T;
}

export interface StageRunResult<T> {
  value: T;
  cache: { hit: boolean; key: string; path: string };
  durationMs: number;
}

export function stageCacheKey(stage: PipelineStage, inputHashes: Record<string, string>, version: string): string {
  return sha256(JSON.stringify({ stage, version, inputHashes: Object.entries(inputHashes).sort(([left], [right]) => left.localeCompare(right)) }));
}

export async function runCachedStage<T>(
  cacheRoot: string,
  stage: PipelineStage,
  inputHashes: Record<string, string>,
  version: string,
  execute: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true,
): Promise<StageRunResult<T>> {
  const started = performance.now();
  const key = stageCacheKey(stage, inputHashes, version);
  const path = resolve(cacheRoot, `${stage}-${key}.json`);
  if (await stat(path).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) {
    const record = JSON.parse(await readFile(path, 'utf8')) as StageCacheRecord<T>;
    if (record.key !== key || record.stage !== stage) throw new Error(`${stage}: cache record identity mismatch.`);
    return { value: record.value, cache: { hit: true, key, path }, durationMs: performance.now() - started };
  }

  const value = await execute();
  if (!shouldCache(value)) return { value, cache: { hit: false, key, path }, durationMs: performance.now() - started };
  const record: StageCacheRecord<T> = { schemaVersion: '1.0', stage, key, inputHashes, createdAt: new Date().toISOString(), value };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
  return { value, cache: { hit: false, key, path }, durationMs: performance.now() - started };
}
