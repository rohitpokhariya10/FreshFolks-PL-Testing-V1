import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { layerEditTarget, resolveLayerEdit } from './layerEditSource.js';
import type { ProductCreatives } from './protectedTemplates/product/creatives.js';
import { fileProtectedStore } from './protectedTemplates/store.js';

it('resolves only curated object references in a saved decomposition run; paths, base, text and unresolved layers are refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'layer-edit-source-')), id = '2026-11-01T00-00-00Z-abcdef', dir = join(root, id); mkdirSync(dir);
  const bytes = Buffer.from('known saved layer bytes'); writeFileSync(join(dir, 'object.png'), bytes);
  const item = (index: number, type: string, file = 'object.png', kind = 'bbox-crop') => ({ index, file, name: `Item ${index}`, semantic: { type, id: `element-${index}`, editableIndependently: true }, placement: { kind, x: 0, y: 0, width: 50, height: 100 } });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ id, editorLayerFiles: ['object.png', 'base.png', 'text.png', 'loose.png', '../outside.png'], layers: [item(1, 'product'), item(2, 'character'), item(3, 'decoration'), item(4, 'background', 'base.png', 'base'), item(5, 'headline', 'text.png'), item(6, 'product', 'loose.png', 'unresolved'), item(7, 'product', '../outside.png'), item(8, 'product', 'not-selected.png')] }));
  const resolve = resolveLayerEdit({ runsDir: root, store: fileProtectedStore(join(root, 'protected')), creatives: {} as ProductCreatives });
  for (const index of [1, 2, 3]) expect((await resolve(layerEditTarget({ kind: 'run', runId: id, layerId: `output-${index}` }))).bytes).toEqual(bytes);
  for (const index of [4, 5, 6, 7, 8, 999]) await expect(resolve(layerEditTarget({ kind: 'run', runId: id, layerId: `output-${index}` }))).rejects.toThrow('saved object layer');
  expect(() => layerEditTarget({ kind: 'run', runId: '../outside', layerId: 'output-1' })).toThrow();
});
