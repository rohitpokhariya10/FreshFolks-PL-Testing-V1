/**
 * Reference-preserving AI layer edits, offline. A fake image model edits the image it is sent, so these tests check what
 * FrameFlow sends (which images, framing, mask), what it keeps (compositing, transparency, placement) and what the identity
 * gate decides. They cannot show how faithfully a real model edits: that needs an approved live request.
 */
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { LayerEditCandidate, LayerEditRegion, LayerEditSource, LayerEditTarget } from '@frameflow/shared';
import type { RatioRegenerator } from './protectedTemplates/product/ratioRegeneration.js';
import { sha256 } from './protectedTemplates/pixels.js';
import { createLayerEdits } from './layerEdit.js';
import { closedLike, fridge, fringed, groundOf, maskArea, onCanvas, opened, paintedWithOutsideDrift, recoloured, replacedWith, unchanged, washer, washerSvg, type EditRequest } from './layerEdit.fixture.js';
import { assessIdentity } from './layerEditIdentity.js';
import { prepareLayerEdit, validateLayerEdit } from './layerEditImage.js';
import { classifyLayerEdit } from './layerEditIntent.js';

const target: LayerEditTarget = { kind: 'creative', templateId: 'pt-test', creativeId: 'pc-123abc', layerId: 'object-po-1', revision: 1 };
type Edit = (r: EditRequest) => Buffer | Promise<Buffer>;
/** One layer of a saved creative: `saved` is its image, `original` the product the template imported. */
function studio(saved: Buffer, original = saved, dir = mkdtempSync(join(tmpdir(), 'layer-edit-identity-'))) {
  let edit: Edit = unchanged;
  const regenerate = vi.fn<RatioRegenerator['regenerate']>(async r => ({ image: await edit(r), requestId: 'req_fake', costUsd: 0.2 }));
  const resolve = vi.fn(async () => ({ bytes: saved, name: 'Appliance', original }));
  const service = createLayerEdits({ dir, resolve, provider: () => ({ model: 'gpt-image-2', offline: false, regenerate }) });
  const source = (c?: LayerEditCandidate): LayerEditSource => c ? { target, sourceSha256: c.image.sha256, sourceCandidateId: c.operationId } : { target, sourceSha256: sha256(saved) };
  async function run(prompt: string, with_: Edit, from?: LayerEditCandidate, extra: { region?: LayerEditRegion; confirmAmbiguous?: boolean; useOriginalReference?: boolean } = {}) {
    edit = with_;
    const quote = await service.estimate({ ...source(from), prompt, ...extra });
    return { quote, candidate: await service.generate({ ...source(from), ...extra, prompt, operationId: randomUUID(), model: 'gpt-image-2', approveUsd: quote.estimateUsd }) };
  }
  const record = (id: string) => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  return { service, regenerate, resolve, run, record, dir, setSaved: (b: Buffer) => { saved = b; } };
}
const check = (c: LayerEditCandidate, id: string) => c.validation.checks!.find(x => x.id === id)!;
const bytesOf = (c: LayerEditCandidate) => Buffer.from(c.image.base64, 'base64');

