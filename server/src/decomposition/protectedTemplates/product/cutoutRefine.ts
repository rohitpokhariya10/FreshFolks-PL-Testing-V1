/**
 * A decomposed object's cut-out repaired (Refine Cutout), only that layer:
 *
 *   defects where the cut-out is not the object as the picture showed it, when the picture it was cut from is known
 *           (`cutoutDefects`): what an element in front of it hides (an estimate there, or the front element's own
 *           pixels baked in — a refrigerator's corner as a flat grey block where a dishwasher stood before it), solid
 *           pixels that differ from the picture, and the background plate's own content claimed by the layer (a festive
 *           wheel of the backdrop, purple, green and yellow, as the refrigerator's top-right corner: the plate holds it, so
 *           in the layer it is a copy that moves with the object). Only the rest is verified; defects are rebuilt, never
 *           trusted.
 *   local   free, on this computer: defects rebuilt from the object's own verified pixels (each row and column continued
 *           inwards from the nearest ones, so its panels, lines and shading carry on; its outline kept), specks and
 *           stray fragments away from the object removed (it is the largest piece; a piece a fair fraction of its size,
 *           a detached part, is kept), pinholes filled (larger openings — a handle's gap, a glass panel — kept), the
 *           background colour bleeding into its soft edge replaced by the object's own (defringed). Nothing is eroded:
 *           every solid pixel of the object stays where it is.
 *   ai      one approved image-model request: the cut-out on a plain chroma-green ground, its defects painted magenta,
 *           asked to redraw them and repair only what is damaged or missing; the green keyed out, the original's
 *           verified pixels — never its defects — put back over the result (a defect the model left unrepaired is
 *           rebuilt locally), then the local pass. The previous picture is kept until the person approves the result.
 *
 * Text and logos are never here: they are editable overlays, not pictures to cut out.
 */
import sharp from 'sharp';

export interface CutoutRefinement { png: Buffer; width: number; height: number; removedPixels: number; filledPixels: number; defringedPixels: number; rebuiltPixels: number; clearedPixels: number }
/** What to repair: the pixels to rebuild as the object (`mask`) and, past its outline, to make transparent (`clear`). */
export type CutoutRepair = Uint8Array | { mask: Uint8Array; clear?: Uint8Array };
const repairParts = (d: CutoutRepair | undefined) => (!d ? undefined : d instanceof Uint8Array ? { mask: d, clear: undefined } : d);
const SOLID = 128;
type Rect = { x: number; y: number; width: number; height: number };

/**
 * The picture a layer was cut from, where the layer sits in it, the layers in front of it there (the picture's pixels),
 * and the background plate the decomposition made (the picture without its objects), when known.
 */
export interface CutoutContext { picture: Buffer; placement: Rect; front: { png: Buffer; placement: Rect }[]; plate?: Buffer }
/**
 * A region of the background plate's content in the layer and what is done with it: `rebuild` — inside the object's
 * outline (verified object pixels on two sides across a corner, or on two opposite sides: a wheel over a refrigerator's
 * corner), rebuilt as the object; `clear` — past it (verified object on one side at most: the backdrop under an air
 * conditioner), made transparent; `keep` — a thin band along the outline (a purifier's light rim against a light wall),
 * left as it is: it cannot be told from the object's own edge.
 */
export interface CutoutRegion { kind: 'background' | 'hidden'; action: 'rebuild' | 'clear' | 'keep'; pixels: number; box: Rect; thickness: number }
export interface CutoutDefects {
  /** Pixels to rebuild as the object (hidden, the plate's content inside it, differing patches, with their margins). */
  mask: Uint8Array; count: number;
  /** Pixels to make transparent (the plate's content past the object's outline). */
  clear: Uint8Array; clearCount: number;
  hiddenPixels: number; differingPixels: number; foreignPixels: number; keptPixels: number; keptHiddenPixels: number; compared: boolean;
  hidden: Uint8Array; foreign: Uint8Array; regions: CutoutRegion[];
}
/**
 * Where a cut-out is not verified (see the top of this file): its pixels hidden behind a front layer (at least half
 * opaque there), and solid pixels differing from the picture by more than 40 in a channel — in a patch, not a lone pixel
 * or a one-pixel line along an edge — with a margin for their fringe. A layer differing almost everywhere was redrawn
 * as a whole (its colours are not the picture's): then only what is hidden counts. With the plate: the plate's content
 * the layer claims (`plateContent`), each region rebuilt, cleared or kept (`CutoutRegion`) — hidden pixels too: what the
 * decomposition put behind a layer in front can itself be the background (the backdrop under an air conditioner, behind
 * a speaker). What is hidden and unlike the background is rebuilt within the outline the decomposition gave it, never
 * cleared: a television half behind a soundbar keeps its lower half.
 */
