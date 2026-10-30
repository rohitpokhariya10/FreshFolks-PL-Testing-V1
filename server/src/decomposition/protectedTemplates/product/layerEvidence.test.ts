import { describe, expect, it } from 'vitest';
import { artPieceOf, completionOf, evidenceCutout, explainLayers, type EvidenceInput, type LayerEvidence } from './layerEvidence.js';

const w = 160, h = 120;
const rgba = (fn: (x: number, y: number) => number[] | undefined) => {
  const a = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y); if (c) a.set(c.length === 4 ? c : [...c, 255], (y * w + x) * 4); }
  return a;
};
const rgb = (a: Uint8Array) => Uint8Array.from({ length: w * h * 3 }, (_, i) => a[Math.floor(i / 3) * 4 + i % 3]);
const back = () => [25, 100, 65];
const own = (x: number, y: number) => x >= 20 && x < 110 && y >= 10 && y < 105;
const front = (x: number, y: number) => x >= 85 && x < 135 && y >= 60 && y < 112;
const silver = (x: number, y: number) => x >= 92 && x < 102 && y >= 76 && y < 86 ? [120, 120, 123] : [180 + y % 8, 180 + y % 8, 183 + y % 8];
function scene(copy = false): EvidenceInput {
  const other = (x: number, y: number) => (x + y) % 5 ? [202, 202, 205] : silver(x, y);
  return { w, h, sent: { width: w, height: h }, scenery: [], background: rgb(rgba(back)),
    picture: rgb(rgba((x, y) => front(x, y) ? other(x, y) : own(x, y) ? silver(x, y) : back())),
    layers: [
      { id: 'under', kind: 'product', label: 'Under', z: 1, rgba: rgba((x, y) => own(x, y) ? copy && front(x, y) ? other(x, y) : silver(x, y) : undefined) },
      { id: 'front', kind: 'product', label: 'Front', z: 2, rgba: rgba((x, y) => front(x, y) ? other(x, y) : undefined) },
    ] };
}
const pixel = (e: LayerEvidence, x: number, y: number) => [...e.rgba.slice(((y - e.crop.y) * e.crop.width + x - e.crop.x) * 4, ((y - e.crop.y) * e.crop.width + x - e.crop.x) * 4 + 4)];

