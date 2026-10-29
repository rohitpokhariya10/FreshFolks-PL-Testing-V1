/**
 * A decomposed object's cut-out repaired (Refine Cutout), only that layer:
 *
 *   local   free, on this computer: specks and stray fragments away from the object removed (it is the largest piece;
 *           a piece a fair fraction of its size, a detached part, is kept), pinholes filled (larger openings — a handle's
 *           gap, a glass panel — kept), the background colour bleeding into its soft edge replaced by the object's own
 *           (defringed). Nothing is eroded: every solid pixel of the object stays where it is.
 *   ai      one approved image-model request: the cut-out on a plain chroma-green ground, asked to repair only what is
 *           damaged or missing; the green keyed out, the original's own solid pixels put back over the result, then the
 *           local pass. The previous picture is kept until the person approves the result.
 *
 * Text and logos are never here: they are editable overlays, not pictures to cut out.
 */
import sharp from 'sharp';

export interface CutoutRefinement { png: Buffer; width: number; height: number; removedPixels: number; filledPixels: number; defringedPixels: number }
const SOLID = 128;

/** The local repair (free): see the top of this file. */
export async function refineCutout(png: Buffer): Promise<CutoutRefinement> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), w = info.width, h = info.height, n = w * h, px = Buffer.from(data);
  const solid = new Uint8Array(n); for (let i = 0; i < n; i++) solid[i] = px[i * 4 + 3] >= SOLID ? 1 : 0;
  // Connected pieces (8-neighbours) of the solid pixels, or of the clear ones.
  const pieces = (mask: (i: number) => boolean) => {
    const label = new Int32Array(n).fill(-1), sizes: number[] = [], touches: boolean[] = [], stack: number[] = [];
    for (let s = 0; s < n; s++) {
      if (label[s] >= 0 || !mask(s)) continue;
      const k = sizes.length; sizes.push(0); touches.push(false); label[s] = k; stack.push(s);
      while (stack.length) {
        const i = stack.pop()!, x = i % w, y = (i - x) / w; sizes[k]++;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches[k] = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const j = Y * w + X; if (label[j] < 0 && mask(j)) { label[j] = k; stack.push(j); }
        }
      }
    }
    return { label, sizes, touches };
  };
  const obj = pieces(i => solid[i] === 1), main = Math.max(0, ...obj.sizes);
  let removedPixels = 0, filledPixels = 0, defringedPixels = 0;
  // Stray fragments: pieces far smaller than the object (a speck, a sliver of background the cut-out caught).
  const keep = obj.sizes.map(a => a >= Math.max(32, main * 0.005));
  for (let i = 0; i < n; i++) if (solid[i] && !keep[obj.label[i]]) { px[i * 4 + 3] = 0; solid[i] = 0; removedPixels++; }
  // Faint haze: a translucent pixel not within two pixels of the kept object.
  const near = (i: number) => { const x = i % w, y = (i - x) / w; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && solid[Y * w + X]) return true; } return false; };
  for (let i = 0; i < n; i++) if (!solid[i] && px[i * 4 + 3] > 0 && !near(i)) { px[i * 4 + 3] = 0; removedPixels++; }
  // Pinholes: clear pieces inside the object (not reaching the edge) of a few pixels — never a real opening.
  const holes = pieces(i => solid[i] === 0);
  const mean = (i: number, ok: (j: number) => boolean) => { const x = i % w, y = (i - x) / w; let r = 0, g = 0, b = 0, c = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (!ok(j)) continue; r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; c++; }
    return c ? [r / c, g / c, b / c] : undefined; };
  for (let i = 0; i < n; i++) {
    const k = holes.label[i]; if (k < 0 || holes.touches[k] || holes.sizes[k] > Math.max(4, main * 0.0005)) continue;
    const c = mean(i, j => solid[j] === 1); if (!c) continue;
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; filledPixels++;
  }
  // Halo: a soft edge pixel's colour is the old background mixed in — the object's own colour from its solid inside.
  const inside = (j: number) => { if (px[j * 4 + 3] < 250) return false; const x = j % w, y = (j - x) / w; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || px[(Y * w + X) * 4 + 3] < 250) return false; } return true; };
  const before = Buffer.from(px);
  for (let i = 0; i < n; i++) {
    const a = before[i * 4 + 3]; if (a === 0 || a >= 250) continue;
    const c = mean(i, inside); if (!c) continue;
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; defringedPixels++;
  }
  return { png: await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer(), width: w, height: h, removedPixels, filledPixels, defringedPixels };
}

