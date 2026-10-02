import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import type { VideoFormatProfile } from './video-format.ts';

const execFileAsync = promisify(execFile);

export interface MediaIntegrityReport {
  passed: boolean;
  failures: string[];
  container: string;
  videoCodec: string;
  audioCodec: string;
  pixelFormat: string;
  durationSeconds: number;
  width: number;
  height: number;
}

export async function validateMediaIntegrity(
  outputPath: string,
  ffprobePath: string,
  expectedFormat: VideoFormatProfile
): Promise<MediaIntegrityReport> {
  const failures: string[] = [];
  let fileStat;
  try {
    fileStat = await stat(outputPath);
    if (fileStat.size < 1000) {
      failures.push('File is too small or empty.');
    }
  } catch (e) {
    return { passed: false, failures: ['File does not exist.'], container: '', videoCodec: '', audioCodec: '', pixelFormat: '', durationSeconds: 0, width: 0, height: 0 };
  }

  let probeResult;
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-of', 'json',
      outputPath
    ]);
    probeResult = JSON.parse(stdout);
  } catch (e) {
    failures.push('ffprobe execution failed. File may be corrupt.');
    return { passed: false, failures, container: '', videoCodec: '', audioCodec: '', pixelFormat: '', durationSeconds: 0, width: 0, height: 0 };
  }

  const format = probeResult.format;
  const videoStream = probeResult.streams?.find((s: any) => s.codec_type === 'video');
  const audioStream = probeResult.streams?.find((s: any) => s.codec_type === 'audio');

  if (!format) failures.push('Missing format information.');
  if (!videoStream) failures.push('Missing video stream.');
  if (!audioStream) failures.push('Missing audio stream.');

  const container = format?.format_name ?? '';
  if (!container.includes('mp4')) {
    failures.push(`Invalid container. Expected mp4, found ${container}.`);
  }

  const duration = parseFloat(format?.duration || '0');
  if (duration <= 0) {
    failures.push('Invalid or zero duration.');
  }

  const videoCodec = videoStream?.codec_name ?? '';
  if (videoCodec !== 'h264') {
    failures.push(`Invalid video codec. Expected h264, found ${videoCodec}.`);
  }

  const pixelFormat = videoStream?.pix_fmt ?? '';
  const allowedFormats = ['yuv420p', 'yuvj420p'];
  if (!allowedFormats.includes(pixelFormat)) {
    failures.push(`Invalid pixel format. Expected one of ${allowedFormats.join(', ')}, found ${pixelFormat}.`);
  }

  const width = parseInt(videoStream?.width || '0', 10);
  const height = parseInt(videoStream?.height || '0', 10);
  if (width <= 0 || height <= 0) {
    failures.push('Invalid dimensions.');
  } else if (expectedFormat.orientation === 'portrait' && width > height) {
    failures.push(`Orientation mismatch. Expected portrait, found ${width}x${height}.`);
  } else if (expectedFormat.orientation === 'landscape' && width < height) {
    failures.push(`Orientation mismatch. Expected landscape, found ${width}x${height}.`);
  }

  const audioCodec = audioStream?.codec_name ?? '';
  if (audioCodec !== 'aac') {
    failures.push(`Invalid audio codec. Expected aac, found ${audioCodec}.`);
  }

  return {
    passed: failures.length === 0,
    failures,
    container,
    videoCodec,
    audioCodec,
    pixelFormat,
    durationSeconds: duration,
    width,
    height
  };
}
