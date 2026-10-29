/**
 * AI design variations of a saved template (Generate AI Variations), over HTTP with test doubles only: the "model" places
 * the creative on a soft cover of itself at the size asked (nothing generated), so the routing, approvals, sizes, checks
 * and the hand-off into the creation pipeline are exercised — not AI quality. No network, nothing charged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { aiVariationBusinessWords, aiVariationRetriable, aiVariationWarnings, regenEstimateUsdForSize, type AiVariationJob, type ProductAspectRatio } from '@frameflow/shared';
import { writeFileSync } from 'node:fs';
import type { RecognizedWord, WordRecognizer } from '../../../textRecognition/recognizer.js';
import { protectRegenerated, variationPrompt, VARIATION_DIRECTIONS, type RatioRegenerator } from './ratioRegeneration.js';
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

  it('keeps the template family with distinct designs: placement and scale vary, text stays inside the artwork, never a detached board', () => {
    // Distinct designs: most directions move or rescale the elements; none splits the creative into a picture and a board of text.
    expect(VARIATION_DIRECTIONS.filter(d => /larger|resized|repositioned|moved|rebalanced|regrouped|rescaled|re-proportioned/.test(d)).length).toBeGreaterThanOrEqual(3);
    for (const d of VARIATION_DIRECTIONS) expect(d).not.toMatch(/\bsplit\b|\bside\b|\bboard\b|detached|new layout/i);
    const withText = variationPrompt({ shape: 'wide landscape 16:9', theme: 'diwali', index: 2, count: 3, texts: ['Get 26% cashback'] });
    expect(withText).toMatch(/the same template family and design system restyled, not a new advertising composition/);
    expect(withText).toMatch(/Keep the original's template family: its brand identity, visual hierarchy, design grammar and composition style — one integrated campaign artwork/);
    expect(withText).toMatch(/the placement and scale of the products, characters, decorations and existing text containers may vary as the direction says/);
    expect(withText).toMatch(/Its text stays integrated inside the artwork, in the same kinds of banners, rounded boxes, pills, ribbons, badges or strips it sits in now \(they may move or resize with the composition\) — never moved into a detached side panel, a separate information board or a split layout of picture and text/);
    expect(withText).toMatch(/adapt the composition to that shape, keeping it one integrated artwork of the same family/);
    expect(withText).toMatch(/The festival or theme changes the decoration, colours, motifs and atmosphere, never the content/);
    // A text-free creative is not told about text containers: it stays free of them.
    const textFree = variationPrompt({ shape: 'square 1:1', theme: 'holi', index: 0, count: 3 });
    expect(textFree).toMatch(/Keep the composition free of any text panel, box or board, exactly as the original/); expect(textFree).not.toMatch(/Its text stays integrated/);
  });

  it('names no headline, offer or panel for words in any direction, and allows exactly the template\'s own text (none for a text-free one)', () => {
    // (Told "the headline and offer in a bold rounded panel", the model gave a text-free creative a panel of invented offers.)
    for (const d of VARIATION_DIRECTIONS) expect(d).not.toMatch(/headline|offer|terms|panel|slogan|copy/i);
    const textFree = variationPrompt({ shape: 'ultra-wide 3:1 banner', theme: 'diwali', index: 2, count: 3 });
    expect(textFree).toMatch(/This creative has no text: the result must contain no words, letters or numbers anywhere/);
    expect(textFree).toMatch(/no headline, slogan, offer, price, discount, cashback, date, label, call to action, or panel, banner or badge with writing/);
    // The original's own occurrences, repetitions included (a partner logo line printed twice stays twice).
    const withText = variationPrompt({ shape: 'square 1:1', theme: 'holi', index: 2, count: 3, texts: ['Get 26% cashback', 'FEDERAL BANK', 'Valid till 30 Sep', 'FEDERAL BANK'] });
    expect(withText).toMatch(/The only text allowed anywhere in the result is the original's own text, .* each text appearing as many times as it does in the original \(one that repeats there stays repeated, marked ×N\)/);
    expect(withText).toContain('"FEDERAL BANK" (×2)'); expect(withText).toContain('"Get 26% cashback";'); expect(withText).not.toContain('"Get 26% cashback" (×');
    expect(withText).not.toMatch(/exactly once/); expect(withText).not.toMatch(/This creative has no text/);
  });

  it('makes a variation again only when it failed, cannot be used or has warnings, and was not made editable', () => {
    const clean = { assets: [{ label: 'Refrigerator', status: 'restored' as const, score: 0.9 }], qr: [], missingWords: [], extraWords: [], blocking: [] };
    expect(aiVariationRetriable({ index: 0, direction: '', status: 'ready', checks: clean })).toBe(false);
    expect(aiVariationRetriable({ index: 0, direction: '', status: 'failed', error: 'terminated' })).toBe(true);
    expect(aiVariationRetriable({ index: 0, direction: '', status: 'ready', checks: { ...clean, extraWords: ['sparkle'] } })).toBe(true);
    expect(aiVariationRetriable({ index: 0, direction: '', status: 'ready', checks: { ...clean, blocking: ['A QR code …'] } })).toBe(true);
    expect(aiVariationRetriable({ index: 0, direction: '', status: 'ready', checks: { ...clean, extraWords: ['sparkle'] }, templateId: 'pt-1' })).toBe(false);
  });

  it('flags every added word for review, prices and amounts by exact match only, and names the ones that look like new business content', async () => {
    const [original, result] = await Promise.all([1, 2].map(n => sharp({ create: { width: 40 + n, height: 40, channels: 3, background: '#fff' } }).png().toBuffer()));
    const said = (texts: string[]): RecognizedWord[] => texts.map(text => ({ text, confidence: 0.95, box: { x0: 0, y0: 0, x1: 1, y1: 1 } }) as RecognizedWord);
    const reader: WordRecognizer = { engine: { name: 'test', version: '1', model: 'test', modes: [] }, recognize: async ({ image }) =>
      said(image.equals(original) ? ['Get', '₹500', 'voucher', 'Navratri'] : ['Get', '₹600', 'voucher', 'Vouchar', 'Navratri', '50%', 'OFF', 'Sparkle']) };
    const { checks } = await protectRegenerated({ original, result, recognizer: reader, knownWords: ['Get ₹500 voucher'] });
    // "₹600" is a new price, never a misreading of "₹500"; "50%" has no letters yet is caught; "Vouchar" is a misreading.
    expect(checks.extraWords).toEqual(['₹600', '50%', 'off', 'sparkle']); expect(checks.blocking).toEqual([]);
    expect(aiVariationBusinessWords(checks)).toEqual(['₹600', '50%', 'off']);
    expect(aiVariationWarnings(checks)).toEqual(['words not in your template: ₹600, 50%, off, sparkle']);
  });
});

/** Words a "reader" finds in a picture: invented copy where the double painted magenta, two stray words where cyan. */
const count = async (png: Buffer, rgb: [number, number, number]) => { const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true }); let n = 0; for (let i = 0; i < data.length; i += 3) if (Math.abs(data[i] - rgb[0]) < 8 && Math.abs(data[i + 1] - rgb[1]) < 8 && Math.abs(data[i + 2] - rgb[2]) < 8) n++; return n; };
const said = (texts: string[]): RecognizedWord[] => texts.map(text => ({ text, confidence: 0.95, box: { x0: 0, y0: 0, x1: 1, y1: 1 } }) as RecognizedWord);
const reader: WordRecognizer = { engine: { name: 'test', version: '1', model: 'reads marks the double paints', modes: [] }, recognize: async ({ image }) =>
  (await count(image, [255, 0, 255])) > 400 ? said(['FESTIVE', 'BONANZA', 'EXCLUSIVE', 'OFFERS', 'CASHBACK']) : (await count(image, [0, 255, 255])) > 400 ? said(['STRAY', 'WORDS']) : [] };
