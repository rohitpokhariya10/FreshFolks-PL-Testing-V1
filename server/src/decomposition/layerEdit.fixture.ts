/**
 * TEST FIXTURE: drawn product cut-outs (no real brand) and a fake image model that edits the image it was sent, as a real
 * edit would, for the AI layer-edit identity tests. A fake shows what FrameFlow sends, keeps and checks; it says nothing
 * about how faithfully a real model edits.
 */
import sharp from 'sharp';
import type { RatioRegenerator } from './protectedTemplates/product/ratioRegeneration.js';

export type EditRequest = Parameters<RatioRegenerator['regenerate']>[0];
const svg = (w: number, h: number, body: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)).png().toBuffer();

/** A dark graphite four-door refrigerator: an asymmetric 40/60 split, a dispenser with a control strip on the left door. */
export const fridgeSvg = (finish = '#3f4246', split = 80, extra = '') => `
  <rect x="0" y="0" width="200" height="380" rx="6" fill="${finish}"/>
  <rect x="0" y="0" width="200" height="380" rx="6" fill="url(#g)"/>
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0.25"/><stop offset="1" stop-color="#fff" stop-opacity="0.18"/></linearGradient></defs>
  <rect x="${split - 1}" y="0" width="3" height="380" fill="#1a1b1d"/><rect x="0" y="198" width="200" height="4" fill="#1a1b1d"/>
  <rect x="14" y="70" width="${split - 30}" height="14" fill="#0b0c0e"/><rect x="18" y="74" width="${split - 38}" height="6" fill="#5fb4ff"/>
  <rect x="16" y="92" width="${split - 34}" height="62" rx="4" fill="#141518"/><rect x="${split / 2 - 6}" y="104" width="12" height="34" rx="3" fill="#2b2d31"/>
  <rect x="${split - 12}" y="40" width="5" height="120" rx="2" fill="#8a8d92"/><rect x="${split + 8}" y="40" width="5" height="120" rx="2" fill="#8a8d92"/>
  <rect x="${split - 12}" y="220" width="5" height="70" rx="2" fill="#8a8d92"/><rect x="${split + 8}" y="220" width="5" height="70" rx="2" fill="#8a8d92"/>${extra}`;
export const fridge = (finish?: string, split?: number) => svg(200, 380, fridgeSvg(finish, split));
/** A white front-loading washing machine: round door with a chrome ring at the centre, dial on the right of the top panel. */
export const washerSvg = (body = '#e8e9eb', door: 'round' | 'square' = 'round', dialX = 150) => `
  <rect x="0" y="0" width="200" height="240" rx="10" fill="${body}"/><rect x="0" y="0" width="200" height="46" rx="10" fill="#d4d6d9"/>
  <circle cx="${dialX}" cy="23" r="13" fill="#9ea2a8"/><rect x="18" y="14" width="${dialX - 60}" height="16" rx="3" fill="#2f3237"/>
  ${door === 'round' ? '<circle cx="100" cy="140" r="64" fill="#b8bcc2"/><circle cx="100" cy="140" r="50" fill="#3a4250"/><circle cx="84" cy="124" r="14" fill="#6b7686"/>'
    : '<rect x="36" y="76" width="128" height="128" rx="18" fill="#b8bcc2"/><rect x="48" y="88" width="104" height="104" rx="12" fill="#3a4250"/>'}`;
export const washer = (body?: string, door?: 'round' | 'square', dialX?: number) => svg(200, 240, washerSvg(body, door, dialX));
/** A product inside a large transparent canvas, as decomposition layers are stored (the object is not at the centre). */
export const onCanvas = async (object: Buffer, canvas = { width: 1254, height: 1254 }, at = { left: 534, top: 503 }) =>
  sharp({ create: { ...canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: object, ...at }]).png().toBuffer();

