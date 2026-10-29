/**
 * Cut-out verification after a decomposition (behind the `cutoutVerification` option; off, nothing here runs): each
 * product's layer checked against the evidence the decomposition left — the picture, the layers in front of it (their
 * place and order) and the background plate — and repaired on this computer before the template is reviewed:
 *
 *   hidden       what a layer in front of it hides: rebuilt from its own verified pixels within its outline (a
 *                refrigerator's corner behind a dishwasher, never a grey block or the dishwasher's pixels);
 *   background   the plate's own content in the layer: inside its outline, rebuilt as the product (a festive wheel over
 *                its corner); past it, made transparent (the backdrop under an air conditioner); a thin band along the
 *                outline, left as it is (it cannot be told from the product's own rim);
 *   damage       solid pixels unlike the picture, pinholes, specks: rebuilt, filled, removed.
 *
 * Verified pixels are kept exactly. Soft edges are left as the decomposition made them (no defringing): a rim or a soft
 * shadow stays the product's. Where the estimate is large or borders detailed content (a screen's picture, a label), the
 * result is reported `uncertain` with its reasons — the manual Refine cutout (an approved AI completion, its estimate
 * shown first) or a product photo is the way to an exact layer. Nothing is sent anywhere; nothing is charged.
 * Characters, stands and decorations are not changed: their outlines are not regular enough to rebuild in place.
 */
import sharp from 'sharp';
import type { ProductCutoutVerification, ProductObjectKind } from '@frameflow/shared';
import { cutoutDefects, refineCutout } from './cutoutRefine.js';

type Box = { x: number; y: number; width: number; height: number };
export interface StageCutout { id: string; kind: ProductObjectKind; label: string; z: number; png: Buffer; placement: Box; method: string }
export interface VerifiedCutout { png: Buffer; changed: boolean; report: ProductCutoutVerification }

const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** Methods whose pixels are the decomposition's (an uploaded photo or a known layer is authentic: never changed). */
const DECOMPOSED = new Set(['seedream', 'local', 'sam3']);

/** Every product cut-out made by the decomposition, verified (see the top of this file). `picture` and `plate`: PNG. */
export async function verifyProductCutouts(input: { picture: Buffer; plate: Buffer; cutouts: StageCutout[] }): Promise<Map<string, VerifiedCutout>> {
  const out = new Map<string, VerifiedCutout>();
  for (const c of input.cutouts) {
    if (c.kind !== 'product' || !DECOMPOSED.has(c.method)) continue;
    const front = input.cutouts.filter(x => x.id !== c.id && x.z > c.z && meets(x.placement, c.placement));
    out.set(c.id, await verifyOne(c, front, input.picture, input.plate));
  }
  return out;
}

async function verifyOne(c: StageCutout, front: StageCutout[], picture: Buffer, plate: Buffer): Promise<VerifiedCutout> {
  const d = await cutoutDefects(c.png, { picture, placement: c.placement, front: front.map(f => ({ png: f.png, placement: f.placement })), plate });
  const { data: px, info } = await sharp(c.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), w = info.width, h = info.height, n = w * h;
  let solid = 0; for (let i = 0; i < n; i++) if (px[i * 4 + 3] >= 128) solid++;
  const hiddenBehind = await behind(c, front, d.hidden, w, h);
  const base = { version: 1 as const, solidPixels: solid, hiddenPixels: d.hiddenPixels, backgroundPixels: d.foreignPixels, keptEdgePixels: d.keptPixels, keptHiddenPixels: d.keptHiddenPixels, differingPixels: d.differingPixels, hiddenBehind };
  const r = await refineCutout(c.png, { mask: d.mask, clear: d.clear }, { conservative: true });
  // Detail around what was rebuilt: the mean local spread of the verified pixels' luminance near it (0–255). A door's
  // brushed panel is a few levels; a screen's picture or a label, tens.
  const detail = detailAround(px, w, h, d.mask);
  const rebuiltShare = r.rebuiltPixels / Math.max(1, solid), clearedShare = r.clearedPixels / Math.max(1, solid);
  const reasons: string[] = [];
  if (rebuiltShare > 0.2) reasons.push(`${Math.round(100 * rebuiltShare)}% of it is an estimate (hidden or covered in the picture)`);
  if (r.rebuiltPixels > solid * 0.01 && detail > 12) reasons.push('what it hides borders detailed content (a picture, a label or controls) that a continuation cannot recover');
  if (d.keptHiddenPixels > solid * 0.01) reasons.push(`${Math.round(100 * d.keptHiddenPixels / solid)}% of it, hidden${hiddenBehind.length ? ` behind ${hiddenBehind.slice(0, 2).join(' and ')}` : ''}, lies past its visible outline: left as decomposed — it may not be part of it`);
  if (clearedShare > 0.3) {
    // Safety: a repair that would take away this much of it is not applied.
    reasons.push(`${Math.round(100 * clearedShare)}% of it matched the background — not removed automatically; check its outline`);
    return { png: c.png, changed: false, report: { ...base, rebuiltPixels: 0, clearedPixels: 0, filledPixels: 0, removedPixels: 0, detail, uncertain: true, reasons, applied: false } };
  }
  const changed = r.rebuiltPixels + r.clearedPixels + r.filledPixels + r.removedPixels > 0;
  return { png: changed ? r.png : c.png, changed, report: { ...base, rebuiltPixels: r.rebuiltPixels, clearedPixels: r.clearedPixels, filledPixels: r.filledPixels, removedPixels: r.removedPixels, detail, uncertain: reasons.length > 0, reasons, applied: changed } };
}

/** The labels of the layers in front that hide at least 1 % of it (or 200 px). */
async function behind(c: StageCutout, front: StageCutout[], hidden: Uint8Array, w: number, h: number) {
  const names: string[] = [];
  for (const f of front) {
    const { data, info } = await sharp(f.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let k = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!hidden[y * w + x]) continue;
      const X = c.placement.x + (x + 0.5) * c.placement.width / w, Y = c.placement.y + (y + 0.5) * c.placement.height / h;
      const fx = Math.floor((X - f.placement.x) * info.width / f.placement.width), fy = Math.floor((Y - f.placement.y) * info.height / f.placement.height);
      if (fx >= 0 && fy >= 0 && fx < info.width && fy < info.height && data[(fy * info.width + fx) * 4 + 3] >= 128) k++;
    }
    if (k >= Math.min(200, w * h * 0.01)) names.push(f.label);
  }
  return names;
}

function detailAround(px: Buffer, w: number, h: number, mask: Uint8Array) {
  // The verified pixels within 3 px of what was rebuilt; at each (every other one), the spread (standard deviation) of
  // the luminance of the verified pixels in the 5 × 5 square around it.
  const n = w * h, band = new Uint8Array(n), lum = new Float32Array(n), ok = (i: number) => !mask[i] && px[i * 4 + 3] >= 250;
  for (let i = 0; i < n; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i - x) / w;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) band[Y * w + X] = 1; }
  }
  let sum = 0, count = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const i = y * w + x; if (!band[i] || !ok(i)) continue;
    let s1 = 0, s2 = 0, c = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (!ok(j)) continue; s1 += lum[j]; s2 += lum[j] * lum[j]; c++; }
    if (c < 9) continue;
    sum += Math.sqrt(Math.max(0, s2 / c - (s1 / c) ** 2)); count++;
  }
  return count ? Math.round(10 * sum / count) / 10 : 0;
}
