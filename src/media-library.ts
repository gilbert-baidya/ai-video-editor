import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, basename } from 'node:path';
import { promisify } from 'node:util';
import type { MediaAsset, MediaIndex, MediaLibraryRoot, MediaRightsStatus } from './contracts.ts';

const exec = promisify(execFile);
export const MEDIA_INDEXER_VERSION = 'director-v4-media-indexer-3';
const MEDIA_EXTENSIONS = new Map([
  ['.jpg', { kind: 'image' as const, mimeType: 'image/jpeg' }],
  ['.jpeg', { kind: 'image' as const, mimeType: 'image/jpeg' }],
  ['.png', { kind: 'image' as const, mimeType: 'image/png' }],
  ['.webp', { kind: 'image' as const, mimeType: 'image/webp' }],
  ['.mp4', { kind: 'video' as const, mimeType: 'video/mp4' }],
  ['.mov', { kind: 'video' as const, mimeType: 'video/quicktime' }],
  ['.webm', { kind: 'video' as const, mimeType: 'video/webm' }],
]);

interface ProbeResult {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
  }>;
}

export interface MediaIndexOptions {
  roots: MediaLibraryRoot[];
  outputDirectory: string;
  previousIndexPath?: string;
  createThumbnails?: boolean;
}

export interface MediaIndexResult {
  index: MediaIndex;
  cache: { reused: number; indexed: number; removed: number };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && recursive) files.push(...await listFiles(path, recursive));
    if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

function parseFrameRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numerator, denominator] = value.split('/').map(Number);
  return denominator > 0 ? numerator / denominator : undefined;
}

export function normalizeMediaSearchTerms(values: string[]): string[] {
  return [...new Set(values
    .flatMap((value) => value.normalize('NFC').toLocaleLowerCase('und').split(/[^\p{L}\p{M}\p{N}]+/u))
    .filter((term) => [...term].length > 1))];
}

function termsForPath(path: string): string[] {
  return normalizeMediaSearchTerms([basename(path, extname(path))]);
}

function inferTags(path: string): { tags: string[]; categories: string[] } {
  const terms = termsForPath(path);
  const tags = new Set(terms);
  const categories = new Set<string>();
  const categoryTerms: Record<string, string[]> = {
    sermon: ['sermon', 'preaching', 'message'],
    scripture: ['scripture', 'bible', 'acts', 'gospel'],
    prayer: ['prayer', 'pray'],
    nature: ['nature', 'tree', 'water', 'sky', 'mountain', 'garden'],
    illustration: ['illustration', 'example', 'pressure', 'cooker'],
    source: ['source', 'preview', 'proof'],
  };
  for (const [category, matches] of Object.entries(categoryTerms)) {
    if (matches.some((match) => terms.includes(match))) categories.add(category);
  }
  return { tags: [...tags], categories: [...categories] };
}

