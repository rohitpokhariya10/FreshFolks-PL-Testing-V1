/**
 * The decomposition's own layers as evidence (with the `cutoutVerification` option; off, nothing here runs).
 *
 * Seedream returns each element whole — a refrigerator with the part behind the dishwasher drawn, the deity's arms with
 * their sleeves behind the arch — and a background with the elements taken out (the arch, the medallion, the frames and
 * the borders kept). Prepare used to keep only each layer's outline and fill it with the picture's pixels: wherever
 * something stood in front of the element, its layer took that thing's pixels (the medallion over a refrigerator's
 * corner, the arch over the sleeves, the border across a dancer's hem), and what a product in front hid was continued
 * from the element's own edge (a grey smear).
 *
 * Here every pixel of each element's layer is explained by the layers themselves, each registered to the picture (a
 * shift and a scale, found where its pixels match the picture best):
 *
 *   visible         the picture matches the element's layer best: source interior pixels kept exactly; mixed boundaries
 *                   retain the registered provider RGBA (evidenceCutout);
 *   behind a layer  the picture matches a decomposed element FrameFlow draws in front of it: completed from the element's
 *                   own layer (the decomposition's drawing, its colours matched to the picture just around);
 *   behind art      the picture matches the background — artwork that was not decomposed stands in front of it: completed
 *                   the same way, with a partial stacking overlay (`art`). This does not separate the whole decoration;
 *   outline         a thin band along its outline that the picture shows as background or as another element (the
 *                   layers' outlines are off by a pixel or two): the registered alpha is retained;
 *   conflict        a decomposed element FrameFlow draws behind it shows there: left out, reported.
 *
 * Colour decides nothing alone: each pixel goes to the layer that reproduces the picture there, among the layers that
 * cover it. A layer that does not line up with the picture is not used (`usable` false): that element keeps its cut-out
 * as made before, and the reason is reported. Nothing is sent anywhere; nothing is charged.
 */
import type { ProductObjectKind } from '@frameflow/shared';
import { unmix } from '../master/artworkRebuild.js';

type Box = { x: number; y: number; width: number; height: number };
export interface EvidenceLayer {
  id: string; kind: ProductObjectKind; label: string;
  /** FrameFlow's order, back to front (ProductObject.z). */
  z: number;
  /** The decomposition's layer for it: RGBA on the sent picture's canvas (`sent`). */
  rgba: Uint8Array;
}
export interface EvidenceInput {
  /** The picture that was decomposed (without text and logos), RGB, w × h. */
  picture: Uint8Array; w: number; h: number;
  /** The decomposition's background (everything not decomposed, the elements taken out), RGB, w × h. */
  background: Uint8Array;
  sent: { width: number; height: number };
  layers: EvidenceLayer[];
  /** The elements left in the background (decorations, frames, podiums): what names artwork in front of an element. */
  scenery: { label: string; box: Box }[];
}
export interface LayerEvidence {
  id: string;
  /** False: its layer does not line up with the picture well enough to be used (`reasons`). */
  usable: boolean; reasons: string[];
  /** The layer's shift (picture pixels) and scale that line it up with the picture; the share of its solid pixels that match then. */
  registration: { dx: number; dy: number; scale: number; agreement: number };
  /** The layer's colours minus the picture's, per channel (median over its matching pixels). */
  offset: [number, number, number];
  /** Where the picture shows it (w × h): its ownership mask. */
  visible: Uint8Array;
  /** The full-size area its layer was examined in; `completed` and `rgba` are this crop's size. */
  crop: Box;
  /** 1 completed behind a layer in front, 2 completed behind artwork in front; 0 not completed. */
  completed: Uint8Array;
  /** The completion's colours (the registered layer, matched to the picture) and alpha, where `completed`. */
  rgba: Uint8Array;
  /** Registered object geometry and alpha, with colours calibrated to visible source pixels. */
  registered: Uint8Array;
  /** `extended`: of the visible, its own edge past its layer's outline (see EXTEND). */
  counts: { solid: number; visible: number; extended: number; behindLayers: number; behindArt: number; outline: number; conflict: number; inferred: number; unresolved: number };
  /** The decomposed elements in front of it (labels), where they hide it. */
  hiddenBehind: string[];
  /** The artwork in front of it (lifted onto its own layer): named after the background element it lies on. */
  art?: { label: string; pixels: number };
}

/** A pixel of a layer matches the picture within this (the most any channel differs, mean over 3 × 3). */
const MATCH = 24;
/** Two explanations this close are alike: the nearer one in front wins (an element over the background). */
const TIE = 6;
/** A completion's colours are matched by the pixels that match within this, and kept this near the layer's own offset. */
const CALIBRATE = 12, LOCAL = 20;
/** How far along a row or a column a completed pixel looks for the picture's pixels to match. */
const SEAM = 24;
/** How far past its layer's outline its own edge is looked for (see explainLayers). */
const EXTEND = 4;
/** At most this share of an element can be artwork its layer copied (see explainLayers). */
const COPIED = 0.3;
/** An element's layer copies the one in front where the two differ by no more than this. */
const SAME = 8;
/** Registration: a solid pixel agrees within this. */
const AGREE = 20;
/**
 * A hidden region is completed when this many of its pixels lie more than 2 px inside the element's outline, and it is
 * at least a thousandth of the element; else, along the outline, a band of it the picture does not show (left out), and
 * inside, a speck where its redrawn texture differs (the element's own pixels: kept).
 */
const DEEP = 12;
/** Below this agreement a layer is not used. */
const MIN_AGREEMENT = 0.35;

