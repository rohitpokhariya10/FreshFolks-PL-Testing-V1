import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { DesignVariant, LayerEditCandidate, ProductCreative, ProjectDocument } from '@frameflow/shared';
import type { ProductView } from '../../client/src/features/productTemplates/api';
import type { Stage } from 'konva/lib/Stage';
import type { Group } from 'konva/lib/Group';
import type { Image as KonvaImage } from 'konva/lib/shapes/Image';
const API = '/api/layerize-experiment/product-templates';
test.use({ extraHTTPHeaders: { origin: `http://127.0.0.1:${process.env.FRAMEFLOW_OFFLINE_E2E_PORT ?? 3317}` }, actionTimeout: 30000 });
test.setTimeout(180000);
async function openCreative(page: Page, request: APIRequestContext) {
  await page.route(url => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1', r => r.abort());
  // Optionally exercise React StrictMode through the running Vite client. API requests still use this isolated fake server.
  if (process.env.FRAMEFLOW_E2E_DEV_CLIENT) await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__test__/')) return route.fallback();
    const response = await route.fetch({ url: new URL(`${url.pathname}${url.search}`, process.env.FRAMEFLOW_E2E_DEV_CLIENT).href });
    await route.fulfill({ response });
  });
  const name = `AI layers ${Date.now()}`, poster = await (await request.get('/__test__/product-poster.png')).body();
  let v = await (await request.post(API, { multipart: { name, useAi: 'true', image: { name: 'poster.png', mimeType: 'image/png', buffer: poster } } })).json() as ProductView;
  const id = v.template.id;
  await expect.poll(async () => { v = await (await request.get(`${API}/${id}`)).json(); return v.stage; }, { timeout: 60000 }).toBe('review');
  v = await (await request.put(`${API}/${id}/review`, { data: { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ id: o.id, kind: o.kind, label: o.label, box: o.box, accepted: true })), texts: [], logos: [], dismissMissingText: true } })).json();
  await request.post(`${API}/${id}/prepare`, { data: { expectedRevision: v.template.revision } });
  await expect.poll(async () => { v = await (await request.get(`${API}/${id}`)).json(); return v.stage; }, { timeout: 60000 }).toBe('prepared');
  v = await (await request.post(`${API}/${id}/approve`, { data: { expectedRevision: v.template.revision, acknowledge: v.product.prepared!.quality.issues.map(i => i.id) } })).json();
  await request.post(`${API}/${id}/publish`, { data: { expectedRevision: v.template.revision } });
  await page.goto('/'); await page.getByRole('button', { name: 'OpenAI + Seedream test' }).click();
  const modal = page.getByRole('dialog', { name: 'OpenAI + Seedream test' });
  await modal.getByRole('tab', { name: 'Offer Templates', exact: true }).click();
  await modal.getByRole('article', { name: `Product template ${name}` }).getByRole('button', { name: 'Use template', exact: true }).click();
  await modal.getByRole('button', { name: 'New creative' }).click();
  await modal.getByRole('button', { name: 'Open in editor', exact: true }).click();
  await expect(modal).toBeHidden();
  const stored = async () => page.evaluate(id => (JSON.parse(localStorage.getItem('frameflow:project:v1')!) as ProjectDocument).variants.find(v => v.creative?.masterId === id)!, id);
  await expect.poll(async () => !!(await stored())?.creative).toBe(true);
  return { id, stored, original: await stored() };
}
const panel = (page: Page) => page.getByRole('region', { name: 'AI Edit Layer', exact: true });
const select = (page: Page, name: string) => page.locator('.layer-select').filter({ hasText: name }).first().click();
async function generate(page: Page, prompt: string, ready = true) {
  const p = panel(page); await p.getByLabel('Layer edit prompt').fill(prompt); await p.getByRole('button', { name: 'Generate Edit', exact: true }).click();
  await expect(p.getByRole('button', { name: 'Approve and generate' })).toBeDisabled();
  await p.getByRole('checkbox').check();
  const response = page.waitForResponse(r => r.url().endsWith('/layer-edits') && r.request().method() === 'POST');
  await p.getByRole('button', { name: 'Approve and generate' }).click();
  const result = await (await response).json() as LayerEditCandidate;
  await expect(p.getByRole('img', { name: 'AI edited candidate' })).toBeVisible();
  if (ready) await expect(p.getByRole('button', { name: 'After — AI Edited', exact: true })).toHaveAttribute('aria-pressed', 'true');
  return result;
}
const layerNamed = (v: DesignVariant, name: string) => v.layers!.find(l => l.name === name)!;

/** Read what Konva actually paints, including bitmap pixels; DOM thumbnails alone cannot pass these checks. */
async function canvasLayers(page: Page) {
  return page.evaluate(() => {
    const stage = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages.find(s => s.container().closest('.canvas-frame'))!;
    return stage.find<Group>('.design-layer').map(node => {
      const images = node.find<KonvaImage>('.layer-image'), image = images[0], canvas = node.toCanvas({ pixelRatio: 1 });
      const data = canvas.width && canvas.height ? canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data : new Uint8ClampedArray();
      let hash = 2166136261, transparent = 0;
      for (let i = 0; i < data.length; i++) { hash = Math.imul(hash ^ data[i], 16777619); if (i % 4 === 3 && data[i] === 0) transparent++; }
      return { id: node.id(), x: node.x(), y: node.y(), rotation: node.rotation(), opacity: node.opacity(), width: image?.width(), height: image?.height(), images: images.length, pixels: hash >>> 0, transparent };
    });
  });
}
async function exportedPixels(page: Page, path: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await (await download).saveAs(path);
  return sharp(path).ensureAlpha().raw().toBuffer();
}