/** The image model's request for one object (see the top of this file): the instruction, its plain ground. */
export const REFINE_KEY: [number, number, number] = [0, 255, 0];
export const refinePrompt = (label: string) => [
  `Repair only the damaged or missing parts of this specific object (${label.replace(/\s+/g, ' ').slice(0, 80)}).`,
  'Preserve the original product identity, shape, proportions, colors, materials, visible details, perspective, and branding.',
  'Remove unrelated background artifacts and reconstruct incomplete edges naturally.',
  'Do not redesign the object, invent labels, replace its brand, or introduce unrelated content.',
  'Keep it exactly where it is and at the same size, on a plain flat pure green (#00FF00) background with nothing else, so it can become an independently editable transparent image layer.',
].join(' ');

/** Where the cut-out is placed on the request's square-ish canvas: inside it with a margin, its proportions kept. */
export function refineCanvas(asset: { width: number; height: number }) {
  const a = asset.width / Math.max(1, asset.height), size = a > 1.25 ? { width: 1536, height: 1024 } : a < 0.8 ? { width: 1024, height: 1536 } : { width: 1024, height: 1024 };
  const k = Math.min(size.width * 0.88 / asset.width, size.height * 0.88 / asset.height), width = Math.round(asset.width * k), height = Math.round(asset.height * k);
  return { size, rect: { left: Math.round((size.width - width) / 2), top: Math.round((size.height - height) / 2), width, height } };
}
/** The request's picture: the cut-out on the plain green ground, where refineCanvas puts it. */
export async function refineRequest(asset: Buffer) {
  const m = await sharp(asset).metadata(), { size, rect } = refineCanvas({ width: m.width ?? 1, height: m.height ?? 1 });
  const placed = await sharp(asset).resize(rect.width, rect.height, { fit: 'fill' }).png().toBuffer();
  const image = await sharp({ create: { width: size.width, height: size.height, channels: 4, background: { r: REFINE_KEY[0], g: REFINE_KEY[1], b: REFINE_KEY[2], alpha: 1 } } }).composite([{ input: placed, left: rect.left, top: rect.top }]).png().toBuffer();
  return { image, size, rect };
}
/**
 * The model's answer made a cut-out again at the original's size: its part where the object was placed, the green ground
 * keyed out (soft edge, the green spill taken off), the original's own solid pixels put back over it, then the local pass.
 */
export async function refineResult(result: Buffer, original: Buffer, place: Awaited<ReturnType<typeof refineRequest>>): Promise<CutoutRefinement> {
  const m = await sharp(original).metadata(), w = m.width ?? 1, h = m.height ?? 1;
  const crop = await sharp(await sharp(result).resize(place.size.width, place.size.height, { fit: 'fill' }).extract(place.rect).png().toBuffer()).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const own = await sharp(original).ensureAlpha().raw().toBuffer(), out = Buffer.from(crop);
  for (let i = 0; i < w * h; i++) {
    const r = out[i * 4], g = out[i * 4 + 1], b = out[i * 4 + 2], d = Math.hypot(r - REFINE_KEY[0], g - REFINE_KEY[1], b - REFINE_KEY[2]);
    out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((d - 90) * 255 / 90)));
    if (out[i * 4 + 3] < 255 && g > Math.max(r, b)) out[i * 4 + 1] = Math.max(r, b);
    // (The original's valid pixels are its own: never the model's redrawing of them.)
    if (own[i * 4 + 3] >= 250) { out[i * 4] = own[i * 4]; out[i * 4 + 1] = own[i * 4 + 1]; out[i * 4 + 2] = own[i * 4 + 2]; out[i * 4 + 3] = own[i * 4 + 3]; }
  }
  return refineCutout(await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
}
