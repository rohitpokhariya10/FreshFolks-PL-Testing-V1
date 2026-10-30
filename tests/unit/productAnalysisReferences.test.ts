/**
 * A completed analysis whose main / advertised list names something that is not one of its objects (free, no network).
 *
 * Live on 2026-10-30 ("Cheerful man pointing at green promo elements"): gpt-5.6-sol named the Navi logo `mark_logo_1`
 * among `main_candidates` and `advertised_ids`. The logo is a mark of the same answer, not an object, and the whole
 * billed answer was thrown away ("A main candidate is not one of the objects."). Now:
 *
 * - a logo or text of the answer named there is left out of that list and stays what it is: every object is kept;
 * - an id naming nothing in the answer is left out too, and the review says so: no object is invented;
 * - a malformed id or an object's invalid geometry still rejects the answer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { parseProductScene } from '../../server/src/decomposition/protectedTemplates/product/analyzer.js';
import { PRODUCT_SCENE_ANSWER, productPosterPng } from '../../server/src/decomposition/protectedTemplates/product/productPoster.fixture.js';
import { setup, sha } from '../../server/src/decomposition/protectedTemplates/product/productServer.fixture.js';

const size = { width: 1000, height: 1250 };
const answer = (patch: Record<string, unknown>) => ({ ...PRODUCT_SCENE_ANSWER, text_overlays: [], words: [], ...patch });
const objectIds = PRODUCT_SCENE_ANSWER.objects.map(o => o.id);

describe('main and advertised ids that are not objects', () => {
  it('a logo named as a main or advertised element stays a logo; every object is kept, with no warning', () => {
    const scene = parseProductScene(answer({ main_candidates: ['character_1', 'product_2', 'mark_4'], advertised_ids: ['mark_4', 'product_2'] }), size);
    expect(scene.objects).toHaveLength(objectIds.length);
    expect(scene.marks.find(m => m.text === 'ACME')).toBeTruthy();
    expect(scene.mainCandidates.map(id => scene.objects.find(o => o.id === id)?.category)).toEqual(['mascot', 'washing machine']);
    expect(scene.advertised?.map(id => scene.objects.find(o => o.id === id)?.category)).toEqual(['washing machine']);
    expect(scene.referenceWarnings).toBeUndefined();
  });

  it('an id naming nothing in the answer is not made into an object: the review is told', () => {
    const scene = parseProductScene(answer({ main_candidates: ['person_9', 'product_1'], advertised_ids: ['person_9'] }), size);
    expect(scene.objects).toHaveLength(objectIds.length);
    expect(scene.objects.some(o => /person/.test(o.id))).toBe(false);
    expect(scene.referenceWarnings).toEqual([expect.stringContaining('“person_9”')]);
  });

  it('a malformed id or an object’s invalid geometry still rejects the answer', () => {
    expect(() => parseProductScene(answer({ main_candidates: [7] }), size)).toThrow('A main candidate is not one of the objects.');
    const bad = answer({});
    bad.objects = [{ ...PRODUCT_SCENE_ANSWER.objects[0], box: { ...PRODUCT_SCENE_ANSWER.objects[0].box, w: 1.4 } }, ...PRODUCT_SCENE_ANSWER.objects.slice(1)];
    expect(() => parseProductScene(bad, size)).toThrow();
  });

  it('the saved answer is read again offline: the objects reach the review, and Review → Choose works', { timeout: 60_000 }, async () => {
    const s = await setup({ analyzer: false });
    try {
      const made = await s.form('', await productPosterPng(), { name: 'Logo as main candidate', useAi: 'false' });
      let v = await s.detected(made.body.template.id);
      const id = v.template.id, dir = join(s.protectedDir, id);
      // The completed answer saved with the template, bound to this very picture (as every live request saves it),
      // naming its logo as a main and advertised element.
      const sent = await sharp(readFileSync(join(dir, v.template.source.inputFile))).png().toBuffer(), meta = await sharp(sent).metadata();
      const picture = { width: meta.width!, height: meta.height!, mime: 'image/png', bytes: sent.length, source: { width: meta.width!, height: meta.height! } };
      const response = { id: 'resp_saved', status: 'completed', output: [], usage: { input_tokens: 4201, output_tokens: 3077 },
        output_text: JSON.stringify(answer({ main_candidates: ['product_2', 'mark_4'], advertised_ids: ['mark_4'] })) };
      writeFileSync(join(dir, 'analysis-product-completed.json'), JSON.stringify({ job: { model: 'gpt-5.6-sol', imageSha256: sha(sent), sent: picture, startedAt: new Date().toISOString(), status: 'completed', responseId: 'resp_saved' }, response }));
      expect((await s.send('POST', `/${id}/detect`, { force: true, useAi: false, savedAnswer: true })).status).toBe(202);
      v = await s.detected(id);
      expect(v.product.detection?.ai).toMatchObject({ status: 'done' });
      expect(v.product.detection?.ai?.warnings).toBeUndefined();
      expect(v.counts.products).toBeGreaterThan(0);
      expect(v.counts.characters).toBeGreaterThan(0);
      v = (await s.send('PUT', `/${id}/review`, { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ ...o, accepted: true })), texts: [], logos: [], dismissMissingText: true })).body;
      const character = v.product.objects.find(o => o.kind === 'character')!;
      const chosen = await s.send('PUT', `/${id}/selection`, { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ id: o.id, decompose: o.id === character.id })), logos: [] });
      expect(chosen.status).toBe(200);
      expect(chosen.body.product.objects.find(o => o.id === character.id)?.decompose).not.toBe(false);
    } finally { await s.close(); }
  });
});