interface Placed { L: EvidenceLayer; crop: Box; cw: number; ch: number; reg: LayerEvidence['registration']; off: number[]; px: Float32Array; d: Float32Array; raw: Float32Array }

/** Bilinear sample of an RGBA layer (premultiplied, so a transparent neighbour does not darken the colour). */
function sampler(rgba: Uint8Array, W: number, H: number) {
  return (u: number, v: number, out: Float32Array) => {
    const x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0;
    let a = 0, r = 0, g = 0, b = 0;
    for (let k = 0; k < 4; k++) {
      const X = x0 + (k & 1), Y = y0 + (k >> 1), wt = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty);
      if (!wt || X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const q = (Y * W + X) * 4, al = rgba[q + 3] * wt;
      a += al; r += rgba[q] * al; g += rgba[q + 1] * al; b += rgba[q + 2] * al;
    }
    out[3] = a; if (a > 0) { out[0] = r / a; out[1] = g / a; out[2] = b / a; } else out[0] = out[1] = out[2] = 0;
  };
}

/** 3 × 3 mean (the picture is matched by small patches, not by single pixels: resampling moves edges by a fraction). */
function boxMean(v: Float32Array, w: number, h: number): Float32Array {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, k = 0; for (let X = Math.max(0, x - 1); X <= Math.min(w - 1, x + 1); X++) { s += v[y * w + X]; k++; } t[y * w + x] = s / k; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, k = 0; for (let Y = Math.max(0, y - 1); Y <= Math.min(h - 1, y + 1); Y++) { s += t[Y * w + x]; k++; } o[y * w + x] = s / k; }
  return o;
}
const median = (v: number[]) => { if (!v.length) return 0; v.sort((a, b) => a - b); return v[v.length >> 1]; };

