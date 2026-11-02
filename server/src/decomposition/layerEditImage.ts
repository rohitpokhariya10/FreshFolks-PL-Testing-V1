/** A single selected asset edited once. No decomposition, repair, segmentation call, or automatic application. */
import sharp from 'sharp';
import { LAYER_EDIT_LIMITS, type LayerEditIntent, type LayerEditRegion } from '@frameflow/shared';
import { RunError } from './layerizeExperiment.js';
import { CHROMA_KEYS, lab } from './layerEditIdentity.js';
import { sha256 } from './protectedTemplates/pixels.js';
import { cutOutUpload } from './protectedTemplates/product/uploadCutout.js';

const invalid = (message: string): never => { throw new RunError('INVALID_LAYER_EDIT', message); };
const hex = (rgb: readonly number[]) => `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** Square output with the object's long side at 560 px: room for doors, arms and other parts to swing out in any direction. */
const EXPANDING = { size: 1024, long: 560 };
/** Every request stays within 1024 × 1024 pixels, so the estimate never exceeds the square request's. */
const PIXEL_BUDGET = 1024 * 1024, FILL = 0.8;
const floor16 = (v: number) => Math.max(16, Math.floor(v / 16) * 16);

/** What the model must keep, measured from the reference: its main colours (share of the object) and proportions. */
export interface MeasuredReference { palette: { hex: string; share: number }[]; aspect: number }
async function decode(bytes: Buffer) {
  if (!bytes.length || bytes.length > LAYER_EDIT_LIMITS.uploadBytes) invalid('Choose a single layer image up to 25 MB.');
  let decoded;
  try {
    const image = sharp(bytes, { limitInputPixels: LAYER_EDIT_LIMITS.pixels }), m = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(m.format ?? '') || (m.pages ?? 1) !== 1) invalid('Use a single PNG, JPEG or WebP layer.');
    decoded = await image.rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch { invalid('The selected layer could not be decoded safely.'); }
  const { data, info } = decoded!, w = info.width, h = info.height;
  let left = w, top = h, right = -1, bottom = -1, solid = 0;
  const matches = CHROMA_KEYS.map(() => 0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (data[i + 3] < 16) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); solid++;
    CHROMA_KEYS.forEach((key, k) => { if (Math.max(...key.map((v, c) => Math.abs(v - data[i + c]))) < 80) matches[k]++; });
  }
  if (solid < 32 || right - left < 3 || bottom - top < 3) invalid('The selected layer is empty or too small to edit.');
  return { data, w, h, matches, bounds: { left, top, width: right - left + 1, height: bottom - top + 1 } };
}
/** Up to three main colours (k-means in CIELAB over the object's opaque pixels), each with its share of the object. */
async function measure(d: Awaited<ReturnType<typeof decode>>): Promise<MeasuredReference> {
  const { data, info } = await sharp(d.data, { raw: { width: d.w, height: d.h, channels: 4 } }).extract(d.bounds).resize(96, 96, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const points: { rgb: number[]; lab: number[] }[] = [];
  for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] >= 200) { const rgb = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]; points.push({ rgb, lab: lab(rgb[0], rgb[1], rgb[2]) }); }
  const aspect = Math.round(d.bounds.width / d.bounds.height * 100) / 100;
  if (points.length < 8) return { palette: [], aspect };
  // Deterministic seeds: darkest, median and lightest by lightness.
  const sorted = [...points].sort((a, b) => a.lab[0] - b.lab[0]);
  let centres = [sorted[0], sorted[sorted.length >> 1], sorted[sorted.length - 1]].map(p => [...p.lab]);
  let members: number[] = [];
  for (let iter = 0; iter < 8; iter++) {
    members = points.map(p => centres.map(c => Math.hypot(c[0] - p.lab[0], c[1] - p.lab[1], c[2] - p.lab[2])).reduce((best, v, k, all) => v < all[best] ? k : best, 0));
    centres = centres.map((c, k) => { const own = points.filter((_, i) => members[i] === k); return own.length ? [0, 1, 2].map(j => own.reduce((s, p) => s + p.lab[j], 0) / own.length) : c; });
  }
  const palette = centres.map((_, k) => {
    const own = points.filter((_, i) => members[i] === k);
    return { hex: own.length ? hex([0, 1, 2].map(j => own.reduce((s, p) => s + p.rgb[j], 0) / own.length)) : '', share: own.length / points.length };
  }).filter(p => p.hex && p.share >= 0.08).sort((a, b) => b.share - a.share);
  return { palette, aspect };
}

/**
 * The request's images. Image 1 is the layer to edit (the only image a mask applies to); an identity reference (the original
 * product) is framed the same way on the same background. The background colour is the chroma key that neither image uses.
 * Edits that can grow the outline keep the existing square frame; others fill 80 % of a frame shaped like the object, at
 * the same pixel budget, so the model sees and renders the product larger at no extra cost.
 */
export async function prepareLayerEdit(bytes: Buffer, options: { intent?: LayerEditIntent; region?: LayerEditRegion; identity?: Buffer } = {}) {
  const d = await decode(bytes), identity = options.identity ? await decode(options.identity) : undefined;
  const matches = d.matches.map((m, k) => m / (d.bounds.width * d.bounds.height) + (identity ? identity.matches[k] / (identity.bounds.width * identity.bounds.height) : 0));
  const key = CHROMA_KEYS[matches.indexOf(Math.min(...matches))], ground = hex(key);
  const bounds = d.bounds, expanding = !options.intent || options.intent.expandsSilhouette;
  let size: { width: number; height: number }, scale: number;
  if (expanding) { size = { width: EXPANDING.size, height: EXPANDING.size }; scale = EXPANDING.long / Math.max(bounds.width, bounds.height); }
  else {
    const aspect = Math.min(3, Math.max(1 / 3, bounds.width / bounds.height));
    size = { width: floor16(Math.sqrt(PIXEL_BUDGET * aspect)), height: floor16(Math.sqrt(PIXEL_BUDGET / aspect)) };
    scale = FILL * Math.min(size.width / bounds.width, size.height / bounds.height);
  }
  const place = async (src: Awaited<ReturnType<typeof decode>>, k: number) => {
    const r = { width: Math.max(1, Math.round(src.bounds.width * k)), height: Math.max(1, Math.round(src.bounds.height * k)), left: 0, top: 0 };
    r.left = Math.round((size.width - r.width) / 2); r.top = Math.round((size.height - r.height) / 2);
    const object = await sharp(src.data, { raw: { width: src.w, height: src.h, channels: 4 } }).extract(src.bounds).resize(r.width, r.height).png().toBuffer();
    return { rect: r, image: await sharp({ create: { ...size, channels: 3, background: ground } }).composite([{ input: object, left: r.left, top: r.top }]).png().toBuffer() };
  };
  const main = await place(d, scale), rect = main.rect;
  const references: Buffer[] = [];
  if (identity) {
    const room = expanding ? EXPANDING.long / Math.max(identity.bounds.width, identity.bounds.height) : FILL * Math.min(size.width / identity.bounds.width, size.height / identity.bounds.height);
    references.push((await place(identity, room)).image);
  }
  let mask: Buffer | undefined, regionRect: { left: number; top: number; width: number; height: number } | undefined;
  if (options.region) {
    const r = options.region, margin = Math.max(6, Math.round(0.02 * Math.max(rect.width, rect.height)));
    const toX = (fx: number) => rect.left + (fx * d.w - bounds.left) * scale, toY = (fy: number) => rect.top + (fy * d.h - bounds.top) * scale;
    const x0 = Math.max(0, Math.floor(toX(r.x) - margin)), y0 = Math.max(0, Math.floor(toY(r.y) - margin));
    const x1 = Math.min(size.width, Math.ceil(toX(r.x + r.width) + margin)), y1 = Math.min(size.height, Math.ceil(toY(r.y + r.height) + margin));
    if (x1 - x0 < 8 || y1 - y0 < 8) invalid('The selected area does not cover the object. Select part of the object, or remove the area limit.');
    regionRect = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    // images.edit masks: fully transparent where the image may change, opaque where it must stay.
    const alpha = Buffer.alloc(size.width * size.height * 4, 255);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) alpha[(y * size.width + x) * 4 + 3] = 0;
    mask = await sharp(alpha, { raw: { ...size, channels: 4 } }).png().toBuffer();
  }
  return { image: main.image, references, mask, regionRect, size, ground, rect, bounds, originalSize: { width: d.w, height: d.h }, sourceSha256: sha256(bytes), measured: await measure(d), expanding };
}
export type PreparedLayerEdit = Awaited<ReturnType<typeof prepareLayerEdit>>;

const quote = (s: string) => `“${s.replace(/\s+/g, ' ').trim().slice(0, 160)}”`;
const OPERATION_RULES: Record<LayerEditIntent['operations'][number], string> = {
  state: 'This is a change of physical state. Move only the parts the instruction names, about their real hinges, rails or joints. Moved parts keep their own outside design (the same handles, panels, displays and finish), now seen at their new angle. Newly revealed areas such as interiors, shelves, hinges and inner panels may be created, matching the product\'s materials and lighting. The body keeps its exact size, shape and position.',
  color: 'Change only the colour of the parts the instruction names. Keep every shape, edge, panel line, logo, text, highlight and shadow in place, and do not change the outline.',
  material: 'Change only the material or finish of the parts the instruction names. Keep every shape, edge, panel line, logo and text in place, and do not change the outline.',
  add: 'Add only the requested feature, attached where the instruction says, in the product\'s own style and lighting. Everything else stays as in the reference.',
  remove: 'Remove only the named feature and continue the surrounding surface in its place. Everything else stays as in the reference, and the outline does not change elsewhere.',
  clean: 'Repair only the named visual defect. Do not redesign, recolour, restyle or re-light anything.',
  replace: 'The person explicitly asks for a replacement: create the requested object in the reference\'s pose, scale, viewing angle and lighting.',
  general: 'Make the smallest change that satisfies the instruction. Everything the instruction does not mention stays as in the reference.',
};
export interface LayerEditPromptInput {
  name: string; instruction: string; ground: string; intent: LayerEditIntent; measured?: MeasuredReference;
  /** The original product attached as image 2, with the earlier AI edits' instructions where they were recorded. */
  original?: { instructions: string[]; unrecordedEdits: number };
  region?: boolean;
}
export function layerEditPrompt(input: LayerEditPromptInput) {
  const { intent } = input, ops = intent.operations, name = input.name.replace(/\s+/g, ' ').slice(0, 120);
  const recolour = ops.includes('color') || ops.includes('material');
  const earlier = input.original ? input.original.instructions.length + input.original.unrecordedEdits : 0;
  const palette = input.measured?.palette.map(p => `${p.hex} (${Math.round(p.share * 100)}%)`).join(', ');
  return [
    `Image 1 is the exact ${name} to edit: a cut-out of this one product on a flat background. Edit this image${intent.preserveIdentity ? '; it is the identity reference' : ''}.`,
    input.original ? [
      `Image 2 shows the same product as originally imported, before ${earlier} earlier AI edit${earlier === 1 ? '' : 's'}${input.original.instructions.length ? ` (recorded instructions, oldest first: ${input.original.instructions.map(quote).join('; ')}${input.original.unrecordedEdits ? `; ${input.original.unrecordedEdits} more not recorded` : ''})` : ' whose instructions were not recorded'}.`,
      'Earlier AI edits may have changed details by mistake. Take the product\'s identity from image 2: its model, the number and arrangement of doors, drawers and panels, handles, displays and controls, logos, markings, colours and finish. Keep from image 1 only its current pose or state and what the earlier instructions deliberately changed.',
    ].join(' ') : '',
    intent.preserveIdentity ? 'It must remain the exact same physical product, not a similar or newly designed one. Keep its brand, model-specific design, body shape and proportions, number and arrangement of doors, drawers and panels, handle shapes and positions, control panels, displays and dispensers, logos, markings and printed text, materials, finish, colours and textures exactly as in the reference, except where the requested edit itself changes them.' : '',
    intent.preserveIdentity && input.measured ? `Measured from image 1: the object is ${input.measured.aspect} times as wide as it is tall${palette ? ` and its ${recolour ? 'current ' : ''}main colours are ${palette}` : ''}.${recolour ? '' : ' Keep these colours.'}` : '',
    ...ops.map(o => OPERATION_RULES[o]),
    input.region ? 'Only the area marked transparent in the mask may change. Everything outside it will be restored from image 1 afterwards, so keep it identical and make the change blend in at the border of the area.' : '',
    'Do not invent or alter logos, brand names, model numbers or text. Do not add unrelated objects, people, a scene, a floor, a cast shadow or a poster.',
    intent.expandsSilhouette
      ? 'Show the whole edited object, including any opened, raised, extended or added parts, with space around it. Keep the unchanged body at its reference scale and centered; use the surrounding space for changed parts. Do not clip it.'
      : 'Keep the object at the same size and position as in image 1, with the same space around it. Do not clip it.',
    `Return one isolated object on a completely flat ${input.ground} background. Use ${input.ground} only around the outside of the object and inside real see-through openings (for example between legs or inside a handle loop). Never use it for seams, gaps between doors or drawers, shadows or dark interiors within the object: paint those as they really look. Use this exact solid background colour with no gradients, texture, checkerboard or shadows. The background will be removed locally to produce a transparent PNG.`,
    `Requested edit: ${input.instruction}`,
  ].filter(Boolean).join(' ');
}

/** Area-limited edits: the model's pixels inside the area (feathered), the reference's exact pixels everywhere else. */
async function composeRegion(bytes: Buffer, prepared: PreparedLayerEdit) {
  const size = prepared.size, r = prepared.regionRect!;
  const [out, ref] = await Promise.all([bytes, prepared.image].map(b => sharp(b).resize(size.width, size.height).removeAlpha().raw().toBuffer()));
  const hard = Buffer.alloc(size.width * size.height);
  for (let y = r.top; y < r.top + r.height; y++) hard.fill(255, y * size.width + r.left, y * size.width + r.left + r.width);
  // Feathered inward only: pixels outside the area are always exactly the reference's.
  const soft = await sharp(await sharp(hard, { raw: { ...size, channels: 1 } }).blur(3).raw().toBuffer(), { raw: { ...size, channels: 1 } }).raw().toBuffer();
  const key = prepared.ground.slice(1).match(/../g)!.map(v => parseInt(v, 16)), merged = Buffer.alloc(out.length);
  let object = 0, agree = 0;
  for (let i = 0; i < hard.length; i++) {
    const w = hard[i] ? Math.min(soft[i], 255) / 255 : 0;
    for (let c = 0; c < 3; c++) merged[i * 3 + c] = Math.round(out[i * 3 + c] * w + ref[i * 3 + c] * (1 - w));
    // How much of the product outside the area the model kept (it was asked to keep all of it).
    if (!hard[i] && Math.max(...key.map((v, c) => Math.abs(v - ref[i * 3 + c]))) > 40) {
      object++;
      if (Math.max(Math.abs(out[i * 3] - ref[i * 3]), Math.abs(out[i * 3 + 1] - ref[i * 3 + 1]), Math.abs(out[i * 3 + 2] - ref[i * 3 + 2])) <= 48) agree++;
    }
  }
  return { png: await sharp(merged, { raw: { ...size, channels: 3 } }).png().toBuffer(), outsideAgreement: object ? agree / object : 1 };
}
/** Removes the keying colour's spill from outline pixels only; the object's interior colours are never touched. */
async function despill(png: Buffer, ground: string) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), w = info.width, h = info.height;
  const key = ground.slice(1).match(/../g)!.map(v => parseInt(v, 16)), hi = [0, 1, 2].filter(c => key[c] > 128), lo = [0, 1, 2].filter(c => key[c] <= 128);
  let changed = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (data[i + 3] === 0) continue;
    let edge = data[i + 3] < 255;
    for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || data[(Y * w + X) * 4 + 3] < 64) { edge = true; break; } }
    if (!edge) continue;
    const spill = Math.min(...hi.map(c => data[i + c])) - Math.max(...lo.map(c => data[i + c]));
    if (spill > 0) { for (const c of hi) data[i + c] -= spill; changed++; }
  }
  return changed ? sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer() : png;
}

/** Accept native alpha or locally remove a plain background; never silently return an opaque poster as a cutout. */
export async function validateLayerEdit(bytes: Buffer, prepared: PreparedLayerEdit) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LAYER_EDIT_LIMITS.uploadBytes) invalid('The edited image is missing or too large.');
  const meta = await sharp(bytes, { limitInputPixels: LAYER_EDIT_LIMITS.pixels }).metadata();
  if (!['png', 'webp'].includes(meta.format ?? '') || meta.width !== prepared.size.width || meta.height !== prepared.size.height || (meta.pages ?? 1) !== 1) invalid('The edited image has invalid dimensions or encoding. The original layer is unchanged.');
  const region = prepared.regionRect ? await composeRegion(bytes, prepared) : undefined;
  const cut = await cutOutUpload(region?.png ?? bytes);
  if (cut.background === 'kept') invalid('The model did not return an isolated object with a removable background. The original layer is unchanged.');
  const b = cut.bounds;
  if (b.left < 3 || b.top < 3 || b.left + b.width > meta.width! - 3 || b.top + b.height > meta.height! - 3)
    invalid('The edited object touches the image edge and may be clipped. Discard it and describe a smaller pose.');
  const png = cut.background === 'removed' ? await despill(cut.png, prepared.ground) : cut.png;
  const { data, info } = await sharp(png).resize(256, 256, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
  // The whole new silhouette is retained at the reference pixel scale, never squeezed into the old rectangle. A whole-object
  // edit keeps the reference's centre (the model is asked to keep the body centred); an area-limited edit kept every pixel
  // outside the area in place, so its own centre is exact.
  const sx = prepared.rect.width / prepared.bounds.width, sy = prepared.rect.height / prepared.bounds.height;
  const centre = region ? { x: prepared.bounds.left + (b.left + b.width / 2 - prepared.rect.left) / sx, y: prepared.bounds.top + (b.top + b.height / 2 - prepared.rect.top) / sy }
    : { x: prepared.bounds.left + prepared.bounds.width / 2, y: prepared.bounds.top + prepared.bounds.height / 2 };
  return { png, width: cut.width, height: cut.height, background: cut.background as 'transparent' | 'removed', ...(region ? { outsideAgreement: region.outsideAgreement } : {}),
    geometry: { width: cut.width / sx / prepared.originalSize.width, height: cut.height / sy / prepared.originalSize.height,
      centerX: centre.x / prepared.originalSize.width, centerY: centre.y / prepared.originalSize.height } };
}
