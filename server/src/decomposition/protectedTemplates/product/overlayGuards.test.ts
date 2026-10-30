/**
 * An approved AI creative's words and logos as editable overlays (HTTP, test doubles only): found in the FINAL picture,
 * checked against the approved source — a word the source does not have (an invented or changed price or claim) is
 * flagged for the review; each logo is cut from the source's own pixels on a clear match, else flagged for an authentic
 * upload. Text and logos stay overlays: never cut out as pictures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { AiVariationJob, ProtectedTemplate } from '@frameflow/shared';
import { fakeRecognizer, type WordRecognizer } from '../../../textRecognition/recognizer.js';
import type { RatioRegenerator } from './ratioRegeneration.js';
import { setup, savedTemplate } from './productServer.fixture.js';
import { PRODUCT_WORDS, productPosterPng } from './productPoster.fixture.js';

const regenerator: RatioRegenerator = { model: 'test image regenerator (no network)', offline: false, async regenerate({ image, size }) {
  const cover = await sharp(image).resize(size.width, size.height, { fit: 'cover' }).blur(30).png().toBuffer(), whole = await sharp(image).resize(Math.round(size.width * 0.9), Math.round(size.height * 0.9), { fit: 'inside' }).png().toBuffer(), m = await sharp(whole).metadata();
  return { image: await sharp(cover).composite([{ input: whole, left: Math.round((size.width - m.width!) / 2), top: Math.round((size.height - m.height!) / 2) }]).png().toBuffer(), requestId: 'test', costUsd: 0.05 };
} };
/** The base template's own words; once switched, the AI creative's: "26%" read as "50%", "Savings" as "Bonanza". */
let changed = false;
const own = fakeRecognizer(PRODUCT_WORDS), other = fakeRecognizer(PRODUCT_WORDS.map(w => ({ ...w, text: w.text === '26%' ? '50%' : w.text === 'Savings' ? 'Bonanza' : w.text })));
const reader: WordRecognizer = { engine: own.engine, recognize: input => (changed ? other : own).recognize(input) };

describe('AI creative overlays: words checked against the source, logos from its authentic pixels', { timeout: 300000 }, () => {
  it('flags a word the source does not have for the review, and restores or flags every logo — never a picture cut-out', async () => {
    const s = await setup({ regenerator, recognizer: reader });
    try {
      const base = await savedTemplate(s, await productPosterPng()), id = base.template.id;
      const info = (await s.call<{ estimates: Record<string, number> }>(`/${id}/ai-variations`)).body;
      let job = (await s.send<AiVariationJob>('POST', `/${id}/ai-variations`, { ratio: '1:1', theme: 'diwali', count: 3, approveUsd: info.estimates['1:1'] * 3 })).body;
      for (let i = 0; i < 2400 && job.status === 'running'; i++) { await new Promise(r => setTimeout(r, 25)); job = (await s.call<AiVariationJob>(`/${id}/ai-variations/${job.id}`)).body; }
      changed = true;
      const made = (await s.send<{ templateId: string }>('POST', `/${id}/ai-variations/${job.id}/0/continue`, { approved: true, useAi: true, acceptWarnings: true, confirmBusinessText: true })).body.templateId;
      const v = await s.detected(made);
      changed = false;
      const t = JSON.parse(readFileSync(join(s.protectedDir, made, 'template.json'), 'utf8')) as ProtectedTemplate;
      // The words of the FINAL picture: the changed price and the invented word flagged; the source's own words not.
      const words = t.textAnalysis!.words;
      expect(words.filter(w => w.review.status === 'needs-review').map(w => w.text).sort()).toEqual(expect.arrayContaining(['50%', 'Bonanza']));
      for (const w of words.filter(x => ['Grand', 'Get', 'cashback'].includes(x.text))) expect(w.review.status).not.toBe('needs-review');
      const report = JSON.parse(readFileSync(join(s.protectedDir, made, 'analysis-source-words.json'), 'utf8')) as { source: string; flagged: string[] };
      expect(report.source).toBe(`template ${id}`); expect(report.flagged).toEqual(expect.arrayContaining(['50%', 'Bonanza']));
      // Every logo: cut from the base template's own pixels (restored), or flagged for the review (an authentic upload).
      const logos = JSON.parse(readFileSync(join(s.protectedDir, made, 'analysis-regeneration-logos.json'), 'utf8')) as { source: string; logos: { id: string; status: string }[] };
      expect(logos.source).toBe(`template ${id}`); expect(logos.logos.length).toBe(t.textAnalysis!.logoSlots.length);
      for (const l of logos.logos) if (l.status === 'not-found') expect(t.textAnalysis!.logoSlots.find(x => x.id === l.id)!.review.status).toBe('needs-review');
      // Coordinates are the final picture's: every word and logo inside its canvas (1536 × 1536).
      expect(v.template.source).toMatchObject({ width: 1536, height: 1536 });
      for (const b of [...words.map(w => w.box), ...t.textAnalysis!.logoSlots.map(l => l.box)]) { expect(b.x).toBeGreaterThanOrEqual(-1); expect(b.y).toBeGreaterThanOrEqual(-1); expect(b.x + b.width).toBeLessThanOrEqual(1537); expect(b.y + b.height).toBeLessThanOrEqual(1537); }
      // Text and logos are overlays: none of them is among the objects to cut out.
      expect(v.product.objects.every(o => o.kind !== 'brand-logo' || !o.decompose)).toBe(true);
    } finally { await s.close(); }
  });
});