export async function cutoutDefects(png: Buffer, ctx: CutoutContext): Promise<CutoutDefects> {
  const { data: px, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), w = info.width, h = info.height, n = w * h;
  const pic = await sharp(ctx.picture).removeAlpha().raw().toBuffer({ resolveWithObject: true }), PW = pic.info.width, PH = pic.info.height;
  const fronts = await Promise.all(ctx.front.map(async f => { const r = await sharp(f.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: r.data, w: r.info.width, h: r.info.height, p: f.placement }; }));
  const p = ctx.placement, hidden = new Uint8Array(n), differ = new Uint8Array(n);
  let opaque = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = px[i * 4 + 3]; if (!a) continue;
    const X = Math.floor(p.x + (x + 0.5) * p.width / w), Y = Math.floor(p.y + (y + 0.5) * p.height / h);
    if (a >= SOLID) for (const f of fronts) {
      const fx = Math.floor((X + 0.5 - f.p.x) * f.w / f.p.width), fy = Math.floor((Y + 0.5 - f.p.y) * f.h / f.p.height);
      if (fx >= 0 && fy >= 0 && fx < f.w && fy < f.h && f.data[(fy * f.w + fx) * 4 + 3] >= SOLID) { hidden[i] = 1; break; }
    }
    if (a < 250 || X < 0 || Y < 0 || X >= PW || Y >= PH) continue;
    opaque++;
    const q = (Y * PW + X) * 3;
    if (Math.max(Math.abs(pic.data[q] - px[i * 4]), Math.abs(pic.data[q + 1] - px[i * 4 + 1]), Math.abs(pic.data[q + 2] - px[i * 4 + 2])) > 40) differ[i] = 1;
  }
  // (A lone differing pixel, or a one-pixel line along the outline, is the cut's own edge: not a defect.)
  const patch = new Uint8Array(n);
  let differing = 0;
  for (let i = 0; i < n; i++) {
    if (!differ[i] || hidden[i]) continue;
    const x = i % w, y = (i - x) / w; let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if ((dx || dy) && X >= 0 && Y >= 0 && X < w && Y < h && differ[Y * w + X]) k++; }
    if (k >= 3) { patch[i] = 1; differing++; }
  }
  const compared = differing <= opaque * 0.3;
  const { foreign, rare } = ctx.plate ? await plateContent(png, px, w, h, p, ctx.plate, hidden) : { foreign: new Uint8Array(n), rare: new Uint8Array(n) };
  const { inside, outside, keepHidden, regions } = placeRegions(px, w, h, foreign, hidden, compared ? patch : new Uint8Array(n));
  const rebuildHidden = new Uint8Array(n); for (let i = 0; i < n; i++) rebuildHidden[i] = hidden[i] && !outside[i] && !keepHidden[i] ? 1 : 0;
  // The margins: what is hidden, 4 % of the layer's smaller side (a front layer's own cut-out can miss a few pixels of it
  // — a dishwasher's side wall left on the refrigerator as a lighter seam); the plate's content, as far into colours not
  // the object's own (a wheel's outer ring of dots matches the plate only in part) and 2 % into the rest (its soft edge
  // tints the door); a differing patch, 2 px.
  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.04)), soft = Math.max(3, Math.round(Math.min(w, h) * 0.02));
  const near = grow(rebuildHidden, w, h, margin), farForeign = grow(inside, w, h, margin), nearForeign = grow(inside, w, h, soft), nearPatch = compared ? grow(patch, w, h, 2) : new Uint8Array(n);
  const farOut = grow(outside, w, h, soft);
  const mask = new Uint8Array(n), clear = new Uint8Array(n);
  let count = 0, clearCount = 0, hiddenPixels = 0, foreignPixels = 0, keptPixels = 0, keptHiddenPixels = 0;
  for (let i = 0; i < n; i++) {
    if (hidden[i]) { hiddenPixels++; if (keepHidden[i]) keptHiddenPixels++; } else if (foreign[i]) { foreignPixels++; if (!inside[i] && !outside[i]) keptPixels++; }
    if (!px[i * 4 + 3]) continue;
    // Past the outline: the region, and the fringe of its own colours around it (never what is hidden or verified).
    if (outside[i] || (farOut[i] && rare[i] && !inside[i] && !hidden[i])) { clear[i] = 1; clearCount++; continue; }
    if (keepHidden[i]) continue;
    if (near[i] || nearPatch[i] || nearForeign[i] || (farForeign[i] && rare[i])) { mask[i] = 1; count++; }
  }
  return { mask, count, clear, clearCount, hiddenPixels, differingPixels: compared ? differing : 0, foreignPixels, keptPixels, keptHiddenPixels, compared, hidden, foreign, regions };
}

