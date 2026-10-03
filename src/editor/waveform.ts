// Peak extraction for the audio track. Pure so it can be tested; the browser decode wrapper is best-effort.

export function computePeaks(samples: Float32Array, buckets: number): number[] {
  if (buckets <= 0 || samples.length === 0) return [];
  const size = Math.max(1, Math.floor(samples.length / buckets));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    let peak = 0;
    const start = bucket * size;
    const end = bucket === buckets - 1 ? samples.length : Math.min(samples.length, start + size);
    for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
    peaks.push(Math.min(1, peak));
  }
  return peaks;
}

export const WAVEFORM_MAX_BYTES = 150 * 1024 * 1024;

export type WaveformResult = { kind: 'ready'; peaks: number[]; durationSeconds: number } | { kind: 'unavailable'; reason: string };

// Decodes the project's actual source audio in the browser. It never invents a waveform: on any failure it reports why.
export async function loadWaveform(url: string, buckets = 1200): Promise<WaveformResult> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { kind: 'unavailable', reason: `Source returned HTTP ${response.status}.` };
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > WAVEFORM_MAX_BYTES) return { kind: 'unavailable', reason: 'Source is too large to decode a waveform in the browser.' };
    const buffer = await response.arrayBuffer();
    const Context = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Context) return { kind: 'unavailable', reason: 'Web Audio is not available.' };
    const context = new Context();
    try {
      const audio = await context.decodeAudioData(buffer);
      return { kind: 'ready', peaks: computePeaks(audio.getChannelData(0), buckets), durationSeconds: audio.duration };
    } finally {
      void context.close();
    }
  } catch (reason) {
    return { kind: 'unavailable', reason: reason instanceof Error ? reason.message : String(reason) };
  }
}
