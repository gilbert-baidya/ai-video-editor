import type { DirectorProvider } from "./director.ts";
import { GeminiDirectorProvider } from "./director-gemini.ts";

import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
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
  directorProvider?: DirectorProvider;
  binaryCandidates?: Partial<Record<'ffmpeg' | 'ffprobe' | 'whisper' | 'youtube', string[]>>;
}

export async function discoverCapabilities(options: CapabilityOptions): Promise<ProductCapabilities> {
  const ffmpeg = await executable(options.binaryCandidates?.ffmpeg ?? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']);
  const ffprobe = await executable(options.binaryCandidates?.ffprobe ?? ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe']);
  const whisper = await executable(options.binaryCandidates?.whisper ?? ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli', 'whisper-cli'], ['--help']);
  const youtube = await executable(options.binaryCandidates?.youtube ?? ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', 'yt-dlp'], ['--version']);
  const provider = options.directorProvider ?? new GeminiDirectorProvider();
  
  const geminiProvider = new GeminiDirectorProvider();
  const geminiAvailability = await geminiProvider.checkAvailability();
  
  const ollamaProvider = new OllamaDirectorProvider();
  const ollamaAvailability = await ollamaProvider.checkAvailability();
  const directorAvailability = await provider.checkAvailability?.() ?? { available: true, checkedAt: new Date().toISOString() };
  const model = process.env.WHISPER_MODEL ? resolve(options.root, process.env.WHISPER_MODEL) : undefined;
  const modelAvailable = model ? await access(model).then(() => true, () => false) : false;
  const language = process.env.WHISPER_LANGUAGE ?? 'auto';
  const englishOnlyModel = model ? /\.en(?:\.|$)/iu.test(basename(model)) : false;
  let transcriptionIssue = !['auto', 'bn', 'en'].includes(language)
    ? `WHISPER_LANGUAGE "${language}" is unsupported; use auto, bn, or en.`
    : englishOnlyModel && language !== 'en'
      ? 'The configured English-only Whisper model cannot transcribe Bengali or mixed-language speech. Configure a multilingual model in WHISPER_MODEL.'
      : undefined;

  // Cloud fallback overrides local constraints
  if (process.env.GEMINI_API_KEY) {
    transcriptionIssue = undefined;
  }

  const transcription: ProductCapability = (whisper.state === 'AVAILABLE' && ffmpeg.state === 'AVAILABLE' && modelAvailable && !transcriptionIssue) || (ffmpeg.state === 'AVAILABLE' && process.env.GEMINI_API_KEY)
    ? { state: 'AVAILABLE', detail: process.env.GEMINI_API_KEY ? `Cloud ASR (${process.env.GEMINI_ASR_MODEL || 'gemini-3.1-pro-preview'}) is available.` : `Whisper CLI, FFmpeg, and the configured model are available (language: ${language}).` }
    : {
      state: 'NOT_CONFIGURED',
      detail: transcriptionIssue ?? 'Transcription requires FFmpeg, whisper-cli, and an existing local model configured with WHISPER_MODEL. No runtime was installed.',
    };
  return {
    checkedAt: new Date().toISOString(),
    node: { state: 'AVAILABLE', detail: 'The local product host is running.', version: process.version },
    ffmpeg,
    ffprobe,
    director: {
      state: directorAvailability.available ? 'AVAILABLE' : 'UNAVAILABLE',
      detail: directorAvailability.available ? `${provider.name}/${provider.model} is available.` : (directorAvailability.reason ?? 'Director provider is unavailable.'),
      provider: provider.name,
      model: provider.model,
      geminiAvailable: geminiAvailability.available,
      ollamaAvailable: ollamaAvailability.available,
    },
    transcription,
    youtube: youtube.state === 'AVAILABLE' ? youtube : { ...youtube, detail: 'YouTube ingestion is unavailable because yt-dlp is not installed. No download will be simulated.' },
    render: ffmpeg.state === 'AVAILABLE'
      ? { state: 'AVAILABLE', detail: 'Remotion and FFmpeg rendering are available.' }
      : { state: 'UNAVAILABLE', detail: 'Rendering requires FFmpeg.' },
  };
}