/**
 * Each region (8-connected) of the plate's content, then of what is hidden and unlike the background, placed against the
 * object's verified pixels (solid, neither hidden, the plate's nor differing): the bands just past its bounding box on
 * each side (2 px out, max(4 px, 2 %) deep, along the box) — a side is the object's when at least half of its band is
 * verified object; inside its outline with two sides across a corner or two opposite sides.
 *   the plate's content   thinner than max(3 px, 1 % of the layer's smaller side): a band longer than three times that,
 *                         `keep`; a speck, inside `rebuild`, else `keep`. Thicker: inside, `rebuild`; else `clear`.
 *   hidden                thinner, or inside, `rebuild`; else, mostly in colours not the object's own, `clear` (the
 *                         decomposition's backdrop under an air conditioner, behind a speaker); in its own colours,
 *                         `keep` — left as decomposed and reported (a television behind a soundbar as wide as it).
 * (Measured on 160 saved product cut-outs: the Navratri wheel 20 px thick, object left and below; a chevron over a
 * refrigerator's corner 9 px, left and above; a purifier's rim 1–2 px; the backdrop under an air conditioner 5 and 11 px,
 * object above at most; the block behind its speaker, no side.)
 */
function placeRegions(px: Buffer, w: number, h: number, foreign: Uint8Array, hidden: Uint8Array, patch: Uint8Array) {
  const n = w * h, inside = new Uint8Array(n), outside = new Uint8Array(n), keepHidden = new Uint8Array(n), regions: CutoutRegion[] = [];
  const thin = Math.max(3, Math.round(Math.min(w, h) * 0.01)), depth = Math.max(4, Math.round(Math.min(w, h) * 0.02));
  const verified = (i: number) => px[i * 4 + 3] >= 250 && !hidden[i] && !foreign[i] && !patch[i];
  // The object's own colours: over its verified pixels.
  const rareColour = colourRarity(px, n, verified), ownColour = (i: number) => !rareColour(i);
  const seen = new Uint8Array(n), stack: number[] = [], within = new Float32Array(n), band = new Uint8Array(n);
  const specks: { members: number[]; inside: boolean; region: CutoutRegion }[] = [];
  for (const kind of ['background', 'hidden'] as const) for (let s = 0; s < n; s++) {
    const member = kind === 'background' ? (i: number) => foreign[i] === 1 : (i: number) => hidden[i] === 1 && !foreign[i] && px[i * 4 + 3] >= SOLID;
    if (!member(s) || seen[s]) continue;
    const members: number[] = []; let x0 = w, y0 = h, x1 = -1, y1 = -1; seen[s] = 1; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i - x) / w; members.push(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (member(j) && !seen[j]) { seen[j] = 1; stack.push(j); } }
    }
    // Its thickness: the largest distance from a member to the nearest pixel outside it (two passes, within its box).
    const at = (x: number, y: number) => (x < x0 || y < y0 || x > x1 || y > y1 ? 0 : within[y * w + x]);
    for (const i of members) within[i] = 1e9;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (within[i]) within[i] = Math.min(within[i], at(x - 1, y) + 1, at(x, y - 1) + 1); }
    for (let y = y1; y >= y0; y--) for (let x = x1; x >= x0; x--) { const i = y * w + x; if (within[i]) within[i] = Math.min(within[i], at(x + 1, y) + 1, at(x, y + 1) + 1); }
    let thickness = 0; for (const i of members) thickness = Math.max(thickness, within[i]);
    for (const i of members) within[i] = 0;
    const box = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    // Thin: a band along the outline is kept; a small compact speck enclosed by the object and away from any such band
    // (the backdrop's green in a notch at the top of a door gap — not a piece of a purifier's rim at its corner) is
    // rebuilt; nothing thin is ever cleared.
    const small = thickness < thin, long = Math.max(box.width, box.height) > 3 * thin;
    if (small && (long || kind === 'hidden')) {
      if (kind === 'background') for (const i of members) band[i] = 1;
      regions.push({ kind, action: kind === 'hidden' ? 'rebuild' : 'keep', pixels: members.length, box, thickness }); continue;
    }
    const side = (xs: [number, number], ys: [number, number]) => {
      let v = 0, c = 0;
      for (let y = ys[0]; y <= ys[1]; y++) for (let x = xs[0]; x <= xs[1]; x++) { c++; if (x >= 0 && y >= 0 && x < w && y < h && verified(y * w + x)) v++; }
      return c > 0 && v >= c / 2;
    };
    const L = side([x0 - 1 - depth, x0 - 2], [y0, y1]), R = side([x1 + 2, x1 + 1 + depth], [y0, y1]), T = side([x0, x1], [y0 - 1 - depth, y0 - 2]), B = side([x0, x1], [y1 + 2, y1 + 1 + depth]);
    const within_ = ((L || R) && (T || B)) || (L && R) || (T && B);
    let foreignColours = 0; if (!within_ && kind === 'hidden') for (const i of members) if (!ownColour(i)) foreignColours++;
    if (small) { const region: CutoutRegion = { kind, action: 'keep', pixels: members.length, box, thickness }; specks.push({ members, inside: within_, region }); regions.push(region); continue; }
    const action = within_ ? 'rebuild' : kind === 'background' || foreignColours > members.length / 2 ? 'clear' : 'keep';
    if (kind === 'background') { if (action !== 'keep') for (const i of members) (action === 'rebuild' ? inside : outside)[i] = 1; }
    else if (action !== 'rebuild') for (const i of members) (action === 'clear' ? outside : keepHidden)[i] = 1;
    regions.push({ kind, action, pixels: members.length, box, thickness });
  }
  // The specks, once every band is known: rebuilt when enclosed and not within 2 × max(3 px, 1 %) of a band.
  const nearBand = grow(band, w, h, 2 * thin);
  for (const sp of specks) if (sp.inside && !sp.members.some(i => nearBand[i])) { sp.region.action = 'rebuild'; for (const i of sp.members) inside[i] = 1; }
  return { inside, outside, keepHidden, regions };
}