test('object prompt → approval → preview → expanded Apply → second edit → undo → save/reload/export', async ({ page, request }, info) => {
  const { id, stored, original } = await openCreative(page, request), fridge = layerNamed(original, 'Refrigerator');
  await select(page, 'Refrigerator'); const p = panel(page);
  await expect(p).toContainText('Editing: Refrigerator');
  const prompt = `Open both refrigerator doors. ${id}`, count = async () => (await (await request.get('/__test__/image-calls', { params: { contains: prompt } })).json()).count;
  expect(await count()).toBe(0);
  await p.getByLabel('Layer edit prompt').fill(prompt); await p.getByRole('button', { name: 'Generate Edit', exact: true }).click();
  await expect(p).toContainText('offline-layer-editor'); expect(await count()).toBe(0);
  await p.getByRole('checkbox').check(); await p.getByRole('button', { name: 'Approve and generate' }).click();
  await expect(p.getByRole('img', { name: 'AI edited candidate' })).toBeVisible(); expect(await count()).toBe(1);
  expect(await stored()).toEqual(original);
  await p.getByRole('button', { name: 'Regenerate · new approval' }).click();
  expect(await stored()).toEqual(original);
  const candidate = await generate(page, prompt); expect(await count()).toBe(2);
  await page.screenshot({ path: info.outputPath('layer-edit-preview.png') });
  await p.getByRole('button', { name: 'Apply edit' }).click();
  await expect.poll(async () => layerNamed(await stored(), 'Refrigerator').width).toBeGreaterThan(fridge.width);
  const applied = await stored(), changed = layerNamed(applied, 'Refrigerator');
  expect(applied.layers!.filter(l => l.id !== fridge.id)).toEqual(original.layers!.filter(l => l.id !== fridge.id));
  expect(applied.elements).toEqual(original.elements);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => layerNamed(await stored(), 'Refrigerator')).toEqual(fridge);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => layerNamed(await stored(), 'Refrigerator')).toEqual(changed);
  const nextRequest = page.waitForRequest(r => r.url().endsWith('/layer-edits') && r.method() === 'POST');
  await generate(page, `Make the inside brighter. ${id}`);
  expect((await nextRequest).postDataJSON().sourceSha256).toBe(candidate.image.sha256);
  await p.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByLabel('X', { exact: true }).fill(String(Math.round(changed.x) + 14)); await page.getByLabel('X', { exact: true }).blur();
  await page.getByLabel('Rotation', { exact: true }).fill('12'); await page.getByLabel('Rotation', { exact: true }).blur();
  await page.getByRole('button', { name: 'Save creative', exact: true }).click();
  await expect(page.getByText('Saved to creative · revision 2')).toBeVisible();
  const c = await (await request.get(`${API}/${id}/creatives/${original.creative!.creativeId}`)).json() as ProductCreative;
  const savedObject = c.objects.find(o => `object-${o.id}` === fridge.id)!;
  expect(savedObject.asset.kind).toBe('upload'); expect('width' in savedObject.asset ? savedObject.asset.width : 0).toBe(candidate.image.width); expect(savedObject.box.rotation).toBe(12);
  await expect.poll(async () => layerNamed(await stored(), 'Refrigerator').rotation).toBe(12);
  await expect.poll(async () => (await stored()).creative!.syncedRevision).toBe(2);
  const beforeReload = layerNamed(await stored(), 'Refrigerator');
  await page.reload(); await expect.poll(async () => layerNamed(await stored(), 'Refrigerator')).toEqual(beforeReload);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const path = info.outputPath('edited-creative.png'); await (await download).saveAs(path);
  const { data, info: pixels } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([pixels.width, pixels.height]).toEqual([original.canvas.width, original.canvas.height]);
  // The fixture's dark new interior is present in the exported composition, not just the DOM preview.
  let interior = 0; for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 51) < 3 && Math.abs(data[i + 1] - 65) < 3 && Math.abs(data[i + 2] - 85) < 3) interior++;
  expect(interior).toBeGreaterThan(100);
  await select(page, 'Refrigerator'); await page.screenshot({ path: info.outputPath('layer-edit-saved.png') });
});