/** Each layer lined up with the picture (see the top of this file), and its crop resampled at full size. */
function place(input: EvidenceInput, L: EvidenceLayer): Placed | undefined {
  const { picture, w, h, sent } = input, W = sent.width, H = sent.height, fx = w / W, fy = h / H;
  let sx0 = W, sy0 = H, sx1 = -1, sy1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (L.rgba[(y * W + x) * 4 + 3] >= 16) { if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y; }
  if (sx1 < 0) return undefined;
  const step = Math.max(1, fx, fy), margin = Math.ceil(4 * step) + 2;
  const x0 = Math.max(0, Math.floor(sx0 * fx) - margin), y0 = Math.max(0, Math.floor(sy0 * fy) - margin), x1 = Math.min(w, Math.ceil((sx1 + 1) * fx) + margin), y1 = Math.min(h, Math.ceil((sy1 + 1) * fy) + margin);
  const cw = x1 - x0, ch = y1 - y0, cx = x0 + cw / 2, cy = y0 + ch / 2, at = sampler(L.rgba, W, H), s4 = new Float32Array(4);
  // A full-size pixel (X, Y), the layer shifted by (dx, dy) and scaled by s about the crop's centre: its colour.
  const sample = (X: number, Y: number, dx: number, dy: number, s: number) => at((cx + (X + 0.5 - cx - dx) / s) / fx - 0.5, (cy + (Y + 0.5 - cy - dy) / s) / fy - 0.5, s4);
  const grid = Math.max(2, Math.round(Math.sqrt(cw * ch / 40000)));
  const off = [0, 0, 0];
  {
    const d: number[][] = [[], [], []];
    for (let Y = y0; Y < y1; Y += grid) for (let X = x0; X < x1; X += grid) { sample(X, Y, 0, 0, 1); if (s4[3] < 250) continue; const i = (Y * w + X) * 3; for (let c = 0; c < 3; c++) d[c].push(s4[c] - picture[i + c]); }
    for (let c = 0; c < 3; c++) off[c] = median(d[c]);
  }
  const score = (dx: number, dy: number, s: number) => {
    let agree = 0, solid = 0;
    for (let Y = y0; Y < y1; Y += grid) for (let X = x0; X < x1; X += grid) {
      sample(X, Y, dx, dy, s); if (s4[3] < 250) continue; solid++;
      const i = (Y * w + X) * 3;
      if (Math.abs(s4[0] - off[0] - picture[i]) <= AGREE && Math.abs(s4[1] - off[1] - picture[i + 1]) <= AGREE && Math.abs(s4[2] - off[2] - picture[i + 2]) <= AGREE) agree++;
    }
    return solid ? agree / solid : 0;
  };
  let best = { dx: 0, dy: 0, scale: 1, agreement: score(0, 0, 1) };
  for (const s of [0.98, 0.99, 1, 1.01, 1.02]) for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
    const a = score(i * step, j * step, s); if (a > best.agreement) best = { dx: i * step, dy: j * step, scale: s, agreement: a };
  }
  const b0 = { ...best };
  for (const s of [b0.scale - 0.005, b0.scale, b0.scale + 0.005]) for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    if (!i && !j && s === b0.scale) continue;
    const dx = b0.dx + i * step / 4, dy = b0.dy + j * step / 4, a = score(dx, dy, s); if (a > best.agreement) best = { dx, dy, scale: s, agreement: a };
  }
  // At its place: the layer resampled over the crop, the offset measured again, and how far it is from the picture.
  const px = new Float32Array(cw * ch * 4);
  for (let Y = y0; Y < y1; Y++) for (let X = x0; X < x1; X++) { sample(X, Y, best.dx, best.dy, best.scale); px.set(s4, ((Y - y0) * cw + X - x0) * 4); }
  const d: number[][] = [[], [], []];
  for (let k = 0; k < cw * ch; k += grid) { if (px[k * 4 + 3] < 250) continue; const X = x0 + k % cw, Y = y0 + Math.floor(k / cw), i = (Y * w + X) * 3; for (let c = 0; c < 3; c++) d[c].push(px[k * 4 + c] - picture[i + c]); }
  for (let c = 0; c < 3; c++) off[c] = median(d[c]);
  // (Its soft edge too: another element's pixel there is its rim — a dishwasher's light edge is not the refrigerator's.)
  const e = new Float32Array(cw * ch);
  for (let k = 0; k < cw * ch; k++) {
    if (px[k * 4 + 3] < 16) { e[k] = 255; continue; }
    const X = x0 + k % cw, Y = y0 + Math.floor(k / cw), i = (Y * w + X) * 3;
    e[k] = Math.max(Math.abs(px[k * 4] - off[0] - picture[i]), Math.abs(px[k * 4 + 1] - off[1] - picture[i + 1]), Math.abs(px[k * 4 + 2] - off[2] - picture[i + 2]));
  }
  return { L, crop: { x: x0, y: y0, width: cw, height: ch }, cw, ch, reg: { dx: round2(best.dx), dy: round2(best.dy), scale: round2(best.scale, 3), agreement: round2(best.agreement, 3) }, off, px, d: boxMean(e, cw, ch), raw: e };
}
const round2 = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Every layer explained against the picture and the others (see the top of this file). */
export function explainLayers(input: EvidenceInput): Map<string, LayerEvidence> {
  const { picture, w, h, background } = input, n = w * h, out = new Map<string, LayerEvidence>();
  const placed = input.layers.map(L => place(input, L)).filter((p): p is Placed => !!p);
  for (const P of placed) {
    const { crop, cw, ch } = P, N = cw * ch, at = (k: number) => (crop.y + Math.floor(k / cw)) * w + crop.x + k % cw;
    // How far the background is from the picture, over this crop (3 × 3 mean, as for the layers).
    const eb = new Float32Array(N);
    for (let k = 0; k < N; k++) { const i = at(k) * 3; eb[k] = Math.max(Math.abs(background[i] - picture[i]), Math.abs(background[i + 1] - picture[i + 1]), Math.abs(background[i + 2] - picture[i + 2])); }
    const dBg = boxMean(eb, cw, ch);
    const others = placed.filter(Q => Q !== P && Q.crop.x < crop.x + cw && crop.x < Q.crop.x + Q.cw && Q.crop.y < crop.y + ch && crop.y < Q.crop.y + Q.ch);
    // 0 not its pixel; 1 visible; 2 behind a layer in front; 3 behind artwork; 4 conflict (a layer drawn behind it shows).
    // `copied`: its layer there is not its own drawing — another element's in front, or the background's artwork (below).
    const cls = new Uint8Array(N), by = new Int32Array(N).fill(-1), copied = new Uint8Array(N), both = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (P.px[k * 4 + 3] < 128) continue;
      const X = crop.x + k % cw, Y = crop.y + Math.floor(k / cw);
      let win: Placed = P, dw = P.d[k];
      for (const Q of others) {
        const qx = X - Q.crop.x, qy = Y - Q.crop.y; if (qx < 0 || qy < 0 || qx >= Q.cw || qy >= Q.ch) continue;
        const q = qy * Q.cw + qx; if (Q.px[q * 4 + 3] < 16) continue;
        const dq = Q.d[q];
        if (dq < dw - TIE || (Math.abs(dq - dw) <= TIE && Q.L.z > win.L.z)) { win = Q; dw = dq; }
      }
      // (The background nearer than every element: artwork in front of it — a redrawn medallion is not exact, yet far nearer
      // than the refrigerator's grey.)
      // Small details (a medallion's individual dots) must not disappear into a 3 × 3 mean.
      // Require both the raw background explanation and the object disagreement at that pixel.
      const art = (dw > MATCH && dBg[k] + TIE < dw) || (win === P && P.raw[k] > MATCH && eb[k] <= SAME);
      if (art) cls[k] = 3;
      else if (win === P) { cls[k] = 1; if (P.d[k] <= MATCH && dBg[k] <= MATCH) both[k] = 1; }
      else {
        cls[k] = win.L.z > P.L.z ? 2 : 4; by[k] = placed.indexOf(win);
        // (Its layer the same as the element in front there, pixel for pixel: judged per region below.)
        const q = (Y - win.crop.y) * win.cw + X - win.crop.x;
        if (Math.max(Math.abs(P.px[k * 4] - win.px[q * 4]), Math.abs(P.px[k * 4 + 1] - win.px[q * 4 + 1]), Math.abs(P.px[k * 4 + 2] - win.px[q * 4 + 2])) <= SAME) copied[k] = 1;
      }
    }
    // Artwork copied into its layer: where its layer and the background both reproduce the picture, in a region with
    // structure of its own (a wheel's rings; not a white wall behind a white appliance), reaching inside its outline and
    // no more than COPIED of it — the background kept it, so it is the background's (more: the background failed to take
    // the element out, which the residual check reports).
    {
      const bgDetail = (k: number) => { const x = k % cw, y = Math.floor(k / cw); let lo = 765, hi = 0; for (let yy = Math.max(0, y - 1); yy <= Math.min(ch - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(cw - 1, x + 1); xx++) { const i = at(yy * cw + xx) * 3, v = background[i] + background[i + 1] + background[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return (hi - lo) / 3; };
      const seen = new Uint8Array(N), take: number[][] = []; let solidAll = 0, taken = 0;
      for (let k = 0; k < N; k++) if (P.px[k * 4 + 3] >= 128) solidAll++;
      for (let k0 = 0; k0 < N; k0++) {
        if (!both[k0] || seen[k0]) continue;
        const region = [k0], stack = [k0]; seen[k0] = 1; let detailed = 0;
        while (stack.length) { const k = stack.pop()!, x = k % cw, y = Math.floor(k / cw); if (bgDetail(k) > MATCH) detailed++; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue; const j = Y * cw + X; if (both[j] && !seen[j]) { seen[j] = 1; region.push(j); stack.push(j); } } }
        if (region.length >= Math.max(DEEP, solidAll * 0.001) && detailed >= Math.max(5, region.length * 0.05)) { take.push(region); taken += region.length; }
      }
      if (taken <= solidAll * COPIED) for (const region of take) for (const k of region) { cls[k] = 3; copied[k] = 1; }
    }
    // Deep: more than 2 px inside its outline (the layer solid all round).
    const deep = (k: number) => {
      const x = k % cw, y = Math.floor(k / cw);
      for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) { if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) return false; if (P.px[(yy * cw + xx) * 4 + 3] < 128) return false; }
      return true;
    };
    // Each region hidden behind a layer or artwork (8-connected): completed, an outline band or a speck (see DEEP).
    let solid = 0; for (let k = 0; k < N; k++) if (P.px[k * 4 + 3] >= 128) solid++;
    const speck = Math.max(DEEP, Math.round(solid * 0.001)), completed = new Uint8Array(N), seen = new Uint8Array(N);
    let outline = 0, conflict = 0;
    for (let k0 = 0; k0 < N; k0++) {
      if (seen[k0] || (cls[k0] !== 2 && cls[k0] !== 3)) { if (cls[k0] === 4) conflict++; continue; }
      const kind = cls[k0], region = [k0], stack = [k0]; seen[k0] = 1; let inner = 0, rim = false;
      while (stack.length) {
        const k = stack.pop()!, x = k % cw, y = Math.floor(k / cw); if (deep(k)) inner++; else rim = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue; const j = Y * cw + X;
          if (!seen[j] && cls[j] === kind) { seen[j] = 1; region.push(j); stack.push(j); }
        }
      }
      if (inner >= DEEP && region.length >= speck) {
        for (const k of region) completed[k] = kind === 2 ? 1 : 2;
        // Behind a layer: its layer is a copy of the one in front only where it is the same over most of the region (two
        // silver appliances share many colours; a copy shares all of them) — else its own drawing, kept.
        if (kind === 2) { let same = 0; for (const k of region) same += copied[k]; if (same < region.length * 0.8) for (const k of region) copied[k] = 0; }
      } else if (rim) outline += region.length;
      else for (const k of region) {
        if (kind === 3 && P.raw[k] > MATCH && eb[k] <= SAME) completed[k] = 2;
        else cls[k] = 1;
      }
    }
    // Its own edge, where its layer's outline lies inside the picture's (a refrigerator's top edge, a tassel past the hem):
    // up to EXTEND px out from its visible pixels, a pixel outside its layer, or taken for artwork, is its own when the
    // picture there is nearer its visible pixels beside it than the background there (and no other element's is nearer).
    let extended = 0;
    for (let r = 0; r < EXTEND; r++) {
      const take: number[] = [];
      for (let k = 0; k < N; k++) {
        if (cls[k] === 1 || cls[k] === 2 || cls[k] === 4) continue;
        const x = k % cw, y = Math.floor(k / cw), acc = [0, 0, 0]; let m = 0;
        // An extension needs independent support from this object's registered layer. Previously
        // newly admitted source pixels became donors themselves, letting a foreign fringe spread.
        for (let dy = -EXTEND; dy <= EXTEND; dy++) for (let dx = -EXTEND; dx <= EXTEND; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue; const j = Y * cw + X; if (cls[j] !== 1 || P.px[j * 4 + 3] < 250 || P.raw[j] > MATCH) continue; m++; for (let c = 0; c < 3; c++) acc[c] += P.px[j * 4 + c] - P.off[c]; }
        if (!m) continue;
        const i = at(k) * 3, dv = Math.max(...[0, 1, 2].map(c => Math.abs(picture[i + c] - acc[c] / m)));
        if (dv > MATCH || dv + TIE >= eb[k]) continue;
        const X = crop.x + x, Y = crop.y + y;
        if (others.some(Q => { const qx = X - Q.crop.x, qy = Y - Q.crop.y; if (qx < 0 || qy < 0 || qx >= Q.cw || qy >= Q.ch) return false; const q = qy * Q.cw + qx; return Q.px[q * 4 + 3] >= 16 && Q.raw[q] <= dv; })) continue;
        take.push(k);
      }
      if (!take.length) break;
      for (const k of take) { cls[k] = 1; completed[k] = 0; } extended += take.length;
    }
    // A completed region's edge: next to it (up to 3 px), pixels its own layer does not explain at all (twice the match,
    // the pixel alone or with its neighbours) are the region's — the thin dotted border of a medallion, redrawn a pixel or
    // two off, is the medallion's.
    for (let r = 0; r < 3; r++) {
      const grow: number[] = [];
      for (let k = 0; k < N; k++) {
        if (cls[k] !== 1 || (P.d[k] <= 2 * MATCH && P.raw[k] <= 2 * MATCH)) continue;
        const x = k % cw, y = Math.floor(k / cw); let near = 0;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue; const j = Y * cw + X; if (completed[j]) { near = completed[j]; break; } }
        if (near) grow.push(k, near);
      }
      if (!grow.length) break;
      for (let g = 0; g < grow.length; g += 2) { completed[grow[g]] = grow[g + 1]; cls[grow[g]] = grow[g + 1] === 1 ? 2 : 3; }
    }
    // Where its visible pixels meet a completed region, the picture mixes it with what stands in front (a dishwasher's
    // edge, a medallion's rim): that pixel joins the completion, or the mix would show as a line once that is moved.
    {
      const join: number[] = [];
      for (let k = 0; k < N; k++) {
        if (cls[k] !== 1) continue;
        const x = k % cw, y = Math.floor(k / cw);
        const v = (x > 0 && completed[k - 1]) || (x < cw - 1 && completed[k + 1]) || (y > 0 && completed[k - cw]) || (y < ch - 1 && completed[k + cw]) || 0;
        if (v) join.push(k, v);
      }
      for (let g = 0; g < join.length; g += 2) { completed[join[g]] = join[g + 1]; cls[join[g]] = join[g + 1] === 1 ? 2 : 3; }
    }
    // A copied artwork's one-pixel tip can fail the 3 × 3 background comparison because its
    // neighbours show the object. Do not use that exact background pixel as a completion donor.
    const copiedTips: number[] = [];
    for (let k = 0; k < N; k++) {
      if (cls[k] !== 1 || eb[k] > SAME || P.raw[k] > SAME) continue;
      const x = k % cw, y = Math.floor(k / cw);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue;
        const j = Y * cw + X;
        if (completed[j] === 2 && copied[j]) { copiedTips.push(k); dy = 3; break; }
      }
    }
    for (const k of copiedTips) { cls[k] = 3; completed[k] = 2; copied[k] = 1; }
    // The completion's soft edge: the layer's own partly transparent pixels just outside it, not beside a visible one.
    const soft: number[] = [];
    for (let k = 0; k < N; k++) {
      const a = P.px[k * 4 + 3]; if (a < 16 || a >= 128) continue;
      const x = k % cw, y = Math.floor(k / cw); let near = 0, vis = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue; const j = Y * cw + X; if (completed[j]) near = completed[j]; if (cls[j] === 1) vis = true; }
      if (near && !vis) soft.push(k, near);
    }
    for (let s = 0; s < soft.length; s += 2) completed[soft[s]] = soft[s + 1];
    // Its colours there: the layer, matched to the picture — the difference measured on its well-matched visible pixels
    // (3 × 3 mean) nearest along the row and the column (within SEAM), weighted by 1/distance², so a completion meets the
    // picture's own pixels exactly at the join and keeps the region's median offset (from its visible pixels within 6 px;
    // the layer's own with fewer than 25) farther in, never more than LOCAL from the layer's own.
    const diffAt = new Float32Array(N * 3).fill(NaN);
    for (let k = 0; k < N; k++) {
      if (cls[k] !== 1 || P.px[k * 4 + 3] < 250 || P.d[k] > CALIBRATE) continue;
      const x = k % cw, y = Math.floor(k / cw), acc = [0, 0, 0]; let m = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(ch - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(cw - 1, x + 1); xx++) {
        const j = yy * cw + xx; if (cls[j] !== 1 || P.px[j * 4 + 3] < 250) continue; const i = at(j) * 3; m++;
        for (let c = 0; c < 3; c++) acc[c] += P.px[j * 4 + c] - picture[i + c];
      }
      for (let c = 0; c < 3; c++) diffAt[k * 3 + c] = acc[c] / m;
    }
    const rgba = new Uint8Array(N * 4), region = new Int32Array(N).fill(-1), regions: number[][] = [];
    for (let k0 = 0; k0 < N; k0++) {
      if (!completed[k0] || region[k0] >= 0) continue;
      const r = regions.length, list = [k0], stack = [k0]; region[k0] = r;
      while (stack.length) { const k = stack.pop()!, x = k % cw, y = Math.floor(k / cw); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue; const j = Y * cw + X; if (completed[j] && region[j] < 0) { region[j] = r; list.push(j); stack.push(j); } } }
      regions.push(list);
    }
    const clamp = (v: number, c: number) => Math.max(P.off[c] - LOCAL, Math.min(P.off[c] + LOCAL, v));
    // The layer's drawing shifted by (sx, sy) whole pixels (`src`), and diffAt measured with it (cached per shift): its
    // registration is one shift for the whole layer, and its drawing of a hidden part can still be a pixel or two off the
    // picture there (a refrigerator's handle line behind a dishwasher), which shows as a jog at the join.
    const src = (k: number, sx: number, sy: number) => { const x = k % cw - sx, y = Math.floor(k / cw) - sy; if (x < 0 || y < 0 || x >= cw || y >= ch) return k; const j = y * cw + x; return P.px[j * 4 + 3] >= 250 ? j : k; };
    const shiftedDiff = new Map<string, Float32Array>([['0,0', diffAt]]);
    const diffWith = (sx: number, sy: number) => {
      const key = `${sx},${sy}`, have = shiftedDiff.get(key); if (have) return have;
      const out = new Float32Array(N * 3).fill(NaN);
      for (let k = 0; k < N; k++) {
        if (cls[k] !== 1 || P.px[k * 4 + 3] < 250) continue;
        const s = src(k, sx, sy), i = at(k) * 3;
        if (Math.max(...[0, 1, 2].map(c => Math.abs(P.px[s * 4 + c] - P.off[c] - picture[i + c]))) > CALIBRATE) continue;
        for (let c = 0; c < 3; c++) out[k * 3 + c] = P.px[s * 4 + c] - picture[i + c];
      }
      shiftedDiff.set(key, out); return out;
    };
    let inferred = 0, unresolved = 0;
    for (const list of regions) {
      // A confirmed copied region includes its boundary mixtures too. Those pixels were added after
      // classification; reading them back from the provider layer would reintroduce the neighbour's rim.
      // Require the same region consensus as above so merely similar silver products keep their drawing.
      if (list.reduce((sum, k) => sum + copied[k], 0) >= list.length * 0.8) for (const k of list) copied[k] = 1;
      let rx0 = cw, ry0 = ch, rx1 = -1, ry1 = -1; for (const k of list) { const x = k % cw, y = Math.floor(k / cw); rx0 = Math.min(rx0, x); ry0 = Math.min(ry0, y); rx1 = Math.max(rx1, x); ry1 = Math.max(ry1, y); }
      const mine = new Set(list), band: number[] = [];
      for (let y = Math.max(0, ry0 - 6); y <= Math.min(ch - 1, ry1 + 6); y++) for (let x = Math.max(0, rx0 - 6); x <= Math.min(cw - 1, rx1 + 6); x++) {
        const k = y * cw + x; if (cls[k] !== 1 || P.px[k * 4 + 3] < 250) continue;
        let close = false; for (let yy = Math.max(0, y - 6); yy <= Math.min(ch - 1, y + 6) && !close; yy++) for (let xx = Math.max(0, x - 6); xx <= Math.min(cw - 1, x + 6); xx++) if (mine.has(yy * cw + xx)) { close = true; break; }
        if (close) band.push(k);
      }
      // The shift (up to 2 px) that best matches its visible pixels round the region: kept only when clearly better.
      let sx = 0, sy = 0;
      if (band.length >= 25) {
        const score = (dx: number, dy: number) => { let s = 0; for (const k of band) { const j = src(k, dx, dy), i = at(k) * 3; s += Math.min(60, Math.max(...[0, 1, 2].map(c => Math.abs(P.px[j * 4 + c] - P.off[c] - picture[i + c])))); } return s / band.length; };
        const s0 = score(0, 0); let best = s0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { if (!dx && !dy) continue; const s = score(dx, dy); if (s < best) { best = s; sx = dx; sy = dy; } }
        if (best > s0 * 0.85) sx = sy = 0;
      }
      const diff = diffWith(sx, sy), d: number[][] = [[], [], []];
      for (const k of band) if (!Number.isNaN(diff[k * 3])) for (let c = 0; c < 3; c++) d[c].push(diff[k * 3 + c]);
      const base = d[0].length >= 25 ? d.map((v, c) => clamp(median(v), c)) : P.off;
      for (const k of list) {
        const x = k % cw, y = Math.floor(k / cw), acc = [0, 0, 0]; let wsum = 0;
        if (copied[k]) {
          // (Its layer copied what is there: continued from its own visible pixels nearest along the row and the column,
          // 1/distance² — a door's colour carried under a wheel, never the wheel.)
          for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let t = 1; ; t++) {
            const X = x + sx * t, Y = y + sy * t; if (X < 0 || Y < 0 || X >= cw || Y >= ch) break; const j = Y * cw + X;
            if (cls[j] !== 1 || copied[j]) continue;
            const wt = 1 / (t * t), i = at(j) * 3; wsum += wt; for (let c = 0; c < 3; c++) acc[c] += picture[i + c] * wt; break;
          }
          if (wsum) { for (let c = 0; c < 3; c++) rgba[k * 4 + c] = Math.round(acc[c] / wsum); rgba[k * 4 + 3] = Math.round(Math.min(255, P.px[k * 4 + 3])); inferred++; continue; }
          // No donor: keep a transparent, reported gap rather than restoring known foreign pixels.
          unresolved++; continue;
        }
        for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let t = 1; t <= SEAM; t++) {
          const X = x + sx * t, Y = y + sy * t; if (X < 0 || Y < 0 || X >= cw || Y >= ch) break; const j = Y * cw + X;
          if (completed[j]) continue;
          if (cls[j] !== 1) break;
          if (Number.isNaN(diff[j * 3])) continue;
          const wt = 1 / (t * t); wsum += wt; for (let c = 0; c < 3; c++) acc[c] += diff[j * 3 + c] * wt; break;
        }
        // (The region's own offset counts as a neighbour SEAM away: far from every join, it is what is left.)
        const wb = 1 / (SEAM * SEAM), s = src(k, sx, sy);
        for (let c = 0; c < 3; c++) { const off = clamp((acc[c] + base[c] * wb) / (wsum + wb), c); rgba[k * 4 + c] = Math.max(0, Math.min(255, Math.round(P.px[s * 4 + c] - off))); }
        rgba[k * 4 + 3] = Math.round(Math.min(255, P.px[k * 4 + 3]));
      }
    }
    const visible = new Uint8Array(n);
    let nVisible = 0, nLayers = 0, nArt = 0;
    const behind = new Map<number, number>(), artBoxes: number[] = [];
    for (let k = 0; k < N; k++) {
      if (cls[k] === 1) { visible[at(k)] = 1; nVisible++; }
      if (completed[k] === 1) { nLayers++; if (by[k] >= 0) behind.set(by[k], (behind.get(by[k]) ?? 0) + 1); }
      if (completed[k] === 2) { nArt++; artBoxes.push(at(k)); }
    }
    const minBehind = Math.max(20, solid * 0.005);
    const hiddenBehind = [...behind].filter(([, c]) => c >= minBehind).sort((a, b) => b[1] - a[1]).map(([q]) => placed[q].L.label);
    // The artwork in front: named after the element left in the background that holds most of it.
    let art: LayerEvidence['art'];
    if (nArt) {
      let label = 'Backdrop artwork', most = 0;
      for (const s of input.scenery) { let c = 0; for (const i of artBoxes) { const x = i % w, y = (i - x) / w; if (x >= s.box.x && y >= s.box.y && x < s.box.x + s.box.width && y < s.box.y + s.box.height) c++; } if (c > most && c >= nArt * 0.5) { most = c; label = s.label; } }
      art = { label, pixels: nArt };
    }
    const reasons: string[] = [];
    if (P.reg.agreement < MIN_AGREEMENT) reasons.push(`its layer matches the picture at only ${Math.round(100 * P.reg.agreement)}% of its pixels when lined up`);
    if (nVisible < solid * 0.3) reasons.push(`the picture shows only ${Math.round(100 * nVisible / Math.max(1, solid))}% of its layer`);
    const registered = new Uint8Array(N * 4);
    for (let k = 0; k < N; k++) {
      if (cls[k] === 4) continue;
      registered[k * 4 + 3] = Math.round(P.px[k * 4 + 3]);
      for (let c = 0; c < 3; c++) registered[k * 4 + c] = Math.max(0, Math.min(255, Math.round(P.px[k * 4 + c] - P.off[c])));
    }
    out.set(P.L.id, { id: P.L.id, usable: !reasons.length, reasons, registration: P.reg, offset: [round2(P.off[0], 1), round2(P.off[1], 1), round2(P.off[2], 1)], visible, crop, completed, rgba, registered,
      counts: { solid, visible: nVisible, extended, behindLayers: nLayers, behindArt: nArt, outline, conflict, inferred, unresolved }, hiddenBehind, ...(art ? { art } : {}) });
  }
  return out;
}