/**
 * The background plate's content a layer claims: its solid pixels matching the plate at the same place (within 2 px, as
 * the two are separate redraws of it; at most 32 apart in a channel; both softened, σ 1.5, or as they are — a few pixels
 * of the backdrop showing in a notch at the top of a door gap vanish when softened), in a patch that reaches the
 * layer's outline (it comes in from outside) and whose colours are mostly not the object's own (rare among the rest of
 * its solid pixels: the wheel's purple, green and yellow on a grey refrigerator — never a grey door against a grey wall
 * the plate continued behind it); of such a patch, only its pixels in colours not the object's own. Matching more than
 * 30 % of the layer, the plate kept the object: nothing is marked. `rare`: the layer's solid pixels in such colours.
 */
async function plateContent(png: Buffer, px: Buffer, w: number, h: number, p: Rect, plate: Buffer, hidden: Uint8Array) {
  const n = w * h, R = 2, out = new Uint8Array(n), shared = new Uint8Array(n), rareMask = new Uint8Array(n);
  const soft = await sharp(png).flatten({ background: '#808080' }).blur(1.5).raw().toBuffer();
  const pl = await sharp(plate).removeAlpha().blur(1.5).raw().toBuffer({ resolveWithObject: true }), PW = pl.info.width, PH = pl.info.height;
  const sharpPlate = await sharp(plate).removeAlpha().raw().toBuffer();
  let solid = 0, matched = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (px[i * 4 + 3] < 250) continue;
    solid++;
    const X = Math.floor(p.x + (x + 0.5) * p.width / w), Y = Math.floor(p.y + (y + 0.5) * p.height / h);
    let best = 255;
    for (let dy = -R; dy <= R && best > 32; dy++) for (let dx = -R; dx <= R; dx++) {
      const XX = X + dx, YY = Y + dy; if (XX < 0 || YY < 0 || XX >= PW || YY >= PH) continue;
      const q = (YY * PW + XX) * 3;
      const d = Math.min(Math.max(Math.abs(soft[i * 3] - pl.data[q]), Math.abs(soft[i * 3 + 1] - pl.data[q + 1]), Math.abs(soft[i * 3 + 2] - pl.data[q + 2])),
        Math.max(Math.abs(px[i * 4] - sharpPlate[q]), Math.abs(px[i * 4 + 1] - sharpPlate[q + 1]), Math.abs(px[i * 4 + 2] - sharpPlate[q + 2])));
      if (d < best) best = d;
    }
    if (best <= 32) { shared[i] = 1; matched++; }
  }
  if (!matched || matched > solid * 0.3) return { foreign: out, rare: rareMask };
  // The object's own colours: over its solid pixels not shared with the plate.
  const rare = colourRarity(px, n, i => px[i * 4 + 3] >= 250 && !shared[i] && !hidden[i]);
  for (let i = 0; i < n; i++) if (px[i * 4 + 3] >= SOLID && rare(i)) rareMask[i] = 1;
  const label = new Int32Array(n).fill(-1), stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!shared[s] || label[s] >= 0) continue;
    const members: number[] = []; let edge = false, foreignColours = 0; label[s] = s; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i - x) / w; members.push(i); if (rare(i)) foreignColours++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) { edge = true; continue; }
        const j = Y * w + X; if (px[j * 4 + 3] < SOLID) edge = true;
        if (shared[j] && label[j] < 0) { label[j] = s; stack.push(j); }
      }
    }
    if (edge && foreignColours >= members.length / 2) for (const i of members) if (rareMask[i]) out[i] = 1;
  }
  return { foreign: out, rare: rareMask };
}
/**
 * Whether a pixel's colour is not the object's own: fewer than 0.5 % of the counted pixels share its colour (8 levels a
 * channel): the wheel's purple and yellow on a grey refrigerator, a beige backdrop under a white air conditioner. (A
 * smooth gradient spreads thin over many such colours: `placeRegions` also asks for an edge against the object.)
 */