async function probe(path: string): Promise<ProbeResult> {
  const result = await exec('/opt/homebrew/bin/ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate',
    '-of', 'json', path,
  ], { maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(result.stdout) as ProbeResult;
}

function isReusable(previous: MediaAsset | undefined, previousIndexerVersion: string | undefined, root: MediaLibraryRoot, path: string, sizeBytes: number, modifiedAt: string): boolean {
  return previousIndexerVersion === MEDIA_INDEXER_VERSION
    && previous?.path === path
    && previous.sizeBytes === sizeBytes
    && previous.modifiedAt === modifiedAt
    && previous.libraryRootId === root.id
    && previous.libraryPolicyVersion === root.rightsPolicyVersion
    && previous.rightsStatus === root.defaultRightsStatus
    && previous.rightsBasis === 'owned';
}

async function createThumbnail(assetPath: string, outputPath: string, kind: 'image' | 'video'): Promise<void> {
  await mkdir(resolve(outputPath, '..'), { recursive: true });
  if (kind === 'image') {
    await exec('/opt/homebrew/bin/ffmpeg', ['-y', '-i', assetPath, '-vf', 'scale=480:-2', '-frames:v', '1', outputPath], { maxBuffer: 2 * 1024 * 1024 });
    return;
  }
  await exec('/opt/homebrew/bin/ffmpeg', ['-y', '-ss', '1', '-i', assetPath, '-vf', 'scale=480:-2', '-frames:v', '1', outputPath], { maxBuffer: 2 * 1024 * 1024 });
}

async function indexAsset(root: MediaLibraryRoot, path: string, outputDirectory: string, previousIndexerVersion: string | undefined, previous?: MediaAsset, createThumbnails = false): Promise<{ asset: MediaAsset; reused: boolean }> {
  const metadata = await stat(path);
  const modifiedAt = metadata.mtime.toISOString();
  if (previous && isReusable(previous, previousIndexerVersion, root, path, metadata.size, modifiedAt)) return { asset: previous, reused: true };
  const descriptor = MEDIA_EXTENSIONS.get(extname(path).toLowerCase());
  if (!descriptor) throw new Error(`Unsupported media extension: ${path}`);
  const probed = await probe(path);
  const videoStream = probed.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = probed.streams?.find((stream) => stream.codec_type === 'audio');
  const width = videoStream?.width ?? 0;
  const height = videoStream?.height ?? 0;
  const { tags, categories } = inferTags(path);
  const unusableReasons: string[] = [];
  if (!width || !height) unusableReasons.push('Missing video dimensions.');
  if (descriptor.kind === 'video' && !(Number(probed.format?.duration) > 0)) unusableReasons.push('Missing video duration.');
  const relativePath = relative(root.path, path);
  const asset: MediaAsset = {
    id: `media-${createHash('sha256').update(path).digest('hex').slice(0, 24)}`,
    path,
    relativePath,
    fileName: basename(path),
    kind: descriptor.kind,
    mimeType: descriptor.mimeType,
    sizeBytes: metadata.size,
    modifiedAt,
    durationSeconds: descriptor.kind === 'video' ? Number(probed.format?.duration ?? 0) : undefined,
    width,
    height,
    aspectRatio: height ? width / height : 0,
    codec: videoStream?.codec_name,
    frameRate: parseFrameRate(videoStream?.r_frame_rate),
    hasAudio: Boolean(audioStream),
    tags,
    categories,
    searchTerms: normalizeMediaSearchTerms([basename(path, extname(path)), relativePath, ...tags, ...categories]),
    rightsStatus: root.defaultRightsStatus,
    rightsBasis: 'owned',
    libraryRootId: root.id,
    libraryPolicyVersion: root.rightsPolicyVersion,
    usable: unusableReasons.length === 0,
    unusableReasons,
  };
  if (createThumbnails && asset.usable) {
    const thumbnailPath = join(outputDirectory, 'thumbnails', `${asset.id}.jpg`);
    if (!(await exists(thumbnailPath))) await createThumbnail(path, thumbnailPath, descriptor.kind);
    asset.thumbnailPath = thumbnailPath;
  }
  return { asset, reused: false };
}

export async function indexLocalMedia(options: MediaIndexOptions): Promise<MediaIndexResult> {
  const previous = options.previousIndexPath && await exists(options.previousIndexPath)
    ? JSON.parse(await readFile(options.previousIndexPath, 'utf8')) as MediaIndex
    : undefined;
  const previousByPath = new Map((previous?.assets ?? []).map((asset) => [asset.path, asset]));
  const assets: MediaAsset[] = [];
  let reused = 0;
  for (const root of options.roots.filter((item) => item.enabled)) {
    const rootPath = resolve(root.path);
    if (!(await exists(rootPath))) continue;
    for (const path of await listFiles(rootPath, root.recursive)) {
      const result = await indexAsset({ ...root, path: rootPath }, path, options.outputDirectory, previous?.indexerVersion, previousByPath.get(path), options.createThumbnails);
      assets.push(result.asset);
      if (result.reused) reused += 1;
    }
  }
  const index: MediaIndex = {
    schemaVersion: '1.0',
    indexerVersion: MEDIA_INDEXER_VERSION,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    roots: options.roots,
    assets,
  };
  await mkdir(options.outputDirectory, { recursive: true });
  await writeFile(join(options.outputDirectory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  const currentPaths = new Set(assets.map((asset) => asset.path));
  const removed = (previous?.assets ?? []).filter((asset) => !currentPaths.has(asset.path)).length;
  return { index, cache: { reused, indexed: assets.length - reused, removed } };
}

export function rightsAllowsAutomation(status: MediaRightsStatus): boolean {
  return status === 'approved';
}
