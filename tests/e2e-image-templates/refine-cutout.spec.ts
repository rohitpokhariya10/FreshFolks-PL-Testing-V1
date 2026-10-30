import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type { ProductCreative } from '@frameflow/shared';
import type { ProductView } from '../../client/src/features/productTemplates/api';

// Refine Cutout in the creative editor (offline: nothing leaves the machine). A product layer cleaned for free, compared
// with the current picture, approved: only that layer's picture changes, in a new revision; the AI repair shows its
// provider, model, size and estimate first and sends nothing until approved.
const API = '/api/layerize-experiment/product-templates', OUT = 'test-results/refine-cutout';
test.use({ extraHTTPHeaders: { origin: `http://127.0.0.1:${process.env.FRAMEFLOW_OFFLINE_E2E_PORT ?? 3317}` }, actionTimeout: 30000 });
test.setTimeout(240000);

async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'OpenAI + Seedream test' }).click();
  const panel = page.getByRole('dialog', { name: 'OpenAI + Seedream test' });
  await panel.getByRole('tab', { name: 'Offer Templates', exact: true }).click();
  return panel;
}
async function savedTemplate(request: APIRequestContext, name: string) {
  const poster = await (await request.get('/__test__/product-poster.png')).body();
  let v = await (await request.post(API, { multipart: { name, useAi: 'true', image: { name: 'poster.png', mimeType: 'image/png', buffer: poster } } })).json() as ProductView;
  const id = v.template.id;
  await expect.poll(async () => { v = await (await request.get(`${API}/${id}`)).json(); return v.stage; }, { timeout: 60000 }).toBe('review');
  v = await (await request.put(`${API}/${id}/review`, { data: { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ id: o.id, kind: o.kind, label: o.label, box: o.box, accepted: true })), texts: [], logos: [], dismissMissingText: true } })).json();
  await request.post(`${API}/${id}/prepare`, { data: { expectedRevision: v.template.revision } });
  await expect.poll(async () => { v = await (await request.get(`${API}/${id}`)).json(); return v.stage; }, { timeout: 120000 }).toBe('prepared');
  v = await (await request.post(`${API}/${id}/approve`, { data: { expectedRevision: v.template.revision, acknowledge: v.product.prepared!.quality.issues.map(i => i.id) } })).json();
  v = await (await request.post(`${API}/${id}/publish`, { data: { expectedRevision: v.template.revision } })).json();
  return v;
}

test('Refine Cutout: a product layer cleaned for free, compared, approved; only that layer changes; the AI repair asks first', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'One run is enough.');
  mkdirSync(OUT, { recursive: true });
  await page.route(url => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1', r => r.abort());
  const name = `Refine ${Date.now()}`, id = (await savedTemplate(request, name)).template.id;
  const panel = await open(page);
  await panel.getByRole('article', { name: `Product template ${name}` }).getByRole('button', { name: 'Use template', exact: true }).click();
  await panel.getByRole('button', { name: 'New creative' }).click();
  const change = panel.getByRole('complementary', { name: 'Change the creative' });
  await expect(change.getByRole('region', { name: 'Products and characters' })).toBeVisible();
  const before = (await (await request.get(`${API}/${id}/creatives/${((await (await request.get(`${API}/${id}/creatives`)).json()).creatives as { id: string }[])[0].id}`)).json()) as ProductCreative;
  const tv = before.objects.find(o => o.label === 'Television')!;
  await change.getByRole('listitem').filter({ hasText: 'Television' }).getByRole('button', { name: 'Refine cutout' }).click();
  const refine = change.getByRole('region', { name: 'Refine cutout: Television' });
  // The AI repair: provider, model, size and estimate shown; Cancel sends nothing.
  await refine.getByRole('button', { name: 'Complete with AI…' }).click();
  await expect(refine.getByRole('group', { name: 'Confirm the AI repair cost' })).toContainText(/Provider OpenAI, model .*, \d+ × \d+/);
  await refine.getByRole('button', { name: 'Cancel' }).click();
  // The free clean-up: compared with the current picture, applied only when looked at.
  await refine.getByRole('button', { name: 'Clean up (free)' }).click();
  await expect(refine.getByRole('img', { name: 'Television, refined' })).toBeVisible();
  await expect(refine.getByText(/Nothing was sent anywhere/)).toBeVisible();
  const use = refine.getByRole('button', { name: 'Use this picture' });
  await expect(use).toBeDisabled();
  await page.screenshot({ path: `${OUT}/01-refine-compare.png` });
  await refine.getByRole('checkbox', { name: /I have compared it with the current picture/ }).check();
  await use.click();
  await expect(change.getByText(/Television: refined cut-out in use/)).toBeVisible();
  const after = (await (await request.get(`${API}/${id}/creatives/${before.id}`)).json()) as ProductCreative;
  expect(after.revision).toBe(before.revision + 1);
  expect(after.objects.find(o => o.id === tv.id)!.asset.file).toMatch(/^pcr-/); expect(after.objects.find(o => o.id === tv.id)!.box).toEqual(tv.box);
  expect(after.objects.filter(o => o.id !== tv.id)).toEqual(before.objects.filter(o => o.id !== tv.id));
  expect(after.texts).toEqual(before.texts); expect(after.images).toEqual(before.images);
  await page.screenshot({ path: `${OUT}/02-refined-in-use.png` });
});