function colourRarity(px: Buffer, n: number, counted: (i: number) => boolean) {
  const bin = (i: number) => (px[i * 4] >> 5) * 64 + (px[i * 4 + 1] >> 5) * 8 + (px[i * 4 + 2] >> 5), own = new Uint32Array(512);
  let total = 0; for (let i = 0; i < n; i++) if (counted(i)) { own[bin(i)]++; total++; }
  return (i: number) => own[bin(i)] < total * 0.005;
}
/** A mask grown by `r` pixels (a square: rows, then columns). */
function grow(mask: Uint8Array, w: number, h: number, r: number) {
  const rows = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const pass = (src: Uint8Array, dst: Uint8Array, lines: number, length: number, at: (l: number, k: number) => number) => {
    for (let l = 0; l < lines; l++) {
      let last = -Infinity;
      for (let k = 0; k < length; k++) { if (src[at(l, k)]) last = k; if (k - last <= r) dst[at(l, k)] = 1; }
      last = Infinity;
      for (let k = length - 1; k >= 0; k--) { if (src[at(l, k)]) last = k; if (last - k <= r) dst[at(l, k)] = 1; }
    }
  };
  pass(mask, rows, h, w, (y, x) => y * w + x); pass(rows, out, w, h, (x, y) => y * w + x);
  return out;
}

