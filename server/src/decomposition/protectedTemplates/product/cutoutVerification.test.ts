/**
 * The check after a decomposition (cutoutVerification.ts) on small scenes made here — each a picture, its background
 * plate (the decomposition's picture without its objects) and the cut-outs as a decomposition saved them, with the
 * defects seen in saved creatives: a neighbour's pixels or a grey block where a product was hidden, the backdrop's
 * decoration over a corner, the backdrop under a product, a soundbar in a television's layer. Nothing is sent anywhere.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ProductObjectKind } from '@frameflow/shared';
import { verifyProductCutouts, type StageCutout } from './cutoutVerification.js';

type Rgb = [number, number, number];
type Box = { x: number; y: number; width: number; height: number };
const W = 320, H = 240;
const inBox = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
const png = (data: Buffer, w: number, h: number, ch: 3 | 4) => sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
const canvas = (f: (x: number, y: number) => Rgb) => { const b = Buffer.alloc(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.set(f(x, y), (y * W + x) * 3); return png(b, W, H, 3); };
/** A layer at `box`: f gives its colour at a picture position, or undefined where it is clear. */
const layer = (box: Box, f: (X: number, Y: number) => Rgb | undefined) => { const b = Buffer.alloc(box.width * box.height * 4); for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) { const c = f(box.x + x, box.y + y); if (c) b.set([...c, 255], (y * box.width + x) * 4); } return png(b, box.width, box.height, 4); };
const cut = (id: string, kind: ProductObjectKind, z: number, box: Box, data: Promise<Buffer>, method = 'seedream') => data.then(p => ({ id, kind, label: id, z, png: p, placement: box, method }) as StageCutout);
const rgba = async (p: Buffer) => sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const px = (r: { data: Buffer; info: { width: number } }, x: number, y: number) => [...r.data.subarray((y * r.info.width + x) * 4, (y * r.info.width + x) * 4 + 4)];
const spread = (c: number[]) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
const wall: Rgb = [40, 150, 100], door = (Y: number): Rgb => { const v = Math.round(190 - Y * 0.3); return [v, v, v + 3]; };

