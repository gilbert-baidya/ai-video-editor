import type { CSSProperties } from 'react';
import type { SpeakerPosition } from './contracts.ts';

// Shared by the Remotion composition and the editing preview so both frame the Pastor identically.
export function positionStyle(position: SpeakerPosition | 'center'): CSSProperties {
  if (position === 'left') return { transform: 'translateX(-7%) scale(1.08)' };
  if (position === 'right') return { transform: 'translateX(7%) scale(1.08)' };
  if (position === 'punch-in') return { transform: 'scale(1.12)' };
  return {};
}
