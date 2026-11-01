import { describe, expect, it } from 'vitest';
import type { DesignVariant, ImageLayerElement } from '@frameflow/shared';
import { createEditorStore } from '../../store';
import { layerEditApplied, layerUpdated } from '../../store/editorSlice';
import { undo, redo } from '../../store/history';
import { editableLayer, editedLayerGeometry } from './layerEdit';
const layer: ImageLayerElement = { id: 'object-1', type: 'image', name: 'Refrigerator', assetId: 'original', x: 100, y: 200, width: 200, height: 400, rotation: 30, opacity: 0.7, visible: true, locked: false, zIndex: 3 };
const variant: DesignVariant = { id: 'original', name: 'Test', revision: 0, canvas: { width: 1080, height: 1080, backgroundColor: '#ffffff' }, elements: [], layers: [layer, { ...layer, id: 'object-2', name: 'Character' }], creative: { product: true, masterId: 'pt-test', masterRevision: 1, creativeId: 'pc-123abc', syncedRevision: 1, scale: 1 } };
describe('AI layer editor geometry and history', () => {
  it('expands the door silhouette around the rotated visual centre without changing other layer data', () => {
    const store = createEditorStore({ schemaVersion: 1, id: 'test', name: 'Test', createdAt: '2026-10-01', updatedAt: '2026-10-01', variants: [variant] });
    const before = store.getState().editor.document;
    const geometry = editedLayerGeometry(layer, { width: 2, height: 1, centerX: 0.5, centerY: 0.5 });
    expect(geometry.width).toBe(400); expect(geometry.x).toBeCloseTo(100 - 100 * Math.cos(Math.PI / 6)); expect(geometry.y).toBeCloseTo(150);
    const action = layerEditApplied({ variantId: variant.id, id: layer.id, expectedLayer: JSON.stringify(layer), expectedRevision: 0, assetId: 'edited', geometry, timestamp: '2026-10-31' });
    store.dispatch(action); const after = store.getState().editor.document;
    expect(after.variants[0].layers![0]).toMatchObject({ ...geometry, opacity: 0.7, rotation: 30, zIndex: 3, assetId: 'edited' });
    expect(after.variants[0].layers![1]).toBe(before.variants[0].layers![1]);
    expect(store.getState().editor.past).toHaveLength(1);
    store.dispatch(action); expect(store.getState().editor.document).toBe(after);
    store.dispatch(undo()); expect(store.getState().editor.document).toBe(before);
    store.dispatch(redo()); expect(store.getState().editor.document).toBe(after);
  });
  it('rejects stale assets, geometry and revision without adding history', () => {
    const store = createEditorStore({ schemaVersion: 1, id: 'test', name: 'Test', createdAt: '2026-10-01', updatedAt: '2026-10-01', variants: [variant] });
    store.dispatch(layerUpdated({ variantId: variant.id, id: layer.id, changes: { x: 250 }, timestamp: '2026-10-31' }));
    const before = store.getState().editor;
    store.dispatch(layerEditApplied({ variantId: variant.id, id: layer.id, expectedLayer: JSON.stringify(layer), expectedRevision: 0, assetId: 'edited', geometry: { x: 100, y: 100, width: 300, height: 400 }, timestamp: '2026-10-31' }));
    expect(store.getState().editor).toBe(before);
  });
  it('supports objects and characters while refusing backgrounds, text, hidden and locked layers', () => {
    expect(editableLayer(variant, layer).target?.kind).toBe('creative');
    expect(editableLayer(variant, { ...layer, name: 'Person' }).target?.kind).toBe('creative');
    expect(editableLayer(variant, { ...layer, name: 'Decoration' }).target?.kind).toBe('creative');
    for (const l of [{ ...layer, id: 'art-background' }, { ...layer, locked: true }, { ...layer, visible: false }, { ...layer, assetId: undefined }, { ...layer, textSuggestion: { text: 'Offer', confidence: 'provided' as const } }]) expect(editableLayer(variant, l).reason).toBeTruthy();
  });
});
