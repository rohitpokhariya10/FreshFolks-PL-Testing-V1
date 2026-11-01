import { describe, expect, it } from 'vitest';
import type { DesignVariant, ImageLayerElement, ProjectDocument } from '@frameflow/shared';
import { createEditorStore, selectActiveVariant } from '../../store';
import { creativeSynced, documentRenamed, layerEditApplied, layerUpdated, layerImageReplaced, layerDeleted } from '../../store/editorSlice';
import { elementSelected, variantSelected } from '../../store/uiSlice';
import { undo, redo } from '../../store/history';
import { editableLayer, editedLayerGeometry, layerEditSnapshot, matchesLayerEditSnapshot } from './layerEdit';
import { createLayerEditSourceTracker, previewIsCurrent, previewLayer, type LayerCanvasPreview } from './LayerEditPreview';
import { saveStatusChanged } from '../../store/saveSlice';

const layer: ImageLayerElement = { id: 'fridge', type: 'image', name: 'Refrigerator', assetId: 'original', x: 100, y: 200, width: 200, height: 400, rotation: 30, opacity: .7, zIndex: 2, visible: true, locked: false, fit: 'contain', radius: 10 };
const variant: DesignVariant = { id: 'original', name: 'Original', revision: 0, canvas: { width: 1080, height: 1080, backgroundColor: '#fff' }, elements: [], layers: [layer, { ...layer, id: 'other', name: 'Character' }] };
const project: ProjectDocument = { schemaVersion: 1, id: 'preview-test', name: 'Test', createdAt: '2026-11-01', updatedAt: '2026-11-01', variants: [variant, { ...variant, id: 'another' }] };
const geometry = editedLayerGeometry(layer, { width: 2, height: 1.1, centerX: .5, centerY: .5 });
const preview: LayerCanvasPreview = { operationId: 'candidate', variantId: variant.id, layerId: layer.id, snapshot: layerEditSnapshot(variant, layer), version: 0, mode: 'after', image: {} as HTMLImageElement, geometry };