describe('reference-preserving AI layer edits (fake model, real pipeline)', () => {
  it('1. opens a refrigerator from its exact source image; the doors keep their own pixels; review is asked for, not identity claimed', async () => {
    const original = await fridge(), s = studio(original);
    const { quote, candidate } = await s.run('Open both doors', opened);
    const sent = s.regenerate.mock.calls[0][0], prepared = await prepareLayerEdit(original, { intent: classifyLayerEdit('Open both doors') });
    // The genuine saved product, alone, in the square frame that leaves room for the doors (cost unchanged).
    expect(sent.image).toEqual(prepared.image); expect(sent.references).toBeUndefined(); expect(sent.mask).toBeUndefined();
    expect(sent.size).toEqual({ width: 1024, height: 1024 }); expect(quote.estimateUsd).toBe(0.27);
    expect(quote.intent).toMatchObject({ operations: ['state'], preserveIdentity: true, expandsSilhouette: true });
    expect(sent.prompt).toContain('change of physical state'); expect(sent.prompt).not.toContain('Change only the colour');
    expect(sent.prompt).toMatch(/Use #[0-9a-f]{6} only around the outside of the object .* Never use it for seams, gaps between doors/);
    // Measured colours of this product, so a dark finish is not redrawn light.
    expect(prepared.measured.palette[0].hex).toMatch(/^#[0-9a-f]{6}$/); expect(sent.prompt).toContain(prepared.measured.palette[0].hex);
    expect(candidate.geometry.width).toBeGreaterThan(1.8); expect(candidate.geometry.height).toBeCloseTo(1, 1);
    expect(candidate.validation.identity).toBe('review-required');
    expect(check(candidate, 'contamination').status).toBe('pass'); expect(check(candidate, 'scale').status).toBe('pass');
    expect(check(candidate, 'structure').status).toBe('skipped'); expect(candidate.validation.limitation).toMatch(/layout and parts/);
  });

  it('1b. flags the recorded refrigerator failure mode: background colour painted into the seam and repainted doors', async () => {
    const s = studio(await fridge());
    const { candidate } = await s.run('Open both doors', r => opened(r, true));
    expect(candidate.validation.identity).toBe('drift-suspected');
    expect(check(candidate, 'contamination')).toMatchObject({ status: 'fail', detail: expect.stringMatching(/keying colour #[0-9a-f]{6}/) });
  });

  it('2. closes an appliance door after opening it: the original is attached as image 2 and the result is checked strictly against it', async () => {
    const original = await washer(), s = studio(original);
    const open = (await s.run('Open the door', opened)).candidate;
    await s.service.apply(open.operationId);
    const { quote, candidate } = await s.run('Close the door', r => closedLike(r), open);
    expect(quote.references).toMatchObject({ current: { aiEdits: 1 }, original: { sha256: sha256(original), attached: true, instructions: ['Open the door'], unrecordedEdits: 0 } });
    expect(quote.estimateUsd).toBe(0.32); // One extra reference image, shown before approval.
    const sent = s.regenerate.mock.calls[1][0], openBytes = bytesOf(open);
    const prepared = await prepareLayerEdit(openBytes, { intent: classifyLayerEdit('Close the door'), identity: original });
    expect(sent.image).toEqual(prepared.image); expect(sent.references).toEqual(prepared.references); expect(sent.references).toHaveLength(1);
    expect(sent.prompt).toContain('Image 2 shows the same product as originally imported, before 1 earlier AI edit (recorded instructions, oldest first: “Open the door”)');
    expect(candidate.validation.identity).toBe('consistent');
    expect(['scale', 'finish', 'structure', 'silhouette'].map(id => check(candidate, id).status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(check(candidate, 'structure').detail).toContain('before the edit this one reverses');
    // The same reversal drawn as another model of washing machine is a different product.
    const drift = (await s.run('Close the door', r => closedLike(r, { svg: washerSvg('#2b2e33', 'square', 50), width: 200, height: 240 }), open)).candidate;
    expect(drift.validation.identity).toBe('drift-suspected'); expect(check(drift, 'structure').status).toBe('fail');
  });

  it('3. repairs a washing machine without changing its model: an unchanged result is consistent, another model is flagged', async () => {
    const original = await washer(), s = studio(original);
    const { quote, candidate } = await s.run('Remove the scratches on the door', unchanged);
    // Not a shape change: the product fills 80 % of a frame shaped like it, within the square's pixel budget and price.
    const p = await prepareLayerEdit(original, { intent: quote.intent });
    expect(quote.size).toEqual({ width: 928, height: 1120 }); expect(quote.size.width * quote.size.height).toBeLessThanOrEqual(1024 * 1024);
    expect(quote.estimateUsd).toBeLessThanOrEqual(0.27); expect(p.rect.height / p.size.height).toBeCloseTo(0.8, 1);
    expect(candidate.validation.identity).toBe('consistent'); expect(candidate.geometry.width).toBeCloseTo(1, 1);
    const other = (await s.run('Remove the scratches on the door', r => replacedWith(r, washerSvg('#2b2e33', 'square', 50), { width: 200, height: 240 }))).candidate;
    expect(other.validation.identity).toBe('drift-suspected');
    expect(check(other, 'structure').status).toBe('fail'); expect(check(other, 'finish').status).not.toBe('pass');
  });

  it('4. changes an explicitly requested colour without changing the geometry; a recolour that is another product is flagged', async () => {
    const s = studio(await fridge());
    const red = (await s.run('Make it red', r => recoloured(r, '#c0262d'))).candidate;
    expect(red.validation.identity).toBe('consistent');
    expect(check(red, 'finish')).toMatchObject({ status: 'skipped', detail: expect.stringContaining('was requested') });
    expect(['scale', 'structure', 'silhouette'].map(id => check(red, id).status)).toEqual(['pass', 'pass', 'pass']);
    expect(s.regenerate.mock.calls[0][0].prompt).toContain('Change only the colour');
    const reshaped = (await s.run('Make it red', r => replacedWith(r, washerSvg('#c0262d'), { width: 200, height: 240 }))).candidate;
    expect(reshaped.validation.identity).toBe('drift-suspected'); expect(check(reshaped, 'structure').status).toBe('fail');
  });

  it('5. limits a local feature edit to a selected area: the mask opens only that area and every pixel outside it stays the original', async () => {
    const original = await fridge(), s = studio(original), region = { x: 0.5, y: 0.6, width: 0.4, height: 0.2 }, prompt = 'Remove the sticker on the right door';
    let opening = { left: 0, top: 0, width: 0, height: 0 };
    const { quote, candidate } = await s.run(prompt, async r => { opening = await maskArea(r.mask!); return paintedWithOutsideDrift(r, opening, '#3f4246'); }, undefined, { region });
    expect(quote.intent?.clarification).toBeUndefined(); expect(quote.region).toEqual(region);
    const sent = s.regenerate.mock.calls[0][0], p = await prepareLayerEdit(original, { intent: quote.intent, region });
    expect(sent.mask).toEqual(p.mask); expect(sent.references).toBeUndefined();
    const area = await maskArea(sent.mask!);
    expect(area).toMatchObject({ ...p.regionRect, open: p.regionRect!.width * p.regionRect!.height, size: p.size });
    // The region maps onto the product: 40 % × 20 % of it, plus a small margin.
    expect(area.width / p.rect.width).toBeGreaterThan(0.4); expect(area.width / p.rect.width).toBeLessThan(0.5);
    // Outside the area, the result is exactly the reference's own cut-out, although the model brightened everything there.
    const reference = await validateLayerEdit(p.image, p), result = bytesOf(candidate);
    const [a, b] = await Promise.all([reference.png, result].map(x => sharp(x).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
    expect([b.info.width, b.info.height]).toEqual([a.info.width, a.info.height]);
    const cut = { left: p.rect.left, top: p.rect.top }; // The product's alpha fills its rectangle, so the cut-out starts there.
    let outside = 0, differing = 0;
    for (let y = 0; y < a.info.height; y++) for (let x = 0; x < a.info.width; x++) {
      const X = x + cut.left, Y = y + cut.top, inArea = X >= area.left && X < area.left + area.width && Y >= area.top && Y < area.top + area.height;
      if (inArea) continue;
      outside++; const i = (y * a.info.width + x) * 4;
      if ([0, 1, 2, 3].some(c => a.data[i + c] !== b.data[i + c])) differing++;
    }
    expect(outside).toBeGreaterThan(10000); expect(differing).toBe(0);
    expect(check(candidate, 'outside-region')).toMatchObject({ status: 'warn', detail: expect.stringContaining('restored from the original') });
    expect(candidate.validation.identity).toBe('review-required');
    expect(candidate.geometry.width).toBeCloseTo(1, 2); expect(candidate.geometry.centerX).toBeCloseTo(0.5, 2);
    // Moving parts cannot fit inside an area limit: that needs clarification before anything is sent.
    expect((await s.service.estimate({ target, sourceSha256: sha256(original), prompt: 'Open both doors', region })).intent?.clarification).toMatch(/area limit/);
  });

  it('6. allows an explicitly requested replacement without identity checks, and without an identity confirmation', async () => {
    const s = studio(await fridge());
    const { quote, candidate } = await s.run('Replace it with a microwave oven', r => replacedWith(r, '<rect width="300" height="180" rx="12" fill="#222"/><rect x="20" y="20" width="200" height="140" fill="#556"/>', { width: 300, height: 180 }));
    expect(quote.intent).toMatchObject({ operations: ['replace'], preserveIdentity: false });
    expect(s.regenerate.mock.calls[0][0].prompt).not.toContain('It must remain the exact same physical product');
    expect(candidate.validation).toMatchObject({ identity: 'review-required', limitation: expect.stringContaining('replacement was requested') });
    expect(['scale', 'finish', 'structure', 'silhouette'].every(id => check(candidate, id).status === 'skipped')).toBe(true);
    expect((await s.service.apply(candidate.operationId)).status).toBe('applied');
  });

  it('7. keeps transparent, unfringed edges and the original placement for an object inside a full-canvas layer', async () => {
    const asset = await onCanvas(await fridge()), s = studio(asset);
    const { candidate } = await s.run('Make it red', async r => fringed({ ...r, image: await recoloured(r, '#c0262d') }));
    const ground = groundOf(s.regenerate.mock.calls[0][0].prompt);
    expect(check(candidate, 'edges').status).toBe('pass');
    const { data, info } = await sharp(bytesOf(candidate)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); expect(data[(info.width * info.height - 1) * 4 + 3]).toBe(0);
    // No outline pixel is tinted by the keying colour any more.
    const key = ground.slice(1).match(/../g)!.map(v => parseInt(v, 16)), hi = [0, 1, 2].filter(c => key[c] > 128), lo = [0, 1, 2].filter(c => key[c] <= 128);
    let tinted = 0;
    for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] > 0 && Math.min(...hi.map(c => data[i * 4 + c])) - Math.max(...lo.map(c => data[i * 4 + c])) > 60) tinted++;
    expect(tinted).toBe(0);
    // Centre and size relative to the 1254² layer: the object stays where it was on the canvas.
    expect(candidate.geometry.centerX).toBeCloseTo((534 + 100) / 1254, 3); expect(candidate.geometry.centerY).toBeCloseTo((503 + 190) / 1254, 3);
    expect(candidate.geometry.width).toBeCloseTo(200 / 1254, 2); expect(candidate.geometry.height).toBeCloseTo(380 / 1254, 2);
  });

  it('8–9. keeps a flagged result for review: recoverable, never applied without confirmation, rejectable without losing the original', async () => {
    const original = await fridge(), s = studio(original);
    const flagged = (await s.run('Remove the logo', r => replacedWith(r, washerSvg(), { width: 200, height: 240 }))).candidate;
    expect(flagged.validation.identity).toBe('drift-suspected');
    expect((await s.service.status(flagged.operationId)).candidate?.validation.identity).toBe('drift-suspected'); // Recovery shows the warning.
    await expect(s.service.apply(flagged.operationId)).rejects.toMatchObject({ code: 'IDENTITY_REVIEW_REQUIRED' });
    expect(s.record(flagged.operationId).status).toBe('candidate');
    await s.service.discard(flagged.operationId, 'identity');
    const status = await s.service.status(flagged.operationId);
    expect(status).toMatchObject({ status: 'discarded' }); expect(status.candidate).toBeUndefined();
    const kept = s.record(flagged.operationId);
    expect(kept.rejected.reason).toBe('identity'); expect(kept.candidate.image.sha256).toBe(flagged.image.sha256);
    await expect(s.service.apply(flagged.operationId, undefined, { acceptIdentityRisk: true })).rejects.toThrow('no longer available');
    // Confirming after checking applies it, and the confirmation is recorded.
    const second = (await s.run('Remove the logo', r => replacedWith(r, washerSvg(), { width: 200, height: 240 }))).candidate;
    expect((await s.service.apply(second.operationId, undefined, { acceptIdentityRisk: true })).status).toBe('applied');
    expect(s.record(second.operationId).identityOverride.at).toBeGreaterThan(0);
    expect(sha256(original)).toBe(sha256(await fridge())); expect(s.regenerate).toHaveBeenCalledTimes(2); // No automatic retry.
  });

  it('10. keeps stale-layer protection for flagged results, and never sends an ambiguous instruction without confirmation', async () => {
    const original = await fridge(), s = studio(original);
    const flagged = (await s.run('Remove the logo', r => replacedWith(r, washerSvg(), { width: 200, height: 240 }))).candidate;
    s.setSaved(await fridge('#9aa0a6'));
    await expect(s.service.apply(flagged.operationId, undefined, { acceptIdentityRisk: true })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    s.setSaved(original);
    const instruction = 'Just open the door and close it out in the refrigerator.';
    const quote = await s.service.estimate({ target, sourceSha256: sha256(original), prompt: instruction });
    expect(quote.intent?.clarification).toMatch(/both open and close/);
    const id = randomUUID();
    await expect(s.service.generate({ target, sourceSha256: sha256(original), prompt: instruction, operationId: id, model: 'gpt-image-2', approveUsd: quote.estimateUsd })).rejects.toMatchObject({ code: 'CLARIFICATION_REQUIRED' });
    expect(existsSync(join(s.dir, `${id}.json`))).toBe(false); expect(s.regenerate).toHaveBeenCalledTimes(1);
    await s.run(instruction, opened, undefined, { confirmAmbiguous: true });
    expect(s.regenerate).toHaveBeenCalledTimes(2);
  });

  it('accepts a pose that grows in both directions, and flags a product redrawn smaller in every direction', async () => {
    const image = await fridge(), intent = classifyLayerEdit('Raise the left arm'), scale = async (width: number, height: number) =>
      (await assessIdentity({ candidate: image, reference: image, intent, geometry: { width, height }, ground: '#00ff00' })).checks.find(c => c.id === 'scale')!.status;
    expect(await scale(2, 1.29)).toBe('pass'); expect(await scale(1.63, 1.05)).toBe('pass'); expect(await scale(0.69, 1.05)).toBe('pass');
    expect(await scale(0.75, 0.78)).toBe('warn'); expect(await scale(0.6, 0.62)).toBe('fail'); expect(await scale(2.2, 2.1)).toBe('fail');
  });

  it('never pairs an untraceable or replaced layer with the template product, and lets the person leave the original out', async () => {
    const s = studio(await washer(), await fridge()); // An uploaded washer where the template had a fridge.
    const { quote } = await s.run('Make it red', r => recoloured(r, '#c0262d'));
    expect(quote.references?.original).toBeUndefined(); expect(quote.references?.unavailable).toMatch(/no recorded AI edits connect it/);
    expect(s.regenerate.mock.calls[0][0].references).toBeUndefined(); expect(s.regenerate.mock.calls[0][0].prompt).not.toContain('Image 2');
    const t = studio(await fridge()), open = (await t.run('Open both doors', opened)).candidate;
    await t.service.apply(open.operationId);
    const without = await t.run('Make the inside brighter', unchanged, open, { useOriginalReference: false });
    expect(without.quote.references?.original).toMatchObject({ attached: false }); expect(without.quote.estimateUsd).toBe(0.27);
    expect(t.regenerate.mock.calls[1][0].references).toBeUndefined();
  });

  it('traces lineage across a save (identical bytes) and after the preview expires', async () => {
    const original = await fridge(), s = studio(original);
    const open = (await s.run('Open both doors', opened)).candidate;
    await s.service.apply(open.operationId);
    s.setSaved(bytesOf(open)); // Save creative stores the applied image byte for byte.
    const record = s.record(open.operationId); delete record.candidate; record.status = 'discarded'; writeFileSync(join(s.dir, `${open.operationId}.json`), JSON.stringify(record));
    const quote = await s.service.estimate({ target: { ...target, revision: 2 }, sourceSha256: open.image.sha256, prompt: 'Close the doors' });
    expect(quote.references?.original).toMatchObject({ sha256: sha256(original), instructions: ['Open both doors'] });
  });
});

// --- recorded refrigerator edits (git-ignored artifacts; skipped where they are absent, such as CI) ---------------------
const ARTIFACTS = join(import.meta.dirname, '../../../artifacts/decomposition'), EDITS = join(ARTIFACTS, 'layerize-experiment/layer-edits');
const FRIDGE = join(ARTIFACTS, 'protected-templates/pt-0dd04956555b/pcut-po-26b435b116-80b0c3b234c6.png');
const OPEN = 'b4a8b638-6f54-4d3a-8aa5-2f3ca95d1704', CLOSE = 'b875268c-5c83-4f15-aa0d-11a29a6ce6ab';
const real = existsSync(FRIDGE) && existsSync(join(EDITS, `${OPEN}.json`)) && existsSync(join(EDITS, `${CLOSE}.json`));
describe.skipIf(!real)('recorded Ornate Golden refrigerator edits (real fixtures)', () => {
  const recorded = (id: string) => JSON.parse(readFileSync(join(EDITS, `${id}.json`), 'utf8'));
  it('flags both recorded results as drift and traces the current layer back to the original product', async () => {
    const original = readFileSync(FRIDGE), open = recorded(OPEN), close = recorded(CLOSE), image = (r: { candidate: LayerEditCandidate }) => bytesOf(r.candidate);
    const a = await assessIdentity({ candidate: image(open), reference: original, intent: classifyLayerEdit('Open both doors'), geometry: open.candidate.geometry, ground: '#00ff00' });
    expect(a.status).toBe('drift-suspected'); expect(a.checks.find(c => c.id === 'contamination')?.detail).toContain('#00ff00');
    const g1 = open.candidate.geometry, g2 = close.candidate.geometry;
    const b = await assessIdentity({ candidate: image(close), reference: image(open), original, intent: classifyLayerEdit('Close the doors'), geometry: g2, ground: '#ff00ff',
      expected: { image: original, scale: { width: g1.width * g2.width, height: g1.height * g2.height } } });
    expect(b.status).toBe('drift-suspected');
    expect(b.checks.filter(c => c.status !== 'pass').map(c => c.id)).toEqual(expect.arrayContaining(['contamination', 'scale', 'finish', 'structure']));
    // The saved layer is the "close" result: two applied edits (instructions not recorded then) lead back to the original.
    const dir = mkdtempSync(join(tmpdir(), 'layer-edit-real-'));
    for (const id of [OPEN, CLOSE]) cpSync(join(EDITS, `${id}.json`), join(dir, `${id}.json`));
    const target = open.source.target as LayerEditTarget;
    const service = createLayerEdits({ dir, provider: () => undefined, resolve: async () => ({ bytes: image(close), name: 'Multi-door refrigerator', original }) });
    const quote = await service.estimate({ target, sourceSha256: close.candidate.image.sha256, prompt: 'Close the doors' });
    expect(quote.references).toMatchObject({ current: { aiEdits: 2 }, original: { sha256: sha256(original), attached: true, instructions: [], unrecordedEdits: 2 } });
  }, 60000);
  it('frames the real 191 × 355 refrigerator larger for an edit that keeps its outline, at no extra cost', async () => {
    const original = readFileSync(FRIDGE);
    const fitted = await prepareLayerEdit(original, { intent: classifyLayerEdit('Make the handles chrome') }), square = await prepareLayerEdit(original, { intent: classifyLayerEdit('Open both doors') });
    expect(square.rect.height).toBe(560); expect(fitted.rect.height).toBeGreaterThan(1000);
    expect(fitted.size.width * fitted.size.height).toBeLessThanOrEqual(1024 * 1024);
  });
});
