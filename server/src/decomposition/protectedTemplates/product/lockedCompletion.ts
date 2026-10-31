/**
 * Geometry-locked AI completion of an object layer's hidden or damaged parts (Complete with AI, when the layer's defects
 * are known from cutoutDefects): the model may only paint INTO the hole; it can never move, resize or reshape the object.
 *
 *   request   the layer cropped round its defects with enough of the object for context, on the plain chroma-green ground,
 *             scaled with its own proportions (no stretch) to a size the image model takes, with a real edit mask:
 *             transparent exactly where the layer is hidden or damaged (grown 2 px for the model's own blending). The hole
 *             is sent pre-filled with the local repair (the layer as it is), so the model continues a whole object.
 *   composite the answer mapped back by the same crop and scale — never registered, warped or re-fitted. The model's
 *             colours are used ONLY inside the hole and only on the layer's solid inside: its soft outline (a pixel not
 *             solid, or next to one) keeps the layer's own colour, since there the request blended the object with the
 *             green ground (a green fringe otherwise). The alpha stays the layer's (the silhouette the decomposition gave
 *             it). Every other pixel is the layer's own, byte for byte. Where the model left the green ground, the local
 *             repair stays.
 *   FLUX     the same crop at native resolution, padded to a 32 px grid (no upscale), with an opaque black/white mask:
 *             white only in the known hole, black everywhere else. No extra editable margin. The compositor and gate
 *             below are shared with the legacy OpenAI request format; neither trusts the provider to return alpha.
 *   gate      accepted only when the model kept the object where it was (its pixels next to the hole agree with the
 *             verified ones, and no small shift agrees better), filled the hole, left no green in it, and its fill meets
 *             the verified pixels round it at least about as smoothly, and in the same tone, as the local repair. Anything
 *             else is rejected with its reasons and the local repair kept: a worse AI result never replaces a layer.
 */
import sharp from 'sharp';
import { reconstructionSize } from '../../cleanBackground.js';
import { REFINE_KEY, type CutoutRepair } from './cutoutRefine.js';

type Rect = { x: number; y: number; width: number; height: number };
/** The request, and how its answer maps back: `crop` (in the layer's pixels, may reach past it) drawn at `rect` of `size`. */
export interface LockedRequest { image: Buffer; mask: Buffer; prompt: string; size: { width: number; height: number }; crop: Rect; rect: { left: number; top: number; width: number; height: number } }
export interface LockedGate {
  accepted: boolean; reasons: string[];
  /**
   * Hole pixels on the solid inside; those the model filled (not the ground's green); those it left (the local repair
   * stays); hole pixels on the soft outline, kept as they were.
   */
  holePixels: number; filledPixels: number; unfilledPixels: number; outlinePixels: number;
  /** The model's pixels against the verified ones next to the hole (6 px round it): mean difference, share off by more than 40, best small shift. */
  ring: { pixels: number; meanDiff: number; offShare: number; shift: { dx: number; dy: number; meanDiff: number } };
  /**
   * Mean step across the hole's edge (fill to verified neighbour): the model's, the local repair's, and the object's own
   * step between neighbouring verified pixels in the ring (its texture: a seam shows only above it). The fill's tone
   * against the ring's: the model's, the local repair's.
   */
  seam: { ai: number; local: number; natural: number }; tone: { ai: number; local: number };
  /** Greenish pixels in the fill (the ground's spill): the model's, the local repair's. */
  green: { ai: number; local: number };
  /** Every pixel outside the hole is the layer's own (checked, not assumed). */
  preserved: boolean;
}

const RING = 6, SHIFT = 3;
const holeOf = (repair: CutoutRepair) => (repair instanceof Uint8Array ? repair : repair.mask);
const greenish = (r: number, g: number, b: number) => g - Math.max(r, b) > 24;
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export const lockedPrompt = (label: string, provider: 'openai' | 'flux' = 'openai') => [
  `Edit only the ${provider === 'flux' ? 'white area of the mask; black areas are protected' : 'transparent area of the mask'}. It covers parts of this ${label.replace(/\s+/g, ' ').slice(0, 80)} that were hidden behind other objects or damaged.`,
  'Redraw only those parts as the natural continuation of the object\'s own visible surfaces, edges, seams, panel lines, handles, shading and colours, matching the pixels right next to them.',
  'Keep every pixel outside the mask exactly as it is: the object stays in the same place, at the same size, proportions and perspective. Do not move, resize, redraw or redesign the object.',
  'Do not invent labels, logos, model numbers, branded details or reflections of other objects, and keep the plain flat pure green (#00FF00) background.',
].join(' ');

