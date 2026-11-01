/** A single selected asset edited once. No decomposition, repair, segmentation call, or automatic application. */
import sharp from 'sharp';
import { LAYER_EDIT_LIMITS } from '@frameflow/shared';
import { RunError } from './layerizeExperiment.js';
import { sha256 } from './protectedTemplates/pixels.js';
import { cutOutUpload } from './protectedTemplates/product/uploadCutout.js';

const invalid = (message: string): never => { throw new RunError('INVALID_LAYER_EDIT', message); };
export const layerEditPrompt = (name: string, instruction: string, ground: string) => [
  `Edit only this single isolated visual object (${name.replace(/\s+/g, ' ').slice(0, 120)}), using the supplied image as the identity reference.`,
  'Keep the same object, overall design, proportions, material, finish, lighting and perspective unless the requested change requires otherwise.',
  'Preserve visible brand-like details, door and handle styles, face, clothing and character identity where present. Do not invent logos, model numbers or text.',
  'Change only what the user requests. For pose or articulation edits, keep the unchanged parts recognizably the same. Do not replace the object with a different model or person.',
  'Show the whole edited object, including any opened or raised parts, with space around it. Keep the unchanged body at its reference scale and centered; use the surrounding space for changed parts. Do not clip it, add unrelated objects, a scene, a floor, a cast shadow or a poster.',
  `Return one isolated object with real transparent surroundings and transparent gaps, no checkerboard. If native alpha is unavailable, use a completely flat ${ground} background instead, no gradients or texture.`,
  `Requested edit: ${instruction}`,
].join(' ');

/** Tight alpha bounds preserve the selected object even for full-canvas decomposition assets. */
export async function prepareLayerEdit(bytes: Buffer) {
  if (!bytes.length || bytes.length > LAYER_EDIT_LIMITS.uploadBytes) invalid('Choose a single layer image up to 25 MB.');
  let decoded;
  try {
    const image = sharp(bytes, { limitInputPixels: LAYER_EDIT_LIMITS.pixels }), m = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(m.format ?? '') || (m.pages ?? 1) !== 1) invalid('Use a single PNG, JPEG or WebP layer.');
    decoded = await image.rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch { invalid('The selected layer could not be decoded safely.'); }
  const { data, info } = decoded!, w = info.width, h = info.height;
  let left = w, top = h, right = -1, bottom = -1, solid = 0;
  const keys = [[0, 255, 0], [255, 0, 255], [0, 255, 255]], matches = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (data[i + 3] < 16) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); solid++;
    keys.forEach((key, k) => { if (Math.max(...key.map((v, c) => Math.abs(v - data[i + c]))) < 80) matches[k]++; });
  }
  if (solid < 32 || right - left < 3 || bottom - top < 3) invalid('The selected layer is empty or too small to edit.');
  const bounds = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const key = keys[matches.indexOf(Math.min(...matches))], ground = `#${key.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  // Reserve space in both directions for articulated doors, arms, and other silhouette changes.
  const size = { width: 1024, height: 1024 }, scale = 560 / Math.max(bounds.width, bounds.height);
  const rect = { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)), left: 0, top: 0 };
  rect.left = Math.round((size.width - rect.width) / 2); rect.top = Math.round((size.height - rect.height) / 2);
  const object = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).extract(bounds).resize(rect.width, rect.height).png().toBuffer();
  const image = await sharp({ create: { ...size, channels: 3, background: ground } }).composite([{ input: object, left: rect.left, top: rect.top }]).png().toBuffer();
  return { image, size, ground, rect, bounds, originalSize: { width: w, height: h }, sourceSha256: sha256(bytes) };
}

/** Accept native alpha or locally remove a plain background; never silently return an opaque poster as a cutout. */
export async function validateLayerEdit(bytes: Buffer, prepared: Awaited<ReturnType<typeof prepareLayerEdit>>) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LAYER_EDIT_LIMITS.uploadBytes) invalid('The edited image is missing or too large.');
  const meta = await sharp(bytes, { limitInputPixels: LAYER_EDIT_LIMITS.pixels }).metadata();
  if (!['png', 'webp'].includes(meta.format ?? '') || meta.width !== prepared.size.width || meta.height !== prepared.size.height || (meta.pages ?? 1) !== 1) invalid('The edited image has invalid dimensions or encoding. The original layer is unchanged.');
  const cut = await cutOutUpload(bytes);
  if (cut.background === 'kept') invalid('The model did not return an isolated object with a removable background. The original layer is unchanged.');
  const b = cut.bounds;
  if (b.left < 3 || b.top < 3 || b.left + b.width > meta.width! - 3 || b.top + b.height > meta.height! - 3)
    invalid('The edited object touches the image edge and may be clipped. Discard it and describe a smaller pose.');
  const { data, info } = await sharp(cut.png).resize(256, 256, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height, mask = new Uint8Array(n), key = prepared.ground.slice(1).match(/../g)!.map(v => parseInt(v, 16));
  let solid = 0, keyPixels = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] >= 64) {
    mask[i] = 1; solid++;
    if (key.every((v, c) => Math.abs(v - data[i * 4 + c]) < 35)) keyPixels++;
  }
  if (solid < 32 || cut.width * cut.height < 1024) invalid('The edited object is empty or too small.');
  if (cut.background === 'removed' && keyPixels > solid * 0.02) invalid('The background remains inside the edited object. Use a different edit or discard this candidate.');
  // Significant detached components can be duplicate subjects. Tiny edge fragments are ignored; identity still needs review.
  const components: number[] = [];
  for (let i = 0; i < n; i++) if (mask[i]) {
    let count = 0; const queue = [i]; mask[i] = 0;
    while (queue.length) {
      const at = queue.pop()!, x = at % info.width; count++;
      for (const next of [x ? at - 1 : -1, x < info.width - 1 ? at + 1 : -1, at - info.width, at + info.width])
        if (next >= 0 && next < n && mask[next]) { mask[next] = 0; queue.push(next); }
    }
    components.push(count);
  }
  components.sort((a, b) => b - a);
  if ((components[1] ?? 0) > components[0] * 0.12) invalid('The result contains substantial detached objects. Review the instruction and try a new edit.');
  // The whole new silhouette is retained at the reference pixel scale, never squeezed into the old rectangle.
  return { png: cut.png, width: cut.width, height: cut.height, background: cut.background as 'transparent' | 'removed',
    geometry: { width: cut.width / prepared.rect.width * prepared.bounds.width / prepared.originalSize.width,
      height: cut.height / prepared.rect.height * prepared.bounds.height / prepared.originalSize.height,
      centerX: (prepared.bounds.left + prepared.bounds.width / 2) / prepared.originalSize.width,
      centerY: (prepared.bounds.top + prepared.bounds.height / 2) / prepared.originalSize.height } };
}
