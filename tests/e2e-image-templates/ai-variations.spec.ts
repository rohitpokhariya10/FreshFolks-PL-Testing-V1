import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import type { AiVariationJob, ProjectDocument } from '@frameflow/shared';
import type { AiVariationsInfo, ProductView } from '../../client/src/features/productTemplates/api';

// Generate AI Variations → AI design variations (offline: the image model is a test double that places the creative
// whole on a soft cover of itself — nothing is generated, nothing paid, nothing leaves the machine). A saved template →
// a size, a theme, 3 variations → cost confirmed → previews → one chosen, looked at, made editable → its elements found in
// it → reviewed → decomposed → saved → the editor at exactly its size → a layer moved → reloaded → exported.
const API = '/api/layerize-experiment/product-templates', OUT = 'test-results/ai-variations';
test.use({ extraHTTPHeaders: { origin: `http://127.0.0.1:${process.env.FRAMEFLOW_OFFLINE_E2E_PORT ?? 3317}` }, actionTimeout: 30000 });
test.setTimeout(420000);

async function savedTemplate(request: APIRequestContext, name: string) {
  const poster = await (await request.get('/__test__/product-poster.png')).body();
  let v = await (await request.post(API, { multipart: { name, useAi: 'true', image: { name: 'poster.png', mimeType: 'image/png', buffer: poster } } })).json() as ProductView;
  const id = v.template.id;
  await expect.poll(async () => { v = await (await request.get(`${API}/${id}`)).json(); return v.stage; }, { timeout: 60000 }).toBe('review');
  v = await (await request.put(`${API}/${id}/review`, { data: { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ id: o.id, kind: o.kind, label: o.label, box: o.box, accepted: true })), texts: [], logos: [] } })).json();
  await request.post(`${API}/${id}/prepare`, { data: { expectedRevision: v.template.revision } });
  await expect.poll(async () => { v = await (await request.get(`${API}/${id}`)).json(); return v.stage; }, { timeout: 120000 }).toBe('prepared');
  v = await (await request.post(`${API}/${id}/approve`, { data: { expectedRevision: v.template.revision, acknowledge: v.product.prepared!.quality.issues.map(i => i.id) } })).json();
  await request.post(`${API}/${id}/publish`, { data: { expectedRevision: v.template.revision } });
  return id;
}

async function lab(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'OpenAI + Seedream test' }).click();
  const panel = page.getByRole('dialog', { name: 'OpenAI + Seedream test' });
  await panel.getByRole('tab', { name: 'Offer Templates', exact: true }).click();
  return panel;
}

/** The template's AI design variations generated in the UI (size, theme, 3 variations, cost confirmed); variation 2 chosen, looked at and made editable. */
async function generateAndUse(page: Page, request: APIRequestContext, size: RegExp, theme: string, shot: string) {
  const name = `AI variations ${Date.now().toString(36)}`, id = await savedTemplate(request, name);
  const before = (await (await request.get(`${API}/${id}`)).json()) as ProductView;
  const panel = await lab(page);
  // The existing entry point opens the template's Generate with AI tab: the AI design variations first.
  await panel.getByRole('article').filter({ has: page.locator(`img[src*="${id}"]`) }).first().getByRole('button', { name: 'Generate AI Variations' }).click();
  const ai = panel.getByRole('region', { name: 'AI design variations' });
  await expect(ai).toBeVisible({ timeout: 60000 });
  await ai.getByRole('radiogroup', { name: 'Creative size' }).getByRole('radio', { name: size }).click();
  await ai.getByRole('radiogroup', { name: 'Festival or theme' }).getByRole('radio', { name: theme }).click();
  await ai.getByRole('radiogroup', { name: 'How many AI variations' }).getByRole('radio', { name: '3 variations' }).click();
  // Choosing sends nothing; generating asks for the cost first.
  expect(((await (await request.get(`${API}/${id}/ai-variations`)).json()) as AiVariationsInfo).jobs).toEqual([]);
  await ai.getByRole('button', { name: 'Generate 3 AI variations' }).click();
  await expect(ai.getByRole('group', { name: 'Confirm the AI variations cost' })).toContainText('at most about $');
  await page.screenshot({ path: `${OUT}/${shot}-01-choices-and-cost.png` });
  await ai.getByRole('button', { name: /^Yes, spend \$/ }).click();
  for (const n of [1, 2, 3]) await expect(ai.getByRole('img', { name: new RegExp(`^AI variation ${n}:`) })).toBeVisible({ timeout: 180000 });
  const job = ((await (await request.get(`${API}/${id}/ai-variations`)).json()) as AiVariationsInfo).jobs[0] as AiVariationJob;
  await page.screenshot({ path: `${OUT}/${shot}-02-previews.png`, fullPage: true });
  // Chosen, looked at, made editable: its own template, its elements found in it; the base unchanged.
  const card = ai.getByRole('article', { name: 'AI variation 2' });
  await card.getByRole('button', { name: 'Choose this variation' }).click();
  const use = card.getByRole('button', { name: /Use this variation: make it editable/ });
  await expect(use).toBeDisabled();
  await card.getByRole('checkbox', { name: /I have looked at this variation/ }).check();
  // A questionable result (a word or product the checks could not confirm) needs its warnings accepted explicitly.
  const accept = card.getByRole('checkbox', { name: /I accept these warnings/ });
  if (await accept.isVisible()) { await expect(use).toBeDisabled(); await accept.check(); }
  // Added words that look like a price, offer, date or claim are confirmed on their own, never with the rest.
  const business = card.getByRole('checkbox', { name: /none is a new price, offer, date or claim/ });
  if (await business.isVisible()) { await expect(use).toBeDisabled(); await business.check(); }
  await use.click();
  await expect(panel.getByRole('heading', { name: 'Here’s what we found' })).toBeVisible({ timeout: 120000 });
  const made = ((await (await request.get(`${API}/${id}/ai-variations/${job.id}`)).json()) as AiVariationJob).results[1].templateId!;
  expect(((await (await request.get(`${API}/${id}`)).json()) as ProductView).product.revisions).toEqual(before.product.revisions);
  await page.screenshot({ path: `${OUT}/${shot}-03-review.png` });
  return { panel, id, job, made, view: (await (await request.get(`${API}/${made}`)).json()) as ProductView };
}

