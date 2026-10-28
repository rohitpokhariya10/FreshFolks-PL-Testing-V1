import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { OFFER_ASPECT_RATIOS, type ProductCreative, type ProductSnapshot, type ReuseDraft, type ReuseOutput } from '@frameflow/shared';
import { setup, savedTemplate, type View } from './productServer.fixture.js';
import { productPosterPng } from './productPoster.fixture.js';
import { checkComposePlan, composeBackground, planRules, toCanvas, type composeRequest, type ReuseComposer, type Structure } from './reuseCompose.js';

type Box = { x: number; y: number; width: number; height: number };
const inter = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const exact = (r: string, c: { width: number; height: number }) => { const [w, h] = r.split(':').map(Number); return c.width * h === c.height * w; };
const column = (colour: number) => sharp(Buffer.from([colour, colour, colour]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();

/** A 1000 × 1000 offer creative: brand logos in a white header, the scene, bank logos and terms in a white footer. */
async function structure(): Promise<Structure> {
  const band = { column: await column(255), colour: '#ffffff' };
  return { source: { width: 1000, height: 1000 }, art: { top: 150, bottom: 850 }, head: band, foot: band, pieces: [],
    free: [
      { key: 'i:brand-a', kind: 'logo', zone: 'head', label: 'Brand', box: { x: 40, y: 40, width: 200, height: 70 }, order: 0, align: 'center' },
      { key: 'i:brand-b', kind: 'logo', zone: 'head', label: 'Partner', box: { x: 760, y: 45, width: 200, height: 60 }, order: 1, align: 'center' },
      { key: 'i:bank-1', kind: 'logo', zone: 'foot', label: 'Bank 1', box: { x: 100, y: 870, width: 220, height: 50 }, order: 2, align: 'center' },
      { key: 'i:bank-2', kind: 'logo', zone: 'foot', label: 'Bank 2', box: { x: 390, y: 870, width: 220, height: 50 }, order: 3, align: 'center' },
      { key: 'i:bank-3', kind: 'logo', zone: 'foot', label: 'Bank 3', box: { x: 680, y: 870, width: 220, height: 50 }, order: 4, align: 'center' },
      { key: 'g:legal', kind: 'text', zone: 'foot', label: 'T&Cs apply', box: { x: 350, y: 940, width: 300, height: 36 }, order: 5, align: 'center' },
    ],
    keep: [
      { kind: 'character', label: 'Mascot', x: 40, y: 430, width: 180, height: 400 },
      { kind: 'stage', label: 'the stage', x: 200, y: 680, width: 620, height: 110 },
      { kind: 'text', label: 'the headline', x: 200, y: 200, width: 600, height: 120 },
    ] };
}

const plans: { format: string; keys: string[] }[] = [], edits: { size: { width: number; height: number }; editArea: number }[] = [];
/** The layout planner and image editor as test doubles (no network, no charge; offline:false so the approval is exercised). */
const composer = (paint = '#e8f4ea'): ReuseComposer => ({ model: 'test layout planner (no network)', offline: false,
  async plan(input, _image, save) {
    const i = input as ReturnType<typeof composeRequest>;
    plans.push({ format: i.format, keys: i.elements.map(e => e.key) }); save('compose.test-request.json', { format: i.format, testOnly: true });
    return { responseId: `fake-plan-${plans.length}`, raw: { layout: 'scene beside an offer column (test)', art: i.proposal.art, boxes: i.proposal.boxes, safeArea: { x: 0, y: 0, ...i.canvas }, notes: ['test double'] } };
  },
  editor: { model: 'test image editor (no network)', offline: false, async edit(r) {
    const { data } = await sharp(r.mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let open = 0; for (let k = 3; k < data.length; k += 4) if (data[k] < 128) open++;
    edits.push({ size: r.size, editArea: open / (data.length / 4) });
    return { image: await sharp({ create: { ...r.size, channels: 3, background: paint } }).png().toBuffer(), requestId: 'fake-edit' };
  } } });

describe('Recompose: the rules’ plan (free, deterministic)', () => {
  it('makes every common ratio exactly, the artwork at one scale within its own pixels, every element inside the canvas and apart', async () => {
    const st = await structure();
    for (const r of OFFER_ASPECT_RATIOS) {
      const p = planRules(st, r), canvas = { x: 0, y: 0, ...p.canvas };
      expect(exact(r, p.canvas), r).toBe(true);
      expect(p.art.scale).toBeGreaterThan(0); expect(p.art.scale).toBeLessThanOrEqual(1);
      // The artwork is never cut at its top or bottom; its text and character stay whole; the stage at least 70 %.
      const block = toCanvas(st, p.art, { x: 0, y: st.art.top, width: 1000, height: st.art.bottom - st.art.top });
      expect(block.y).toBeGreaterThanOrEqual(-1); expect(block.y + block.height).toBeLessThanOrEqual(p.canvas.height + 1);
      for (const k of st.keep) { const b = toCanvas(st, p.art, k), inside = inter(b, canvas) / (b.width * b.height); expect(inside, `${r} ${k.label}`).toBeGreaterThanOrEqual(k.kind === 'stage' ? 0.7 : k.kind === 'character' ? 0 : 0.99); }
      const boxes = st.free.map(f => p.boxes[f.key]);
      expect(boxes.every(Boolean), r).toBe(true);
      for (const b of boxes) expect(inter(b, canvas), r).toBeGreaterThanOrEqual(b.width * b.height * 0.99);
      boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => expect(inter(a, b), r).toBeLessThanOrEqual(Math.min(a.width * a.height, b.width * b.height) * 0.03)));
    }
    // Taller: header, artwork, footer; landscape: the scene on one side and the offer column (bank logos, terms) beside it.
    expect(planRules(st, '9:16').layout).toBe('stacked');
    const wide = planRules(st, '16:9'), right = toCanvas(st, wide.art, { x: 0, y: st.art.top, width: 1000, height: 1 });
    expect(wide.layout).toMatch(/^split-/);
    for (const k of ['i:bank-1', 'i:bank-2', 'i:bank-3', 'g:legal']) expect(wide.boxes[k].x, k).toBeGreaterThanOrEqual(Math.min(right.x + right.width, wide.canvas.width) - 2 - (wide.layout === 'split-right' ? wide.canvas.width : 0));
    // The template's own shape: every element exactly where it was (scaled), nothing re-spaced.
    const same = planRules(st, '1:1'), s = same.art.scale;
    for (const f of st.free) expect(same.boxes[f.key]).toEqual({ x: Math.round(f.box.x * s), y: Math.round(f.box.y * s), width: Math.round(f.box.width * s), height: Math.round(f.box.height * s) });
  });

  it('checks an AI plan box by box: keeps a valid one, refuses an artwork placement that cuts the character, replaces a box over protected text', async () => {
    const st = await structure(), rules = planRules(st, '16:9');
    const given = { layout: 'scene left (test)', art: { ...rules.art, y: rules.art.y }, boxes: Object.entries(rules.boxes).map(([key, b]) => ({ key, ...b })), safeArea: { x: 0, y: 0, width: 10, height: 10 }, notes: ['fine'] };
    const ok = checkComposePlan(given, st, rules);
    expect(ok.source).toBe('ai'); expect(ok.rejected).toEqual([]); expect(ok.boxes).toEqual(rules.boxes);
    const cut = checkComposePlan({ ...given, art: { ...rules.art, x: rules.art.x - 300 } }, st, rules);
    expect(cut.source).toBe('rules'); expect(cut.notes.join(' ')).toMatch(/not used/);
    const tooBig = checkComposePlan({ ...given, art: { ...rules.art, scale: 1.5 } }, st, rules);
    expect(tooBig.source).toBe('rules');
    // A bank logo over the headline: refused with its reason, laid out by the rules instead.
    const headline = toCanvas(st, rules.art, st.keep.find(k => k.kind === 'text')!);
    const over = checkComposePlan({ ...given, boxes: given.boxes.map(b => (b.key === 'i:bank-1' ? { ...b, x: headline.x + 10, y: headline.y + 5 } : b)) }, st, rules);
    expect(over.rejected).toEqual([{ key: 'i:bank-1', reason: 'it covers the headline' }]); expect(over.boxes['i:bank-1']).toEqual(rules.boxes['i:bank-1']);
  });
});

describe('Recompose background', () => {
  it('never lets an AI continuation touch the artwork block or the bands: its pixels land only where the template has none', async () => {
    const st = await structure(), plan = planRules(st, '16:9');
    const ground = await sharp({ create: { width: 1000, height: 1000, channels: 4, background: '#ffffff' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect x="0" y="150" width="1000" height="700" fill="#2e8b57"/><rect x="480" y="300" width="40" height="400" fill="#c81e1e"/></svg>'), left: 0, top: 0 }]).png().toBuffer();
    const magenta = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#ff00ff' } }).png().toBuffer();
    const { png, local, mask, percent } = await composeBackground(ground, st, plan, magenta);
    expect(percent).toBeGreaterThan(0);
    const [a, b] = await Promise.all([png, local].map(x => sharp(x).removeAlpha().raw().toBuffer()));
    let inside = 0, changedInside = 0, outside = 0, magentaOutside = 0;
    for (let i = 0; i < mask.length; i++) {
      const same = a[i * 3] === b[i * 3] && a[i * 3 + 1] === b[i * 3 + 1] && a[i * 3 + 2] === b[i * 3 + 2];
      if (!mask[i]) { inside++; if (!same) changedInside++; } else { outside++; if (a[i * 3] > 240 && a[i * 3 + 1] < 20 && a[i * 3 + 2] > 240) magentaOutside++; }
    }
    expect(changedInside).toBe(0); expect(inside).toBeGreaterThan(0);
    expect(magentaOutside / outside).toBeGreaterThan(0.8);
  });
});

describe('Recompose in the Reuse Template studio (HTTP, temporary store, mocked AI)', { timeout: 180000 }, () => {

  it('composes every common ratio as its own layers, verifies it before saving, keeps older drafts working, and records the ratio on the master made from it', async () => {
    const s = await setup({ composer: composer() });
    try {
      const v = await savedTemplate(s, await productPosterPng()), id = v.template.id, revision = readFileSync(join(s.protectedDir, id, 'product-r1.json'));
      // Chosen before the first generation: the draft is made with it.
      let d = (await s.send<ReuseDraft>('POST', `/${id}/reuse`, { ratios: ['9:16'] })).body;
      expect(d.ratios).toEqual(['9:16']);
      const view = (await s.call<{ formats: { ratio: string; method: string; canvas: { width: number; height: number } }[]; composition: { ai: boolean } }>(`/${id}/reuse/${d.id}`)).body;
      expect(view.formats.map(f => f.ratio)).toEqual(['original', '1:1', '4:5', '9:16', '16:9']);
      for (const f of view.formats.filter(x => x.ratio !== 'original')) { expect(f.method).toBe('recompose'); expect(exact(f.ratio, f.canvas), f.ratio).toBe(true); }
      expect(view.composition.ai).toBe(true);
      d = (await s.send<ReuseDraft>('PUT', `/${id}/reuse/${d.id}`, { expectedRevision: d.revision, ratios: ['1:1', '4:5', '9:16', '16:9'] })).body;
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/generate`, {})).body;
      for (const r of OFFER_ASPECT_RATIOS) {
        const o = d.outputs[r] as ReuseOutput;
        expect(exact(r, o.canvas), r).toBe(true);
        expect(o.checks.status, `${r}: ${o.checks.issues.map(i => i.message).join(' ')}`).not.toBe('failed');
        expect(o.validation, r).toMatchObject({ size: { ok: true }, protected: { ok: true, issues: [] }, clipping: { ok: true } });
        expect(o.composition?.source).toBe('rules'); expect(o.background.method).toBe('recompose');
      }
      // Genuinely re-laid out, not only resized: in 16:9 the bank logos and the terms leave the footer for a column beside the scene.
      const wide = (await s.call<{ creative: ProductCreative }>(`/${id}/reuse/${d.id}/preview?ratio=16x9`)).body.creative, original = (await s.call<{ creative: ProductCreative }>(`/${id}/reuse/${d.id}/preview?ratio=9x16`)).body.creative;
      const banks = wide.images.filter(i => i.category === 'partner-logo');
      expect(banks.length).toBeGreaterThan(0);
      const scene = wide.objects.find(o => o.kind === 'character')!;
      for (const b of banks) expect(Math.abs(b.box.x + b.box.width / 2 - (scene.box.x + scene.box.width / 2)), b.label).toBeGreaterThan(wide.canvas.width * 0.3);
      // Every element is still its own layer, with its own words.
      for (const c of [wide, original]) { expect(c.images.length).toBe(v.counts.logos); expect(c.texts.map(t => t.text)).toContain('T&Cs'); }

      // AI composition: approved first (nothing is sent without it), one plan per format and one background edit where needed.
      expect((await s.send('POST', `/${id}/reuse/${d.id}/compose`, { ratios: ['4:5', '16:9'] })).status).toBe(400); expect(plans).toEqual([]);
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/compose`, { ratios: ['4:5', '16:9'], approveUsd: 0.4 })).body;
      expect(plans.map(p => p.format)).toEqual(['4:5', '16:9']); expect(plans[1].keys.length).toBeGreaterThan(0);
      expect(d.compose?.['16:9']).toMatchObject({ model: 'test layout planner (no network)', offline: false, rejected: [] });
      // The image editor saw only the areas to continue as editable (the artwork and bands stay opaque in its mask).
      expect(edits.length).toBeGreaterThan(0); for (const e of edits) { expect(e.editArea).toBeGreaterThan(0); expect(e.editArea).toBeLessThan(0.6); }
      expect(d.ai.requests).toBe(2 + edits.length);
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/generate`, {})).body;
      expect(d.outputs['16:9']!.composition?.source).toBe('ai'); expect(d.outputs['16:9']!.background.extension?.method).toBe('ai');
      expect(d.outputs['16:9']!.validation?.protected.ok).toBe(true);

      // Saved, then made into a master template of its own (Decompose & Edit): its canvas and metadata say 16:9.
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/save`, { ratios: ['16:9'] })).body;
      const made = (await s.send<{ templateId: string }>('POST', `/${id}/reuse/${d.id}/outputs/16x9/decomposition`, {})).body;
      const master = (await s.call<View>(`/${made.templateId}`)).body;
      expect(master.product.variation?.aspectRatio).toBe('16:9'); expect(exact('16:9', master.template.source)).toBe(true);

      // A draft saved before the common ratios (3:9, no compositions): it still opens, generates and keeps its format.
      const old = (await s.send<ReuseDraft>('POST', `/${id}/reuse`, {})).body, file = join(s.protectedDir, id, `prd-${old.id.slice(3)}.json`);
      const legacy = JSON.parse(readFileSync(file, 'utf8')) as ReuseDraft; legacy.ratios = ['original', '3:9']; delete legacy.compose; writeFileSync(file, JSON.stringify(legacy));
      const reopened = (await s.call<{ draft: ReuseDraft; formats: { ratio: string }[] }>(`/${id}/reuse/${old.id}`)).body;
      expect(reopened.draft.ratios).toEqual(['original', '3:9']); expect(reopened.formats.map(f => f.ratio)).toContain('3:9');
      const generated = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${old.id}/generate`, {})).body;
      expect(generated.outputs['3:9']?.background.method).toBe('slice'); expect(generated.outputs.original?.canvas).toEqual(v.template.source.width ? { width: v.template.source.width, height: v.template.source.height } : undefined);
      // The saved template revision itself never changes.
      expect(readFileSync(join(s.protectedDir, id, 'product-r1.json'))).toEqual(revision);
    } finally { await s.close(); }
  });

  it('never uses an AI continuation that drew lettering: it is refused and the free continuation is used', async () => {
    const s = await setup({ composer: composer('#ff00ff') });
    try {
      const v = await savedTemplate(s, await productPosterPng()), id = v.template.id;
      let d = (await s.send<ReuseDraft>('POST', `/${id}/reuse`, { ratios: ['16:9'] })).body;
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/compose`, { approveUsd: 0.2 })).body;
      const ext = d.compose?.['16:9']?.extension;
      expect(ext && 'failed' in ext ? ext.failed : '').toMatch(/drew lettering/);
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/generate`, {})).body;
      expect(d.outputs['16:9']!.background.extension?.method).toBe('local'); expect(d.outputs['16:9']!.composition?.source).toBe('ai');
    } finally { await s.close(); }
  });
});

describe('First-time master creation in a common ratio (HTTP, temporary store, mocked AI)', { timeout: 180000 }, () => {
  it('saves the original, previews and saves a 16:9 master from it with every layer editable, opens it in the editor, and reuses it in another ratio', async () => {
    const s = await setup({ composer: composer() });
    try {
      const v = await savedTemplate(s, await productPosterPng()), id = v.template.id, original = readFileSync(join(s.protectedDir, id, 'product-r1.json'));
      // The size is chosen before the master is saved in it: a free preview from the original revision, with its checks.
      const preview = (await s.send<{ draft: ReuseDraft; sourceRevision: number; ratio: string; view: { composition: { ai: boolean } } }>('POST', `/${id}/master-size`, { ratio: '16:9' })).body;
      expect(preview.sourceRevision).toBe(1); expect(preview.draft.master).toBe(true); expect(preview.view.composition.ai).toBe(true);
      const out = preview.draft.outputs['16:9']!;
      expect(exact('16:9', out.canvas)).toBe(true); expect(out.validation).toMatchObject({ size: { ok: true }, protected: { ok: true }, clipping: { ok: true } });
      // A master size draft is the master's, not a reuse draft.
      expect((await s.call<{ drafts: unknown[] }>(`/${id}/reuse`)).body.drafts).toEqual([]);
      // Designed with AI (approved; test doubles), then previewed again.
      let d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${preview.draft.id}/compose`, { ratios: ['16:9'], approveUsd: 0.2 })).body;
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/generate`, {})).body;
      expect(d.outputs['16:9']!.composition?.source).toBe('ai');
      const before = (await s.call<View>(`/${id}`)).body;
      const saved = (await s.send<View>('POST', `/${id}/master-size/save`, { draftId: d.id, ratio: '16:9', expectedRevision: before.template.revision })).body;
      expect(saved.product.revisions.map(r => [r.revision, r.aspectRatio ?? 'original', r.fromRevision ?? null])).toEqual([[1, 'original', null], [2, '16:9', 1]]);
      expect(saved.product.masterRatio).toBe('16:9');
      // The original revision is never changed; the master is revision 2, exactly 16:9, its own layers editable.
      expect(readFileSync(join(s.protectedDir, id, 'product-r1.json'))).toEqual(original);
      const master = JSON.parse(readFileSync(join(s.protectedDir, id, 'product-r2.json'), 'utf8')) as ProductSnapshot;
      expect(exact('16:9', master.canvas)).toBe(true); expect(master.editorCreative!.canvas).toEqual(master.canvas);
      expect(master.adaptation).toMatchObject({ fromRevision: 1, ratio: '16:9', source: 'ai' });
      const ec = master.editorCreative!;
      expect(ec.images.filter(i => !i.hidden)).toHaveLength(v.counts.logos);
      expect(ec.texts.filter(t => !t.hidden).map(t => t.text)).toEqual(expect.arrayContaining(['Grand', 'Savings', 'T&Cs', 'apply']));
      expect(ec.objects.some(o => o.label.startsWith('Text · '))).toBe(false);
      const products = ec.objects.filter(o => o.kind === 'product');
      expect(products.length).toBe(v.counts.products); expect(products.every(o => o.asset.kind === 'template')).toBe(true);
      for (const o of [...products, ...ec.images]) expect(inter(o.box, { x: 0, y: 0, ...master.canvas })).toBeGreaterThanOrEqual(o.box.width * o.box.height * 0.98);
      // Its objects are in the new canvas (the reuse studio stands products in their places from them).
      for (const o of master.objects.filter(x => x.kind === 'product')) expect(inter(o.box, { x: 0, y: 0, ...master.canvas })).toBeGreaterThan(0);
      // The editor opens the 16:9 master; a creative of it (Use template) is 16:9.
      const opened = (await s.send<{ runId: string }>('POST', `/${id}/open-editor`, {})).body;
      expect(opened.runId).toBeTruthy();
      const made = (await s.send<ProductCreative>('POST', `/${id}/creatives`, { name: 'From the 16:9 master' })).body;
      expect(made.templateRevision).toBe(2); expect(made.canvas).toEqual(master.canvas);
      // Reused: its own size as designed, and another common ratio composed from the original revision.
      let r = (await s.send<ReuseDraft>('POST', `/${id}/reuse`, { simple: true, ratios: ['original', '9:16'] })).body;
      expect(r.templateRevision).toBe(2);
      r = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${r.id}/generate`, {})).body;
      expect(r.outputs.original!.canvas).toEqual(master.canvas); expect(exact('9:16', r.outputs['9:16']!.canvas)).toBe(true);
      for (const k of ['original', '9:16'] as const) expect(r.outputs[k]!.checks.status, `${k}: ${r.outputs[k]!.checks.issues.map(i => i.message).join(' ')}`).not.toBe('failed');
      // Original size stays the original: a template saved without a size has one revision and no adaptation.
      const plain = await savedTemplate(s, await productPosterPng());
      expect(plain.product.revisions.map(x => x.aspectRatio ?? 'original')).toEqual(['original']);
    } finally { await s.close(); }
  });
});
