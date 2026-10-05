import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, rename, stat, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { ProductCapability, SourceMetadata } from './product-api.ts';
import { assertWithinRoot, sanitizeFileName } from './product-store.ts';

export interface YouTubeUrl {
  videoId: string;
  canonicalUrl: string;
}

export function parseYouTubeUrl(input: string): YouTubeUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('A valid HTTPS YouTube URL is required.');
  }
  if (url.protocol !== 'https:') throw new Error('YouTube URL must use HTTPS.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let videoId = '';
  if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] ?? '';
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? '';
    else if (/^\/(shorts|live)\/[^/]+$/.test(url.pathname)) videoId = url.pathname.split('/')[2] ?? '';
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('YouTube URL does not contain a valid video ID.');
  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

export async function streamUpload(
  request: IncomingMessage,
  sourceRoot: string,
  rawFileName: string,
  mimeType: string | undefined,
  expectedBytes?: number,
): Promise<SourceMetadata> {
  const fileName = sanitizeFileName(rawFileName);
  const finalPath = assertWithinRoot(sourceRoot, resolve(sourceRoot, fileName));
  const temporaryPath = `${finalPath}.${process.pid}.part`;
  const alreadyExists = await access(finalPath).then(() => true, () => false);
  if (alreadyExists) throw new Error('This project already has a source with that filename.');
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const { createWriteStream } = await import('node:fs');
  const output = createWriteStream(temporaryPath, { flags: 'wx' });
  try {
    await new Promise<void>((done, reject) => {
      request.on('aborted', () => reject(new Error('Upload was cancelled by the client.')));
      request.on('data', (chunk: Buffer) => {
        sizeBytes += chunk.length;
        hash.update(chunk);
        if (expectedBytes !== undefined && sizeBytes > expectedBytes) request.destroy(new Error('Upload exceeded declared content length.'));
      });
      request.once('error', reject);
      output.once('error', reject);
      output.once('finish', done);
      request.pipe(output);
    });
    if (!sizeBytes) throw new Error('Uploaded source is empty.');
    if (expectedBytes !== undefined && sizeBytes !== expectedBytes) throw new Error('Uploaded byte count does not match Content-Length.');
    await rename(temporaryPath, finalPath);
    return {
      kind: 'local-video',
      fileName,
      mimeType: mimeType || 'application/octet-stream',
      sizeBytes,
      sha256: hash.digest('hex'),
      relativePath: `source/${fileName}`,
      immutable: true,
    };
  } catch (error) {
    output.destroy();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function probeSource(path: string, ffprobe: ProductCapability): Promise<Partial<SourceMetadata>> {
  if (ffprobe.state !== 'AVAILABLE') throw new Error(`Source duration cannot be verified because ffprobe is unavailable. ${ffprobe.detail}`);
  const executablePath = ffprobe.detail.split(' is available.')[0];
  const output = await new Promise<string>((done, reject) => {
    const child = spawn(executablePath, ['-v', 'error', '-show_entries', 'format=duration,size:stream=index,codec_type,duration,width,height:stream_tags=rotate:stream_side_data=rotation', '-of', 'json', path]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? done(stdout) : reject(new Error(stderr || `ffprobe exited with ${code}.`)));
  });
  const parsed = JSON.parse(output) as VideoProbeResult;
  const dimensions = effectiveVideoDimensions(parsed);
  const containerDurationSeconds = positiveDuration(parsed.format?.duration);
  const videoDurationSeconds = streamDuration(parsed, 'video');
  const audioDurationSeconds = streamDuration(parsed, 'audio');
  const durationSeconds = containerDurationSeconds ?? Math.max(videoDurationSeconds ?? 0, audioDurationSeconds ?? 0);
  if (!(durationSeconds > 0)) throw new Error('Source duration cannot be verified because ffprobe did not report a positive container, video, or audio duration.');
  if (!dimensions) throw new Error('Source orientation is unknown because ffprobe did not report video dimensions.');
  return {
    durationSeconds,
    containerDurationSeconds,
    videoDurationSeconds,
    audioDurationSeconds,
    durationSource: 'ffprobe',
    probedAt: new Date().toISOString(),
    sizeBytes: Number(parsed.format?.size ?? (await stat(path)).size),
    width: dimensions?.width,
    height: dimensions?.height,
  };
}

export interface VideoProbeResult {
  format?: { duration?: string; size?: string };
  streams?: Array<{
    index?: number;
    codec_type?: string;
    duration?: string;
    width?: number;
    height?: number;
    tags?: { rotate?: string };
    side_data_list?: Array<{ rotation?: number }>;
  }>;
}

export function effectiveVideoDimensions(probe: VideoProbeResult): { width: number; height: number } | undefined {
  const stream = probe.streams?.find((candidate) => candidate.codec_type === 'video' || (candidate.width && candidate.height));
  if (!stream?.width || !stream.height) return undefined;
  const rotation = Number(stream.side_data_list?.find((item) => Number.isFinite(item.rotation))?.rotation ?? stream.tags?.rotate ?? 0);
  const quarterTurn = Math.abs(rotation) % 180 === 90;
  return quarterTurn ? { width: stream.height, height: stream.width } : { width: stream.width, height: stream.height };
}

function positiveDuration(value: string | undefined): number | undefined {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function streamDuration(probe: VideoProbeResult, type: 'video' | 'audio'): number | undefined {
  const durations = (probe.streams ?? [])
    .filter((stream) => stream.codec_type === type)
    .map((stream) => positiveDuration(stream.duration))
    .filter((duration): duration is number => duration !== undefined);
  return durations.length ? Math.max(...durations) : undefined;
}

export async function fingerprintExistingSource(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
