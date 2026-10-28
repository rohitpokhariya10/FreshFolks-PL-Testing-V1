import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { RATIO_REGEN_SIZES, ratioRegenEstimateUsd, type ReuseDraft } from '@frameflow/shared';
import { findQrCodes, protectRegenerated, regenerationPrompt, type RatioRegenerator } from './ratioRegeneration.js';
import { setup, savedTemplate, type View } from './productServer.fixture.js';
import { productPosterPng } from './productPoster.fixture.js';

// A creative regenerated in another ratio by the image model (ratioRegeneration.ts), with test doubles only: the "model"
// recomposes by placing the picture somewhere else at another size, or redraws its QR code as one that scans to
// something else, so every protection is exercised. No network, nothing charged.
const PAYLOAD = 'upi://pay?pa=frameflow.test@bank&pn=FrameFlow Test&cu=INR';
const qr = (text: string, width: number) => QRCode.toBuffer(text, { width, margin: 2, errorCorrectionLevel: 'M' });
/** A product cut-out: a rounded appliance with a dark panel and a highlight (its own transparency around it). */
const product = (w: number, h: number) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${w * 0.12}" fill="#c9ced6"/><rect x="${w * 0.12}" y="${h * 0.1}" width="${w * 0.76}" height="${h * 0.32}" rx="8" fill="#20252c"/><circle cx="${w * 0.5}" cy="${h * 0.68}" r="${w * 0.22}" fill="#5b7fb6"/><circle cx="${w * 0.5}" cy="${h * 0.68}" r="${w * 0.12}" fill="#e7eef7"/></svg>`)).png().toBuffer();
/** A poster: a warm ground with stripes, the product at (120, 380), a QR code at (620, 560). */
async function poster(code: Buffer, item: Buffer) {
  const ground = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#f6d8a8"/>${Array.from({ length: 20 }, (_, i) => `<rect x="0" y="${i * 50}" width="1000" height="18" fill="#efc98d"/>`).join('')}<rect x="590" y="530" width="300" height="300" rx="20" fill="#ffffff"/></svg>`);
  return sharp(ground).composite([{ input: item, left: 120, top: 380 }, { input: code, left: 620, top: 560 }]).png().toBuffer();
}
/** The "regenerated" picture: a 16:9 canvas, the product larger elsewhere, the QR code (as given) larger elsewhere. */
async function regenerated(code: Buffer, item?: Buffer) {
  const ground = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1152"><rect width="2048" height="1152" fill="#f3d2a0"/>${Array.from({ length: 24 }, (_, i) => `<rect x="0" y="${i * 48}" width="2048" height="16" fill="#ebc488"/>`).join('')}<rect x="1300" y="380" width="420" height="420" rx="26" fill="#ffffff"/></svg>`);
  const layers: OverlayOptions[] = [{ input: await sharp(code).resize(336, 336).png().toBuffer(), left: 1342, top: 422 }];
  if (item) layers.unshift({ input: await sharp(item).resize(Math.round(260 * 1.45), Math.round(380 * 1.45)).png().toBuffer(), left: 300, top: 420 });
  return sharp(ground).composite(layers).png().toBuffer();
}

