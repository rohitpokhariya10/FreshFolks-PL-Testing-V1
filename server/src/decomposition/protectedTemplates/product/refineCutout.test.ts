/**
 * Refine Cutout over HTTP (temporary store, a counting test double for the image model — no network, nothing charged):
 * one object layer of a creative repaired, nothing else touched, every paid request approved first.
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProductCreative } from '@frameflow/shared';
import type { CutoutRepairProvider } from './fluxFillRepair.js';
import { setup, savedTemplate } from './productServer.fixture.js';
import { productPosterPng } from './productPoster.fixture.js';

let calls = 0, failing = false, distorted = false, wrongSize = false;
/** TEST DOUBLE: answers with the picture it was sent (the object on its green ground), or fails like a dropped connection. */
const repairProvider: CutoutRepairProvider = { model: 'test image model (no network)', offline: false, async repair({ image, size }) {
  calls++;
  if (failing) throw new Error('terminated (UND_ERR_SOCKET: other side closed)');
  return { image: distorted ? await sharp({ create: { width: size.width, height: size.height, channels: 3, background: '#00ff00' } }).png().toBuffer() : await sharp(image).resize(wrongSize ? 64 : size.width, wrongSize ? 64 : size.height, { fit: 'fill' }).png().toBuffer(), requestId: 'test' };
} };
type Refined = { before: string; file: string; requests: number; costUsd?: number; estimateUsd?: number; model?: string };

