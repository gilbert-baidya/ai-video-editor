import { createHash } from 'node:crypto';
import type { Sha256Input } from './sha256.ts';

export function sha256Node(input: Sha256Input): string {
  return createHash('sha256').update(input).digest('hex');
}