test('character pose, locked/background exclusions, stale placement, and switching selection during generation', async ({ page, request }) => {
  const { id, stored, original } = await openCreative(page, request), slow = `Open both doors. slow test ${id}`;
  await select(page, 'Background'); await expect(panel(page)).toContainText(/unlock|individual visual object/);
  await select(page, 'Mascot');
  await page.getByRole('button', { name: 'Lock Mascot', exact: true }).click(); await expect(panel(page)).toContainText('Show and unlock');
  await page.getByRole('button', { name: 'Unlock Mascot', exact: true }).click();
  const c = await generate(page, 'Raise the left arm.'); expect(c.geometry.width).toBeGreaterThan(1);
  const mascot = layerNamed(original, 'Mascot'), rendered = (await canvasLayers(page)).find(l => l.id === mascot.id)!;
  expect(rendered.height).toBeCloseTo(mascot.height * c.geometry.height); expect(rendered.height).toBeGreaterThan(mascot.height);
  expect(rendered.images).toBe(1); expect(rendered.transparent).toBeGreaterThan(0);
  await page.getByLabel('X', { exact: true }).fill('245'); await page.getByLabel('X', { exact: true }).blur();
  await expect(panel(page).getByRole('button', { name: 'Apply edit' })).toHaveCount(0);
  await expect(panel(page).getByRole('alert')).toContainText('The selected layer changed'); await panel(page).getByRole('button', { name: 'Discard', exact: true }).click();
  const pose = await generate(page, 'Raise the left arm.');
  await panel(page).getByRole('button', { name: 'Apply edit' }).click();
  await expect.poll(async () => { const l = layerNamed(await stored(), 'Mascot'); return l.type === 'image' ? l.assetId : ''; }).toBe(`ai-layer-${pose.operationId}`);
  expect(layerNamed(await stored(), 'Refrigerator')).toEqual(layerNamed(original, 'Refrigerator'));
  await select(page, 'Refrigerator');
  const p = panel(page); await p.getByLabel('Layer edit prompt').fill(slow); await p.getByRole('button', { name: 'Generate Edit', exact: true }).click();
  await p.getByRole('checkbox').check();
  const finished = page.waitForResponse(r => r.url().endsWith('/layer-edits') && r.request().method() === 'POST');
  await p.getByRole('button', { name: 'Approve and generate' }).click(); await select(page, 'Television'); await finished;
  await expect(panel(page)).toContainText('Editing: Television'); await expect(panel(page).getByRole('button', { name: 'Apply edit' })).toHaveCount(0);
  expect(layerNamed(await stored(), 'Refrigerator')).toEqual(layerNamed(original, 'Refrigerator'));
  // The paid result was never seen, so it was kept: returning to the layer collects it without generating again.
  await select(page, 'Refrigerator');
  await expect(panel(page).getByRole('status').filter({ hasText: 'waiting to be collected' })).toBeVisible();
  await expect(panel(page).getByLabel('Layer edit prompt')).toHaveValue(slow);
  await panel(page).getByRole('button', { name: 'Check request status' }).click();
  await expect(panel(page).getByRole('button', { name: 'After — AI Edited' })).toHaveAttribute('aria-pressed', 'true');
  expect((await (await request.get('/__test__/image-calls', { params: { contains: slow } })).json()).count).toBe(1);
  await panel(page).getByRole('button', { name: 'Discard', exact: true }).click();
  expect(layerNamed(await stored(), 'Refrigerator')).toEqual(layerNamed(original, 'Refrigerator'));
});

test('browser asset storage failure preserves the original and allows Apply again without another generation', async ({ page, request }) => {
  const { stored, original } = await openCreative(page, request);
  await select(page, 'Refrigerator'); await generate(page, 'Open the upper door. Storage test');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { restoreAssetPut: () => void }).restoreAssetPut = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (value, key) { if (value?.id?.startsWith('ai-layer-')) throw new DOMException('Offline quota test', 'QuotaExceededError'); return key === undefined ? put.call(this, value) : put.call(this, value, key); };
  });
  await panel(page).getByRole('button', { name: 'Apply edit' }).click();
  await expect(panel(page).getByRole('alert')).toContainText(/quota|storage|image|saved/i);
  expect(await stored()).toEqual(original);
  await page.evaluate(() => (window as unknown as { restoreAssetPut: () => void }).restoreAssetPut());
  await panel(page).getByRole('button', { name: 'Apply edit' }).click();
  await expect.poll(async () => layerNamed(await stored(), 'Refrigerator').width).toBeGreaterThan(layerNamed(original, 'Refrigerator').width);
});

test('provider rejection identifies the parameter once and preserves the layer through status and discard', async ({ page, request }) => {
  const { id, stored, original } = await openCreative(page, request);
  await select(page, 'Refrigerator');
  const p = panel(page), prompt = `Open both doors. invalid parameter test ${id}`;
  const count = async () => (await (await request.get('/__test__/image-calls', { params: { contains: prompt } })).json()).count;
  await p.getByLabel('Layer edit prompt').fill(prompt);
  await p.getByRole('button', { name: 'Generate Edit', exact: true }).click();
  expect(await count()).toBe(0);
  await p.getByRole('checkbox').check();
  await p.getByRole('button', { name: 'Approve and generate' }).click();
  const alert = p.getByRole('alert');
  await expect(alert).toContainText('Generation failed'); await expect(alert).toContainText('The original layer was not changed.');
  await expect(p.locator('.ai-spinner')).toHaveCount(0); await expect(p.getByRole('button', { name: /Generating/ })).toHaveCount(0);
  await alert.getByText('Details').click(); await expect(alert).toContainText('Rejected parameter: background');
  expect((await alert.innerText()).match(/No automatic retry was made\./g)).toHaveLength(1);
  await expect(alert).not.toContainText('private provider response');
  expect(await stored()).toEqual(original); expect(await count()).toBe(1);
  // A definite failure has nothing to collect: no status check is offered, and no second request is possible from here.
  await expect(p.getByRole('button', { name: 'Check request status' })).toHaveCount(0);
  await p.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(p.getByRole('button', { name: 'Generate Edit', exact: true })).toBeEnabled();
  expect(await stored()).toEqual(original); expect(await count()).toBe(1);
});

