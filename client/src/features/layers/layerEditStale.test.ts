/**
 * False "The layer changed during generation" rejections (2026-11-02). Reproduced offline on the saved Ornate Golden
 * Appliance Showcase (tests/e2e-image-templates/ai-layer-edit-stale.spec.ts): reordering another layer, changing the canvas
 * fill and pressing a rotated object's handle each invalidated a valid request. Genuine changes must still invalidate.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DesignVariant, ImageLayerElement, ProjectDocument, TextElement } from '@frameflow/shared';
import { createEditorStore, selectActiveVariant } from '../../store';
import { canvasBackgroundChanged, canvasResized, layerDuplicated, layerImageReplaced, layerReordered, layerUpdated, textDuplicated } from '../../store/editorSlice';
import { elementSelected } from '../../store/uiSlice';
import { undo } from '../../store/history';
import { transformedLayer } from '../canvas/layerGeometry';
import { describeLayerEditChanges, layerEditChanges, layerEditSnapshot, matchesLayerEditSnapshot, snapshotFingerprint } from './layerEdit';
import { createLayerEditSourceTracker } from './LayerEditPreview';
import { CONFLICT_LOG_KEY, recordLayerEditConflict, type LayerEditConflict } from './layerEditFlow';

// The appliance creative's structure: products and a decoration interleaved with text by zIndex (template order).
const image = (id: string, name: string, zIndex: number, x: number): ImageLayerElement => ({ id, type: 'image', name, assetId: `product-${id}`, role: 'generic-image', x, y: 600, width: 150, height: 210, rotation: 0, opacity: 1, visible: true, locked: false, zIndex });
const fridge = image('object-po-26b435b116', 'Multi-door refrigerator', 3, 530), dishwasher = image('object-po-a996c422e6', 'Freestanding dishwasher', 4, 688);
const border = image('object-po-3927395b1b', 'Ornamental border · in front of Freestanding dishwasher', 5, 729), washer = image('object-po-96d396f3fc', 'Front-loading washing machine', 6, 381);
const headline = { id: 'text-1', type: 'text', kind: 'heading', text: 'Golden offers', x: 100, y: 80, width: 600, fontFamily: 'Inter', fontSize: 64, fontWeight: 700, fill: '#000000', align: 'center', lineHeight: 1.1, letterSpacing: 0, rotation: 0, zIndex: 10 } as unknown as TextElement;
const variant: DesignVariant = { id: 'product-test', name: 'Appliances', revision: 0, productTemplate: true, canvas: { width: 1254, height: 1254, backgroundColor: '#ffffff' },
  layers: [fridge, dishwasher, border, washer], elements: [headline],
  creative: { product: true, masterId: 'pt-0dd04956555b', masterRevision: 1, creativeId: 'pc-9ef215', syncedRevision: 1, scale: 1 } };
const project: ProjectDocument = { schemaVersion: 1, id: 'appliances', name: 'Appliances', createdAt: '2026-11-02', updatedAt: '2026-11-02', variants: [variant] };
const at = '2026-11-02T00:22:14.235Z';

/** The panel's own checks, as LayerEditPanel.current() makes them before sending, on the result and before Apply. */
function editorWith(selected = dishwasher.id) {
  const store = createEditorStore(project); store.dispatch(elementSelected(selected));
  const tracker = createLayerEditSourceTracker(store), unsubscribe = tracker.subscribe(() => {});
  const v = () => selectActiveVariant(store.getState()), l = () => v().layers!.find(x => x.id === selected);
  const request = () => ({ snapshot: layerEditSnapshot(v(), l()!), version: tracker.getSnapshot() });
  const current = (r: { snapshot: string; version: number }) => tracker.getSnapshot() === r.version && store.getState().ui.selectedElementId === selected && !!l() && matchesLayerEditSnapshot(r.snapshot, v(), l()!);
  return { store, tracker, unsubscribe, v, l, request, current };
}

