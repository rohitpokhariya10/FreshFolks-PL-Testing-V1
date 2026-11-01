import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { LayerEditSource } from '@frameflow/shared';
import type { RatioRegenerator } from './protectedTemplates/product/ratioRegeneration.js';
import { createLayerEdits } from './layerEdit.js';
import { layerEditPrompt, prepareLayerEdit, validateLayerEdit } from './layerEditImage.js';
import { layerEditTarget } from './layerEditSource.js';
import { sha256 } from './protectedTemplates/pixels.js';

const png = (content: string, w = 1024, h = 1024) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${content}</svg>`)).png().toBuffer();
const original = () => png('<rect x="30" y="20" width="140" height="360" rx="12" fill="#9e6847"/>', 200, 400);
const opened = () => png('<path d="M172 300 L392 232 H632 L852 300 V740 L632 792 H392 L172 740 Z" fill="#9e6847"/><rect x="410" y="270" width="204" height="490" fill="#334155"/>');
async function setup(output = opened) {
  const bytes = await original(), dir = mkdtempSync(join(tmpdir(), 'layer-edit-unit-'));
  const regenerate = vi.fn<RatioRegenerator['regenerate']>(async () => ({ image: await output(), requestId: 'req_test', costUsd: 0.26 }));
  const source: LayerEditSource = { target: { kind: 'creative', templateId: 'pt-test', creativeId: 'pc-123abc', layerId: 'object-refrigerator', revision: 1 }, sourceSha256: sha256(bytes) };
  const resolve = vi.fn(async () => ({ bytes, name: 'Brown refrigerator' }));
  const service = createLayerEdits({ dir, resolve, provider: () => ({ model: 'gpt-image-2', offline: false, regenerate }) });
  const request = { ...source, prompt: 'Open both doors.', model: 'gpt-image-2', approveUsd: 0.27, operationId: randomUUID() };
  return { bytes, dir, regenerate, source, resolve, service, request };
}
describe('single-object image editing, fully offline', () => {
  it('uses the exact selected reference, retains expanded doors, and only marks applied on confirmation', async () => {
    const s = await setup(), before = sha256(s.bytes), estimate = await s.service.estimate(s.source);
    expect(estimate.estimateUsd).toBe(0.27); expect(s.regenerate).not.toHaveBeenCalled();
    const c = await s.service.generate(s.request), prepared = await prepareLayerEdit(s.bytes);
    expect(s.regenerate.mock.calls[0][0]).toMatchObject({ image: prepared.image, size: { width: 1024, height: 1024 } });
    expect(c.image.width).toBe(680); expect(c.geometry.width).toBeGreaterThan(2); expect(c.geometry.height).toBeCloseTo(0.9, 1);
    expect((await sharp(Buffer.from(c.image.base64, 'base64')).metadata()).hasAlpha).toBe(true);
    expect((await s.service.status(c.operationId)).status).toBe('candidate');
    expect(sha256(s.bytes)).toBe(before); await s.service.apply(c.operationId);
    expect((await s.service.status(c.operationId)).status).toBe('applied');
    const subsequent = { ...s.source, sourceCandidateId: c.operationId, sourceSha256: c.image.sha256 };
    expect((await s.service.estimate(subsequent)).sourceSha256).toBe(c.image.sha256);
    expect(s.regenerate).toHaveBeenCalledTimes(1);
  });
  it('allows an expanded raised-arm character silhouette with a transparent result', async () => {
    const bytes = await png('<circle cx="100" cy="70" r="40" fill="#a96848"/><rect x="60" y="100" width="80" height="260" fill="#3b82f6"/>', 200, 400);
    const prepared = await prepareLayerEdit(bytes);
    const output = await png('<circle cx="512" cy="290" r="60" fill="#a96848"/><path d="M440 350 H580 L770 125 L820 165 L610 440 V850 H430 V450 L300 540 L270 490 Z" fill="#3b82f6"/>');
    const result = await validateLayerEdit(output, prepared);
    expect(result.width).toBeGreaterThan(prepared.rect.width); expect(result.geometry.height).toBeGreaterThan(1); expect(result.geometry.width).toBeGreaterThan(1);
  });
  it.each(['', '   ', 'x'.repeat(1001)])('rejects invalid prompt before any provider call (%s)', async prompt => {
    const s = await setup(); await expect(s.service.generate({ ...s.request, prompt })).rejects.toThrow('1–1000'); expect(s.regenerate).not.toHaveBeenCalled();
  });
  it('requires approval and fresh source/model; an operation can spend only once across service restarts', async () => {
    const s = await setup();
    await expect(s.service.generate({ ...s.request, approveUsd: 0 })).rejects.toThrow('Approve');
    await expect(s.service.generate({ ...s.request, sourceSha256: 'a'.repeat(64) })).rejects.toThrow('differs');
    await expect(s.service.generate({ ...s.request, model: 'other' })).rejects.toThrow('model changed');
    const c = await s.service.generate(s.request);
    await expect(s.service.generate(s.request)).rejects.toThrow('already submitted');
    const restarted = createLayerEdits({ dir: s.dir, resolve: s.resolve, provider: () => ({ model: 'gpt-image-2', offline: false, regenerate: s.regenerate }) });
    await expect(restarted.generate(s.request)).rejects.toThrow('already submitted');
    await restarted.discard(c.operationId);
    expect(JSON.parse(readFileSync(join(s.dir, `${c.operationId}.json`), 'utf8')).candidate).toBeUndefined();
    expect(s.regenerate).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed, empty, clipped, opaque and multiple-object outputs without changing the source', async () => {
    const p = await prepareLayerEdit(await original());
    const bad = [Buffer.from('no image'), await png('', 1024, 1024), await png('<rect width="1024" height="1024" fill="red"/>'), await png('<rect width="300" height="600" fill="red"/>'), await png('<circle cx="250" cy="512" r="130" fill="red"/><circle cx="750" cy="512" r="130" fill="blue"/>'), await png('<circle cx="100" cy="100" r="50" fill="red"/>', 200, 200)];
    for (const bytes of bad) await expect(validateLayerEdit(bytes, p)).rejects.toThrow();
  });
  it('removes a flat chroma background locally and rejects enclosed leftover chroma', async () => {
    const p = await prepareLayerEdit(await original());
    const valid = await png(`<rect width="1024" height="1024" fill="${p.ground}"/><rect x="250" y="200" width="524" height="600" rx="30" fill="#304050"/>`);
    const cut = await validateLayerEdit(valid, p); expect(cut.background).toBe('removed');
    const hole = await png(`<rect width="1024" height="1024" fill="${p.ground}"/><rect x="250" y="200" width="524" height="600" fill="#304050"/><rect x="350" y="300" width="324" height="400" fill="${p.ground}"/>`);
    await expect(validateLayerEdit(hole, p)).rejects.toThrow('background remains');
  });
  it('fails closed when missing configuration or source access; apply rechecks the saved revision', async () => {
    const s = await setup();
    const off = createLayerEdits({ dir: s.dir, resolve: s.resolve, provider: () => undefined });
    expect((await off.estimate(s.source)).available).toBe(false); await expect(off.generate(s.request)).rejects.toThrow('OPENAI_API_KEY');
    const c = await s.service.generate(s.request); s.resolve.mockRejectedValue(new Error('Revision changed'));
    await expect(s.service.apply(c.operationId)).rejects.toThrow('Revision changed');
    await s.service.discard(c.operationId); expect(s.regenerate).toHaveBeenCalledTimes(1);
  });
  it('records unknown billing on an interrupted request, sanitizes errors, and never retries', async () => {
    const s = await setup(); s.regenerate.mockRejectedValue(new Error('secret-key provider raw body'));
    await expect(s.service.generate(s.request)).rejects.toThrow('billing are unknown');
    const state = await s.service.status(s.request.operationId);
    expect(state.status).toBe('uncertain'); expect(JSON.stringify(state)).not.toContain('secret-key');
    expect(s.regenerate).toHaveBeenCalledTimes(1);
  });
  it('times out injected providers and preserves uncertainty after restart', async () => {
    const s = await setup();
    const service = createLayerEdits({ dir: s.dir, resolve: s.resolve, timeoutMs: 5, provider: () => ({ model: 'gpt-image-2', offline: false, regenerate: () => new Promise(() => {}) }) });
    await expect(service.generate(s.request)).rejects.toThrow('unknown');
    const path = join(s.dir, `${s.request.operationId}.json`), r = JSON.parse(readFileSync(path, 'utf8')); r.status = 'running'; writeFileSync(path, JSON.stringify(r));
    expect((await s.service.status(s.request.operationId)).status).toBe('uncertain');
  });
  it('prevents concurrent attempts for one layer and discards a late result without retaining its image', async () => {
    const s = await setup(); let finish!: (value: { image: Buffer }) => void;
    s.regenerate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = s.service.generate(s.request);
    await vi.waitFor(() => expect(s.regenerate).toHaveBeenCalledTimes(1));
    await expect(s.service.generate({ ...s.request, operationId: randomUUID() })).rejects.toThrow('already running');
    await s.service.discard(s.request.operationId);
    finish({ image: await opened() });
    await expect(first).rejects.toThrow('discarded');
    expect(await s.service.status(s.request.operationId)).toMatchObject({ status: 'discarded' });
    expect((await s.service.status(s.request.operationId)).candidate).toBeUndefined();
  });
  it('rejects missing, unsupported and oversized sources without calling the provider', async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from('<svg/>'), Buffer.alloc(26 * 1024 * 1024)]) await expect(prepareLayerEdit(bytes)).rejects.toThrow();
  });
  it('validates identifiers and keeps prompts generic and reference based', () => {
    for (const target of [{ kind: 'run', runId: '../secret', layerId: 'x' }, { kind: 'creative', templateId: '/tmp/x', creativeId: 'pc-123abc', layerId: 'x', revision: 1 }, { kind: 'creative', templateId: 'x', creativeId: 'pc-123abc', layerId: '../x', revision: 1 }]) expect(() => layerEditTarget(target)).toThrow();
    expect(layerEditPrompt('Character', 'Raise the left arm', '#00ff00')).toContain('identity reference');
    expect(layerEditPrompt('Lamp', 'Turn it on', '#00ff00')).not.toMatch(/LG|refrigerator|Seedream|FLUX/);
  });
});
