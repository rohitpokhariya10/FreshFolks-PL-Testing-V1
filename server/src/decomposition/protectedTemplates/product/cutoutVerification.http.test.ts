/**
 * The check after a decomposition through the whole HTTP flow (temporary store; test doubles for the analysis and the
 * decomposition — nothing sent anywhere, nothing charged), on a scene with the defects seen in saved creatives: the
 * backdrop's festive wheel over a refrigerator's corner, which the decomposition put both in the background and in the
 * refrigerator's layer, and a dishwasher in front of the refrigerator. With the option off the flow is as before; on,
 * the refrigerator's layer is checked and repaired, its original kept, and the template, a creative and the editor's run
 * use the repaired layer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ProductCreative, ProtectedTemplate, ProductSnapshot } from '@frameflow/shared';
import { fakeRecognizer } from '../../../textRecognition/recognizer.js';
import type { LayerizedLayer, ProductLayerizer } from './aiDecompose.js';
import { setup } from './productServer.fixture.js';
import { fakeProductAnalyzer } from './productPoster.fixture.js';

const W = 800, H = 600;
type Box = { x: number; y: number; width: number; height: number };
const FRIDGE: Box = { x: 300, y: 120, width: 180, height: 400 }, DISH: Box = { x: 420, y: 330, width: 160, height: 190 };
const inBox = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
const backdrop = [30, 140, 110], door = (y: number) => { const v = Math.round(200 - (y - 120) * 0.15); return [v, v, v + 3]; };
const wheelAt = (x: number, y: number) => { const r = Math.hypot(x - 490, y - 150); return r > 60 ? undefined : r > 54 ? [240, 220, 20] : r > 36 ? [140, 70, 230] : [0, 180, 110]; };
/** The picture: the backdrop, the wheel in front of the refrigerator's corner, the dishwasher in front of the refrigerator. */
const colour = (x: number, y: number) => (inBox(DISH, x, y) ? [222, 222, 226] : wheelAt(x, y) ?? (inBox(FRIDGE, x, y) ? door(y) : backdrop));
const raw = (f: (x: number, y: number) => number[] | undefined) => { const b = Buffer.alloc(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = f(x, y); if (c) b.set([...c, 255], (y * W + x) * 4); } return sharp(b, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(); };
const frac = (b: Box) => ({ x: b.x / W, y: b.y / H, w: b.width / W, h: b.height / H, certainty: 'tight' });
const thing = (id: string, category: string, box: Box) => ({ id, kind: 'product', importance: 'main', category, description: category, box: frac(box), occluded: false, properties: [], identity: { brand: '', model: '', evidence: '', confidence: 0, markings: 'none' }, confidence: 0.95 });
const ANSWER = { summary: 'A refrigerator and a dishwasher in front of it, a festive wheel over the refrigerator.', objects: [thing('product_1', 'refrigerator', FRIDGE), thing('product_2', 'dishwasher', DISH)],
  relations: [{ source: 'product_2', relation: 'in_front_of', target: 'product_1', evidence: 'overlaps it', confidence: 0.9 }], marks: [], text_overlays: [],
  lighting: { direction: 'front', quality: 'soft', color: 'warm' }, main_candidates: ['product_1', 'product_2'], advertised_ids: ['product_1', 'product_2'], uncertainties: [] };

/** TEST DOUBLE for the decomposition, as the real one went wrong: the background keeps the wheel; the refrigerator's
 * layer is all of its box — the wheel's part over it too; the dishwasher's, its box. */
const layerizer: ProductLayerizer = { planner: 'test planner (no network)', engine: 'test decomposer (no network)', offline: true, async decompose(request) {
  const chosen = request.elements.filter(e => e.decompose), k = request.width / W;
  const scaled = async (f: (x: number, y: number) => number[] | undefined) => sharp(await raw(f)).resize(request.width, request.height, { fit: 'fill' }).png().toBuffer();
  const layers: LayerizedLayer[] = [{ png: await scaled((x, y) => wheelAt(x, y) ?? backdrop), zIndex: 0, name: 'Background' }];
  for (const [i, e] of chosen.entries()) {
    const box = { x: e.box.x / k, y: e.box.y / k, width: e.box.width / k, height: e.box.height / k };
    layers.push({ png: await scaled((x, y) => (inBox(box, x, y) ? colour(x, y) : undefined)), zIndex: i + 1, name: e.label });
  }
  const plan = { prompt: 'test', layers: chosen.map(e => ({ element_id: e.id, name: e.label, description: e.kind })), background: 'the rest', warnings: [] };
  return { plan, planner: { model: 'test planner (no network)', offline: true, costUsd: 0 }, seedream: { endpoint: 'test decomposer (no network)', offline: true, layers: layers.length, costUsd: 0, imageSha256: 'test' }, layers };
} };

type View = { template: ProtectedTemplate & { id: string; revision: number }; stage: string; product: ProtectedTemplate['product'] & object };
async function prepared(cutoutVerification: boolean, provider = layerizer) {
  const s = await setup({ analyzer: fakeProductAnalyzer(ANSWER), recognizer: fakeRecognizer([]), layerizer: provider, cutoutVerification });
  const made = await s.form('', await raw(colour), { name: 'Cut-out check' });
  let v = await s.detected(made.body.template.id) as unknown as View;
  v = (await s.send('PUT', `/${v.template.id}/review`, { expectedRevision: v.template.revision, objects: v.product!.objects.map(o => ({ ...o, accepted: true })), texts: [], logos: [], dismissMissingText: true })).body as unknown as View;
  await s.send('POST', `/${v.template.id}/prepare`, { expectedRevision: v.template.revision, engine: 'ai' });
  v = await s.prepared(v.template.id) as unknown as View;
  return { s, v, id: v.template.id };
}
const file = (s: Awaited<ReturnType<typeof setup>>, id: string, f: string) => readFileSync(join(s.protectedDir, id, f));
const colourful = async (png: Buffer) => { const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); let k = 0; for (let i = 0; i < data.length / 4; i++) if (data[i * 4 + 3] >= 128 && Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) - Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) > 40) k++; return k; };

