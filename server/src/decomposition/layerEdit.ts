/**
 * Durable, single-attempt edits. Preview/Apply/Discard and recovery never call a provider.
 *
 * One persisted record per operation ID is the authority (never browser state or an open connection):
 *
 *   running/queued      recorded; waiting for a provider slot. Nothing sent: a restart or discard makes it failed/discarded, free.
 *   running/submitting  handed to the provider. Its outcome is only known from the response: a lost connection or a
 *                       restart makes it `uncertain` (completion and billing unknown). Never resubmitted.
 *   running/received    the provider's image is saved to disk first, then validated. A restart finishes it from that file.
 *   candidate           a validated result, stored before the client is answered: status checks return it, free.
 *   applied / discarded / failed / uncertain   as before. Discarding an uncertain or failed edit keeps its record.
 *
 * OpenAI's Images API (images.edit) has no retrieval, background mode, idempotency key or cancellation, so an image whose
 * response was lost cannot be fetched again; it stays `uncertain`, identifiable by its operation ID, until set aside.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYER_EDIT_LIMITS, LAYER_EDIT_REFERENCE_USD, regenEstimateUsdForSize, type LayerEditCandidate, type LayerEditEstimate, type LayerEditIntent, type LayerEditPhase, type LayerEditReferences, type LayerEditRegion, type LayerEditRequest, type LayerEditSource, type LayerEditStatus, type LayerEditTarget } from '@frameflow/shared';
import type { NetworkCause } from '../services/openAIRequestDiagnostics.js';
import { RunError } from './layerizeExperiment.js';
import { sha256 } from './protectedTemplates/pixels.js';
import { imageFailure, limitedImage } from './protectedTemplates/product/imageOperation.js';
import type { RatioRegenerator } from './protectedTemplates/product/ratioRegeneration.js';
import { assessIdentity, objectFraction } from './layerEditIdentity.js';
import { layerEditPrompt, prepareLayerEdit, validateLayerEdit } from './layerEditImage.js';
import { classifyLayerEdit, reversedInstruction } from './layerEditIntent.js';
import { layerEditTarget, type ResolvedLayerEdit } from './layerEditSource.js';

type Geometry = LayerEditCandidate['geometry'];
interface RecordOfEdit extends LayerEditStatus {
  source: LayerEditSource; startedAt: number; candidate?: LayerEditCandidate; requestId?: string; costUsd?: number;
  /**
   * Allowlisted facts only (status, codes, socket byte counts, timing): never provider bodies, messages or headers.
   * `transport`: the error's cause chain, so a lost connection can be told apart from a refused one afterwards.
   */
  failure?: { status?: number; code?: string; parameter?: string; requestId?: string; phase?: LayerEditPhase; elapsedMs?: number; transport?: NetworkCause };
  /** The person's instruction and what it was read as (records made before the identity gate have neither). */
  prompt?: string; intent?: LayerEditIntent;
  /** What was sent, without image bytes. */
  request?: { size: { width: number; height: number }; images: number; mask: boolean; framing: 'expanding' | 'fitted' };
  /** What the approved quote was made for, so a received result can be finished again after a restart. */
  options?: { region?: LayerEditRegion; useOriginalReference: boolean };
  estimate?: LayerEditEstimate;
  receivedAt?: number;
  /** The provider's image as received (`<id>.output.png`), kept until its candidate is stored, or for review when unusable. */
  output?: string;
  /** Kept after the preview expires: the image this edit made from which image, so later edits can trace the original. */
  lineage?: { sourceSha256: string; resultSha256: string; geometry: Geometry };
  appliedAt?: number;
  /** Applied although the identity gate suspected drift: the person confirmed they checked it. */
  identityOverride?: { at: number };
  /** Discarded as "not the same product": its image is kept until the preview would expire, for review; it is never served. */
  rejected?: { reason: 'identity'; at: number };
  /** An uncertain or failed edit the person set aside to start a new one. Its outcome stays as recorded. */
  abandoned?: { at: number; status: 'uncertain' | 'failed' };
}
// Provider messages can echo request contents. Keep only known parameter names and the existing sanitized diagnostics.
const editParameters = new Set(['background', 'image', 'image[]', 'images', 'mask', 'model', 'prompt', 'size', 'quality', 'n', 'output_format', 'input_fidelity']);
const rejectedParameter = (error: unknown) => {
  const value = error && typeof error === 'object' ? (error as { param?: unknown }).param : undefined;
  return typeof value === 'string' && editParameters.has(value) ? value : undefined;
};
/** Errors raised before a connection to the provider exists (DNS, refused, unreachable): the request never left this server. */
const NOT_DELIVERED = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'UND_ERR_CONNECT_TIMEOUT']);
const codesOf = (c: NetworkCause): string[] => [...(c.code ? [c.code] : []), ...(c.cause ? codesOf(c.cause) : []), ...(c.errors ?? []).flatMap(codesOf)];
const neverDelivered = (c: NetworkCause) => !c.status && codesOf(c).some(code => NOT_DELIVERED.has(code));
const uuid = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new RunError('INVALID_LAYER_EDIT', 'A valid edit operation ID is required.');
  return id;
};
const sameTarget = (a: LayerEditTarget, b: LayerEditTarget) => JSON.stringify(a) === JSON.stringify(b);
/** The layer an edit belongs to, whatever revision of its creative: lineage and the one-edit-at-a-time lock follow the layer. */
const layerKey = (t: LayerEditTarget) => t.kind === 'creative' ? `creative:${t.templateId}:${t.creativeId}:${t.layerId}` : `run:${t.runId}:${t.layerId}`;
const invalid = (message: string): never => { throw new RunError('INVALID_LAYER_EDIT', message); };
const regionOf = (raw: unknown): LayerEditRegion | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const r = raw as Record<string, unknown>, n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  const region = { x: n(r.x), y: n(r.y), width: n(r.width), height: n(r.height) };
  if (!Object.values(region).every(v => v >= 0 && v <= 1) || region.width < 0.01 || region.height < 0.01 || region.x + region.width > 1.0001 || region.y + region.height > 1.0001) invalid('The selected area is invalid. Select it again, or remove the area limit.');
  return region;
};
/**
 * Whether an edit that did not end applied can have cost money: charged once an image was received; none when nothing left
 * this server, or the provider refused it (4xx); otherwise possible. Never 'none' without that evidence.
 */
