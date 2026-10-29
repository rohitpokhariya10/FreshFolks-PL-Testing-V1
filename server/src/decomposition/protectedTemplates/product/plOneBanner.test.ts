/**
 * The PL One banner preset (the client's Figma frame, 885 × 286 ≈ 3.09:1), with test doubles only. The image model makes
 * aspects up to 3:1, so the banner is asked at 3:1 (2496 × 832) and its plain top and bottom edges trimmed to exactly
 * 885:286 (1770 × 572) before anything is checked, found or decomposed. The five earlier choices stay as they were.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { exactRatioCanvas, OFFER_ASPECT_RATIOS, OFFER_ASPECT_LABELS, RATIO_REGEN_SIZES, ratioRegenEstimateUsd, regenRequestSize, REUSE_OFFERED_RATIOS, type ReuseDraft } from '@frameflow/shared';
import { atRatioSize, regenerationPrompt, type RatioRegenerator } from './ratioRegeneration.js';
import { setup, savedTemplate, type View } from './productServer.fixture.js';
import { productPosterPng } from './productPoster.fixture.js';

const calls: { size: { width: number; height: number }; prompt: string }[] = [];
/** TEST DOUBLE of the image model: the picture whole on a soft cover of itself at the size asked (nothing generated). */
const regenerator: RatioRegenerator = { model: 'test image regenerator (no network)', offline: false, async regenerate({ image, prompt, size }) {
  calls.push({ size, prompt });
  const cover = await sharp(image).resize(size.width, size.height, { fit: 'cover' }).blur(30).png().toBuffer(), whole = await sharp(image).resize(Math.round(size.width * 0.9), Math.round(size.height * 0.9), { fit: 'inside' }).png().toBuffer(), m = await sharp(whole).metadata();
  return { image: await sharp(cover).composite([{ input: whole, left: Math.round((size.width - m.width!) / 2), top: Math.round((size.height - m.height!) / 2) }]).png().toBuffer(), requestId: 'test', costUsd: 0.05 };
} };
const exactly = (s: { width: number; height: number }) => s.width * 286 === s.height * 885;
const until = async (s: Awaited<ReturnType<typeof setup>>, id: string, done: (v: View) => boolean) => { for (let i = 0; i < 2400; i++) { const v = (await s.call<View>(`/${id}`)).body; if (done(v)) return v; await new Promise(r => setTimeout(r, 25)); } throw new Error('timed out'); };

