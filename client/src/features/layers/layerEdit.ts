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
/** Image/placement and owning creative identify the source. Save acknowledgements and unrelated document revisions do not. */
export const layerEditSnapshot = (variant: DesignVariant, layer: DesignLayer) => {
  const creative = variant.creative;
  return JSON.stringify([variant.id, variant.canvas, creative ? [creative.masterId, creative.creativeId, creative.product, creative.scale] : null, layer]);
};
/** Keep an already pending request from the previous client recoverable, without weakening its original checks. */
export const matchesLayerEditSnapshot = (snapshot: string, variant: DesignVariant, layer: DesignLayer) =>
  snapshot === layerEditSnapshot(variant, layer) || snapshot === JSON.stringify([variant.id, variant.revision, variant.creative, layer]);
/** Konva rotates about the top-left. Keep the visible centre fixed when replacing a trimmed, expanded silhouette. */
export function editedLayerGeometry(layer: DesignLayer, g: LayerEditCandidate['geometry']) {
  const width = layer.width * g.width, height = layer.height * g.height;
  const dx = layer.width * g.centerX - width / 2, dy = layer.height * g.centerY - height / 2, a = layer.rotation * Math.PI / 180;
  return { width, height, x: layer.x + dx * Math.cos(a) - dy * Math.sin(a), y: layer.y + dx * Math.sin(a) + dy * Math.cos(a) };
}