/**
 * Build an evidence-backed layer without discarding its object-aware alpha. The former binary-mask
 * path re-estimated every edge against an inpainted background and grew source pixels beyond the
 * provider silhouette, introducing other objects' fragments and a different outline at occlusions.
 * Keep the registered shape continuous. Preserve authentic source pixels in its verified interior;
 * use the registered object at mixed boundaries and the ownership completion behind foregrounds.
 */
export function evidenceCutout(e: LayerEvidence, picture: Uint8Array, w: number) {
  const { crop } = e, W = crop.width, H = crop.height, rgba = Uint8Array.from(e.registered);
  const at = (x: number, y: number) => (crop.y + y) * w + crop.x + x;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (!rgba[k * 4 + 3]) continue;
    if (e.completed[k]) { rgba.set(e.rgba.subarray(k * 4, k * 4 + 4), k * 4); continue; }
    let interior = !!e.visible[at(x, y)];
    for (let dy = -1; dy <= 1 && interior; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy, j = Y * W + X;
      if (X < 0 || Y < 0 || X >= W || Y >= H || e.registered[j * 4 + 3] < 250) { interior = false; break; }
    }
    if (interior) for (let c = 0; c < 3; c++) rgba[k * 4 + c] = picture[at(x, y) * 3 + c];
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < x0) return undefined;
  const box = { x: crop.x + x0, y: crop.y + y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, pixels = new Uint8Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) pixels.set(rgba.subarray(((y + y0) * W + x0) * 4, ((y + y0) * W + x1 + 1) * 4), y * box.width * 4);
  return { rgba: pixels, box };
}