test('Before/After replace one real canvas image for free; Discard restores pixels and Apply is one undo step', async ({ page, request }, info) => {
  const { id, stored } = await openCreative(page, request);
  await select(page, 'Refrigerator'); const p = panel(page);
  await page.getByLabel('Rotation', { exact: true }).fill('12'); await page.getByLabel('Rotation', { exact: true }).blur();
  for (let i = 0; i < 20; i++) await page.getByRole('slider', { name: 'Opacity', exact: true }).press('ArrowLeft');
  await expect.poll(async () => layerNamed(await stored(), 'Refrigerator').opacity).toBe(0.8);
  const original = await stored(), fridge = layerNamed(original, 'Refrigerator');
  await expect.poll(async () => (await canvasLayers(page)).every(l => l.images === 1)).toBe(true);
  const before = await canvasLayers(page), baselinePng = await exportedPixels(page, info.outputPath('original.png'));
  const undo = page.getByRole('button', { name: 'Undo', exact: true }), undoWasEnabled = await undo.isEnabled();
  const requests: string[] = [];
  page.on('request', r => { if (r.url().includes('/layer-edits')) requests.push(`${r.method()} ${r.url()}`); });
  const prompt = `Open both refrigerator doors. Canvas preview ${id}`, candidate = await generate(page, prompt);
  const count = async () => (await (await request.get('/__test__/image-calls', { params: { contains: prompt } })).json()).count;
  const after = await canvasLayers(page), afterFridge = after.find(l => l.id === fridge.id)!;
  expect(after.map(l => l.id)).toEqual(before.map(l => l.id));
  expect(afterFridge.images).toBe(1); expect(afterFridge.width).toBeCloseTo(fridge.width * candidate.geometry.width);
  expect(afterFridge.rotation).toBe(12); expect(afterFridge.opacity).toBe(0.8);
  const width = fridge.width * candidate.geometry.width, height = fridge.height * candidate.geometry.height;
  const dx = fridge.width * candidate.geometry.centerX - width / 2, dy = fridge.height * candidate.geometry.centerY - height / 2, angle = 12 * Math.PI / 180;
  expect(afterFridge.x).toBeCloseTo(fridge.x + dx * Math.cos(angle) - dy * Math.sin(angle));
  expect(afterFridge.y).toBeCloseTo(fridge.y + dx * Math.sin(angle) + dy * Math.cos(angle));
  expect(afterFridge.width! / afterFridge.height!).toBeCloseTo(candidate.image.width / candidate.image.height, 1);
  expect(afterFridge.width).toBeGreaterThan(fridge.width); expect(afterFridge.transparent).toBeGreaterThan(0);
  expect(afterFridge.pixels).not.toBe(before.find(l => l.id === fridge.id)!.pixels);
  expect(after.filter(l => l.id !== fridge.id)).toEqual(before.filter(l => l.id !== fridge.id));
  const requestCount = requests.length;
  for (let i = 0; i < 3; i++) {
    const b = p.getByRole('button', { name: 'Before — Original', exact: true }); await b.focus(); await b.press('Enter');
    await expect(b).toHaveAttribute('aria-pressed', 'true'); await expect.poll(() => canvasLayers(page)).toEqual(before);
    await expect(p.getByRole('button', { name: 'Apply Edit', exact: true })).toBeDisabled();
    const a = p.getByRole('button', { name: 'After — AI Edited', exact: true }); await a.focus(); await a.press('Space');
    await expect(a).toHaveAttribute('aria-pressed', 'true'); await expect.poll(() => canvasLayers(page)).toEqual(after);
  }
  expect(requests).toHaveLength(requestCount); expect(await count()).toBe(1); expect(await stored()).toEqual(original);
  expect(await undo.isEnabled()).toBe(undoWasEnabled);
  await expect(page.getByRole('button', { name: 'Save creative', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeDisabled();
  await expect(page.locator('.ai-layer-canvas-notice')).toContainText('Apply or Discard');
  const saved = await (await request.get(`${API}/${id}/creatives/${original.creative!.creativeId}`)).json() as ProductCreative;
  expect(saved.revision).toBe(original.creative!.syncedRevision);
  const storedCandidate = await page.evaluate(operationId => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open('frameflow-assets', 1); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction('assets'), get = tx.objectStore('assets').get(`ai-layer-${operationId}`); tx.oncomplete = () => { db.close(); resolve(!!get.result); }; tx.onerror = () => reject(tx.error); };
  }), candidate.operationId);
  expect(storedCandidate).toBe(false);
  await page.screenshot({ path: info.outputPath('after-on-canvas.png'), fullPage: true });
  await p.getByRole('button', { name: 'Before — Original', exact: true }).click();
  await page.screenshot({ path: info.outputPath('before-on-canvas.png'), fullPage: true });
  await p.getByRole('button', { name: 'After — AI Edited', exact: true }).click();
  await p.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect.poll(() => canvasLayers(page)).toEqual(before); expect(await stored()).toEqual(original);
  expect(await exportedPixels(page, info.outputPath('discarded.png'))).toEqual(baselinePng);
  expect(await count()).toBe(1);
  await generate(page, `Open both doors again. ${id}`);
  await p.getByRole('button', { name: 'Apply Edit', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(async () => layerNamed(await stored(), 'Refrigerator').width).toBeGreaterThan(fridge.width);
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
  await undo.click(); await expect.poll(() => stored()).toEqual(original);
  expect(await undo.isEnabled()).toBe(undoWasEnabled);
  await expect.poll(() => canvasLayers(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => canvasLayers(page)).toEqual(after);
});

test('selection, deselection, source changes, undo/redo and reload never keep or apply a stale canvas preview', async ({ page, request }) => {
  const { stored, original } = await openCreative(page, request), fridge = layerNamed(original, 'Refrigerator');
  await select(page, 'Refrigerator'); await generate(page, 'Open both doors. Selection test');
  await select(page, 'Television'); await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Apply edit' })).toHaveCount(0); expect(await stored()).toEqual(original);
  await select(page, 'Refrigerator'); await generate(page, 'Open both doors. Deselect test');
  await page.locator('#canvas-interaction').focus(); await page.keyboard.press('Escape');
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0); expect(await stored()).toEqual(original);
  await select(page, 'Refrigerator'); await generate(page, 'Open both doors. Resize test');
  await page.getByLabel('Width', { exact: true }).fill(String(fridge.width + 20)); await page.getByLabel('Width', { exact: true }).blur();
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
  await expect(panel(page).getByRole('alert')).toContainText('The selected layer changed'); await expect(panel(page).getByRole('button', { name: 'Apply edit' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => stored()).toEqual(original);
  await expect(panel(page).getByRole('alert')).toContainText('The selected layer changed'); await expect(panel(page).getByRole('button', { name: 'Apply edit' })).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Discard', exact: true }).click();
  await select(page, 'Refrigerator'); await generate(page, 'Open both doors. Delete test');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
  await expect.poll(async () => (await canvasLayers(page)).some(l => l.id === fridge.id)).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => stored()).toEqual(original); await select(page, 'Refrigerator');
  await page.getByLabel('X', { exact: true }).fill(String(fridge.x + 10)); await page.getByLabel('X', { exact: true }).blur();
  await generate(page, 'Open both doors. Undo test');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('The selected layer changed'); await expect(panel(page).getByRole('button', { name: 'Apply edit' })).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Discard', exact: true }).click();
  await expect.poll(async () => layerNamed(await stored(), 'Refrigerator').x).toBe(fridge.x + 10);
  const committed = await stored();
  await generate(page, 'Open both doors. Reload test'); await page.reload();
  await expect(page.locator('.layer-select')).not.toHaveCount(0);
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0); expect(await stored()).toEqual(committed);
  await select(page, 'Refrigerator'); await expect(panel(page).getByRole('button', { name: 'Apply edit' })).toHaveCount(0);
  await expect.poll(async () => (await canvasLayers(page)).find(l => l.id === fridge.id)?.width).toBeCloseTo(fridge.width);
  await panel(page).getByRole('button', { name: 'Check request status' }).click();
  await expect(panel(page).getByRole('button', { name: 'After — AI Edited' })).toHaveAttribute('aria-pressed', 'true');
  expect(await stored()).toEqual(committed);
  await panel(page).getByRole('button', { name: 'Discard', exact: true }).click();
  await generate(page, 'Open both doors. Switch design test');
  const projectId = await page.evaluate(() => (JSON.parse(localStorage.getItem('frameflow:project:v1')!) as ProjectDocument).id);
  const otherId = await page.getByLabel('Open design').locator('option').nth(1).getAttribute('value');
  await page.getByLabel('Open design').selectOption(otherId!);
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
  await page.getByLabel('Open design').selectOption(projectId);
  await expect.poll(() => stored()).toEqual(committed);
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
});

for (const [reason, base64] of [['corrupt', 'bm90IGEgcGljdHVyZQ=='], ['missing', '']]) test(`a ${reason} candidate image leaves the original canvas and document intact`, async ({ page, request }) => {
  const { stored, original } = await openCreative(page, request);
  await select(page, 'Refrigerator');
  await expect.poll(async () => (await canvasLayers(page)).every(l => l.images === 1)).toBe(true);
  const before = await canvasLayers(page);
  await page.route('**/layer-edits', async route => {
    const response = await route.fetch(), candidate = await response.json() as LayerEditCandidate;
    await route.fulfill({ response, json: { ...candidate, image: { ...candidate.image, base64 } } });
  });
  await generate(page, 'Open both doors. Broken preview test', false);
  await expect(panel(page).getByRole('alert')).toContainText('could not load or failed verification');
  await expect(panel(page).getByRole('button', { name: 'Apply edit' })).toBeDisabled();
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
  expect(await canvasLayers(page)).toEqual(before); expect(await stored()).toEqual(original);
  await panel(page).getByRole('button', { name: 'Discard', exact: true }).click();
});

test('late candidate image decoding after Discard cannot reappear on the canvas', async ({ page, request }) => {
  const { stored, original } = await openCreative(page, request);
  await select(page, 'Refrigerator');
  await expect.poll(async () => (await canvasLayers(page)).every(l => l.images === 1)).toBe(true);
  const before = await canvasLayers(page);
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (this.src.startsWith('blob:')) {
        HTMLImageElement.prototype.decode = decode;
        await new Promise<void>(resolve => { (window as unknown as { finishPreviewDecode: () => void }).finishPreviewDecode = resolve; });
      }
    };
  });
  await generate(page, 'Open both doors. Delayed decode test', false);
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finishPreviewDecode: unknown }).finishPreviewDecode)).toBe('function');
  await expect(panel(page).getByRole('button', { name: 'Preparing preview…' })).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: 'After — AI Edited' })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'After — AI Edited' })).toHaveCount(0);
  await page.evaluate(async () => {
    (window as unknown as { finishPreviewDecode: () => void }).finishPreviewDecode();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
  expect(await canvasLayers(page)).toEqual(before); expect(await stored()).toEqual(original);
});

