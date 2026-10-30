/**
 * Refine Cutout's repairs on a small picture made here (no provider): the free local clean-up of a refrigerator cut-out
 * with a speck, a stray fragment, a pinhole, a real window and a white halo; and an AI repair's answer made a cut-out
 * again — its green ground keyed out, the original's own pixels put back.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cutoutDefects, refineCutout, refineRequest, refineResult } from './cutoutRefine.js';

type Box = { x: number; y: number; width: number; height: number };
const inBox = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
const W = 200, H = 300, body: Box = { x: 40, y: 20, width: 120, height: 260 }, handle: Box = { x: 160, y: 80, width: 2, height: 90 };
const speck: Box = { x: 5, y: 5, width: 3, height: 3 }, sliver: Box = { x: 180, y: 250, width: 4, height: 6 }, pinhole: Box = { x: 90, y: 200, width: 2, height: 2 }, window: Box = { x: 70, y: 40, width: 40, height: 60 };
/** A grey refrigerator (with a 2 px handle and a glass window) and its defects: a speck, a sliver, a pinhole, a soft white rim. */
async function fridge() {
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, part = (inBox(body, x, y) && !inBox(window, x, y) && !inBox(pinhole, x, y)) || inBox(handle, x, y), junk = inBox(speck, x, y) || inBox(sliver, x, y);
    const rim = !part && !junk && x >= body.x - 1 && x < body.x + body.width + 1 && y >= body.y - 1 && y < body.y + body.height + 1 && !inBox(window, x, y);
    if (part) { px[i] = 120; px[i + 1] = 124; px[i + 2] = 130; px[i + 3] = 255; }
    else if (junk) { px[i] = 240; px[i + 1] = 240; px[i + 2] = 240; px[i + 3] = 255; }
    else if (rim) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 120; }
  }
  return sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}
const pixels = async (png: Buffer) => sharp(png).ensureAlpha().raw().toBuffer();

