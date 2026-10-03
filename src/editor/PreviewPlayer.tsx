import React, { useEffect, useRef, useState } from 'react';
import { positionStyle } from '../speaker-framing.ts';
import { formatTimecode, type PreviewFrame } from './editor-model.ts';

export interface PreviewPlayerProps {
  sourceUrl?: string;
  assetUrl: (assetId: string) => string;
  frame: PreviewFrame;
  time: number;
  seekToken: number;
  playing: boolean;
  durationSeconds: number;
  sourceDurationSeconds?: number;
  orientation: 'portrait' | 'landscape';
  onPlayingChange: (playing: boolean) => void;
  onTick: (seconds: number) => void;
  onSeek: (seconds: number) => void;
  onSourceDuration?: (seconds: number) => void;
}

function BrollLayer({ frame, assetUrl, playing, time, seekToken }: Pick<PreviewPlayerProps, 'frame' | 'assetUrl' | 'playing' | 'time' | 'seekToken'>): React.ReactElement | null {
  const broll = frame.broll;
  const clipRef = useRef<HTMLVideoElement>(null);
  const key = broll ? broll.operation.id : '';
  useEffect(() => {
    const clip = clipRef.current;
    if (!clip || !broll) return;
    // A B-roll clip always plays from its own beginning at the operation start.
    const offset = Math.max(0, time - broll.startSeconds);
    clip.currentTime = clip.duration ? offset % clip.duration : offset;
  }, [key, seekToken]);
  useEffect(() => {
    const clip = clipRef.current;
    if (!clip) return;
    if (playing) void clip.play().catch(() => undefined); else clip.pause();
  }, [playing, key]);
  if (!broll) return null;
  const url = assetUrl(broll.asset.id);
  const split = broll.layout === 'SPLIT_SCREEN';
  const media = broll.asset.kind === 'video'
    ? <video ref={clipRef} src={url} muted loop playsInline className="ve-broll-media" />
    : <img src={url} alt={broll.asset.fileName} className="ve-broll-media" />;
  if (split) return <div className={`ve-broll-split ${broll.side}`} data-layout="SPLIT_SCREEN">{media}</div>;
  return <div className="ve-broll-full" data-layout="FULL_FRAME_MEDIA">
    {broll.asset.kind === 'image' && <img src={url} alt="" aria-hidden className="ve-broll-blur" />}
    {media}
  </div>;
}

export const PreviewPlayer: React.FC<PreviewPlayerProps> = (props) => {
  const { sourceUrl, frame, time, seekToken, playing, durationSeconds, sourceDurationSeconds, orientation, onPlayingChange, onTick, onSeek, onSourceDuration } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);
  const [muted, setMuted] = useState(false);
  const sourceEnded = sourceDurationSeconds !== undefined && time >= sourceDurationSeconds - 0.05;

  useEffect(() => {
    const video = videoRef.current;
    if (video && Number.isFinite(time)) video.currentTime = Math.min(time, video.duration || time);
  }, [seekToken]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!playing) { video.pause(); return; }
    if (sourceEnded) { onPlayingChange(false); return; }
    void video.play().catch(() => onPlayingChange(false));
    let frameRequest = 0;
    const loop = () => {
      onTick(video.currentTime);
      if (video.ended) onPlayingChange(false);
      else frameRequest = requestAnimationFrame(loop);
    };
    frameRequest = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameRequest);
  }, [playing]);

  const toggle = () => onPlayingChange(!playing);
  const fullscreen = () => void stageRef.current?.requestFullscreen?.();

  return <div className="ve-preview">
    <div className={`ve-stage-wrap ${orientation}`}>
      <div className="ve-stage" ref={stageRef} data-pastor-visible={frame.pastorVisible} data-orientation={orientation}>
        {sourceUrl && !loadError
          ? <video
            ref={videoRef}
            src={sourceUrl}
            muted={muted}
            playsInline
            preload="auto"
            className="ve-source"
            style={{ opacity: frame.pastorVisible && !sourceEnded ? 1 : 0, ...positionStyle(frame.speakerPosition) }}
            onLoadedMetadata={(event) => onSourceDuration?.(event.currentTarget.duration)}
            onError={() => setLoadError(true)}
            onEnded={() => onPlayingChange(false)}
          />
          : <div className="ve-stage-message" role="alert">{sourceUrl ? 'The source video could not be loaded.' : 'No source video is attached to this project.'}</div>}
        <BrollLayer frame={frame} assetUrl={props.assetUrl} playing={playing} time={time} seekToken={seekToken} />
        {frame.fullScreenCard && <div className="ve-card">{frame.fullScreenCard.text}</div>}
        {frame.sermonPoint && <div className="ve-point"><small>{frame.sermonPoint.label}</small>{frame.sermonPoint.text}</div>}
        {frame.caption && <div className="ve-caption">{frame.caption.text}</div>}
        {sourceEnded && sourceDurationSeconds !== undefined && <div className="ve-stage-message ve-source-ended" role="status">Source footage ends at {formatTimecode(sourceDurationSeconds)}. The approved timeline continues, but there is no footage to show.</div>}
      </div>
    </div>
    <div className="ve-transport">
      <input
        className="ve-scrub"
        type="range"
        aria-label="Scrub preview"
        min={0}
        max={Math.max(durationSeconds, 0.1)}
        step={0.05}
        value={Math.min(time, durationSeconds)}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <div className="ve-transport-row">
        <span className="ve-timecode" aria-label="Current position">{formatTimecode(time)} <i>/ {formatTimecode(durationSeconds)}</i></span>
        <div className="ve-transport-buttons">
          <button type="button" aria-label="Back 5 seconds" onClick={() => onSeek(Math.max(0, time - 5))}>⏮ 5s</button>
          <button type="button" className="ve-play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? '❚❚' : '▶'}</button>
          <button type="button" aria-label="Forward 5 seconds" onClick={() => onSeek(Math.min(durationSeconds, time + 5))}>5s ⏭</button>
        </div>
        <div className="ve-transport-right">
          <button type="button" aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? 'Unmute' : 'Mute'}</button>
          <button type="button" onClick={fullscreen}>Fullscreen</button>
        </div>
      </div>
    </div>
  </div>;
};
