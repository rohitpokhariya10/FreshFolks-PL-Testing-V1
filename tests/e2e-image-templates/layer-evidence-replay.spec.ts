/** Real recorded preparation seeded via FRAMEFLOW_SAVED_VARIATION_FIXTURE; no substituted cutouts. */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import type { ProductCreative } from '@frameflow/shared';
import type { ProductView } from '../../client/src/features/productTemplates/api';

const API = '/api/layerize-experiment/product-templates';
const id = process.env.FRAMEFLOW_EVIDENCE_TEMPLATE ?? 'pt-a6f742a32148';
const out = process.env.FRAMEFLOW_EVIDENCE_OUT ?? 'test-results/evidence-browser';
test.use({ extraHTTPHeaders: { origin: `http://127.0.0.1:${process.env.FRAMEFLOW_OFFLINE_E2E_PORT ?? 3317}` }, actionTimeout: 30000 });
test.setTimeout(240000);
type Layer = { id: string; assetId?: string; x: number; width: number; visible: boolean };
type Doc = { variants: { id: string; importedFrom?: { runId?: string }; layers: Layer[] }[] };

test('recorded prepare layers survive Konva move, hide, resize, duplicate, save, reload and export', async ({ page, request }, info) => {
  test.skip(!process.env.FRAMEFLOW_SAVED_VARIATION_FIXTURE || info.project.name !== 'desktop', 'Requires an isolated recorded preparation store.');
  mkdirSync(out, { recursive: true });
  await page.route(url => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1', r => r.abort());
  const view = await (await request.get(`${API}/${id}`)).json() as ProductView;
  const objs = view.product.objects.filter(o => o.cutout), fridge = objs.find(o => /refrigerator/i.test(o.label))!;
  expect(fridge.cutout!.evidence).toBeDefined();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('frameflow:project:v1')!) as Doc);
  const png = async (name: string) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    const path = `${out}/${name}.png`; await (await download).saveAs(path);
    const meta = await sharp(path).metadata(); expect(meta.width).toBeGreaterThan(0); return path;
  };
  await page.goto('/'); await page.getByRole('button', { name: 'OpenAI + Seedream test' }).click();
  const panel = page.getByRole('dialog', { name: 'OpenAI + Seedream test' });
  await panel.getByRole('tab', { name: 'Offer Templates', exact: true }).click();
  await panel.getByRole('article', { name: `Product template ${view.template.name}`, exact: true }).getByRole('button', { name: 'Edit master' }).click();
  const opening = page.waitForResponse(r => r.url().endsWith(`/${id}/open-editor`) && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Open in Editor', exact: true }).click();
  const { runId } = await (await opening).json() as { runId: string };
  await expect(panel).toBeHidden({ timeout: 60000 });
  await expect.poll(async () => (await read()).variants.some(v => v.importedFrom?.runId === runId)).toBe(true);
  const variant = (await read()).variants.find(v => v.importedFrom?.runId === runId)!;
  for (const o of [...objs, ...(view.product.prepared!.pieces ?? [])]) expect(variant.layers.some(l => l.assetId?.includes(o.cutout!.file))).toBe(true);
  await png('01-composed');
  for (const o of objs) {
    await page.getByRole('button', { name: `Hide ${o.label}`, exact: true }).click();
    await page.getByRole('button', { name: `Show ${o.label}`, exact: true }).click();
  }
  const lid = `object-${fridge.id}`, original = variant.layers.find(l => l.id === lid)!;
  await page.locator(`[data-layer-id="${lid}"] .layer-select`).click();
  const x = Math.round(original.x + original.width * 1.6), width = Math.round(original.width * 0.85);
  await page.getByLabel('X', { exact: true }).fill(String(x)); await page.getByLabel('X', { exact: true }).press('Enter');
  await page.getByLabel('Width', { exact: true }).fill(String(width)); await page.getByLabel('Width', { exact: true }).press('Enter');
  await expect.poll(async () => Math.round((await read()).variants.find(v => v.id === variant.id)!.layers.find(l => l.id === lid)!.x)).toBe(x);
  await png('02-moved-resized');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect.poll(async () => (await read()).variants.find(v => v.id === variant.id)!.layers.filter(l => l.assetId === original.assetId).length).toBe(2);
  await png('03-duplicated');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Save creative', exact: true }).click();
  await expect(page.getByText(/Saved to creative · revision \d+/)).toBeVisible({ timeout: 60000 });
  await page.reload();
  const after = (await read()).variants.find(v => v.id === variant.id)!.layers.find(l => l.id === lid)!;
  expect(Math.round(after.x)).toBe(x); expect(Math.round(after.width)).toBe(width); expect(after.assetId).toBe(original.assetId);
  await png('04-reloaded');
  const list = (await (await request.get(`${API}/${id}/creatives`)).json()).creatives as { id: string; name: string }[];
  const master = list.find(c => /master editor/i.test(c.name))!;
  const copy = await (await request.post(`${API}/${id}/creatives/${master.id}/duplicate`, { data: {} })).json() as ProductCreative;
  expect(copy.objects.find(o => o.id === fridge.id)!.asset.file).toBe(fridge.cutout!.file);
});