/**
 * A double whose outcome depends on the variation and its attempt (read from the prompt): variation 2 first drops its
 * connection ("terminated"), then comes back with two stray words; variation 3 first invents a panel of offers, then is
 * clean. Variation 1 is the creative exactly.
 */
const attempts = new Map<number, number>();
const scripted: RatioRegenerator = { model: 'test image regenerator (no network)', offline: false, async regenerate(req, save, op) {
  const n = Number(/Create variation (\d+) of/.exec(req.prompt)![1]), k = (attempts.get(n) ?? 0) + 1; attempts.set(n, k);
  if (n === 2 && k === 1) throw new Error('terminated (UND_ERR_SOCKET: other side closed)');
  if (n === 1) return { image: await sharp(req.image).resize(req.size.width, req.size.height, { fit: 'fill' }).png().toBuffer(), requestId: 'test', costUsd: 0.05 };
  const out = await regenerator.regenerate(req, save, op), mark = n === 3 && k === 1 ? '#ff00ff' : n === 2 ? '#00ffff' : undefined;
  if (!mark) return out;
  const { width, height } = await sharp(out.image).metadata();
  return { ...out, image: await sharp(out.image).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${width! * 0.6}" y="${height! * 0.1}" width="${width! * 0.35}" height="${height! * 0.3}" fill="${mark}"/></svg>`) }]).png().toBuffer() };
} };

describe('AI design variations: invented copy, a failed slot and individual retries (HTTP, test doubles)', { timeout: 300000 }, () => {
  it('never accepts invented copy without review, reports the failed slot, and retries one slot on its own approval without touching the others', async () => {
    const s = await setup({ regenerator: scripted, recognizer: reader });
    try {
      const v = await savedTemplate(s, await productPosterPng()), id = v.template.id, info = (await s.call<Info>(`/${id}/ai-variations`)).body, each = info.estimates.original;
      const job = await done(s, id, (await s.send<AiVariationJob>('POST', `/${id}/ai-variations`, { ratio: 'original', theme: 'diwali', count: 3, approveUsd: each * 3 })).body.id);
      const [one, two, three] = job.results;
      // (Even the creative exactly leaves the test poster's Television, partly behind another product there, not put back: a warning.)
      expect(one).toMatchObject({ status: 'ready', checks: { blocking: [], extraWords: [], missingWords: [] } });
      // The dropped connection: reported with its cause, nothing retried; counted at its estimate (it may have been billed).
      expect(two).toMatchObject({ status: 'failed', error: 'terminated (UND_ERR_SOCKET: other side closed) Nothing was retried.' }); expect(two.file).toBeUndefined();
      // The invented panel: refused outright, never offered to be made editable.
      // The invented panel: not refused by a count, but never usable without review — and its offer words confirmed on their own.
      expect(three.status).toBe('ready'); expect(three.checks!.extraWords).toEqual(['festive', 'bonanza', 'exclusive', 'offers', 'cashback']);
      expect(three.checks!.blocking).toEqual([]); expect(aiVariationBusinessWords(three.checks)).toEqual(['festive', 'bonanza', 'exclusive', 'offers', 'cashback']);
      expect(job.costUsd).toBeCloseTo(0.05 + each + 0.05, 5);
      expect((await s.send<{ error: { code: string } }>('POST', `/${id}/ai-variations/${job.id}/2/continue`, { approved: true })).body.error.code).toBe('APPROVAL_REQUIRED');
      const notConfirmed = (await s.send<{ error: { code: string; message: string } }>('POST', `/${id}/ai-variations/${job.id}/2/continue`, { approved: true, acceptWarnings: true })).body.error;
      expect(notConfirmed.code).toBe('APPROVAL_REQUIRED'); expect(notConfirmed.message).toMatch(/not new prices, offers, dates or claims .*festive, bonanza, exclusive, offers, cashback/);
      // A block saved under the since-removed count rule is a warning to review again, not a refusal.
      const file = join(s.protectedDir, id, `pav-${job.id}.json`), raw = JSON.parse(readFileSync(file, 'utf8')) as AiVariationJob;
      raw.results[2].checks!.blocking.push('The AI added text that is not in your template (festive, bonanza…): this variation cannot be used. Retry it.'); writeFileSync(file, JSON.stringify(raw));
      expect((await s.call<AiVariationJob>(`/${id}/ai-variations/${job.id}`)).body.results[2].checks!.blocking).toEqual([]);
      // Retries: only a failed, unusable or questionable slot, only with its own approval; a clean one is never made again.
      expect((await s.send<{ error: { code: string } }>('POST', `/${id}/ai-variations/${job.id}/1/retry`, {})).body.error.code).toBe('APPROVAL_REQUIRED');
      await s.send('POST', `/${id}/ai-variations/${job.id}/1/retry`, { approveUsd: each });
      let again = await done(s, id, job.id);
      expect(again.results[0]).toEqual(one); expect(again.results[2]).toEqual({ ...three, checks: again.results[2].checks });
      expect(again.results[1]).toMatchObject({ status: 'ready', attempts: 2, checks: { blocking: [], extraWords: ['stray', 'words'] } });
      await s.send('POST', `/${id}/ai-variations/${job.id}/2/retry`, { approveUsd: each });
      again = await done(s, id, job.id);
      expect(again.results[2]).toMatchObject({ status: 'ready', attempts: 2, checks: { blocking: [], extraWords: [] } }); expect(again.results[0]).toEqual(one);
      // Recorded costs kept, each retry added once.
      expect(again.costUsd).toBeCloseTo(0.05 + each + 0.05 + 0.05 + 0.05, 5);
      // A questionable result (two stray words) is used only with its warnings accepted explicitly.
      expect((await s.send<{ error: { code: string } }>('POST', `/${id}/ai-variations/${job.id}/1/continue`, { approved: true, useAi: true })).body.error.code).toBe('APPROVAL_REQUIRED');
      expect((await s.send<{ templateId: string }>('POST', `/${id}/ai-variations/${job.id}/1/continue`, { approved: true, useAi: true, acceptWarnings: true })).status).toBe(201);
      // Made editable: never made again.
      expect((await s.send<{ error: { code: string } }>('POST', `/${id}/ai-variations/${job.id}/1/retry`, { approveUsd: each })).body.error.code).toBe('INVALID_REQUEST');
    } finally { await s.close(); }
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
      const made = (await s.send<{ templateId: string; reused: boolean }>('POST', `/${id}/ai-variations/${jobC.id}/1/continue`, { approved: true, useAi: true, acceptWarnings: true })).body;
      expect(made.reused).toBe(false);
      const t = await s.detected(made.templateId);
      expect(t.template.source).toMatchObject({ width: 1770, height: 572 }); expect(t.product.detection?.status).toBe('done');
      expect(t.product.regeneration).toMatchObject({ status: 'approved', ratio: '885:286', from: { templateId: id, draftId: `pav-${jobC.id}-1` } });
      expect(readFileSync(join(s.protectedDir, made.templateId, t.template.source.file)).equals(readFileSync(join(s.protectedDir, id, jobC.results[1].file!)))).toBe(true);
      // Asked again: the same template; the job records it.
      expect((await s.send<{ templateId: string; reused: boolean }>('POST', `/${id}/ai-variations/${jobC.id}/1/continue`, { approved: true, acceptWarnings: true })).body).toEqual({ templateId: made.templateId, reused: true });
      expect((await s.call<AiVariationJob>(`/${id}/ai-variations/${jobC.id}`)).body.results[1].templateId).toBe(made.templateId);
    } finally { await s.close(); }
  });
});
