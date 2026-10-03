import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { MediaAsset } from './contracts.ts';
import { assetMetadataIssues, rightsEvidenceIssues, sniffImage, sniffVideoContainer } from './media-asset-validation.ts';

export interface ImageAssetImportInput {
  sourcePath: string;
  destinationDirectory: string;
  relativeDirectory: string;
  description: string;
  rightsStatus: MediaAsset['rightsStatus'];
  rightsBasis: MediaAsset['rightsBasis'];
  rightsNote?: string;
  now?: Date;
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function readHeader(path: string, length: number): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Builds a media-index entry from the real file contents. Nothing is defaulted: unreadable or empty
// files, unknown formats and unprovable rights make the import fail instead of producing usable metadata.
export async function importImageAsset(input: ImageAssetImportInput): Promise<MediaAsset> {
  const info = await stat(input.sourcePath);
  if (!info.isFile()) throw new Error('Import source is not a regular file.');
  if (info.size === 0) throw new Error('Import source is empty (0 bytes).');
  const rightsIssues = rightsEvidenceIssues(input);
  if (rightsIssues.length) throw new Error(rightsIssues.join(' '));
  const bytes = await readFile(input.sourcePath);
  const sniffed = sniffImage(bytes);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const id = `media-${contentHash.slice(0, 24)}`;
  const fileName = `${id}.${sniffed.extension}`;
  const path = resolve(input.destinationDirectory, fileName);
  await mkdir(dirname(path), { recursive: true });
  await copyFile(input.sourcePath, path);
  const copied = await stat(path);
  if (copied.size !== info.size || await hashFile(path) !== contentHash) {
    await rm(path, { force: true });
    throw new Error('Imported copy does not match the source file checksum.');
  }
  const now = input.now ?? new Date();
  const asset: MediaAsset = {
    id,
    path,
    relativePath: `${input.relativeDirectory}/${fileName}`,
    fileName,
    kind: 'image',
    mimeType: sniffed.mimeType,
    sizeBytes: copied.size,
    modifiedAt: info.mtime.toISOString(),
    contentHash,
    width: sniffed.width,
    height: sniffed.height,
    aspectRatio: sniffed.width / sniffed.height,
    hasAudio: false,
    tags: [],
    categories: [],
    searchTerms: [input.description],
    rightsStatus: input.rightsStatus,
    rightsBasis: input.rightsBasis,
    rightsNote: input.rightsNote?.trim() || undefined,
    rightsConfirmedAt: input.rightsStatus === 'approved' ? now.toISOString() : undefined,
    originalFileName: basename(input.sourcePath),
    importedAt: now.toISOString(),
    libraryRootId: 'local-import',
    libraryPolicyVersion: '1.0',
    usable: true,
    unusableReasons: [],
  };
  const issues = assetMetadataIssues(asset);
  if (issues.length) throw new Error(`Imported asset metadata is invalid: ${issues.join(' ')}`);
  return asset;
}

// Re-reads the file behind an index entry and reports every way the stored metadata disagrees with it.
export async function verifyAssetOnDisk(asset: MediaAsset): Promise<string[]> {
  const issues = assetMetadataIssues(asset);
  let info;
  try {
    info = await stat(asset.path);
  } catch {
    return [...issues, `Asset file is missing: ${asset.path}.`];
  }
  if (!info.isFile() || info.size === 0) return [...issues, 'Asset file is empty or not a regular file.'];
  if (info.size !== asset.sizeBytes) issues.push(`Stored size ${asset.sizeBytes} does not match actual size ${info.size}.`);
  if (asset.contentHash && await hashFile(asset.path) !== asset.contentHash) issues.push('Stored SHA-256 does not match the file contents.');
  try {
    if (asset.kind === 'image') {
      const sniffed = sniffImage(await readFile(asset.path));
      if (sniffed.mimeType !== asset.mimeType) issues.push(`Stored MIME type ${asset.mimeType} does not match actual ${sniffed.mimeType}.`);
      if (sniffed.width !== asset.width || sniffed.height !== asset.height) issues.push(`Stored dimensions ${asset.width}×${asset.height} do not match actual ${sniffed.width}×${sniffed.height}.`);
    } else {
      const container = sniffVideoContainer(await readHeader(asset.path, 32));
      if (!container) issues.push('Video file content is not a recognised MP4/MOV/WebM container.');
      else if (container.mimeType !== asset.mimeType) issues.push(`Stored MIME type ${asset.mimeType} does not match actual ${container.mimeType}.`);
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return issues;
}
