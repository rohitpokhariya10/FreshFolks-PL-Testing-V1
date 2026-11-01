import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { LayerEditSource, LayerEditTarget } from '@frameflow/shared';
import { RunError } from './layerizeExperiment.js';
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
  it('chains three trusted applied references using each exact latest image, without saving the older creative over it', async () => {
    const s = await setup();
    const outputs = [await opened(), await png('<rect x="390" y="210" width="244" height="600" fill="#94a3b8"/>'), await png('<rect x="390" y="210" width="244" height="600" rx="20" fill="#2563eb"/>')];
    let bytes = s.bytes, source = s.source;
    for (let i = 0; i < outputs.length; i++) {
      s.regenerate.mockResolvedValueOnce({ image: outputs[i], requestId: `req_${i}` });
      const candidate = await s.service.generate({ ...s.request, ...source, operationId: randomUUID(), prompt: ['Open doors', 'Close doors', 'Change color'][i] });
      expect(s.regenerate.mock.calls[i][0].image).toEqual((await prepareLayerEdit(bytes)).image);
      expect(candidate.sourceSha256).toBe(sha256(bytes));
      await s.service.apply(candidate.operationId);
      bytes = Buffer.from(candidate.image.base64, 'base64');
      source = { ...s.source, sourceSha256: candidate.image.sha256, sourceCandidateId: candidate.operationId };
      expect((await s.service.estimate(source)).sourceSha256).toBe(candidate.image.sha256);
    }
    expect(s.regenerate).toHaveBeenCalledTimes(3);
    await expect(s.service.estimate({ ...source, target: { ...s.source.target, layerId: 'another-layer' } })).rejects.toThrow('Save this edited layer');
  });
  it('a creative save during generation does not block Apply, status or the next chained edit; a changed layer still fails', async () => {
    const s = await setup(), name = 'Brown refrigerator';
    // A real creative store: only its current revision resolves, holding whichever layer bytes were last saved.
    let revision = 1, saved = s.bytes;
    const resolve = vi.fn(async (t: LayerEditTarget) => {
      if (t.kind === 'creative' && t.revision !== revision) throw new RunError('STALE_REVISION', 'This creative changed. Reopen its latest saved revision.');
      return { bytes: saved, name };
    });
    const service = createLayerEdits({ dir: s.dir, resolve, provider: () => ({ model: 'gpt-image-2', offline: false, regenerate: s.regenerate }) });
    const first = await service.generate(s.request); await service.apply(first.operationId);
    const firstBytes = Buffer.from(first.image.base64, 'base64');
    // The editor saves the creative (now holding the applied image) while the second edit is generating.
    s.regenerate.mockImplementationOnce(async () => { revision = 2; saved = firstBytes; return { image: await png('<rect x="390" y="210" width="244" height="600" fill="#94a3b8"/>'), requestId: 'req_close' }; });
    const second = await service.generate({ ...s.request, operationId: randomUUID(), prompt: 'Close the doors.', sourceSha256: first.image.sha256, sourceCandidateId: first.operationId });
    await expect(service.apply(second.operationId)).rejects.toThrow('This creative changed'); // The previous false failure.
    await expect(service.status(second.operationId)).rejects.toThrow('This creative changed');
    expect((await service.status(second.operationId, 2)).status).toBe('candidate');
    expect((await service.apply(second.operationId, 2)).status).toBe('applied');
    expect(JSON.parse(readFileSync(join(s.dir, `${second.operationId}.json`), 'utf8')).source.target).toEqual({ ...s.source.target, revision: 2 });
    // A third edit chains from the second at the saved revision, using exactly the second image.
    const third = { ...s.source, target: { ...s.source.target, revision: 2 }, sourceSha256: second.image.sha256, sourceCandidateId: second.operationId };
    expect((await service.estimate(third)).sourceSha256).toBe(second.image.sha256);
    const red = await service.generate({ ...s.request, ...third, operationId: randomUUID(), prompt: 'Make it red.' });
    expect(s.regenerate.mock.calls[2][0].image).toEqual((await prepareLayerEdit(Buffer.from(second.image.base64, 'base64'))).image);
    // A save that changed this layer's image is still rejected, even at the newer revision.
    revision = 3; saved = await png('<rect x="10" y="10" width="150" height="300" fill="#16a34a"/>', 200, 400);
    await expect(service.apply(red.operationId, 3)).rejects.toThrow(/local image differs|Save this edited layer/);
    expect(JSON.parse(readFileSync(join(s.dir, `${red.operationId}.json`), 'utf8')).status).toBe('candidate');
    // Only the revision can move forward; an older revision keeps the recorded one.
    await expect(service.apply(red.operationId, 1)).rejects.toThrow('This creative changed');
    // A later save that kept this layer's (second) image is accepted.
    revision = 4; saved = Buffer.from(second.image.base64, 'base64');
    expect((await service.apply(red.operationId, 4)).status).toBe('applied');
    expect(s.regenerate).toHaveBeenCalledTimes(3);
  });
  it('leaves no folder among the runs until the first edit request is recorded', async () => {
    const s = await setup(), dir = join(s.dir, 'not-yet-created');
    const service = createLayerEdits({ dir, resolve: s.resolve, provider: () => ({ model: 'gpt-image-2', offline: false, regenerate: s.regenerate }) });
    await service.estimate(s.source); await expect(service.status(randomUUID())).rejects.toThrow('not found');
    expect(existsSync(dir)).toBe(false);
    const c = await service.generate(s.request);
    expect(existsSync(join(dir, `${c.operationId}.json`))).toBe(true);
  });
  it('a source change while queued for a provider slot fails without a provider request or an uncertain-billing warning', async () => {
    const s = await setup();
    s.resolve.mockResolvedValueOnce({ bytes: s.bytes, name: 'Brown refrigerator' }).mockRejectedValueOnce(new RunError('STALE_REVISION', 'This creative changed. Reopen its latest saved revision.'));
    await expect(s.service.generate(s.request)).rejects.toThrow('not sent to the AI provider');
    const status = await s.service.status(s.request.operationId);
    expect(status.status).toBe('failed'); expect(status.message).not.toMatch(/billing|charge may/i);
    expect(s.regenerate).not.toHaveBeenCalled();
  });
  it('reports an exhausted provider balance once, as a definite failure, without retrying', async () => {
    const s = await setup();
    s.regenerate.mockRejectedValue(OpenAI.APIError.generate(429, { error: { message: 'private-provider-body', code: 'insufficient_quota' } }, '', new Headers({ 'x-request-id': 'req_quota' })));
    await expect(s.service.generate(s.request)).rejects.toThrow('no credit left');
    const status = await s.service.status(s.request.operationId);
    expect(status.status).toBe('failed'); expect(JSON.stringify(status)).not.toContain('private-provider-body');
    expect(s.regenerate).toHaveBeenCalledTimes(1);
  });
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
  it('records a rejected parameter and request ID without raw provider data, duplicate warnings, or a second attempt', async () => {
    const s = await setup();
    s.regenerate.mockRejectedValue(OpenAI.APIError.generate(400, { error: { message: 'private-provider-body', code: 'invalid_value', param: 'background' } }, '', new Headers({ 'x-request-id': 'req_layer_rejected' })));
    await expect(s.service.generate(s.request)).rejects.toThrow('Rejected parameter: background');
    const status = await s.service.status(s.request.operationId);
    expect(status.status).toBe('failed'); expect(status.candidate).toBeUndefined();
    expect(status.message?.match(/No automatic retry was made\./g)).toHaveLength(1);
    const record = JSON.parse(readFileSync(join(s.dir, `${s.request.operationId}.json`), 'utf8'));
    expect(record.failure).toEqual({ status: 400, code: 'invalid_value', parameter: 'background', requestId: 'req_layer_rejected' });
    expect(JSON.stringify(record)).not.toContain('private-provider-body');
    await expect(s.service.generate(s.request)).rejects.toThrow('already submitted');
    await s.service.discard(s.request.operationId);
    expect(s.regenerate).toHaveBeenCalledTimes(1);
  });
  it('does not persist unrecognized parameter text', async () => {
    const s = await setup();
    s.regenerate.mockRejectedValue(Object.assign(new Error('private-provider-body'), { status: 400, code: 'invalid_value', param: 'private-provider-body' }));
    await expect(s.service.generate(s.request)).rejects.toThrow('HTTP 400');
    expect(readFileSync(join(s.dir, `${s.request.operationId}.json`), 'utf8')).not.toContain('private-provider-body');
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
