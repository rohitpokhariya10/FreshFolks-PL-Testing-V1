/**
 * Refine Cutout: one object layer (a product, character or decoration) repaired, nothing else touched. First the free
 * clean-up on this computer; if the object is genuinely incomplete, one AI repair after its provider, model, size and
 * estimate are shown and approved. Either result is compared with the current picture and replaces it only when the
 * person approves (a new revision; the previous ones stay). Text and logos are editable overlays, never refined here.
 */
import { useState } from 'react';
import { Check, Sparkles, Wand2, X } from 'lucide-react';
import type { ProductCreative, ProductCreativeObject } from '@frameflow/shared';
import { productApi, productFileUrl, type RefineInfo, type RefineResult } from './api';

export function RefineCutout({ templateId, creativeId, object, onApplied, onClose, onError }: {
  templateId: string; creativeId: string; object: ProductCreativeObject; onApplied: (c: ProductCreative) => void; onClose: () => void; onError: (m: string) => void;
}) {
  const [result, setResult] = useState<RefineResult>(), [info, setInfo] = useState<RefineInfo>(), [ask, setAsk] = useState(false), [busy, setBusy] = useState(''), [looked, setLooked] = useState(false);
  const run = async (key: string, work: () => Promise<void>) => { setBusy(key); onError(''); try { await work(); } catch (e) { onError(e instanceof Error ? e.message : 'That did not work.'); } finally { setBusy(''); } };
  const local = () => run('local', async () => { setResult(await productApi.refineLocal(templateId, creativeId, object.id)); setLooked(false); });
  const askAi = () => run('info', async () => { setInfo(await productApi.refineInfo(templateId, creativeId, object.id)); setAsk(true); });
  const ai = () => run('ai', async () => { setAsk(false); setResult(await productApi.refineWithAi(templateId, creativeId, object.id, info?.estimateUsd ?? 0)); setLooked(false); });
  const apply = () => run('apply', async () => {
    const latest = await productApi.getCreative(templateId, creativeId);
    onApplied(await productApi.applyRefinement(templateId, creativeId, object.id, { expectedRevision: latest.revision, file: result!.file, approved: looked }));
  });
  return <section className="prt-refine" aria-label={`Refine cutout: ${object.label}`}>
    <div className="ot-row"><h4><Wand2 size={14} aria-hidden="true" /> Refine cutout · {object.label}</h4><button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}><X size={15} /></button></div>
    <div className="prt-refine-compare">
      <figure><img src={productFileUrl(templateId, object.asset.file)} alt={`${object.label}, current`} /><figcaption>Current</figcaption></figure>
      {result && <figure><img src={productFileUrl(templateId, result.file)} alt={`${object.label}, refined`} /><figcaption>{result.rejected ? `AI result, rejected (${result.model})` : result.requests ? `Repaired by AI (${result.model})` : 'Cleaned on this computer (free)'}</figcaption></figure>}
    </div>
    {result && !!result.clearedPixels && <p className="ot-small">Removed {result.clearedPixels} pixels of the background past its outline (they stay in the background).</p>}
    {result && !!result.defectPixels && <p className="ot-small">Checked against the original picture: {result.defectPixels} pixels were not the {object.label.toLowerCase()} as it showed there ({[result.hiddenPixels ? `${result.hiddenPixels} hidden behind elements in front of it` : '', result.foreignPixels ? `${result.foreignPixels} of the background’s own decoration, which stays in the background` : '', result.differingPixels ? `${result.differingPixels} different from the picture` : ''].filter(Boolean).join(', ')}). {result.requests ? `Redrawn by the model${result.unrepairedPixels ? `; ${result.unrepairedPixels} it left unrepaired were rebuilt here` : ''}` : 'Rebuilt from its own verified pixels'}; every verified pixel is kept as it was.</p>}
    {result && !result.requests && <p className="ot-muted ot-small">Removed {result.removedPixels} stray pixels, filled {result.filledPixels} pinholes, cleaned {result.defringedPixels} edge pixels. Nothing was sent anywhere.</p>}
    {result?.gate && (result.rejected
      ? <p className="ot-small" role="status"><strong>Rejected automatically:</strong> {result.gate.reasons.join('; ')}. The current cut-out is kept; this result cannot be used.</p>
      : <p className="ot-small" role="status">Checked automatically: only the {result.gate.holePixels} hidden or damaged pixels were redrawn, inside the object’s own outline; every other pixel, its size and its place are exactly as before.</p>)}
    {result && result.requests > 0 && <p className="ot-muted ot-small">One request to {result.model}, {result.size?.width} × {result.size?.height}{result.costUsd !== undefined ? `, $${result.costUsd.toFixed(3)} (from the response’s usage)` : `, estimated at most $${(result.estimateUsd ?? 0).toFixed(2)}`}. Hidden parts are the model’s estimate, not the real product — check them.</p>}
    <div className="ot-row">
      <button type="button" className="ws-btn" disabled={!!busy} onClick={() => void local()}>{busy === 'local' ? 'Cleaning…' : 'Clean up (free)'}</button>
      {!ask && <button type="button" className="ws-btn ws-btn-quiet" disabled={!!busy} onClick={() => void askAi()}><Sparkles size={14} aria-hidden="true" />Complete with AI…</button>}
    </div>
    {ask && info && (info.available ? <div className="prt-confirm" role="group" aria-label="Confirm the AI repair cost">
      <p>Repair only {object.label} with AI? Provider {info.provider}, model {info.model}, {info.size.width} × {info.size.height}, {info.estimateUsd > 0 ? <>at most about <strong>${info.estimateUsd.toFixed(2)}</strong> (an estimate, not a billing cap)</> : 'free (test model)'}. One request, never retried; the rest of the creative is not sent or changed.</p>
      <div className="ot-row"><button type="button" className="ws-btn ws-btn-primary" disabled={!!busy} onClick={() => void ai()}><Sparkles size={14} aria-hidden="true" />{busy === 'ai' ? 'Repairing…' : info.estimateUsd > 0 ? `Yes, spend up to $${info.estimateUsd.toFixed(2)}` : 'Yes, repair it'}</button><button type="button" className="ws-btn ws-btn-quiet" onClick={() => setAsk(false)}>Cancel</button></div>
    </div> : <p className="ot-muted">{info.reason ?? 'AI repair is not available on this server; use the free clean-up.'}</p>)}
    {result && !result.rejected && <div className="prt-confirm" role="group" aria-label="Use the refined picture">
      <label className="ot-check"><input type="checkbox" checked={looked} onChange={e => setLooked(e.target.checked)} /><span>I have compared it with the current picture: this {object.label.toLowerCase()} is right.</span></label>
      <div className="ot-row"><button type="button" className="ws-btn ws-btn-primary" disabled={!looked || !!busy} onClick={() => void apply()}><Check size={14} aria-hidden="true" />{busy === 'apply' ? 'Saving…' : 'Use this picture'}</button>
        <span className="ot-muted ot-small">Only this layer changes; the previous picture stays in the creative’s history.</span></div>
    </div>}
  </section>;
}
