/**
 * What the 16:9 Ganesh ji creative with one replacement product (2026-10-29) exposed, each on a small case made here (no
 * provider, no private file):
 *
 *   stands    the stand layers of template products that left their places are abandoned (not drawn); a stand still
 *             holding a product, or one that held none in the template, stays
 *   logos     a reviewed logo box ending inside its artwork (IDFC FIRST's "CREDIT CARDS") finished to its last letter,
 *             in a grid of partner logos a few pixels apart; a box on a card, or one beside another box, left as it is
 *   prompt    the regeneration is a faithful adaptation: the shape, the same design, nothing added, no element kind named
 *   copy      words read in the result that the original (or its known copy) does not have are flagged as possibly invented
 *   restore   a first-time master's logo, redrawn by the model, cut again from the upload's own pixels
 */
import { describe, expect, it } from 'vitest';
import type { ProductSnapshot } from '@frameflow/shared';
import type { Rgba } from '../pixels.js';
import { abandonedStands } from './reuseStudio.js';
import { finishClippedLogoBoxes } from './detect.js';
import sharp from 'sharp';
import type { RecognizedWord, WordRecognizer } from '../../../textRecognition/recognizer.js';
import { protectRegenerated, regenerationPrompt, restoreLogosFromOriginal } from './ratioRegeneration.js';

type Box = { x: number; y: number; width: number; height: number };
const picture = (w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Rgba => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y), i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { data, width: w, height: h };
};
const inBox = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;

