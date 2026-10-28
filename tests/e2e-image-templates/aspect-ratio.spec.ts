import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import type { ProductCreative, ReuseDraft } from '@frameflow/shared';
import type { ProductView } from '../../client/src/features/productTemplates/api';

// Create Offer Creative with a chosen size (offline: every provider is a test double; nothing is paid, nothing leaves the
// machine). First generation: the size is chosen before generating, the AI composition approved, the checks read before
// saving. Reuse: the template opened again keeps the saved size, and another size is composed for its own shape.
const API = '/api/layerize-experiment/product-templates', FILES = '/api/layerize-experiment/protected-templates', OUT = 'test-results/aspect-ratio';
test.use({ extraHTTPHeaders: { origin: `http://127.0.0.1:${process.env.FRAMEFLOW_OFFLINE_E2E_PORT ?? 3317}` }, actionTimeout: 30000 });
test.setTimeout(300000);

async function savedTemplate(request: APIRequestContext, name: string) {
  const poster = await (await request.get('/__test__/product-poster.png')).body();
  let v = await (await request.post(API, { multipart: { name, useAi: 'true', image: { name: 'poster.png', mimeType: 'image/png', buffer: poster } } })).json() as ProductView;
  const id = v.template.id;
  await expect.poll(async () => { v = await (await request.get(`${API}/${id}`)).json(); return v.stage; }, { timeout: 60000 }).toBe('review');
  v = await (await request.put(`${API}/${id}/review`, { data: { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ id: o.id, kind: o.kind, label: o.label, box: o.box, accepted: true })), texts: [], logos: [] } })).json();
  await request.post(`${API}/${id}/prepare`, { data: { expectedRevision: v.template.revision } });
  await expect.poll(async () => { v = await (await request.get(`${API}/${id}`)).json(); return v.stage; }, { timeout: 120000 }).toBe('prepared');
  v = await (await request.post(`${API}/${id}/approve`, { data: { expectedRevision: v.template.revision, acknowledge: v.product.prepared!.quality.issues.map(i => i.id) } })).json();
  v = await (await request.post(`${API}/${id}/publish`, { data: { expectedRevision: v.template.revision } })).json();
  expect(v.stage).toBe('ready');
  return id;
}
async function openTemplate(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Offer Creative' }).click();
  const app = page.getByRole('dialog', { name: 'Create Offer Creative' });
  await app.getByRole('article', { name: `Template ${name}` }).getByRole('button', { name: 'Use This Template' }).click();
  await expect(app.getByRole('heading', { name: 'Create Your Offer Creative' })).toBeVisible();
  return app;
}
const exact = (c: { width: number; height: number }, w: number, h: number) => c.width * h === c.height * w;

test('choose a size before the first generation, approve AI composition, check and save; reuse keeps it and composes another size', async ({ page, request }) => {
  mkdirSync(OUT, { recursive: true });
  await page.route(url => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1', r => r.abort());
  const name = `Aspect ratio proof ${Date.now().toString(36)}`, id = await savedTemplate(request, name);
  let app = await openTemplate(page, name);
  // The size is chosen before anything is made: the template's own and the common offer-creative ratios.
  const sizes = app.getByRole('radiogroup', { name: 'Creative size' });
  for (const label of [/^Original/, /Square 1:1/, /Portrait 4:5/, /Story 9:16/, /Landscape 16:9/]) await expect(sizes.getByRole('radio', { name: label })).toBeVisible();
  await expect(sizes.getByRole('radio', { name: /^Original/ })).toHaveAttribute('aria-checked', 'true');
  await sizes.getByRole('radio', { name: /Story 9:16/ }).click();
  await expect(sizes.getByRole('radio', { name: /Story 9:16/ })).toHaveAttribute('aria-checked', 'true');
  const packshot = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="760"><rect x="10" y="10" width="340" height="740" rx="18" fill="#374151"/><rect x="186" y="24" width="150" height="712" rx="10" fill="#4b5563"/></svg>')).png().toBuffer();
  await app.getByLabel('Upload product photos').setInputFiles({ name: 'refrigerator.png', mimeType: 'image/png', buffer: packshot });
  await expect(app.getByRole('list', { name: 'Your products' }).getByRole('listitem', { name: /Product refrigerator/ })).toBeVisible({ timeout: 60000 });
  await page.screenshot({ path: `${OUT}/01-size-chosen.png` });
  // One approval for the AI parts (layout and background for the size; arranging), with each estimate shown.
  await app.getByRole('button', { name: 'Generate Creative' }).click();
  const ask = page.getByRole('dialog', { name: /Design Your Creative with AI/ });
  await expect(ask.getByText('Layout & background')).toBeVisible();
  await page.screenshot({ path: `${OUT}/02-approval.png` });
  await ask.getByRole('button', { name: 'Approve & Generate' }).click();
  const result = app.getByRole('region', { name: 'Your creative' });
  await expect(result.getByText('Layout designed by AI')).toBeVisible({ timeout: 120000 });
  // Checked before saving: exact size, protected elements, readability, edges.
  const checks = result.getByRole('list', { name: 'Checked before saving' });
  await expect(checks.getByText(/exactly 9:16/)).toBeVisible();
  await expect(checks.getByText(/all shown, exact and unchanged/)).toBeVisible();
  await page.screenshot({ path: `${OUT}/03-result-9x16.png` });
  await result.getByRole('button', { name: 'Save Creative' }).click();
  await expect(result.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 60000 });
  const drafts = (await (await request.get(`${API}/${id}/reuse`)).json()).drafts as { id: string; simple: boolean }[];
  let draft = (await (await request.get(`${API}/${id}/reuse/${drafts.find(x => x.simple)!.id}`)).json()).draft as ReuseDraft;
  expect(draft.ratios).toEqual(['9:16']); expect(draft.compose?.['9:16']?.model).toMatch(/test layout planner/);
  const out = draft.outputs['9:16']!;
  expect(exact(out.canvas, 9, 16)).toBe(true); expect(out.validation?.protected.ok).toBe(true); expect(out.composition?.source).toBe('ai');
  const saved = await (await request.get(`${API}/${id}/creatives/${out.creativeId}`)).json() as ProductCreative;
  expect(saved.origin).toMatchObject({ kind: 'reuse', ratio: '9:16' }); expect(exact(saved.canvas, 9, 16)).toBe(true);
  const preview = await sharp(await (await request.get(`${FILES}/${id}/files/${out.preview}`)).body()).metadata();
  expect(Math.abs(preview.width! / preview.height! - 9 / 16)).toBeLessThan(0.01);

  // Reuse: the template opened again continues with its saved size; another one is composed for its own shape (free).
  app = await openTemplate(page, name);
  const again = app.getByRole('region', { name: 'Your creative' });
  await expect(again.getByLabel('Creative size')).toHaveValue('9:16');
  await again.getByLabel('Creative size').selectOption('16:9');
  await expect(again.getByText('Layout composed automatically')).toBeVisible({ timeout: 120000 });
  await expect(again.getByRole('list', { name: 'Checked before saving' }).getByText(/exactly 16:9/)).toBeVisible();
  await expect(again.getByRole('button', { name: 'Design this size with AI' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/04-reuse-16x9.png` });
  draft = (await (await request.get(`${API}/${id}/reuse/${draft.id}`)).json()).draft as ReuseDraft;
  expect(draft.ratios).toEqual(['16:9']); expect(exact(draft.outputs['16:9']!.canvas, 16, 9)).toBe(true);
});