describe('Cut-out check after a decomposition (HTTP)', { timeout: 300000 }, () => {
  it('reports duplicate neighbour pixels when the provider omitted the foreground object', async () => {
    const missing: ProductLayerizer = { ...layerizer, async decompose(req, save) {
      const r = await layerizer.decompose(req, save);
      return { ...r, layers: r.layers.filter(l => !/dishwasher/i.test(l.name ?? '')) };
    } };
    const on = await prepared(true, missing);
    try {
      const c = on.v.product!.objects.find(o => /refrigerator/i.test(o.label))!.cutout!;
      expect(c.evidence!.uncertain).toBe(true); expect(c.quality).toBe('check');
      expect(c.evidence!.reasons.join()).toMatch(/Dishwasher.*separation unresolved/);
      expect(on.v.product!.prepared!.quality.issues.some(i => i.id.startsWith('ownership-'))).toBe(true);
    } finally { await on.s.close(); }
  });
  it('off: the flow as before; on: the refrigerator\'s layer repaired from the same decomposition, the original kept, used downstream', async () => {
    const off = await prepared(false), on = await prepared(true);
    try {
      expect(off.v.stage).toBe('prepared'); expect(on.v.stage).toBe('prepared');
      const objs = (v: View) => v.product!.objects, fr = (v: View) => objs(v).find(o => o.kind === 'product' && /refrigerator/i.test(o.label))!, dw = (v: View) => objs(v).find(o => /dishwasher/i.test(o.label))!;
      expect(dw(on.v).z).toBeGreaterThan(fr(on.v).z);
      // Off: nothing of the check — no report on any layer, no check in the list.
      for (const o of objs(off.v)) { expect(o.cutout?.verification).toBeUndefined(); expect(o.cutout?.evidence).toBeUndefined(); }
      expect(off.v.product!.prepared!.pieces).toBeUndefined();
      expect(off.v.product!.prepared!.quality.issues.map(i => i.id).filter(i => /^(uncertain-|cutouts-verified)/.test(i))).toEqual([]);
      // Evidence is applied before cutout construction. Keep the provider's full RGBA layer as provenance;
      // the OFF cutout is no longer the input to this stage. Even the front object's edge can be corrected.
      const report = fr(on.v).cutout!.evidence!;
      expect(report.registration.agreement).toBeGreaterThan(0.9);
      expect(report.layer).toBeDefined();
      expect(await colourful(file(on.s, on.id, report.layer!.file))).toBeGreaterThan(1000);
      expect(dw(on.v).cutout!.evidence!.behindLayerPixels).toBe(0);
      // On: the wheel in the old layer, none of it in the repaired one; what the dishwasher hides rebuilt; outline the same.
      const before = file(off.s, off.id, fr(off.v).cutout!.file), after = file(on.s, on.id, fr(on.v).cutout!.file);
      expect(await colourful(before)).toBeGreaterThan(1000); expect(await colourful(after)).toBe(0);
      expect(report.behindArtPixels).toBeGreaterThan(1000); expect(report.behindLayerPixels).toBeGreaterThan(10000); expect(report.hiddenBehind.join()).toMatch(/dishwasher/i);
      const sample = async (o: ReturnType<typeof fr>, x: number, y: number) => {
        const c = o.cutout!, { data, info } = await sharp(file(on.s, on.id, c.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const i = ((y - c.placement.y) * info.width + x - c.placement.x) * 4;
        return [...data.subarray(i, i + 4)];
      };
      expect(await sample(fr(on.v), 350, 200)).toEqual([...door(200), 255]);
      expect(await sample(dw(on.v), 500, 400)).toEqual([222, 222, 226, 255]);
      // Completion is the underlying door, not the copied dishwasher's 222 grey.
      expect((await sample(fr(on.v), 450, 400))[0]).toBeLessThan(190);
      const piece = on.v.product!.prepared!.pieces!.find(p => p.id === report.artInFront!.objectId)!;
      expect(piece.piece.over).toBe(fr(on.v).id); expect(piece.z).toBeGreaterThan(fr(on.v).z); expect(piece.z).toBeLessThan(dw(on.v).z);
      expect(await colourful(file(on.s, on.id, piece.cutout!.file))).toBeGreaterThan(1000);
      expect(on.v.product!.prepared!.quality.issues.some(i => i.id === 'art-in-front' && !i.blocking)).toBe(true);
      // Downstream: approved and saved; a creative and the editor's run use the repaired layer.
      const approved = (await on.s.send('POST', `/${on.id}/approve`, { expectedRevision: on.v.template.revision, acknowledge: on.v.product!.prepared!.quality.issues.map(i => i.id) })).body as unknown as View;
      expect((await on.s.send('POST', `/${on.id}/publish`, { expectedRevision: approved.template.revision })).status).toBe(201);
      const saved = (await on.s.call<View>(`/${on.id}`)).body;
      const snapshot = JSON.parse(file(on.s, on.id, saved.product!.revisions.at(-1)!.file).toString()) as ProductSnapshot;
      expect(snapshot.objects.find(o => o.id === piece.id)!.cutout!.sha256).toBe(piece.cutout!.sha256);
      expect(snapshot.objects.find(o => o.id === fr(on.v).id)!.cutout!.evidence).toEqual(report);
      const c = (await on.s.send<ProductCreative>('POST', `/${on.id}/creatives`, { name: 'After the check' })).body;
      expect(c.objects.find(o => o.id === fr(on.v).id)!.asset.file).toBe(fr(on.v).cutout!.file);
      expect(c.objects.find(o => o.id === piece.id)!.asset.file).toBe(piece.cutout!.file);
      const duplicate = (await on.s.send<ProductCreative>('POST', `/${on.id}/creatives/${c.id}/duplicate`, {})).body;
      expect(duplicate.objects.map(o => o.asset)).toEqual(c.objects.map(o => o.asset));
      const run = (await on.s.send<{ runId: string }>('POST', `/${on.id}/creatives/${c.id}/open`, {})).body;
      expect(run.runId).toBeTruthy();
      const editor = JSON.parse(readFileSync(join(on.s.root, 'runs', run.runId, 'run.json'), 'utf8'));
      expect(editor.creative.layers.some((l: { elementIds: string[] }) => l.elementIds.includes(piece.id))).toBe(true);
      expect((await sharp(readFileSync(join(on.s.root, 'runs', run.runId, 'reconstructed.png'))).metadata()).width).toBe(W);
    } finally { await off.s.close(); await on.s.close(); }
  });
});