// --- the fake model: it edits the image it receives ------------------------------------------------------------------
export const groundOf = (prompt: string) => prompt.match(/completely flat (#[0-9a-f]{6}) background/)?.[1] ?? '#00ff00';
const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(v => parseInt(v, 16));
async function raw(png: Buffer) { const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; }
const isGround = (d: Buffer, i: number, g: number[]) => Math.max(Math.abs(d[i] - g[0]), Math.abs(d[i + 1] - g[1]), Math.abs(d[i + 2] - g[2])) < 40;
const encode = (d: Buffer, w: number, h: number) => sharp(d, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
function boxOf(d: Buffer, w: number, h: number, g: number[]) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!isGround(d, (y * w + x) * 3, g)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
/** The request's own image returned unchanged: a perfectly faithful edit. */
export const unchanged = (r: EditRequest) => r.image;
/** Every object pixel recoloured to `to`'s hue, keeping its lightness pattern: a faithful colour change. */
export async function recoloured(r: EditRequest, to: string) {
  const g = rgb(groundOf(r.prompt)), t = rgb(to), { data, w, h } = await raw(r.image);
  for (let i = 0; i < w * h * 3; i += 3) if (!isGround(data, i, g)) {
    const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 128;
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round(t[c] * l));
  }
  return encode(data, w, h);
}
/**
 * Doors opened: the closed front becomes a light interior with shelves, and each half of the front swings out beside the
 * body, keeping its own pixels (a faithful open). `drift`: the doors are repainted light silver and the seam between
 * upper and lower compartments is painted in the background colour, as in the recorded refrigerator edit.
 */
export async function opened(r: EditRequest, drift = false) {
  const ground = groundOf(r.prompt), g = rgb(ground), src = await raw(r.image), b = boxOf(src.data, src.w, src.h, g);
  const out = Buffer.from(src.data), half = Math.floor(b.width / 2);
  for (let y = b.top; y < b.top + b.height; y++) for (let x = b.left; x < b.left + b.width; x++) {
    const i = (y * src.w + x) * 3, shelf = (y - b.top) % Math.max(8, Math.round(b.height / 6)) < 3;
    if (isGround(src.data, i, g)) continue;
    const v = shelf ? 200 : 236; out[i] = v; out[i + 1] = v; out[i + 2] = Math.min(255, v + 6);
  }
  for (let y = b.top; y < b.top + b.height; y++) for (let k = 0; k < half; k++) {
    const left = (y * src.w + b.left + k) * 3, right = (y * src.w + b.left + b.width - 1 - k) * 3;
    const lx = b.left - half + k, rx = b.left + b.width - 1 + half - k;
    for (const [from, x] of [[left, lx], [right, rx]] as const) {
      if (x < 0 || x >= src.w || isGround(src.data, from, g)) continue;
      const o = (y * src.w + x) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = drift ? 190 : src.data[from + c];
    }
  }
  if (drift) for (let y = b.top + Math.round(b.height * 0.52); y < b.top + Math.round(b.height * 0.52) + 4; y++) for (let x = b.left; x < b.left + b.width; x++) out.set(g, (y * src.w + x) * 3);
  return encode(out, src.w, src.h);
}
/** Another product drawn where the object was, at the same size (identity drift). */
export async function replacedWith(r: EditRequest, productSvg: string, size: { width: number; height: number }) {
  const g = groundOf(r.prompt), src = await raw(r.image), b = boxOf(src.data, src.w, src.h, rgb(g));
  const object = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">${productSvg}</svg>`)).resize(b.width, b.height, { fit: 'fill' }).png().toBuffer();
  return sharp({ create: { width: src.w, height: src.h, channels: 3, background: g } }).composite([{ input: object, left: b.left, top: b.top }]).png().toBuffer();
}
/** A local change painted inside `box` (canvas pixels), while the model also brightened everything outside it. */
export async function paintedWithOutsideDrift(r: EditRequest, box: { left: number; top: number; width: number; height: number }, colour: string) {
  const g = rgb(groundOf(r.prompt)), c = rgb(colour), { data, w, h } = await raw(r.image);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height) { if (!isGround(data, i, g)) data.set(c, i); }
    else if (!isGround(data, i, g)) for (let k = 0; k < 3; k++) data[i + k] = Math.min(255, data[i + k] + 70);
  }
  return encode(data, w, h);
}
/** The object with a one-pixel outline blended into the background colour (the fringe a keyed cut-out can leave). */
export async function fringed(r: EditRequest) {
  const g = rgb(groundOf(r.prompt)), { data, w, h } = await raw(r.image), out = Buffer.from(data);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 3; if (isGround(data, i, g)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isGround(data, ((y + dy) * w + x + dx) * 3, g))) for (let k = 0; k < 3; k++) out[i + k] = Math.round((data[i + k] + g[k]) / 2);
  }
  return encode(out, w, h);
}
/**
 * Doors closed again, as a faithful model would draw it: the product from image 2 (the original, attached to a chained edit)
 * or `productSvg`, at image 1's body height and centre (closing does not change the height).
 */
export async function closedLike(r: EditRequest, product?: { svg: string; width: number; height: number }) {
  const ground = groundOf(r.prompt), g = rgb(ground), cur = await raw(r.image), b = boxOf(cur.data, cur.w, cur.h, g);
  let object: Buffer;
  if (product) object = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${product.width}" height="${product.height}">${product.svg}</svg>`)).png().toBuffer();
  else {
    const ref = await raw(r.references![0]), rb = boxOf(ref.data, ref.w, ref.h, g);
    object = await sharp(r.references![0]).extract(rb).png().toBuffer();
  }
  const m = await sharp(object).metadata(), height = b.height, width = Math.round((m.width ?? 1) * height / (m.height ?? 1));
  const scaled = await sharp(object).resize(width, height, { fit: 'fill' }).png().toBuffer();
  return sharp({ create: { width: cur.w, height: cur.h, channels: 3, background: ground } })
    .composite([{ input: scaled, left: Math.round(b.left + b.width / 2 - width / 2), top: b.top }]).png().toBuffer();
}
/** The fully transparent area of an edit mask, in canvas pixels. */
export async function maskArea(mask: Buffer) {
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1, open = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] === 0) { open++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, open, size: { width: info.width, height: info.height } };
}
