/**
 * "The layer changed during generation" (2026-11-02, Ornate Golden Appliance Showcase, Freestanding dishwasher, "open this"):
 * the server had accepted, generated and billed that request; only the editor's own check rejected it, and the paid result
 * was deleted. These tests hold the fake provider (by exact operation ID) while the editor does what a person might do
 * while waiting. Harmless activity must never invalidate the request. A genuine change to the selected layer still must,
 * and its result is kept until someone discards it, so undoing the change lets an explicit status check collect it.
 *
 * Real saved templates from this machine's git-ignored artifacts are copied into the fixture server's temporary store
 * (never written back); each test is skipped where they are absent. No provider is called.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { DesignVariant, LayerEditCandidate, LayerEditStatus, ProductCreative, ProjectDocument } from '@frameflow/shared';
import type { Stage } from 'konva/lib/Stage';
import type { Group } from 'konva/lib/Group';
import type { Image as KonvaImage } from 'konva/lib/shapes/Image';

const API = '/api/layerize-experiment/product-templates', EDITS = '/api/layerize-experiment/layer-edits';
const APPLIANCES = { id: 'pt-0dd04956555b', name: 'Ornate Golden Appliance Showcase' }, DISHWASHER = 'Freestanding dishwasher';
const TEMPLATES = [
  { ...APPLIANCES, products: ['Multi-door refrigerator', 'Front-loading washing machine'] },
  { id: 'pt-4af15de2f0cd', name: 'Colourful Onam Festival Electronics Poster (1)', products: ['Television', 'Laptop computer', 'Smartphone'] },
  { id: 'pt-bf4a46747d65', name: 'Ganesh ji', products: ['French-door refrigerator', 'Dishwasher'] },
];
test.use({ extraHTTPHeaders: { origin: `http://127.0.0.1:${process.env.FRAMEFLOW_OFFLINE_E2E_PORT ?? 3317}` }, actionTimeout: 30000 });
test.setTimeout(240000);
// A failed test must not leave its provider call held: held calls occupy the server's image slots for every later test.
const heldOperations = new Set<string>();
test.afterEach(async ({ request }) => {
  for (const operation of heldOperations) await request.post('/__test__/layer-edits-release', { params: { operation } }).catch(() => undefined);
  heldOperations.clear();
});

type Template = { id: string; name: string };
async function openSaved(page: Page, request: APIRequestContext, template: Template) {
  const imported = await request.post('/__test__/import-product-template', { params: { id: template.id } });
  test.skip(!imported.ok(), `${template.name} is not saved on this machine.`);
  await page.route(url => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1', r => r.abort());
  // Optionally exercise React StrictMode through a running Vite client. API requests still use the isolated fake server.
  if (process.env.FRAMEFLOW_E2E_DEV_CLIENT) await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__test__/')) return route.fallback();
    const response = await route.fetch({ url: new URL(`${url.pathname}${url.search}`, process.env.FRAMEFLOW_E2E_DEV_CLIENT).href });
    await route.fulfill({ response });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'OpenAI + Seedream test' }).click();
  const modal = page.getByRole('dialog', { name: 'OpenAI + Seedream test' });
  await modal.getByRole('tab', { name: 'Offer Templates', exact: true }).click();
  await modal.getByRole('article', { name: `Product template ${template.name}`, exact: true }).getByRole('button', { name: 'Use template', exact: true }).click();
  // A creative of its own, made from the saved template as the person's was, so repeated and parallel runs never share one
  // (two runs editing the same layer of one creative are correctly refused as BUSY by the server).
  const made = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `${API}/${template.id}/creatives`);
  await modal.getByRole('button', { name: 'New creative' }).click();
  const created = await (await made).json() as ProductCreative, creativeId = created.id;
  // Open only once the new creative is the current one (opening earlier would open the previously current creative).
  await expect.poll(async () => (await modal.locator('.ot-item[aria-pressed="true"]').allTextContents()).join('|'), { timeout: 30000 }).toContain(created.name);
  await modal.getByRole('button', { name: 'Open in editor', exact: true }).click();
  await expect(modal).toBeHidden();
  const stored = async () => page.evaluate(id => (JSON.parse(localStorage.getItem('frameflow:project:v1')!) as ProjectDocument).variants.find(v => v.creative?.masterId === id)!, template.id);
  await expect.poll(async () => (await stored())?.creative?.creativeId).toBe(creativeId);
  // Exactly one paid-generation request per approval, however the editor is used meanwhile.
  const posts: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === EDITS) posts.push(r.url()); });
  return { stored, original: await stored(), posts };
}

const panel = (page: Page) => page.getByRole('region', { name: 'AI Edit Layer', exact: true });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Exact names: real templates also have layers such as "Product display card · … in front of Television".
const layerRow = (page: Page, name: string) => page.locator('.layer-select').filter({ has: page.locator('.layer-name', { hasText: new RegExp(`^${escape(name)}$`) }) });
async function select(page: Page, name: string) { await layerRow(page, name).click(); await expect(panel(page)).toContainText(`Editing: ${name}`); }
const layerNamed = (v: DesignVariant, name: string) => v.layers!.find(l => l.name === name)!;
const assetOf = (v: DesignVariant, name: string) => { const l = layerNamed(v, name); return l.type === 'image' ? l.assetId : undefined; };

/** A page point where the topmost thing drawn is this layer: text or another layer may cover parts of it. */
async function pointOn(page: Page, layerId: string) {
  const point = await page.evaluate(id => {
    const stage = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages.find(s => s.container().closest('.canvas-frame'))!, node = stage.findOne<Group>(`#${id}`)!, r = node.getClientRect(), box = stage.container().getBoundingClientRect();
    for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75]) for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const p = { x: r.x + r.width * fx, y: r.y + r.height * fy };
      if (stage.getIntersection(p)?.findAncestor('.design-layer')?.id() === id) return { x: box.left + p.x, y: box.top + p.y };
    }
    return null;
  }, layerId);
  expect(point, `a visible point of ${layerId}`).toBeTruthy();
  return point!;
}
/** The centre of one of the selection's Transformer handles ("bottom-right", "rotater", …). */
async function handle(page: Page, name: string) {
  return page.evaluate(anchor => {
    const stage = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages.find(s => s.container().closest('.canvas-frame'))!, a = stage.findOne<Group>('.layer-transformer')!.findOne(`.${anchor}`)!, r = a.getClientRect(), box = stage.container().getBoundingClientRect();
    return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
  }, name);
}
/** What Konva paints for this layer: its bitmap's size, so the applied image is the one shown. */
const painted = (page: Page, layerId: string) => page.evaluate(id => {
  const stage = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages.find(s => s.container().closest('.canvas-frame'))!, image = stage.findOne<Group>(`#${id}`)?.findOne<KonvaImage>('.layer-image')?.image() as HTMLImageElement | undefined;
  return image ? { width: image.naturalWidth, height: image.naturalHeight } : null;
}, layerId);

