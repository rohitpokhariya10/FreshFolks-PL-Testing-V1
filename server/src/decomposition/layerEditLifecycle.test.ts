/**
 * The persisted lifecycle of AI layer edits, offline: real record files in a temporary folder, a deterministic fake
 * provider that can be held, released, failed or delayed, and new service instances standing in for server restarts.
 * Every test counts provider calls: none may happen without a new, approved operation.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OpenAI from 'openai';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerEditCandidate, LayerEditRegion, LayerEditSource, LayerEditTarget } from '@frameflow/shared';
import type { RatioRegenerator } from './protectedTemplates/product/ratioRegeneration.js';
import { sha256 } from './protectedTemplates/pixels.js';
import { createLayerEdits } from './layerEdit.js';
import { fridge, opened, recoloured, type EditRequest } from './layerEdit.fixture.js';

type Output = { image: Buffer; requestId?: string; costUsd?: number };
const target = (layerId = 'object-po-1', revision = 1): LayerEditTarget => ({ kind: 'creative', templateId: 'pt-test', creativeId: 'pc-123abc', layerId, revision });
/** A provider call that waits until the test releases or fails it. */
function held() { let release!: (o: Output) => void, fail!: (e: unknown) => void; const promise = new Promise<Output>((a, b) => { release = a; fail = b; }); return { promise, release, fail }; }
async function lab(options: { timeoutMs?: number } = {}) {
  const original = await fridge(), dir = mkdtempSync(join(tmpdir(), 'layer-edit-lifecycle-'));
  const saved = new Map<string, Buffer>(), revision = new Map<string, number>();
  let next: (r: EditRequest) => Output | Promise<Output> = async r => ({ image: await opened(r), requestId: 'req_ok', costUsd: 0.22 });
  const regenerate = vi.fn<RatioRegenerator['regenerate']>(async r => next(r));
  const resolve = async (t: LayerEditTarget) => {
    if (t.kind === 'creative' && t.revision !== (revision.get(t.layerId) ?? 1)) throw Object.assign(new Error('This creative changed. Reopen its latest saved revision.'), { code: 'STALE_REVISION' });
    return { bytes: saved.get(t.layerId) ?? original, name: 'Refrigerator', original };
  };
  const make = () => createLayerEdits({ dir, resolve, provider: () => ({ model: 'gpt-image-2', offline: false, regenerate }), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
  let service = make();
  const source = (from?: LayerEditCandidate, layerId = 'object-po-1'): LayerEditSource => from
    ? { target: target(layerId, revision.get(layerId) ?? 1), sourceSha256: from.image.sha256, sourceCandidateId: from.operationId }
    : { target: target(layerId, revision.get(layerId) ?? 1), sourceSha256: sha256(saved.get(layerId) ?? original) };
  async function request(prompt: string, from?: LayerEditCandidate, extra: { layerId?: string; region?: LayerEditRegion; operationId?: string } = {}) {
    const s = source(from, extra.layerId), quote = await service.estimate({ ...s, prompt, ...(extra.region ? { region: extra.region } : {}) });
    return { ...s, prompt, ...(extra.region ? { region: extra.region } : {}), operationId: extra.operationId ?? randomUUID(), model: 'gpt-image-2', approveUsd: quote.estimateUsd };
  }
  const record = (id: string) => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  return { original, dir, regenerate, request, record, saved, revision, get service() { return service; }, restart: () => { service = make(); return service; }, provide: (f: typeof next) => { next = f; } };
}
const transport = (code: string, message: string, extra: object = {}) => Object.assign(new TypeError(message), { cause: Object.assign(new Error(message), { code, ...extra }) });
afterEach(() => { vi.unstubAllEnvs(); });

describe('AI layer-edit lifecycle (persisted records, fake provider)', () => {
  it('1, 12, 13. three consecutive edits of one refrigerator: each from the latest applied image, the original attached, no lock left behind', async () => {
    const l = await lab();
    const first = await l.service.generate(await l.request('Open the door'));
    await l.service.apply(first.operationId);
    l.provide(r => ({ image: r.image, requestId: 'req_2', costUsd: 0.27 }));
    const second = await l.service.generate(await l.request('Remove the sticker', first, { region: { x: 0.3, y: 0.3, width: 0.3, height: 0.2 } }));
    await l.service.apply(second.operationId);
    l.provide(async r => ({ image: await recoloured(r, '#c0262d'), requestId: 'req_3', costUsd: 0.27 }));
    const third = await l.service.generate(await l.request('Make it red', second));
    await l.service.apply(third.operationId);
    const calls = l.regenerate.mock.calls.map(([r]) => ({ images: 1 + (r.references?.length ?? 0), mask: !!r.mask }));
    // The first edit sends the product alone; later ones add the original as image 2; the area edit adds its mask.
    expect(calls).toEqual([{ images: 1, mask: false }, { images: 2, mask: true }, { images: 2, mask: false }]);
    expect([first, second, third].map(c => l.record(c.operationId).status)).toEqual(['applied', 'applied', 'applied']);
    expect(l.record(third.operationId).source.sourceSha256).toBe(second.image.sha256);
    // Nothing stays locked: a fourth edit on the same layer starts at once.
    l.provide(r => ({ image: r.image }));
    await expect(l.service.generate(await l.request('Make it lighter', third))).resolves.toMatchObject({ status: 'candidate' });
    expect(l.regenerate).toHaveBeenCalledTimes(4);
  });

  it('2. a refusal by the provider (HTTP 400) and an unreachable provider (DNS / refused) are definite failures with nothing charged', async () => {
    const l = await lab();
    l.provide(() => { throw OpenAI.APIError.generate(400, { error: { message: 'private-provider-body', code: 'invalid_value', param: 'size' } }, '', new Headers({ 'x-request-id': 'req_rejected' })); });
    const refused = await l.request('Open the door');
    await expect(l.service.generate(refused)).rejects.toMatchObject({ code: 'LAYER_EDIT_FAILED', details: { status: 'failed', billing: 'none' } });
    expect(await l.service.status(refused.operationId)).toMatchObject({ status: 'failed', billing: 'none' });
    for (const code of ['ENOTFOUND', 'ECONNREFUSED']) {
      l.provide(() => { throw transport(code, `connect ${code}`, { syscall: code === 'ENOTFOUND' ? 'getaddrinfo' : 'connect' }); });
      const r = await l.request('Open the door');
      await expect(l.service.generate(r)).rejects.toThrow(`OpenAI could not be reached (${code}), so the request was not delivered and nothing was charged.`);
      expect(await l.service.status(r.operationId)).toMatchObject({ status: 'failed', billing: 'none' });
    }
    expect(JSON.stringify(l.record(refused.operationId))).not.toContain('private-provider-body');
    expect(l.regenerate).toHaveBeenCalledTimes(3); // One per approved operation; no retry.
  });

  it('3, 14. a connection lost after sending is uncertain with its transport facts, never retried, and does not block the next edit', async () => {
    const l = await lab();
    l.provide(() => { throw transport('UND_ERR_SOCKET', 'other side closed', { socket: { bytesWritten: 1834221, bytesRead: 0, remoteAddress: '162.159.140.245', remotePort: 443 } }); });
    const lost = await l.request('Open all doors');
    await expect(l.service.generate(lost)).rejects.toMatchObject({ details: { status: 'uncertain', billing: 'possible' } });
    const r = l.record(lost.operationId);
    expect(r).toMatchObject({ status: 'uncertain', failure: { phase: 'submitting', transport: { cause: { code: 'UND_ERR_SOCKET', bytesWritten: 1834221, bytesRead: 0 } } } });
    expect(r.failure.elapsedMs).toBeGreaterThanOrEqual(0); expect(r.submittedAt).toBeGreaterThanOrEqual(r.startedAt);
    expect(r.message).toMatch(/The connection ended \d+ s after the request was sent, before OpenAI returned any response or request ID\. Provider completion and billing are unknown\./);
    expect(r.message).not.toMatch(/nothing was charged/i);
    // The next edit of the same layer is not blocked, and the uncertain request stays identifiable after being set aside.
    l.provide(async q => ({ image: await opened(q), requestId: 'req_next' }));
    await expect(l.service.generate(await l.request('Open all doors'))).resolves.toMatchObject({ status: 'candidate' });
    expect(await l.service.discard(lost.operationId)).toMatchObject({ status: 'discarded', billing: 'possible' });
    expect(l.record(lost.operationId)).toMatchObject({ abandoned: { status: 'uncertain' }, failure: { phase: 'submitting' } });
    expect(l.regenerate).toHaveBeenCalledTimes(2);
  });

  it('4, 5, 6. a completed result whose response never reached the editor is returned by status, by a repeat of the operation, and by the layer lookup', async () => {
    const l = await lab(), req = await l.request('Open the door');
    const done = await l.service.generate(req); // The editor never sees this response.
    expect(await l.service.status(req.operationId)).toMatchObject({ status: 'candidate', candidate: { image: { sha256: done.image.sha256 } } });
    expect((await l.service.generate(req)).image.sha256).toBe(done.image.sha256); // The editor retried the same operation.
    expect(await l.service.open({ target: req.target, sourceSha256: req.sourceSha256 })).toEqual({ operationId: req.operationId, status: 'candidate', prompt: 'Open the door' });
    expect((await l.service.apply(req.operationId)).status).toBe('applied');
    expect(await l.service.open({ target: req.target, sourceSha256: req.sourceSha256 })).toEqual({});
    expect(l.regenerate).toHaveBeenCalledTimes(1);
  });

  it('6, 8. duplicates of a running operation, a second operation on the layer, and one after a save never reach the provider', async () => {
    const l = await lab(), wait = held();
    l.provide(() => wait.promise);
    const req = await l.request('Open the door'), running = l.service.generate(req);
    await vi.waitFor(() => expect(l.regenerate).toHaveBeenCalledTimes(1));
    await expect(l.service.generate(req)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', details: { status: 'running' } });
    await expect(l.service.generate({ ...req, prompt: 'Close it' })).rejects.toThrow('already used for a different edit');
    await expect(l.service.generate(await l.request('Close the door'))).rejects.toMatchObject({ code: 'BUSY' });
    // Saved while generating: a request naming the newer revision is still the same layer.
    l.revision.set('object-po-1', 2);
    await expect(l.service.generate(await l.request('Close the door'))).rejects.toMatchObject({ code: 'BUSY' });
    expect(await l.service.status(req.operationId, 2)).toMatchObject({ status: 'running', phase: 'submitting' });
    wait.release({ image: await opened({ ...l.regenerate.mock.calls[0][0] }), requestId: 'req_held' });
    await expect(running).resolves.toMatchObject({ status: 'candidate' });
    expect(l.regenerate).toHaveBeenCalledTimes(1);
  });

  it('7, 10. a restart: queued is a free failure, sent is uncertain, and a received image is finished from disk without the provider', async () => {
    const l = await lab(), done = await l.service.generate(await l.request('Open the door'));
    // The same request as recorded before it reached the provider: no response facts yet.
    const { requestId: _r, costUsd: _c, receivedAt: _t, ...kept } = l.record(done.operationId); void _r; void _c; void _t;
    const crashed = (phase: string, extra: object = {}) => {
      const id = randomUUID();
      writeFileSync(join(l.dir, `${id}.json`), JSON.stringify({ ...kept, operationId: id, status: 'running', phase, candidate: undefined, ...extra }));
      return id;
    };
    const queued = crashed('queued'), sent = crashed('submitting', { submittedAt: Date.now() });
    // Received just before the crash: the provider's image is on disk, the candidate not yet stored.
    const received = randomUUID(), output = `${received}.output.png`, image = await opened({ image: l.regenerate.mock.calls[0][0].image, prompt: l.regenerate.mock.calls[0][0].prompt, size: { width: 1024, height: 1024 } });
    writeFileSync(join(l.dir, output), image);
    writeFileSync(join(l.dir, `${received}.json`), JSON.stringify({ ...kept, operationId: received, status: 'running', phase: 'received', receivedAt: Date.now(), output, candidate: undefined }));
    const restarted = l.restart();
    expect(await restarted.status(queued)).toMatchObject({ status: 'failed', billing: 'none', message: expect.stringContaining('before this edit was sent') });
    expect(await restarted.status(sent)).toMatchObject({ status: 'uncertain', billing: 'possible' });
    await vi.waitFor(async () => expect((await restarted.status(received)).status).toBe('candidate'), { timeout: 10000 });
    expect((await restarted.status(received)).candidate?.image.sha256).toBe(done.image.sha256);
    expect(existsSync(join(l.dir, output))).toBe(false); // Stored as the candidate; the raw copy is no longer needed.
    expect(l.regenerate).toHaveBeenCalledTimes(1);
  });

  it('9, 11. a discard while queued sends nothing; a discard while the provider works is kept, and the paid response is accounted, not retained', async () => {
    vi.stubEnv('FRAMEFLOW_PRODUCT_IMAGE_CONCURRENCY', '1');
    const l = await lab(), busy = held(), working = held();
    l.provide(() => busy.promise);
    const other = l.service.generate(await l.request('Open the door', undefined, { layerId: 'object-po-2' }));
    await vi.waitFor(() => expect(l.regenerate).toHaveBeenCalledTimes(1));
    const queuedReq = await l.request('Open the door'), queued = l.service.generate(queuedReq);
    await vi.waitFor(() => expect(l.record(queuedReq.operationId)).toMatchObject({ phase: 'queued' }));
    await l.service.discard(queuedReq.operationId);
    l.provide(() => working.promise);
    busy.release({ image: await opened(l.regenerate.mock.calls[0][0]) });
    await expect(queued).rejects.toThrow('discarded before it was sent');
    await other;
    expect(l.regenerate).toHaveBeenCalledTimes(1);
    expect(await l.service.status(queuedReq.operationId)).toMatchObject({ status: 'discarded', billing: 'none' });
    // Discarded while the provider works: the Discard stands, the response's cost is recorded, its image is not kept.
    const flight = await l.request('Open both doors'), running = l.service.generate(flight);
    await vi.waitFor(() => expect(l.regenerate).toHaveBeenCalledTimes(2));
    await l.service.discard(flight.operationId);
    working.release({ image: await opened(l.regenerate.mock.calls[1][0]), requestId: 'req_late', costUsd: 0.22 });
    await expect(running).rejects.toThrow('discarded');
    expect(l.record(flight.operationId)).toMatchObject({ status: 'discarded', requestId: 'req_late', costUsd: 0.22 });
    expect(l.record(flight.operationId).candidate).toBeUndefined(); expect(existsSync(join(l.dir, `${flight.operationId}.output.png`))).toBe(false);
    expect(await l.service.status(flight.operationId)).toMatchObject({ billing: 'charged' });
  });

  it('9. a layer changed during generation keeps the result but cannot apply it', async () => {
    const l = await lab(), wait = held();
    l.provide(() => wait.promise);
    const req = await l.request('Open the door'), running = l.service.generate(req);
    await vi.waitFor(() => expect(l.regenerate).toHaveBeenCalledTimes(1));
    l.saved.set('object-po-1', await fridge('#9aa0a6'));
    wait.release({ image: await opened(l.regenerate.mock.calls[0][0]) });
    const result = await running;
    await expect(l.service.apply(result.operationId)).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(l.record(result.operationId).status).toBe('candidate');
  });

  it('a result after the server stopped waiting is still kept; an unusable received result is charged, kept and never retried', async () => {
    const l = await lab({ timeoutMs: 40 });
    l.provide(async r => { await new Promise(done => setTimeout(done, 150)); return { image: await opened(r), requestId: 'req_slow', costUsd: 0.22 }; });
    const slow = await l.request('Open the door');
    await expect(l.service.generate(slow)).rejects.toThrow(/No response arrived within \d+ s\. Provider completion and billing are unknown\./);
    await vi.waitFor(async () => expect((await l.service.status(slow.operationId)).status).toBe('candidate'), { timeout: 5000 });
    expect(l.record(slow.operationId)).toMatchObject({ requestId: 'req_slow', costUsd: 0.22 });
    const m = await lab();
    m.provide(async () => ({ image: await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#c0262d' } }).png().toBuffer(), requestId: 'req_opaque', costUsd: 0.22 }));
    const opaque = await m.request('Open the door');
    await expect(m.service.generate(opaque)).rejects.toThrow('so this request was charged; it is kept on the server and was not applied');
    expect(await m.service.status(opaque.operationId)).toMatchObject({ status: 'failed', billing: 'charged' });
    expect(existsSync(join(m.dir, `${opaque.operationId}.output.png`))).toBe(true);
    expect(l.regenerate).toHaveBeenCalledTimes(1); expect(m.regenerate).toHaveBeenCalledTimes(1);
  });

  it('a page reload while generating finds the request on the server and collects it without generating again', async () => {
    const l = await lab(), wait = held();
    l.provide(() => wait.promise);
    const req = await l.request('Open the door'), running = l.service.generate(req);
    await vi.waitFor(() => expect(l.regenerate).toHaveBeenCalledTimes(1));
    // The reloaded editor knows only the layer and its current image.
    expect(await l.service.open({ target: req.target, sourceSha256: req.sourceSha256 })).toMatchObject({ operationId: req.operationId, status: 'running' });
    expect(await l.service.status(req.operationId)).toMatchObject({ status: 'running', phase: 'submitting', submittedAt: expect.any(Number) });
    wait.release({ image: await opened(l.regenerate.mock.calls[0][0]) }); await running;
    expect((await l.service.status(req.operationId)).status).toBe('candidate');
    expect(l.regenerate).toHaveBeenCalledTimes(1);
  });
});