test('AI design variations in the PL One Banner, Diwali: cost confirmed, three previews at exactly 885:286, one made editable and found in itself', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'One run of this long flow.');
  mkdirSync(OUT, { recursive: true });
  await page.route(url => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1', r => r.abort());
  const { id, job, view } = await generateAndUse(page, request, /PL One Banner/, 'Diwali', 'banner');
  expect(job).toMatchObject({ ratio: '885:286', theme: 'diwali', count: 3, size: { width: 1770, height: 572 }, status: 'done' });
  expect(view.template.source).toMatchObject({ width: 1770, height: 572 }); expect(view.product.regeneration).toMatchObject({ status: 'approved', ratio: '885:286', from: { templateId: id } });
});

// (Decomposed in 16:9: the offline analyser answers with the test poster's own layout whatever picture it gets, which a
// 3:1 banner made from a square poster does not resemble; a real detection reads the picture itself.)
test('AI design variation in 16:9, Holi: made editable, reviewed, decomposed, saved, a layer moved in the editor, reloaded and exported', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'One run of this long flow.');
  mkdirSync(OUT, { recursive: true });
  await page.route(url => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1', r => r.abort());
  const { panel, made, view } = await generateAndUse(page, request, /Landscape 16:9/, 'Holi', 'landscape');
  expect(view.template.source).toMatchObject({ width: 2048, height: 1152 });
  // Reviewed, decomposed, saved.
  await panel.getByRole('button', { name: 'Save and choose what to decompose' }).click();
  await panel.getByRole('button', { name: 'Continue to Decomposition' }).click();
  await expect(panel.getByRole('heading', { name: 'Inspect the layers and the background' })).toBeVisible({ timeout: 120000 });
  for (const c of await panel.getByRole('complementary', { name: 'Checks' }).getByRole('checkbox').all()) await c.check();
  const draft = panel.getByRole('button', { name: 'Save as a draft with these warnings…' });
  if (await draft.isVisible()) { await draft.click(); await panel.getByRole('button', { name: 'Yes, save as a draft' }).click(); }
  else await panel.getByRole('button', { name: 'Save master template' }).click();
  await expect(panel.getByRole('heading', { name: 'Your template is saved' })).toBeVisible({ timeout: 60000 });
  // The editor: exactly 16:9, a layer moved, kept after a reload, exported at its size.
  const opened = page.waitForResponse(r => r.url().endsWith(`/${made}/open-editor`) && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Open in Editor', exact: true }).click();
  const { runId } = await (await opened).json();
  await expect(panel).toBeHidden({ timeout: 60000 });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('frameflow:project:v1')!) as ProjectDocument);
  await expect.poll(async () => (await stored()).variants.some(x => x.importedFrom?.runId === runId), { timeout: 60000 }).toBe(true);
  const design = (await stored()).variants.find(x => x.importedFrom?.runId === runId)!;
  expect(design.canvas).toMatchObject({ width: 2048, height: 1152 }); expect(design.layers!.length).toBeGreaterThan(2);
  const layer = design.layers!.find(l => !l.locked)!;
  await page.locator(`[data-layer-id="${layer.id}"] .layer-select`).click();
  await page.getByLabel('X', { exact: true }).fill(String(Math.round(layer.x) + 25));
  await page.getByLabel('X', { exact: true }).press('Enter');
  await expect.poll(async () => (await stored()).variants.find(x => x.id === design.id)!.layers!.find(l => l.id === layer.id)!.x, { timeout: 30000 }).toBe(Math.round(layer.x) + 25);
  await page.reload();
  expect((await stored()).variants.find(x => x.id === design.id)!.layers!.find(l => l.id === layer.id)!.x).toBe(Math.round(layer.x) + 25);
  await page.screenshot({ path: `${OUT}/landscape-04-editor.png` });
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await (await exported).saveAs(`${OUT}/landscape-05-export.png`);
  expect(await sharp(`${OUT}/landscape-05-export.png`).metadata()).toMatchObject({ width: 2048, height: 1152 });
});