describe('Cut-out check after a decomposition', { timeout: 120000 }, () => {
  it('A: leaves a fully visible product as it is; clears a decoration attached past its outline', async () => {
    const tv: Box = { x: 40, y: 40, width: 120, height: 80 }, garland: Box = { x: 160, y: 60, width: 30, height: 40 }, bigBox: Box = { x: 40, y: 40, width: 150, height: 80 };
    // A television: a dark bezel round a picture (a natural gradient of warm and cool colours).
    const screen = (X: number, Y: number): Rgb => (X < 44 || Y < 44 || X >= 156 || Y >= 116 ? [18, 18, 20] : [Math.round(60 + (X - 44) * 1.6), Math.round(40 + (Y - 44) * 2), Math.round(220 - (X - 44) * 1.2)]);
    const picture = await canvas((x, y) => (inBox(tv, x, y) ? screen(x, y) : inBox(garland, x, y) ? [250, 120, 20] : wall));
    const plate = await canvas((x, y) => (inBox(garland, x, y) ? [246, 124, 24] : wall));
    const clean = await cut('Speaker', 'product', 2, { x: 220, y: 140, width: 60, height: 80 }, layer({ x: 220, y: 140, width: 60, height: 80 }, () => [30, 30, 34]));
    const tvCut = await cut('Television', 'product', 1, bigBox, layer(bigBox, (X, Y) => (inBox(tv, X, Y) ? screen(X, Y) : inBox(garland, X, Y) ? [250, 120, 20] : undefined)));
    const out = await verifyProductCutouts({ picture, plate, cutouts: [clean, tvCut] });
    expect(out.get('Speaker')!.changed).toBe(false); expect(out.get('Speaker')!.report.uncertain).toBe(false);
    const v = out.get('Television')!, after = await rgba(v.png), before = await rgba(tvCut.png);
    expect(v.report.clearedPixels).toBeGreaterThan(30 * 40 * 0.9);
    expect(px(after, 135, 40)[3]).toBe(0);                                        // the garland: gone
    for (let y = 0; y < 80; y += 4) for (let x = 0; x < 116; x += 4) expect(px(after, x, y)).toEqual(px(before, x, y)); // the screen: exactly its own
  });

  it('B: a refrigerator behind a dishwasher — the grey block and the dishwasher\'s side wall rebuilt as its door; verified pixels and outline kept', async () => {
    const fridge: Box = { x: 60, y: 20, width: 100, height: 200 }, dish: Box = { x: 130, y: 120, width: 80, height: 100 };
    const picture = await canvas((x, y) => (inBox(dish, x, y) ? [215, 215, 220] : x >= 126 && x < 130 && y >= 120 ? [190, 190, 192] : inBox(fridge, x, y) ? door(y) : wall));
    const plate = await canvas(() => wall);
    const fr = await cut('Refrigerator', 'product', 1, fridge, layer(fridge, (X, Y) => (X >= 130 && Y >= 120 ? [200, 200, 205] : X >= 126 && Y >= 120 ? [190, 190, 192] : door(Y))));
    const dw = await cut('Dishwasher', 'product', 2, dish, layer(dish, () => [215, 215, 220]));
    const out = await verifyProductCutouts({ picture, plate, cutouts: [fr, dw] }), v = out.get('Refrigerator')!, after = await rgba(v.png), before = await rgba(fr.png);
    expect(v.report.hiddenBehind).toEqual(['Dishwasher']); expect(v.report.hiddenPixels).toBe(30 * 100);
    for (const [x, y] of [[85, 160], [95, 190], [68, 130]]) expect(Math.abs(px(after, x, y)[0] - door(20 + y)[0])).toBeLessThanOrEqual(6);
    for (let i = 0; i < 100 * 200; i++) expect(after.data[i * 4 + 3]).toBe(before.data[i * 4 + 3]);
    expect(px(after, 20, 50)).toEqual(px(before, 20, 50));
    expect(out.get('Dishwasher')!.changed).toBe(false);
  });

  it('C: the backdrop\'s wheel over a refrigerator\'s corner rebuilt as the door — no piece of it left', async () => {
    const fridge: Box = { x: 60, y: 20, width: 100, height: 200 }, wheel = (x: number, y: number) => Math.hypot(x - 170, y - 30) < 40;
    const colour = (x: number, y: number): Rgb => { const r = Math.hypot(x - 170, y - 30); return r > 36 ? [240, 220, 20] : r > 24 ? [140, 70, 230] : [0, 180, 110]; };
    const picture = await canvas((x, y) => (wheel(x, y) ? colour(x, y) : inBox(fridge, x, y) ? door(y) : wall));
    const plate = await canvas((x, y) => (wheel(x, y) ? colour(x + 1, y).map(v => Math.min(255, v + 6)) as Rgb : wall));
    const fr = await cut('Refrigerator', 'product', 1, fridge, layer(fridge, (X, Y) => (wheel(X, Y) ? colour(X, Y) : door(Y))));
    const v = (await verifyProductCutouts({ picture, plate, cutouts: [fr] })).get('Refrigerator')!, after = await rgba(v.png);
    expect(v.report.backgroundPixels).toBeGreaterThan(500);
    for (let i = 0; i < 100 * 200; i++) if (after.data[i * 4 + 3] >= 128) expect(spread([...after.data.subarray(i * 4, i * 4 + 3)])).toBeLessThanOrEqual(12);
    expect(Math.abs(px(after, 95, 8)[0] - door(28)[0])).toBeLessThanOrEqual(8); expect(px(after, 95, 8)[3]).toBe(255);
  });

  it('D: a television behind a soundbar — its strip continues the wall beside it, never the picture above; the soundbar is untouched', async () => {
    const tv: Box = { x: 40, y: 20, width: 240, height: 180 }, screen: Box = { x: 50, y: 30, width: 220, height: 110 }, bar: Box = { x: 90, y: 145, width: 140, height: 14 };
    const panel: Rgb = [236, 236, 236], pic = (x: number, y: number): Rgb => [(x * 9) % 256, 60 + ((y * 3) % 150), 200 - (x % 90)];
    const picture = await canvas((x, y) => (inBox(bar, x, y) ? [20, 20, 22] : inBox(screen, x, y) ? pic(x, y) : inBox(tv, x, y) ? panel : wall));
    const plate = await canvas(() => wall);
    const t = await cut('Television', 'product', 1, tv, layer(tv, (X, Y) => (inBox(bar, X, Y) ? [20, 20, 22] : inBox(screen, X, Y) ? pic(X, Y) : panel)));
    const s = await cut('Soundbar', 'product', 2, bar, layer(bar, () => [20, 20, 22]));
    const out = await verifyProductCutouts({ picture, plate, cutouts: [t, s] }), after = await rgba(out.get('Television')!.png);
    // Where the soundbar was: the panel's white, not the soundbar's black, not the picture's colours.
    for (const X of [100, 160, 220]) for (const Y of [146, 152, 158]) { const c = px(after, X - tv.x, Y - tv.y); expect(Math.min(c[0], c[1], c[2])).toBeGreaterThan(215); }
    expect(out.get('Soundbar')!.changed).toBe(false);
  });

  it('a colourful product on a busy backdrop is left exactly as it is', async () => {
    const sp: Box = { x: 100, y: 40, width: 90, height: 160 }, stripes = (x: number, y: number): Rgb => [[230, 40, 60], [40, 200, 90], [250, 210, 30], [60, 80, 230]][Math.floor((x + y) / 12) % 4] as Rgb;
    const backdrop = (x: number, y: number): Rgb => [[200, 60, 160], [30, 160, 200], [240, 140, 40]][Math.floor((x * 2 + y) / 20) % 3] as Rgb;
    const picture = await canvas((x, y) => (inBox(sp, x, y) ? stripes(x, y) : backdrop(x, y))), plate = await canvas(backdrop);
    const c = await cut('Party speaker', 'product', 1, sp, layer(sp, stripes));
    const v = (await verifyProductCutouts({ picture, plate, cutouts: [c] })).get('Party speaker')!;
    expect(v.changed).toBe(false); expect(v.report.clearedPixels + v.report.rebuiltPixels).toBe(0); expect(v.png.equals(c.png)).toBe(true);
  });

  it('keeps a thin light rim against a light wall; clears the backdrop the decomposition put under a product behind a speaker', async () => {
    const light: Rgb = [232, 236, 228], body: Box = { x: 80, y: 40, width: 120, height: 100 }, rim = (x: number, y: number) => inBox({ x: 80, y: 40, width: 120, height: 100 }, x, y) && !inBox({ x: 82, y: 42, width: 116, height: 96 }, x, y);
    const picture = await canvas((x, y) => (rim(x, y) ? [226, 230, 224] : inBox(body, x, y) ? [24, 24, 26] : light)), plate = await canvas(() => light);
    const p = await cut('Water purifier', 'product', 1, body, layer(body, (X, Y) => (rim(X, Y) ? [226, 230, 224] : [24, 24, 26])));
    const vp = (await verifyProductCutouts({ picture, plate, cutouts: [p] })).get('Water purifier')!;
    expect(vp.report.clearedPixels + vp.report.rebuiltPixels).toBe(0); expect(vp.report.keptEdgePixels).toBeGreaterThan(0);
    // An air conditioner whose layer runs down into the backdrop, part of it behind a speaker, estimated in a mauve.
    const ac: Box = { x: 20, y: 20, width: 260, height: 100 }, unit: Box = { x: 20, y: 20, width: 260, height: 75 }, spk: Box = { x: 200, y: 100, width: 60, height: 110 }, beige: Rgb = [228, 206, 192];
    const pic2 = await canvas((x, y) => (inBox(spk, x, y) ? [30, 30, 30] : inBox(unit, x, y) ? [240, 240, 238] : beige)), plate2 = await canvas(() => beige);
    const a = await cut('Air conditioner', 'product', 1, ac, layer(ac, (X, Y) => (inBox(unit, X, Y) ? [240, 240, 238] : inBox(spk, X, Y) ? [160, 146, 145] : beige)));
    const s = await cut('Speaker', 'product', 2, spk, layer(spk, () => [30, 30, 30]));
    const va = (await verifyProductCutouts({ picture: pic2, plate: plate2, cutouts: [a, s] })).get('Air conditioner')!, after = await rgba(va.png);
    expect(px(after, 100, 92)[3]).toBe(0); expect(px(after, 210, 92)[3]).toBe(0);    // the backdrop, and the mauve behind the speaker
    expect(px(after, 100, 30)).toEqual([240, 240, 238, 255]);                       // the unit itself
  });

  it('never cuts a television hidden behind a soundbar as wide as it; flags a large estimate; leaves characters and known layers alone', async () => {
    const tv: Box = { x: 40, y: 20, width: 240, height: 180 }, bar: Box = { x: 40, y: 120, width: 240, height: 80 }, panel: Rgb = [70, 70, 76];
    const picture = await canvas((x, y) => (inBox(bar, x, y) ? [20, 20, 22] : inBox(tv, x, y) ? panel : wall)), plate = await canvas(() => wall);
    // The decomposition continued the television's own colour behind the soundbar.
    const t = await cut('Television', 'product', 1, tv, layer(tv, () => panel));
    const s = await cut('Soundbar', 'product', 2, bar, layer(bar, () => [20, 20, 22]));
    const ch = await cut('Mascot', 'character', 3, { x: 10, y: 10, width: 30, height: 30 }, layer({ x: 10, y: 10, width: 30, height: 30 }, () => [250, 0, 250]));
    const known = await cut('Phone', 'product', 4, { x: 0, y: 200, width: 30, height: 30 }, layer({ x: 0, y: 200, width: 30, height: 30 }, () => [250, 0, 250]), 'layer');
    const out = await verifyProductCutouts({ picture, plate, cutouts: [t, s, ch, known] }), v = out.get('Television')!, after = await rgba(v.png);
    for (let i = 0; i < 240 * 180; i++) expect(after.data[i * 4 + 3]).toBe(255);   // all of it still there
    expect(v.report.uncertain).toBe(true); expect(v.report.reasons.join(' ')).toMatch(/44% of it, hidden behind Soundbar, lies past its visible outline: left as decomposed/);
    expect(out.has('Mascot')).toBe(false); expect(out.has('Phone')).toBe(false);
  });
});