/**
 * Defects rebuilt from the object's verified pixels (solid, not a defect), in place: each from the nearest verified
 * pixels along its row and column (two of them, inwards, never across a clear gap), weighted by 1 / distance² — so a
 * long thin hidden strip continues across its short side — and by whether each axis's two sides agree; what no straight
 * line reaches, from its rebuilt neighbours.
 * Its alpha — the outline — is kept; inside it (2 px from any clear pixel) a defect is solid, not a faint see-through seam.
 */
function rebuild(px: Buffer, w: number, h: number, defect: Uint8Array) {
  const n = w * h, ok = (i: number) => !defect[i] && px[i * 4 + 3] >= 250, todo = (i: number) => defect[i] === 1 && px[i * 4 + 3] > 0;
  // Each pixel to rebuild: from each of four sweeps (left, right, up, down) the colour of the nearest two verified pixels
  // before it and how far (stored by direction for those pixels only).
  const slot = new Int32Array(n).fill(-1); let m = 0; for (let i = 0; i < n; i++) if (todo(i)) slot[i] = m++;
  const col = new Float32Array(m * 12), dist = new Int32Array(m * 4);
  const sweep = (dir: number, lines: number, length: number, at: (line: number, k: number) => number) => {
    for (let l = 0; l < lines; l++) {
      let r = 0, g = 0, b = 0, d = -1, prev = -1;
      for (let k = 0; k < length; k++) {
        const i = at(l, k);
        if (!px[i * 4 + 3]) { d = -1; prev = -1; continue; }
        if (ok(i)) {
          const j = prev >= 0 && ok(prev) ? prev : i;
          r = (px[i * 4] + px[j * 4]) / 2; g = (px[i * 4 + 1] + px[j * 4 + 1]) / 2; b = (px[i * 4 + 2] + px[j * 4 + 2]) / 2; d = 0;
        } else if (d >= 0) {
          d++;
          const t = slot[i]; if (t >= 0) { col[t * 12 + dir * 3] = r; col[t * 12 + dir * 3 + 1] = g; col[t * 12 + dir * 3 + 2] = b; dist[t * 4 + dir] = d; }
        }
        prev = i;
      }
    }
  };
  sweep(0, h, w, (y, x) => y * w + x); sweep(1, h, w, (y, x) => y * w + (w - 1 - x));
  sweep(2, w, h, (x, y) => y * w + x); sweep(3, w, h, (x, y) => (h - 1 - y) * w + x);
  // Weighted by 1 / distance²; an axis whose two sides agree (within 30 in every channel) counts 100 times more, one whose
  // sides differ 100 times less: a soundbar's strip under a television's picture continues the wall on its left and right,
  // not the picture above it into the wall below.
  const sum = new Float32Array(n * 3), weight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = slot[i]; if (t < 0) continue;
    const wt = [0, 1, 2, 3].map(k => (dist[t * 4 + k] ? 1 / (dist[t * 4 + k] * dist[t * 4 + k]) : 0));
    for (const [a, b] of [[0, 1], [2, 3]]) {
      if (!wt[a] || !wt[b]) continue;
      let diff = 0; for (let c = 0; c < 3; c++) diff = Math.max(diff, Math.abs(col[t * 12 + a * 3 + c] - col[t * 12 + b * 3 + c]));
      const k = diff <= 30 ? 100 : 0.01; wt[a] *= k; wt[b] *= k;
    }
    for (let k = 0; k < 4; k++) { if (!wt[k]) continue; for (let c = 0; c < 3; c++) sum[i * 3 + c] += col[t * 12 + k * 3 + c] * wt[k]; weight[i] += wt[k]; }
  }
  let rebuilt = 0;
  const done = new Uint8Array(n), left: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!todo(i)) continue;
    if (!weight[i]) { left.push(i); continue; }
    px[i * 4] = Math.round(sum[i * 3] / weight[i]); px[i * 4 + 1] = Math.round(sum[i * 3 + 1] / weight[i]); px[i * 4 + 2] = Math.round(sum[i * 3 + 2] / weight[i]);
    done[i] = 1; rebuilt++;
  }
  for (let pass = 0, rest = left; rest.length && pass < Math.max(w, h); pass++) {
    const next: number[] = [], filled: number[] = [];
    for (const i of rest) {
      const x = i % w, y = (i - x) / w; let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (!done[j] && !ok(j)) continue; r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; c++; }
      if (c) { px[i * 4] = Math.round(r / c); px[i * 4 + 1] = Math.round(g / c); px[i * 4 + 2] = Math.round(b / c); filled.push(i); } else next.push(i);
    }
    if (!filled.length) break;
    for (const i of filled) done[i] = 1;
    rebuilt += filled.length; rest = next;
  }
  // The estimated outline's slivers (a one-pixel spur where the hidden part's edge met the real one) cleared — only in a
  // defect: an opening (3 × 3) of the solid pixels, its removed defect pixels made clear.
  const solid = (i: number) => px[i * 4 + 3] >= SOLID, core = new Uint8Array(n);
  for (let i = 0; i < n; i++) { if (!solid(i)) continue; const x = i % w, y = (i - x) / w; let all = true; for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || !solid(Y * w + X)) { all = false; break; } } if (all) core[i] = 1; }
  const sliver: number[] = [];
  for (let i = 0; i < n; i++) { if (!todo(i) || !solid(i)) continue; const x = i % w, y = (i - x) / w; let kept = false; for (let dy = -1; dy <= 1 && !kept; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && core[Y * w + X]) { kept = true; break; } } if (!kept) sliver.push(i); }
  for (const i of sliver) px[i * 4 + 3] = 0;
  const inside = (i: number) => { const x = i % w, y = (i - x) / w; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || px[(Y * w + X) * 4 + 3] < SOLID) return false; } return true; };
  const solidNow: number[] = []; for (let i = 0; i < n; i++) if (done[i] && px[i * 4 + 3] >= SOLID && px[i * 4 + 3] < 255 && inside(i)) solidNow.push(i);
  for (const i of solidNow) px[i * 4 + 3] = 255;
  return rebuilt;
}

