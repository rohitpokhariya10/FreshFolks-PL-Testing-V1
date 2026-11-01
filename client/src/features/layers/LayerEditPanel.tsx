import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { AlertTriangle, Check, CheckCircle2, Clock3, Info, Sparkles } from 'lucide-react';
import { LAYER_EDIT_LIMITS, type DesignLayer, type DesignVariant, type LayerEditCandidate, type LayerEditEstimate, type LayerEditSource } from '@frameflow/shared';
import { type RootState, selectActiveVariant, useAppSelector } from '../../store';
import { layerEditApplied } from '../../store/editorSlice';
import { assets, decodeImage } from '../../lib/assets/runtimeAssets';
import { describeLayerEditChanges, editableLayer, editedLayerGeometry, layerEditChanges, layerEditSnapshot, matchesLayerEditSnapshot, snapshotFingerprint } from './layerEdit';
import { imageHash, LayerEditApiError, layerEditApi } from './layerEditApi';
import { useLayerEditPreview } from './LayerEditPreview';
import { createSingleFlight, failureFeedback, formatElapsed, generateOutcome, layerEditPhase, layerEditRecovery, recordLayerEditConflict, type Feedback, type LayerEditBusy, type LayerEditConflict, type PendingStatus } from './layerEditFlow';
import { LayerThumbnail } from './LayerThumbnail';
import './layerEdit.css';

type Quote = { estimate: LayerEditEstimate; source: LayerEditSource; snapshot: string; version: number; before: string };
/** A request whose result is not loaded: running here, interrupted, or found again after reselecting/reloading. */
type Pending = { id: string; snapshot: string; version: number; prompt?: string; status: PendingStatus; detail?: string };
type Work = Exclude<LayerEditBusy, ''>;
/** The server stops waiting for the provider after 310 s. Past this, the response is treated as lost and checked — never resent. */
const GENERATE_TIMEOUT_MS = 330_000;
const session = () => sessionStorage, browser = () => localStorage;
const Spinner = () => <span className="ai-spinner" aria-hidden="true" />;

const PENDING_TEXT: Record<PendingStatus, { title: string; body: string; tone: 'info' | 'warning' | 'error' }> = {
  unchecked: { tone: 'info', title: 'An AI edit is waiting to be collected', body: 'This layer has an AI edit that hasn’t been loaded yet. Check its status to see the result — checking is free and never starts another generation.' },
  running: { tone: 'info', title: 'Still processing', body: 'Your AI edit is still processing. You can check its status again without starting another generation.' },
  interrupted: { tone: 'warning', title: 'Unable to confirm request status', body: 'The connection was interrupted after the request was sent, so it may still finish. Check its status — this never submits another generation.' },
  uncertain: { tone: 'warning', title: 'Unable to confirm request status', body: 'The server can’t tell whether the AI provider finished this request, and a charge may apply. Check provider usage, then discard it before approving another edit.' },
  failed: { tone: 'error', title: 'Generation failed', body: 'Your edit couldn’t be completed. The original layer was not changed. A provider charge may still apply.' },
};

