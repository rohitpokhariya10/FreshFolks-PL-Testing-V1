/** Durable, single-attempt edits. Preview/Apply/Discard and recovery never call a provider. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYER_EDIT_LIMITS, regenEstimateUsdForSize, type LayerEditCandidate, type LayerEditRequest, type LayerEditSource, type LayerEditStatus, type LayerEditTarget } from '@frameflow/shared';
import { RunError } from './layerizeExperiment.js';
import { sha256 } from './protectedTemplates/pixels.js';
import { imageFailure, limitedImage } from './protectedTemplates/product/imageOperation.js';
import type { RatioRegenerator } from './protectedTemplates/product/ratioRegeneration.js';
import { layerEditPrompt, prepareLayerEdit, validateLayerEdit } from './layerEditImage.js';
import { layerEditTarget, type ResolvedLayerEdit } from './layerEditSource.js';

interface RecordOfEdit extends LayerEditStatus {
  source: LayerEditSource; startedAt: number; candidate?: LayerEditCandidate; requestId?: string; costUsd?: number;
  failure?: { status?: number; code?: string; parameter?: string; requestId?: string };
}
// Provider messages can echo request contents. Keep only known parameter names and the existing sanitized diagnostics.
const editParameters = new Set(['background', 'image', 'image[]', 'images', 'mask', 'model', 'prompt', 'size', 'quality', 'n', 'output_format', 'input_fidelity']);
const rejectedParameter = (error: unknown) => {
  const value = error && typeof error === 'object' ? (error as { param?: unknown }).param : undefined;
  return typeof value === 'string' && editParameters.has(value) ? value : undefined;
};
const uuid = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new RunError('INVALID_LAYER_EDIT', 'A valid edit operation ID is required.');
  return id;
};
const sameTarget = (a: LayerEditTarget, b: LayerEditTarget) => JSON.stringify(a) === JSON.stringify(b);
const invalid = (message: string): never => { throw new RunError('INVALID_LAYER_EDIT', message); };
/**
 * Saving the creative while an edit is pending creates a newer revision of the same layer. Only the revision can move
 * forward; the template, creative and layer stay the request's own. resolve() still requires the saved image, or the
 * applied edit chain, to match this edit's exact source bytes, so a changed layer is rejected as before.
 */
const atRevision = (source: LayerEditSource, revision: unknown): LayerEditSource =>
  source.target.kind === 'creative' && Number.isSafeInteger(revision) && (revision as number) > source.target.revision
    ? { ...source, target: { ...source.target, revision: revision as number } } : source;