describe('ratio adaptation (the 16:9 Ganesh ji regressions)', () => {
  // The 9:16 creative's display, simplified: a TV on a wide riser, a refrigerator on its own cylinder, a washing machine
  // on a third, and a decorative pedestal nothing stood on.
  const cut = { file: 'x.png' };
  const snapshot = { canvas: { width: 1152, height: 2048 }, objects: [
    { id: 'tv', kind: 'product', label: 'Television', box: { x: 557, y: 894, width: 269, height: 169 }, cutout: cut },
    { id: 'fridge', kind: 'product', label: 'Refrigerator', box: { x: 941, y: 816, width: 143, height: 324 }, cutout: cut },
    { id: 'washer', kind: 'product', label: 'Washing machine', box: { x: 818, y: 977, width: 118, height: 165 }, cutout: cut },
    { id: 's-tv', kind: 'podium', label: 'Stand under the Television', box: { x: 586, y: 1067, width: 342, height: 151 }, cutout: cut },
    { id: 's-fridge', kind: 'podium', label: 'Stand under the Refrigerator', box: { x: 915, y: 1138, width: 132, height: 70 }, cutout: cut },
    { id: 's-washer', kind: 'podium', label: 'Stand under the Washing machine', box: { x: 831, y: 1141, width: 107, height: 58 }, cutout: cut },
    { id: 'pedestal', kind: 'podium', label: 'Display stand', box: { x: 60, y: 1300, width: 80, height: 90 }, cutout: cut },
    // The shared podium is in the background (no cut-out): never a stand of this rule.
    { id: 'podium', kind: 'podium', label: 'Ornate product podium', box: { x: 6, y: 1126, width: 1134, height: 313 } },
  ] } as unknown as ProductSnapshot;

  it('leaves out the stands of the products that left their places, keeps those still holding one and those that held none', () => {
    // One replacement in the TV's place: the refrigerator's and washing machine's stands are abandoned.
    expect([...abandonedStands(snapshot, new Set(['tv']))].sort()).toEqual(['s-fridge', 's-washer']);
    // Every product kept: nothing abandoned. None kept: every stand that held a product, never the empty pedestal.
    expect(abandonedStands(snapshot, new Set(['tv', 'fridge', 'washer'])).size).toBe(0);
    expect([...abandonedStands(snapshot, new Set())].sort()).toEqual(['s-fridge', 's-tv', 's-washer']);
  });

  it('finishes a reviewed logo box that stops inside its small lettering, in a dense grid of partner logos', () => {
    const red: [number, number, number] = [160, 20, 40], ink: [number, number, number] = [40, 40, 40], white: [number, number, number] = [250, 250, 250];
    // A red card, then "CREDIT CARDS" as two small ink lines 6 px right of it ending at x 246; the reviewed box stops at
    // 241. Another row of logos 4 px below, a neighbour card 12 px to the left.
    const card: Box = { x: 100, y: 40, width: 120, height: 30 }, words = [{ x: 226, y: 46, width: 20, height: 6 }, { x: 226, y: 58, width: 20, height: 6 }];
    const below: Box = { x: 60, y: 84, width: 220, height: 24 }, neighbour: Box = { x: 40, y: 40, width: 48, height: 30 };
    const src = picture(320, 140, (x, y) => (inBox(card, x, y) || inBox(below, x, y) || inBox(neighbour, x, y) ? red : words.some(w => inBox(w, x, y)) ? ink : white));
    const reviewed: Box = { x: 98, y: 38, width: 143, height: 34 };
    const [idfc, under, left] = finishClippedLogoBoxes(src, [reviewed, { x: 58, y: 82, width: 224, height: 28 }, { x: 38, y: 38, width: 52, height: 34 }]);
    // Grown to the end of the lettering (and one pixel for its soft edge), nowhere else.
    expect(idfc.x + idfc.width).toBe(247);
    expect([idfc.x, idfc.y, idfc.height]).toEqual([reviewed.x, reviewed.y, reviewed.height]);
    // Boxes already round their artwork are unchanged.
    expect(under).toEqual({ x: 58, y: 82, width: 224, height: 28 }); expect(left).toEqual({ x: 38, y: 38, width: 52, height: 34 });
    // A box cut through a long band (artwork going on past the reach) is left as reviewed, not grown along it.
    const band = picture(400, 100, (_x, y) => (y >= 40 && y < 60 ? red : white));
    expect(finishClippedLogoBoxes(band, [{ x: 30, y: 36, width: 60, height: 28 }])[0]).toEqual({ x: 30, y: 36, width: 60, height: 28 });
    // Never into another box: a box beside another, their artwork touching, stays as it is.
    const pair = picture(300, 100, (x, y) => (y >= 40 && y < 60 && x >= 40 && x < 200 ? red : white));
    const [a, b] = finishClippedLogoBoxes(pair, [{ x: 38, y: 36, width: 80, height: 28 }, { x: 118, y: 36, width: 84, height: 28 }]);
    expect(a).toEqual({ x: 38, y: 36, width: 80, height: 28 }); expect(b).toEqual({ x: 118, y: 36, width: 84, height: 28 });
  });

  it('asks the image model for a faithful adaptation: the shape, the same design, nothing added, no element kind it may not have', () => {
    const p = regenerationPrompt('16:9', ['Get 26% cashback up to ₹26,000'], ['Refrigerator', 'Refrigerator']);
    expect(p).toMatch(/wide landscape 16:9 canvas, keeping the same design/); expect(p).toMatch(/aspect-ratio adaptation, not a redesign/);
    expect(p).toMatch(/Do not add any text, offer, price, date, logo, brand name, QR code, product, person, character, decoration or prop that is not in it/);
    expect(p).toContain('Keep the products (Refrigerator) exactly as they are');
    expect(p).toContain('"Get 26% cashback up to ₹26,000"');
    // Nothing that would invite a creative without them to get partner logos, terms, a hero product or empty-stand rules.
    for (const p2 of [p, regenerationPrompt('9:16'), regenerationPrompt('4:5'), regenerationPrompt('1:1')]) expect(p2).not.toMatch(/partner|bank|terms|validity|hero|stand|podium|side by side|rows/i);
  });

  it('flags words read in the result that neither the original nor its known copy has', async () => {
    const [original, result] = await Promise.all([1, 2].map(n => sharp({ create: { width: 40 + n, height: 40, channels: 3, background: '#fff' } }).png().toBuffer()));
    const said = (texts: string[]): RecognizedWord[] => texts.map(text => ({ text, confidence: 0.95, box: { x0: 0, y0: 0, x1: 1, y1: 1 } }) as RecognizedWord);
    const recognizer: WordRecognizer = { engine: { name: 'test', version: '1', model: 'test', modes: [] }, recognize: async ({ image }) => said(image.equals(original) ? ['Grand', 'savings', 'Validity'] : ['Grand', 'savings', 'Validlty', 'Validity', 'September', 'FREE', 'GIFT']) };
    const { checks } = await protectRegenerated({ original, result, recognizer, knownWords: ['Till 30th September 2026'] });
    // "Validlty" is a misreading (one letter off), "September" is in the known copy; FREE GIFT were never in the creative.
    expect(checks.extraWords).toEqual(['free', 'gift']); expect(checks.missingWords).toEqual([]); expect(checks.blocking).toEqual([]);
  });

  it('cuts a first-time master’s logo, redrawn by the model, again from the upload’s own pixels', async () => {
    // The upload: a purple logo with fine white lettering on a page; the regenerated creative is half the size and drew
    // the lettering wrong (its lines where the upload's are, other letters: other lengths and gaps).
    const logo = (bars: string) => `<rect x="0" y="0" width="200" height="80" fill="#5b2a86"/><circle cx="40" cy="40" r="26" fill="#f2a900"/>${bars}`;
    const exact = '<rect x="80" y="18" width="100" height="10" fill="#fff"/><rect x="80" y="36" width="70" height="8" fill="#fff"/><rect x="80" y="52" width="90" height="8" fill="#fff"/>';
    const upload = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#f4f1e8"/><g transform="translate(600 820)">${logo(exact)}</g></svg>`)).png().toBuffer();
    const drawn = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 200 80">${logo('<rect x="80" y="18" width="40" height="10" fill="#fff"/><rect x="128" y="18" width="40" height="10" fill="#fff"/><rect x="80" y="36" width="82" height="8" fill="#fff"/><rect x="80" y="52" width="60" height="8" fill="#fff"/>')}</svg>`)).png().toBuffer();
    const [r] = await restoreLogosFromOriginal({ original: upload, regenerated: { width: 500, height: 500 }, logos: [{ id: 'pl-au', png: drawn }] });
    expect(r.status).toBe('restored');
    // The restored crop is the upload's lettering at the crop's size: its first line unbroken (the drawing has a gap at
    // x 60–64), its second line as long as the upload's (white at x 72, purple at x 80 — the drawing's runs to x 81).
    const px = await sharp(r.png!).raw().toBuffer({ resolveWithObject: true }), at = (x: number, y: number) => px.data[(y * px.info.width + x) * px.info.channels];
    expect([px.info.width, px.info.height]).toEqual([100, 40]);
    expect(at(62, 11)).toBeGreaterThan(200); expect(at(72, 20)).toBeGreaterThan(200); expect(at(79, 20)).toBeLessThan(150);
    // On another backdrop than the upload's (the LG logo on the upload's white, the 9:16 creative's mint): kept as drawn,
    // never cut with the upload's backdrop as a plate.
    const onMint = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="-20 -20 240 120"><rect x="-20" y="-20" width="240" height="120" fill="#b9ead8"/>${logo(exact)}</svg>`)).png().toBuffer();
    const page = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#ffffff"/><g transform="translate(600 820)">${logo(exact)}</g></svg>`)).png().toBuffer();
    expect((await restoreLogosFromOriginal({ original: page, regenerated: { width: 500, height: 500 }, logos: [{ id: 'lg', png: onMint }] }))[0].status).toBe('not-found');
    // A logo the upload does not have is kept as drawn.
    const other = await sharp({ create: { width: 100, height: 40, channels: 3, background: '#0a8f3c' } }).png().toBuffer();
    expect((await restoreLogosFromOriginal({ original: upload, regenerated: { width: 500, height: 500 }, logos: [{ id: 'x', png: other }] }))[0].status).toBe('not-found');
  });
});