/** An evidence's completion at full size, as prepare's cut-out takes it: its shape (w × h), its box, colours and alpha. */
export function completionOf(e: LayerEvidence, w: number, h: number): { shape: Uint8Array; box: Box; rgb: Uint8Array; alpha: Uint8Array; pixels: number } | undefined {
  const { crop } = e, cw = crop.width;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, pixels = 0;
  for (let k = 0; k < e.completed.length; k++) if (e.completed[k]) { const x = crop.x + k % cw, y = crop.y + Math.floor(k / cw); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); pixels++; }
  if (!pixels) return undefined;
  const box = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, shape = new Uint8Array(w * h), rgb = new Uint8Array(box.width * box.height * 3), alpha = new Uint8Array(box.width * box.height);
  for (let k = 0; k < e.completed.length; k++) {
    if (!e.completed[k]) continue;
    const x = crop.x + k % cw, y = crop.y + Math.floor(k / cw), o = (y - box.y) * box.width + x - box.x;
    shape[y * w + x] = 1; for (let c = 0; c < 3; c++) rgb[o * 3 + c] = e.rgba[k * 4 + c]; alpha[o] = e.rgba[k * 4 + 3];
  }
  return { shape, box, rgb, alpha, pixels };
}

/**
 * Each pixel (full-size index) where an element is completed behind artwork, and whether it touches the element's visible
 * pixels (8-connected): there the picture mixes the artwork's edge with the element's.
 */
