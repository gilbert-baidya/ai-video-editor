import { useCallback, useEffect, useState } from 'react';
import { clampLayout, defaultLayout, type LayoutPrefs, type Viewport } from './editor-model.ts';

const STORAGE_KEY = 've-layout-v1';

function readViewport(): Viewport {
  return typeof window === 'undefined' ? { width: 1440, height: 900 } : { width: window.innerWidth, height: window.innerHeight };
}

function readStored(): Partial<LayoutPrefs> {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<LayoutPrefs>;
  } catch {
    return {};
  }
}

// Panel sizes are user preferences only (never project data). Stored values are re-clamped to the current window.
export function useLayoutPrefs(orientation: 'portrait' | 'landscape') {
  const [viewport, setViewport] = useState<Viewport>(readViewport);
  const [stored, setStored] = useState<Partial<LayoutPrefs>>(readStored);
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const defaults = defaultLayout(viewport, orientation);
  const layout = clampLayout({ ...defaults, ...stored }, viewport);
  const update = useCallback((patch: Partial<LayoutPrefs>) => {
    setStored((current) => {
      const next = { ...current, ...patch };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* preferences are best-effort */ }
      return next;
    });
  }, []);
  const reset = useCallback((key: keyof LayoutPrefs) => {
    setStored((current) => {
      const { [key]: _removed, ...rest } = current;
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rest)); } catch { /* best-effort */ }
      return rest;
    });
  }, []);
  return { layout, defaults, viewport, update, reset };
}