describe('a request stays valid through unrelated editor activity', () => {
  it('reordering or duplicating another element renumbers the dishwasher’s stacking but does not invalidate its request', () => {
    const e = editorWith(), r = e.request();
    e.store.dispatch(layerReordered({ variantId: variant.id, id: washer.id, toIndex: 1, timestamp: at })); // Moved behind the dishwasher.
    expect(e.l()!.zIndex).not.toBe(dishwasher.zIndex); // The selected layer really was renumbered…
    expect(e.current(r)).toBe(true); // …and the request is still valid (previously rejected).
    e.store.dispatch(layerReordered({ variantId: variant.id, id: washer.id, toIndex: 3, timestamp: at }));
    e.store.dispatch(layerDuplicated({ variantId: variant.id, id: fridge.id, newId: 'copy', timestamp: at }));
    e.store.dispatch(textDuplicated({ variantId: variant.id, id: headline.id, newId: 'text-copy', x: 120, y: 90, timestamp: at }));
    e.store.dispatch(undo());
    expect(e.current(r)).toBe(true);
    e.unsubscribe();
  });
  it('a canvas fill change, and its Undo, do not invalidate it; nor do saves, renames or other layers’ moves', () => {
    const e = editorWith(), r = e.request();
    e.store.dispatch(canvasBackgroundChanged({ variantId: variant.id, transparent: false, color: '#123456', timestamp: at }));
    expect(e.current(r)).toBe(true);
    e.store.dispatch(undo());
    e.store.dispatch(canvasBackgroundChanged({ variantId: variant.id, transparent: true, timestamp: at }));
    e.store.dispatch(layerUpdated({ variantId: variant.id, id: border.id, changes: { visible: false }, timestamp: at }));
    e.store.dispatch(layerUpdated({ variantId: variant.id, id: fridge.id, changes: { x: 500 }, timestamp: at }));
    expect(e.current(r)).toBe(true);
    e.unsubscribe();
  });
});

describe('a genuine change to the selected layer still invalidates its request', () => {
  it('moving, resizing, rotating, replacing, hiding, locking or deleting it, or resizing the canvas', () => {
    const changes: [string, (e: ReturnType<typeof editorWith>) => void][] = [
      ['a 1 px slip', e => e.store.dispatch(layerUpdated({ variantId: variant.id, id: dishwasher.id, changes: { x: dishwasher.x + 1 }, timestamp: at }))],
      ['resize', e => e.store.dispatch(layerUpdated({ variantId: variant.id, id: dishwasher.id, changes: { width: 180 }, timestamp: at }))],
      ['rotate', e => e.store.dispatch(layerUpdated({ variantId: variant.id, id: dishwasher.id, changes: { rotation: 5 }, timestamp: at }))],
      ['replace image', e => e.store.dispatch(layerImageReplaced({ variantId: variant.id, id: dishwasher.id, assetId: 'other', timestamp: at }))],
      ['hide', e => e.store.dispatch(layerUpdated({ variantId: variant.id, id: dishwasher.id, changes: { visible: false }, timestamp: at }))],
      ['lock', e => e.store.dispatch(layerUpdated({ variantId: variant.id, id: dishwasher.id, changes: { locked: true }, timestamp: at }))],
      ['canvas size', e => e.store.dispatch(canvasResized({ variantId: variant.id, size: { width: 1080, height: 1080 }, timestamp: at }))],
    ];
    for (const [name, change] of changes) {
      const e = editorWith(), r = e.request();
      change(e); expect(e.current(r), name).toBe(false);
      e.store.dispatch(undo()); expect(e.current(r), `${name}, then Undo`).toBe(false); // Change-then-Undo stays protected.
      expect(matchesLayerEditSnapshot(r.snapshot, e.v(), e.l()!), `${name}: the layer matches again for an explicit check`).toBe(true);
      e.unsubscribe();
    }
  });
  it('keeps a request recorded in the previous snapshot format recoverable, but only for an unchanged layer', () => {
    const previous = JSON.stringify([variant.id, variant.canvas, ['pt-0dd04956555b', 'pc-9ef215', true, 1], dishwasher]);
    expect(matchesLayerEditSnapshot(previous, variant, dishwasher)).toBe(true);
    expect(matchesLayerEditSnapshot(previous, variant, { ...dishwasher, x: 700 })).toBe(false);
    expect(matchesLayerEditSnapshot(previous, variant, { ...dishwasher, zIndex: 9 })).toBe(false); // The old format keeps its own checks.
  });
});

