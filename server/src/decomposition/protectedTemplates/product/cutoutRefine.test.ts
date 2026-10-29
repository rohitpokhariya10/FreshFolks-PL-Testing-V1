/**
 * Refine Cutout's repairs on a small picture made here (no provider): the free local clean-up of a refrigerator cut-out
 * with a speck, a stray fragment, a pinhole, a real window and a white halo; and an AI repair's answer made a cut-out
 * again — its green ground keyed out, the original's own pixels put back.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { refineCutout, refineRequest, refineResult } from './cutoutRefine.js';

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