describe('Refine Cutout', { timeout: 60000 }, () => {
  it('cleans locally: specks and fragments gone, pinhole filled, halo defringed — the handle, the window and every solid pixel kept', async () => {
    const before = await fridge(), r = await refineCutout(before), a = await pixels(before), b = await pixels(r.png), at = (p: Buffer, x: number, y: number) => p.subarray((y * W + x) * 4, (y * W + x) * 4 + 4);
    expect([r.width, r.height]).toEqual([W, H]);
    // Removed: the speck and the stray sliver.
    expect(at(b, 6, 6)[3]).toBe(0); expect(at(b, 181, 252)[3]).toBe(0);
    // Filled: the pinhole, in the fridge's own grey. Kept open: the glass window (a real opening).
    expect([...at(b, 90, 200)]).toEqual([120, 124, 130, 255]); expect(at(b, 90, 70)[3]).toBe(0);
    // Kept: the 2 px handle, and every solid pixel of the fridge exactly as it was (nothing eroded).
    expect([...at(b, 161, 120)]).toEqual([120, 124, 130, 255]);
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) if (inBox(body, x, y) && !inBox(window, x, y) && !inBox(pinhole, x, y)) expect([...at(b, x, y)]).toEqual([...at(a, x, y)]);
    // Defringed: the soft rim keeps its alpha and takes the fridge's colour instead of the white background.
    expect(at(b, body.x - 1, 150)[3]).toBe(120); expect(at(b, body.x - 1, 150)[0]).toBeLessThan(140);
    expect(r.removedPixels).toBeGreaterThan(0); expect(r.filledPixels).toBe(4); expect(r.defringedPixels).toBeGreaterThan(0);
  });

  it('makes an AI repair a cut-out again: the green ground keyed out, the original\'s solid pixels its own, the completed part kept', async () => {
    // The original is missing its lower part (a bad cut); the "model" returns it complete, slightly recoloured, on green.
    const whole = await fridge(), raw = await pixels(whole);
    for (let y = 220; y < H; y++) for (let x = 0; x < W; x++) raw[(y * W + x) * 4 + 3] = 0;
    const cut = await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const place = await refineRequest(cut);
    expect(place.size).toEqual({ width: 1024, height: 1536 });
    const answer = await sharp({ create: { width: place.size.width, height: place.size.height, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .composite([{ input: await sharp(await sharp(whole).flatten({ background: '#00ff00' }).modulate({ brightness: 1.05 }).png().toBuffer()).resize(place.rect.width, place.rect.height, { fit: 'fill' }).png().toBuffer(), left: place.rect.left, top: place.rect.top }]).png().toBuffer();
    const r = await refineResult(answer, cut, place), b = await pixels(r.png), o = await pixels(cut), at = (p: Buffer, x: number, y: number) => p.subarray((y * W + x) * 4, (y * W + x) * 4 + 4);
    expect([r.width, r.height]).toEqual([W, H]);
    // The green ground is clear; the original's own solid pixels are exactly its own (not the model's brighter redraw).
    expect(at(b, 10, 150)[3]).toBe(0); expect([...at(b, 100, 150)]).toEqual([...at(o, 100, 150)]);
    // The missing lower part is there now (from the repair), opaque.
    expect(at(b, 100, 250)[3]).toBeGreaterThan(200);
  });
});

/**
 * The defect seen in a real creative: a refrigerator whose lower-right corner stood behind a dishwasher, its cut-out
 * holding a flat grey block there (and the dishwasher's side wall, which the dishwasher's own cut-out missed, as a lighter
 * seam). Picture 240 × 200; the refrigerator at (40, 20), 120 × 170: a door shaded from top to bottom, a dark divider at
 * y 150; the dishwasher in front from (130, 110), its side wall at x 126–129 in the picture but not in its cut-out.
 */
describe('Refine Cutout: what a front layer hid is rebuilt, never trusted', { timeout: 60000 }, () => {
  const PW = 240, PH = 200, FX = 40, FY = 20, FW = 120, FH = 170, DX = 130, DY = 110, DW = 70, DH = 80;
  const door = (X: number, Y: number) => { const v = Y >= 150 && Y < 153 ? 40 : Math.round(200 - (Y - FY) * 0.6) - (X === 100 ? 120 : 0); return [v, v, v + 2]; };
  const dish = (Y: number) => (Y >= 180 && Y < 185 ? [120, 120, 125] : [215, 215, 220]);
  const raw = (w: number, h: number, ch: number, f: (x: number, y: number) => number[]) => { const b = Buffer.alloc(w * h * ch); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(f(x, y), (y * w + x) * ch); return b; };
  const png = (b: Buffer, w: number, h: number, ch: 3 | 4) => sharp(b, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
  const inFridge = (X: number, Y: number) => X >= FX && X < FX + FW && Y >= FY && Y < FY + FH;
  /** The picture: the refrigerator, the dishwasher (and its side wall) before it, a green wall behind. */
  const picture = () => png(raw(PW, PH, 3, (X, Y) => X >= DX && Y >= DY && X < DX + DW && Y < DY + DH ? dish(Y) : X >= 126 && X < DX && Y >= DY && Y < DY + DH ? [190, 190, 192] : inFridge(X, Y) ? door(X, Y) : [40, 140, 70]), PW, PH, 3);
  /** The refrigerator's cut-out as it was saved: the picture where it showed, a flat grey block where the dishwasher stood. */
  const saved = (truth = false) => png(raw(FW, FH, 4, (x, y) => { const X = FX + x, Y = FY + y, hidden = X >= DX && Y >= DY; return [...(truth ? door(X, Y) : hidden ? [200, 200, 205] : X >= 126 && Y >= DY ? [190, 190, 192] : door(X, Y)), 255]; }), FW, FH, 4);
  const dishwasher = () => png(raw(DW, DH, 4, (_x, y) => [...dish(DY + y), 255]), DW, DH, 4);
  const context = async () => ({ picture: await picture(), placement: { x: FX, y: FY, width: FW, height: FH }, front: [{ png: await dishwasher(), placement: { x: DX, y: DY, width: DW, height: DH } }] });
  const rgba = async (p: Buffer) => sharp(p).ensureAlpha().raw().toBuffer(), at = (p: Buffer, x: number, y: number) => [...p.subarray((y * FW + x) * 4, (y * FW + x) * 4 + 4)];

  it('marks what the dishwasher hid (with the seam beside it) and nothing the picture verifies; the free rebuild continues the door', async () => {
    const cut = await saved(), d = await cutoutDefects(cut, await context());
    // Hidden: 30 columns × 80 rows; the mask adds its margin (the side-wall seam at x 86–89 inside it).
    expect(d.hiddenPixels).toBe(30 * 80); expect(d.compared).toBe(true);
    expect(d.mask[120 * FW + 100]).toBe(1); expect(d.mask[120 * FW + 87]).toBe(1);
    expect(d.mask[120 * FW + 60]).toBe(0); expect(d.mask[60 * FW + 100]).toBe(0);
    const r = await refineCutout(cut, d.mask), a = await rgba(cut), b = await rgba(r.png);
    expect([r.width, r.height]).toEqual([FW, FH]); expect(r.rebuiltPixels).toBe(d.count);
    // The grey block is the door now: its shading at that height, the divider carried through; the seam gone.
    const shade = (y: number) => Math.round(200 - y * 0.6);
    expect(Math.abs(at(b, 100, 140)[0] - shade(140))).toBeLessThanOrEqual(6);
    expect(Math.abs(at(b, 110, 160)[0] - shade(160))).toBeLessThanOrEqual(6);
    expect(at(b, 110, 131)[0]).toBeLessThan(80);
    expect(Math.abs(at(b, 87, 120)[0] - shade(120))).toBeLessThanOrEqual(6);
    // Verified pixels exactly as they were; the outline (every alpha) the same.
    for (let y = 0; y < FH; y += 2) for (let x = 0; x < FW; x += 2) { if (!d.mask[y * FW + x]) expect(at(b, x, y)).toEqual(at(a, x, y)); expect(at(b, x, y)[3]).toBe(at(a, x, y)[3]); }
  });

  it('an AI repair keeps what it redrew where the defect was — the old restore pasted the grey block back — and its leftovers are rebuilt here', async () => {
    const cut = await saved(), d = await cutoutDefects(cut, await context()), place = await refineRequest(cut, d.mask);
    // The request shows the defect in magenta.
    const sent = await sharp(place.image).raw().toBuffer(), sx = place.rect.left + Math.round(100.5 * place.rect.width / FW), sy = place.rect.top + Math.round(140.5 * place.rect.height / FH);
    expect([...sent.subarray((sy * place.size.width + sx) * 4, (sy * place.size.width + sx) * 4 + 3)]).toEqual([255, 0, 255]);
    // A model that redraws the door: its picture of the corner is kept; verified pixels stay the original's own.
    const onGreen = async (p: Buffer) => sharp({ create: { width: place.size.width, height: place.size.height, channels: 3, background: { r: 0, g: 255, b: 0 } } }).composite([{ input: await sharp(p).resize(place.rect.width, place.rect.height, { fit: 'fill' }).png().toBuffer(), left: place.rect.left, top: place.rect.top }]).png().toBuffer();
    const answer = await onGreen(await saved(true)), fixed = await rgba((await refineResult(answer, cut, place, d.mask)).png);
    expect(Math.abs(at(fixed, 100, 140)[0] - Math.round(200 - 140 * 0.6))).toBeLessThanOrEqual(10);
    expect(at(fixed, 30, 40)).toEqual(at(await rgba(cut), 30, 40));
    // (Without the defect mask — the earlier restore — every solid original pixel went back: the grey block returned.)
    expect(at(await rgba((await refineResult(answer, cut, place)).png), 100, 140).slice(0, 3)).toEqual([200, 200, 205]);
    // A model that left the magenta: those pixels are rebuilt here instead, and counted.
    const lazy = await refineResult(place.image, cut, place, d.mask), l = await rgba(lazy.png);
    expect(lazy.unrepairedPixels).toBeGreaterThan(30 * 80 * 0.9);
    expect(Math.abs(at(l, 100, 140)[0] - Math.round(200 - 140 * 0.6))).toBeLessThanOrEqual(6); expect(at(l, 100, 140)[1]).toBeGreaterThan(60);
  });
});

/**
 * The second defect seen in a real creative: the backdrop's festive wheel (purple, green, yellow) in front of the
 * refrigerator's top-right corner, cut out with it — while the background plate holds the wheel too, so it moved with the
 * refrigerator as a copy; and three pixels of the green backdrop in a notch at the top of the door gap. Picture 240 × 200;
 * the refrigerator at (40, 20), 120 × 170, a grey door with a dark gap at x 100; the wheel centred at (165, 30), r 34 (its left part in the layer), the notch at layer x 59–61.
 */
describe('Refine Cutout: the background plate\'s own content in a product layer is rebuilt as the product', { timeout: 60000 }, () => {
  const PW = 240, PH = 200, FX = 40, FY = 20, FW = 120, FH = 170, CX = 165, CY = 30, RAD = 34;
  const raw = (w: number, h: number, ch: number, f: (x: number, y: number) => number[]) => { const b = Buffer.alloc(w * h * ch); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(f(x, y), (y * w + x) * ch); return b; };
  const png = (b: Buffer, w: number, h: number, ch: 3 | 4) => sharp(b, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
  const door = (X: number, Y: number) => { const v = Math.round(200 - (Y - FY) * 0.5) - (X === 100 ? 110 : 0); return [v, v, v + 2]; };
  /** The wheel: a yellow ring, a purple band, a green middle (shifted by `d` px and lifted by `lift` — the plate's redraw). */
  const wheel = (X: number, Y: number, d = 0, lift = 0) => { const r = Math.hypot(X - CX - d, Y - CY); return r > RAD ? undefined : (r > RAD - 4 ? [240, 220, 20] : r > RAD - 14 ? [140, 70, 230] : [0, 180, 110]).map(v => Math.min(255, v + lift)); };
  const backdrop = [10, 170, 115], speck = (x: number, y: number) => x >= 59 && x < 62 && y >= 1 && y < 4;
  const plateOf = (wall?: number[]) => png(raw(PW, PH, 3, (X, Y) => wheel(X, Y, 1, 8) ?? wall ?? backdrop), PW, PH, 3);
  /** The refrigerator's saved cut-out: its door, the wheel over its corner, the backdrop in the notch (row 0 of the notch clear). */
  const saved = () => png(raw(FW, FH, 4, (x, y) => { const X = FX + x, Y = FY + y; if (speck(x, y)) return [...backdrop, 255]; if (x >= 59 && x < 62 && y === 0) return [0, 0, 0, 0]; return [...(wheel(X, Y) ?? door(X, Y)), 255]; }), FW, FH, 4);
  const picture = () => png(raw(PW, PH, 3, (X, Y) => wheel(X, Y) ?? (X >= FX && X < FX + FW && Y >= FY && Y < FY + FH ? door(X, Y) : backdrop)), PW, PH, 3);
  const rgba = async (p: Buffer) => sharp(p).ensureAlpha().raw().toBuffer(), at = (p: Buffer, x: number, y: number) => [...p.subarray((y * FW + x) * 4, (y * FW + x) * 4 + 4)];
  const context = async (plate: Buffer) => ({ picture: await picture(), placement: { x: FX, y: FY, width: FW, height: FH }, front: [], plate });

  it('marks the wheel and the backdrop speck — not the door — and rebuilds them as the door; the outline is kept', async () => {
    const cut = await saved(), d = await cutoutDefects(cut, await context(await plateOf()));
    expect(d.hiddenPixels).toBe(0); expect(d.foreignPixels).toBeGreaterThan(500);
    // The wheel's ring, band and middle; the speck; never the door far from them.
    for (const [x, y] of [[110, 10], [100, 10], [93, 10], [60, 2]]) expect(d.mask[y * FW + x]).toBe(1);
    for (const [x, y] of [[20, 60], [60, 120], [110, 160], [40, 30]]) expect(d.mask[y * FW + x]).toBe(0);
    const r = await refineCutout(cut, d.mask), a = await rgba(cut), b = await rgba(r.png);
    // No purple, green or yellow left: every solid pixel grey (its channels within 12 of each other).
    for (let i = 0; i < FW * FH; i++) if (b[i * 4 + 3] >= 128) expect(Math.max(b[i * 4], b[i * 4 + 1], b[i * 4 + 2]) - Math.min(b[i * 4], b[i * 4 + 1], b[i * 4 + 2])).toBeLessThanOrEqual(12);
    // The corner is the door at that height; the gap carries on to the top; the outline (every alpha) is as it was.
    expect(Math.abs(at(b, 110, 10)[0] - Math.round(200 - 10 * 0.5))).toBeLessThanOrEqual(8);
    for (let i = 0; i < FW * FH; i++) expect(b[i * 4 + 3]).toBe(a[i * 4 + 3]);
    for (let y = 0; y < FH; y += 3) for (let x = 0; x < FW; x += 3) if (!d.mask[y * FW + x]) expect(at(b, x, y)).toEqual(at(a, x, y));
  });

  it('never marks a grey door against a grey wall the plate continued behind it', async () => {
    // The plate behind the refrigerator: a grey close to its door (no wheel, no backdrop): nothing of the door is foreign.
    const wall = await png(raw(PW, PH, 3, (X, Y) => (X >= FX && X < FX + FW && Y >= FY && Y < FY + FH ? door(X, Y).map(v => v + 6) : backdrop)), PW, PH, 3);
    const door1 = await png(raw(FW, FH, 4, (x, y) => [...door(FX + x, FY + y), 255]), FW, FH, 4);
    const d = await cutoutDefects(door1, { picture: await png(raw(PW, PH, 3, (X, Y) => (X >= FX && X < FX + FW && Y >= FY && Y < FY + FH ? door(X, Y) : backdrop)), PW, PH, 3), placement: { x: FX, y: FY, width: FW, height: FH }, front: [], plate: wall });
    expect(d.foreignPixels).toBe(0); expect(d.count).toBe(0);
  });
});
