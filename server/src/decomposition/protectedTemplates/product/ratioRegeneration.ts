/**
 * A creative regenerated in another aspect ratio by the image model (both workflows: the first-time master and Create
 * Offer Creative). The whole picture goes to one OpenAI image edit with the instruction to recompose it for the new
 * shape, keeping every element, word, logo and QR code. The model redesigns the composition well, but it redraws what it
 * keeps: a QR code comes back as a lookalike that no phone can scan, a product as an imitation of itself. So before the
 * person sees the result, on this computer (protectRegenerated):
 *
 *   qr      every QR code of the picture sent is decoded; the result must decode to the same payload. Where it does not,
 *           the original QR code's own pixels are found in the result by matching and put back over the redrawn one,
 *           and it is decoded again. A QR code still not decoding to its payload blocks the result.
 *   assets  exact pictures the caller names (the person's product photos, the template's logos) are found in the result
 *           the same way and put back with their own pixels, so their identity is never the model's. One not found
 *           blocks the result.
 *   text    the words read in the original that the result lacks are listed for the person to check.
 *
 * The person then looks at the result and approves it; nothing is used before that. One request, never retried.
 *
 * A first-time master knows no logo before its elements are found, so its logos are restored after the detection of the
 * approved result (restoreLogosFromOriginal): each logo found in the regenerated creative is found again in the upload and
 * its layer cut from the upload's own pixels, at the regenerated creative's coordinates.
 */
import sharp from 'sharp';
import jsqrModule, { type Options as QrOptions, type QRCode } from 'jsqr';
import { toFile } from 'openai';
import { RATIO_REGEN_SIZES, type OfferAspectRatio, type RegenerationChecks, type SourceSize } from '@frameflow/shared';
import { createOpenAIClient } from '../../../services/openAIClient.js';
import type { WordRecognizer } from '../../../textRecognition/recognizer.js';
import { imageModel } from '../../aiModels.js';

type Box = { x: number; y: number; width: number; height: number };
// (jsqr is CommonJS: under Node's ESM its default import is the function itself, which its typings call the module.)
const jsQR = ((jsqrModule as unknown as { default?: unknown }).default ?? jsqrModule) as (data: Uint8ClampedArray, width: number, height: number, options?: QrOptions) => QRCode | null;
type Save = (file: string, value: object) => void;

const SHAPE: Record<OfferAspectRatio, string> = { '1:1': 'square 1:1', '4:5': 'portrait 4:5', '9:16': 'tall vertical 9:16', '16:9': 'wide landscape 16:9' };
/**
 * The instruction: a faithful adaptation of this creative to the shape — the same design, only what the new shape needs
 * changed — and nothing that is not in it (the exact words when they are known). It names no kind of element the
 * creative may not have: an instruction to "keep partner logos in rows" invites a creative without any to get some.
 * `products`: the products it shows (Create Offer Creative: the person's), named so they are kept as they are.
 */
export function regenerationPrompt(ratio: OfferAspectRatio, texts: string[] = [], products: string[] = []) {
  const quoted = texts.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40).map(t => `"${t.replace(/"/g, '\'')}"`);
  const named = [...new Set(products.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 12);
  return [
    `Convert this exact advertising creative to a ${SHAPE[ratio]} canvas, keeping the same design.`,
    'This is an aspect-ratio adaptation, not a redesign: keep the original composition, visual identity, colours, illustration style, typography, characters, products and every element as they are. Extend the existing background naturally to the new edges and move or resize the existing elements only as much as the new shape requires, so the whole canvas is filled. Do not stretch, squash, crop, letterbox or add borders.',
    'Use only what is in this image. Do not add any text, offer, price, date, logo, brand name, QR code, product, person, character, decoration or prop that is not in it, and do not remove any element.',
    named.length ? `Keep the products (${named.join(', ')}) exactly as they are, at the same size relative to the other elements.` : 'Keep the products exactly as they are, at the same size relative to the other elements.',
    'Keep every logo unchanged, whole and legible, never cropped, including any small words printed beside it.',
    quoted.length ? `Keep every piece of text with exactly the same words, spelling, numbers and symbols — exactly these texts: ${quoted.join('; ')}.` : 'Keep every piece of text with exactly the same words, spelling, numbers and symbols.',
    'Do not add, remove, translate or rewrite any text. Do not add any new products, logos, people or QR codes.',
  ].join(' ');
}

