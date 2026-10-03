import React, { useEffect, useRef, useState } from 'react';
import { findClip, formatTimecode, rulerScale, timeToX, xToTime, type TimelineClip, type TimelineModel } from './editor-model.ts';

export const TRACK_LABEL_WIDTH = 96;

export interface TimelineProps {
  model: TimelineModel;
  selectedClipId?: string;
  time: number;
  playing: boolean;
  // undefined = fit the whole timeline to the available width.
  pixelsPerSecond?: number;
  onZoom: (pixelsPerSecond: number | undefined) => void;
  onSelectClip: (clip: TimelineClip) => void;
  onSeek: (seconds: number) => void;
  assetUrl: (assetId: string) => string;
  peaks?: number[];
  waveformNote?: string;
}

export function rulerTicks(duration: number, pixelsPerSecond: number): number[] {
  const { major } = rulerScale(pixelsPerSecond);
  const ticks: number[] = [];
  for (let second = 0; second <= duration; second += major) ticks.push(second);
  return ticks;
}

function Waveform({ peaks }: { peaks: number[] }): React.ReactElement {
  const bars = peaks.map((peak, index) => `M${index},${50 - peak * 48}V${50 + peak * 48}`).join('');
  return <svg className="ve-wave" viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" aria-label="Audio waveform"><path d={bars} /></svg>;
}

function Clip({ clip, selected, pixelsPerSecond, onSelect, assetUrl, peaks, waveformNote }: { clip: TimelineClip; selected: boolean; pixelsPerSecond: number; onSelect: () => void; assetUrl: (id: string) => string; peaks?: number[]; waveformNote?: string }): React.ReactElement {
  const left = timeToX(clip.start, pixelsPerSecond);
  const width = Math.max(4, timeToX(clip.end - clip.start, pixelsPerSecond));
  const selectable = clip.operationId !== undefined;
  const className = `ve-clip kind-${clip.kind} ${clip.status ? `status-${clip.status}` : ''} ${selected ? 'selected' : ''}`;
  const body = <>
    {clip.kind === 'broll-image' && clip.assetId && <img className="ve-clip-thumb" src={assetUrl(clip.assetId)} alt="" />}
    {clip.kind === 'audio' && (peaks?.length ? <Waveform peaks={peaks} /> : waveformNote ? <span className="ve-wave-note">{waveformNote}</span> : null)}
    <span className="ve-clip-text"><b>{clip.label}</b>{clip.sublabel && <small>{clip.sublabel}</small>}</span>
  </>;
  const title = `${clip.label} · ${formatTimecode(clip.start)} → ${formatTimecode(clip.end)}`;
  if (!selectable) return <div className={className} style={{ left, width }} data-clip-id={clip.id} title={title}>{body}</div>;
  return <button
    type="button"
    className={className}
    style={{ left, width }}
    data-clip-id={clip.id}
    data-operation-id={clip.operationId}
    aria-pressed={selected}
    title={title}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={onSelect}
  >{body}</button>;
}

export const Timeline: React.FC<TimelineProps> = ({ model, selectedClipId, time, playing, pixelsPerSecond: requestedZoom, onZoom, onSelectClip, onSeek, assetUrl, peaks, waveformNote }) => {
  const lanesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(12);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;
    const measure = () => setFit(Math.max(4, Math.min(120, (scroller.clientWidth - TRACK_LABEL_WIDTH - 16) / Math.max(model.durationSeconds, 1))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [model.durationSeconds]);
  const pixelsPerSecond = requestedZoom ?? fit;
  const scale = rulerScale(pixelsPerSecond);
  const width = timeToX(model.durationSeconds, pixelsPerSecond);
  const zoomBy = (factor: number) => onZoom(Math.max(4, Math.min(120, Math.round(pixelsPerSecond * factor))));

  const seekFromEvent = (event: React.PointerEvent) => {
    const rect = lanesRef.current?.getBoundingClientRect();
    if (rect) onSeek(xToTime(event.clientX - rect.left, pixelsPerSecond, model.durationSeconds));
  };
  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekFromEvent(event);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (event.buttons === 1) seekFromEvent(event);
  };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !playing) return;
    const x = timeToX(time, pixelsPerSecond);
    if (x > scroller.scrollLeft + scroller.clientWidth - TRACK_LABEL_WIDTH - 40 || x < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, x - 80);
  }, [time, playing, pixelsPerSecond]);

  const selected = findClip(model, selectedClipId);
  return <div className="ve-timeline" data-duration={model.durationSeconds}>
    <div className="ve-timeline-head">
      <b>Timeline</b>
      <span>{selected ? `${selected.label} · ${formatTimecode(selected.start)} → ${formatTimecode(selected.end)}` : 'Select an operation to inspect it'}</span>
      <div className="ve-zoom" role="group" aria-label="Timeline zoom">
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>−</button>
        <input type="range" aria-label="Timeline zoom level" min={4} max={120} step={1} value={Math.round(pixelsPerSecond)} onChange={(event) => onZoom(Number(event.target.value))} />
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>+</button>
        <button type="button" aria-pressed={requestedZoom === undefined} onClick={() => onZoom(undefined)}>Fit</button>
      </div>
    </div>
    <div className="ve-timeline-scroll" ref={scrollRef}>
      <div className="ve-timeline-inner" style={{ width: TRACK_LABEL_WIDTH + width }}>
        <div className="ve-tl-row ve-ruler-row">
          <div className="ve-track-label" />
          <div className="ve-lane ve-ruler" ref={lanesRef} style={{ width, backgroundImage: `repeating-linear-gradient(90deg, #3a4d75 0, #3a4d75 1px, transparent 1px, transparent ${scale.minor * pixelsPerSecond}px)` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
            {rulerTicks(model.durationSeconds, pixelsPerSecond).map((tick) => <span key={tick} className="ve-tick" style={{ left: timeToX(tick, pixelsPerSecond) }}>{formatTimecode(tick).replace(/\.0$/u, '')}</span>)}
          </div>
        </div>
        {model.tracks.map((track) => <div className={`ve-tl-row track-${track.id}`} key={track.id} data-track={track.id}>
          <div className="ve-track-label"><b>{track.code}</b><span>{track.label}</span></div>
          <div className="ve-lane" style={{ width, backgroundImage: `repeating-linear-gradient(90deg, #ffffff0c 0, #ffffff0c 1px, transparent 1px, transparent ${scale.major * pixelsPerSecond}px)` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
            {track.clips.map((clip) => <Clip key={clip.id} clip={clip} selected={clip.id === selectedClipId} pixelsPerSecond={pixelsPerSecond} onSelect={() => onSelectClip(clip)} assetUrl={assetUrl} peaks={peaks} waveformNote={waveformNote} />)}
            {!track.clips.length && <span className="ve-lane-empty">No {track.label.toLowerCase()} operations</span>}
          </div>
        </div>)}
        <div className="ve-playhead" data-time={time} style={{ left: TRACK_LABEL_WIDTH + timeToX(time, pixelsPerSecond) }}><i /></div>
      </div>
    </div>
  </div>;
};
