/**
 * The identity gate for one AI layer edit: local pixel checks (free, no AI call) that tell the requested change apart from
 * an unintended change of the product. Each check runs only where it is meaningful for the edit type: opening doors
 * legitimately changes the outline and the visible colours, so those are not compared then. What could not be checked is
 * named, and the person reviews it. Automated evidence is never presented as a guarantee of the product's identity.
 *
 * Calibration (recorded refrigerator edits, see layerEditIdentity.test.ts): the same product re-scaled, blurred or tinted
 * scores ≥ 0.99 structure and ≤ 5 finish distance; a drifted re-render of it about 0.6 and 10; a different product about
 * 0.05 and 24.
 */
import sharp from 'sharp';
import type { LayerEditIdentityCheck, LayerEditIdentityStatus, LayerEditIntent } from '@frameflow/shared';

export const CHROMA_KEYS = [[0, 255, 0], [255, 0, 255], [0, 255, 255]] as const;
type Rgb = readonly [number, number, number] | readonly number[];
interface Pixels { data: Buffer; width: number; height: number }
export interface IdentityInput {
  /** The validated, transparent result at the reference's pixel scale. */
  candidate: Buffer;
  /** The image that was edited (the current layer). */
  reference: Buffer;
  /** The product as originally imported, when the layer is a traced AI edit of it. Baseline for colours that do not belong. */
  original?: Buffer;
  /** The image the result should match (the image before the edit this one reverses), with the result's size relative to it. */
  expected?: { image: Buffer; scale: { width: number; height: number } };
  intent: LayerEditIntent;
  /** The result's size relative to the reference. */
  geometry: { width: number; height: number };
  /** The chroma colour the model was asked to put around the object. */
  ground: string;
  /** For an edit limited to an area: how closely the model kept the pixels outside it (1 = unchanged) before they were restored. */
  outsideAgreement?: number;
}
export interface IdentityResult { status: LayerEditIdentityStatus; checks: LayerEditIdentityCheck[]; limitation?: string }