export function forArt(e: LayerEvidence, w: number, visit: (i: number, edge: boolean) => void): void {
  const { crop } = e, cw = crop.width, ch = crop.height;
  for (let k = 0; k < e.completed.length; k++) {
    if (e.completed[k] !== 2) continue;
    const x = k % cw, y = Math.floor(k / cw); let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < cw && Y < ch && e.visible[(crop.y + Y) * w + crop.x + X] === 1) { edge = true; break; } }
    visit((crop.y + y) * w + crop.x + x, edge);
  }
}

/**
 * The artwork in front of an element, on a layer of its own (RGBA, its box): wherever the element's completion behind
 * artwork is drawn — over the completed element it shows what the picture showed, and over the background (the element
 * moved away) what the background has there. The picture's pixels, opaque; along the element's visible edge, where the
 * picture mixes the artwork's edge with the element, the artwork's own colour (its pixels just inside) at the opacity that
 * gives the picture over the element's completion there — so moved away, the element leaves no fringe of itself on it.
 */
export function artPieceOf(e: LayerEvidence, picture: Uint8Array, w: number): { rgba: Uint8Array; box: Box; pixels: number } | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, pixels = 0;
  const edges = new Set<number>();
  forArt(e, w, (i, edge) => { const x = i % w, y = (i - x) / w; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); pixels++; if (edge) edges.add(i); });
  if (!pixels) return undefined;
  const box = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, rgba = new Uint8Array(box.width * box.height * 4), { crop } = e;
  const art = new Set<number>(); forArt(e, w, i => art.add(i));
  forArt(e, w, (i, edge) => {
    const x = i % w, y = (i - x) / w, o = ((y - box.y) * box.width + x - box.x) * 4, colour = [picture[i * 3], picture[i * 3 + 1], picture[i * 3 + 2]];
    let rgb = colour, alpha = 1;
    if (edge) {
      const inside = [0, 0, 0]; let m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (y + dy) * w + x + dx; if (!art.has(j) || edges.has(j)) continue; m++; for (let c = 0; c < 3; c++) inside[c] += picture[j * 3 + c]; }
      if (m) {
        const k = ((y - crop.y) * crop.width + x - crop.x) * 4, behind = [e.rgba[k], e.rgba[k + 1], e.rgba[k + 2]];
        ({ rgb, alpha } = unmix(colour, behind, inside.map(v => v / m)));
      }
    }
    rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = Math.round(alpha * 255);
  });
  return { rgba, box, pixels };
}

