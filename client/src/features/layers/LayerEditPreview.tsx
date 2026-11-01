import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useStore } from 'react-redux';
import type { DesignLayer, DesignVariant } from '@frameflow/shared';
import { selectActiveVariant, useAppSelector, type EditorStore, type RootState } from '../../store';
import { layerEditSnapshot } from './layerEdit';

export interface LayerCanvasPreview {
  operationId: string; variantId: string; layerId: string; snapshot: string; version: number;
  mode: 'before' | 'after'; image: HTMLImageElement;
  geometry: { x: number; y: number; width: number; height: number };
}
export const LAYER_PREVIEW_NOTICE = 'Apply or Discard the AI preview before saving or exporting.';

/** Observe every store transition, even inside a React batch: change → Undo must not revive an older request. */
export function createLayerEditSourceTracker(store: Pick<EditorStore, 'getState' | 'subscribe'>) {
  const key = () => {
    const state = store.getState(), variant = selectActiveVariant(state), selectedId = state.ui.selectedElementId;
    const layer = variant.layers?.find(l => l.id === selectedId);
    return JSON.stringify([state.editor.document.id, variant.id, selectedId, layer ? layerEditSnapshot(variant, layer) : null]);
  };
  let previous = key(), version = 0;
  const getSnapshot = () => { const next = key(); if (next !== previous) { previous = next; version++; } return version; };
  return { getSnapshot, subscribe: (notify: () => void) => store.subscribe(() => {
    const before = version; if (getSnapshot() !== before) notify();
  }) };
}

export function previewIsCurrent(preview: LayerCanvasPreview | null, variant: DesignVariant, selectedId: string | null, version: number) {
  const layer = variant.layers?.find(l => l.id === selectedId);
  return !!preview && !!layer && preview.variantId === variant.id && preview.layerId === selectedId
    && preview.version === version && preview.snapshot === layerEditSnapshot(variant, layer);
}

/** A render-only value: the document's original layer is never changed. Match the existing Apply geometry and crop rules. */
export function previewLayer(layer: DesignLayer, preview?: LayerCanvasPreview | null): DesignLayer {
  if (!preview || preview.layerId !== layer.id || preview.mode !== 'after' || layer.type !== 'image') return layer;
  const { fit: _fit, focalPoint: _focalPoint, radius: _radius, ...original } = layer;
  void _fit; void _focalPoint; void _radius;
  return { ...original, ...preview.geometry };
}

const Context = createContext<{
  sourceVersion: number;
  getSourceVersion: () => number;
  preview: LayerCanvasPreview | null;
  show: (preview: LayerCanvasPreview) => void;
  clear: (operationId: string) => void;
}>({ sourceVersion: 0, getSourceVersion: () => 0, preview: null, show: () => {}, clear: () => {} });

/** Decoded images and comparison choice live only in React, outside Redux, IndexedDB, history and project persistence. */
export function LayerEditPreviewProvider({ children }: { children: ReactNode }) {
  const store = useStore<RootState>();
  const tracker = useMemo(() => createLayerEditSourceTracker(store), [store]);
  const version = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot);
  const [pending, setPending] = useState<LayerCanvasPreview | null>(null);
  const variant = useAppSelector(selectActiveVariant), selectedId = useAppSelector(s => s.ui.selectedElementId);
  const show = useCallback((preview: LayerCanvasPreview) => setPending(preview), []);
  const clear = useCallback((operationId: string) => setPending(p => p?.operationId === operationId ? null : p), []);
  // A synchronous gate removes stale rendering even before the inspector's effect cleanup runs.
  const preview = previewIsCurrent(pending, variant, selectedId, version) ? pending : null;
  const value = useMemo(() => ({ preview, show, clear, sourceVersion: version, getSourceVersion: tracker.getSnapshot }), [preview, show, clear, version, tracker]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useLayerEditPreview = () => useContext(Context);