/**
 * The local repair (free): see the top of this file. `defect` (from `cutoutDefects`): what is past the outline cleared,
 * then what is not verified rebuilt. `conservative` (the automatic check after a decomposition): soft edges are left as
 * the decomposition made them — no haze removed, nothing defringed — so a product's soft shadow or rim stays its own.
 */
export async function refineCutout(png: Buffer, defect?: CutoutRepair, options: { conservative?: boolean } = {}): Promise<CutoutRefinement> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), w = info.width, h = info.height, n = w * h, px = Buffer.from(data);
  const repair = repairParts(defect);
  let clearedPixels = 0;
  if (repair?.clear) for (let i = 0; i < n; i++) if (repair.clear[i] && px[i * 4 + 3]) { px[i * 4 + 3] = 0; clearedPixels++; }
  const rebuiltPixels = repair ? rebuild(px, w, h, repair.mask) : 0;
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
  if (!options.conservative) for (let i = 0; i < n; i++) if (!solid[i] && px[i * 4 + 3] > 0 && !near(i)) { px[i * 4 + 3] = 0; removedPixels++; }
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
  for (let i = 0; i < n && !options.conservative; i++) {
    const a = before[i * 4 + 3]; if (a === 0 || a >= 250) continue;
    const c = mean(i, inside); if (!c) continue;
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; defringedPixels++;
  }
  // A clear pixel keeps no colour (a removed wheel's purple in it could bleed back where another program scales it).
  for (let i = 0; i < n; i++) if (!px[i * 4 + 3]) { px[i * 4] = 0; px[i * 4 + 1] = 0; px[i * 4 + 2] = 0; }
  return { png: await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer(), width: w, height: h, removedPixels, filledPixels, defringedPixels, rebuiltPixels, clearedPixels };
}

