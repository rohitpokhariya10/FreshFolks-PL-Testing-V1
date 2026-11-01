import { useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { Sparkles } from 'lucide-react';
import { LAYER_EDIT_LIMITS, type DesignLayer, type DesignVariant, type LayerEditCandidate, type LayerEditEstimate, type LayerEditSource } from '@frameflow/shared';
import { type RootState, selectActiveVariant } from '../../store';
import { layerEditApplied } from '../../store/editorSlice';
import { assets, decodeImage } from '../../lib/assets/runtimeAssets';
import { editableLayer, editedLayerGeometry, layerEditSnapshot } from './layerEdit';
import { imageHash, LayerEditApiError, layerEditApi } from './layerEditApi';
import './layerEdit.css';

type Quote = { estimate: LayerEditEstimate; source: LayerEditSource; snapshot: string; before: string };
const recoveryKey = 'frameflow-layer-edit-pending';
const messageOf = (e: unknown) => e instanceof Error ? e.message : 'The edit could not be completed.';
/** No provider work runs on mount. A quote is free; generation requires its own explicit approval. */
export function LayerEditPanel({ variant, layer }: { variant: DesignVariant; layer: DesignLayer }) {
  const store = useStore<RootState>(), eligibility = editableLayer(variant, layer), snapshot = layerEditSnapshot(variant, layer);
  const [prompt, setPrompt] = useState(''), [quote, setQuote] = useState<Quote>(), [candidate, setCandidate] = useState<LayerEditCandidate>();
  const [approved, setApproved] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string>(() => {
    try { const r = JSON.parse(sessionStorage.getItem(recoveryKey) ?? 'null'); return r?.snapshot === snapshot ? r.id : ''; } catch { return ''; }
  });
  const operation = useRef(pending), working = useRef(false), mounted = useRef(true);
  const current = (expected: string) => {
    const state = store.getState(), v = selectActiveVariant(state), l = v.layers?.find(l => l.id === layer.id);
    return mounted.current && state.ui.selectedElementId === layer.id && !!l && layerEditSnapshot(v, l) === expected;
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (operation.current) void layerEditApi.discard(operation.current).catch(() => undefined); };
  }, []);
  useEffect(() => () => { if (quote?.before) URL.revokeObjectURL(quote.before); }, [quote?.before]);
  const start = (label: string) => { if (working.current) return false; working.current = true; setBusy(label); setError(''); setNotice(''); return true; };
  const finish = () => { working.current = false; if (mounted.current) setBusy(''); };
  const clearOperation = () => { operation.current = ''; setPending(''); try { sessionStorage.removeItem(recoveryKey); } catch { /* A private browser may deny storage. */ } };
  const loadSource = async () => {
    if (!eligibility.target || layer.type !== 'image' || !layer.assetId) throw new Error(eligibility.reason ?? 'Choose an object layer.');
    const asset = await assets.getAsset(layer.assetId);
    if (!asset) throw new Error('The selected image is missing from this browser. Reopen the saved creative.');
    const source: LayerEditSource = { target: eligibility.target, sourceSha256: await imageHash(asset.blob), ...(layer.assetId.startsWith('ai-layer-') ? { sourceCandidateId: layer.assetId.slice(9) } : {}) };
    return { asset, source };
  };
  const estimate = async () => {
    if (!start('Checking the selected image…')) return;
    try {
      const { asset, source } = await loadSource(), result = await layerEditApi.estimate(source);
      if (!current(snapshot)) throw new Error('The selection or design changed. Check the estimate again.');
      setQuote({ estimate: result, source, snapshot, before: URL.createObjectURL(asset.blob) }); setApproved(false);
    } catch (e) { if (mounted.current) setError(messageOf(e)); } finally { finish(); }
  };
  const generate = async () => {
    if (!quote || !approved || !current(quote.snapshot) || !start('Generating one edit… This may take several minutes.')) return;
    setApproved(false);
    const id = crypto.randomUUID();
    // Saving this ID precedes the paid request. Recovery only reads status, never submits a second request.
    try {
      try { sessionStorage.setItem(recoveryKey, JSON.stringify({ id, snapshot: quote.snapshot })); }
      catch { throw new Error('Request recovery storage is unavailable in this browser. No generation was submitted.'); }
      operation.current = id; setPending(id);
      const result = await layerEditApi.generate({ ...quote.source, prompt: prompt.trim(), operationId: id, model: quote.estimate.model, approveUsd: quote.estimate.estimateUsd });
      if (!current(quote.snapshot)) { await layerEditApi.discard(id); throw new Error('The selection or design changed. The result was discarded; no layer was changed.'); }
      setCandidate(result);
    } catch (e) {
      if (mounted.current) {
        const notSent = e instanceof LayerEditApiError && ['INVALID_LAYER_EDIT', 'STALE_REVISION', 'APPROVAL_REQUIRED', 'NOT_CONFIGURED', 'NOT_FOUND', 'BUSY', 'ORIGIN_DENIED'].includes(e.code);
        if (notSent) clearOperation();
        setError(`${messageOf(e)}${operation.current ? ' Check request status before approving another generation.' : ''}`);
      }
    } finally { finish(); }
  };
  const recover = async () => {
    if (!pending || !start('Checking request status…')) return;
    try {
      const expected = quote?.snapshot ?? JSON.parse(sessionStorage.getItem(recoveryKey) ?? 'null')?.snapshot;
      if (!expected || !current(expected)) throw new Error('The design changed since this request. Discard this preview.');
      const status = await layerEditApi.status(pending);
      if (!current(snapshot)) throw new Error('The selection changed.');
      if (status.candidate && ['candidate', 'applied'].includes(status.status)) {
        const { asset, source } = await loadSource();
        if (source.sourceSha256 !== status.candidate.sourceSha256) throw new Error('The source image changed. Discard this preview.');
        setQuote({ estimate: status.candidate, source, snapshot, before: URL.createObjectURL(asset.blob) }); setCandidate(status.candidate);
      } else setNotice(status.message ?? (status.status === 'running' ? 'This request is still running. Check again shortly; it will not be resubmitted.' : `Request ${status.status}. A provider charge may still apply. Discard this request before starting another.`));
    } catch (e) { setError(messageOf(e)); } finally { finish(); }
  };
  const discard = async () => {
    if (!start('Discarding preview…')) return;
    try { if (operation.current) await layerEditApi.discard(operation.current); clearOperation(); setCandidate(undefined); setQuote(undefined); setApproved(false); setNotice('Preview discarded. The layer is unchanged.'); }
    catch (e) { setError(messageOf(e)); } finally { finish(); }
  };
  const apply = async () => {
    if (!candidate || !quote || !current(quote.snapshot) || !start('Saving the edited image in this browser…')) return;
    const assetId = `ai-layer-${candidate.operationId}`;
    let stored = false, applied = false, existed = false;
    try {
      const source = await loadSource();
      if (source.source.sourceSha256 !== quote.source.sourceSha256) throw new Error('The source image changed. Discard this preview.');
      const blob = new Blob([Uint8Array.from(atob(candidate.image.base64), c => c.charCodeAt(0))], { type: 'image/png' });
      const decoded = await decodeImage(blob);
      if (decoded.naturalWidth !== candidate.image.width || decoded.naturalHeight !== candidate.image.height || await imageHash(blob) !== candidate.image.sha256) throw new Error('The candidate image failed verification.');
      existed = await assets.hasAsset(assetId); await assets.putAsset(assetId, blob); stored = true;
      await layerEditApi.apply(candidate.operationId); // Revalidates the saved source revision; no creative mutation or AI request.
      if (!current(quote.snapshot)) throw new Error('The layer or design changed. This preview cannot be applied.');
      store.dispatch(layerEditApplied({ variantId: variant.id, id: layer.id, assetId, expectedRevision: variant.revision, expectedLayer: JSON.stringify(layer), geometry: editedLayerGeometry(layer, candidate.geometry), timestamp: new Date().toISOString() }));
      const next = selectActiveVariant(store.getState()).layers?.find(l => l.id === layer.id);
      applied = next?.type === 'image' && next.assetId === assetId;
      if (!applied) throw new Error('The layer changed or the edited bounds are unsupported. Nothing was applied.');
      clearOperation(); setCandidate(undefined); setQuote(undefined); setNotice('Edit applied. Undo restores the previous image. Save creative to keep a server revision.');
    } catch (e) { if (stored && !applied && !existed) await assets.deleteAsset(assetId).catch(() => undefined); if (mounted.current) setError(messageOf(e)); }
    finally { finish(); }
  };
  const stale = !!quote && quote.snapshot !== snapshot, validPrompt = prompt.trim().length > 0 && prompt.trim().length <= LAYER_EDIT_LIMITS.prompt;
  return <section className="ai-layer-edit" aria-label="AI Edit Layer">
    <h3><Sparkles size={15} aria-hidden="true" />AI Edit Layer</h3>
    <p className="ai-layer-name">Editing: <strong>{layer.name}</strong></p>
    {eligibility.reason ? <p className="inspector-hint">{eligibility.reason}</p> : <>
      <label className="layer-field">Describe the change<textarea aria-label="Layer edit prompt" rows={3} maxLength={LAYER_EDIT_LIMITS.prompt} value={prompt} disabled={!!busy || !!candidate || !!pending}
        placeholder="Describe a change to this object’s pose, colour or appearance…" onChange={e => { setPrompt(e.target.value); setApproved(false); }} /></label>
      {!quote && !pending && <><p className="inspector-hint">Review the estimated cost before generating. Only this object is sent as the reference.</p><button className="button" disabled={!validPrompt || !!busy} onClick={() => void estimate()}>Generate Edit</button></>}
      {quote && !candidate && !pending && !stale && <div className="ai-layer-approval">
        <p><strong>{quote.estimate.model || 'Image model unavailable'}</strong><br />1024 × 1024 · High quality · {quote.estimate.offline ? 'Offline test provider' : `Estimated $${quote.estimate.estimateUsd.toFixed(2)} USD per edit`}</p>
        {quote.estimate.reason ? <p role="alert">{quote.estimate.reason}</p> : <>
          <p>Final cost depends on token usage. A failed or rejected result may still be charged. Apply and Discard are free.</p>
          <label><input type="checkbox" checked={approved} disabled={!!busy} onChange={e => setApproved(e.target.checked)} />I approve one {quote.estimate.offline ? 'offline test' : 'paid'} generation at this estimate.</label>
          <button className="button primary" disabled={!approved || !validPrompt || !!busy} onClick={() => void generate()}>Approve and generate</button>
        </>}
      </div>}
      {busy && <p role="status" aria-live="polite">{busy}</p>}
      {stale && <p className="field-error" role="alert">The design changed after this preview was requested. Discard it and start again.</p>}
      {candidate && quote && <>
        <div className="ai-layer-comparison"><figure><figcaption>Before</figcaption><img alt="Original selected layer" src={quote.before} /></figure><figure><figcaption>After · Preview</figcaption><img alt="AI edited candidate" src={`data:image/png;base64,${candidate.image.base64}`} /></figure></div>
        <p className="inspector-hint">Review identity, details and edges. AI can change unintended details. Bounds may expand; the visible centre stays anchored. Adjust placement after Apply.</p>
        <p className="inspector-hint">{candidate.costUsd === undefined ? 'Final usage cost unavailable.' : `Reported usage cost: $${candidate.costUsd.toFixed(3)} USD.`}</p>
        <button className="button primary" disabled={!!busy || stale} onClick={() => void apply()}>Apply edit</button>
        <button className="button" disabled={!!busy} onClick={() => void discard()}>Regenerate · new approval</button>
      </>}
      {pending && !candidate && !busy && <button className="button" onClick={() => void recover()}>Check request status</button>}
      {(quote || pending) && <button className="button" disabled={!!busy} onClick={() => void discard()}>Discard</button>}
    </>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