/** A 0/1 map grown by `r` pixels (square neighbourhood). */
function grow(map: Uint8Array, w: number, h: number, r: number) {
  const across = new Uint8Array(map.length), out = new Uint8Array(map.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let d = -r; d <= r && !v; d++) { const X = x + d; if (X >= 0 && X < w && map[y * w + X]) v = 1; } across[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let d = -r; d <= r && !v; d++) { const Y = y + d; if (Y >= 0 && Y < h && across[Y * w + x]) v = 1; } out[y * w + x] = v; }
  return out;
}

/** The targeted request for a layer with defects (see the top of this file), or nothing when no defect is inside its outline. */
export async function lockedRequest(asset: Buffer, repair: CutoutRepair, label: string, provider: 'openai' | 'flux' = 'openai'): Promise<LockedRequest | undefined> {
  const { data: px, info } = await sharp(asset).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), w = info.width, h = info.height, hole = holeOf(repair);
  if (hole.length !== w * h) throw new Error('Repair mask dimensions do not match the layer.');
  if (provider === 'flux') {
    // Evidence must include solid pixels to reconstruct and verified neighbours to constrain the completion.
    const near = grow(hole, w, h, RING);
    let solid = 0, verified = 0;
    for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] >= 250) { if (hole[i]) solid++; else if (near[i]) verified++; }
    if (!solid || verified < 16) return undefined;
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) if (hole[i] && px[i * 4 + 3]) { const x = i % w, y = (i - x) / w; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return undefined;
  // Context: the hole's box grown by half its larger side (at least 24 px), kept within the layer and 8 px of ground round it.
  const m = Math.max(24, Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) / 2)), pad = 8;
  const left = Math.max(-pad, x0 - m), top = Math.max(-pad, y0 - m), right = Math.min(w + pad, x1 + 1 + m), bottom = Math.min(h + pad, y1 + 1 + m);
  const crop: Rect = { x: left, y: top, width: right - left, height: bottom - top };
  // Proportions the model takes (1:3 to 3:1): the short side widened round its centre (more ground, never a stretch).
  if (crop.width > 3 * crop.height) { const add = Math.ceil(crop.width / 3) - crop.height; crop.y -= add >> 1; crop.height += add; }
  if (crop.height > 3 * crop.width) { const add = Math.ceil(crop.height / 3) - crop.width; crop.x -= add >> 1; crop.width += add; }
  // FLUX uses the native crop: pad to a 32 px grid without enlarging or stretching object pixels. The legacy OpenAI
  // sizing stays available for rollback. Reject oversized crops instead of silently losing detail or over-spending.
  if (provider === 'flux') {
    const width = Math.max(64, Math.ceil(crop.width / 32) * 32), height = Math.max(64, Math.ceil(crop.height / 32) * 32);
    if (width > 4096 || height > 4096) return undefined;
    crop.x -= Math.floor((width - crop.width) / 2); crop.y -= Math.floor((height - crop.height) / 2);
    crop.width = width; crop.height = height;
  }
  const size = provider === 'flux' ? { width: crop.width, height: crop.height } : reconstructionSize(crop)!;
  // The crop on the green ground (the layer composited over it), and the mask: transparent where the model may paint.
  const cw = crop.width, ch = crop.height, rgb = Buffer.alloc(cw * ch * 3), keep = Buffer.alloc(cw * ch * 4), open = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) open[i] = hole[i] && px[i * 4 + 3] ? 1 : 0;
  const editable = provider === 'flux' ? open : grow(open, w, h, 2);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const X = x + crop.x, Y = y + crop.y, o = (y * cw + x), inside = X >= 0 && Y >= 0 && X < w && Y < h, i = Y * w + X, a = inside ? px[i * 4 + 3] / 255 : 0;
    for (let c = 0; c < 3; c++) rgb[o * 3 + c] = Math.round(a * (inside ? px[i * 4 + c] : 0) + (1 - a) * REFINE_KEY[c]);
    const edit = inside && editable[i];
    if (provider === 'flux') { keep[o * 4] = keep[o * 4 + 1] = keep[o * 4 + 2] = edit ? 255 : 0; keep[o * 4 + 3] = 255; }
    else keep[o * 4 + 3] = edit ? 0 : 255;
  }
  const image = await sharp(rgb, { raw: { width: cw, height: ch, channels: 3 } }).resize(size.width, size.height, { fit: 'fill' }).png().toBuffer();
  const mask = await sharp(keep, { raw: { width: cw, height: ch, channels: 4 } }).resize(size.width, size.height, { fit: 'fill', kernel: 'nearest' }).png({ compressionLevel: 9 }).toBuffer();
  return { image, mask, prompt: lockedPrompt(label, provider), size, crop, rect: { left: 0, top: 0, width: size.width, height: size.height } };
}

