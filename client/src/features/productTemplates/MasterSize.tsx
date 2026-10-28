/**
 * Creating a master template, the Size step: the master in a common ratio before it is saved in it. The original is saved
 * first (it stays a version of its own and is never changed); the chosen size is composed from it by the same engine as
 * Create Offer Creative — free by the rules on this computer, or by an approved AI composition — previewed with its
 * checks, then saved as the master (a new version, every text, logo, product and character its own editable layer).
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Sparkles } from 'lucide-react';
import { REUSE_ASPECT_LABELS, type OfferAspectRatio, type ReuseDraft } from '@frameflow/shared';
import { Alert } from '../templateStudio/ui';
import { productApi, productFileUrl, type ProductView, type ReuseStudioView } from './api';
import { PreSaveChecks, SizePicker } from './SizeControls';

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function MasterSize({ view, ratio, onRatio, onSaved, onKeepOriginal }: {
  view: ProductView; ratio: OfferAspectRatio; onRatio: (r: OfferAspectRatio) => void; onSaved: (v: ProductView) => void; onKeepOriginal: () => void;
}) {
  const id = view.template.id, original = view.template.source, label = REUSE_ASPECT_LABELS[ratio];
  const [draft, setDraft] = useState<ReuseDraft>(), [studio, setStudio] = useState<ReuseStudioView>(), [source, setSource] = useState<number>();
  const [busy, setBusy] = useState<'' | 'preview' | 'ai' | 'save'>('preview'), [error, setError] = useState(''), [askAi, setAskAi] = useState(false);
  // (Shown again for another size: the parent keys this step by its ratio, so each size starts composing at once.)
  useEffect(() => {
    let live = true;
    productApi.masterSize(id, ratio).then(r => { if (live) { setDraft(r.draft); setStudio(r.view); setSource(r.sourceRevision); setBusy(''); } })
      .catch(e => { if (live) { setError(message(e, 'The master could not be composed in this size.')); setBusy(''); } });
    return () => { live = false; };
  }, [id, ratio]);
  const output = draft?.outputs[ratio], fresh = !!output && output.draftRevision === draft?.revision, composer = studio?.composition;
  const ai = output?.composition?.source === 'ai', ext = output?.background.extension;
  const aiCost = composer && !composer.offline ? Math.round((composer.planCostUsd + (composer.extend ? composer.extendCostUsd : 0)) * 100) / 100 : 0;
  const designWithAi = async () => {
    if (!draft) return;
    setAskAi(false); setBusy('ai'); setError('');
    try { await productApi.reuseCompose(id, draft.id, { ratios: [ratio], approveUsd: aiCost }); setDraft(await productApi.reuseGenerate(id, draft.id)); }
    catch (e) { setError(`AI composition did not complete: ${message(e, 'no answer was received')}. The size stays composed on this computer; nothing was retried.`); }
    finally { setBusy(''); }
  };
  const save = async () => {
    if (!draft) return;
    setBusy('save'); setError('');
    try { onSaved(await productApi.saveMasterSize(id, { draftId: draft.id, ratio, expectedRevision: view.template.revision })); }
    catch (e) { setError(message(e, 'The master could not be saved in this size.')); setBusy(''); }
  };
  return <section className="ts-card prt-master-size" aria-label="Master template size"><div className="ts-card-body prt-size-grid">
    <figure className="prt-size-preview">
      {busy === 'preview' || !output ? <p role="status" className="prt-waiting">Composing the {label} master from your original…</p>
        : <img src={productFileUrl(id, output.preview)} alt={`The master template in ${label}`} />}
      {output && <figcaption>{label} · {output.canvas.width} × {output.canvas.height} px</figcaption>}
    </figure>
    <div className="prt-size-side">
      <h3>Size of the master template</h3>
      <SizePicker value={ratio} original={original} disabled={!!busy} onChange={r => (r === 'original' ? onKeepOriginal() : onRatio(r as OfferAspectRatio))} />
      <p className="ot-muted">Your original ({original.width} × {original.height}) is saved as version {source ?? '…'} and is never changed. The {label} master is made from it: the artwork placed whole, never stretched; the logos, offer, terms and products moved to suit the shape, each still its own layer.</p>
      {output && <div className="ot-row prt-size-chips">
        <span className={`sr-chip${ai ? ' is-ai' : ''}`}>{ai ? <><Sparkles size={13} aria-hidden="true" />Layout designed by AI (approved)</> : 'Composed automatically on this computer (free) — not an AI design'}</span>
        {ext && ext.percent >= 1 && <span className="sr-chip">{ext.method === 'ai' ? `Background extended by AI · ${ext.percent} %` : `Background continued from the template’s own edges · ${ext.percent} % (an estimate)`}</span>}
      </div>}
      {output && fresh && <PreSaveChecks v={output.validation} />}
      {error && <Alert>{error}</Alert>}
      {output && !ai && (composer?.ai ? (!askAi
        ? <button type="button" className="ws-btn" disabled={!!busy} onClick={() => (aiCost > 0 ? setAskAi(true) : void designWithAi())}><Sparkles size={14} aria-hidden="true" />{busy === 'ai' ? 'Designing with AI…' : 'Design this size with AI…'}</button>
        : <div className="prt-confirm" role="group" aria-label="Confirm the AI composition cost"><p>Spend about <strong>${aiCost.toFixed(2)}</strong>? One layout request ({composer.model}){composer.extend ? ' and at most one background edit, only where the template’s artwork does not reach' : ''}. Your products, logos, QR codes, text, prices and dates are placed exactly as they are — the AI never redraws them. Never retried.</p>
          <div className="ot-row"><button type="button" className="ws-btn ws-btn-primary" onClick={() => void designWithAi()}>Yes, design with AI</button><button type="button" className="ws-btn ws-btn-quiet" onClick={() => setAskAi(false)}>Cancel</button></div></div>)
        : <p className="ot-muted">AI composition is not set up on this server (no OpenAI key): this size is composed automatically on this computer, free.</p>)}
      <div className="ot-row">
        <button type="button" className="ws-btn ws-btn-primary ws-btn-large" disabled={!!busy || !fresh || output?.checks.status === 'failed'} onClick={() => void save()}><Save size={15} aria-hidden="true" />{busy === 'save' ? 'Saving…' : `Save ${label} master template`}</button>
        <button type="button" className="ws-btn ws-btn-quiet" disabled={busy === 'save'} onClick={onKeepOriginal}><ArrowLeft size={14} aria-hidden="true" />Keep the original size only</button>
      </div>
      {output?.checks.status === 'failed' && <p className="ot-muted">This size cannot be saved until the checks above pass: choose another size, or keep the original.</p>}
    </div>
  </div></section>;
}
