/**
 * Geometry-locked completion (lockedCompletion.ts) on a drawn appliance: a grey two-door body with a door seam, a handle and
 * a shelf line, its right part hidden (as behind a dishwasher) and filled locally with a flat, lighter estimate. The
 * "models" answer the real request (the crop on the green ground at the request size):
 *
 *   faithful  the true appliance drawn where it was           → accepted; every pixel outside the hole byte for byte,
 *                                                               the alpha (silhouette) unchanged, the hole the truth
 *                                                               (its soft rim the layer's own: no green fringe)
 *   drifted   the appliance drawn 7% narrower (the gpt-image-2 failure on the Navratri refrigerator) → rejected, layer kept
 *   unfilled  the hole left as the green ground                → rejected, layer kept
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { lockedCompletion, lockedRequest } from './lockedCompletion.js';

const W = 120, H = 220, X0 = 10, X1 = 110, Y0 = 8, Y1 = 212;
/** The appliance's true colour at (x, y) of the layer (scale `k` and shift `dx` draw it narrower or moved), or undefined past its outline. */
function truth(x: number, y: number, k = 1, dx = 0): [number, number, number] | undefined {
  const cx = (X0 + X1) / 2, u = (x - cx - dx) / k + cx;
  if (u < X0 || u >= X1 || y < Y0 || y >= Y1) return undefined;
  if (Math.abs(u - 60) < 1) return [40, 40, 44];                       // door seam
  if (u > 84 && u < 88 && y > 60 && y < 150) return [200, 200, 205];   // handle
  if (Math.abs(y - 120) < 1.5) return [70, 70, 76];                    // shelf line
  const v = 120 + Math.round(30 * (u - X0) / (X1 - X0));                // brushed steel, darker to the right
  return [v, v, v + 4];
}
const hidden = (x: number, y: number) => x >= 82 && y >= 100;          // its right part, behind something in front

async function layer() {
  const px = Buffer.alloc(W * H * 4), hole = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = truth(x, y), i = y * W + x; if (!t) continue;
    // The local estimate in the hidden part: flat and lighter (no handle, no shelf line): what the gate compares against.
    const c = hidden(x, y) ? [175, 175, 178] : t;
    px.set([c[0], c[1], c[2], 255], i * 4); if (hidden(x, y)) hole[i] = 1;
  }
  return { png: await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(), px, hole };
}
/** A model's answer to the request: the crop drawn on the green ground at the request size, by `paint`. */
async function answer(req: NonNullable<Awaited<ReturnType<typeof lockedRequest>>>, paint: (x: number, y: number) => [number, number, number] | undefined) {
  const { crop } = req, out = Buffer.alloc(crop.width * crop.height * 3);
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) out.set(paint(x + crop.x, y + crop.y) ?? [0, 255, 0], (y * crop.width + x) * 3);
  return sharp(out, { raw: { width: crop.width, height: crop.height, channels: 3 } }).resize(req.size.width, req.size.height, { fit: 'fill', kernel: 'nearest' }).png().toBuffer();
}

