import type { EditOperation } from './contracts.ts';

type TextOperation = Extract<EditOperation, { type: 'sermon-point' | 'full-screen-card' }>;

export function resolvedOperationFontSize(operation: TextOperation | undefined, fallback: number): number {
  return operation?.placement?.textFit.fontSize ?? fallback;
}