describe('stale-request diagnostics', () => {
  it('name exactly what changed, with numbers only for geometry', () => {
    const snapshot = layerEditSnapshot(variant, dishwasher);
    expect(layerEditChanges(snapshot, variant, { ...dishwasher, x: 692.5, y: 603 })).toEqual([{ field: 'x', before: 688, after: 692.5 }, { field: 'y', before: 600, after: 603 }]);
    expect(describeLayerEditChanges(layerEditChanges(snapshot, variant, { ...dishwasher, x: 692.5, y: 603 }))).toBe('position (x 688 → 692.5, y 600 → 603)');
    expect(layerEditChanges(snapshot, variant, { ...dishwasher, assetId: 'replacement' })).toEqual([{ field: 'assetId' }]);
    expect(describeLayerEditChanges([{ field: 'assetId' }, { field: 'width', before: 150, after: 180 }])).toBe('image; size (width 150 → 180)');
    expect(layerEditChanges(snapshot, variant, { ...dishwasher, zIndex: 9 })).toEqual([]); // Stacking is not part of the source.
    expect(layerEditChanges(snapshot, variant, undefined)).toEqual([{ field: 'layer' }]);
    expect(layerEditChanges(snapshot, { ...variant, canvas: { ...variant.canvas, width: 1080 } }, dishwasher)).toEqual([{ field: 'canvas' }]);
    expect(layerEditChanges('not json', variant, dishwasher)).toEqual([{ field: 'request' }]);
    expect(snapshotFingerprint(snapshot)).toMatch(/^[0-9a-f]{8}$/);
    expect(snapshotFingerprint(snapshot)).not.toBe(snapshotFingerprint(layerEditSnapshot(variant, { ...dishwasher, x: 689 })));
  });
  it('are logged and kept (last 20) without any layer content, and never throw', () => {
    const items = new Map<string, string>(), storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) } as Storage;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conflict: LayerEditConflict = { at, operationId: '4a334bdd-b605-4923-bc8e-5cbb1f6ec626', layerId: dishwasher.id, where: 'during-generation', side: 'client', resultArrived: false,
      requested: { fingerprint: 'aaaaaaaa', version: 3 }, current: { fingerprint: 'bbbbbbbb', version: 4 }, selected: true, changed: [{ field: 'x', before: 688, after: 692.5 }], layerChanged: true };
    for (let i = 0; i < 25; i++) recordLayerEditConflict(() => storage, { ...conflict, requested: { ...conflict.requested, version: i } });
    const log = JSON.parse(items.get(CONFLICT_LOG_KEY)!) as LayerEditConflict[];
    expect(log).toHaveLength(20); expect(log[0].requested.version).toBe(5); expect(log.at(-1)).toMatchObject({ layerId: dishwasher.id, changed: [{ field: 'x' }] });
    expect(warn).toHaveBeenCalledTimes(25);
    expect(() => recordLayerEditConflict(() => { throw new Error('blocked'); }, conflict)).not.toThrow();
    warn.mockRestore();
  });
});

describe('Konva Transformer: a handle pressed without moving is not an edit', () => {
  it('returns nothing for an unchanged node, whatever the rotation', () => {
    const rotations = [0, 12.3, 0.1, 90.7, 180, -180];
    // What the handler used to commit for these no-op gestures: a different number for most of them.
    expect(rotations.map(r => ((r + 540) % 360) - 180 !== r)).toEqual([false, true, true, true, true, false]);
    for (const rotation of rotations) expect(transformedLayer({ ...dishwasher, rotation }, { x: dishwasher.x, y: dishwasher.y, scaleX: 1, scaleY: 1, rotation })).toBeUndefined();
  });
  it('commits real moves, resizes and rotations exactly as before', () => {
    expect(transformedLayer(dishwasher, { x: 700, y: 600, scaleX: 1.2, scaleY: 1.2, rotation: 0 })).toEqual({ x: 700, y: 600, width: 180, height: 252, rotation: 0 });
    expect(transformedLayer(dishwasher, { x: 688, y: 600, scaleX: 1, scaleY: 1, rotation: 190 })).toEqual({ x: 688, y: 600, width: 150, height: 210, rotation: -170 });
    expect(transformedLayer(dishwasher, { x: 688, y: 600, scaleX: 0.001, scaleY: 0.001, rotation: 0 })!.width).toBeGreaterThan(0);
  });
});
