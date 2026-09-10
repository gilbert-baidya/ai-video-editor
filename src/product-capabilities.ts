import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ProductCapabilities, ProductCapability } from './product-api.ts';
import { OllamaDirectorProvider } from './director.ts';

async function executable(candidates: string[], versionArgs = ['-version']): Promise<ProductCapability & { path?: string }> {
  for (const path of candidates) {
    if (path.includes('/')) {
      const available = await access(path, constants.X_OK).then(() => true, () => false);
      if (!available) continue;
    }
    const result = await new Promise<{ ok: boolean; output: string }>((done) => {
      const child = spawn(path, versionArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const timeout = setTimeout(() => child.kill('SIGTERM'), 60_000);
      child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.once('error', () => { clearTimeout(timeout); done({ ok: false, output: '' }); });
      child.once('close', (code) => { clearTimeout(timeout); done({ ok: code === 0, output }); });
    });
    if (result.ok) return { state: 'AVAILABLE', detail: `${path} is available.`, version: result.output.trim().split('\n')[0], path };
  }
  return { state: 'UNAVAILABLE', detail: `${candidates.at(-1)} was not found. No software was installed.` };
}

export interface CapabilityOptions {
  root: string;
  directorProvider?: OllamaDirectorProvider;
  binaryCandidates?: Partial<Record<'ffmpeg' | 'ffprobe' | 'whisper' | 'youtube', string[]>>;
}

export async function discoverCapabilities(options: CapabilityOptions): Promise<ProductCapabilities> {
  const ffmpeg = await executable(options.binaryCandidates?.ffmpeg ?? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']);
  const ffprobe = await executable(options.binaryCandidates?.ffprobe ?? ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe']);
  const whisper = await executable(options.binaryCandidates?.whisper ?? ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli', 'whisper-cli'], ['--help']);
  const youtube = await executable(options.binaryCandidates?.youtube ?? ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', 'yt-dlp'], ['--version']);
  const provider = options.directorProvider ?? new OllamaDirectorProvider();
  const directorAvailability = await provider.checkAvailability();
  const model = process.env.WHISPER_MODEL ? resolve(options.root, process.env.WHISPER_MODEL) : undefined;
  const modelAvailable = model ? await access(model).then(() => true, () => false) : false;
  const transcription: ProductCapability = whisper.state === 'AVAILABLE' && ffmpeg.state === 'AVAILABLE' && modelAvailable
    ? { state: 'AVAILABLE', detail: 'Whisper CLI, FFmpeg, and the configured model are available.' }
    : { state: 'NOT_CONFIGURED', detail: 'Transcription requires FFmpeg, whisper-cli, and WHISPER_MODEL. No runtime was installed.' };
  return {
    checkedAt: new Date().toISOString(),
    node: { state: 'AVAILABLE', detail: 'The local product host is running.', version: process.version },
    ffmpeg,
    ffprobe,
    director: directorAvailability.available
      ? { state: 'AVAILABLE', detail: `${provider.name}/${provider.model} is available.` }
      : { state: 'UNAVAILABLE', detail: directorAvailability.reason ?? 'Director provider is unavailable.' },
    transcription,
    youtube: youtube.state === 'AVAILABLE' ? youtube : { ...youtube, detail: 'YouTube ingestion is unavailable because yt-dlp is not installed. No download will be simulated.' },
    render: ffmpeg.state === 'AVAILABLE'
      ? { state: 'AVAILABLE', detail: 'Remotion and FFmpeg rendering are available.' }
      : { state: 'UNAVAILABLE', detail: 'Rendering requires FFmpeg.' },
  };
}
