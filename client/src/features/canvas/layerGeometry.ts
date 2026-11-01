import { imageFit, LAYER_LIMITS, type DesignLayer, type ImageLayerElement, type ShapeLayerElement } from '@frameflow/shared';

/**
 * A finished Transformer gesture as layer changes, or undefined when nothing moved: pressing a handle without dragging it
 * still ends a transform, and re-normalising an unchanged rotation (12.3 → 12.299999999999955, 180 → -180) would record
 * an edit nobody made.
 */
export function transformedLayer(layer: Pick<DesignLayer, 'x' | 'y' | 'width' | 'height' | 'rotation'>, node: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }) {
  if (node.scaleX === 1 && node.scaleY === 1 && node.rotation === layer.rotation && node.x === layer.x && node.y === layer.y) return undefined;
  return { x: node.x, y: node.y, width: Math.max(LAYER_LIMITS.minSide, layer.width * node.scaleX), height: Math.max(LAYER_LIMITS.minSide, layer.height * node.scaleY), rotation: ((node.rotation + 540) % 360) - 180 };
}

/**
 * Where a layer's picture is drawn inside its box. Without a fit it is stretched to the box, as layers always were. With
 * one (an image slot from a template) it is cropped (cover) or letterboxed (contain) around the focal point, never distorted.
 */
export function layerImageProps(layer: Pick<ImageLayerElement, 'width' | 'height' | 'fit' | 'focalPoint' | 'radius'>, bitmap: { naturalWidth: number; naturalHeight: number }) {
  if (!layer.fit) return { width: layer.width, height: layer.height };
  const { crop, dest } = imageFit({ width: bitmap.naturalWidth, height: bitmap.naturalHeight }, layer, layer.fit, layer.focalPoint?.x, layer.focalPoint?.y);
  return { ...dest, crop, cornerRadius: Math.min(layer.radius ?? 0, dest.width / 2, dest.height / 2) };
}

/** Ellipse nodes draw around their center; rectangles and SVG thumbnails use a top-left origin. */
export function shapeFillProps(layer: Pick<ShapeLayerElement, 'fill' | 'gradient' | 'width' | 'height'>, origin: 'top-left' | 'center' = 'top-left') {
  if (!layer.gradient) return { fill: layer.fill };
  const radians = (layer.gradient.angle * Math.PI) / 180, dx = Math.cos(radians), dy = Math.sin(radians);
  const half = (Math.abs(dx) * layer.width + Math.abs(dy) * layer.height) / 2;
  const cx = origin === 'center' ? 0 : layer.width / 2, cy = origin === 'center' ? 0 : layer.height / 2;
  return {
    fillLinearGradientStartPoint: { x: cx - dx * half, y: cy - dy * half },
    fillLinearGradientEndPoint: { x: cx + dx * half, y: cy + dy * half },
    fillLinearGradientColorStops: [0, layer.gradient.from, 1, layer.gradient.to],
  };
}
export function strokeProps(layer: Pick<ShapeLayerElement, 'stroke'>) {
  return layer.stroke && layer.stroke.width > 0 ? { stroke: layer.stroke.color, strokeWidth: layer.stroke.width } : {};
}
/** Corner radius never exceeds half the shorter side. */
export const cornerRadius = (layer: Pick<ShapeLayerElement, 'shapeType' | 'radius' | 'width' | 'height'>) =>
  layer.shapeType === 'rounded-rectangle' ? Math.min(layer.radius, layer.width / 2, layer.height / 2) : 0;
