/**
 * What the 9:16 Ganesh ji creative (2026-10-28) exposed, each on a small picture made here (no provider, no private file):
 *
 *   plate      an AI background over the whole product cluster it took out, the stands it took out with them on layers
 *              of their own, a structure it only drew shifted left as the creative has it
 *   logos      boxes given short of a logo's card grown over all of it, two boxes on one card sharing it out
 *   leftovers  a logo's artwork left past its box after the removal: found, by name
 *   words      word boxes cutting their letters made their letters' boxes; a frame's line in a loose box left out
 *   style      a word's colour from its letters, not their soft edges; a bold word in a regular line set bold
 *   divider    a thin rule between two text blocks on a line kept (it is the layout's), a stray mark of the text still taken
 *   plates     Create Offer Creative in the template's own size keeps the plate of a text it leaves in place
 *   lettering  a revision prepared since lettering is editable never has its words hidden or its base restored
 */
import { describe, expect, it } from 'vitest';
import type { CreativeText, ProductCreative, ProductSnapshot, TextAnalysis } from '@frameflow/shared';
import type { Rgba } from '../pixels.js';
import { svgPng, textInkExact, textSvg } from '../../../templateStudio/masterCreatives/render.js';
import { decodeRgba } from '../pixels.js';
import { aiPlate, assertOverlaysGone, fillOverlayPixels, overlayLeftovers, sweepPlainLines } from './prepare.js';
import { growLogosToArtwork, styleLine } from './detect.js';
import { fitWordsToInk } from './wordFit.js';
import { artworkBase, EDITABLE_LETTERING_SINCE } from './artworkText.js';
import { applyPlan, type Structure } from './reuseCompose.js';
import { groupBounds } from './reuseLayout.js';

