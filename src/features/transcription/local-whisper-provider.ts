import { transcribeAndAlign } from '../../foundation.ts';
import type { TranscriptionInput, TranscriptionProvider } from './transcription-provider.ts';
import type { TranscriptDocument } from '../../contracts.ts';

export class LocalWhisperProvider implements TranscriptionProvider {
  name = 'local-whisper';

  async transcribe(input: TranscriptionInput): Promise<TranscriptDocument> {
    const outputBase = input.audioPath.replace(/\.wav$/, '');
    const model = process.env.WHISPER_MODEL || 'ggml-base.en.bin';
    return await transcribeAndAlign(input.audioPath, outputBase, model, input.language);
  }
}
