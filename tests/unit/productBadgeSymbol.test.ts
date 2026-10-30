/**
 * A symbol drawn into a badge (free, no network: the saved answer read again).
 *
 * Live on 2026-10-30 ("Cheerful man pointing at green promo elements"): a discount seal's embossed white "%" was listed
 * as advertising text, coloured as the seal. Taken out as text, its green "ink" was the seal and the white symbol stayed,
 * so decomposition was refused ("“%” still shows in the picture it would get"). Now a text block of symbols only, wholly
 * inside one compact decoration, is that decoration's artwork: it stays in the picture with the badge, is not editable
 * text, and is not reported as text seen but not read. A badge's "50%" (a number to edit) stays editable text.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PRODUCT_POSTER, PRODUCT_SCENE_ANSWER, productPosterPng } from '../../server/src/decomposition/protectedTemplates/product/productPoster.fixture.js';
import { setup, sha } from '../../server/src/decomposition/protectedTemplates/product/productServer.fixture.js';

const { width: W, height: H } = PRODUCT_POSTER;
const frac = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x / W, y: b.y / H, w: b.width / W, h: b.height / H, certainty: 'tight' });
const badge = (id: string, box: { x: number; y: number; width: number; height: number }) => ({ ...PRODUCT_SCENE_ANSWER.objects[0], id, kind: 'decoration', importance: 'supporting', category: 'discount badge', description: 'discount badge', box: frac(box) });
const word = (id: string, text: string, group: string, box: { x: number; y: number; width: number; height: number }) => ({ id, text, box: { ...box, rotation: 0 }, confidence: 0.99, z: 5, group, line: `${group}_line`, role: 'offer' });
// Different places on the poster, clear of its text, logo tiles and products: a seal with a lone "%" (top right), a tag
// with "50" and "%" as separate words (middle right), a sticker "50% OFF" (bottom right), and a "%" on the panel itself,
// in no decoration (right, between them).
const SEAL = { x: 860, y: 300, width: 110, height: 110 }, TAG = { x: 860, y: 440, width: 120, height: 90 }, STICKER = { x: 820, y: 900, width: 170, height: 110 };
const PCT = { x: 890, y: 330, width: 50, height: 46 }, TAG_50 = { x: 870, y: 465, width: 50, height: 40 }, TAG_PCT = { x: 925, y: 465, width: 40, height: 40 };
const FIFTY = { x: 835, y: 935, width: 70, height: 40 }, OFF = { x: 910, y: 935, width: 65, height: 40 }, LONE = { x: 870, y: 620, width: 50, height: 46 };
const union = (...b: { x: number; y: number; width: number; height: number }[]) => { const x = Math.min(...b.map(r => r.x)), y = Math.min(...b.map(r => r.y)); return { x, y, width: Math.max(...b.map(r => r.x + r.width)) - x, height: Math.max(...b.map(r => r.y + r.height)) - y }; };
const ANSWER = { ...PRODUCT_SCENE_ANSWER, objects: [...PRODUCT_SCENE_ANSWER.objects, badge('badge_1', SEAL), badge('badge_2', TAG), badge('badge_3', STICKER)],
  text_overlays: [{ id: 'overlay_1', role: 'offer', text: '%', refers_to: ['badge_1'], box: frac(PCT) }, { id: 'overlay_2', role: 'offer', text: '50 %', refers_to: ['badge_2'], box: frac(union(TAG_50, TAG_PCT)) },
    { id: 'overlay_3', role: 'offer', text: '50% OFF', refers_to: ['badge_3'], box: frac(union(FIFTY, OFF)) }, { id: 'overlay_4', role: 'offer', text: '%', refers_to: [], box: frac(LONE) }],
  words: [word('word_1', '%', 'seal_group', PCT), word('word_2', '50', 'tag_group', TAG_50), word('word_3', '%', 'tag_group', TAG_PCT),
    word('word_4', '50%', 'sticker_group', FIFTY), word('word_5', 'OFF', 'sticker_group', OFF), word('word_6', '%', 'lone_group', LONE)] };
type Stored = { textAnalysis: { words: { id: string; text: string; box: { x: number; y: number }; review: { status: string } }[] } };

describe('a symbol drawn into a badge', () => {
  it('stays in the picture as the badge’s artwork; offer text, a "%" beside its number, a lone "%" in no decoration, and Review choices stay editable', { timeout: 60_000 }, async () => {
    const s = await setup({ analyzer: false });
    try {
      const made = await s.form('', await productPosterPng(), { name: 'Badge symbol', useAi: 'false' });
      let v = await s.detected(made.body.template.id);
      const id = v.template.id, dir = join(s.protectedDir, id);
      // The completed answer saved with the template, bound to this very picture (as every live request saves it).
      const sent = await sharp(readFileSync(join(dir, v.template.source.inputFile))).png().toBuffer();
      const picture = { width: W, height: H, mime: 'image/png', bytes: sent.length, source: { width: W, height: H } };
      writeFileSync(join(dir, 'analysis-product-completed.json'), JSON.stringify({ job: { model: 'gpt-5.6-sol', imageSha256: sha(sent), sent: picture, startedAt: new Date().toISOString(), status: 'completed', responseId: 'resp_saved' },
        response: { id: 'resp_saved', status: 'completed', output: [], usage: { input_tokens: 2432, output_tokens: 3077 }, output_text: JSON.stringify(ANSWER) } }));
      expect((await s.send('POST', `/${id}/detect`, { force: true, useAi: false, savedAnswer: true })).status).toBe(202);
      v = await s.detected(id);
      expect(v.product.detection?.ai?.status).toBe('done');
      const words = () => (JSON.parse(readFileSync(join(dir, 'template.json'), 'utf8')) as Stored).textAnalysis.words;
      const status = (at: { x: number; y: number }) => words().find(w => Math.abs(w.box.x - at.x) < 12 && Math.abs(w.box.y - at.y) < 12)?.review.status;
      // The seal's lone "%": the badge's artwork (kept in the picture), not editable text, not reported as missing.
      expect(status(PCT)).toBe('rejected');
      // Offer text on a badge, a "%" beside its number, and a "%" in no decoration: editable text, each in its own block.
      for (const at of [FIFTY, OFF, TAG_50, TAG_PCT, LONE]) expect(status(at)).not.toBe('rejected');
      expect(v.texts.filter(t => !t.removed).map(t => t.text).sort()).toEqual(['%', '50 %', '50% OFF']);
      expect(v.product.detection?.missingText ?? []).toEqual([]);
      expect(v.attention.filter(a => a.type === 'missing')).toEqual([]);
      // Text, logos and decorations stay apart: the three badges are decorations, the logos stay logos, no "%" is a logo.
      expect(v.product.objects.filter(o => o.kind === 'decoration')).toHaveLength(3);
      expect(v.logos.length).toBeGreaterThan(0);
      expect(v.logos.some(l => l.label.includes('%'))).toBe(false);

      // The person's choice wins: the seal's "%" made editable text in the Review stays so when found again.
      const seal = words().find(w => Math.abs(w.box.x - PCT.x) < 12 && Math.abs(w.box.y - PCT.y) < 12)!;
      const reviewed = await s.send('PUT', `/${id}/review`, { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ ...o, accepted: true })), texts: [], words: [{ wordId: seal.id, removed: false }], logos: [], dismissMissingText: true });
      expect(reviewed.status).toBe(200);
      expect(status(PCT)).toBe('approved');
      expect((await s.send('POST', `/${id}/detect`, { force: true, useAi: false })).status).toBe(202);
      v = await s.detected(id);
      expect(v.product.detection?.ai?.model).toContain('recorded answer');
      expect(status(PCT)).toBe('approved');
    } finally { await s.close(); }
  });
});