describe('ephemeral AI layer rendering', () => {
  it('replaces only the selected rendered geometry and retains rotation, opacity, order and the original object', () => {
    const after = previewLayer(layer, preview);
    expect(after).toMatchObject({ ...geometry, rotation: 30, opacity: .7, zIndex: 2 });
    expect(after).not.toHaveProperty('fit'); expect(after).not.toHaveProperty('radius');
    expect(previewLayer(layer, { ...preview, mode: 'before' })).toBe(layer);
    expect(previewLayer(layer, null)).toBe(layer);
    expect(previewLayer(variant.layers![1], preview)).toBe(variant.layers![1]);
    expect(layer.width).toBe(200); expect(layer.x).toBe(100);
  });
  it('keeps toggling outside persisted state and history, then commits asset and geometry in exactly one undo step', () => {
    const store = createEditorStore(project), before = store.getState().editor, persisted = JSON.stringify(before.document);
    store.dispatch(elementSelected(layer.id));
    for (let i = 0; i < 10; i++) previewLayer(layer, { ...preview, mode: i % 2 ? 'before' : 'after' });
    expect(store.getState().editor).toBe(before);
    expect(JSON.stringify(store.getState().editor.document)).toBe(persisted);
    store.dispatch(layerEditApplied({ variantId: variant.id, id: layer.id, expectedRevision: 0, expectedLayer: JSON.stringify(layer), assetId: 'accepted', geometry, timestamp: '2026-11-01' }));
    expect(store.getState().editor.past).toHaveLength(1);
    expect(selectActiveVariant(store.getState()).layers![0]).toMatchObject({ ...geometry, assetId: 'accepted' });
    store.dispatch(undo()); expect(store.getState().editor.document).toBe(before.document);
    store.dispatch(redo()); expect(selectActiveVariant(store.getState()).layers![0]).toMatchObject({ ...geometry, assetId: 'accepted' });
  });
  it('rejects selection, version and document changes; undo cannot resurrect a stale candidate', () => {
    const store = createEditorStore(project);
    store.dispatch(elementSelected(layer.id));
    const tracker = createLayerEditSourceTracker(store), unsubscribe = tracker.subscribe(() => {});
    const valid = () => previewIsCurrent(preview, selectActiveVariant(store.getState()), store.getState().ui.selectedElementId, tracker.getSnapshot());
    expect(valid()).toBe(true);
    store.dispatch(elementSelected('other')); expect(valid()).toBe(false);
    store.dispatch(elementSelected(null)); expect(valid()).toBe(false);
    store.dispatch(elementSelected(layer.id));
    store.dispatch(layerUpdated({ variantId: variant.id, id: layer.id, changes: { width: 300 }, timestamp: '2026-11-01' }));
    expect(valid()).toBe(false);
    store.dispatch(undo()); expect(layerEditSnapshot(selectActiveVariant(store.getState()), layer)).toBe(preview.snapshot); expect(valid()).toBe(false);
    store.dispatch(variantSelected('another')); store.dispatch(elementSelected(layer.id)); expect(valid()).toBe(false);
    unsubscribe();
  });
  it('does not invalidate an applied layer’s next candidate for save acknowledgements or document metadata', () => {
    const v: DesignVariant = { ...variant, creative: { product: true, masterId: 'pt-test', creativeId: 'pc-123abc', syncedRevision: 1, masterRevision: 1, scale: 1 } };
    const store = createEditorStore({ ...project, variants: [v] });
    store.dispatch(elementSelected(layer.id));
    store.dispatch(layerEditApplied({ variantId: v.id, id: layer.id, expectedRevision: 0, expectedLayer: JSON.stringify(layer), assetId: 'ai-layer-first', geometry, timestamp: '2026-11-01' }));
    const current = selectActiveVariant(store.getState()), source = current.layers![0];
    const tracker = createLayerEditSourceTracker(store), unsubscribe = tracker.subscribe(() => {});
    const nextPreview = { ...preview, snapshot: layerEditSnapshot(current, source), version: tracker.getSnapshot() };
    store.dispatch(creativeSynced({ variantId: v.id, syncedRevision: 1, masterRevision: 2 }));
    expect(selectActiveVariant(store.getState()).layers![0]).toBe(source);
    expect(store.getState().editor.version).toBeGreaterThan(1); // The old whole-document guard falsely invalidated here.
    store.dispatch(documentRenamed({ name: 'Renamed creative', timestamp: '2026-11-01' }));
    store.dispatch(saveStatusChanged('saving')); store.dispatch(saveStatusChanged('saved'));
    store.dispatch(layerUpdated({ variantId: v.id, id: 'other', changes: { x: 400 }, timestamp: '2026-11-01' }));
    expect(previewIsCurrent(nextPreview, selectActiveVariant(store.getState()), layer.id, tracker.getSnapshot())).toBe(true);
    unsubscribe();
  });
  it('gives consecutive applied images fresh versions and rejects replacement/deletion even when undone before rendering', () => {
    const store = createEditorStore(project); store.dispatch(elementSelected(layer.id));
    const tracker = createLayerEditSourceTracker(store), unsubscribe = tracker.subscribe(() => {});
    for (let i = 1; i <= 3; i++) {
      const v = selectActiveVariant(store.getState()), l = v.layers![0], old = tracker.getSnapshot();
      store.dispatch(layerEditApplied({ variantId: v.id, id: l.id, assetId: `ai-layer-${i}`, expectedRevision: v.revision, expectedLayer: JSON.stringify(l), geometry, timestamp: '2026-11-01' }));
      expect(tracker.getSnapshot()).toBe(old + 1);
      const next = selectActiveVariant(store.getState());
      expect(previewIsCurrent({ ...preview, version: tracker.getSnapshot(), snapshot: layerEditSnapshot(next, next.layers![0]) }, next, l.id, tracker.getSnapshot())).toBe(true);
    }
    const accepted = tracker.getSnapshot(), original = selectActiveVariant(store.getState());
    store.dispatch(layerImageReplaced({ variantId: variant.id, id: layer.id, assetId: 'replacement', timestamp: '2026-11-01' }));
    store.dispatch(undo()); expect(selectActiveVariant(store.getState())).toBe(original); expect(tracker.getSnapshot()).toBe(accepted + 2);
    store.dispatch(layerDeleted({ variantId: variant.id, id: layer.id, timestamp: '2026-11-01' })); store.dispatch(undo());
    expect(tracker.getSnapshot()).toBeGreaterThan(accepted + 2);
    unsubscribe();
  });
  it('open → close → recolour: saves and unrelated edits during each request keep it valid; each request names the latest saved revision and image', () => {
    const fridge: ImageLayerElement = { ...layer, id: 'object-fridge' };
    const v: DesignVariant = { ...variant, layers: [fridge, { ...layer, id: 'object-tv', name: 'Television' }], creative: { product: true, masterId: 'pt-test', creativeId: 'pc-123abc', syncedRevision: 1, masterRevision: 1, scale: 1 } };
    const store = createEditorStore({ ...project, variants: [v] }); store.dispatch(elementSelected(fridge.id));
    const tracker = createLayerEditSourceTracker(store), unsubscribe = tracker.subscribe(() => {});
    // The panel's check before sending, after the response, and before Apply.
    const current = (snapshot: string, version: number) => {
      const s = store.getState(), a = selectActiveVariant(s), l = a.layers!.find(x => x.id === fridge.id);
      return tracker.getSnapshot() === version && s.ui.selectedElementId === fridge.id && !!l && matchesLayerEditSnapshot(snapshot, a, l);
    };
    let synced = 1, previous = 'original';
    for (const [i, edit] of ['open-doors', 'close-doors', 'red'].entries()) {
      const quoted = selectActiveVariant(store.getState()), source = quoted.layers![0], quote = { snapshot: layerEditSnapshot(quoted, source), version: tracker.getSnapshot() };
      expect(source.type === 'image' && source.assetId).toBe(previous); // The reference is the image applied last.
      // While the request runs: Save creative acknowledgements, autosave status, a rename and another layer's move.
      store.dispatch(saveStatusChanged('saving')); store.dispatch(creativeSynced({ variantId: v.id, syncedRevision: ++synced })); store.dispatch(saveStatusChanged('saved'));
      store.dispatch(documentRenamed({ name: `Creative ${i}`, timestamp: '2026-11-01' }));
      store.dispatch(layerUpdated({ variantId: v.id, id: 'object-tv', changes: { x: 400 + i }, timestamp: '2026-11-01' }));
      expect(current(quote.snapshot, quote.version)).toBe(true);
      expect(editableLayer(selectActiveVariant(store.getState()), selectActiveVariant(store.getState()).layers![0]).target).toMatchObject({ kind: 'creative', revision: synced });
      const latest = selectActiveVariant(store.getState()), l = latest.layers![0];
      store.dispatch(layerEditApplied({ variantId: latest.id, id: l.id, assetId: `ai-layer-${edit}`, expectedRevision: latest.revision, expectedLayer: JSON.stringify(l), geometry, timestamp: '2026-11-01' }));
      expect(selectActiveVariant(store.getState()).layers![0]).toMatchObject({ ...geometry, assetId: `ai-layer-${edit}` });
      expect(current(quote.snapshot, quote.version)).toBe(false); // An applied result's request cannot be reused.
      previous = `ai-layer-${edit}`;
    }
    // A genuine change to the selected layer during a request still invalidates it, even when undone.
    const quoted = selectActiveVariant(store.getState()), quote = { snapshot: layerEditSnapshot(quoted, quoted.layers![0]), version: tracker.getSnapshot() };
    store.dispatch(layerUpdated({ variantId: v.id, id: fridge.id, changes: { x: 1 }, timestamp: '2026-11-01' })); store.dispatch(undo());
    expect(layerEditSnapshot(selectActiveVariant(store.getState()), selectActiveVariant(store.getState()).layers![0])).toBe(quote.snapshot);
    expect(current(quote.snapshot, quote.version)).toBe(false);
    unsubscribe();
  });
  it('can recover an unchanged pending snapshot written by the previous client', () => {
    const legacy = JSON.stringify([variant.id, variant.revision, variant.creative, layer]);
    expect(matchesLayerEditSnapshot(legacy, variant, layer)).toBe(true);
    expect(matchesLayerEditSnapshot(legacy, variant, { ...layer, assetId: 'replacement' })).toBe(false);
  });
});