const billingOf = (r: RecordOfEdit): NonNullable<LayerEditStatus['billing']> =>
  r.receivedAt !== undefined || r.costUsd !== undefined ? 'charged'
    : r.phase === 'queued' || (r.failure?.transport && neverDelivered(r.failure.transport)) || (r.failure?.status !== undefined && r.failure.status < 500) ? 'none'
      : 'possible';
/**
 * Saving the creative while an edit is pending creates a newer revision of the same layer. Only the revision can move
 * forward; the template, creative and layer stay the request's own. resolve() still requires the saved image, or the
 * applied edit chain, to match this edit's exact source bytes, so a changed layer is rejected as before.
 */
const atRevision = (source: LayerEditSource, revision: unknown): LayerEditSource =>
  source.target.kind === 'creative' && Number.isSafeInteger(revision) && (revision as number) > source.target.revision
    ? { ...source, target: { ...source.target, revision: revision as number } } : source;
export function createLayerEdits(options: { dir: string; provider: () => RatioRegenerator | undefined; resolve: (target: LayerEditTarget) => Promise<ResolvedLayerEdit>; timeoutMs?: number }) {
  /** Operations this process is working on: only they may be `running` without being reconciled. */
  const active = new Set<string>(), activeTargets = new Set<string>(), recovering = new Set<string>();
  // The folder is created with the first request, not at startup: it sits among the runs, and an editor that never
  // requests an AI layer edit should leave no trace there.
  const path = (id: string) => join(options.dir, `${uuid(id)}.json`);
  const outputPath = (r: RecordOfEdit) => join(options.dir, r.output ?? `${uuid(r.operationId)}.output.png`);
  const write = (record: RecordOfEdit) => writeFileSync(path(record.operationId), JSON.stringify(record));
  const dropOutput = (record: RecordOfEdit) => { if (!record.output) return; try { unlinkSync(outputPath(record)); } catch { /* Already gone. */ } delete record.output; };
  /** Reads a record and reconciles a `running` one no process is working on (after a restart), by how far it got. */
  const read = (id: string): RecordOfEdit => {
    let record: RecordOfEdit;
    try { record = JSON.parse(readFileSync(path(id), 'utf8')) as RecordOfEdit; }
    catch (e) { if (e instanceof RunError) throw e; throw new RunError('NOT_FOUND', 'Layer edit not found.'); }
    if (record.status === 'running' && !active.has(id)) {
      if (record.phase === 'queued') {
        record.status = 'failed'; record.message = 'The server restarted before this edit was sent to the AI provider, so nothing was sent or charged. Start a new edit when you are ready.'; write(record);
      } else if (record.phase === 'received' && record.output && existsSync(outputPath(record))) {
        // The paid image is on disk: finish it (validation and checks only, no provider call).
        if (!recovering.has(id)) { recovering.add(id); queueMicrotask(() => void finishReceived(id)); }
      } else {
        record.status = 'uncertain'; record.message = 'The server stopped during this request. Completion and billing are unknown. Check provider usage before approving another request.'; write(record);
      }
    }
    return record;
  };
  const records = () => (existsSync(options.dir) ? readdirSync(options.dir) : []).filter(f => /^[a-f0-9-]{36}\.json$/.test(f)).map(f => read(f.slice(0, -5)));
  /** Older records have no lineage field: it is derived from their applied candidate while that still exists. */
  const lineageOf = (r: RecordOfEdit) => r.lineage ?? (r.candidate ? { sourceSha256: r.source.sourceSha256, resultSha256: r.candidate.image.sha256, geometry: r.candidate.geometry } : undefined);
  // Abandoned previews expire after a day; applied references remain recoverable for a week, then rely on the normal Save creative flow.
  const cleanup = () => {
    for (const record of records()) {
      const age = Date.now() - record.startedAt;
      if (record.candidate && age > (record.status === 'applied' ? 7 : 1) * 86400_000) {
        if (record.status === 'applied') { record.lineage = lineageOf(record); record.appliedAt ??= record.startedAt; }
        delete record.candidate;
        if (!record.rejected) { record.status = 'discarded'; record.message = 'Preview expired. Save your applied layer before editing it again.'; }
        write(record);
      }
      // A received image that could not be used is kept a day for review, like an abandoned preview.
      if (record.output && record.status !== 'running' && age > 86400_000) { dropOutput(record); write(record); }
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
  /**
   * Which product the layer is. The image edited is always the current layer (earlier approved edits are kept). When it is an
   * AI edit of a known original product, traced through applied edits by exact image hashes (they survive Save byte for
   * byte), the original is the identity reference. An untraceable image (an uploaded replacement, or edits older than the
   * kept records) is never paired with the template's product: that would be a different product.
   */
  const references = (resolved: Awaited<ReturnType<typeof resolve>>, useOriginal: boolean) => {
    const current = sha256(resolved.bytes), originalSha = resolved.original ? sha256(resolved.original) : undefined, key = layerKey(resolved.target);
    const byResult = new Map<string, RecordOfEdit>();
    for (const r of records()) { const l = lineageOf(r); if (l && (r.status === 'applied' || r.appliedAt) && layerKey(r.source.target) === key) byResult.set(l.resultSha256, r); }
    const steps: RecordOfEdit[] = [];
    let at = current;
    while (originalSha && at !== originalSha && steps.length < 50) {
      const r = byResult.get(at); if (!r || steps.includes(r)) break;
      steps.unshift(r); at = lineageOf(r)!.sourceSha256;
    }
    const traced = !!originalSha && at === originalSha;
    const info: LayerEditReferences = { current: { sha256: current, aiEdits: traced ? steps.length : 0 } };
    if (traced && steps.length) info.original = { sha256: originalSha, attached: useOriginal, instructions: steps.filter(s => s.prompt).map(s => s.prompt!), unrecordedEdits: steps.filter(s => !s.prompt).length };
    else if (!traced) info.unavailable = !resolved.original
      ? 'The original product picture for this layer could not be found, so only its current image is used.'
      : 'This layer is not the original product, and no recorded AI edits connect it to the original (it may be an uploaded replacement, or edited before these records were kept), so only its current image is used.';
    const imageFor = (sha: string) => sha === originalSha ? resolved.original : (() => { const r = byResult.get(sha); return r?.candidate ? Buffer.from(r.candidate.image.base64, 'base64') : undefined; })();
    return { info, steps: traced ? steps : undefined, original: traced && steps.length ? resolved.original : undefined, imageFor };
  };
  const supported = (r: RatioRegenerator) => r.offline || /^gpt-image-2(?:-2026-04-21)?$/.test(r.model);
  /** Everything a quote and its generation are made for; computed the same way for both, so the approved price holds. */
  const plan = async (input: LayerEditSource & { prompt?: unknown; region?: unknown; useOriginalReference?: unknown }) => {
    const resolved = await resolve(input), region = regionOf(input.region);
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    const intent = prompt ? classifyLayerEdit(prompt, { region: !!region }) : undefined;
    const refs = references(resolved, input.useOriginalReference !== false);
    const attach = !!refs.original && refs.info.original!.attached;
    const p = await prepareLayerEdit(resolved.bytes, { intent, region, identity: attach ? refs.original : undefined });
    return { resolved, region, prompt, intent, refs, attach, p };
  };
  type Plan = Awaited<ReturnType<typeof plan>>;
  const estimateFor = (q: Plan, r: RatioRegenerator | undefined): LayerEditEstimate => ({ available: !!r && supported(r), provider: 'OpenAI' as const, model: r?.model ?? '', offline: r?.offline ?? true, size: q.p.size,
    sourceSha256: q.p.sourceSha256, estimateUsd: r && !r.offline ? Math.round((regenEstimateUsdForSize(q.p.size) + (q.attach ? LAYER_EDIT_REFERENCE_USD : 0)) * 100) / 100 : 0,
    ...(q.intent ? { intent: q.intent } : {}), references: q.refs.info, ...(q.region ? { region: q.region } : {}),
    ...(!r ? { reason: 'AI layer editing needs OPENAI_API_KEY on the server.' } : !supported(r) ? { reason: 'The configured model has no verified layer-edit price. Configure gpt-image-2 before generating.' } : {}) });
  const inspect = async (id: string, revision?: unknown) => {
    const r = read(id); await options.resolve(atRevision(r.source, revision).target);
    const served = r.candidate && (r.status === 'candidate' || r.status === 'applied');
    return { operationId: r.operationId, status: r.status, ...(r.message ? { message: r.message } : {}), ...(served ? { candidate: r.candidate } : {}),
      ...(r.status === 'running' && r.phase ? { phase: r.phase } : {}), ...(r.submittedAt ? { submittedAt: r.submittedAt } : {}),
      ...(['failed', 'uncertain', 'discarded'].includes(r.status) ? { billing: billingOf(r) } : {}) } satisfies LayerEditStatus;
  };
  /**
   * The provider's result is saved before anything else can fail: the raw image first, then validation, the identity gate and
   * the candidate. Used for a normal response, a response that arrives after the server's deadline, and after a restart.
   */
  async function finish(id: string, record: RecordOfEdit, out: { image: Buffer; requestId?: string; costUsd?: number }, q: Plan): Promise<LayerEditCandidate> {
    if (out.requestId) record.requestId = out.requestId;
    if (out.costUsd !== undefined) record.costUsd = out.costUsd;
    // Discarded meanwhile: the response is accounted (request ID, cost), its image never retained. Checked before every write,
    // so a Discard made while this request ran is never overwritten.
    const discarded = () => { if (read(id).status !== 'discarded') return; dropOutput(record); record.receivedAt ??= Date.now(); record.status = 'discarded'; write(record); throw new RunError('EDIT_DISCARDED', 'This candidate was discarded. No edit was applied.'); };
    discarded();
    if (record.phase !== 'received' || !record.output) {
      record.phase = 'received'; record.receivedAt = Date.now(); record.output = `${id}.output.png`;
      writeFileSync(outputPath(record), out.image); write(record);
    }
    const { resolved, p, intent } = q, result = await validateLayerEdit(out.image, p);
    const identity = await assessIdentity({ candidate: result.png, reference: resolved.bytes, intent: intent!, geometry: result.geometry, ground: p.ground,
      ...(q.refs.steps?.length && resolved.original ? { original: resolved.original } : {}), ...(result.outsideAgreement !== undefined ? { outsideAgreement: result.outsideAgreement } : {}),
      ...await expectedFor(q, result.geometry) });
    const candidate: LayerEditCandidate = { ...(record.estimate ?? estimateFor(q, options.provider())), target: record.source.target, operationId: id, status: 'candidate',
      ...(record.requestId ? { requestId: record.requestId } : {}), ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
      image: { base64: result.png.toString('base64'), mimeType: 'image/png', width: result.width, height: result.height, sha256: sha256(result.png) }, geometry: result.geometry,
      validation: { background: result.background, identity: identity.status, checks: identity.checks, ...(identity.limitation ? { limitation: identity.limitation } : {}) } };
    discarded();
    record.status = 'candidate'; record.candidate = candidate; delete record.message; delete record.failure; delete record.phase;
    dropOutput(record); write(record);
    return candidate;
  }
  /** A received image whose processing was interrupted (restart): finished from disk. Never a provider call. */
  async function finishReceived(id: string) {
    active.add(id);
    const record = read(id);
    try {
      const q = await plan({ ...record.source, prompt: record.prompt, ...(record.options ?? { useOriginalReference: true }) });
      await finish(id, record, { image: readFileSync(outputPath(record)) }, q);
    } catch (e) {
      if (!(e instanceof RunError && e.code === 'EDIT_DISCARDED')) {
        record.status = 'failed';
        record.message = `The AI result was received before the server restarted, but it could not be checked: ${e instanceof Error ? e.message : 'unknown error'} It is kept on the server and was not applied. The provider request was charged. No automatic retry was made.`;
        write(record);
      }
    } finally { active.delete(id); recovering.delete(id); }
  }
  return {
    async estimate(input: LayerEditSource & { prompt?: unknown; region?: unknown; useOriginalReference?: unknown }) { cleanup(); return estimateFor(await plan(input), options.provider()); },
    status: inspect,
    /**
     * The latest unfinished edit (running, candidate or uncertain) of this layer made from its current image: how an editor
     * that lost its local record (browser closed, another tab) finds it again. Read only; access is checked like every call.
     */
    async open(input: LayerEditSource) {
      const target = layerEditTarget(input.target);
      if (typeof input.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceSha256)) invalid('The current layer image could not be verified.');
      await options.resolve(target);
      const key = layerKey(target), found = records().filter(r => layerKey(r.source.target) === key && r.source.sourceSha256 === input.sourceSha256 && ['running', 'candidate', 'uncertain'].includes(r.status))
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      return found ? { operationId: found.operationId, status: found.status, ...(found.prompt ? { prompt: found.prompt } : {}) } : {};
    },
    /**
     * `revision`: the editor's current saved creative revision, when a save happened after this edit was requested.
     * `acceptIdentityRisk`: required for a result the identity gate flagged; the person confirmed it is the same product.
     */
    async apply(id: string, revision?: unknown, input: { acceptIdentityRisk?: unknown } = {}) {
      const record = read(id);
      if (!record.candidate || !['candidate', 'applied'].includes(record.status)) invalid('This preview is no longer available.');
      if (record.candidate!.validation.identity === 'drift-suspected' && record.status !== 'applied') {
        if (input.acceptIdentityRisk !== true) throw new RunError('IDENTITY_REVIEW_REQUIRED', 'This result appears to change the product itself. Reject it, or confirm you checked that it is the same product before applying it. The layer was not changed.');
        record.identityOverride = { at: Date.now() };
      }
      const source = atRevision(record.source, revision);
      await resolve(source);
      // The next edit of this layer chains from this record, so it must name the revision the editor now holds.
      record.source = source; record.status = 'applied'; record.appliedAt ??= Date.now(); record.lineage = lineageOf(record); write(record);
      return inspect(id);
    },
    /**
     * reason 'identity': the person rejected the result as a different product. Its image is kept for review, never served.
     * An uncertain or failed edit is set aside (`abandoned`): its record, outcome and billing note stay, identifiable by ID.
     */
    async discard(id: string, reason?: unknown) {
      const record = read(id);
      // A request in flight is marked discarded; its eventual response is validated/accounted but never retained.
      if (record.status !== 'applied' && record.status !== 'discarded') {
        if (reason === 'identity' && record.candidate) record.rejected = { reason: 'identity', at: Date.now() };
        else delete record.candidate;
        if (record.status === 'uncertain' || record.status === 'failed') record.abandoned = { at: Date.now(), status: record.status };
        record.status = 'discarded'; write(record);
      }
      return { operationId: id, status: record.status, ...(record.status === 'discarded' ? { billing: billingOf(record) } : {}) } satisfies LayerEditStatus;
    },
    async generate(input: LayerEditRequest): Promise<LayerEditCandidate> {
      const id = uuid(input.operationId), prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
      if (!prompt || prompt.length > LAYER_EDIT_LIMITS.prompt) invalid('Describe your edit in 1–1000 characters.');
      // The same operation ID never makes a second provider request: a repeat gets the stored result or the recorded state.
      if (existsSync(path(id))) return replay(id, input, prompt);
      const r = options.provider(); if (!r) throw new RunError('NOT_CONFIGURED', 'AI layer editing needs OPENAI_API_KEY on the server.');
      if (!supported(r)) throw new RunError('NOT_CONFIGURED', 'Layer editing currently has verified pricing for gpt-image-2 only.');
      const q = await plan({ ...input, prompt }), { resolved, p } = q, intent = q.intent!, estimate = estimateFor(q, r);
      if (input.model !== r.model) throw new RunError('STALE_REVISION', 'The model changed. Review the estimate again.');
      if (!Number.isFinite(input.approveUsd) || input.approveUsd < estimate.estimateUsd) throw new RunError('APPROVAL_REQUIRED', 'Approve the displayed cost before generating this layer edit.');
      if (intent.clarification && input.confirmAmbiguous !== true) throw new RunError('CLARIFICATION_REQUIRED', `${intent.clarification} Nothing was sent or charged.`);
      // A repeat of this operation that arrived while it was being planned is the same request, not a second one.
      if (existsSync(path(id))) return replay(id, input, prompt);
      // One edit per layer at a time, whatever the creative revision: a save during generation does not open a second request.
      const key = layerKey(resolved.target);
      if (activeTargets.has(key)) throw new RunError('BUSY', 'An edit for this layer is already running. Check its status; no new request was submitted.');
      const source: LayerEditSource = { target: resolved.target, sourceSha256: input.sourceSha256, ...(input.sourceCandidateId ? { sourceCandidateId: uuid(input.sourceCandidateId) } : {}) };
      const record: RecordOfEdit = { operationId: id, source, status: 'running', phase: 'queued', startedAt: Date.now(), prompt, intent, estimate,
        options: { ...(q.region ? { region: q.region } : {}), useOriginalReference: input.useOriginalReference !== false },
        request: { size: p.size, images: 1 + p.references.length, mask: !!p.mask, framing: p.expanding ? 'expanding' : 'fitted' } };
      try { mkdirSync(options.dir, { recursive: true }); writeFileSync(path(id), JSON.stringify(record), { flag: 'wx' }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return replay(id, input, prompt); throw e; }
      active.add(id); activeTargets.add(key);
      const text = layerEditPrompt({ name: resolved.name, instruction: prompt, ground: p.ground, intent, measured: p.measured, region: !!p.mask,
        ...(q.attach ? { original: { instructions: q.refs.info.original!.instructions, unrecordedEdits: q.refs.info.original!.unrecordedEdits } } : {}) });
      let received = false, sent = false, timedOut = false, timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const out = await limitedImage(async () => {
          // Discarded, or the source changed, while waiting for a provider slot: nothing is sent.
          const notSent = () => { if (read(id).status === 'discarded') throw new RunError('EDIT_DISCARDED', 'This edit was discarded before it was sent. Nothing was sent or charged.'); };
          notSent(); await resolve(source); notSent();
          // Persisted before the request leaves: from here on a lost connection or a restart means "outcome unknown".
          record.phase = 'submitting'; record.submittedAt = Date.now(); write(record);
          sent = true;
          // GPT Image 2 native transparency is a preview capability. Use the existing plain-background cutout path
          // without requiring that provider option; validateLayerEdit still accepts native alpha if returned.
          const call = r.regenerate({ image: p.image, size: p.size, prompt: text, ...(p.references.length ? { references: p.references } : {}), ...(p.mask ? { mask: p.mask } : {}) }, () => {}, id);
          // A provider that answers after the server stopped waiting: its image is still kept (the request was paid).
          call.then(late => { if (timedOut) void finishLate(id, late, q); }, () => {});
          return Promise.race([call, new Promise<never>((_, reject) => {
            timer = setTimeout(() => { timedOut = true; const e = new Error('Image deadline exceeded'); e.name = 'ImageTimeout'; reject(e); }, options.timeoutMs ?? 310_000);
          })]);
        });
        received = true;
        return await finish(id, record, out, q);
      } catch (error) {
        if (error instanceof RunError && error.code === 'EDIT_DISCARDED') {
          if (!sent) { record.status = 'discarded'; record.message = error.message; write(record); }
          throw error;
        }
        if (!sent && error instanceof RunError) {
          // The source changed while this request waited for a provider slot: no provider request exists to bill or recover.
          record.status = read(id).status === 'discarded' ? 'discarded' : 'failed';
          record.message = `${error.message} The edit was not sent to the AI provider, so nothing was charged.`;
          write(record);
          throw new RunError('LAYER_EDIT_FAILED', record.message, { operationId: id, status: record.status, billing: billingOf(record) });
        }
        const failure = imageFailure(error, received, record.requestId), parameter = rejectedParameter(error);
        const elapsedMs = Date.now() - (record.submittedAt ?? record.startedAt), lost = !received && !failure.details.status;
        const undelivered = lost && neverDelivered(failure.details);
        record.requestId = failure.requestId;
        record.failure = { status: failure.details.status, code: failure.details.code, parameter, requestId: failure.requestId, phase: record.phase, elapsedMs, transport: failure.details };
        record.status = received || failure.outcome === 'rejected' || undelivered ? 'failed' : 'uncertain';
        const reason = received && error instanceof RunError ? error.message : failure.message.replace(/ No automatic retry was made\.$/, '').replace(/ Provider completion and billing are unknown\.$/, '');
        const seconds = Math.round(elapsedMs / 1000), end = /[.!?]$/.test(reason) ? '' : '.';
        const when = !lost ? '' : failure.code === 'IMAGE_TIMEOUT' ? ` No response arrived within ${seconds} s.`
          : ` The connection ended ${seconds} s after the request was sent, before ${record.requestId ? 'the result arrived' : 'OpenAI returned any response or request ID'}.`;
        record.message = undelivered
          ? `OpenAI could not be reached (${codesOf(failure.details).filter(c => NOT_DELIVERED.has(c)).join(', ')}), so the request was not delivered and nothing was charged. No edit was applied. No automatic retry was made.`
          : received
            ? `${reason}${end} The AI result was received${record.costUsd !== undefined ? ` (reported cost $${record.costUsd.toFixed(3)})` : ''}, so this request was charged; it is kept on the server and was not applied. No automatic retry was made.`
            : `${reason}${end}${parameter ? ` Rejected parameter: ${parameter}.` : ''}${when}${record.status === 'uncertain' ? ' Provider completion and billing are unknown.' : ''} No edit was applied.${failure.outcome === 'rejected' ? '' : ' A provider charge may still apply.'} No automatic retry was made.`;
        if (read(id).status === 'discarded') record.status = 'discarded';
        write(record);
        throw new RunError('LAYER_EDIT_FAILED', record.message, { operationId: id, status: record.status, billing: billingOf(record) });
      } finally { if (timer) clearTimeout(timer); active.delete(id); activeTargets.delete(key); }
    },
  };
  /** A repeated operation ID: the stored candidate, or the recorded state. Never a second provider request. */
  function replay(id: string, input: LayerEditRequest, prompt: string): LayerEditCandidate {
    const existing = read(id);
    if (existing.prompt !== undefined && (existing.prompt !== prompt || existing.source.sourceSha256 !== input.sourceSha256))
      throw new RunError('IDEMPOTENCY_CONFLICT', 'This operation ID was already used for a different edit. Nothing was sent.', { operationId: id, status: existing.status });
    if (existing.status === 'candidate' && existing.candidate) return existing.candidate;
    throw new RunError('IDEMPOTENCY_CONFLICT', 'This edit was already submitted. Check its status; nothing was retried.', { operationId: id, status: existing.status });
  }
  /** The provider answered after the server's deadline had already recorded the edit as uncertain. */
  async function finishLate(id: string, out: { image: Buffer; requestId?: string; costUsd?: number }, q: Plan) {
    try {
      const record = read(id);
      if (record.status !== 'uncertain') return;
      active.add(id); record.status = 'running'; write(record);
      await finish(id, record, out, q);
    } catch (e) {
      const record = read(id);
      if (record.status === 'running') { record.status = 'failed'; record.message = `The AI result arrived after the server stopped waiting, but it could not be used: ${e instanceof Error ? e.message : 'unknown error'} The provider request was charged. No automatic retry was made.`; write(record); }
    } finally { active.delete(id); }
  }
  /**
   * A pure reversal of a recorded state change (close after open) should give back the image before that change: the gate
   * then compares strictly with it, at the size the chain of edits implies.
   */
  async function expectedFor(q: Plan, geometry: Geometry) {
    const steps = q.refs.steps;
    if (!steps?.length || !q.intent) return {};
    const at = reversedInstruction(q.prompt, steps.map(s => s.prompt));
    if (at === undefined) return {};
    const before = q.refs.imageFor(lineageOf(steps[at])!.sourceSha256);
    if (!before) return {};
    // Each edit's geometry relates its result to its source's whole image; the result itself is a tight cut-out.
    const chain = steps.slice(at).reduce((s, r) => { const g = lineageOf(r)!.geometry; return { width: s.width * g.width, height: s.height * g.height }; }, { width: geometry.width, height: geometry.height });
    const fraction = await objectFraction(before);
    return { expected: { image: before, scale: { width: chain.width / fraction.width, height: chain.height / fraction.height } } };
  }
}