/** Approves one generation whose fake provider call is held, by its exact operation ID, until release(). */
async function approveHeld(page: Page, request: APIRequestContext, prompt: string) {
  const p = panel(page);
  await p.getByLabel('Layer edit prompt').fill(prompt);
  await p.getByRole('button', { name: 'Generate Edit', exact: true }).click();
  await p.getByRole('checkbox').check();
  let operationId = '';
  await page.route(`**${EDITS}`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    operationId = (route.request().postDataJSON() as { operationId: string }).operationId;
    await request.post('/__test__/layer-edits-hold', { params: { operation: operationId } }); heldOperations.add(operationId);
    await route.fallback();
  }, { times: 1 });
  const response = page.waitForResponse(r => new URL(r.url()).pathname === EDITS && r.request().method() === 'POST', { timeout: 200000 });
  await p.getByRole('button', { name: 'Approve and generate' }).click();
  // The server runs two image requests at once (FRAMEFLOW_PRODUCT_IMAGE_CONCURRENCY); parallel tests' held calls can queue this one.
  await expect.poll(async () => !!operationId && (await (await request.get('/__test__/layer-edits-held', { params: { operation: operationId } })).json()).count, { timeout: 120000 }).toBe(1);
  await expect(p.getByRole('button', { name: 'Generating edit…' })).toBeVisible();
  return {
    get operationId() { return operationId; },
    // As the editor asks: naming the creative revision it holds now, which a Save during the request advanced.
    status: async () => {
      const revision = (await storedVariant(page)).creative?.syncedRevision, response = await request.get(`${EDITS}/${operationId}`, { params: revision ? { revision } : {} });
      const body = await response.json() as LayerEditStatus & { error?: { message: string } };
      expect(response.ok(), body.error?.message).toBe(true);
      return body.status;
    },
    release: async () => { expect((await (await request.post('/__test__/layer-edits-release', { params: { operation: operationId } })).json()).released).toBe(1); return (await response).json() as Promise<LayerEditCandidate>; },
  };
}