describe('PL One banner (885 × 286)', { timeout: 180000 }, () => {
  it('is offered beside the five earlier choices, which keep their sizes, labels and requests', () => {
    expect(REUSE_OFFERED_RATIOS).toEqual(['original', '1:1', '4:5', '9:16', '16:9', '885:286']);
    expect(OFFER_ASPECT_LABELS['885:286']).toBe('PL One Banner (885 × 286) — Ultra-wide');
    // Exactly 885:286 (2×), made at 3:1 — the widest the image model makes — sides multiples of 16, within its limits.
    expect(RATIO_REGEN_SIZES['885:286']).toEqual({ width: 1770, height: 572 }); expect(exactly(RATIO_REGEN_SIZES['885:286'])).toBe(true);
    const ask = regenRequestSize('885:286');
    expect(ask).toEqual({ width: 2496, height: 832 }); expect(ask.width % 16 + ask.height % 16).toBe(0); expect(ask.width / ask.height).toBeLessThanOrEqual(3); expect(Math.max(ask.width, ask.height)).toBeLessThanOrEqual(2560);
    expect(exactRatioCanvas('885:286', 2048)).toEqual({ width: 1770, height: 572 });
    // The earlier four common ratios: asked at their own sizes, unchanged.
    expect(Object.fromEntries(OFFER_ASPECT_RATIOS.filter(r => r !== '885:286').map(r => [r, [RATIO_REGEN_SIZES[r], regenRequestSize(r), OFFER_ASPECT_LABELS[r]]]))).toEqual({
      '1:1': [{ width: 1536, height: 1536 }, { width: 1536, height: 1536 }, 'Square 1:1'], '4:5': [{ width: 1280, height: 1600 }, { width: 1280, height: 1600 }, 'Portrait 4:5'],
      '9:16': [{ width: 1152, height: 2048 }, { width: 1152, height: 2048 }, 'Story 9:16'], '16:9': [{ width: 2048, height: 1152 }, { width: 2048, height: 1152 }, 'Landscape 16:9'] });
    expect(ratioRegenEstimateUsd('16:9')).toBe(0.54); expect(ratioRegenEstimateUsd('885:286')).toBeGreaterThan(0.3);
  });

  it('asks for a 3:1 banner with plain edges, and only the banner', () => {
    expect(regenerationPrompt('885:286')).toMatch(/ultra-wide 3:1 banner canvas, keeping the same design/);
    expect(regenerationPrompt('885:286')).toMatch(/thin band along the top and bottom edges .* continued background only/);
    for (const r of ['1:1', '4:5', '9:16', '16:9'] as const) expect(regenerationPrompt(r)).not.toMatch(/thin band/);
  });

  it('trims a 3:1 result to exactly 885:286 by its height only (≈1.5 % top and bottom), its whole width kept, then sizes it', async () => {
    // 2496 × 832: red in the outer 10 rows top and bottom (inside what is trimmed), blue at the far left and right columns
    // (never trimmed), and a black square in the middle.
    const made = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2496" height="832"><rect width="2496" height="832" fill="#e8f4d0"/><rect width="2496" height="10" fill="#ff0000"/><rect y="822" width="2496" height="10" fill="#ff0000"/><rect x="0" y="40" width="6" height="752" fill="#0000ff"/><rect x="2490" y="40" width="6" height="752" fill="#0000ff"/><rect x="1198" y="366" width="100" height="100" fill="#000"/></svg>`)).png().toBuffer();
    const out = await atRatioSize(made, '885:286'), px = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect([px.info.width, px.info.height]).toEqual([1770, 572]);
    const at = (x: number, y: number) => [...px.data.subarray((y * px.info.width + x) * px.info.channels, (y * px.info.width + x) * px.info.channels + 3)];
    // The red edge bands are gone (only the height was trimmed: about 13 of 832 rows each side) …
    expect(at(885, 0)[1]).toBeGreaterThan(200); expect(at(885, 571)[1]).toBeGreaterThan(200);
    // … the far left and right columns are still there (the whole width kept), and the middle is the middle.
    expect(at(0, 286)[2]).toBeGreaterThan(200); expect(at(0, 286)[0]).toBeLessThan(60); expect(at(1769, 286)[2]).toBeGreaterThan(200); expect(at(1769, 286)[0]).toBeLessThan(60);
    expect(at(885, 286)).toEqual([0, 0, 0]);
  });

  it('first-time master: chosen at upload, made at 3:1, trimmed to 885:286, and its elements found in the banner itself', async () => {
    const s = await setup({ regenerator });
    try {
      const made = await s.form<View>('', await productPosterPng(), { name: 'PL One banner', aspectRatio: '885:286', regenerate: 'true', approveUsd: String(ratioRegenEstimateUsd('885:286')) }), id = made.body.template.id;
      expect(made.status).toBe(201);
      const waiting = await until(s, id, v => v.stage === 'regenerated');
      expect(calls.at(-1)!.size).toEqual({ width: 2496, height: 832 });
      expect(waiting.product.regeneration).toMatchObject({ status: 'ready', ratio: '885:286', result: { width: 1770, height: 572, checks: { blocking: [] } } });
      await s.send('POST', `/${id}/regeneration`, { use: 'regenerated', approved: true });
      const v = await s.detected(id);
      // The picture found, reviewed and decomposed is the banner itself: its coordinates are the banner's.
      expect(v.template.source).toMatchObject({ width: 1770, height: 572 }); expect(v.product.detection?.status).toBe('done');
      expect(v.product.objects.every(o => o.box.x >= 0 && o.box.y >= 0 && o.box.x + o.box.width <= 1770 + 1 && o.box.y + o.box.height <= 572 + 1)).toBe(true);
    } finally { await s.close(); }
  });

  it('a master saved in the banner size (the free Size step) is exactly 885:286 and opens in the editor at that size', async () => {
    const s = await setup({ regenerator });
    try {
      const t = await savedTemplate(s, await productPosterPng()), id = t.template.id;
      const preview = (await s.send<{ draft: ReuseDraft }>('POST', `/${id}/master-size`, { ratio: '885:286' })).body, out = preview.draft.outputs['885:286']!;
      // (Made from the template at its own resolution: this small poster gives 885 × 286, the ratio to the pixel.)
      expect(exactly(out.canvas)).toBe(true); expect(out.checks.status).not.toBe('failed');
      const saved = await s.send<View>('POST', `/${id}/master-size/save`, { draftId: preview.draft.id, ratio: '885:286', expectedRevision: t.template.revision });
      expect(saved.status).toBe(201); expect(saved.body.product.revisions.at(-1)).toMatchObject({ aspectRatio: '885:286', canvas: out.canvas });
      expect((await s.send('POST', `/${id}/open-editor`, {})).status).toBe(200);
      const cid = (await s.call<View>(`/${id}`)).body.product.editorDraft!.creativeId!;
      expect((await s.call<{ canvas: { width: number; height: number } }>(`/${id}/creatives/${cid}`)).body.canvas).toEqual(out.canvas);
    } finally { await s.close(); }
  });

  it('Create Offer Creative: chosen at the start; the free layout and the AI regeneration are both exactly 885:286', async () => {
    const s = await setup({ regenerator });
    try {
      const v = await savedTemplate(s, await productPosterPng()), id = v.template.id;
      let d = (await s.send<ReuseDraft>('POST', `/${id}/reuse`, { simple: true, ratios: ['885:286'] })).body;
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/generate`, {})).body;
      expect(d.outputs['885:286']!.checks.status).not.toBe('failed'); expect(exactly(d.outputs['885:286']!.canvas)).toBe(true);
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/regenerate-image`, { ratio: '885:286', approveUsd: ratioRegenEstimateUsd('885:286') })).body;
      expect(calls.at(-1)!.size).toEqual({ width: 2496, height: 832 });
      expect(d.regenImages!['885:286']).toMatchObject({ width: 1770, height: 572, checks: { blocking: [] } });
      const cont = (await s.send<{ templateId: string }>('POST', `/${id}/reuse/${d.id}/regenerated/continue`, { ratio: '885:286', approved: true, useAi: true })).body;
      const made = await s.detected(cont.templateId);
      expect(made.template.source).toMatchObject({ width: 1770, height: 572 }); expect(made.product.targetRatio).toBe('885:286'); expect(made.product.detection?.status).toBe('done');
    } finally { await s.close(); }
  });
});
