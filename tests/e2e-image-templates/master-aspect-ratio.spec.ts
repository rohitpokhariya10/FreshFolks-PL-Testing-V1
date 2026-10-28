import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import type { ProductSnapshot, ProjectDocument } from '@frameflow/shared';
import type { ProductView } from '../../client/src/features/productTemplates/api';

// Creating a master template for the first time in a chosen size (offline: every provider is a test double; nothing is
// paid, nothing leaves the machine): the size chosen on the Upload screen (16:9) → Review → Choose → Decompose (the size
// kept all along, also after a reload) → Size (16:9, previewed, designed by AI after approval) → Save → Open in Editor;
// then the new master reused in another size from Create Offer Creative.
const API = '/api/layerize-experiment/product-templates', OUT = 'test-results/master-aspect-ratio';
test.use({ extraHTTPHeaders: { origin: `http://127.0.0.1:${process.env.FRAMEFLOW_OFFLINE_E2E_PORT ?? 3317}` }, actionTimeout: 30000 });
test.setTimeout(300000);

async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'OpenAI + Seedream test' }).click();
  const panel = page.getByRole('dialog', { name: 'OpenAI + Seedream test' });
  await panel.getByRole('tab', { name: 'Offer Templates', exact: true }).click();
  return panel;
}
const exact = (c: { width: number; height: number }, w: number, h: number) => c.width * h === c.height * w;