/** The image model's request for one object (see the top of this file): the instruction, its plain ground, its defects marked. */
export const REFINE_KEY: [number, number, number] = [0, 255, 0];
const MARK: [number, number, number] = [255, 0, 255];
const marked = (r: number, g: number, b: number) => r > 160 && b > 160 && g < 110;
export const refinePrompt = (label: string, defects = false) => [
  `Repair only the damaged or missing parts of this specific object (${label.replace(/\s+/g, ' ').slice(0, 80)}).`,
  ...(defects ? ['The areas painted solid magenta (#FF00FF) are parts of this object that were hidden or damaged: redraw them as its natural continuation — its surfaces, edges, lines, shading and colours — so that no magenta remains.'] : []),
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
/** The request's picture: the cut-out on the plain green ground, where refineCanvas puts it, its defects painted magenta. */
export async function refineRequest(asset: Buffer, defect?: CutoutRepair) {
  const m = await sharp(asset).metadata(), { size, rect } = refineCanvas({ width: m.width ?? 1, height: m.height ?? 1 });
  let source = asset;
  const repair = repairParts(defect);
  if (repair) {
    // (What is past the outline is sent as the plain ground: not the object's.)
    const { data, info } = await sharp(asset).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), px = Buffer.from(data);
    for (let i = 0; i < info.width * info.height; i++) {
      if (repair.clear?.[i]) px[i * 4 + 3] = 0;
      else if (repair.mask[i] && px[i * 4 + 3]) { px[i * 4] = MARK[0]; px[i * 4 + 1] = MARK[1]; px[i * 4 + 2] = MARK[2]; px[i * 4 + 3] = 255; }
    }
    source = await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }
  const placed = await sharp(source).resize(rect.width, rect.height, { fit: 'fill' }).png().toBuffer();
  const image = await sharp({ create: { width: size.width, height: size.height, channels: 4, background: { r: REFINE_KEY[0], g: REFINE_KEY[1], b: REFINE_KEY[2], alpha: 1 } } }).composite([{ input: placed, left: rect.left, top: rect.top }]).png().toBuffer();
  return { image, size, rect };
}
/**
 * The model's answer made a cut-out again at the original's size: its part where the object was placed, the green ground
 * keyed out (soft edge, the green spill taken off), the original's verified pixels put back over it — never its defects:
 * those are the model's, or, where it left them magenta or clear, rebuilt locally (the outline kept) — then the local pass.
 */
export async function refineResult(result: Buffer, original: Buffer, place: Awaited<ReturnType<typeof refineRequest>>, repairWith?: CutoutRepair): Promise<CutoutRefinement & { unrepairedPixels: number }> {
  const m = await sharp(original).metadata(), w = m.width ?? 1, h = m.height ?? 1, repair = repairParts(repairWith), defect = repair?.mask;
  const crop = await sharp(await sharp(result).resize(place.size.width, place.size.height, { fit: 'fill' }).extract(place.rect).png().toBuffer()).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const own = Buffer.from(await sharp(original).ensureAlpha().raw().toBuffer()), out = Buffer.from(crop);
  // (Past the outline: clear in the original too, so nothing of it is put back.)
  if (repair?.clear) for (let i = 0; i < w * h; i++) if (repair.clear[i]) own[i * 4 + 3] = 0;
  const local = defect ? Buffer.from(own) : undefined; if (local) rebuild(local, w, h, defect!);
  let unrepairedPixels = 0;
  for (let i = 0; i < w * h; i++) {
    const r = out[i * 4], g = out[i * 4 + 1], b = out[i * 4 + 2], d = Math.hypot(r - REFINE_KEY[0], g - REFINE_KEY[1], b - REFINE_KEY[2]);
    out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((d - 90) * 255 / 90)));
    if (out[i * 4 + 3] < 255 && g > Math.max(r, b)) out[i * 4 + 1] = Math.max(r, b);
    const a = own[i * 4 + 3];
    if (defect?.[i] && a) {
      // A defect: the model's redrawing, at least as opaque as the outline; left magenta or clear, rebuilt here instead.
      if (marked(r, g, b) || out[i * 4 + 3] < a / 2) { out[i * 4] = local![i * 4]; out[i * 4 + 1] = local![i * 4 + 1]; out[i * 4 + 2] = local![i * 4 + 2]; out[i * 4 + 3] = a; unrepairedPixels++; }
      else out[i * 4 + 3] = Math.max(out[i * 4 + 3], a);
    } else if (a >= 250) { out[i * 4] = own[i * 4]; out[i * 4 + 1] = own[i * 4 + 1]; out[i * 4 + 2] = own[i * 4 + 2]; out[i * 4 + 3] = a; }
    else if (repair?.clear?.[i]) out[i * 4 + 3] = 0;
    // (The original's verified pixels are its own: never the model's redrawing of them.)
  }
  return { ...await refineCutout(await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()), unrepairedPixels };
}