export interface RatioRegenerator {
  model: string; offline: boolean;
  /** One image edit of `image` into `size` (the ratio's own size). Never retried here. */
  regenerate(request: { image: Buffer; prompt: string; size: SourceSize }, save: Save, operationId: string): Promise<{ image: Buffer; requestId?: string; costUsd?: number; usage?: object }>;
}
/** The live regenerator: OpenAI images.edit (the configured image model, high quality). Sent only after the person approved its cost. */
export function liveRatioRegenerator(): RatioRegenerator {
  const model = imageModel();
  return { model, offline: false, async regenerate({ image, prompt, size }, save, operationId) {
    const request = { model, prompt, size: `${size.width}x${size.height}`, quality: 'high', n: 1, output_format: 'png' } as const;
    save('ratio-regeneration.openai-request.json', { method: 'images.edit', ...request, image: '<the creative, as sent>', clientRequestId: operationId, maxRetries: 0 });
    try {
      const response = await createOpenAIClient(process.env.OPENAI_API_KEY, 300_000).images.edit({ ...request, image: await toFile(image, 'creative.png', { type: 'image/png' }) } as never, { maxRetries: 0, timeout: 300_000, headers: { 'X-Client-Request-Id': operationId } }) as unknown as
        { data?: { b64_json?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } }; _request_id?: string | null };
      const u = response.usage, requestId = response._request_id ?? undefined;
      save('ratio-regeneration.openai-response.json', { usage: u, images: response.data?.length ?? 0, requestId, clientRequestId: operationId });
      const b64 = response.data?.[0]?.b64_json;
      if (!b64) throw new Error('OpenAI returned no image.');
      // The cost from the response's own usage (gpt-image-2's per-token prices: text in $5, image in $8, image out $30 per million).
      const costUsd = u ? Math.round(((u.input_tokens_details?.text_tokens ?? 0) * 5 + (u.input_tokens_details?.image_tokens ?? 0) * 8 + (u.output_tokens ?? 0) * 30) / 1e6 * 1000) / 1000 : undefined;
      return { image: Buffer.from(b64, 'base64'), ...(requestId ? { requestId } : {}), ...(costUsd !== undefined ? { costUsd } : {}), ...(u ? { usage: u } : {}) };
    } catch (error) { save('ratio-regeneration.openai-error.json', { message: error instanceof Error ? error.message : String(error) }); throw error; }
  } };
}
/** The result at exactly the ratio's size (the model is asked for it; anything else is fitted, never stretched past 2 %). */
export async function atRatioSize(png: Buffer, ratio: OfferAspectRatio): Promise<Buffer> {
  const size = RATIO_REGEN_SIZES[ratio], meta = await sharp(png).metadata();
  const fill = Math.abs((meta.width ?? 1) / (meta.height ?? 1) - size.width / size.height) / (size.width / size.height) < 0.02;
  return sharp(png).resize(size.width, size.height, { fit: fill ? 'fill' : 'cover' }).removeAlpha().png().toBuffer();
}