/** The request is still running and valid: no conflict message, the same layer, the spinner still shown. */
async function stillGenerating(page: Page, name: string) {
  const p = panel(page);
  await expect(p).toContainText(`Editing: ${name}`);
  await expect(p.getByRole('alert')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Generating edit…' })).toBeVisible();
}
/**
 * Everything a person might do while waiting that does not change the selected layer itself. The panel's check is sticky
 * (a change made and undone still counts), so stillGenerating after each step also proves nothing in between invalidated it.
 */
async function harmlessActivity(page: Page, name: string, layerId: string) {
  // A click on the selected object without moving it.
  const at = await pointOn(page, layerId); await page.mouse.click(at.x, at.y); await stillGenerating(page, name);
  // A press on a resize handle and on the rotation handle, without moving either.
  for (const anchor of ['bottom-right', 'rotater']) { const h = await handle(page, anchor); await page.mouse.click(h.x, h.y); await stillGenerating(page, name); }
  // Zoom, Fit, and a window resize that refits the canvas.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const size = page.viewportSize()!; await page.setViewportSize({ width: size.width - 160, height: size.height - 80 }); await page.setViewportSize(size);
  await stillGenerating(page, name);
  // Another layer hidden and shown again, then moved behind this one and back: every layer's stacking number is renumbered.
  const rows = await page.locator('.layers-list li[data-layer-id]').evaluateAll(els => els.map(el => ({ id: el.getAttribute('data-layer-id')!, name: el.querySelector('.layer-name')!.textContent! })));
  const index = rows.findIndex(r => r.id === layerId), front = index > 0, other = rows[front ? index - 1 : index + 1];
  await page.getByRole('button', { name: `Hide ${other.name}`, exact: true }).click(); await page.getByRole('button', { name: `Show ${other.name}`, exact: true }).click();
  await stillGenerating(page, name);
  const grip = page.getByRole('button', { name: `Reorder ${other.name}`, exact: true }), zIndex = async () => layerNamed(await storedVariant(page), name).zIndex;
  const before = await zIndex();
  await grip.focus(); await page.keyboard.press(front ? 'ArrowDown' : 'ArrowUp');
  await expect.poll(zIndex).not.toBe(before); // The selected layer's own stacking number changed with the reorder.
  await page.keyboard.press(front ? 'ArrowUp' : 'ArrowDown');
  await expect.poll(zIndex).toBe(before);
  await stillGenerating(page, name);
  // The canvas fill changed, then Undo (the shortcut: after a save, the top bar's message can cover the Undo button).
  await page.getByLabel('Background colour').fill('#123456'); await page.locator('#canvas-interaction').focus(); await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await storedVariant(page)).canvas.backgroundColor).not.toBe('#123456');
  await stillGenerating(page, name);
  // Save creative while the request runs: only the creative's revision moves.
  await saveCreative(page);
  await stillGenerating(page, name);
}
/** Save creative, then wait until the editor's stored copy (written 500 ms after a change) names the revision just saved. */
async function saveCreative(page: Page) {
  await page.getByRole('button', { name: 'Save creative', exact: true }).click();
  await expect(page.locator('.creative-save-ok')).toContainText('Saved to creative');
  const revision = Number((await page.locator('.creative-save-ok').textContent())!.match(/revision (\d+)/)![1]);
  await expect.poll(async () => (await storedVariant(page)).creative?.syncedRevision).toBe(revision);
}
const storedVariant = (page: Page) => page.evaluate(() => { const d = JSON.parse(localStorage.getItem('frameflow:project:v1')!) as ProjectDocument; return d.variants.find(v => v.creative)!; });