type Box = { x: number; y: number; width: number; height: number };
type Paint = (x: number, y: number) => [number, number, number];
const picture = (w: number, h: number, paint: Paint): Rgba => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y), i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { data, width: w, height: h };
};
const rgbOf = (p: Rgba) => { const out = new Uint8Array(p.width * p.height * 3); for (let i = 0; i < p.width * p.height; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = p.data[i * 4 + c]; return out; };
const inside = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
const covers = (outer: Box, inner: Box) => outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

describe('decomposition completeness (the 9:16 Ganesh ji regressions)', { timeout: 60_000 }, () => {
  it('replaces the whole cluster the AI took out with its plate, puts the stand on a layer of its own, and leaves a structure it drew shifted alone', () => {
    const w = 300, h = 240, wall: [number, number, number] = [220, 240, 190], gold: [number, number, number] = [200, 140, 40], rule: [number, number, number] = [120, 70, 20];
    const stand: Box = { x: 100, y: 150, width: 100, height: 50 }, product: Box = { x: 120, y: 100, width: 60, height: 60 };
    // The creative: a wall, the podium's rule and front, a pink stand, a product in front of the stand's top.
    const scene = (ruleAt: number, withObjects: boolean): Paint => (x, y) => {
      if (withObjects && inside(product, x, y)) return [30, 30, 30];
      if (withObjects && inside(stand, x, y)) return [240, 190, 180];
      if (y >= ruleAt && y < ruleAt + 3) return rule;
      return y >= 200 ? gold : wall;
    };
    const clean = rgbOf(picture(w, h, scene(194, true))), plate = rgbOf(picture(w, h, scene(196, false)));
    const mask = new Uint8Array(w * h), hole = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (inside(product, x, y)) mask[y * w + x] = 1; if (inside({ x: product.x - 1, y: product.y - 1, width: product.width + 2, height: product.height + 2 }, x, y)) hole[y * w + x] = 1; }
    const r = aiPlate(clean, { rgb: plate, alpha: new Uint8Array(w * h).fill(255) }, w, h, hole, [{ kind: 'product', box: product, mask }], []);
    // Everything of the product is the plate's; the stand is one stand layer (its seen part), and the plate is under it.
    for (let i = 0; i < w * h; i++) if (mask[i]) expect(r.region[i]).toBe(1);
    expect(r.stands).toHaveLength(1);
    const seen = r.stands[0];
    expect(seen.length).toBeGreaterThan(stand.width * stand.height * 0.8 - product.width * 11);
    expect(seen.every(i => inside(stand, i % w, Math.floor(i / w)) && !hole[i])).toBe(true);
    expect(seen.every(i => r.region[i] === 1)).toBe(true);
    // The podium's rule, drawn two pixels lower by the AI, is no stand and not replaced away from the stand.
    for (const x of [20, 60, 250, 280]) for (let y = 192; y < 200; y++) expect(r.region[y * w + x]).toBe(0);
  });

  it('continues a subtle panel gradient through removed letters instead of leaving flat letter silhouettes', () => {
    const w = 100, h = 60;
    const background = rgbOf(picture(w, h, (x, y) => [180 + Math.floor(y / 3), 200 + Math.floor(x / 5), 190]));
    const source = Uint8Array.from(background), mask = new Uint8Array(w * h);
    for (let y = 15; y < 45; y++) for (const x of [30, 31, 32, 60, 61, 62]) {
      mask[y * w + x] = 1;
      source.fill(255, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
    const filled = fillOverlayPixels(source, w, h, mask, [{ id: 'text', box: { x: 25, y: 10, width: 45, height: 40 }, plate: true }]).rgb;
    for (let i = 0; i < mask.length; i++) for (let c = 0; c < 3; c++) {
      expect(Math.abs(filled[i * 3 + c] - background[i * 3 + c])).toBeLessThanOrEqual(mask[i] ? 1 : 0);
    }
  });

  it('samples past a padded mask without accepting lettering that is still present', () => {
    const w = 120, h = 80, box = { x: 30, y: 25, width: 60, height: 30 };
    const clean = rgbOf(picture(w, h, () => [10, 160, 90]));
    const source = rgbOf(picture(w, h, (x, y) => inside({ x: 40, y: 30, width: 10, height: 20 }, x, y) ? [255, 255, 255] : [10, 160, 90]));
    const mask = new Uint8Array(w * h);
    for (let y = 15; y < 65; y++) for (let x = 20; x < 100; x++) mask[y * w + x] = 1;
    expect(() => assertOverlaysGone(source, clean, mask, w, [{ id: 'text', box }])).not.toThrow();
    expect(() => assertOverlaysGone(source, source, mask, w, [{ id: 'text', box }])).toThrow(/still in the picture/);
  });

  it('grows logo boxes given short of their card over all of it, two boxes on one card sharing it out, and leaves a fitted one alone', () => {
    const card: Box = { x: 100, y: 60, width: 160, height: 40 }, blue: Box = { x: 185, y: 72, width: 66, height: 20 }, lone: Box = { x: 330, y: 140, width: 40, height: 30 };
    const src = picture(400, 200, (x, y) => (inside(blue, x, y) ? [20, 60, 140] : inside(card, x, y) ? (inside({ x: 115, y: 70, width: 45, height: 20 }, x, y) ? [255, 255, 255] : [200, 80, 30]) : inside(lone, x, y) ? [30, 30, 30] : [255, 255, 255]));
    const [a, b, c] = growLogosToArtwork(src, [{ x: 110, y: 64, width: 60, height: 32 }, { ...blue }, { ...lone }]);
    const union = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) };
    expect(covers(union, card)).toBe(true);
    expect(a.x).toBeLessThanOrEqual(card.x);
    expect(b.x + b.width).toBeGreaterThanOrEqual(card.x + card.width);
    expect(covers(b, blue)).toBe(true);
    expect(Math.abs(c.x - lone.x) + Math.abs(c.y - lone.y) + Math.abs(c.width - lone.width) + Math.abs(c.height - lone.height)).toBeLessThanOrEqual(4);
  });

  it('finds a logo whose artwork is left in the clean picture just past its box', () => {
    const box: Box = { x: 112, y: 60, width: 60, height: 40 };
    const left = rgbOf(picture(300, 160, (x, y) => (x >= 100 && x < 110 && y >= 60 && y < 100 ? [200, 80, 30] : [255, 255, 255])));
    expect(overlayLeftovers(left, 300, 160, [{ id: 'pl-1', label: 'scapia logo', box }]).map(l => l.id)).toEqual(['pl-1']);
    const none = rgbOf(picture(300, 160, () => [255, 255, 255]));
    expect(overlayLeftovers(none, 300, 160, [{ id: 'pl-1', label: 'scapia logo', box }])).toEqual([]);
  });

  it('makes word boxes their letters’ boxes: a cut letter and a descender taken in, a frame line in a loose box left out', () => {
    const letterA: Box = { x: 40, y: 20, width: 20, height: 40 }, g: Box = { x: 80, y: 30, width: 20, height: 30 }, tail: Box = { x: 94, y: 60, width: 6, height: 12 };
    const src = picture(200, 100, (x, y) => (inside(letterA, x, y) || inside(g, x, y) || inside(tail, x, y) || x === 30 || x === 31 ? [255, 255, 255] : [20, 180, 110]));
    const [a, gg] = fitWordsToInk(src, [
      { text: 'A', group: 'g', line: 'l', box: { x: 28, y: 20, width: 24, height: 40 } },
      { text: 'g', group: 'g', line: 'l', box: { x: 80, y: 30, width: 20, height: 30 } },
    ]);
    expect(a.box).toMatchObject({ x: 39, y: 19, width: 22, height: 42 });
    expect(gg.box.y + gg.box.height).toBeGreaterThanOrEqual(72);
  });

  it('styles a word by its letters: white on green when its box was cut, and a bold word in a regular line bold', async () => {
    const style = (fontWeight: 400 | 700, color: string) => ({ fontFamily: 'Poppins', fontMatch: 'estimated', fontSize: 50, fontWeight, fontStyle: 'normal', color, opacity: 1, lineHeight: 1.2, letterSpacing: 0, align: 'left' }) as unknown as CreativeText['style'];
    const words: { text: string; weight: 400 | 700 }[] = [{ text: 'Get', weight: 400 }, { text: '26%', weight: 700 }, { text: 'cashback', weight: 400 }];
    let x = 20; const texts: CreativeText[] = [];
    for (const [k, word] of words.entries()) { const t = { id: `t${k}`, wordId: `w${k}`, groupId: 'g', line: 0, order: k, text: word.text, x, baselineY: 70, rotation: 0, style: style(word.weight, '#0b2b2e'), hidden: false, locked: false, z: k } as CreativeText; texts.push(t); x += textInkExact(t)!.width + 18; }
    const png = await svgPng(400, 100, `<rect width="400" height="100" fill="#e4f2c4"/>${texts.map(t => textSvg(t)).join('')}`);
    const src = await decodeRgba(png);
    const styled = await styleLine(src, texts.map(t => { const ink = textInkExact(t)!; return { text: t.text, box: { x: Math.floor(ink.x) - 1, y: Math.floor(ink.y) - 1, width: Math.ceil(ink.width) + 2, height: Math.ceil(ink.height) + 2 } }; }));
    expect(styled.map(s => s.style.fontWeight)).toEqual([400, 700, 400]);
    // White letters on green, the box cutting through the last letter: the colour is the letters', not their mint edge.
    const white = { id: 'a', wordId: 'a', groupId: 'g', line: 0, order: 0, text: 'grand', x: 20, baselineY: 70, rotation: 0, style: style(700, '#ffffff'), hidden: false, locked: false, z: 0 } as CreativeText;
    const greenPng = await svgPng(300, 100, `<rect width="300" height="100" fill="#14b46e"/>${textSvg(white)}`), green = await decodeRgba(greenPng), ink = textInkExact(white)!;
    const cut = { x: Math.floor(ink.x), y: Math.floor(ink.y) + 4, width: Math.floor(ink.width) - 12, height: Math.floor(ink.height) - 10 };
    const [fitted] = fitWordsToInk(green, [{ text: 'grand', group: 'g', line: 'l', box: cut }]);
    const [s] = await styleLine(green, [{ text: 'grand', box: fitted.box }]);
    const [r, gc, b] = [1, 3, 5].map(k => parseInt(s.style.color.slice(k, k + 2), 16));
    expect(Math.min(r, gc, b)).toBeGreaterThan(225);
  });

  it('keeps a divider rule between two text blocks of a line in the picture, and still takes a stray mark of the text', () => {
    const w = 260, h = 120, ink: [number, number, number] = [16, 42, 46];
    const first: Box = { x: 40, y: 50, width: 30, height: 30 }, second: Box = { x: 110, y: 48, width: 80, height: 34 }, bar: Box = { x: 86, y: 40, width: 2, height: 52 }, dot: Box = { x: 72, y: 74, width: 3, height: 5 };
    const src = picture(w, h, (x, y) => (inside(first, x, y) || inside(second, x, y) || inside(bar, x, y) || inside(dot, x, y) ? ink : [252, 252, 252]));
    const word = (id: string, text: string, box: Box, order: number) => ({ id, text, box: { ...box, rotation: 0 }, source: { box: { ...box, rotation: 0 }, crop: '', z: order }, groupId: 'pg-1', lineId: 'pn-1', elementId: 'pe-1', order, origin: 'ai', review: { status: 'approved' }, style: { color: '#102a2e' } });
    const analysis = { words: [word('w1', '12', first, 0), word('w2', '(HDFC', second, 1)], groups: [{ id: 'pg-1', lines: [{ id: 'pn-1', wordIds: ['w1', 'w2'] }] }], logoSlots: [], plates: [] } as unknown as TextAnalysis;
    const mask = new Uint8Array(w * h);
    for (const b of [first, second]) for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) mask[y * w + x] = 1;
    sweepPlainLines(src, analysis, mask);
    for (let y = bar.y; y < bar.y + bar.height; y++) expect(mask[y * w + bar.x]).toBe(0);
    expect(mask[(dot.y + 2) * w + dot.x + 1]).toBe(1);
  });

  it('keeps the plate of a text left in its place by Create Offer Creative (its own size): the validity pill, a line’s divider', async () => {
    const c = { schemaVersion: 1, id: 'pc-000001', templateId: 'pt-000000000001', templateRevision: 1, name: 'x', createdAt: '', updatedAt: '', revision: 1, canvas: { width: 1000, height: 1000 },
      groups: [{ id: 'pg-0000000001', label: 'Validity: Till 30th', category: 'legal', masterGroupId: null, align: 'center' }],
      texts: [{ id: 't1', wordId: 'w1', groupId: 'pg-0000000001', line: 0, order: 0, text: 'Validity', x: 400, baselineY: 900, rotation: 0, style: { fontFamily: 'Poppins', fontMatch: 'estimated', fontSize: 30, fontWeight: 600, fontStyle: 'normal', color: '#ffffff', opacity: 1, lineHeight: 1.2, letterSpacing: 0, align: 'left' }, hidden: false, locked: false, z: 0 }],
      images: [], shapes: [], objects: [], origin: { kind: 'template' }, history: [] } as unknown as ProductCreative;
    const before = groupBounds(c, 'pg-0000000001')!, plate = { x: before.x - 20, y: before.y - 10, width: before.width + 40, height: before.height + 20 };
    const st: Structure = { source: { width: 1000, height: 1000 }, art: { top: 150, bottom: 850 }, head: null, foot: null, keep: [],
      free: [{ key: 'g:pg-0000000001', kind: 'text', zone: 'foot', label: 'Validity', box: before, order: 0, align: 'center' }],
      pieces: [{ id: 'pp-0000000001', file: 'pcp-000000000001.png', sha256: '', box: plate, width: plate.width, height: plate.height, owner: 'g:pg-0000000001', label: 'Plate · Validity' }] };
    const { creative } = await applyPlan({ has: () => true, read: () => Buffer.alloc(0), write: () => undefined }, c, st, { ratio: '1:1', canvas: { width: 1000, height: 1000 }, layout: 'stacked', art: { x: 0, y: 150, scale: 1 }, boxes: { 'g:pg-0000000001': before }, excluded: [] });
    const shown = creative.objects.find(o => o.label === 'Plate · Validity');
    expect(shown?.hidden).toBe(false);
    expect(shown?.box).toMatchObject({ x: Math.round(plate.x), y: Math.round(plate.y), width: Math.round(plate.width), height: Math.round(plate.height) });
  });

  it('never hides a word or restores lettering into the base of a revision prepared since lettering is editable', async () => {
    const files = { has: () => true, read: () => { throw new Error('nothing is read'); }, write: () => { throw new Error('nothing is written'); } };
    const snapshot = { prepareVersion: EDITABLE_LETTERING_SINCE, source: { file: 'source.png' }, base: { file: 'base.png', sha256: '' }, canvas: { width: 100, height: 100 }, objects: [], backgroundStructure: [], words: [] } as unknown as ProductSnapshot;
    expect(await artworkBase(files, snapshot)).toBeUndefined();
  });
});
