import type { DesignLayer, DesignVariant, LayerEditCandidate, LayerEditTarget } from '@frameflow/shared';

export function editableLayer(variant: DesignVariant, layer: DesignLayer): { target?: LayerEditTarget; reason?: string } {
  if (layer.type !== 'image') return { reason: 'Choose an image object. Shapes and text use their existing controls.' };
  if (!layer.visible || layer.locked) return { reason: 'Show and unlock this layer before editing it.' };
  if (!layer.assetId) return { reason: 'This layer has no image data.' };
  if (layer.id === 'art-background' || layer.source?.layerId.startsWith('base-') || layer.role === 'logo' || layer.textSuggestion || layer.source?.kind === 'text' || layer.protectedSlot)
    return { reason: 'Choose an individual visual object. Backgrounds, logos and text use their existing controls.' };
  if (variant.creative?.product && layer.id.startsWith('object-')) return { target: { kind: 'creative', templateId: variant.creative.masterId, creativeId: variant.creative.creativeId, revision: variant.creative.syncedRevision, layerId: layer.id } };
  if (layer.source?.jobId && layer.source.kind === 'image' && layer.source.layerId.startsWith('output-'))
    return { target: { kind: 'run', runId: layer.source.jobId, layerId: layer.source.layerId } };
  return { reason: 'Open this object from a saved product creative or a decomposition run to verify its source.' };
}
/**
 * Image/placement and owning creative identify the source. Save acknowledgements and unrelated document revisions do not.
 * Neither do stacking order (zIndex is renumbered for every layer when any other element is reordered or duplicated) or the
 * canvas fill: neither changes the image that was sent or where Apply puts the result, which always uses the layer as it is.
 */
export const layerEditSnapshot = (variant: DesignVariant, layer: DesignLayer) => {
  const creative = variant.creative, { zIndex: _zIndex, ...own } = layer; void _zIndex;
  return JSON.stringify([variant.id, [variant.canvas.width, variant.canvas.height], creative ? [creative.masterId, creative.creativeId, creative.product, creative.scale] : null, own]);
};
/** The two earlier snapshot formats, so a request recorded by a previous client stays recoverable without weaker checks. */
const earlierSnapshots = (variant: DesignVariant, layer: DesignLayer) => {
  const creative = variant.creative;
  return [JSON.stringify([variant.id, variant.canvas, creative ? [creative.masterId, creative.creativeId, creative.product, creative.scale] : null, layer]),
    JSON.stringify([variant.id, variant.revision, variant.creative, layer])];
};
export const matchesLayerEditSnapshot = (snapshot: string, variant: DesignVariant, layer: DesignLayer) =>
  snapshot === layerEditSnapshot(variant, layer) || earlierSnapshots(variant, layer).includes(snapshot);

/** One difference between the layer a request was made from and the layer now. Numbers keep their values; other fields only their name. */
export interface LayerEditChange { field: string; before?: number; after?: number }
/**
 * Diagnostics only (never a validity check): what differs between a request's snapshot and the layer now. Empty means the
 * fields match again, so only the change counter moved: a change made and then undone, or the layer was reselected.
 */
export function layerEditChanges(snapshot: string, variant: DesignVariant, layer: DesignLayer | undefined): LayerEditChange[] {
  let parsed: unknown;
  try { parsed = JSON.parse(snapshot); } catch { return [{ field: 'request' }]; }
  if (!Array.isArray(parsed) || parsed.length !== 4 || !parsed[3] || typeof parsed[3] !== 'object') return [{ field: 'request' }];
  const [variantId, canvas, creative, was] = parsed as [unknown, unknown, unknown, Record<string, unknown>];
  if (!layer) return [{ field: 'layer' }];
  const changes: LayerEditChange[] = [];
  if (variantId !== variant.id) changes.push({ field: 'design' });
  // The oldest format stored the variant revision where the canvas is now, and the whole creative link.
  const legacy = typeof canvas === 'number';
  const size = Array.isArray(canvas) ? canvas : canvas && typeof canvas === 'object' ? [(canvas as { width?: unknown }).width, (canvas as { height?: unknown }).height] : undefined;
  if (size && (size[0] !== variant.canvas.width || size[1] !== variant.canvas.height)) changes.push({ field: 'canvas' });
  const c = variant.creative, identity = c ? [c.masterId, c.creativeId, c.product, c.scale] : null;
  if (!legacy && JSON.stringify(creative) !== JSON.stringify(identity)) changes.push({ field: 'creative' });
  const now = layer as unknown as Record<string, unknown>;
  for (const field of [...new Set([...Object.keys(was), ...Object.keys(now)])]) {
    if (field === 'zIndex' || JSON.stringify(was[field]) === JSON.stringify(now[field])) continue;
    const before = was[field], after = now[field];
    changes.push(typeof before === 'number' && typeof after === 'number' ? { field, before, after } : { field });
  }
  return changes;
}
const FIELD_NAMES: Record<string, string> = { x: 'position', y: 'position', width: 'size', height: 'size', rotation: 'rotation', assetId: 'image', visible: 'visibility', locked: 'lock', opacity: 'opacity', name: 'name', canvas: 'canvas size', creative: 'creative', layer: 'layer (removed)', design: 'design version', request: 'request' };
const round = (n: number) => Math.round(n * 100) / 100;
/** A short sentence for the conflict message, e.g. "position (x 612.4 → 618.1)". */
export function describeLayerEditChanges(changes: LayerEditChange[]) {
  if (!changes.length) return '';
  const groups = new Map<string, string[]>();
  for (const c of changes) {
    const name = FIELD_NAMES[c.field] ?? c.field, list = groups.get(name) ?? [];
    if (c.before !== undefined && c.after !== undefined && ['x', 'y', 'width', 'height', 'rotation', 'opacity'].includes(c.field)) list.push(`${c.field} ${round(c.before)} → ${round(c.after)}`);
    groups.set(name, list);
  }
  return [...groups].map(([name, details]) => details.length ? `${name} (${details.join(', ')})` : name).join('; ');
}
/** A short, stable fingerprint of a snapshot for diagnostics: it never contains layer data. */
export function snapshotFingerprint(snapshot: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < snapshot.length; i++) hash = Math.imul(hash ^ snapshot.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
/** Konva rotates about the top-left. Keep the visible centre fixed when replacing a trimmed, expanded silhouette. */
export function editedLayerGeometry(layer: DesignLayer, g: LayerEditCandidate['geometry']) {
  const width = layer.width * g.width, height = layer.height * g.height;
  const dx = layer.width * g.centerX - width / 2, dy = layer.height * g.centerY - height / 2, a = layer.rotation * Math.PI / 180;
  return { width, height, x: layer.x + dx * Math.cos(a) - dy * Math.sin(a), y: layer.y + dx * Math.sin(a) + dy * Math.cos(a) };
}