/** One full harmless journey for one product: held generation, activity, result, Apply. Returns the applied candidate. */
async function editThroughActivity(page: Page, request: APIRequestContext, name: string, prompt: string) {
  await select(page, name);
  const layer = layerNamed(await storedVariant(page), name), p = panel(page);
  const held = await approveHeld(page, request, prompt);
  await harmlessActivity(page, name, layer.id);
  expect(layerNamed(await storedVariant(page), name)).toEqual(layer); // The selected layer itself never changed.
  const candidate = await held.release();
  await expect(p.getByRole('button', { name: 'After — AI Edited', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(p.getByRole('alert')).toHaveCount(0);
  expect(await held.status()).toBe('candidate');
  await p.getByRole('button', { name: 'Apply edit' }).click();
  await expect.poll(async () => assetOf(await storedVariant(page), name)).toBe(`ai-layer-${held.operationId}`);
  await expect(p.getByRole('status').filter({ hasText: 'Edit applied' })).toBeVisible();
  return { layer, candidate };
}

/** Save, reload, and check the editor and the saved creative both hold each applied image, and nothing else changed. */
async function saveReloadAndVerify(page: Page, request: APIRequestContext, template: Template, original: DesignVariant, applied: Map<string, LayerEditCandidate>) {
  await saveCreative(page);
  await page.reload();
  await expect(page.locator('.layer-select')).not.toHaveCount(0);
  const reloaded = await storedVariant(page);
  for (const layer of original.layers!) {
    const now = reloaded.layers!.find(l => l.id === layer.id)!, candidate = applied.get(layer.name);
    if (!candidate) { expect(now.type === 'image' && now.assetId).toBe(layer.type === 'image' && layer.assetId); continue; }
    expect(assetOf(reloaded, layer.name)).toBe(`ai-layer-${candidate.operationId}`);
    await expect.poll(() => painted(page, layer.id)).toEqual({ width: candidate.image.width, height: candidate.image.height });
  }
  const link = reloaded.creative!, saved = await (await request.get(`${API}/${template.id}/creatives/${link.creativeId}`)).json() as ProductCreative;
  expect(saved.revision).toBe(link.syncedRevision);
  for (const [name, candidate] of applied) {
    const object = saved.objects.find(o => o.label === name)!;
    expect(object.asset, name).toMatchObject({ sha256: candidate.image.sha256 });
  }
}

/** Each harmless action alone, against its own held "open this" generation: which (if any) makes the editor reject it. */
test('Freestanding dishwasher: no single harmless action during generation is reported as a layer change', async ({ page, request }) => {
  const { stored } = await openSaved(page, request, APPLIANCES);
  await select(page, DISHWASHER); const p = panel(page), layer = layerNamed(await stored(), DISHWASHER);
  const rows = await page.locator('.layers-list li[data-layer-id]').evaluateAll(els => els.map(el => ({ id: el.getAttribute('data-layer-id')!, name: el.querySelector('.layer-name')!.textContent! })));
  const index = rows.findIndex(r => r.id === layer.id), front = index > 0, other = rows[front ? index - 1 : index + 1];
  const press = async (anchor: string) => { const h = await handle(page, anchor); await page.mouse.click(h.x, h.y); };
  const reorder = async (key: string) => { await page.getByRole('button', { name: `Reorder ${other.name}`, exact: true }).focus(); await page.keyboard.press(key); };
  const rotate = async () => {
    await page.getByLabel('Rotation', { exact: true }).fill('12.3'); await page.getByLabel('Rotation', { exact: true }).blur();
    await expect.poll(async () => layerNamed(await stored(), DISHWASHER).rotation).toBe(12.3);
  };
  // [name, before the request, during it]
  const actions: [string, (() => Promise<unknown>) | null, () => Promise<unknown>][] = [
    ['click the selected object', null, async () => { const at = await pointOn(page, layer.id); await page.mouse.click(at.x, at.y); }],
    ['press the resize handle', null, () => press('bottom-right')],
    ['press the rotation handle', null, () => press('rotater')],
    ['zoom in, zoom out and Fit', null, async () => { for (const name of ['Zoom in', 'Zoom out', 'Fit']) await page.getByRole('button', { name, exact: true }).click(); }],
    ['resize the window', null, async () => { const size = page.viewportSize()!; await page.setViewportSize({ width: size.width - 160, height: size.height - 80 }); await page.setViewportSize(size); }],
    ['hide and show another layer', null, async () => { await page.getByRole('button', { name: `Hide ${other.name}`, exact: true }).click(); await page.getByRole('button', { name: `Show ${other.name}`, exact: true }).click(); }],
    ['reorder another layer past it', null, () => reorder(front ? 'ArrowDown' : 'ArrowUp')],
    ['reorder it back', null, () => reorder(front ? 'ArrowUp' : 'ArrowDown')],
    ['change the canvas fill, then Undo', null, async () => { await page.getByLabel('Background colour').fill('#123456'); await page.getByRole('button', { name: 'Undo', exact: true }).click(); }],
    ['Save creative', null, () => saveCreative(page)],
    ['press the handles of an object rotated 12.3°', rotate, async () => { await press('rotater'); await press('bottom-right'); }],
  ];
  const rejected: Record<string, boolean> = {};
  for (const [name, before, during] of actions) {
    await before?.();
    const held = await approveHeld(page, request, 'open this');
    await during();
    await page.waitForTimeout(150);
    rejected[name] = await p.getByRole('alert').count() > 0;
    if (rejected[name]) { await p.getByRole('button', { name: 'Discard', exact: true }).click(); await held.release(); }
    else { await held.release(); await expect(p.getByRole('button', { name: 'After — AI Edited', exact: true })).toHaveAttribute('aria-pressed', 'true'); await p.getByRole('button', { name: 'Discard', exact: true }).click(); }
    await expect(p.getByRole('button', { name: 'Generate Edit', exact: true })).toBeVisible();
  }
  expect(rejected).toEqual(Object.fromEntries(actions.map(([name]) => [name, false])));
});

test('Freestanding dishwasher, "open this": harmless editor activity during generation never rejects it; Apply → Save → reload keeps it', async ({ page, request }) => {
  const { original, posts } = await openSaved(page, request, APPLIANCES);
  const { candidate } = await editThroughActivity(page, request, DISHWASHER, 'open this');
  expect(posts).toHaveLength(1);
  await saveReloadAndVerify(page, request, APPLIANCES, original, new Map([[DISHWASHER, candidate]]));
});

test('Freestanding dishwasher: an accidental move during generation is a safe conflict; the paid result is kept, and Undo then Check request status collects it', async ({ page, request }) => {
  const { stored, posts } = await openSaved(page, request, APPLIANCES);
  await select(page, DISHWASHER); const p = panel(page), before = layerNamed(await stored(), DISHWASHER);
  const held = await approveHeld(page, request, 'open this');
  // A click that slips a few pixels: Konva starts a drag past 3 screen pixels, so this really moves the layer.
  const at = await pointOn(page, before.id);
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 5, at.y + 4, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => layerNamed(await stored(), DISHWASHER).x).not.toBe(before.x);
  await expect(p.getByRole('alert')).toContainText('The layer changed during generation');
  await expect(p.getByRole('alert')).toHaveCount(1); await expect(p.locator('.ai-spinner')).toHaveCount(0);
  const candidate = await held.release();
  // The result arrived while the layer differs: it is never applied or shown, and never deleted by the editor's own check.
  await page.waitForTimeout(500); // Room for any client-side discard request to reach the server.
  expect(await held.status()).toBe('candidate');
  await expect(p.getByRole('alert')).toContainText('This edit no longer matches the layer');
  await expect(p.getByRole('alert')).toContainText('Changed: position');
  await expect(p.getByRole('alert')).toContainText('kept');
  await expect(p.getByRole('button', { name: 'Apply edit' })).toHaveCount(0); await expect(page.locator('.ai-layer-canvas-notice')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Check request status' })).toHaveCount(0); // Not while the layer still differs.
  // Undo the slip: the layer is exactly as requested again, and an explicit, free check collects the same result.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => layerNamed(await stored(), DISHWASHER)).toEqual(before);
  await expect(p.getByRole('alert')).toHaveCount(1); // Undo alone never revives it.
  await p.getByRole('button', { name: 'Check request status' }).click();
  await expect(p.getByRole('button', { name: 'After — AI Edited', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await p.getByRole('button', { name: 'Apply edit' }).click();
  await expect.poll(async () => assetOf(await stored(), DISHWASHER)).toBe(`ai-layer-${candidate.operationId}`);
  expect(posts).toHaveLength(1);
});

test('Freestanding dishwasher: a deliberate change that stays keeps the result recoverable until Discard, which then deletes it', async ({ page, request }) => {
  const { stored, posts } = await openSaved(page, request, APPLIANCES);
  await select(page, DISHWASHER); const p = panel(page), before = layerNamed(await stored(), DISHWASHER);
  const held = await approveHeld(page, request, 'open this');
  await page.getByLabel('Width', { exact: true }).fill(String(Math.round(before.width) + 30)); await page.getByLabel('Width', { exact: true }).blur();
  await expect(p.getByRole('alert')).toContainText('The layer changed during generation');
  await held.release();
  await page.waitForTimeout(500);
  expect(await held.status()).toBe('candidate');
  await expect(p.getByRole('alert')).toContainText('Changed: size');
  await expect(p.getByRole('button', { name: 'Apply edit' })).toHaveCount(0);
  await p.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect.poll(held.status).toBe('discarded');
  await expect(p.getByRole('button', { name: 'Generate Edit', exact: true })).toBeVisible();
  await expect.poll(async () => layerNamed(await stored(), DISHWASHER).width).toBe(Math.round(before.width) + 30); // The person's change is kept.
  expect(assetOf(await stored(), DISHWASHER)).toBe(before.type === 'image' && before.assetId);
  expect(posts).toHaveLength(1);
});

test('a rotated object: pressing its rotation or resize handle without moving is not an edit and keeps the request valid', async ({ page, request }) => {
  const { stored } = await openSaved(page, request, APPLIANCES);
  await select(page, DISHWASHER); const p = panel(page);
  await page.getByLabel('Rotation', { exact: true }).fill('12.3'); await page.getByLabel('Rotation', { exact: true }).blur();
  await expect.poll(async () => layerNamed(await stored(), DISHWASHER).rotation).toBe(12.3);
  const before = layerNamed(await stored(), DISHWASHER), held = await approveHeld(page, request, 'open this');
  for (const anchor of ['rotater', 'bottom-right', 'top-left']) { const h = await handle(page, anchor); await page.mouse.click(h.x, h.y); await stillGenerating(page, DISHWASHER); }
  expect(layerNamed(await stored(), DISHWASHER)).toEqual(before); // Not 12.299999999999955, and no extra undo step.
  await held.release();
  await expect(p.getByRole('button', { name: 'After — AI Edited', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await p.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect.poll(held.status).toBe('discarded');
});

for (const template of TEMPLATES) test(`${template.name}: ${template.products.join(', ')} each survive harmless activity during generation, then Apply → Save → reload`, async ({ page, request }) => {
  const { original, posts } = await openSaved(page, request, template), applied = new Map<string, LayerEditCandidate>();
  for (const name of template.products) applied.set(name, (await editThroughActivity(page, request, name, 'open this')).candidate);
  expect(posts).toHaveLength(template.products.length);
  await saveReloadAndVerify(page, request, template, original, applied);
});
