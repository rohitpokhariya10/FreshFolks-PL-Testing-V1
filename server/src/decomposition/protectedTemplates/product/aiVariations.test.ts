/**
 * AI design variations of a saved template (Generate AI Variations), over HTTP with test doubles only: the "model" places
 * the creative on a soft cover of itself at the size asked (nothing generated), so the routing, approvals, sizes, checks
 * and the hand-off into the creation pipeline are exercised — not AI quality. No network, nothing charged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { regenEstimateUsdForSize, type AiVariationJob, type ProductAspectRatio } from '@frameflow/shared';
import { variationPrompt, VARIATION_DIRECTIONS, type RatioRegenerator } from './ratioRegeneration.js';
import { setup, savedTemplate, type View } from './productServer.fixture.js';
import { productPosterPng } from './productPoster.fixture.js';

const calls: { size: { width: number; height: number }; prompt: string }[] = [];
const regenerator: RatioRegenerator = { model: 'test image regenerator (no network)', offline: false, async regenerate({ image, prompt, size }) {
  calls.push({ size, prompt });
  const cover = await sharp(image).resize(size.width, size.height, { fit: 'cover' }).blur(30).png().toBuffer(), whole = await sharp(image).resize(Math.round(size.width * 0.9), Math.round(size.height * 0.9), { fit: 'inside' }).png().toBuffer(), m = await sharp(whole).metadata();
  return { image: await sharp(cover).composite([{ input: whole, left: Math.round((size.width - m.width!) / 2), top: Math.round((size.height - m.height!) / 2) }]).png().toBuffer(), requestId: 'test', costUsd: 0.05 };
} };
type Info = { available: boolean; model: string; estimates: Record<ProductAspectRatio, number>; jobs: AiVariationJob[] };
const done = async (s: Awaited<ReturnType<typeof setup>>, id: string, jid: string) => { for (let i = 0; i < 2400; i++) { const j = (await s.call<AiVariationJob>(`/${id}/ai-variations/${jid}`)).body; if (j.status !== 'running') return j; await new Promise(r => setTimeout(r, 25)); } throw new Error('timed out'); };

describe('AI design variations: the prompt', () => {
  it('asks each variation for its own design direction and the theme, keeps every word and element, invents nothing', () => {
    const texts = ['Get ₹100 voucher + free soundbox.', 'Time period: 1–31 October'];
    const prompts = [0, 1, 2, 3, 4].map(index => variationPrompt({ shape: 'square 1:1', theme: 'diwali', index, count: 5, texts, products: ['Espresso machine'] }));
    // Five different directions, each in its own prompt.
    expect(new Set(prompts.map((p, i) => p.includes(VARIATION_DIRECTIONS[i]))).size).toBe(1);
    expect(new Set(prompts).size).toBe(5);
    for (const p of prompts) {
      expect(p).toMatch(/Diwali/); expect(p).toContain('"Get ₹100 voucher + free soundbox."'); expect(p).toContain('The products (Espresso machine) stay exactly these products.');
      expect(p).toMatch(/Do not add, remove, translate or rewrite any text, offer, price, date or term/); expect(p).toMatch(/Do not add any new logo, brand name, QR code, product or person/);
      expect(p).not.toMatch(/thin band/);
    }
    expect(variationPrompt({ shape: 'square 1:1', theme: 'holi', index: 0, count: 3 })).toMatch(/Holi: vibrant clouds/);
    expect(variationPrompt({ shape: 'square 1:1', theme: 'original', index: 0, count: 3 })).toMatch(/Keep the original festival or theme/);
    expect(variationPrompt({ shape: 'square 1:1', theme: 'custom', customTheme: 'Onam pookalam', index: 0, count: 3 })).toMatch(/this theme: Onam pookalam/);
    expect(variationPrompt({ shape: 'ultra-wide 3:1 banner', theme: 'diwali', index: 0, count: 3, trimmed: true })).toMatch(/thin band along the top and bottom/);
  });
});

describe('AI design variations of a saved template (HTTP, temporary store, test doubles)', { timeout: 300000 }, () => {
  it('needs the approved estimate, makes distinct variations at exactly the size chosen, leaves the template unchanged, and one becomes an editable template', async () => {
    const s = await setup({ regenerator });
    try {
      const v = await savedTemplate(s, await productPosterPng()), id = v.template.id, before = (await s.call<View>(`/${id}`)).body;
      const info = (await s.call<Info>(`/${id}/ai-variations`)).body;
      expect(info.available).toBe(true);
      expect(Object.keys(info.estimates)).toEqual(['original', '1:1', '4:5', '9:16', '16:9', '885:286']);
      expect(info.estimates['16:9']).toBe(regenEstimateUsdForSize({ width: 2048, height: 1152 }));
      // Not approved, a count not offered, a custom theme without words: refused, nothing sent.
      const sent = calls.length;
      expect((await s.send('POST', `/${id}/ai-variations`, { ratio: 'original', theme: 'original', count: 3 })).status).toBe(400);
      expect((await s.send('POST', `/${id}/ai-variations`, { ratio: 'original', theme: 'original', count: 7, approveUsd: 9 })).status).toBe(400);
      expect((await s.send('POST', `/${id}/ai-variations`, { ratio: 'original', theme: 'custom', count: 3, approveUsd: 9 })).status).toBe(400);
      expect(calls.length).toBe(sent);

      // Journey A — the same theme, different designs, in the template's own size.
      const a = (await s.send<AiVariationJob>('POST', `/${id}/ai-variations`, { ratio: 'original', theme: 'original', count: 3, approveUsd: info.estimates.original * 3 })).body;
      expect(a.status).toBe('running');
      const jobA = await done(s, id, a.id);
      expect(jobA.status).toBe('done'); expect(jobA.results.map(r => r.status)).toEqual(['ready', 'ready', 'ready']);
      const promptsA = calls.slice(-3).map(c => c.prompt);
      expect(new Set(promptsA).size).toBe(3); expect(promptsA[0]).toMatch(/Keep the original festival or theme/);
      for (const r of jobA.results) {
        const m = await sharp(readFileSync(join(s.protectedDir, id, r.file!))).metadata();
        expect([m.width, m.height]).toEqual([jobA.size.width, jobA.size.height]);
        expect(jobA.size.width * v.template.source.height).toBe(jobA.size.height * v.template.source.width);
        // Products and logos put back on a clear match; one not found (a product partly behind another) is listed, not blocking.
        expect(r.checks!.blocking).toEqual([]); expect(r.checks!.assets.filter(x => x.status === 'restored').length).toBeGreaterThan(r.checks!.assets.length / 2);
      }
      expect(jobA.costUsd).toBeCloseTo(0.15, 5);

      // Journey B — a festival: Holi, four variations, the template's words kept in every request.
      const b = (await s.send<AiVariationJob>('POST', `/${id}/ai-variations`, { ratio: '1:1', theme: 'holi', count: 4, approveUsd: info.estimates['1:1'] * 4 })).body;
      const jobB = await done(s, id, b.id);
      expect(jobB.results.filter(r => r.status === 'ready')).toHaveLength(4);
      for (const c of calls.slice(-4)) { expect(c.prompt).toMatch(/Holi/); expect(c.size).toEqual({ width: 1536, height: 1536 }); }

      // Journey C — other sizes: the PL One banner made at 3:1 and kept at exactly 885:286; Story 9:16.
      const c = (await s.send<AiVariationJob>('POST', `/${id}/ai-variations`, { ratio: '885:286', theme: 'diwali', count: 3, approveUsd: info.estimates['885:286'] * 3 })).body;
      const jobC = await done(s, id, c.id);
      expect(calls.at(-1)!.size).toEqual({ width: 2496, height: 832 }); expect(calls.at(-1)!.prompt).toMatch(/thin band along the top and bottom/);
      expect(jobC.size).toEqual({ width: 1770, height: 572 });
      for (const r of jobC.results) { const m = await sharp(readFileSync(join(s.protectedDir, id, r.file!))).metadata(); expect([m.width, m.height]).toEqual([1770, 572]); }
      const story = await done(s, id, (await s.send<AiVariationJob>('POST', `/${id}/ai-variations`, { ratio: '9:16', theme: 'dussehra', count: 3, approveUsd: info.estimates['9:16'] * 3 })).body.id);
      expect(story.size).toEqual({ width: 1152, height: 2048 });

      // The base template is unchanged; every job is listed with it.
      const after = (await s.call<View>(`/${id}`)).body;
      expect(after.template.source).toEqual(before.template.source); expect(after.product.revisions).toEqual(before.product.revisions);
      expect((await s.call<Info>(`/${id}/ai-variations`)).body.jobs.map(j => j.id)).toEqual([story.id, c.id, b.id, a.id]);

      // Journey D (the hand-off) — not looked at: refused; approved: a template of its own from the variation's picture,
      // its elements found in that picture (the creation pipeline: review, decomposition, the editor follow there).
      expect((await s.send('POST', `/${id}/ai-variations/${jobC.id}/1/continue`, {})).status).toBe(400);
      const made = (await s.send<{ templateId: string; reused: boolean }>('POST', `/${id}/ai-variations/${jobC.id}/1/continue`, { approved: true, useAi: true })).body;
      expect(made.reused).toBe(false);
      const t = await s.detected(made.templateId);
      expect(t.template.source).toMatchObject({ width: 1770, height: 572 }); expect(t.product.detection?.status).toBe('done');
      expect(t.product.regeneration).toMatchObject({ status: 'approved', ratio: '885:286', from: { templateId: id, draftId: `pav-${jobC.id}-1` } });
      expect(readFileSync(join(s.protectedDir, made.templateId, t.template.source.file)).equals(readFileSync(join(s.protectedDir, id, jobC.results[1].file!)))).toBe(true);
      // Asked again: the same template; the job records it.
      expect((await s.send<{ templateId: string; reused: boolean }>('POST', `/${id}/ai-variations/${jobC.id}/1/continue`, { approved: true })).body).toEqual({ templateId: made.templateId, reused: true });
      expect((await s.call<AiVariationJob>(`/${id}/ai-variations/${jobC.id}`)).body.results[1].templateId).toBe(made.templateId);
    } finally { await s.close(); }
  });
});