const hexRgb = (hex: string) => (hex.slice(1).match(/../g) ?? ['0', '0', '0']).map(v => parseInt(v, 16));
const distance = (data: Buffer | Uint8Array, i: number, key: Rgb) => Math.max(Math.abs(data[i] - key[0]), Math.abs(data[i + 1] - key[1]), Math.abs(data[i + 2] - key[2]));
const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`;
async function pixels(png: Buffer, maxSide = 1024): Promise<Pixels> {
  const m = await sharp(png).metadata(), k = Math.min(1, maxSide / Math.max(m.width ?? 1, m.height ?? 1));
  const { data, info } = await sharp(png).resize(Math.max(1, Math.round((m.width ?? 1) * k)), Math.max(1, Math.round((m.height ?? 1) * k)), { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
/** Opaque pixels away from the outline (the outline's colours are judged separately). */
function interior(p: Pixels, margin = 2) {
  const { data, width: w, height: h } = p, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] < 200) continue;
    let inside = true;
    for (let dy = -margin; dy <= margin && inside; dy++) for (let dx = -margin; dx <= margin; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h || data[(Y * w + X) * 4 + 3] < 128) { inside = false; break; }
    }
    out[y * w + x] = inside ? 1 : 0;
  }
  return out;
}
/** The share of interior pixels close to each chroma key. */
export function keyShares(p: Pixels) {
  const mask = interior(p), shares = CHROMA_KEYS.map(() => 0);
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { n++; CHROMA_KEYS.forEach((key, k) => { if (distance(p.data, i * 4, key) < 90) shares[k]++; }); }
  return { shares: shares.map(s => s / Math.max(1, n)), counts: shares, interior: n };
}
/** Outline pixels tinted by the key colour (a fringe left by the background removal). */
function fringeShare(p: Pixels, key: Rgb) {
  const { data, width: w, height: h } = p;
  let edge = 0, tinted = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (data[i + 3] < 64) continue;
    let near = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || data[(Y * w + X) * 4 + 3] < 64) { near = true; break; } }
    if (!near) continue;
    edge++;
    // Tinted: the key's own channels clearly dominate the others (green for #00ff00, red+blue for #ff00ff …).
    const hi = [0, 1, 2].filter(c => key[c] > 128), lo = [0, 1, 2].filter(c => key[c] <= 128);
    if (Math.min(...hi.map(c => data[i + c])) - Math.max(...lo.map(c => data[i + c])) > 60) tinted++;
  }
  return edge ? tinted / edge : 0;
}

// --- colour (CIELAB) ------------------------------------------------------------------------------------------------
const lin = (v: number) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
export function lab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
async function finishOf(png: Buffer) {
  const p = await pixels(png, 160), L: number[] = [];
  let a = 0, b = 0;
  for (let i = 0; i < p.width * p.height; i++) if (p.data[i * 4 + 3] >= 200) { const c = lab(p.data[i * 4], p.data[i * 4 + 1], p.data[i * 4 + 2]); L.push(c[0]); a += c[1]; b += c[2]; }
  L.sort((x, y) => x - y);
  return { L, a: a / Math.max(1, L.length), b: b / Math.max(1, L.length) };
}
/** Lightness distribution distance (mean quantile difference) plus the shift of the average colour. */
async function finishDistance(x: Buffer, y: Buffer) {
  const [p, q] = await Promise.all([finishOf(x), finishOf(y)]);
  if (!p.L.length || !q.L.length) return { distance: Infinity, lightness: 0 };
  let s = 0, abs = 0;
  for (let k = 0; k < 100; k++) { const t = (k + 0.5) / 100, d = q.L[Math.floor(t * q.L.length)] - p.L[Math.floor(t * p.L.length)]; s += d; abs += Math.abs(d); }
  return { distance: abs / 100 + Math.hypot(p.a - q.a, p.b - q.b), lightness: s / 100 };
}

// --- structure (bounding-box normalised, coarse) ---------------------------------------------------------------------
async function bounds(png: Buffer) {
  const p = await pixels(png, 2048);
  let x0 = p.width, y0 = p.height, x1 = -1, y1 = -1;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (p.data[(y * p.width + x) * 4 + 3] >= 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const m = await sharp(png).metadata(), k = (m.width ?? p.width) / p.width;
  return x1 < 0 ? undefined : { left: Math.floor(x0 * k), top: Math.floor(y0 * k), width: Math.max(1, Math.ceil((x1 - x0 + 1) * k)), height: Math.max(1, Math.ceil((y1 - y0 + 1) * k)) };
}
/** The object's share of its own image's width and height (1 for a tight cut-out; less for a full-canvas layer). */
export async function objectFraction(png: Buffer) {
  const [b, m] = await Promise.all([bounds(png), sharp(png).metadata()]);
  return b ? { width: b.width / (m.width ?? b.width), height: b.height / (m.height ?? b.height) } : { width: 1, height: 1 };
}
async function grid(png: Buffer, w: number, h: number) {
  const b = await bounds(png); if (!b) return undefined;
  const { data } = await sharp(png).extract(b).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = new Uint8Array(w * h), l = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { a[i] = data[i * 4 + 3] >= 128 ? 1 : 0; l[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114; }
  return { w, h, a, l };
}
const sobel = (g: { w: number; h: number; l: Float32Array }) => {
  const out = new Float32Array(g.w * g.h), at = (x: number, y: number) => g.l[Math.min(g.h - 1, Math.max(0, y)) * g.w + Math.min(g.w - 1, Math.max(0, x))];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    out[y * g.w + x] = Math.hypot(gx, gy);
  }
  return out;
};
function ncc(u: Float32Array, v: Float32Array, m: Uint8Array) {
  let n = 0, su = 0, sv = 0;
  for (let i = 0; i < u.length; i++) if (m[i]) { n++; su += u[i]; sv += v[i]; }
  if (n < 16) return 0;
  const mu = su / n, mv = sv / n;
  let c = 0, uu = 0, vv = 0;
  for (let i = 0; i < u.length; i++) if (m[i]) { const a = u[i] - mu, b = v[i] - mv; c += a * b; uu += a * a; vv += b * b; }
  // Two flat images agree perfectly; one flat and one structured do not.
  if (uu < 1e-3 && vv < 1e-3) return 1;
  return c / Math.sqrt(uu * vv + 1e-9);
}
const gridSize = (b: { width: number; height: number }, long: number) => b.width >= b.height
  ? [long, Math.max(6, Math.round(long * b.height / b.width))] : [Math.max(6, Math.round(long * b.width / b.height)), long];
/** Mean of lightness and edge correlation at two coarse scales: layout and major parts, not fine rendering detail. */
export async function structureSimilarity(expected: Buffer, candidate: Buffer) {
  const b = await bounds(expected); if (!b) return { score: 0, silhouette: 0 };
  const scores: number[] = [];
  let silhouette = 0;
  for (const long of [22, 45]) {
    const [w, h] = gridSize(b, long), [A, B] = await Promise.all([grid(expected, w, h), grid(candidate, w, h)]);
    if (!A || !B) return { score: 0, silhouette: 0 };
    const both = new Uint8Array(w * h);
    let inter = 0, union = 0;
    for (let i = 0; i < both.length; i++) { if (A.a[i] && B.a[i]) { both[i] = 1; inter++; } if (A.a[i] || B.a[i]) union++; }
    scores.push(ncc(A.l, B.l, both), ncc(sobel(A), sobel(B), both));
    if (long === 45) silhouette = union ? inter / union : 0;
  }
  return { score: scores.reduce((s, v) => s + v, 0) / scores.length, silhouette };
}

// --- the gate -------------------------------------------------------------------------------------------------------
const band = (value: number, pass: number, warn: number, higherIsBetter: boolean): LayerEditIdentityCheck['status'] =>
  higherIsBetter ? (value >= pass ? 'pass' : value >= warn ? 'warn' : 'fail') : (value <= pass ? 'pass' : value <= warn ? 'warn' : 'fail');
const skip = (id: LayerEditIdentityCheck['id'], label: string, detail: string): LayerEditIdentityCheck => ({ id, label, status: 'skipped', detail });

export async function assessIdentity(input: IdentityInput): Promise<IdentityResult> {
  const { intent } = input, ops = new Set(intent.operations), checks: LayerEditIdentityCheck[] = [];
  /** Checks skipped because the person asked for that change: not applicable, unlike aspects that could not be verified. */
  const requested = new Set<LayerEditIdentityCheck['id']>();
  const replace = !intent.preserveIdentity, recolour = ops.has('color') || ops.has('material');
  const structural = ops.has('state') || ops.has('add'), strict = !!input.expected;
  const candidate = await pixels(input.candidate);

  // 1. The keying colour (or an earlier edit's) painted into the object: never part of a real product.
  const [c, base] = await Promise.all([keyShares(candidate), pixels(input.original ?? input.reference).then(keyShares)]);
  const foreign = CHROMA_KEYS.map((key, k) => ({ key, extra: c.shares[k] - base.shares[k], count: c.counts[k] })).filter(x => x.count >= 20).sort((a, b) => b.extra - a.extra)[0];
  const keyHex = (k: Rgb) => `#${[...k].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  checks.push(!foreign || foreign.extra <= 0.0002
    ? { id: 'contamination', label: 'No background colour inside the object', status: 'pass', detail: 'No keying colour was found inside the product.' }
    : { id: 'contamination', label: 'Background colour inside the object', status: foreign.extra > 0.001 ? 'fail' : 'warn',
      detail: `${pct(foreign.extra)} of the object is the keying colour ${keyHex(foreign.key)}, which ${input.original ? 'the original product' : 'the reference'} does not have: the AI painted the background colour into the product (for example into a seam or gap).` });

  // 2. A fringe of the keying colour along the outline.
  const fringe = fringeShare(candidate, hexRgb(input.ground));
  // Edge quality, not identity: at most a warning.
  checks.push({ id: 'edges', label: 'Clean transparent edges', status: fringe <= 0.04 ? 'pass' : 'warn', detail: fringe <= 0.04 ? 'The outline has no visible background fringe.' : `${pct(fringe)} of the outline is tinted by the background colour ${input.ground}.` });

  // 3. Scale: the object kept its size where the edit does not move parts; at least one dimension where it does.
  if (replace) checks.push(skip('scale', 'Size and proportions', 'A replacement was requested, so its size is not compared.'));
  else {
    const g = strict ? input.expected!.scale : input.geometry, dw = Math.abs(g.width - 1), dh = Math.abs(g.height - 1);
    const describe = `${Math.round(g.width * 100)}% of the ${strict ? 'earlier' : 'reference'} width and ${Math.round(g.height * 100)}% of its height`;
    if (structural && !strict) {
      // Opening doors widens; closing narrows; raising an arm can add height and width. The dimension closest to unchanged
      // must stay near it: a product redrawn much smaller, or much larger, in every direction is not a moved part.
      const kept = dw <= dh ? g.width : g.height;
      const status = kept >= 0.85 && kept <= 1.35 ? 'pass' : kept >= 0.7 && kept <= 1.8 ? 'warn' : 'fail';
      checks.push({ id: 'scale', label: 'Size of the unchanged body', status, detail: status === 'pass' ? `The body keeps its size in at least one direction (${describe}); the other may change with the moved parts.` : `The product was redrawn ${kept < 1 ? 'smaller' : 'larger'} in every direction (${describe}).` });
    } else {
      const most = Math.max(dw, dh);
      checks.push({ id: 'scale', label: 'Size and proportions', status: band(most, 0.06, strict ? 0.12 : 0.15, false), detail: most <= 0.06 ? `The size is kept (${describe}).` : `The object was redrawn at ${describe}.` });
    }
  }

  // 4–6. Finish, structure and silhouette, against the image the result should resemble.
  const comparator = strict ? input.expected!.image : input.reference;
  const versus = strict ? 'the image before the edit this one reverses' : 'the reference';
  if (replace) for (const [id, label] of [['finish', 'Colours and finish'], ['structure', 'Layout and parts'], ['silhouette', 'Outline']] as const) checks.push(skip(id, label, 'A replacement was requested, so the product is not compared.'));
  else if (structural && !strict) {
    checks.push(skip('finish', 'Colours and finish', 'Moving parts reveals or hides surfaces (such as an interior), so the colours cannot be compared automatically. Compare the outside finish with Before.'));
    checks.push(skip('structure', 'Layout and parts', 'Moving parts changes the visible layout, so it cannot be compared automatically. Compare panels, handles, displays and branding with Before.'));
    checks.push(skip('silhouette', 'Outline', 'The outline is expected to change with the moved parts.'));
  } else {
    if (recolour && !strict) { requested.add('finish'); checks.push(skip('finish', 'Colours and finish', 'A colour or material change was requested, so colours are not compared.')); }
    else {
      const d = await finishDistance(comparator, input.candidate);
      checks.push({ id: 'finish', label: 'Colours and finish', status: band(d.distance, 6, 12, false),
        detail: d.distance <= 6 ? `The colours match ${versus}.` : `The colours differ from ${versus} (distance ${d.distance.toFixed(1)}; the result is ${d.lightness > 0 ? 'lighter' : 'darker'} by about ${Math.abs(d.lightness).toFixed(0)} lightness units).` });
    }
    const s = await structureSimilarity(comparator, input.candidate);
    checks.push({ id: 'structure', label: 'Layout and parts', status: band(s.score, 0.75, 0.55, true),
      detail: s.score >= 0.75 ? `The layout of panels and parts matches ${versus} (similarity ${s.score.toFixed(2)}).` : `The layout of panels and parts differs from ${versus} (similarity ${s.score.toFixed(2)}; the same product scores about 1.0, a different product about 0).` });
    const removal = ops.has('remove');
    checks.push({ id: 'silhouette', label: 'Outline', status: band(s.silhouette, removal ? 0.85 : 0.9, removal ? 0.7 : 0.8, true),
      detail: `The outline overlaps ${versus} by ${pct(s.silhouette)} after aligning their size.` });
  }
  // The pixels outside the area are restored exactly, so at most a seam remains to check: a warning, not product drift.
  if (input.outsideAgreement !== undefined) checks.push({ id: 'outside-region', label: 'Outside the selected area', status: input.outsideAgreement >= 0.9 ? 'pass' : 'warn',
    detail: input.outsideAgreement >= 0.9 ? 'Everything outside the selected area is the original image.' : `The AI also redrew outside the selected area; those pixels were restored from the original, so check the selection border for a seam (agreement ${input.outsideAgreement.toFixed(2)}).` });

  // Any failure, or two independent warnings about the product itself, means the product appears altered.
  const identity = checks.filter(c => ['scale', 'finish', 'structure', 'silhouette'].includes(c.id));
  const failed = checks.some(c => c.status === 'fail') || identity.filter(c => c.status === 'warn').length >= 2;
  const skipped = identity.filter(c => c.status === 'skipped' && !requested.has(c.id));
  const status: LayerEditIdentityStatus = failed ? 'drift-suspected' : skipped.length || checks.some(c => c.status === 'warn') ? 'review-required' : 'consistent';
  const limitation = replace ? 'A replacement was requested, so the product identity is not compared.'
    : skipped.length ? `Not checked automatically: ${skipped.map(c => c.label.toLowerCase()).join(', ')}. Compare them with Before.` : undefined;
  return { status, checks, ...(limitation ? { limitation } : {}) };
}
