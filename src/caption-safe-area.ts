import { spawn } from 'node:child_process';

export type CaptionZone = 'lower' | 'center-lower' | 'center' | 'upper-center';

export interface CaptionZoneMetrics {
  lower: number;
  'center-lower': number;
  center: number;
  'upper-center': number;
}

export interface CaptionPlacement {
  zone: CaptionZone;
  fallbackUsed: boolean;
  reason: string;
}

const SAMPLE_WIDTH = 96;
const SAMPLE_HEIGHT = 171;
const PERSISTENCE_THRESHOLD = 0.55;
const OCCUPANCY_THRESHOLD = 0.08;

const zoneRows: Record<CaptionZone, [number, number]> = {
  lower: [0.72, 0.96],
  'center-lower': [0.54, 0.72],
  center: [0.36, 0.54],
  'upper-center': [0.18, 0.36],
};

export function chooseCaptionPlacement(metrics: CaptionZoneMetrics): CaptionPlacement {
  const zones: CaptionZone[] = ['lower', 'center-lower', 'center', 'upper-center'];
  const selected = zones.find((zone) => metrics[zone] < OCCUPANCY_THRESHOLD);
  if (selected) {
    return {
      zone: selected,
      fallbackUsed: false,
      reason: `${selected} zone has no persistent text/graphic occupancy above the safe-area threshold.`,
    };
  }
  return {
    zone: 'upper-center',
    fallbackUsed: true,
    reason: 'All sampled caption zones were occupied or uncertain; using the conservative upper-center fallback.',
  };
}

function frameMetrics(frames: Buffer[]): CaptionZoneMetrics {
  const persistentEdges = new Uint16Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
  for (const frame of frames) {
    for (let y = 1; y < SAMPLE_HEIGHT; y += 1) {
      for (let x = 1; x < SAMPLE_WIDTH; x += 1) {
        const index = y * SAMPLE_WIDTH + x;
        const edge = Math.abs(frame[index] - frame[index - 1]) > 24
          || Math.abs(frame[index] - frame[index - SAMPLE_WIDTH]) > 24;
        if (edge) persistentEdges[index] += 1;
      }
    }
  }
  const minimumPersistence = Math.ceil(frames.length * PERSISTENCE_THRESHOLD);
  const score = (zone: CaptionZone): number => {
    const [start, end] = zoneRows[zone];
    let occupied = 0;
    let total = 0;
    for (let y = Math.floor(start * SAMPLE_HEIGHT); y < Math.floor(end * SAMPLE_HEIGHT); y += 1) {
      for (let x = 1; x < SAMPLE_WIDTH; x += 1) {
        total += 1;
        if (persistentEdges[y * SAMPLE_WIDTH + x] >= minimumPersistence) occupied += 1;
      }
    }
    return total ? occupied / total : 1;
  };
  return {
    lower: score('lower'),
    'center-lower': score('center-lower'),
    center: score('center'),
    'upper-center': score('upper-center'),
  };
}

function readSampledFrames(
  ffmpegPath: string,
  sourcePath: string,
  startSeconds: number,
  durationSeconds: number,
): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      Math.max(0, startSeconds).toFixed(3),
      '-t',
      Math.max(0.1, durationSeconds).toFixed(3),
      '-i',
      sourcePath,
      '-vf',
      `fps=2,scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Caption safe-area sampling failed: ${Buffer.concat(errors).toString('utf8').trim() || `ffmpeg exited with code ${code}`}`));
        return;
      }
      const raw = Buffer.concat(chunks);
      const frameSize = SAMPLE_WIDTH * SAMPLE_HEIGHT;
      const frames = Array.from({ length: Math.floor(raw.length / frameSize) }, (_, index) =>
        raw.subarray(index * frameSize, (index + 1) * frameSize));
      if (!frames.length) {
        reject(new Error('Caption safe-area sampling returned no frames.'));
        return;
      }
      resolve(frames);
    });
  });
}

export async function detectCaptionPlacement(
  ffmpegPath: string,
  sourcePath: string,
  startSeconds: number,
  durationSeconds: number,
): Promise<CaptionPlacement> {
  const frames = await readSampledFrames(ffmpegPath, sourcePath, startSeconds, durationSeconds);
  return chooseCaptionPlacement(frameMetrics(frames));
}