// --- QR codes ------------------------------------------------------------------------------------------------------------
/** Every QR code of a picture (up to four): its payload and its box (the symbol and its quiet zone), in the picture's pixels. */
export async function findQrCodes(png: Buffer): Promise<{ data: string; box: Box }[]> {
  const meta = await sharp(png).metadata(), W = meta.width ?? 1, H = meta.height ?? 1, k = Math.min(1, 1600 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const data = new Uint8ClampedArray(await sharp(png).flatten({ background: '#ffffff' }).resize(w, h).ensureAlpha().raw().toBuffer()), out: { data: string; box: Box }[] = [];
  for (let n = 0; n < 4; n++) {
    const code = jsQR(data, w, h, { inversionAttempts: 'attemptBoth' });
    if (!code) break;
    const xs = [code.location.topLeftCorner.x, code.location.topRightCorner.x, code.location.bottomLeftCorner.x, code.location.bottomRightCorner.x], ys = [code.location.topLeftCorner.y, code.location.topRightCorner.y, code.location.bottomLeftCorner.y, code.location.bottomRightCorner.y];
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys), pad = (x1 - x0) * 0.08;
    const box = { x: Math.max(0, Math.floor((x0 - pad) / k)), y: Math.max(0, Math.floor((y0 - pad) / k)), width: 0, height: 0 };
    box.width = Math.min(W, Math.ceil((x1 + pad) / k)) - box.x; box.height = Math.min(H, Math.ceil((y1 + pad) / k)) - box.y;
    if (out.some(q => q.data === code.data && Math.abs(q.box.x - box.x) < box.width / 2)) break;
    out.push({ data: code.data, box });
    // Covered, to look for another one.
    for (let y = Math.max(0, Math.floor(y0 - pad)); y < Math.min(h, Math.ceil(y1 + pad)); y++) for (let x = Math.max(0, Math.floor(x0 - pad)); x < Math.min(w, Math.ceil(x1 + pad)); x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; }
  }
  return out;
}
/** The payloads decoded in one area of a picture (a little larger than the box), at a few sizes. */
async function decodeAt(png: Buffer, box: Box): Promise<string | undefined> {
  const meta = await sharp(png).metadata(), m = box.width * 0.25, x = Math.max(0, Math.floor(box.x - m)), y = Math.max(0, Math.floor(box.y - m));
  const region = { left: x, top: y, width: Math.min((meta.width ?? 1) - x, Math.ceil(box.width + 2 * m)), height: Math.min((meta.height ?? 1) - y, Math.ceil(box.height + 2 * m)) };
  for (const side of [400, 700, 1000]) {
    const { data, info } = await sharp(png).extract(region).flatten({ background: '#ffffff' }).resize(side, side, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'attemptBoth' });
    if (code) return code.data;
  }
  return undefined;
}