/**
 * The decomposition's background lined up with the picture around each element (a copy): its artwork is redrawn, and a
 * pixel or two off — a medallion's rim, an arch's edge — so where it is used behind an element (`regions`: each element's
 * pixels), the shift (up to 4 px) that matches the picture best just outside the element (`hole`: everything being
 * rebuilt, not compared) is used there. A region with nothing round it to compare keeps the background as it is.
 */
export function alignBackground(picture: Uint8Array, background: Uint8Array, w: number, h: number, regions: Uint8Array[], hole: Uint8Array): { rgb: Uint8Array; shifts: [number, number][] } {
  const rgb = Uint8Array.from(background), shifts: [number, number][] = [];
  for (const m of regions) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < w * h; i++) if (m[i]) { const x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { shifts.push([0, 0]); continue; }
    // On its box and 14 px round it: its pixels widened by 3 px (filled) and by 10 px (the band compared: the picture's
    // own background there, not being rebuilt, the 4 px shift kept on the canvas).
    const X0 = Math.max(0, x0 - 14), Y0 = Math.max(0, y0 - 14), X1 = Math.min(w - 1, x1 + 14), Y1 = Math.min(h - 1, y1 + 14), cw = X1 - X0 + 1, ch = Y1 - Y0 + 1;
    const local = new Uint8Array(cw * ch); for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) local[(y - Y0) * cw + x - X0] = m[y * w + x];
    const near3 = widen(local, cw, ch, 3), near10 = widen(local, cw, ch, 10), band: number[] = [];
    for (let y = Math.max(4, Y0); y <= Math.min(h - 5, Y1); y += 2) for (let x = Math.max(4, X0); x <= Math.min(w - 5, X1); x += 2) { const k = (y - Y0) * cw + x - X0, i = y * w + x; if (!hole[i] && !near3[k] && near10[k]) band.push(i); }
    const score = (dx: number, dy: number) => { let s = 0; for (const i of band) { const j = i - dy * w - dx; s += Math.min(60, Math.max(Math.abs(picture[i * 3] - background[j * 3]), Math.abs(picture[i * 3 + 1] - background[j * 3 + 1]), Math.abs(picture[i * 3 + 2] - background[j * 3 + 2]))); } return s / Math.max(1, band.length); };
    let best: [number, number] = [0, 0];
    if (band.length >= 50) { const s0 = score(0, 0); let bs = s0; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const s = score(dx, dy); if (s < bs) { bs = s; best = [dx, dy]; } } if (bs > s0 * 0.9) best = [0, 0]; }
    shifts.push(best);
    if (!best[0] && !best[1]) continue;
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const X = x - best[0], Y = y - best[1]; if (!near3[(y - Y0) * cw + x - X0] || X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const i = y * w + x, j = Y * w + X; for (let c = 0; c < 3; c++) rgb[i * 3 + c] = background[j * 3 + c];
    }
  }
  return { rgb, shifts };
}

/** A mask widened by r (a square neighbourhood): separable running counts. */
function widen(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const t = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let c = 0; for (let x = -r; x < w; x++) { if (x + r < w && m[y * w + x + r]) c++; if (x - r - 1 >= 0 && m[y * w + x - r - 1]) c--; if (x >= 0 && c) t[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let c = 0; for (let y = -r; y < h; y++) { if (y + r < h && t[(y + r) * w + x]) c++; if (y - r - 1 >= 0 && t[(y - r - 1) * w + x]) c--; if (y >= 0 && c) out[y * w + x] = 1; } }
  return out;
}