describe.each(['openai', 'flux'] as const)('geometry-locked AI completion (%s)', provider => {
  it('asks only for the hole: a crop round it on the green ground, its proportions kept, a mask open exactly there', async () => {
    const l = await layer(), req = (await lockedRequest(l.png, l.hole, 'Refrigerator', provider))!;
    expect(req.prompt).toContain(provider === 'flux' ? 'white area of the mask; black areas are protected' : 'Edit only the transparent area of the mask');
    expect(Math.abs(req.size.width / req.crop.width - req.size.height / req.crop.height)).toBeLessThan(0.15);
    const mask = await sharp(req.mask).ensureAlpha().extractChannel(provider === 'flux' ? 0 : 3).raw().toBuffer();
    const sx = req.size.width / req.crop.width, sy = req.size.height / req.crop.height;
    const at = (x: number, y: number) => mask[Math.floor((y - req.crop.y + 0.5) * sy) * req.size.width + Math.floor((x - req.crop.x + 0.5) * sx)];
    expect(at(95, 180)).toBe(provider === 'flux' ? 255 : 0);      // hidden: editable
    expect(at(40, 60)).toBe(provider === 'flux' ? 0 : 255);     // verified: kept
    if (provider === 'flux') {
      expect(req.size).toEqual({ width: req.crop.width, height: req.crop.height });
      expect(req.size.width * req.size.height).toBeLessThan(W * H * 2);
      for (let y = 0; y < req.size.height; y++) for (let x = 0; x < req.size.width; x++) {
        const X = x + req.crop.x, Y = y + req.crop.y, expected = X >= 0 && X < W && Y >= 0 && Y < H && l.hole[Y * W + X] ? 255 : 0;
        expect(mask[y * req.size.width + x]).toBe(expected);
      }
      expect(await lockedRequest(l.png, new Uint8Array(W * H).fill(1), 'Refrigerator', provider)).toBeUndefined();
    }
    expect(await lockedRequest(l.png, new Uint8Array(W * H), 'Refrigerator', provider)).toBeUndefined();
  });

  it('accepts a faithful completion: only the hole changes, to the truth; every other pixel and the outline exactly kept', async () => {
    const l = await layer(), req = (await lockedRequest(l.png, l.hole, 'Refrigerator', provider))!;
    const r = await lockedCompletion(await answer(req, (x, y) => truth(x, y)), l.png, req, l.hole);
    expect(r.gate.reasons).toEqual([]);
    expect(r.gate).toMatchObject({ accepted: true, preserved: true, unfilledPixels: 0 });
    const out = await sharp(r.png).ensureAlpha().raw().toBuffer();
    let outside = 0, wrong = 0;
    for (let i = 0; i < W * H; i++) {
      if (!l.hole[i]) { for (let c = 0; c < 4; c++) if (out[i * 4 + c] !== l.px[i * 4 + c]) outside++; continue; }
      expect(out[i * 4 + 3]).toBe(l.px[i * 4 + 3]);
      const x = i % W, y = (i - x) / W, t = truth(x, y)!;
      // (Its soft outline — here the 1 px rim — keeps the layer's own colour: the request blended it with the green ground.)
      if (!truth(x + 1, y) || !truth(x, y + 1) || !truth(x - 1, y) || !truth(x, y - 1)) { for (let c = 0; c < 4; c++) expect(out[i * 4 + c]).toBe(l.px[i * 4 + c]); continue; }
      if (Math.max(...[0, 1, 2].map(c => Math.abs(out[i * 4 + c] - t[c]))) > 12) wrong++;
    }
    expect(outside).toBe(0);
    expect(wrong / l.hole.reduce((s, v) => s + v, 0)).toBeLessThan(0.03);
  });

  it('rejects a drifted drawing (narrower, as the whole-object request was) and keeps the layer unchanged', async () => {
    const l = await layer(), req = (await lockedRequest(l.png, l.hole, 'Refrigerator', provider))!;
    const r = await lockedCompletion(await answer(req, (x, y) => truth(x, y, 0.93, -2)), l.png, req, l.hole);
    expect(r.gate.accepted).toBe(false);
    expect(r.gate.reasons.join(' ')).toMatch(/did not keep the object in place|shifted/);
    expect(r.png.equals(l.png)).toBe(true);
  });

  it('rejects a hole left as the green ground', async () => {
    const l = await layer(), req = (await lockedRequest(l.png, l.hole, 'Refrigerator', provider))!;
    const r = await lockedCompletion(await answer(req, (x, y) => (hidden(x, y) ? undefined : truth(x, y))), l.png, req, l.hole);
    expect(r.gate.accepted).toBe(false);
    expect(r.gate.reasons.join(' ')).toContain('unfilled');
    expect(r.png.equals(l.png)).toBe(true);
  });

  it('rejects a bright fill with a bad seam even when the verified surrounding pixels are correct', async () => {
    const l = await layer(), req = (await lockedRequest(l.png, l.hole, 'Refrigerator', provider))!;
    const r = await lockedCompletion(await answer(req, (x, y) => hidden(x, y) && truth(x, y) ? [250, 250, 250] : truth(x, y)), l.png, req, l.hole);
    expect(r.gate.accepted).toBe(false);
    expect(r.gate.reasons.join(' ')).toMatch(/seam|different tone/);
    expect(r.png.equals(l.png)).toBe(true);
  });

  it('retains soft-edge RGBA exactly even when that edge is inside the repair mask', async () => {
    const l = await layer(), i = (211 * W + 105) * 4;
    l.px.set([143, 143, 147, 128], i);
    l.png = await sharp(l.px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const req = (await lockedRequest(l.png, l.hole, 'Refrigerator', provider))!;
    const r = await lockedCompletion(await answer(req, (x, y) => truth(x, y)), l.png, req, l.hole);
    expect(r.gate.accepted).toBe(true);
    const out = await sharp(r.png).ensureAlpha().raw().toBuffer();
    expect(out.subarray(i, i + 4)).toEqual(l.px.subarray(i, i + 4));
    for (let j = 3; j < out.length; j += 4) expect(out[j]).toBe(l.px[j]);
  });
});
