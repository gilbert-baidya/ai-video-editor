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

export interface MediaIntegrityOptions {
  expectedDurationSeconds?: number;
  durationToleranceSeconds?: number;
}

export async function validateMediaIntegrity(
  outputPath: string,
  ffprobePath: string,
  expectedFormat: VideoFormatProfile,
  options: MediaIntegrityOptions = {},
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

  if (width > 0 && height > 0 && Number.isFinite(expectedFormat.width) && Number.isFinite(expectedFormat.height) && (width !== expectedFormat.width || height !== expectedFormat.height)) {
    failures.push(`Dimension mismatch. Expected ${expectedFormat.width}x${expectedFormat.height}, found ${width}x${height}.`);
  }

  const audioCodec = audioStream?.codec_name ?? '';
  if (audioCodec !== 'aac') {
    failures.push(`Invalid audio codec. Expected aac, found ${audioCodec}.`);
  }
  if (audioStream && (!(parseInt(audioStream.sample_rate || '0', 10) > 0) || !(Number(audioStream.channels) > 0))) {
    failures.push('Audio stream reports an invalid sample rate or channel count.');
  }
  const audioDuration = parseFloat(audioStream?.duration || '0');
  const videoDuration = parseFloat(videoStream?.duration || '0');
  if (audioStream && audioDuration > 0 && videoDuration > 0 && Math.abs(audioDuration - videoDuration) > 0.5) {
    failures.push(`Audio and video durations diverge (${audioDuration.toFixed(2)}s audio vs ${videoDuration.toFixed(2)}s video).`);
  }
  const tolerance = options.durationToleranceSeconds ?? 0.5;
  if (options.expectedDurationSeconds !== undefined && duration > 0 && Math.abs(duration - options.expectedDurationSeconds) > tolerance) {
    failures.push(`Duration mismatch. Expected ${options.expectedDurationSeconds.toFixed(2)}s, found ${duration.toFixed(2)}s.`);
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

export interface VolumeLevels {
  meanDb: number;
  maxDb: number;
}

export function parseVolumeDetect(stderr: string): VolumeLevels | undefined {
  const mean = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)\s*dB/u)?.[1];
  const max = stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s*dB/u)?.[1];
  if (mean === undefined || max === undefined) return undefined;
  const toDb = (value: string): number => value === '-inf' ? Number.NEGATIVE_INFINITY : Number(value);
  return { meanDb: toDb(mean), maxDb: toDb(max) };
}

export async function measureAudioLevels(ffmpegPath: string, mediaPath: string, window?: { start: number; end: number }): Promise<VolumeLevels | undefined> {
  const args = ['-hide_banner', '-nostats'];
  if (window) args.push('-ss', String(window.start), '-t', String(window.end - window.start));
  args.push('-i', mediaPath, '-vn', '-af', 'volumedetect', '-f', 'null', '-');
  try {
    const { stderr } = await execFileAsync(ffmpegPath, args, { maxBuffer: 8 * 1024 * 1024 });
    return parseVolumeDetect(stderr);
  } catch {
    return undefined;
  }
}

export const AUDIO_SILENCE_FLOOR_DB = -70;
export const AUDIO_WINDOW_TOLERANCE_DB = 3;

// The sermon audio must be audible overall and, inside each B-roll window, match the untouched source:
// a window that is silent or noticeably different means B-roll audio replaced or interrupted the sermon.
export function evaluateAudioContinuity(whole: VolumeLevels | undefined, windows: Array<{ id: string; source?: VolumeLevels; output?: VolumeLevels }>): string[] {
  const failures: string[] = [];
  if (!whole) failures.push('Output audio could not be measured.');
  else if (!(whole.maxDb > AUDIO_SILENCE_FLOOR_DB)) failures.push('Output audio is silent; the original sermon audio is missing.');
  for (const window of windows) {
    if (!window.source || !window.output) {
      failures.push(`${window.id}: audio continuity could not be measured.`);
    } else if (window.source.maxDb > AUDIO_SILENCE_FLOOR_DB && !(window.output.maxDb > AUDIO_SILENCE_FLOOR_DB)) {
      failures.push(`${window.id}: sermon audio drops out during B-roll.`);
    } else if (Number.isFinite(window.source.meanDb) && Number.isFinite(window.output.meanDb) && Math.abs(window.source.meanDb - window.output.meanDb) > AUDIO_WINDOW_TOLERANCE_DB) {
      failures.push(`${window.id}: audio during B-roll differs from the sermon source by ${Math.abs(window.source.meanDb - window.output.meanDb).toFixed(1)} dB.`);
    }
  }
  return failures;
}

export async function verifyAudioContinuity(input: { ffmpegPath: string; sourcePath: string; outputPath: string; windows: Array<{ id: string; start: number; end: number }> }): Promise<string[]> {
  const whole = await measureAudioLevels(input.ffmpegPath, input.outputPath);
  const windows = [];
  for (const window of input.windows) {
    windows.push({
      id: window.id,
      source: await measureAudioLevels(input.ffmpegPath, input.sourcePath, window),
      output: await measureAudioLevels(input.ffmpegPath, input.outputPath, window),
    });
  }
  return evaluateAudioContinuity(whole, windows);
}
