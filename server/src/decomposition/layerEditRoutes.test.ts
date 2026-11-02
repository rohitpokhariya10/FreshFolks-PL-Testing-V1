import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { LayerEditCandidate, LayerEditEstimate, LayerEditRequest, ProductCreative } from '@frameflow/shared';
import { setup, savedTemplate, sha } from './protectedTemplates/product/productServer.fixture.js';
import { productPosterPng } from './protectedTemplates/product/productPoster.fixture.js';
import type { RatioRegenerator } from './protectedTemplates/product/ratioRegeneration.js';
const realFetch = globalThis.fetch;
beforeAll(() => {
  for (const key of ['OPENAI_API_KEY', 'FAL_KEY', 'GEMINI_API_KEY', 'CLOUDFLARE_API_TOKEN']) vi.stubEnv(key, '');
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('http://127.0.0.1:')) throw new Error('Nonlocal network is forbidden in this test.');
    return realFetch(input, init);
  });
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('resolves a real creative object, enforces access/type/revision/hash, and never revises a creative during preview', async () => {
  const regenerate = vi.fn<RatioRegenerator['regenerate']>(async () => ({ image: await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="180" y="240" width="664" height="544" rx="40" fill="#9e6847"/></svg>')).png().toBuffer() }));
  const s = await setup({ layerEditor: { model: 'gpt-image-2', offline: false, regenerate } });
  try {
    const v = await savedTemplate(s, await productPosterPng()), id = v.template.id;
    const c = (await s.send<ProductCreative>('POST', `/${id}/creatives`, { revision: 1, name: 'Object edit' })).body;
    const object = c.objects.find(o => o.label === 'Refrigerator')!;
    const bytes = readFileSync(join(s.protectedDir, id, object.asset.file));
    const input: LayerEditRequest = { target: { kind: 'creative', templateId: id, creativeId: c.id, revision: c.revision, layerId: `object-${object.id}` }, sourceSha256: sha(bytes), prompt: 'Open both doors.', model: 'gpt-image-2', operationId: randomUUID(), approveUsd: 0.27 };
    const base = s.base.replace('/product-templates', '/layer-edits');
    const post = (path: string, data: unknown, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    expect((await post('/estimate', input, { Origin: 'https://untrusted.invalid', 'X-Forwarded-For': '203.0.113.1' })).status).toBe(403);
    expect((await post('/estimate', { ...input, target: { ...input.target, layerId: 'art-background' } })).status).toBe(400);
    expect((await post('/estimate', { ...input, target: { ...input.target, creativeId: 'pc-ffffff' } })).status).toBe(404);
    expect((await post('/estimate', { ...input, target: { ...input.target, revision: 999 } })).status).toBe(409);
    expect((await post('/estimate', { ...input, sourceSha256: 'a'.repeat(64), imageUrl: 'file:///etc/passwd' })).status).toBe(409);
    expect((await post('', { ...input, approveUsd: 0 })).status).toBe(400);
    expect(regenerate).not.toHaveBeenCalled();
    const quote = await post('/estimate', input); expect(quote.status).toBe(200);
    const response = await post('', input); expect(response.status).toBe(200);
    const candidate = await response.json() as LayerEditCandidate;
    expect(regenerate.mock.calls[0][0]).toMatchObject({ prompt: expect.stringContaining('Refrigerator') });
    expect(regenerate.mock.calls[0][0]).not.toHaveProperty('background');
    // The same operation again: its stored result, not a second generation.
    const repeated = await post('', input); expect(repeated.status).toBe(200);
    expect(((await repeated.json()) as LayerEditCandidate).image.sha256).toBe(candidate.image.sha256); expect(regenerate).toHaveBeenCalledTimes(1);
    expect((await s.call<ProductCreative>(`/${id}/creatives/${c.id}`)).body).toEqual(c);
    expect((await post(`/${candidate.operationId}/apply`, {})).status).toBe(200);
    expect((await s.call<ProductCreative>(`/${id}/creatives/${c.id}`)).body).toEqual(c);
    expect(sha(readFileSync(join(s.protectedDir, id, object.asset.file)))).toBe(sha(bytes));
    const hidden = (await s.send<ProductCreative>('PUT', `/${id}/creatives/${c.id}`, { expectedRevision: c.revision, creative: { ...c, objects: c.objects.map(o => o.id === object.id ? { ...o, hidden: true } : o) } })).body;
    expect(hidden.revision).toBe(2);
    expect((await post('/estimate', { ...input, target: { ...input.target, revision: 2 } })).status).toBe(400);
    expect((await post(`/${candidate.operationId}/apply`, {})).status).toBe(409);
    expect(regenerate).toHaveBeenCalledTimes(1);
  } finally { await s.close(); }
}, 120000);
it('after an applied AI edit is saved into the creative, the next edit still finds the template product as its original', async () => {
  // A perfectly faithful fake edit: the image it was sent, unchanged.
  const regenerate = vi.fn<RatioRegenerator['regenerate']>(async ({ image }) => ({ image }));
  const s = await setup({ layerEditor: { model: 'gpt-image-2', offline: false, regenerate } });
  try {
    const v = await savedTemplate(s, await productPosterPng()), id = v.template.id;
    const c = (await s.send<ProductCreative>('POST', `/${id}/creatives`, { revision: 1, name: 'Chained edit' })).body;
    const object = c.objects.find(o => o.label === 'Refrigerator')!, layerId = `object-${object.id}`;
    const templateBytes = readFileSync(join(s.protectedDir, id, object.asset.file));
    const base = s.base.replace('/product-templates', '/layer-edits');
    const post = async <T>(path: string, data: unknown) => { const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: r.status, body: await r.json() as T }; };
    const first = (await post<LayerEditCandidate>('', { target: { kind: 'creative', templateId: id, creativeId: c.id, revision: 1, layerId }, sourceSha256: sha(templateBytes), prompt: 'Remove the logo', model: 'gpt-image-2', operationId: randomUUID(), approveUsd: 0.27 })).body;
    expect(first.references).toMatchObject({ current: { aiEdits: 0 } }); expect(first.references?.original).toBeUndefined();
    expect((await post(`/${first.operationId}/apply`, {})).status).toBe(200);
    // Save creative: the editor uploads the applied image byte for byte and saves the object with it.
    const edited = Buffer.from(first.image.base64, 'base64'), form = new FormData();
    form.append('image', new Blob([new Uint8Array(edited)], { type: 'image/png' }), 'Refrigerator.png');
    const asset = (await (await fetch(`${s.base}/${id}/creatives/${c.id}/assets`, { method: 'POST', body: form })).json() as { asset: { file: string; width: number; height: number } }).asset;
    const saved = (await s.send<ProductCreative>('PUT', `/${id}/creatives/${c.id}`, { expectedRevision: c.revision, creative: { ...c, objects: c.objects.map(o => o.id === object.id ? { ...o, asset: { ...asset, kind: 'upload', background: 'transparent' } } : o) } })).body;
    expect(saved.revision).toBe(2); expect(saved.objects.find(o => o.id === object.id)!.asset.kind).toBe('upload');
    const quote = (await post<LayerEditEstimate>('/estimate', { target: { kind: 'creative', templateId: id, creativeId: c.id, revision: 2, layerId }, sourceSha256: sha(edited), prompt: 'Make the handle chrome' })).body;
    expect(quote.references).toMatchObject({ current: { sha256: sha(edited), aiEdits: 1 }, original: { sha256: sha(templateBytes), attached: true, instructions: ['Remove the logo'] } });
    expect(regenerate).toHaveBeenCalledTimes(1);
  } finally { await s.close(); }
}, 120000);