export function createLayerEdits(options: { dir: string; provider: () => RatioRegenerator | undefined; resolve: (target: LayerEditTarget) => Promise<ResolvedLayerEdit>; timeoutMs?: number }) {
  const active = new Set<string>(), activeTargets = new Set<string>();
  // The folder is created with the first request, not at startup: it sits among the runs, and an editor that never
  // requests an AI layer edit should leave no trace there.
  const path = (id: string) => join(options.dir, `${uuid(id)}.json`);
  const write = (record: RecordOfEdit) => writeFileSync(path(record.operationId), JSON.stringify(record));
  const read = (id: string): RecordOfEdit => {
    let record: RecordOfEdit;
    try { record = JSON.parse(readFileSync(path(id), 'utf8')) as RecordOfEdit; }
    catch (e) { if (e instanceof RunError) throw e; throw new RunError('NOT_FOUND', 'Layer edit not found.'); }
    if (record.status === 'running' && !active.has(id)) { record.status = 'uncertain'; record.message = 'The server stopped during this request. Completion and billing are unknown. Check provider usage before approving another request.'; write(record); }
    return record;
  };
  // Abandoned previews expire after a day; applied references remain recoverable for a week, then rely on the normal Save creative flow.
  const cleanup = () => {
    for (const f of existsSync(options.dir) ? readdirSync(options.dir) : []) if (/^[a-f0-9-]{36}\.json$/.test(f)) {
      const record = read(f.slice(0, -5));
      if (record.candidate && Date.now() - record.startedAt > (record.status === 'applied' ? 7 : 1) * 86400_000) {
        delete record.candidate; record.status = 'discarded'; record.message = 'Preview expired. Save your applied layer before editing it again.'; write(record);
      }
    }
  };
  cleanup();
  const expiry = setInterval(() => { try { cleanup(); } catch { /* Storage may be unavailable; a later access retries cleanup only. */ } }, 60 * 60_000);
  expiry.unref();
  const resolve = async (input: LayerEditSource) => {
    const target = layerEditTarget(input.target);
    if (typeof input.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceSha256)) invalid('The current layer image could not be verified.');
    const saved = await options.resolve(target); // Always verify the current saved revision, visibility, type and membership.
    let bytes = saved.bytes;
    if (sha256(bytes) !== input.sourceSha256 && input.sourceCandidateId) {
      const prior = read(input.sourceCandidateId);
      if (prior.status !== 'applied' || !prior.candidate || !sameTarget(prior.source.target, target)) invalid('Save this edited layer to its creative before editing it again.');
      bytes = Buffer.from(prior.candidate!.image.base64, 'base64');
    }
    if (sha256(bytes) !== input.sourceSha256) throw new RunError('STALE_REVISION', 'The local image differs from the saved layer. Save the creative, or reopen the saved layer, then try again.');
    return { ...saved, bytes, target };
  };
  const supported = (r: RatioRegenerator) => r.offline || /^gpt-image-2(?:-2026-04-21)?$/.test(r.model);
  const estimateFor = (p: Awaited<ReturnType<typeof prepareLayerEdit>>, r: RatioRegenerator | undefined) => ({ available: !!r && supported(r), provider: 'OpenAI' as const, model: r?.model ?? '', offline: r?.offline ?? true, size: p.size,
    sourceSha256: p.sourceSha256, estimateUsd: r && !r.offline ? regenEstimateUsdForSize(p.size) : 0, ...(!r ? { reason: 'AI layer editing needs OPENAI_API_KEY on the server.' } : !supported(r) ? { reason: 'The configured model has no verified layer-edit price. Configure gpt-image-2 before generating.' } : {}) });
  const inspect = async (id: string, revision?: unknown) => { const r = read(id); await options.resolve(atRevision(r.source, revision).target); return { operationId: r.operationId, status: r.status, ...(r.message ? { message: r.message } : {}), ...(r.candidate ? { candidate: r.candidate } : {}) } satisfies LayerEditStatus; };
  return {
    async estimate(input: LayerEditSource) { cleanup(); return estimateFor(await prepareLayerEdit((await resolve(input)).bytes), options.provider()); },
    status: inspect,
    /** `revision`: the editor's current saved creative revision, when a save happened after this edit was requested. */
    async apply(id: string, revision?: unknown) {
      const record = read(id);
      if (!record.candidate || !['candidate', 'applied'].includes(record.status)) invalid('This preview is no longer available.');
      const source = atRevision(record.source, revision);
      await resolve(source);
      // The next edit of this layer chains from this record, so it must name the revision the editor now holds.
      record.source = source; record.status = 'applied'; write(record);
      return inspect(id);
    },
    async discard(id: string) {
      const record = read(id);
      // A request in flight is marked discarded; its eventual response is validated/accounted but never retained.
      if (record.status !== 'applied') { record.status = 'discarded'; delete record.candidate; write(record); }
      return { operationId: id, status: record.status } satisfies LayerEditStatus;
    },
    async generate(input: LayerEditRequest): Promise<LayerEditCandidate> {
      const id = uuid(input.operationId), prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
      if (!prompt || prompt.length > LAYER_EDIT_LIMITS.prompt) invalid('Describe your edit in 1–1000 characters.');
      const r = options.provider(); if (!r) throw new RunError('NOT_CONFIGURED', 'AI layer editing needs OPENAI_API_KEY on the server.');
      if (!supported(r)) throw new RunError('NOT_CONFIGURED', 'Layer editing currently has verified pricing for gpt-image-2 only.');
      const resolved = await resolve(input), p = await prepareLayerEdit(resolved.bytes), estimate = estimateFor(p, r);
      if (input.model !== r.model) throw new RunError('STALE_REVISION', 'The model changed. Review the estimate again.');
      if (!Number.isFinite(input.approveUsd) || input.approveUsd < estimate.estimateUsd) throw new RunError('APPROVAL_REQUIRED', 'Approve the displayed cost before generating this layer edit.');
      const key = JSON.stringify(resolved.target);
      if (activeTargets.has(key)) throw new RunError('BUSY', 'An edit for this layer is already running. Check its status; no new request was submitted.');
      const source: LayerEditSource = { target: resolved.target, sourceSha256: input.sourceSha256, ...(input.sourceCandidateId ? { sourceCandidateId: uuid(input.sourceCandidateId) } : {}) };
      const record: RecordOfEdit = { operationId: id, source, status: 'running', startedAt: Date.now() };
      try { mkdirSync(options.dir, { recursive: true }); writeFileSync(path(id), JSON.stringify(record), { flag: 'wx' }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new RunError('IDEMPOTENCY_CONFLICT', 'This edit was already submitted. Check its status; nothing was retried.'); throw e; }
      active.add(id); activeTargets.add(key);
      let received = false, sent = false, timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const out = await limitedImage(async () => {
          // Recheck after waiting for a provider slot. No arbitrary diagnostics from the adapter are persisted here.
          await resolve(source);
          sent = true;
          // GPT Image 2 native transparency is a preview capability. Use the existing plain-background cutout path
          // without requiring that provider option; validateLayerEdit still accepts native alpha if returned.
          return Promise.race([r.regenerate({ image: p.image, size: p.size, prompt: layerEditPrompt(resolved.name, prompt, p.ground) }, () => {}, id), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Image deadline exceeded')), options.timeoutMs ?? 310_000);
          })]);
        });
        received = true; record.requestId = out.requestId; record.costUsd = out.costUsd;
        const result = await validateLayerEdit(out.image, p);
        const candidate: LayerEditCandidate = { ...estimate, target: resolved.target, operationId: id, status: 'candidate', ...(out.requestId ? { requestId: out.requestId } : {}), ...(out.costUsd !== undefined ? { costUsd: out.costUsd } : {}),
          image: { base64: result.png.toString('base64'), mimeType: 'image/png', width: result.width, height: result.height, sha256: sha256(result.png) }, geometry: result.geometry,
          validation: { background: result.background, identity: 'review-required' } };
        if (read(id).status === 'discarded') { record.status = 'discarded'; write(record); throw new RunError('EDIT_DISCARDED', 'This candidate was discarded. No edit was applied.'); }
        record.status = 'candidate'; record.candidate = candidate; write(record);
        return candidate;
      } catch (error) {
        if (error instanceof RunError && error.code === 'EDIT_DISCARDED') throw error;
        if (!sent && error instanceof RunError) {
          // The source changed while this request waited for a provider slot: no provider request exists to bill or recover.
          record.status = read(id).status === 'discarded' ? 'discarded' : 'failed';
          record.message = `${error.message} The edit was not sent to the AI provider, so nothing was charged.`;
          write(record);
          throw new RunError('LAYER_EDIT_FAILED', record.message, { operationId: id, status: record.status });
        }
        const failure = imageFailure(error, received, record.requestId);
        const parameter = rejectedParameter(error);
        record.requestId = failure.requestId;
        record.failure = { status: failure.details.status, code: failure.details.code, parameter, requestId: failure.requestId };
        record.status = received || failure.outcome === 'rejected' ? 'failed' : 'uncertain';
        const reason = received && error instanceof RunError ? error.message : failure.message.replace(/ No automatic retry was made\.$/, '');
        record.message = `${reason}${/[.!?]$/.test(reason) ? '' : '.'}${parameter ? ` Rejected parameter: ${parameter}.` : ''} No edit was applied. A provider charge may still apply. No automatic retry was made.`;
        if (read(id).status === 'discarded') record.status = 'discarded';
        write(record);
        throw new RunError('LAYER_EDIT_FAILED', record.message, { operationId: id, status: record.status });
      } finally { if (timer) clearTimeout(timer); active.delete(id); activeTargets.delete(key); }
    },
  };
}
