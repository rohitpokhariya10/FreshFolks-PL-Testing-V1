import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LayerEditTarget } from '@frameflow/shared';
import { isSemanticText } from './interactionGrouping.js';
import { readRun, RunError, validRunId } from './layerizeExperiment.js';
import type { ProtectedStore } from './protectedTemplates/store.js';
import type { ProductCreatives } from './protectedTemplates/product/creatives.js';

/** bytes: the saved layer image. original: the product as imported into the template (the run's own layer for a run), if known. */
export interface ResolvedLayerEdit { bytes: Buffer; name: string; original?: Buffer }
const invalid = (): never => { throw new RunError('INVALID_LAYER_EDIT', 'Select a visible, unlocked saved object layer. Backgrounds, text and logos cannot be edited here.'); };
export function layerEditTarget(raw: unknown): LayerEditTarget {
  if (!raw || typeof raw !== 'object') return invalid();
  const t = raw as Record<string, unknown>;
  if (typeof t.layerId !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(t.layerId)) return invalid();
  if (t.kind === 'creative' && typeof t.templateId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(t.templateId)
    && typeof t.creativeId === 'string' && /^pc-[a-f0-9]{6}$/.test(t.creativeId) && Number.isInteger(t.revision) && Number(t.revision) > 0)
    return { kind: 'creative', templateId: t.templateId, creativeId: t.creativeId, layerId: t.layerId, revision: Number(t.revision) };
  if (t.kind === 'run' && typeof t.runId === 'string' && validRunId(t.runId)) return { kind: 'run', runId: t.runId, layerId: t.layerId };
  return invalid();
}

/** The enclosing experiment guard owns access. There are no per-user accounts in this existing application. */
export function resolveLayerEdit(options: { store: ProtectedStore; creatives: ProductCreatives; runsDir: string }) {
  return async (target: LayerEditTarget): Promise<ResolvedLayerEdit> => {
    if (target.kind === 'creative') {
      const c = options.creatives.read(target.templateId, target.creativeId);
      if (c.revision !== target.revision) throw new RunError('STALE_REVISION', 'This creative changed. Reopen its latest saved revision.');
      const o = c.objects.find(o => `object-${o.id}` === target.layerId);
      if (!o || o.hidden || o.locked) return invalid();
      const bytes = options.store.read(target.templateId, o.asset.file);
      const original = o.asset.kind === 'template' ? bytes : options.creatives.originalPicture?.(target.templateId, target.creativeId, o.id)?.bytes;
      return { bytes, name: o.label, ...(original ? { original } : {}) };
    }
    const dir = join(options.runsDir, target.runId), run = readRun(dir);
    const source = run.outputLayers ?? run.layers ?? [];
    const layer = source.find(l => `output-${l.index}` === target.layerId);
    if (!layer || (run.editorLayerFiles && !run.editorLayerFiles.includes(layer.file)) || ['base', 'unresolved'].includes(layer.placement.kind)
      || isSemanticText(layer) || layer.semantic?.editableIndependently === false || /\b(?:background|backdrop|text|logo|typography)\b/i.test((layer.semantic?.type ?? layer.provenance?.role ?? layer.name ?? '').replace(/[_-]/g, ' ')) || !/^[a-z0-9-]+\.(png|webp|jpg)$/.test(layer.file)) return invalid();
    const bytes = readFileSync(join(dir, layer.file));
    return { bytes, name: layer.name ?? 'Visual object', original: bytes };
  };
}