/**
 * The answer composited into the layer and judged (see the top of this file). `png` is what may be offered: the completed
 * layer when accepted, else the layer unchanged; `candidate` is the completed layer either way (to look at).
 */
export async function lockedCompletion(result: Buffer, asset: Buffer, place: Pick<LockedRequest, 'size' | 'crop' | 'rect'>, repair: CutoutRepair): Promise<{ png: Buffer; candidate: Buffer; gate: LockedGate }> {
  const { data, info } = await sharp(asset).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), w = info.width, h = info.height, own = Buffer.from(data), hole = holeOf(repair);
  const { crop } = place, cw = crop.width, ch = crop.height;
  const ai = await sharp(await sharp(result).resize(place.size.width, place.size.height, { fit: 'fill' }).extract(place.rect).png().toBuffer()).resize(cw, ch, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const aiAt = (x: number, y: number) => { const X = x - crop.x, Y = y - crop.y; return X < 0 || Y < 0 || X >= cw || Y >= ch ? -1 : (Y * cw + X) * 3; };
  const n = w * h, H = new Uint8Array(n), soft = new Uint8Array(n);
  for (let i = 0; i < n; i++) soft[i] = own[i * 4 + 3] < 250 ? 1 : 0;
  const outline = grow(soft, w, h, 1);
  let outlinePixels = 0;
  for (let i = 0; i < n; i++) { const x = i % w, y = (i - x) / w; if (!hole[i] || !own[i * 4 + 3] || aiAt(x, y) < 0) continue; if (outline[i]) outlinePixels++; else H[i] = 1; }
  // Composite: the model's colours inside the hole (the layer's alpha kept); its green ground there is not the object.
  const out = Buffer.from(own);
  let holePixels = 0, filledPixels = 0, greenAi = 0, greenLocal = 0;
  for (let i = 0; i < n; i++) {
    if (!H[i]) continue;
    holePixels++;
    const x = i % w, y = (i - x) / w, k = aiAt(x, y), r = ai[k], g = ai[k + 1], b = ai[k + 2];
    if (greenish(own[i * 4], own[i * 4 + 1], own[i * 4 + 2])) greenLocal++;
    if (Math.hypot(r - REFINE_KEY[0], g - REFINE_KEY[1], b - REFINE_KEY[2]) < 135) continue;
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; filledPixels++;
    if (greenish(r, g, b)) greenAi++;
  }
  let preserved = true;
  for (let i = 0; i < n && preserved; i++) if (!H[i] && (out[i * 4] !== own[i * 4] || out[i * 4 + 1] !== own[i * 4 + 1] || out[i * 4 + 2] !== own[i * 4 + 2] || out[i * 4 + 3] !== own[i * 4 + 3])) preserved = false;
  for (let i = 0; i < n; i++) if (out[i * 4 + 3] !== own[i * 4 + 3]) preserved = false;
  // The ring: verified (solid, not in the hole) pixels within 6 px of it, where the model was told to keep the picture.
  const near = grow(H, w, h, RING), ring: number[] = [];
  for (let i = 0; i < n; i++) { const x = i % w, y = (i - x) / w; if (near[i] && !H[i] && !hole[i] && own[i * 4 + 3] >= 250 && aiAt(x, y) >= 0) ring.push(i); }
  const ringDiff = (dx: number, dy: number) => {
    let sum = 0, cnt = 0, off = 0;
    for (const i of ring) { const x = i % w, y = (i - x) / w, k = aiAt(x + dx, y + dy); if (k < 0) continue; const d = [0, 1, 2].map(c => Math.abs(own[i * 4 + c] - ai[k + c])); sum += (d[0] + d[1] + d[2]) / 3; if (Math.max(...d) > 40) off++; cnt++; }
    return { meanDiff: cnt ? sum / cnt : 255, offShare: cnt ? off / cnt : 1 };
  };
  const at0 = ringDiff(0, 0);
  let shift = { dx: 0, dy: 0, meanDiff: at0.meanDiff };
  for (let dy = -SHIFT; dy <= SHIFT; dy++) for (let dx = -SHIFT; dx <= SHIFT; dx++) { if (!dx && !dy) continue; const s = ringDiff(dx, dy).meanDiff; if (s < shift.meanDiff) shift = { dx, dy, meanDiff: s }; }
  // Seam: each hole pixel against its verified 4-neighbours; tone: the fill's mean brightness against the ring's.
  let seamAi = 0, seamLocal = 0, pairs = 0, fillAi = 0, fillLocal = 0;
  for (let i = 0; i < n; i++) {
    if (!H[i]) continue;
    fillAi += luma(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]); fillLocal += luma(own[i * 4], own[i * 4 + 1], own[i * 4 + 2]);
    const x = i % w, y = (i - x) / w;
    for (const [X, Y] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (H[j] || hole[j] || own[j * 4 + 3] < 250) continue;
      for (let c = 0; c < 3; c++) { seamAi += Math.abs(out[i * 4 + c] - own[j * 4 + c]) / 3; seamLocal += Math.abs(own[i * 4 + c] - own[j * 4 + c]) / 3; }
      pairs++;
    }
  }
  let step = 0, steps = 0;
  for (const i of ring) { const x = i % w; if (x + 1 >= w) continue; const j = i + 1; if (!near[j] || H[j] || hole[j] || own[j * 4 + 3] < 250) continue; for (let c = 0; c < 3; c++) step += Math.abs(own[i * 4 + c] - own[j * 4 + c]) / 3; steps++; }
  const ringLuma = ring.length ? ring.reduce((s, i) => s + luma(own[i * 4], own[i * 4 + 1], own[i * 4 + 2]), 0) / ring.length : 0;
  const round = (v: number) => Math.round(v * 100) / 100;
  const seam = { ai: round(pairs ? seamAi / pairs : 0), local: round(pairs ? seamLocal / pairs : 0), natural: round(steps ? step / steps : 0) };
  const tone = { ai: round(holePixels ? Math.abs(fillAi / holePixels - ringLuma) : 0), local: round(holePixels ? Math.abs(fillLocal / holePixels - ringLuma) : 0) };
  const reasons: string[] = [];
  if (!preserved) reasons.push('pixels outside the hole changed');
  if (!holePixels) reasons.push('nothing to complete inside the outline');
  if (holePixels && filledPixels < 0.97 * holePixels) reasons.push(`the model left ${holePixels - filledPixels} of ${holePixels} hidden pixels unfilled`);
  if (at0.meanDiff > 14 || at0.offShare > 0.12) reasons.push(`the model did not keep the object in place next to the hole (mean difference ${round(at0.meanDiff)}, ${Math.round(at0.offShare * 100)}% off)`);
  if ((shift.dx || shift.dy) && shift.meanDiff < at0.meanDiff - 2) reasons.push(`the model's drawing is shifted by about ${shift.dx}, ${shift.dy} px`);
  if (seam.ai > Math.max(seam.local, seam.natural) * 1.5 + 1.5) reasons.push(`a visible seam at the hole's edge (${seam.ai}; the local repair ${seam.local}, the object's own texture ${seam.natural})`);
  if (tone.ai > tone.local + 6) reasons.push(`the fill is a different tone from the object round it (${tone.ai} against ${tone.local} for the local repair)`);
  if (greenAi > greenLocal + Math.max(3, 0.005 * holePixels)) reasons.push(`${greenAi} greenish pixels of the model's ground in the fill`);
  const gate: LockedGate = { accepted: !reasons.length, reasons, holePixels, filledPixels, unfilledPixels: holePixels - filledPixels, outlinePixels,
    ring: { pixels: ring.length, meanDiff: round(at0.meanDiff), offShare: round(at0.offShare), shift: { ...shift, meanDiff: round(shift.meanDiff) } }, seam, tone, green: { ai: greenAi, local: greenLocal }, preserved };
  const candidate = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return { png: gate.accepted ? candidate : asset, candidate, gate };
}
