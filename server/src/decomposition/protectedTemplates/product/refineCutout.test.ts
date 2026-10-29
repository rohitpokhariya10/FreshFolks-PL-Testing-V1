/**
 * Refine Cutout over HTTP (temporary store, a counting test double for the image model — no network, nothing charged):
 * one object layer of a creative repaired, nothing else touched, every paid request approved first.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ProductCreative } from '@frameflow/shared';
import type { RatioRegenerator } from './ratioRegeneration.js';
import { setup, savedTemplate } from './productServer.fixture.js';
import { productPosterPng } from './productPoster.fixture.js';

let calls = 0, failing = false;
/** TEST DOUBLE: answers with the picture it was sent (the object on its green ground), or fails like a dropped connection. */
const regenerator: RatioRegenerator = { model: 'test image model (no network)', offline: false, async regenerate({ image, size }) {
  calls++;
  if (failing) throw new Error('terminated (UND_ERR_SOCKET: other side closed)');
  return { image: await sharp(image).resize(size.width, size.height, { fit: 'fill' }).png().toBuffer(), requestId: 'test', costUsd: 0.07 };
} };
type Refined = { before: string; file: string; requests: number; costUsd?: number; estimateUsd?: number; model?: string };

describe('Refine Cutout (HTTP, test double)', { timeout: 180000 }, () => {
  it('cleans for free, repairs with AI only once approved, keeps the layer on a failure, and replaces only that layer', async () => {
    const s = await setup({ regenerator });
    try {
      const id = (await savedTemplate(s, await productPosterPng())).template.id;
      const c0 = (await s.send<ProductCreative>('POST', `/${id}/creatives`, { name: 'Refine test' })).body, cid = c0.id;
      const fridge = c0.objects.find(o => o.kind === 'product')!, base = `/${id}/creatives/${cid}/objects/${fridge.id}/refine`;
      // Free clean-up: a picture to compare, no request, the creative unchanged.
      const local = (await s.send<Refined>('POST', `${base}/local`, {})).body;
      expect(local.requests).toBe(0); expect(calls).toBe(0); expect(local.before).toBe(fridge.asset.file); expect(local.file).toMatch(new RegExp(`^pcr-${cid.slice(3)}-`));
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}`)).body.revision).toBe(c0.revision);
      // AI repair: its provider, model, size and estimate first; refused without approval, nothing sent.
      const info = (await s.call<{ available: boolean; model: string; size: { width: number; height: number }; estimateUsd: number }>(base)).body;
      expect(info).toMatchObject({ available: true, model: 'test image model (no network)' }); expect(info.estimateUsd).toBeGreaterThan(0.2); expect(info.estimateUsd).toBeLessThan(0.5);
      expect((await s.send<{ error: { code: string } }>('POST', `${base}/ai`, {})).body.error.code).toBe('APPROVAL_REQUIRED'); expect(calls).toBe(0);
      // A failed request: reported, nothing retried, the layer and the creative as they were.
      failing = true;
      const failed = (await s.send<{ error: { code: string; message: string } }>('POST', `${base}/ai`, { approveUsd: info.estimateUsd })).body.error;
      expect(failed.code).toBe('PROVIDER_FAILED'); expect(failed.message).toMatch(/terminated .* Nothing was retried/); expect(calls).toBe(1);
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}`)).body).toEqual(c0);
      // Approved: exactly one request, its cost recorded; still nothing changed until applied.
      failing = false;
      const ai = (await s.send<Refined>('POST', `${base}/ai`, { approveUsd: info.estimateUsd })).body;
      expect(ai).toMatchObject({ requests: 1, costUsd: 0.07, model: 'test image model (no network)' }); expect(calls).toBe(2);
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}`)).body.revision).toBe(c0.revision);
      // Applied only when looked at: a new revision in which only this object's picture differs.
      expect((await s.send<{ error: { code: string } }>('POST', `${base}/apply`, { expectedRevision: c0.revision, file: ai.file })).body.error.code).toBe('APPROVAL_REQUIRED');
      const c1 = (await s.send<ProductCreative>('POST', `${base}/apply`, { expectedRevision: c0.revision, file: ai.file, approved: true })).body;
      expect(c1.revision).toBe(c0.revision + 1);
      expect(c1.objects.find(o => o.id === fridge.id)!.asset.file).toBe(ai.file); expect(c1.objects.find(o => o.id === fridge.id)!.box).toEqual(fridge.box);
      expect(c1.objects.filter(o => o.id !== fridge.id)).toEqual(c0.objects.filter(o => o.id !== fridge.id));
      expect(c1.texts).toEqual(c0.texts); expect(c1.images).toEqual(c0.images); expect(c1.canvas).toEqual(c0.canvas);
      // The previous picture is still in the creative's history.
      expect((await s.call<ProductCreative>(`/${id}/creatives/${cid}?revision=${c0.revision}`)).body.objects.find(o => o.id === fridge.id)!.asset.file).toBe(fridge.asset.file);
      // Text and logos are overlays, never refined as pictures: a logo is not an object here.
      expect((await s.send<{ error: { code: string } }>('POST', `/${id}/creatives/${cid}/objects/${c0.images[0].id}/refine/local`, {})).body.error.code).toBe('NOT_FOUND');
      expect(calls).toBe(2);
    } finally { await s.close(); }
  });
});