function Note({ feedback }: { feedback: Feedback }) {
  const Icon = feedback.tone === 'success' ? CheckCircle2 : feedback.tone === 'info' ? Info : AlertTriangle;
  return <div className={`ai-layer-note is-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
    <Icon size={15} aria-hidden="true" />
    <div><p className="ai-layer-note-title">{feedback.title}</p>{feedback.detail && <p>{feedback.detail}</p>}</div>
  </div>;
}

/** No provider work runs on mount or selection. A quote is free; each generation requires its own explicit approval. */
export function LayerEditPanel({ variant, layer }: { variant: DesignVariant; layer: DesignLayer }) {
  const store = useStore<RootState>(), eligibility = editableLayer(variant, layer), snapshot = layerEditSnapshot(variant, layer);
  const documentId = useAppSelector(s => s.editor.document.id), ids = useId();
  const { show: showPreview, clear: clearPreview, sourceVersion: version, getSourceVersion } = useLayerEditPreview();
  // The inspector is keyed by version and layer, so this panel always belongs to one layer of one design.
  const [recovery] = useState(() => layerEditRecovery(session, documentId, variant.id, layer.id));
  const [restored] = useState(() => recovery.read(s => matchesLayerEditSnapshot(s, variant, layer)));
  const [pending, setPending] = useState<Pending | undefined>(() => restored && { ...restored, version, status: 'unchecked' });
  const [prompt, setPrompt] = useState(restored?.prompt ?? '');
  const [quote, setQuote] = useState<Quote>(), [approved, setApproved] = useState(false);
  const [candidate, setCandidate] = useState<LayerEditCandidate>();
  const [previewImage, setPreviewImage] = useState<{ id: string; bitmap: HTMLImageElement; blob: Blob }>();
  const [imageFailed, setImageFailed] = useState(''); // The operation whose candidate could not be decoded or verified.
  const [mode, setMode] = useState<'before' | 'after'>('after');
  const [busy, setBusy] = useState<LayerEditBusy>(''), [feedback, setFeedback] = useState<Feedback>();
  const [clock, setClock] = useState({ start: 0, now: 0 });
  const [flight] = useState(() => createSingleFlight<Work>());
  // operation: this panel's request (running, pending or previewed). outcomeKnown: its result or failure has been seen.
  const operation = useRef(restored?.id ?? ''), outcomeKnown = useRef(false), mounted = useRef(true);

  const latest = () => { const s = store.getState(), v = selectActiveVariant(s); return { s, v, l: v.layers?.find(l => l.id === layer.id) }; };
  /** Same layer, same image and placement, and no change in between — a change undone later still counts. */
  const current = (expected: string, expectedVersion: number) => {
    const { s, v, l } = latest();
    return mounted.current && getSourceVersion() === expectedVersion && s.ui.selectedElementId === layer.id && !!l && matchesLayerEditSnapshot(expected, v, l);
  };
  /** Saving the creative changes only its revision. Requests always name the revision the editor holds now. */
  const currentTarget = () => { const { v, l } = latest(); return l ? editableLayer(v, l).target : undefined; };
  const savedRevision = () => { const t = currentTarget(); return t?.kind === 'creative' ? t.revision : undefined; };
  /** Diagnostics for every stale rejection: what changed, where it was seen, and whether a paid result exists (layerEditFlow). */
  const conflict = (where: LayerEditConflict['where'], request: { snapshot: string; version: number }, info: { operationId?: string; resultArrived: boolean; code?: string }) => {
    const { s, v, l } = latest(), changed = layerEditChanges(request.snapshot, v, l);
    recordLayerEditConflict(browser, { at: new Date().toISOString(), layerId: layer.id, where, side: info.code ? 'server' : 'client', ...(info.code ? { code: info.code } : {}),
      ...(info.operationId ? { operationId: info.operationId } : {}), resultArrived: info.resultArrived,
      requested: { fingerprint: snapshotFingerprint(request.snapshot), version: request.version },
      current: { ...(l ? { fingerprint: snapshotFingerprint(layerEditSnapshot(v, l)) } : {}), version: getSourceVersion() },
      selected: s.ui.selectedElementId === layer.id, changed, layerChanged: changed.length > 0 });
  };
  const staleOnServer = (where: LayerEditConflict['where'], e: unknown, request: { snapshot: string; version: number }, operationId?: string, resultArrived = false) => {
    if (e instanceof LayerEditApiError && e.code === 'STALE_REVISION') conflict(where, request, { operationId, resultArrived, code: e.code });
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // StrictMode immediately runs setup again; only a real unmount gets here with mounted still false.
      queueMicrotask(() => {
        const id = operation.current;
        // A result nobody has seen yet (still running, interrupted or unchecked) stays recoverable from this layer.
        if (mounted.current || !id || !outcomeKnown.current) return;
        recovery.clear(id);
        void layerEditApi.discard(id).catch(() => undefined);
      });
    };
  }, [recovery]);
  useEffect(() => () => { if (quote?.before) URL.revokeObjectURL(quote.before); }, [quote?.before]);
  // Decode and validate each candidate once. Toggling reuses this bitmap and never writes an asset or contacts the API.
  useEffect(() => {
    if (!candidate) return;
    const controller = new AbortController();
    void (async () => {
      const blob = new Blob([Uint8Array.from(atob(candidate.image.base64), c => c.charCodeAt(0))], { type: 'image/png' });
      const bitmap = await decodeImage(blob, controller.signal);
      if (bitmap.naturalWidth !== candidate.image.width || bitmap.naturalHeight !== candidate.image.height || await imageHash(blob) !== candidate.image.sha256) throw new Error('The candidate image failed verification.');
      if (!controller.signal.aborted) setPreviewImage({ id: candidate.operationId, bitmap, blob });
    })().catch(() => { if (!controller.signal.aborted) setImageFailed(candidate.operationId); });
    return () => controller.abort();
  }, [candidate]);
  useEffect(() => {
    if (busy !== 'generate') return;
    const timer = setInterval(() => setClock(c => ({ ...c, now: Date.now() })), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (feedback?.tone !== 'success') return;
    const timer = setTimeout(() => setFeedback(f => f === feedback ? undefined : f), 8000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const quoteStale = !!quote && (quote.snapshot !== snapshot || quote.version !== version);
  const pendingStale = !!pending && (pending.version !== version || !matchesLayerEditSnapshot(pending.snapshot, variant, layer));
  const stale = quoteStale || pendingStale;
  const readyImage = previewImage?.id === candidate?.operationId ? previewImage : undefined;
  const phase = layerEditPhase({ eligible: !eligibility.reason, busy, stale, quote: !!quote, candidate: !!candidate, imageReady: !!readyImage, imageFailed: !!candidate && imageFailed === candidate.operationId, pending: !!pending });
  const comparing = phase === 'compare' || phase === 'applying';
  // The request the stale check compares with: a loaded preview's quote, else the request still pending, else the quote.
  const request = candidate ? quote : pending ?? quote;
  const reported = useRef('');
  useEffect(() => {
    if (phase !== 'stale' || !request) return;
    const key = `${operation.current}|${request.snapshot.length}|${request.version}`;
    if (reported.current === key) return;
    reported.current = key;
    conflict(busy === 'generate' ? 'during-generation' : candidate ? 'preview' : pending ? 'pending' : 'quote', request, { ...(operation.current ? { operationId: operation.current } : {}), resultArrived: !!candidate });
  });
  const activeMode = comparing ? mode : 'before';
  useLayoutEffect(() => {
    if (!candidate || !quote || !readyImage || stale) return;
    showPreview({ operationId: candidate.operationId, variantId: variant.id, layerId: layer.id, snapshot: quote.snapshot, version: quote.version,
      mode, image: readyImage.bitmap, geometry: editedLayerGeometry(layer, candidate.geometry) });
    return () => clearPreview(candidate.operationId);
  }, [candidate, quote, readyImage, stale, mode, variant.id, layer, showPreview, clearPreview]);

  const begin = (kind: Work, preempt?: (running: Work) => boolean) => {
    const token = flight.begin(kind, preempt);
    if (token) { setBusy(kind); setFeedback(undefined); }
    return token;
  };
  const live = (token: number) => mounted.current && flight.holds(token);
  const end = (token: number) => { if (flight.end(token) && mounted.current) setBusy(''); };
  const forget = () => { if (operation.current) recovery.clear(operation.current); operation.current = ''; outcomeKnown.current = false; };
  const reset = () => { forget(); setPending(undefined); setCandidate(undefined); setPreviewImage(undefined); setImageFailed(''); setQuote(undefined); setApproved(false); setMode('after'); };
  const loadSource = async () => {
    if (!eligibility.target || layer.type !== 'image' || !layer.assetId) throw new Error(eligibility.reason ?? 'Choose an object layer.');
    const asset = await assets.getAsset(layer.assetId);
    if (!asset) throw new Error('The selected image is missing from this browser. Reopen the saved creative.');
    const source: LayerEditSource = { target: eligibility.target, sourceSha256: await imageHash(asset.blob), ...(layer.assetId.startsWith('ai-layer-') ? { sourceCandidateId: layer.assetId.slice(9) } : {}) };
    return { asset, source };
  };

  const validPrompt = prompt.trim().length > 0 && prompt.trim().length <= LAYER_EDIT_LIMITS.prompt;
  const estimate = async () => {
    if (!validPrompt) return;
    const token = begin('estimate'); if (!token) return;
    try {
      const { asset, source } = await loadSource(), result = await layerEditApi.estimate(source);
      if (!live(token)) return;
      if (!current(snapshot, version)) throw new Error('The layer changed while the cost was being checked. Try again.');
      setQuote({ estimate: result, source, snapshot, version, before: URL.createObjectURL(asset.blob) }); setApproved(false);
    } catch (e) { staleOnServer('quote', e, { snapshot, version }); if (live(token)) setFeedback(failureFeedback(e, 'Couldn’t check the cost of this edit. Nothing was charged.')); }
    finally { end(token); }
  };
  const generate = async () => {
    if (!quote || !approved || !validPrompt || stale) return;
    const token = begin('generate'); if (!token) return; // Repeated clicks: only the first reaches here.
    setApproved(false); setClock({ start: Date.now(), now: Date.now() });
    const id = crypto.randomUUID(), text = prompt.trim(), from = { snapshot: quote.snapshot, version: quote.version };
    let recorded = false;
    try {
      if (!current(from.snapshot, from.version)) throw new Error('The layer changed after the cost was checked. Nothing was sent.');
      // The recovery record precedes the paid request. Recovery only reads status; it never submits again.
      try { recovery.write({ id, snapshot: from.snapshot, prompt: text }); }
      catch { throw new Error('Request recovery storage is unavailable in this browser. No generation was submitted.'); }
      recorded = true; operation.current = id; outcomeKnown.current = false;
      setPending({ id, ...from, prompt: text, status: 'running' });
      const result = await layerEditApi.generate({ ...quote.source, target: currentTarget() ?? quote.source.target, prompt: text, operationId: id, model: quote.estimate.model, approveUsd: quote.estimate.estimateUsd }, AbortSignal.timeout(GENERATE_TIMEOUT_MS));
      // Discarded meanwhile, or the panel closed: nothing here changes, and an unseen result stays recoverable.
      if (!live(token)) return;
      if (!current(from.snapshot, from.version)) {
        // A completed, paid result is never deleted by this client-side check. It stays on the server and in this layer's
        // recovery record (outcomeKnown stays false): Discard removes it, and once the layer is exactly as requested again
        // (e.g. after Undo), an explicit, server-verified status check can collect it. It is never applied or shown here.
        conflict('result', from, { operationId: id, resultArrived: true });
        setPending({ id, ...from, prompt: text, status: 'unchecked' });
        return;
      }
      outcomeKnown.current = true;
      setPending(undefined); setPreviewImage(undefined); setImageFailed(''); setMode('after'); setCandidate(result);
    } catch (e) {
      if (!live(token)) return;
      staleOnServer('generate', e, from, recorded ? id : undefined);
      const outcome = recorded ? generateOutcome(e).kind : 'not-sent';
      if (outcome === 'not-sent') { forget(); setPending(undefined); setFeedback(failureFeedback(e, 'The edit wasn’t started. Nothing was charged.')); }
      else if (outcome === 'discarded') { reset(); setFeedback({ tone: 'info', title: 'This edit was discarded. No layer was changed.' }); }
      else {
        if (outcome === 'failed') outcomeKnown.current = true;
        setPending({ id, ...from, prompt: text, status: outcome, ...(outcome !== 'interrupted' && e instanceof Error ? { detail: e.message } : {}) });
      }
    } finally { end(token); }
  };
  /** request: the pending request, or (from the stale card) the same request once the layer matches it again. */
  const recover = async (request = pending) => {
    if (!request || (request === pending && stale)) return;
    const token = begin('status'); if (!token) return;
    try {
      const status = await layerEditApi.status(request.id, savedRevision());
      if (!live(token)) return;
      if (status.candidate && (status.status === 'candidate' || status.status === 'applied')) {
        const { asset, source } = await loadSource();
        if (!live(token)) return;
        if (!current(request.snapshot, request.version)) { conflict('recover', request, { operationId: request.id, resultArrived: true }); throw new Error('The layer changed while this request was being checked. Discard it and start again.'); }
        if (source.sourceSha256 !== status.candidate.sourceSha256) throw new Error('This result was made from a different image than the layer shows now. Discard it and start again.');
        outcomeKnown.current = true;
        setQuote({ estimate: status.candidate, source, snapshot, version, before: URL.createObjectURL(asset.blob) });
        setPending(undefined); setPreviewImage(undefined); setImageFailed(''); setMode('after'); setCandidate(status.candidate);
      } else if (status.status === 'discarded') { reset(); setFeedback({ tone: 'info', title: 'This request was already discarded. No layer was changed.' }); }
      else {
        if (status.status === 'failed') outcomeKnown.current = true;
        setPending({ ...request, status: status.status === 'running' ? 'running' : status.status === 'failed' ? 'failed' : 'uncertain', ...(status.message ? { detail: status.message } : {}) });
      }
    } catch (e) {
      if (!live(token)) return;
      staleOnServer('recover', e, request, request.id);
      if (e instanceof LayerEditApiError && e.code === 'NOT_FOUND') { reset(); setFeedback({ tone: 'info', title: 'This request isn’t on the server, so there is nothing to collect.', detail: 'If it never reached the server, nothing was generated or charged. You can start a new edit.' }); }
      else setFeedback(failureFeedback(e, 'Unable to confirm request status. Nothing was resubmitted.'));
    } finally { end(token); }
  };
  /**
   * The layer is exactly as the kept request was made from again (e.g. the change was undone). Nothing revives on its own:
   * this explicit click checks the request's status, and recover() verifies the layer and the source image once more.
   */
  const recheck = () => {
    if (!pending || busy || !matchesLayerEditSnapshot(pending.snapshot, variant, layer)) return;
    const rebased = { ...pending, version };
    setQuote(undefined); setPending(rebased); void recover(rebased);
  };
  /** again: discard a viewed result to try the same prompt again, which requires a new approval. */
  const discard = async (again = false) => {
    // A generation whose layer changed can be discarded while it still runs; its late response is then ignored.
    const token = begin('discard', running => running === 'generate' && stale); if (!token) return;
    setMode('before'); // Restore the original on the canvas at once.
    const id = operation.current, had = !!candidate;
    try {
      if (id) await layerEditApi.discard(id).catch(e => { if (!(e instanceof LayerEditApiError && e.code === 'NOT_FOUND')) throw e; });
      if (!live(token)) return;
      reset();
      if (again) setFeedback({ tone: 'info', title: 'Ready for another attempt.', detail: 'Edit the prompt if you like, then Generate Edit. Each generation needs its own approval.' });
      else if (id) setFeedback({ tone: 'info', title: had ? 'Edit discarded. The layer is unchanged.' : 'Request discarded. The layer is unchanged.' });
    } catch (e) { if (live(token)) setFeedback(failureFeedback(e, 'Couldn’t discard this request. Try again.')); }
    finally { end(token); }
  };
  const apply = async () => {
    if (!candidate || !quote || !readyImage || mode !== 'after' || stale) return;
    const token = begin('apply'); if (!token) return; // Repeated clicks: only the first reaches here.
    const assetId = `ai-layer-${candidate.operationId}`;
    let stored = false, applied = false, existed = false;
    try {
      const { source } = await loadSource();
      if (source.sourceSha256 !== quote.source.sourceSha256) throw new Error('The source image changed. Discard this preview.');
      existed = await assets.hasAsset(assetId); await assets.putAsset(assetId, readyImage.blob); stored = true;
      // Revalidates the saved source on the server; no creative mutation or AI request.
      await layerEditApi.apply(candidate.operationId, savedRevision());
      if (!current(quote.snapshot, quote.version)) { conflict('apply', quote, { operationId: candidate.operationId, resultArrived: true }); throw new Error('The layer changed. This preview cannot be applied.'); }
      // Unrelated edits and save acknowledgements may have advanced the document while awaiting storage/API validation.
      const { v, l } = latest();
      store.dispatch(layerEditApplied({ variantId: v.id, id: l!.id, assetId, expectedRevision: v.revision, expectedLayer: JSON.stringify(l), geometry: editedLayerGeometry(l!, candidate.geometry), timestamp: new Date().toISOString() }));
      const next = latest().l;
      applied = next?.type === 'image' && next.assetId === assetId;
      if (!applied) throw new Error('The layer changed or the edited bounds are unsupported. Nothing was applied.');
      forget(); setCandidate(undefined); setPreviewImage(undefined); setQuote(undefined); setPrompt('');
      setFeedback({ tone: 'success', title: 'Edit applied', detail: 'Undo restores the previous image. Save creative to keep this version. You can describe another change now.' });
    } catch (e) {
      staleOnServer('apply', e, quote, candidate.operationId, true);
      if (stored && !applied && !existed) await assets.deleteAsset(assetId).catch(() => undefined);
      if (live(token)) setFeedback(failureFeedback(e, 'The edit couldn’t be applied. The layer was not changed.'));
    } finally { end(token); }
  };

  const offline = !!quote?.estimate.offline, price = quote ? `$${quote.estimate.estimateUsd.toFixed(2)}` : '';
  const pendingText = pending && PENDING_TEXT[pending.status];
  const body = () => {
    switch (phase) {
      case 'ready': case 'checking-cost': return <>
        <button className="button ai-layer-primary" disabled={!validPrompt || phase === 'checking-cost'} aria-busy={phase === 'checking-cost'} onClick={() => void estimate()}>
          {phase === 'checking-cost' ? <><Spinner />Checking cost…</> : <><Sparkles size={14} aria-hidden="true" />Generate Edit</>}
        </button>
        <p className="ai-layer-hint">You’ll see the price first — nothing is charged until you approve. Only this object is sent to the AI.</p>
      </>;
      case 'approval': return <div className="ai-layer-card ai-layer-approval" role="group" aria-labelledby={`${ids}-approve`}>
        <p className="ai-layer-card-title" id={`${ids}-approve`}>Approve this edit</p>
        <dl className="ai-layer-facts">
          <div><dt>Model</dt><dd>{quote!.estimate.model || 'Unavailable'}</dd></div>
          <div><dt>Output</dt><dd>1024 × 1024 · High quality</dd></div>
          <div><dt>Estimate</dt><dd>{offline ? 'Offline test provider · $0.00' : `${price} per edit`}</dd></div>
        </dl>
        {quote!.estimate.reason ? <p className="ai-layer-inline-error" role="alert">{quote!.estimate.reason}</p> : <>
          <p className="ai-layer-fineprint">An estimate, not a fixed price: final cost depends on usage, and a failed result may still be charged. Comparing, applying and discarding are free.</p>
          <label className="ai-layer-consent"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />
            <span>I approve one {offline ? 'offline test' : 'paid'} generation{offline ? '' : ` (about ${price})`}.</span></label>
        </>}
        <div className="ai-layer-actions">
          {!quote!.estimate.reason && <button className="button ai-layer-primary" disabled={!approved || !validPrompt} onClick={() => void generate()}>Approve and generate</button>}
          <button className="button" onClick={() => { setQuote(undefined); setApproved(false); }}>Cancel</button>
        </div>
      </div>;
      case 'generating': return <>
        <button className="button ai-layer-primary" disabled aria-busy="true"><Spinner />Generating edit…</button>
        <div className="ai-layer-card is-info ai-layer-progress">
          <div role="status"><p className="ai-layer-card-title">Generating your edited {layer.name}…</p><p>This may take a few minutes. Your original image is safe.</p></div>
          <p className="ai-layer-meta"><Clock3 size={12} aria-hidden="true" />Elapsed {formatElapsed(clock.now - clock.start)}</p>
        </div>
        <p className="ai-layer-hint">Sent once and never repeated automatically. If you select another layer, come back to it to collect the result.</p>
      </>;
      case 'processing': case 'preview-failed': case 'compare': case 'applying': {
        const applying = phase === 'applying', ready = phase === 'compare' || applying;
        const choice = (value: 'before' | 'after', label: string, alt: string, src: string) => <button type="button" className="ai-layer-choice" aria-label={label} aria-pressed={activeMode === value}
          disabled={applying || (value === 'after' && !ready)} onClick={() => setMode(value)}>
          <span className="ai-layer-choice-head">{label}{activeMode === value && <Check size={14} aria-hidden="true" />}</span>
          <img alt={alt} src={src} />
          <span className="ai-layer-badge" aria-hidden={activeMode !== value}>{activeMode === value ? 'On canvas' : ' '}</span>
        </button>;
        return <>
          <p className="ai-layer-label" id={`${ids}-compare`}>Compare on canvas <span className="ai-layer-free">Free</span></p>
          <div className="ai-layer-comparison" role="group" aria-labelledby={`${ids}-compare`}>
            {choice('before', 'Before — Original', 'Original selected layer', quote!.before)}
            {choice('after', 'After — AI Edited', 'AI edited candidate', `data:image/png;base64,${candidate!.image.base64}`)}
          </div>
          {phase === 'preview-failed'
            ? <div className="ai-layer-card is-error" role="alert"><p className="ai-layer-card-title">The edited image couldn’t be shown</p>
              <p>The AI preview image could not load or failed verification. The original layer is unchanged. Discard this result.</p></div>
            : <p className="ai-layer-hint" role="status">{!ready ? 'Edit received. Preparing the canvas preview…' : activeMode === 'after' ? 'The canvas shows the AI edit. Nothing is saved until you apply it.' : 'The canvas shows the original. Select After to apply the edit.'}</p>}
          <div className="ai-layer-actions">
            <button className="button ai-layer-primary" disabled={!ready || applying || activeMode !== 'after'} aria-busy={applying || phase === 'processing'} onClick={() => void apply()}>
              {applying ? <><Spinner />Applying…</> : phase === 'processing' ? <><Spinner />Preparing preview…</> : <><Check size={14} aria-hidden="true" />Apply Edit</>}
            </button>
            <button className="button" disabled={applying} onClick={() => void discard()}>Discard</button>
          </div>
          {phase !== 'preview-failed' && <button type="button" className="ai-layer-link" disabled={applying} onClick={() => void discard(true)}>Regenerate · new approval</button>}
          <p className="ai-layer-fineprint">Check identity, details and edges before applying — AI can change unintended details. The edited object may be larger; its centre stays in place. {candidate!.costUsd === undefined ? 'Final usage cost unavailable.' : `Reported usage cost: $${candidate!.costUsd.toFixed(3)}.`}</p>
        </>;
      }
      case 'pending': case 'checking-status': {
        const checking = phase === 'checking-status', text = pendingText!;
        return <>
          <div className={`ai-layer-card is-${text.tone}`} role={text.tone === 'error' ? 'alert' : 'status'}>
            <p className="ai-layer-card-title">{text.title}</p><p>{text.body}</p>
            {pending!.detail && <details className="ai-layer-details"><summary>Details</summary><p>{pending!.detail}</p></details>}
          </div>
          <div className="ai-layer-actions">
            {pending!.status !== 'failed' && <button className="button ai-layer-primary" disabled={checking} aria-busy={checking} onClick={() => void recover()}>
              {checking ? <><Spinner />Checking status…</> : 'Check request status'}</button>}
            <button className="button" disabled={checking} onClick={() => void discard()}>Discard</button>
          </div>
        </>;
      }
      case 'stale': {
        const what = request ? describeLayerEditChanges(layerEditChanges(request.snapshot, variant, layer)) : '';
        // A request whose result is not loaded: running, or arrived while the layer differed. Kept until someone discards it.
        const kept = !!pending && !candidate, matchesAgain = kept && !busy && matchesLayerEditSnapshot(pending.snapshot, variant, layer);
        return <>
          <div className="ai-layer-card is-warning" role="alert">
            <p className="ai-layer-card-title">{busy === 'generate' ? 'The layer changed during generation' : 'This edit no longer matches the layer'}</p>
            <p>{candidate || pending ? 'The selected layer changed after this edit was requested, so its result can’t be applied.' : 'The selected layer changed after the cost was checked.'} The original layer is unchanged.</p>
            <p className="ai-layer-meta">{what ? `Changed: ${what}.` : 'The layer was changed and then changed back.'}</p>
            {kept && <p>{matchesAgain ? 'The layer matches this request again. Check its status to collect the result — free, and never generated again.'
              : busy === 'generate' ? 'The request keeps running and its result will be kept, not deleted: undo the change to collect it, or discard it.'
              : 'Its result is kept, not deleted: undo the change to collect it, or discard it.'}</p>}
          </div>
          <div className="ai-layer-actions">
            {matchesAgain && <button className="button ai-layer-primary" onClick={recheck}>Check request status</button>}
            <button className="button" onClick={() => void discard()}>{candidate || pending ? 'Discard' : 'Start again'}</button>
          </div>
        </>;
      }
      case 'discarding': return <button className="button ai-layer-primary" disabled aria-busy="true"><Spinner />Discarding…</button>;
      default: return null;
    }
  };

  return <section className="ai-layer-edit" aria-label="AI Edit Layer">
    <h3><Sparkles size={15} aria-hidden="true" />AI Edit Layer</h3>
    <div className="ai-layer-target"><LayerThumbnail layer={layer} /><p>Editing: <strong>{layer.name}</strong></p></div>
    {phase === 'unavailable' ? <p className="ai-layer-hint">{eligibility.reason}</p> : <>
      <label className="ai-layer-label" htmlFor={`${ids}-prompt`}>Describe the change</label>
      <textarea id={`${ids}-prompt`} aria-label="Layer edit prompt" aria-describedby={`${ids}-count`} rows={3} maxLength={LAYER_EDIT_LIMITS.prompt} value={prompt}
        disabled={phase !== 'ready' && phase !== 'approval'} placeholder="For example: open both doors, make it red, raise the left arm…"
        onChange={e => { setPrompt(e.target.value); setApproved(false); setFeedback(undefined); }} />
      <p className="ai-layer-count" id={`${ids}-count`}>{prompt.trim().length}/{LAYER_EDIT_LIMITS.prompt}</p>
      {body()}
      {feedback && phase !== 'stale' && <Note feedback={feedback} />}
    </>}
  </section>;
}
