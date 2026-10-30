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
// (On empty parts of the poster: clear of its text, logo tiles and products.)
const SEAL = { x: 860, y: 300, width: 110, height: 110 }, STICKER = { x: 860, y: 900, width: 120, height: 110 };
const PCT = { x: 890, y: 330, width: 50, height: 46 }, FIFTY = { x: 880, y: 930, width: 80, height: 46 };

describe('a symbol drawn into a badge', () => {
  it('stays in the picture as the badge’s artwork; a badge’s number stays editable text', { timeout: 60_000 }, async () => {
    const s = await setup({ analyzer: false });
    try {
      const made = await s.form('', await productPosterPng(), { name: 'Badge symbol', useAi: 'false' });
      let v = await s.detected(made.body.template.id);
      const id = v.template.id, dir = join(s.protectedDir, id);
      const answer = { ...PRODUCT_SCENE_ANSWER, objects: [...PRODUCT_SCENE_ANSWER.objects, badge('badge_1', SEAL), badge('badge_2', STICKER)],
        text_overlays: [{ id: 'overlay_1', role: 'offer', text: '%', refers_to: ['badge_1'], box: frac(PCT) }, { id: 'overlay_2', role: 'offer', text: '50%', refers_to: ['badge_2'], box: frac(FIFTY) }],
        words: [word('word_1', '%', 'seal_group', PCT), word('word_2', '50%', 'sticker_group', FIFTY)] };
      // The completed answer saved with the template, bound to this very picture (as every live request saves it).
      const sent = await sharp(readFileSync(join(dir, v.template.source.inputFile))).png().toBuffer();
      const picture = { width: W, height: H, mime: 'image/png', bytes: sent.length, source: { width: W, height: H } };
      writeFileSync(join(dir, 'analysis-product-completed.json'), JSON.stringify({ job: { model: 'gpt-5.6-sol', imageSha256: sha(sent), sent: picture, startedAt: new Date().toISOString(), status: 'completed', responseId: 'resp_saved' },
        response: { id: 'resp_saved', status: 'completed', output: [], usage: { input_tokens: 2432, output_tokens: 3077 }, output_text: JSON.stringify(answer) } }));
      expect((await s.send('POST', `/${id}/detect`, { force: true, useAi: false, savedAnswer: true })).status).toBe(202);
      v = await s.detected(id);
      expect(v.product.detection?.ai?.status).toBe('done');
      expect(v.product.objects.filter(o => o.kind === 'decoration')).toHaveLength(2);
      // The seal's "%": not editable text, not taken out of the picture, not reported as missing.
      const stored = JSON.parse(readFileSync(join(dir, 'template.json'), 'utf8')) as { textAnalysis: { words: { text: string; review: { status: string } }[] } };
      expect(stored.textAnalysis.words.find(w => w.text === '%')?.review.status).toBe('rejected');
      expect(v.texts.filter(t => !t.removed).map(t => t.text)).toEqual(['50%']);
      expect(v.product.detection?.missingText ?? []).toEqual([]);
      expect(v.attention.filter(a => a.type === 'missing')).toEqual([]);
    } finally { await s.close(); }
  });
});
