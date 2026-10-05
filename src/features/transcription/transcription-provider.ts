import type { TranscriptDocument } from '../../contracts.ts';

export interface TranscriptionInput {
  audioPath: string;
  projectId: string;
  physicalDurationSeconds: number;
  language?: 'auto' | 'bn' | 'en';
}

export interface TranscriptionProvider {
  name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptDocument>;
}