/** Opaque pixels of one painted layer close to a colour, read from what Konva actually draws. */
async function layerColour(page: Page, id: string, rgb: [number, number, number]) {
  return page.evaluate(([id, [r, g, b]]) => {
    const stage = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages.find(s => s.container().closest('.canvas-frame'))!;
    const node = stage.find<Group>('.design-layer').find(n => n.id() === id)!, canvas = node.toCanvas({ pixelRatio: 1 });
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200 && Math.abs(data[i] - r) < 14 && Math.abs(data[i + 1] - g) < 14 && Math.abs(data[i + 2] - b) < 14) n++;
    return n;
  }, [id, rgb] as const);
}
const held = async (request: APIRequestContext, contains: string) => (await (await request.get('/__test__/layer-edits-held', { params: { contains } })).json()).count as number;
const calls = async (request: APIRequestContext, contains: string) => (await (await request.get('/__test__/image-calls', { params: { contains } })).json()).count as number;
/** Prompt → Generate Edit (free quote) → explicit approval. Returns the generate request once it is sent. */
async function approve(page: Page, prompt: string) {
  const p = panel(page);
  await p.getByLabel('Layer edit prompt').fill(prompt); await p.getByRole('button', { name: 'Generate Edit', exact: true }).click();
  await expect(p.getByRole('checkbox')).not.toBeChecked(); await expect(p.getByRole('button', { name: 'Approve and generate' })).toBeDisabled();
  await p.getByRole('checkbox').check();
  const sent = page.waitForRequest(r => r.url().endsWith('/layer-edits') && r.method() === 'POST');
  await p.getByRole('button', { name: 'Approve and generate' }).click();
  return (await sent).postDataJSON() as { operationId: string; sourceSha256: string; sourceCandidateId?: string; target: { revision: number } };
}