// --- Finding an exact picture in the result (normalised cross-correlation, coarse to fine, over scales) -----------------
interface Gray { w: number; h: number; v: Float32Array; a?: Uint8Array }
async function grayOf(png: Buffer, w: number, h: number, alpha = false): Promise<Gray> {
  const { data } = await sharp(png).resize(Math.max(1, w), Math.max(1, h), { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), n = Math.max(1, w) * Math.max(1, h), v = new Float32Array(n), a = alpha ? new Uint8Array(n) : undefined;
  for (let i = 0; i < n; i++) { v[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114; if (a) a[i] = data[i * 4 + 3] >= 128 ? 1 : 0; }
  return { w: Math.max(1, w), h: Math.max(1, h), v, ...(a ? { a } : {}) };
}
/** The template's best normalised correlation with the target, over positions (in `area`, stepping `step`): its top-left and score. */
function bestAt(t: Gray, p: Gray, area: { x0: number; y0: number; x1: number; y1: number }, step = 1) {
  const idx: number[] = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (!p.a || p.a[y * p.w + x]) idx.push(y * p.w + x);
  if (idx.length < 16) return { x: 0, y: 0, score: -1 };
  let mean = 0; for (const i of idx) mean += p.v[i]; mean /= idx.length;
  let varP = 0; const dp = new Float32Array(idx.length); idx.forEach((i, k) => { dp[k] = p.v[i] - mean; varP += dp[k] * dp[k]; });
  if (varP < 1) return { x: 0, y: 0, score: -1 };
  const ox = idx.map(i => i % p.w), oy = idx.map(i => Math.floor(i / p.w));
  let best = { x: 0, y: 0, score: -1 };
  for (let y = Math.max(0, area.y0); y <= Math.min(t.h - p.h, area.y1); y += step) for (let x = Math.max(0, area.x0); x <= Math.min(t.w - p.w, area.x1); x += step) {
    let s = 0, s2 = 0, cross = 0;
    for (let k = 0; k < idx.length; k++) { const v = t.v[(y + oy[k]) * t.w + x + ox[k]]; s += v; s2 += v * v; cross += v * dp[k]; }
    const varT = s2 - s * s / idx.length;
    if (varT < 1) continue;
    const score = cross / Math.sqrt(varT * varP);
    if (score > best.score) best = { x, y, score };
  }
  return best;
}
/**
 * Where an exact picture (`png`, its alpha respected) stands in `target`, at any size from `least` (about half) to `most`
 * times `expected` (its expected width there): its box in the target's pixels and the match's score (−1…1).
 */
export async function locate(target: Buffer, png: Buffer, expected: number, most = 2.2, least = 0.45): Promise<{ box: Box; score: number } | undefined> {
  const tm = await sharp(target).metadata(), pm = await sharp(png).metadata(), TW = tm.width ?? 1, TH = tm.height ?? 1, aspect = (pm.width ?? 1) / (pm.height ?? 1);
  // Each level sized from the picture's expected size, not the canvas: about 28 px across it coarsely, 110 px finely.
  const longest = Math.max(1, expected, expected / aspect);
  const kc = Math.min(1, 28 / longest, 480 / Math.max(TW, TH)), coarse = await grayOf(target, Math.round(TW * kc), Math.round(TH * kc));
  let best: { s: number; x: number; y: number; score: number } | undefined;
  for (let s = expected * least; s <= expected * most; s *= 1.09) {
    const w = Math.round(s * kc), h = Math.round(s * kc / aspect);
    if (w < 6 || h < 6 || w >= coarse.w || h >= coarse.h) continue;
    const r = bestAt(coarse, await grayOf(png, w, h, true), { x0: 0, y0: 0, x1: coarse.w, y1: coarse.h });
    if (!best || r.score > best.score) best = { s, ...r };
  }
  if (!best || best.score < 0.2) return undefined;
  const kf = Math.max(kc, Math.min(1, 110 / longest)), fine = kf === kc ? coarse : await grayOf(target, Math.round(TW * kf), Math.round(TH * kf)), reach = Math.ceil(2.5 * kf / kc);
  let top = { s: best.s, x: best.x / kc * kf, y: best.y / kc * kf, score: -1 };
  for (let s = best.s * 0.91; s <= best.s * 1.091; s *= 1.025) {
    const w = Math.round(s * kf), h = Math.round(s * kf / aspect);
    if (w < 6 || h < 6 || w >= fine.w || h >= fine.h) continue;
    const cx = best.x / kc * kf, cy = best.y / kc * kf;
    const r = bestAt(fine, await grayOf(png, w, h, true), { x0: Math.floor(cx - reach), y0: Math.floor(cy - reach), x1: Math.ceil(cx + reach), y1: Math.ceil(cy + reach) });
    if (r.score > top.score) top = { s, ...r };
  }
  return { box: { x: Math.round(top.x / kf), y: Math.round(top.y / kf), width: Math.round(top.s), height: Math.round(top.s / aspect) }, score: Math.round(top.score * 1000) / 1000 };
}
/** How far a picture's colours are from the target's under it, in `box`: the mean difference per channel (0–255) over its opaque pixels. */
async function colourDistance(target: Buffer, png: Buffer, box: Box): Promise<number> {
  const meta = await sharp(target).metadata(), x = Math.max(0, box.x), y = Math.max(0, box.y), w = Math.min((meta.width ?? 1) - x, box.width - (x - box.x)), h = Math.min((meta.height ?? 1) - y, box.height - (y - box.y));
  if (w < 4 || h < 4) return 255;
  const side = 64, k = Math.min(1, side / Math.max(w, h)), sw = Math.max(2, Math.round(w * k)), sh = Math.max(2, Math.round(h * k));
  const t = await sharp(target).extract({ left: x, top: y, width: w, height: h }).resize(sw, sh, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  // (One resize per pipeline: sharp keeps only the last one.)
  const sized = await sharp(png).resize(Math.max(1, box.width), Math.max(1, box.height), { fit: 'fill' }).ensureAlpha().png().toBuffer();
  const full = await sharp(await sharp(sized).extract({ left: x - box.x, top: y - box.y, width: w, height: h }).png().toBuffer()).resize(sw, sh, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  let sum = 0, n = 0;
  for (let i = 0; i < sw * sh; i++) if (full[i * 4 + 3] >= 160) { sum += Math.abs(full[i * 4] - t[i * 3]) + Math.abs(full[i * 4 + 1] - t[i * 3 + 1]) + Math.abs(full[i * 4 + 2] - t[i * 3 + 2]); n += 3; }
  return n ? sum / n : 255;
}
/** `png` drawn over `target` in `box` (its own pixels; a rectangular crop with a 2 px soft rim, a cut-out by its alpha). */
async function putBack(target: Buffer, png: Buffer, box: Box, rim: boolean): Promise<Buffer> {
  const w = Math.max(1, box.width), h = Math.max(1, box.height);
  let piece = await sharp(png).resize(w, h, { fit: 'fill' }).ensureAlpha().png().toBuffer();
  if (rim) piece = await sharp(piece).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><filter id="f"><feGaussianBlur stdDeviation="1.2"/></filter></defs><rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="#fff" filter="url(#f)"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
  const meta = await sharp(target).metadata(), x0 = Math.max(0, -box.x), y0 = Math.max(0, -box.y), cw = Math.min(w - x0, (meta.width ?? 1) - Math.max(0, box.x)), ch = Math.min(h - y0, (meta.height ?? 1) - Math.max(0, box.y));
  if (cw <= 0 || ch <= 0) return target;
  if (x0 || y0 || cw < w || ch < h) piece = await sharp(piece).extract({ left: x0, top: y0, width: cw, height: ch }).png().toBuffer();
  return sharp(target).composite([{ input: piece, left: Math.max(0, box.x), top: Math.max(0, box.y) }]).png().toBuffer();
}

/** Whether two words differ by at most one letter (one replaced, added or left out). */
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// --- A first-time master's logos, after its elements are found in the approved result -------------------------------------
/** How far two same-sized crops' backdrops are apart: the mean difference per channel (0–255) over their outer 2-pixel ring. */
async function ringDifference(a: Buffer, b: Buffer): Promise<number> {
  const [p, q] = await Promise.all([a, b].map(x => sharp(x).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const { width: w, height: h } = p.info;
  let sum = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= 2 && y >= 2 && x < w - 2 && y < h - 2) continue;
    const i = (y * w + x) * 3;
    for (let c = 0; c < 3; c++) { sum += Math.abs(p.data[i + c] - q.data[i + c]); n++; }
  }
  return n ? sum / n : 255;
}
/**
 * Each logo found in the regenerated creative (`logos`: its crop there, as the model drew it) found again in the original
 * upload — at half to twice the size the two pictures' scales give it, a strong match (a part of a logo, or a logo a few
 * pixels off, scores lower), its colours agreeing — and returned as the upload's own pixels, sized to the crop: the logo
 * layer shows the brand's artwork, not the model's redrawing (the live 16:9 Ganesh master, 2026-10-29: the model drew
 * "AU SMALL FINANCE BANK" illegibly). Only where the logo's backdrop is the same in both (its crop's outer ring): the LG
 * logo on the upload's white, moved onto the 9:16 creative's mint, would bring a white plate. Any other logo keeps its
 * crop and is reported.
 */
export async function restoreLogosFromOriginal(input: { original: Buffer; regenerated: { width: number; height: number }; logos: { id: string; png: Buffer }[] }): Promise<{ id: string; png?: Buffer; score: number; status: 'restored' | 'not-found' }[]> {
  const om = await sharp(input.original).metadata(), k = Math.sqrt(((om.width ?? 1) * (om.height ?? 1)) / Math.max(1, input.regenerated.width * input.regenerated.height));
  const out: { id: string; png?: Buffer; score: number; status: 'restored' | 'not-found' }[] = [];
  for (const l of input.logos) {
    const m = await sharp(l.png).metadata(), w = m.width ?? 1, h = m.height ?? 1;
    const found = w >= 12 && h >= 8 ? await locate(input.original, l.png, w * k, 2, 0.5) : undefined;
    if (!found || found.score < 0.72 || (await colourDistance(input.original, l.png, found.box)) > 40) { out.push({ id: l.id, score: found?.score ?? -1, status: 'not-found' }); continue; }
    const b = found.box, left = Math.max(0, b.x), top = Math.max(0, b.y), width = Math.min((om.width ?? 1) - left, b.width - (left - b.x)), height = Math.min((om.height ?? 1) - top, b.height - (top - b.y));
    if (width < b.width * 0.95 || height < b.height * 0.95) { out.push({ id: l.id, score: found.score, status: 'not-found' }); continue; }
    const png = await sharp(await sharp(input.original).extract({ left, top, width, height }).png().toBuffer()).resize(w, h, { fit: 'fill' }).ensureAlpha().png({ compressionLevel: 9 }).toBuffer();
    if ((await ringDifference(png, l.png)) > 14) { out.push({ id: l.id, score: found.score, status: 'not-found' }); continue; }
    out.push({ id: l.id, png, score: found.score, status: 'restored' });
  }
  return out;
}

// --- The protection, before the person sees the result --------------------------------------------------------------------
/**
 * The result made safe to show (see the top of this file): QR codes decoding to their payloads (restored from the original
 * where they do not), the named exact pictures put back with their own pixels, the words of the original it lacks.
 * `assets`: each exact picture (its own pixels, a cut-out or a crop) and its box in the original. Blocking: what keeps
 * the result from being used (a QR code not decoding to its payload, an asset not found).
 */
export async function protectRegenerated(input: { original: Buffer; result: Buffer; assets?: { label: string; png: Buffer; box: Box; required?: boolean; minScore?: number }[]; recognizer?: WordRecognizer;
  /** The creative's own copy when it is known exactly (a template's words, logo and product names): words in it are never new. */
  knownWords?: string[] }): Promise<{ png: Buffer; checks: RegenerationChecks }> {
  let png = input.result;
  const om = await sharp(input.original).metadata(), rm = await sharp(png).metadata(), k = Math.sqrt(((rm.width ?? 1) * (rm.height ?? 1)) / ((om.width ?? 1) * (om.height ?? 1)));
  const checks: RegenerationChecks = { qr: [], assets: [], missingWords: [], blocking: [] };
  // Exact pictures first (a QR code printed on a product comes back with it). A required one (a product) not found blocks
  // the result; another (a logo) is put back only on a clear match — a doubtful one is left for the person to look at,
  // never pasted where it might not belong.
  for (const a of input.assets ?? []) {
    // (A product may come back up to three times as large: the model is asked to make the products the hero.)
    const required = a.required !== false, found = await locate(png, a.png, a.box.width * k, required ? 3 : 2.2);
    // A match by pattern alone is not enough (stripes can correlate with a panel): its colours must agree too.
    if (!found || found.score < (a.minScore ?? 0.45) || (await colourDistance(png, a.png, found.box)) > (required ? 45 : 40)) {
      checks.assets.push({ label: a.label, status: 'not-found', score: found?.score ?? -1 });
      if (required) checks.blocking.push(`${a.label} could not be found in the regenerated creative, so its own picture could not be put back.`);
      continue;
    }
    png = await putBack(png, a.png, found.box, false);
    checks.assets.push({ label: a.label, status: 'restored', score: found.score });
  }
  const codes = await findQrCodes(input.original);
  for (const q of codes) {
    const now = await findQrCodes(png);
    if (now.some(x => x.data === q.data)) { checks.qr.push({ data: q.data, status: 'kept' }); continue; }
    const crop = await sharp(input.original).extract({ left: q.box.x, top: q.box.y, width: q.box.width, height: q.box.height }).png().toBuffer();
    // Where the model's own QR code is: one that scans to something else (its own place, framed as the original's), else a
    // clear match of the original's pattern. A doubtful place is never pasted on (a QR code on a product's panel).
    const wrong = now.find(x => !codes.some(c => c.data === x.data)), found = wrong ? undefined : await locate(png, crop, q.box.width * k);
    const place = wrong?.box ?? (found && found.score >= 0.6 ? found.box : undefined);
    if (place) {
      const restored = await putBack(png, crop, place, true);
      if ((await decodeAt(restored, place)) === q.data) { png = restored; checks.qr.push({ data: q.data, status: 'restored' }); continue; }
    }
    checks.qr.push({ data: q.data, status: 'failed' });
    checks.blocking.push('A QR code of the original could not be made to scan to its own link in the regenerated creative. Do not use this result: regenerate it.');
  }
  // Finally, the result scans to exactly the original's QR codes and nothing else: a lookalike left elsewhere, or one the
  // model invented, would send a customer somewhere else.
  const extra = (await findQrCodes(png)).filter(x => !codes.some(c => c.data === x.data));
  if (extra.length) checks.blocking.push(`The regenerated creative has a QR code that is not one of the original's (it scans to something else). Do not use this result: regenerate it.`);
  // Words of the original (read on this computer, confidently) that the result lacks: for the person to check.
  if (input.recognizer) {
    const read = async (p: Buffer) => { const m = await sharp(p).metadata(); return (await input.recognizer!.recognize({ image: p, region: { x: 0, y: 0, width: m.width ?? 1, height: m.height ?? 1 }, purpose: 'template' }))
      .filter(w => w.confidence >= 0.75).map(w => w.text.normalize('NFKD').replace(/[^\p{L}\p{N}₹%]/gu, '')).filter(w => /\p{L}/u.test(w) && w.replace(/[^\p{L}\p{N}]/gu, '').length >= 3); };
    const before = await read(input.original), after = new Map<string, number>();
    for (const w of await read(png)) after.set(w.toLowerCase(), (after.get(w.toLowerCase()) ?? 0) + 1);
    const result = [...after.entries()].flatMap(([w, n]) => Array<string>(n).fill(w));
    for (const w of before) { const n = after.get(w.toLowerCase()) ?? 0; if (n > 0) after.set(w.toLowerCase(), n - 1); else if (!checks.missingWords.includes(w)) checks.missingWords.push(w); }
    checks.missingWords = checks.missingWords.slice(0, 20);
    // And the other way: words read in the result that the original does not have — copy the model may have invented.
    // (A word one letter off one of the original's, or part of one, is a misreading, not new copy.)
    const known = new Set([...before, ...(input.knownWords ?? []).flatMap(t => t.normalize('NFKD').split(/\s+/)).map(w => w.replace(/[^\p{L}\p{N}₹%]/gu, ''))].map(w => w.toLowerCase()).filter(Boolean)), near = (a: string, b: string) => a.includes(b) || b.includes(a) || oneEdit(a, b);
    checks.extraWords = [...new Set(result.filter(w => !known.has(w) && ![...known].some(k => near(w, k))))].slice(0, 20);
  }
  return { png, checks };
}
