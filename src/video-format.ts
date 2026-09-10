export type VideoOrientation = 'portrait' | 'landscape';
export type VideoFitMode = 'contain' | 'cover';

export interface VideoSafeZones {
  horizontalMargin: number;
  verticalMargin: number;
  captionBottom: number;
}

export interface VideoFormatProfile {
  orientation: VideoOrientation;
  width: number;
  height: number;
  aspectRatio: number;
  sourceAspectRatio: number;
  fitMode: VideoFitMode;
  safeZones: VideoSafeZones;
}

const portraitProfile = {
  orientation: 'portrait' as const,
  width: 1080,
  height: 1920,
  safeZones: { horizontalMargin: 0.07, verticalMargin: 0.06, captionBottom: 0.1 },
};

const landscapeProfile = {
  orientation: 'landscape' as const,
  width: 1920,
  height: 1080,
  safeZones: { horizontalMargin: 0.05, verticalMargin: 0.07, captionBottom: 0.09 },
};

export function createVideoFormatProfile(sourceWidth: number, sourceHeight: number): VideoFormatProfile {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Positive source dimensions are required to choose an output format.');
  }
  const sourceAspectRatio = sourceWidth / sourceHeight;
  const selected = sourceAspectRatio < 1 ? portraitProfile : landscapeProfile;
  return {
    ...selected,
    aspectRatio: selected.width / selected.height,
    sourceAspectRatio,
    // V1.3.1 never crops merely to force the source into the selected canvas.
    fitMode: 'contain',
  };
}

export function defaultVideoFormatProfile(): VideoFormatProfile {
  return createVideoFormatProfile(1920, 1080);
}

export function formatProfileLabel(profile: VideoFormatProfile): string {
  return `${profile.width}×${profile.height} · ${profile.orientation === 'portrait' ? 'Portrait' : 'Landscape'}`;
}