test('consecutive edits: open → Apply → close → Apply → red → Apply, each from the latest image, with saves during the requests', async ({ page, request }, info) => {
  const { id, stored, original } = await openCreative(page, request), fridge = layerNamed(original, 'Refrigerator');
  await select(page, 'Refrigerator'); const p = panel(page);
  await expect.poll(async () => (await canvasLayers(page)).every(l => l.images === 1)).toBe(true);
  const initial = await canvasLayers(page), others = (layers: Awaited<ReturnType<typeof canvasLayers>>) => layers.filter(l => l.id !== fridge.id);
  const posts: { operationId: string; sourceSha256: string; sourceCandidateId?: string; target: { revision: number } }[] = [];
  page.on('request', r => { if (r.url().endsWith('/layer-edits') && r.method() === 'POST') posts.push(r.postDataJSON()); });
  const steps: { prompt: string; colour: [number, number, number]; saveDuring: boolean }[] = [
    { prompt: `Open both refrigerator doors. hold test ${id} first`, colour: [158, 104, 71], saveDuring: false },
    { prompt: `Close the refrigerator door. hold test ${id} second`, colour: [148, 163, 184], saveDuring: true },
    { prompt: `Change refrigerator color to red. hold test ${id} third`, colour: [220, 38, 38], saveDuring: true },
  ];
  let previous: LayerEditCandidate | undefined, synced = original.creative!.syncedRevision, shownBefore = initial;
  const widths: number[] = [];
  for (const [i, step] of steps.entries()) {
    await p.getByLabel('Layer edit prompt').fill(step.prompt);
    await p.getByRole('button', { name: 'Generate Edit', exact: true }).click();
    // Every generation asks for its own approval.
    const approveButton = p.getByRole('button', { name: 'Approve and generate' });
    await expect(p.getByRole('checkbox')).not.toBeChecked(); await expect(approveButton).toBeDisabled();
    expect(await calls(request, step.prompt)).toBe(0);
    await p.getByRole('checkbox').check();
    const response = page.waitForResponse(r => r.url().endsWith('/layer-edits') && r.request().method() === 'POST');
    await approveButton.evaluate(b => { for (let k = 0; k < 3; k++) (b as HTMLButtonElement).click(); }); // Rapid repeated clicks.
    const generating = p.getByRole('button', { name: 'Generating edit…' });
    await expect(generating).toBeDisabled(); await expect(generating.locator('.ai-spinner')).toBeVisible();
    await expect(p.getByRole('status').filter({ hasText: 'Generating your edited Refrigerator…' })).toContainText('Your original image is safe.');
    await expect.poll(() => held(request, step.prompt)).toBe(1);
    if (i === 1) await page.screenshot({ path: info.outputPath('generating.png') });
    if (step.saveDuring) {
      // A normal Save creative acknowledgement while the request runs must not invalidate it.
      await page.getByRole('button', { name: 'Save creative', exact: true }).click();
      await expect(page.getByText(`Saved to creative · revision ${++synced}`)).toBeVisible();
      await expect.poll(async () => (await stored()).creative!.syncedRevision).toBe(synced);
    }
    await expect(generating).toBeVisible(); await expect(p.getByRole('alert')).toHaveCount(0);
    await expect(p).not.toContainText('changed');
    await request.post('/__test__/layer-edits-release', { params: { contains: step.prompt } });
    const candidate = await (await response).json() as LayerEditCandidate;
    const after = p.getByRole('button', { name: 'After — AI Edited', exact: true });
    await expect(after).toHaveAttribute('aria-pressed', 'true');
    await expect(p.locator('.ai-spinner')).toHaveCount(0); await expect(p.getByRole('alert')).toHaveCount(0);
    expect(posts).toHaveLength(i + 1); expect(await calls(request, step.prompt)).toBe(1);
    // The reference is exactly the image applied last.
    expect(posts[i].sourceCandidateId).toBe(previous?.operationId);
    expect(posts[i].sourceSha256).toBe(previous ? previous.image.sha256 : candidate.sourceSha256);
    expect(candidate.sourceSha256).toBe(posts[i].sourceSha256);
    // The real canvas: the After object is painted in place of the current one; no other layer changes.
    const shown = await canvasLayers(page), shownFridge = shown.find(l => l.id === fridge.id)!;
    expect(others(shown)).toEqual(others(initial)); expect(shownFridge.images).toBe(1); expect(shownFridge.transparent).toBeGreaterThan(0);
    expect(shownFridge.pixels).not.toBe(shownBefore.find(l => l.id === fridge.id)!.pixels);
    expect(await layerColour(page, fridge.id, step.colour)).toBeGreaterThan(1000);
    await p.getByRole('button', { name: 'Before — Original', exact: true }).click();
    await expect.poll(() => canvasLayers(page)).toEqual(shownBefore);
    await expect(p.getByRole('button', { name: 'Apply Edit', exact: true })).toBeDisabled();
    await after.click(); await expect.poll(() => canvasLayers(page)).toEqual(shown);
    if (i === 1) await page.screenshot({ path: info.outputPath('compare-after.png') });
    await p.getByRole('button', { name: 'Apply Edit', exact: true }).click();
    await expect(p.getByRole('status').filter({ hasText: 'Edit applied' })).toBeVisible();
    await expect(p.getByLabel('Layer edit prompt')).toHaveValue(''); await expect(p.getByRole('button', { name: 'Generate Edit', exact: true })).toBeVisible();
    await expect.poll(async () => { const l = layerNamed(await stored(), 'Refrigerator'); return l.type === 'image' ? l.assetId : ''; }).toBe(`ai-layer-${candidate.operationId}`);
    await expect.poll(() => canvasLayers(page)).toEqual(shown);
    widths.push(layerNamed(await stored(), 'Refrigerator').width);
    shownBefore = shown; previous = candidate;
  }
  // The request named the revision the editor held when it was sent; Apply succeeded after each later save.
  expect(posts.map(r => r.target.revision)).toEqual([1, 1, 2]);
  expect(widths[0]).toBeGreaterThan(fridge.width); expect(widths[1]).toBeLessThan(widths[0]);
  expect(await layerColour(page, fridge.id, [158, 104, 71])).toBe(0); expect(await layerColour(page, fridge.id, [148, 163, 184])).toBe(0);
  await page.screenshot({ path: info.outputPath('applied-red.png') });
  // Undo returns the closed grey object; Redo brings red back. (Keyboard: after a save, the existing topbar's centred
  // size label overlaps the Undo icon at this width — a pre-existing layout issue outside this feature.)
  await page.locator('#canvas-interaction').focus(); await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => layerColour(page, fridge.id, [148, 163, 184])).toBeGreaterThan(1000);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => layerColour(page, fridge.id, [220, 38, 38])).toBeGreaterThan(1000);
  // Save → server revision holds the red image → reload → export.
  await page.getByRole('button', { name: 'Save creative', exact: true }).click();
  await expect(page.getByText(`Saved to creative · revision ${synced + 1}`)).toBeVisible();
  const c = await (await request.get(`${API}/${id}/creatives/${original.creative!.creativeId}`)).json() as ProductCreative;
  const savedObject = c.objects.find(o => `object-${o.id}` === fridge.id)!;
  expect('sha256' in savedObject.asset ? savedObject.asset.sha256 : '').toBe(previous!.image.sha256);
  const beforeReload = layerNamed(await stored(), 'Refrigerator');
  await page.reload(); await expect.poll(async () => layerNamed(await stored(), 'Refrigerator')).toEqual(beforeReload);
  await select(page, 'Refrigerator'); await expect(panel(page).getByRole('button', { name: 'Generate Edit', exact: true })).toBeVisible();
  const png = await exportedPixels(page, info.outputPath('exported-red.png'));
  let red = 0; for (let k = 0; k < png.length; k += 4) if (Math.abs(png[k] - 220) < 14 && Math.abs(png[k + 1] - 38) < 14 && Math.abs(png[k + 2] - 38) < 14) red++;
  expect(red).toBeGreaterThan(1000);
  for (const step of steps) expect(await calls(request, step.prompt)).toBe(1);
});