describe('layer ownership evidence', () => {
  it('keeps native alpha and completion at an occlusion while retaining authentic interior pixels', () => {
    const s = scene(), e = explainLayers(s).get('under')!;
    const k = (x: number, y: number) => (y - e.crop.y) * e.crop.width + x - e.crop.x;
    // A mixed source boundary must not grow a foreign pixel or replace the provider's soft edge.
    e.registered.set([175, 176, 178, 64], k(20, 40) * 4);
    s.picture.set([255, 0, 220], (40 * w + 20) * 3);
    e.visible[40 * w + 20] = 1;
    // A visible interior adjacent to an ownership boundary must not acquire a provider-colour seam.
    s.picture.set([185, 186, 187], (40 * w + 50) * 3);
    e.visible[40 * w + 49] = 0;
    const c = evidenceCutout(e, s.picture, w)!;
    const at = (x: number, y: number) => x < c.box.x || y < c.box.y || x >= c.box.x + c.box.width || y >= c.box.y + c.box.height ? [0, 0, 0, 0] : [...c.rgba.slice(((y - c.box.y) * c.box.width + x - c.box.x) * 4, ((y - c.box.y) * c.box.width + x - c.box.x) * 4 + 4)];
    expect(at(20, 40)).toEqual([175, 176, 178, 64]);
    expect(at(50, 40)).toEqual([185, 186, 187, 255]);
    expect(at(95, 80)).toEqual(pixel(e, 95, 80));
    // Registration contracts this fixture's original right edge by one pixel.
    expect(at(108, 80)[3]).toBe(255);
    expect(at(109, 80)[3]).toBe(0);
  });
  it('keeps the hidden drawing of similar silver appliances instead of interpolating a coincidental match', () => {
    const e = explainLayers(scene()).get('under')!;
    expect(e.usable).toBe(true); expect(e.hiddenBehind).toContain('Front');
    expect(e.counts.behindLayers).toBeGreaterThan(800);
    // Local colour calibration may shift a channel slightly; the hidden dark feature must survive.
    const actual = pixel(e, 95, 80);
    silver(95, 80).forEach((v, c) => expect(Math.abs(actual[c] - v)).toBeLessThanOrEqual(2));
    expect(actual[3]).toBe(255);
    const c = completionOf(e, w, h)!;
    expect(c.shape[80 * w + 95]).toBe(1); expect(e.visible[80 * w + 95]).toBe(0);
  });
  it('rebuilds a genuinely copied foreground region from the underlying visible pixels', () => {
    const e = explainLayers(scene(true)).get('under')!;
    expect(e.usable).toBe(true); expect(e.counts.behindLayers).toBeGreaterThan(800);
    expect(pixel(e, 96, 80)[0]).toBeLessThan(195);
  });
  it('retains the provider alpha on a hidden soft edge', () => {
    const s = scene(true);
    for (let y = 65; y < 100; y++) s.layers[0].rgba.set([...silver(110, y), 64], (y * w + 110) * 4);
    const e = explainLayers(s).get('under')!, c = completionOf(e, w, h)!;
    const i = (80 - c.box.y) * c.box.width + 110 - c.box.x;
    expect(c.shape[80 * w + 110]).toBe(1); expect(c.alpha[i]).toBe(64);
  });
  it.each(['product', 'character'] as const)('preserves a fully visible colourful %s and does not invent artwork ownership', kind => {
    const colour = (x: number, y: number) => [40 + x, 20 + y, 240 - x];
    const layer = rgba((x, y) => own(x, y) ? colour(x, y) : undefined);
    const s: EvidenceInput = { w, h, sent: { width: w, height: h }, scenery: [], background: rgb(rgba(back)), picture: rgb(rgba((x, y) => own(x, y) ? colour(x, y) : back())), layers: [{ id: 'colour', label: 'Colour', kind, z: 1, rgba: layer }] };
    const e = explainLayers(s).get('colour')!;
    expect(e.usable).toBe(true); expect(e.counts.behindArt).toBe(0); expect(e.counts.behindLayers).toBe(0);
    for (let y = 12; y < 103; y++) for (let x = 22; x < 108; x++) expect(e.visible[y * w + x]).toBe(1);
    expect(artPieceOf(e, s.picture, w)).toBeUndefined();
  });
  it('removes a background panel from a character and retains its own completed arm', () => {
    const panel = (x: number, y: number) => x >= 75 && x < 100 && y >= 15 && y < 70;
    const colour = () => [205, 100, 40];
    const s: EvidenceInput = { w, h, sent: { width: w, height: h }, scenery: [{ label: 'Panel', box: { x: 75, y: 15, width: 25, height: 55 } }],
      background: rgb(rgba((x, y) => panel(x, y) ? [20, 170, 70] : back())),
      picture: rgb(rgba((x, y) => panel(x, y) ? [20, 170, 70] : own(x, y) ? colour() : back())),
      layers: [{ id: 'arm', kind: 'character', label: 'Arm', z: 1, rgba: rgba((x, y) => own(x, y) ? colour() : undefined) }] };
    const e = explainLayers(s).get('arm')!;
    expect(e.usable).toBe(true); expect(e.art?.label).toBe('Panel');
    expect(pixel(e, 85, 40)).toEqual([205, 100, 40, 255]); expect(e.visible[40 * w + 85]).toBe(0);
    const p = artPieceOf(e, s.picture, w)!;
    const i = ((40 - p.box.y) * p.box.width + 85 - p.box.x) * 4;
    expect([...p.rgba.slice(i, i + 4)]).toEqual([20, 170, 70, 255]);
  });
  it('rejects a layer whose detailed pixels cannot register to the source', () => {
    const s = scene();
    s.layers[0].rgba = rgba((x, y) => own(x, y) ? [(x * 37 + y * 71) % 256, (x * 91 + y * 13) % 256, (x * 17 + y * 41) % 256] : undefined);
    const e = explainLayers(s).get('under')!;
    expect(e.usable).toBe(false); expect(e.reasons.join()).toMatch(/matches the picture/);
  });
});