describe('Refine Cutout (HTTP, test double)', { timeout: 180000 }, () => {
  it('cleans for free, repairs with AI only once approved, keeps the layer on a failure, and replaces only that layer', async () => {
    calls = 0; failing = distorted = wrongSize = false;
    const unrelated = { model: 'GPT resizing must not be used', offline: false, async regenerate(): Promise<never> { throw new Error('Repair called the resizing provider'); } };
    const s = await setup({ repairProvider, regenerator: unrelated });
    try {
      const saved = await savedTemplate(s, await productPosterPng()), id = saved.template.id;
      // The ordinary fixture is intact. Damage a small screen patch in this temporary cutout only, so the unchanged
      // source picture supplies real defect evidence; no uncontrolled whole-object request is needed by this test.
      const target = saved.product.objects.find(o => o.label === 'Television')!, file = join(s.protectedDir, id, target.cutout!.file);
      const { data, info: meta } = await sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = 30; y < 60; y++) for (let x = 50; x < 80; x++) data.set([120, 120, 120, 255], (y * meta.width + x) * 4);
      writeFileSync(file, await sharp(data, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toBuffer());
      const c0 = (await s.send<ProductCreative>('POST', `/${id}/creatives`, { name: 'Refine test' })).body, cid = c0.id;
      const fridge = c0.objects.find(o => o.kind === 'product')!, base = `/${id}/creatives/${cid}/objects/${fridge.id}/refine`;
      // Free clean-up: a picture to compare, no request, the creative unchanged.
      const local = (await s.send<Refined>('POST', `${base}/local`, {})).body;
      expect(local.requests).toBe(0); expect(calls).toBe(0); expect(local.before).toBe(fridge.asset.file); expect(local.file).toMatch(new RegExp(`^pcr-${cid.slice(3)}-`));
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}`)).body.revision).toBe(c0.revision);
      // AI repair: its provider, model, size and estimate first; refused without approval, nothing sent.
      const info = (await s.call<{ available: boolean; model: string; size: { width: number; height: number }; estimateUsd: number }>(base)).body;
      expect(info).toMatchObject({ available: true, model: 'test image model (no network)' }); expect(info.estimateUsd).toBe(Math.ceil(info.size.width * info.size.height / 1_000_000) * 0.05);
      expect((await s.send<{ error: { code: string } }>('POST', `${base}/ai`, {})).body.error.code).toBe('APPROVAL_REQUIRED'); expect(calls).toBe(0);
      // A failed request: reported, nothing retried, the layer and the creative as they were.
      failing = true;
      const failed = (await s.send<{ error: { code: string; message: string } }>('POST', `${base}/ai`, { approveUsd: info.estimateUsd })).body.error;
      expect(failed.code).toBe('PROVIDER_FAILED'); expect(failed.message).toMatch(/terminated .* Nothing was retried/); expect(calls).toBe(1);
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}`)).body).toEqual(c0);
      // Approved: exactly one request, its cost recorded; still nothing changed until applied.
      failing = false;
      const ai = (await s.send<Refined>('POST', `${base}/ai`, { approveUsd: info.estimateUsd })).body;
      expect(ai).toMatchObject({ requests: 1, model: 'test image model (no network)' }); expect(calls).toBe(2);
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}`)).body.revision).toBe(c0.revision);
      // Geometry failures are inspectable, never applicable; the original revision remains current.
      distorted = true;
      const rejected = (await s.send<Refined & { rejected: boolean }>('POST', `${base}/ai`, { approveUsd: info.estimateUsd })).body;
      expect(rejected.rejected).toBe(true); expect(rejected.file).toMatch(/^pcx-/);
      expect((await s.send<{ error: { code: string } }>('POST', `${base}/apply`, { expectedRevision: c0.revision, file: rejected.file, approved: true })).body.error.code).toBe('INVALID_REQUEST');
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}`)).body).toEqual(c0);
      distorted = false; wrongSize = true;
      expect((await s.send<{ error: { code: string } }>('POST', `${base}/ai`, { approveUsd: info.estimateUsd })).body.error.code).toBe('PROVIDER_FAILED');
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}`)).body).toEqual(c0);
      wrongSize = false;
      // Applied only when looked at: a new revision in which only this object's picture differs.
      expect((await s.send<{ error: { code: string } }>('POST', `${base}/apply`, { expectedRevision: c0.revision, file: ai.file })).body.error.code).toBe('APPROVAL_REQUIRED');
      const c1 = (await s.send<ProductCreative>('POST', `${base}/apply`, { expectedRevision: c0.revision, file: ai.file, approved: true })).body;
      expect(c1.revision).toBe(c0.revision + 1);
      expect(c1.objects.find(o => o.id === fridge.id)!.asset.file).toBe(ai.file); expect(c1.objects.find(o => o.id === fridge.id)!.box).toEqual(fridge.box);
      expect(c1.objects.filter(o => o.id !== fridge.id)).toEqual(c0.objects.filter(o => o.id !== fridge.id));
      expect(c1.texts).toEqual(c0.texts); expect(c1.images).toEqual(c0.images); expect(c1.canvas).toEqual(c0.canvas);
      // The previous picture is still in the creative's history.
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}?revision=${c0.revision}`)).body.objects.find(o => o.id === fridge.id)!.asset.file).toBe(fridge.asset.file);
      // Saved again (as either editor does): the refined picture is the creative's own and stays; a copy gets its own.
      const c2 = (await s.send<ProductCreative>('PUT', `/${id}/creatives/${cid}`, { expectedRevision: c1.revision, creative: { ...c1, objects: c1.objects.map(o => o.id === fridge.id ? { ...o, hidden: true, box: { ...o.box, x: o.box.x + 10, width: o.box.width + 15 } } : o) } })).body;
      expect(c2.objects.find(o => o.id === fridge.id)).toMatchObject({ hidden: true, box: { x: fridge.box.x + 10, width: fridge.box.width + 15 } });
      expect(c2.revision).toBe(c1.revision + 1); expect(c2.objects.find(o => o.id === fridge.id)!.asset.file).toBe(ai.file);
      const copy = (await s.send<ProductCreative>('POST', `/${id}/creatives/${cid}/duplicate`, {})).body, copied = copy.objects.find(o => o.id === fridge.id)!.asset.file;
      expect(copied).toMatch(new RegExp(`^pcr-${copy.id.slice(3)}-`));
      expect((await s.send<ProductCreative>('PUT', `/${id}/creatives/${copy.id}`, { expectedRevision: copy.revision, creative: copy })).body.objects.find(o => o.id === fridge.id)!.asset.file).toBe(copied);
      // Text and logos are overlays, never refined as pictures: a logo is not an object here.
      expect((await s.send<{ error: { code: string } }>('POST', `/${id}/creatives/${cid}/objects/${c0.images[0].id}/refine/local`, {})).body.error.code).toBe('NOT_FOUND');
      // An uploaded/refined cutout has no source geometry: estimate reports the limitation; even approval cannot send.
      const unavailable = (await s.call<{ available: boolean; reason: string }>(base)).body;
      expect(unavailable.available).toBe(false); expect(unavailable.reason).toContain('reliable missing region');
      expect((await s.send<{ error: { code: string } }>('POST', `${base}/ai`, { approveUsd: 10 })).body.error.code).toBe('REPAIR_REGION_UNKNOWN');
      expect(calls).toBe(4);
    } finally { await s.close(); }
  });
});