test('first-time master: choose 16:9 on the upload screen, keep it through every step, design it with AI, save, open it in the editor, reuse it in 9:16', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'One run of this long flow.');
  mkdirSync(OUT, { recursive: true });
  await page.route(url => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1', r => r.abort());
  const name = `Master ratio ${Date.now().toString(36)}`;
  const panel = await open(page);
  // 1. Upload the original creative.
  await panel.getByRole('button', { name: 'New product template' }).click();
  await expect(panel.getByRole('heading', { name: 'Upload your creative' })).toBeVisible();
  await panel.getByLabel('Creative to upload').setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: await (await request.get('/__test__/product-poster.png')).body() });
  await panel.getByLabel('Template name').fill(name);
  await panel.getByRole('checkbox', { name: /Find characters and products with AI/ }).check();
  // The master's size, chosen at the start: Original by default (today's behaviour), Landscape 16:9 here.
  const start = panel.getByRole('group', { name: 'Size of the master template' });
  for (const label of [/^Original/, /Square 1:1/, /Portrait 4:5/, /Story 9:16/, /Landscape 16:9/]) await expect(start.getByRole('radio', { name: label })).toBeVisible();
  await expect(start.getByRole('radio', { name: /^Original/ })).toHaveAttribute('aria-checked', 'true');
  await start.getByRole('radio', { name: /Landscape 16:9/ }).click();
  await expect(start.getByRole('radio', { name: /Landscape 16:9/ })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: `${OUT}/00-upload-choose-16x9.png` });
  const created = page.waitForResponse(r => r.url().endsWith(API) && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Upload and find elements' }).click();
  const id = ((await (await created).json()) as ProductView).template.id;
  expect(((await (await request.get(`${API}/${id}`)).json()) as ProductView).product.targetRatio).toBe('16:9');
  // 2. Review keeps working as it did, with the chosen size shown; a reload loses nothing (it is the template's).
  await expect(panel.getByRole('heading', { name: 'Here’s what we found' })).toBeVisible({ timeout: 120000 });
  await expect(panel.getByTestId('chosen-size')).toContainText('Landscape 16:9');
  await page.reload();
  const again = await open(page), inLibrary = again.getByRole('article', { name: `Product template ${name}` });
  await expect(inLibrary).toContainText('Master size chosen: Landscape 16:9');
  await inLibrary.getByRole('button', { name: 'Continue setup' }).click();
  await expect(again.getByRole('heading', { name: 'Here’s what we found' })).toBeVisible({ timeout: 120000 });
  await expect(again.getByTestId('chosen-size')).toContainText('Landscape 16:9');
  for (const g of ['Characters', 'Products', 'Text', 'Logos']) await expect(panel.getByRole('region', { name: g, exact: true })).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Steps' })).toContainText('Size');
  // 3. Choose and decompose (on this computer, free).
  await panel.getByRole('button', { name: 'Save and choose what to decompose' }).click();
  await expect(panel.getByRole('heading', { name: 'Choose what to decompose' })).toBeVisible();
  await panel.getByRole('button', { name: 'Continue to Decomposition' }).click();
  await expect(panel.getByRole('heading', { name: 'Inspect the layers and the background' })).toBeVisible({ timeout: 120000 });
  for (const c of await panel.getByRole('complementary', { name: 'Checks' }).getByRole('checkbox').all()) await c.check();
  // 4. The size chosen at the start is still the master's (changeable here before saving).
  await expect(panel.getByTestId('chosen-size')).toContainText('Landscape 16:9');
  const sizes = panel.getByRole('group', { name: 'Size of the master template' });
  await expect(sizes.getByRole('radio', { name: /Landscape 16:9/ })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: `${OUT}/01-inspect-size-kept-16x9.png` });
  await panel.getByRole('button', { name: 'Save and preview Landscape 16:9' }).click();
  // 5. The 16:9 master previewed (composed free on this computer, labelled so), with its checks.
  await expect(panel.getByRole('heading', { name: 'Your master in Landscape 16:9' })).toBeVisible({ timeout: 120000 });
  const step = panel.getByRole('region', { name: 'Master template size' });
  await expect(step.getByRole('img', { name: 'The master template in Landscape 16:9' })).toBeVisible({ timeout: 120000 });
  await expect(step.getByText('Composed automatically on this computer (free) — not an AI design')).toBeVisible();
  const checks = step.getByRole('list', { name: 'Checked before saving' });
  await expect(checks.getByText(/exactly 16:9/)).toBeVisible();
  await expect(checks.getByText(/all shown, exact and unchanged/)).toBeVisible();
  await page.screenshot({ path: `${OUT}/02-preview-rules.png` });
  // 6. Designed with AI only after its cost is approved (the test doubles: no request leaves the machine).
  await step.getByRole('button', { name: 'Design this size with AI…' }).click();
  const confirm = step.getByRole('group', { name: 'Confirm the AI composition cost' });
  await expect(confirm).toContainText('$0.20'); await expect(confirm).toContainText('never redraws them');
  await confirm.getByRole('button', { name: 'Yes, design with AI' }).click();
  await expect(step.getByText('Layout designed by AI (approved)')).toBeVisible({ timeout: 120000 });
  await page.screenshot({ path: `${OUT}/03-preview-ai.png` });
  // 7. Saved as the master: version 2 in 16:9; version 1 (the original) unchanged.
  await step.getByRole('button', { name: 'Save Landscape 16:9 master template' }).click();
  await expect(panel.getByRole('heading', { name: 'Your Landscape 16:9 master template is saved' })).toBeVisible({ timeout: 60000 });
  await expect(panel.getByTestId('master-size')).toContainText('Landscape 16:9 master');
  await page.screenshot({ path: `${OUT}/04-saved.png` });
  const view = await (await request.get(`${API}/${id}`)).json() as ProductView;
  expect(view.product.revisions.map(r => [r.revision, r.aspectRatio ?? 'original', r.fromRevision ?? null])).toEqual([[1, 'original', null], [2, '16:9', 1]]);
  const original = await (await request.get(`${API}/${id}/revisions/1`)).json() as ProductSnapshot, master = await (await request.get(`${API}/${id}/revisions/2`)).json() as ProductSnapshot;
  expect(original.canvas).toEqual({ width: view.template.source.width, height: view.template.source.height }); expect(original.editorCreative).toBeUndefined();
  expect(exact(master.canvas, 16, 9)).toBe(true); expect(master.adaptation).toMatchObject({ fromRevision: 1, ratio: '16:9', source: 'ai' });
  const layers = master.editorCreative!;
  expect(layers.texts.filter(t => !t.hidden).map(t => t.text)).toEqual(expect.arrayContaining(['T&Cs', 'apply']));
  expect(layers.images.filter(i => !i.hidden)).toHaveLength(view.counts.logos);
  expect(layers.objects.filter(o => o.kind === 'product')).toHaveLength(view.counts.products);
  // 8. Opened in the editor: a design of exactly that size, its products as layers.
  const opened = page.waitForResponse(r => r.url().endsWith(`/${id}/open-editor`) && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Open in Editor', exact: true }).click();
  const { runId } = await (await opened).json();
  await expect(panel).toBeHidden({ timeout: 60000 });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('frameflow:project:v1')!) as ProjectDocument);
  await expect.poll(async () => (await stored()).variants.some(v => v.importedFrom?.runId === runId), { timeout: 60000 }).toBe(true);
  const design = (await stored()).variants.find(v => v.importedFrom?.runId === runId)!;
  expect([design.canvas.width, design.canvas.height]).toEqual([master.canvas.width, master.canvas.height]);
  for (const o of layers.objects.filter(x => x.kind === 'product')) expect(design.layers!.some(l => l.name === o.label), o.label).toBe(true);
  await page.screenshot({ path: `${OUT}/05-editor.png` });
  // 9. Reused in another size: the gallery shows it as 16:9; Original is the 16:9 master; 9:16 is composed for its shape.
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Offer Creative' }).click();
  const app = page.getByRole('dialog', { name: 'Create Offer Creative' }), card = app.getByRole('article', { name: `Template ${name}` });
  await expect(card).toContainText('Landscape 16:9 format');
  await card.getByRole('button', { name: 'Use This Template' }).click();
  const picker = app.getByRole('radiogroup', { name: 'Creative size' });
  await expect(picker.getByRole('radio', { name: 'Original · Landscape 16:9' })).toHaveAttribute('aria-checked', 'true');
  await picker.getByRole('radio', { name: /Story 9:16/ }).click();
  const packshot = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="540"><rect x="10" y="10" width="400" height="520" rx="22" fill="#f3f4f6" stroke="#9ca3af" stroke-width="6"/><circle cx="210" cy="300" r="120" fill="#60a5fa"/></svg>')).png().toBuffer();
  await app.getByLabel('Upload product photos').setInputFiles({ name: 'washing-machine.png', mimeType: 'image/png', buffer: packshot });
  await expect(app.getByRole('list', { name: 'Your products' }).getByRole('listitem', { name: /Product washing machine/ })).toBeVisible({ timeout: 60000 });
  await app.getByRole('button', { name: 'Generate Creative' }).click();
  await page.getByRole('dialog', { name: /Design Your Creative with AI/ }).getByRole('button', { name: 'Generate Automatically (Free)' }).click();
  const result = app.getByRole('region', { name: 'Your creative' });
  await expect(result.getByText('Layout composed automatically')).toBeVisible({ timeout: 120000 });
  await expect(result.getByRole('list', { name: 'Checked before saving' }).getByText(/exactly 9:16/)).toBeVisible();
  await page.screenshot({ path: `${OUT}/06-reused-9x16.png` });
  const drafts = (await (await request.get(`${API}/${id}/reuse`)).json()).drafts as { id: string; simple: boolean; ratios: string[] }[];
  expect(drafts.filter(d => d.simple).map(d => d.ratios)).toEqual([['9:16']]);
});