describe('A creative regenerated in another ratio: what the image model may not change', { timeout: 60000 }, () => {
  it('finds the original QR code, keeps a regenerated one that still scans to it, and puts it back where the model redrew it', async () => {
    const item = await product(260, 380), original = await poster(await qr(PAYLOAD, 240), item);
    expect((await findQrCodes(original)).map(q => q.data)).toEqual([PAYLOAD]);
    // The model kept a QR code that scans to the same payment link: kept.
    const kept = await protectRegenerated({ original, result: await regenerated(await qr(PAYLOAD, 240), item), assets: [{ label: 'Washing machine', png: item, box: { x: 120, y: 380, width: 260, height: 380 } }] });
    expect(kept.checks.qr).toEqual([{ data: PAYLOAD, status: 'kept' }]);
    expect(kept.checks.assets).toMatchObject([{ label: 'Washing machine', status: 'restored' }]); expect(kept.checks.blocking).toEqual([]);
    // The model redrew it as a lookalike that scans to something else: the original's own pixels are put back over it.
    const redrawn = await protectRegenerated({ original, result: await regenerated(await qr('upi://pay?pa=someone.else@bank&pn=Not the merchant&cu=INR', 240), item) });
    expect(redrawn.checks.qr).toEqual([{ data: PAYLOAD, status: 'restored' }]); expect(redrawn.checks.blocking).toEqual([]);
    expect((await findQrCodes(redrawn.png)).map(q => q.data)).toEqual([PAYLOAD]);
    expect(await sharp(redrawn.png).metadata()).toMatchObject({ width: 2048, height: 1152 });
  });

  it('puts the product back with its own pixels, and blocks a result where a product cannot be found', async () => {
    const item = await product(260, 380), original = await poster(await qr(PAYLOAD, 240), item), asset = { label: 'Washing machine', png: item, box: { x: 120, y: 380, width: 260, height: 380 } };
    // The model's imitation of the product (a different panel and drum): replaced by the product's own picture.
    const imitation = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="380"><rect width="260" height="380" rx="31" fill="#c4cad3"/><rect x="40" y="40" width="180" height="110" rx="8" fill="#2a3038"/><circle cx="130" cy="258" r="60" fill="#6688bb"/></svg>')).png().toBuffer();
    const out = await protectRegenerated({ original, result: await regenerated(await qr(PAYLOAD, 240), imitation), assets: [asset] });
    expect(out.checks.assets[0]).toMatchObject({ status: 'restored' });
    // Where it was found, the pixels are the product's own (its panel's colour exactly).
    const { data } = await sharp(out.png).extract({ left: 300 + Math.round(377 * 0.5), top: 420 + Math.round(551 * 0.25), width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([0x20, 0x25, 0x2c]);
    // Left out by the model: not found, blocking.
    const gone = await protectRegenerated({ original, result: await regenerated(await qr(PAYLOAD, 240)), assets: [asset] });
    expect(gone.checks.assets[0]).toMatchObject({ status: 'not-found' }); expect(gone.checks.blocking.join(' ')).toMatch(/Washing machine could not be found/);
    // A logo (not required) not found is left for the person, never blocking.
    const logo = await protectRegenerated({ original, result: await regenerated(await qr(PAYLOAD, 240)), assets: [{ ...asset, label: 'Bank logo', required: false }] });
    expect(logo.checks.blocking).toEqual([]);
  });

  it('asks for the new shape, the exact words, and nothing added', () => {
    const p = regenerationPrompt('9:16', ['Get ₹100 voucher + free soundbox.', 'Time period: 1–31 October']);
    expect(p).toMatch(/tall vertical 9:16/); expect(p).toContain('"Get ₹100 voucher + free soundbox."'); expect(p).toMatch(/Do not add any new products, logos, people or QR codes/);
    expect(RATIO_REGEN_SIZES['16:9']).toEqual({ width: 2048, height: 1152 }); expect(ratioRegenEstimateUsd('16:9')).toBeGreaterThan(0.3);
  });
});

/** TEST DOUBLE of the image model: the picture placed whole on a soft cover of itself at the ratio's size (nothing generated). */
const calls: { size: { width: number; height: number }; prompt: string }[] = [];
const regenerator: RatioRegenerator = { model: 'test image regenerator (no network)', offline: false, async regenerate({ image, prompt, size }) {
  calls.push({ size, prompt });
  const cover = await sharp(image).resize(size.width, size.height, { fit: 'cover' }).blur(30).png().toBuffer(), whole = await sharp(image).resize(Math.round(size.width * 0.94), Math.round(size.height * 0.94), { fit: 'inside' }).png().toBuffer(), m = await sharp(whole).metadata();
  return { image: await sharp(cover).composite([{ input: whole, left: Math.round((size.width - m.width!) / 2), top: Math.round((size.height - m.height!) / 2) }]).png().toBuffer(), requestId: 'test', costUsd: 0.05 };
} };
const until = async (s: Awaited<ReturnType<typeof setup>>, id: string, done: (v: View) => boolean) => { for (let i = 0; i < 2400; i++) { const v = (await s.call<View>(`/${id}`)).body; if (done(v)) return v; await new Promise(r => setTimeout(r, 25)); } throw new Error('timed out'); };

describe('First-time master creation regenerated in the chosen size (HTTP, temporary store, test doubles)', { timeout: 180000 }, () => {
  it('regenerates only after the cost is approved, waits for the person, and the approved picture is what the pipeline processes', async () => {
    const s = await setup({ regenerator });
    try {
      expect((await s.call<{ available: boolean; estimates: Record<string, number> }>('/regeneration')).body).toMatchObject({ available: true, estimates: { '16:9': ratioRegenEstimateUsd('16:9') } });
      // Not approved: nothing is created or sent.
      expect((await s.form('', await productPosterPng(), { name: 'No approval', aspectRatio: '16:9', regenerate: 'true' })).status).toBe(400);
      const made = await s.form<View>('', await productPosterPng(), { name: 'Regenerated', aspectRatio: '16:9', regenerate: 'true', approveUsd: String(ratioRegenEstimateUsd('16:9')) }), id = made.body.template.id;
      const waiting = await until(s, id, v => v.stage === 'regenerated');
      expect(waiting.product.regeneration).toMatchObject({ status: 'ready', ratio: '16:9', result: { width: 2048, height: 1152, costUsd: 0.05, checks: { blocking: [] } } });
      expect(calls.at(-1)).toMatchObject({ size: { width: 2048, height: 1152 } }); expect(calls.at(-1)!.prompt).toMatch(/wide landscape 16:9/);
      expect(waiting.product.detection).toBeUndefined();
      // Not looked at: refused.
      expect((await s.send('POST', `/${id}/regeneration`, { use: 'regenerated' })).status).toBe(400);
      await s.send('POST', `/${id}/regeneration`, { use: 'regenerated', approved: true });
      const found = await s.detected(id);
      // The picture the pipeline processes is the regenerated one, exactly 16:9; the upload is kept.
      expect(found.template.source).toMatchObject({ width: 2048, height: 1152, file: waiting.product.regeneration!.result!.file });
      expect(found.product.regeneration).toMatchObject({ status: 'approved', original: { file: 'source.png' } });
      expect(found.product.detection?.status).toBe('done');
      // Declined: the upload as it is.
      const other = (await s.form<View>('', await productPosterPng(), { name: 'Declined', aspectRatio: '9:16', regenerate: 'true', approveUsd: '1' })).body.template.id, before = (await s.call<View>(`/${other}`)).body.template.source;
      await until(s, other, v => v.stage === 'regenerated');
      await s.send('POST', `/${other}/regeneration`, { use: 'original' });
      const kept = await s.detected(other);
      expect(kept.template.source).toEqual(before); expect(kept.product.regeneration?.status).toBe('declined');
      // Original: no regeneration, exactly as before.
      const plain = await savedTemplate(s, await productPosterPng());
      expect(plain.product.regeneration).toBeUndefined();
    } finally { await s.close(); }
  });
});

describe('Create Offer Creative regenerated in the chosen size (HTTP, temporary store, test doubles)', { timeout: 180000 }, () => {
  it('regenerates the draft with the person\'s product put back exactly, and the approved picture becomes an editable template through the pipeline', async () => {
    const s = await setup({ regenerator });
    try {
      const v = await savedTemplate(s, await productPosterPng()), id = v.template.id;
      let d = (await s.send<ReuseDraft>('POST', `/${id}/reuse`, { simple: true, ratios: ['9:16'] })).body;
      const photo = await product(300, 420);
      const f = new FormData(); f.set('kind', 'product'); f.set('label', 'Washing machine'); f.set('expectedRevision', String(d.revision)); f.append('image', new Blob([new Uint8Array(photo)], { type: 'image/png' }), 'washer.png');
      d = ((await (await fetch(`${s.base}/${id}/reuse/${d.id}/uploads`, { method: 'POST', body: f })).json()) as { draft: ReuseDraft }).draft;
      // Not approved: refused, nothing sent.
      const sent = calls.length;
      expect((await s.send('POST', `/${id}/reuse/${d.id}/regenerate-image`, { ratio: '9:16' })).status).toBe(400);
      expect(calls.length).toBe(sent);
      d = (await s.send<ReuseDraft>('POST', `/${id}/reuse/${d.id}/regenerate-image`, { ratio: '9:16', approveUsd: ratioRegenEstimateUsd('9:16') })).body;
      const g = d.regenImages!['9:16']!;
      expect(g).toMatchObject({ width: 1152, height: 2048, draftRevision: d.revision, costUsd: 0.05, checks: { blocking: [] } });
      expect(g.checks.assets).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Washing machine', status: 'restored' })]));
      expect(calls.at(-1)!.prompt).toMatch(/tall vertical 9:16/);
      expect(readFileSync(join(s.protectedDir, id, g.file)).length).toBeGreaterThan(0);
      // Not looked at: refused. Approved: a template of its own, its elements found in the regenerated picture.
      expect((await s.send('POST', `/${id}/reuse/${d.id}/regenerated/continue`, { ratio: '9:16' })).status).toBe(400);
      const cont = (await s.send<{ templateId: string; reused: boolean }>('POST', `/${id}/reuse/${d.id}/regenerated/continue`, { ratio: '9:16', approved: true, useAi: true })).body;
      const made = await s.detected(cont.templateId);
      expect(made.template.source).toMatchObject({ width: 1152, height: 2048 }); expect(made.product.targetRatio).toBe('9:16');
      expect(made.product.regeneration).toMatchObject({ status: 'approved', ratio: '9:16', from: { templateId: id, draftId: d.id } });
      expect(made.product.detection?.status).toBe('done');
      // Asked again: the same template.
      expect((await s.send<{ templateId: string; reused: boolean }>('POST', `/${id}/reuse/${d.id}/regenerated/continue`, { ratio: '9:16', approved: true })).body).toEqual({ templateId: cont.templateId, reused: true });
    } finally { await s.close(); }
  });
});