test('a request survives leaving its layer; a layer change during generation ends the spinner with one message', async ({ page, request }) => {
  const { id, stored, original } = await openCreative(page, request), fridge = layerNamed(original, 'Refrigerator');
  await select(page, 'Refrigerator'); const p = panel(page);
  const leave = `Open both doors. hold test leave ${id}`;
  const sent = await approve(page, leave); await expect.poll(() => held(request, leave)).toBe(1);
  await select(page, 'Television'); await expect(p).toContainText('Editing: Television');
  await page.locator('#canvas-interaction').focus(); await page.keyboard.press('Escape');
  await select(page, 'Refrigerator');
  await expect(p.getByRole('status').filter({ hasText: 'waiting to be collected' })).toBeVisible();
  await expect(p.getByLabel('Layer edit prompt')).toHaveValue(leave); await expect(p.getByLabel('Layer edit prompt')).toBeDisabled();
  await expect(p.getByRole('button', { name: 'Generate Edit', exact: true })).toHaveCount(0);
  await p.getByRole('button', { name: 'Check request status' }).click();
  await expect(p.getByRole('status').filter({ hasText: 'Still processing' })).toBeVisible();
  expect(await calls(request, leave)).toBe(1);
  await request.post('/__test__/layer-edits-release', { params: { contains: leave } });
  await expect.poll(async () => (await (await request.get(`/api/layerize-experiment/layer-edits/${sent.operationId}`)).json()).status).toBe('candidate');
  await p.getByRole('button', { name: 'Check request status' }).click();
  await expect(p.getByRole('button', { name: 'After — AI Edited', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await calls(request, leave)).toBe(1);
  await p.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(p.getByRole('status').filter({ hasText: 'Edit discarded' })).toBeVisible();
  expect(await stored()).toEqual(original);

  const moved = `Open both doors. hold test moved ${id}`;
  const second = await approve(page, moved); await expect.poll(() => held(request, moved)).toBe(1);
  await expect(p.getByRole('button', { name: 'Generating edit…' })).toBeVisible();
  await page.getByLabel('X', { exact: true }).fill(String(Math.round(fridge.x) + 25)); await page.getByLabel('X', { exact: true }).blur();
  // Invalidated: the spinner and progress message are gone; one alert explains it.
  await expect(p.getByRole('alert')).toContainText('The layer changed during generation');
  await expect(p.getByRole('alert')).toHaveCount(1);
  await expect(p.getByRole('button', { name: 'Generating edit…' })).toHaveCount(0); await expect(p.locator('.ai-spinner')).toHaveCount(0);
  await expect(p).not.toContainText('Generating your edited');
  await p.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(p.getByRole('button', { name: 'Generate Edit', exact: true })).toBeVisible();
  await request.post('/__test__/layer-edits-release', { params: { contains: moved } });
  await expect.poll(async () => (await (await request.get(`/api/layerize-experiment/layer-edits/${second.operationId}`)).json()).status).toBe('discarded');
  await expect(p.getByRole('button', { name: 'After — AI Edited' })).toHaveCount(0); await expect(p.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => layerNamed(await stored(), 'Refrigerator').x).toBe(Math.round(fridge.x) + 25); // The user's change is kept.
  const kept = layerNamed(await stored(), 'Refrigerator'); expect(kept.type === 'image' && kept.assetId).toBe(fridge.type === 'image' && fridge.assetId);
  expect(await calls(request, moved)).toBe(1);
});

test('a lost response is collected without resubmitting; a request that never arrived is cleared; an exhausted balance fails once', async ({ page, request }) => {
  const { id, stored, original } = await openCreative(page, request);
  await select(page, 'Refrigerator'); const p = panel(page);
  const lost = `Open both doors. lost response ${id}`;
  await page.route('**/layer-edits', async route => { await route.fetch(); await route.abort('connectionreset'); }, { times: 1 });
  await approve(page, lost);
  await expect(p.getByRole('status').filter({ hasText: 'Unable to confirm request status' })).toContainText('never submits another generation');
  await expect(p.locator('.ai-spinner')).toHaveCount(0); expect(await calls(request, lost)).toBe(1);
  await p.getByRole('button', { name: 'Check request status' }).click();
  await expect(p.getByRole('button', { name: 'After — AI Edited', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await calls(request, lost)).toBe(1);
  await p.getByRole('button', { name: 'Discard', exact: true }).click();

  const never = `Open both doors. never arrived ${id}`;
  await page.route('**/layer-edits', route => route.abort('timedout'), { times: 1 });
  await approve(page, never);
  await expect(p.getByRole('status').filter({ hasText: 'Unable to confirm request status' })).toBeVisible();
  await p.getByRole('button', { name: 'Check request status' }).click();
  await expect(p.getByRole('status').filter({ hasText: 'isn’t on the server' })).toContainText('nothing was generated or charged');
  await expect(p.getByRole('button', { name: 'Generate Edit', exact: true })).toBeVisible();
  expect(await calls(request, never)).toBe(0);

  const balance = `Open both doors. balance test ${id}`;
  await approve(page, balance);
  const alert = p.getByRole('alert');
  await expect(alert).toContainText('Generation failed'); await expect(p.locator('.ai-spinner')).toHaveCount(0);
  await alert.getByText('Details').click(); await expect(alert).toContainText('no credit left');
  await expect(alert).not.toContainText('private provider response');
  await expect(p.getByRole('button', { name: 'Check request status' })).toHaveCount(0);
  await p.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(p.getByRole('button', { name: 'Generate Edit', exact: true })).toBeVisible(); await expect(p.getByRole('alert')).toHaveCount(0);
  expect(await calls(request, balance)).toBe(1); expect(await stored()).toEqual(original);
});

test('the AI panel fits a narrow inspector with a long prompt, through approval, generation and comparison', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  const { id } = await openCreative(page, request);
  await select(page, 'Refrigerator'); const p = panel(page);
  expect((await page.locator('.properties-panel').boundingBox())!.width).toBeLessThanOrEqual(240);
  const fits = () => p.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll('button, textarea, img, label, dl, .ai-layer-card')].every(c => { const b = c.getBoundingClientRect(); return b.width === 0 || (b.left >= box.left - 1 && b.right <= box.right + 1); });
  });
  const prompt = `Open both refrigerator doors fully. Keep the finish, handles and dispenser exactly as they are, ${'and keep every other detail unchanged, '.repeat(5)}hold test ${id}`;
  await p.getByLabel('Layer edit prompt').fill(prompt); expect(await fits()).toBe(true);
  await p.getByRole('button', { name: 'Generate Edit', exact: true }).click(); await expect(p.getByRole('checkbox')).toBeVisible();
  expect(await fits()).toBe(true); await p.screenshot({ path: info.outputPath('narrow-approval.png') });
  // Cost labels stay on one line (no mid-word breaks such as "Outp ut").
  expect(await p.locator('.ai-layer-facts dt').evaluateAll(dts => dts.every(d => d.getBoundingClientRect().height < 22))).toBe(true);
  await p.getByRole('checkbox').check(); await p.getByRole('button', { name: 'Approve and generate' }).click();
  await expect(p.getByRole('button', { name: 'Generating edit…' })).toBeVisible(); expect(await fits()).toBe(true);
  await p.screenshot({ path: info.outputPath('narrow-generating.png') });
  await expect.poll(() => held(request, prompt)).toBe(1); await request.post('/__test__/layer-edits-release', { params: { contains: prompt } });
  await expect(p.getByRole('button', { name: 'After — AI Edited', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await fits()).toBe(true); await p.screenshot({ path: info.outputPath('narrow-compare.png') });
  // Keyboard: Space selects Before; Tab moves to After with a visible focus ring; Enter selects it.
  const before = p.getByRole('button', { name: 'Before — Original', exact: true }), afterCard = p.getByRole('button', { name: 'After — AI Edited', exact: true });
  await before.focus(); await page.keyboard.press('Space'); await expect(before).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab'); await expect(afterCard).toBeFocused();
  expect(await afterCard.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter'); await expect(afterCard).toHaveAttribute('aria-pressed', 'true');
  await p.getByRole('button', { name: 'Discard', exact: true }).click();
});
