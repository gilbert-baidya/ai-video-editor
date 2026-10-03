import type { MediaAsset } from './contracts.ts';

export type ImageFormat = 'png' | 'jpeg' | 'webp';
export type VideoContainer = 'mp4' | 'mov' | 'webm';

export interface SniffedImage {
  format: ImageFormat;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
}

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_IMAGE_DIMENSION = 32768;

const ascii = (bytes: Uint8Array, offset: number, length: number): string => String.fromCharCode(...bytes.subarray(offset, offset + length));
const u16be = (bytes: Uint8Array, offset: number): number => (bytes[offset] << 8) | bytes[offset + 1];
const u32be = (bytes: Uint8Array, offset: number): number => ((bytes[offset] * 2 ** 24) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]);
const u16le = (bytes: Uint8Array, offset: number): number => bytes[offset] | (bytes[offset + 1] << 8);
const u24le = (bytes: Uint8Array, offset: number): number => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') throw new Error('PNG header is truncated or missing its IHDR chunk.');
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('JPEG marker stream is corrupt.');
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = u16be(bytes, offset);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (offset + 7 > bytes.length) break;
      return { height: u16be(bytes, offset + 3), width: u16be(bytes, offset + 5) };
    }
    if (length < 2) throw new Error('JPEG segment length is invalid.');
    offset += length;
  }
  throw new Error('JPEG has no readable frame header.');
}

function webpSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 30 || ascii(bytes, 8, 4) !== 'WEBP') throw new Error('WebP header is truncated.');
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) throw new Error('WebP lossy frame header is invalid.');
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) throw new Error('WebP lossless signature is invalid.');
    return { width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
  throw new Error(`Unsupported WebP chunk ${chunk}.`);
}

// Format and dimensions are derived from file content only; the file extension is never trusted.
export function sniffImage(bytes: Uint8Array): SniffedImage {
  if (bytes.length === 0) throw new Error('Image file is empty (0 bytes).');
  let format: ImageFormat;
  let size: { width: number; height: number };
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') { format = 'png'; size = pngSize(bytes); }
  else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) { format = 'jpeg'; size = jpegSize(bytes); }
  else if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') { format = 'webp'; size = webpSize(bytes); }
  else throw new Error('File content is not a supported image (PNG, JPEG or WebP).');
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0 || size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) {
    throw new Error(`Image reports invalid dimensions ${size.width}×${size.height}.`);
  }
  return { format, mimeType: `image/${format}`, extension: format === 'jpeg' ? 'jpg' : format, ...size };
}

export function sniffVideoContainer(bytes: Uint8Array): { container: VideoContainer; mimeType: string } | undefined {
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    return ascii(bytes, 8, 4) === 'qt  ' ? { container: 'mov', mimeType: 'video/quicktime' } : { container: 'mp4', mimeType: 'video/mp4' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { container: 'webm', mimeType: 'video/webm' };
  return undefined;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

// Pure structural checks. Whether the bytes on disk still match is verified separately by verifyAssetOnDisk.
export function assetMetadataIssues(asset: MediaAsset): string[] {
  const issues: string[] = [];
  if (!asset.id || !asset.path) issues.push('Asset identity (id/path) is missing.');
  if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0) issues.push(`Asset size ${String(asset.sizeBytes)} is not a positive byte count.`);
  if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width <= 0 || asset.height <= 0) issues.push(`Asset dimensions ${String(asset.width)}×${String(asset.height)} are invalid.`);
  else if (!Number.isFinite(asset.aspectRatio) || Math.abs(asset.aspectRatio - asset.width / asset.height) > 0.01) issues.push('Asset aspect ratio does not match its dimensions.');
  if (asset.kind === 'image' && !ALLOWED_IMAGE_MIME_TYPES.includes(asset.mimeType)) issues.push(`Image asset has unsupported MIME type ${String(asset.mimeType)}.`);
  if (asset.kind === 'video') {
    if (!ALLOWED_VIDEO_MIME_TYPES.includes(asset.mimeType)) issues.push(`Video asset has unsupported MIME type ${String(asset.mimeType)}.`);
    if (!(Number(asset.durationSeconds) > 0)) issues.push('Video asset has no positive duration.');
  }
  if (asset.kind !== 'image' && asset.kind !== 'video') issues.push(`Asset kind ${String(asset.kind)} is not supported.`);
  if (!asset.contentHash || !HASH_PATTERN.test(asset.contentHash)) issues.push('Asset has no valid SHA-256 content hash.');
  return issues;
}

export interface RightsEvidenceInput {
  rightsStatus: MediaAsset['rightsStatus'];
  rightsBasis: MediaAsset['rightsBasis'];
  rightsNote?: string;
}

// Approval is never inferred: it needs a declared basis, and any basis other than ownership needs written evidence.
export function rightsEvidenceIssues(input: RightsEvidenceInput): string[] {
  if (input.rightsStatus !== 'approved') return [];
  const issues: string[] = [];
  if (input.rightsBasis === 'unknown') issues.push('Approved rights require a declared basis (owned, permission, generated, public-domain or licensed).');
  else if (input.rightsBasis !== 'owned' && !input.rightsNote?.trim()) issues.push(`Approved ${input.rightsBasis} rights require a written rights note describing the evidence.`);
  return issues;
}
