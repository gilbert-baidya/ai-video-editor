import React, { useRef } from 'react';

export interface SplitterProps {
  orientation: 'vertical' | 'horizontal';
  label: string;
  value: number;
  min: number;
  max: number;
  // 'grow-after' means dragging towards the start increases the value (panel sits after the handle).
  direction: 'grow-before' | 'grow-after';
  onChange: (value: number) => void;
  onReset: () => void;
}

// Accessible drag handle: pointer drag, arrow keys (Shift = larger steps), Home/End, double-click to reset.
export const Splitter: React.FC<SplitterProps> = ({ orientation, label, value, min, max, direction, onChange, onReset }) => {
  const start = useRef<{ pointer: number; value: number }>();
  const axis = orientation === 'vertical' ? 'clientX' : 'clientY';
  const sign = direction === 'grow-before' ? 1 : -1;
  const clampValue = (next: number) => Math.round(Math.min(Math.max(next, min), Math.max(min, max)));
  return <div
    className={`ve-splitter ${orientation}`}
    role="separator"
    aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
    aria-label={label}
    aria-valuenow={Math.round(value)}
    aria-valuemin={min}
    aria-valuemax={Math.round(max)}
    tabIndex={0}
    title={`${label} — drag, use arrow keys, or double-click to reset`}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); start.current = { pointer: event[axis], value }; }}
    onPointerMove={(event) => { if (start.current && event.buttons === 1) onChange(clampValue(start.current.value + sign * (event[axis] - start.current.pointer))); }}
    onPointerUp={() => { start.current = undefined; }}
    onDoubleClick={onReset}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 64 : 16;
      const grow = orientation === 'vertical' ? (direction === 'grow-before' ? 'ArrowRight' : 'ArrowLeft') : (direction === 'grow-before' ? 'ArrowDown' : 'ArrowUp');
      const shrink = orientation === 'vertical' ? (direction === 'grow-before' ? 'ArrowLeft' : 'ArrowRight') : (direction === 'grow-before' ? 'ArrowUp' : 'ArrowDown');
      if (event.key === grow) onChange(clampValue(value + step));
      else if (event.key === shrink) onChange(clampValue(value - step));
      else if (event.key === 'Home') onChange(clampValue(min));
      else if (event.key === 'End') onChange(clampValue(max));
      else if (event.key === 'Enter') onReset();
      else return;
      event.preventDefault();
    }}
  />;
};
