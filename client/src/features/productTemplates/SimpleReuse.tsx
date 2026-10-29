/**
 * Create Your Offer Creative: the simple Reuse Template flow for anyone (steps 2–4 of Create Offer Creative; the
 * template was chosen before).
 *
 *   Upload products   one or many photos at once (drag and drop or the button); all of the template's own products are
 *                     left out of the new creative (the template is never changed); include, rename, replace, remove,
 *                     make one the main product
 *   Generate          one cost dialog when AI costs money (or arranged automatically, free); each progress line is a
 *                     real request. In a common ratio the dialog first offers the whole creative regenerated for the size
 *                     by the image model (the chosen size's own AI creative; its result shown first, beside the basic
 *                     layout); the basic layout is free and not AI image regeneration
 *   Review and save   the poster large (full screen, compared with the template); Save Creative first; Customize
 *                     Manually (the detailed studio, same draft), Regenerate Layout; then Edit Individual Elements
 *                     (Decompose & Edit) for editing every element in the editor
 *
 * Every change is saved in the draft as it is made: a reload continues where the person left off. The size chosen with
 * the template (step 1) is the draft's from the start — a draft continued from before takes it — and stays changeable.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Columns2, ImagePlus, LayoutGrid, Maximize2, Pencil, RefreshCw, Save, Sparkles, Star, Trash2, UploadCloud, X } from 'lucide-react';
import { isOfferAspectRatio, REUSE_ASPECT_LABELS, REUSE_OFFERED_RATIOS, type OfferAspectRatio, type ReuseAspectRatio, type ReuseDraft } from '@frameflow/shared';
import { productApi, productFileUrl, type ProductView, type ReuseDraftChange, type ReuseStudioView } from './api';
import { RegeneratedResult } from './RegeneratedResult';
import { CreativeSteps, formatName, rememberSize } from './TemplateGallery';
import { EditYourCreative } from './MakeEditable';
import { PreSaveChecks, SizePicker } from './SizeControls';

const KIND_CHOICES = ['washing machine', 'refrigerator', 'television', 'dishwasher', 'microwave oven', 'air conditioner', 'coffee machine', 'cooker', 'air fryer', 'water purifier', 'mixer grinder', 'speaker', 'smart speaker', 'soundbar', 'phone', 'computer', 'tablet', 'headphones', 'kettle', 'vacuum cleaner', 'fan'];
const FRIENDLY: Record<string, string> = {
  SOURCE_NOT_READY: 'This template needs a quick background repair before its products can be replaced.',
  UNSUPPORTED_IMAGE: 'We couldn’t read this image. Please use a PNG, JPG or WebP photo.',
  INVALID_UPLOAD: 'We couldn’t read this image. Please use a PNG, JPG or WebP photo.',
  UPLOAD_TOO_LARGE: 'This image is too large. Please use a photo under 25 MB.',
  NOT_READY: 'We couldn’t place one of your products cleanly. Try another photo, or adjust it with Customize Manually.',
  NOT_CONFIGURED: 'AI arranging isn’t available right now, so your products were arranged automatically.',
  APPROVAL_REQUIRED: 'Please approve the AI cost first, or choose Arrange Automatically (Free).',
  PLACEMENT_PLAN_INVALID: 'We couldn’t find a suitable arrangement. Try generating another layout.',
  STALE_REVISION: 'Your creative was changed in another tab. We loaded the latest version.',
  TOO_MANY: 'That’s the most products one creative can hold.',
  NOT_FOUND: 'We couldn’t find that item any more. Please reload the page.',
  BUSY: 'FrameFlow is still working on your creative. Please wait a moment and try again.',
  HTTP_ERROR: 'We couldn’t reach FrameFlow. Check your connection and try again.',
};
const friendly = (e: unknown) => ({ message: FRIENDLY[(e as { code?: string })?.code ?? ''] ?? 'Something went wrong. Please try again.', detail: e instanceof Error ? e.message : String(e) });
type Pending = { key: string; name: string; url: string; file: File; error?: string };
type Step = 'upload' | 'generating' | 'result';

export function SimpleReuse({ templateId, initialRatio, onBack, onEdit, onAllDrafts, onOpenRunInEditor, onOpenTemplate }: {
  templateId: string; initialRatio?: ReuseAspectRatio; onBack: () => void; onEdit: (draftId: string) => void; onAllDrafts: () => void;
  onOpenRunInEditor: (runId: string) => Promise<void>; onOpenTemplate: (id: string) => void;
}) {
  const [template, setTemplate] = useState<ProductView>(), [view, setView] = useState<ReuseStudioView>(), [draft, setDraft] = useState<ReuseDraft>();
  const [pending, setPending] = useState<Pending[]>([]), [step, setStep] = useState<Step>('upload'), [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ stages: string[]; at: number }>({ stages: [], at: 0 });
  const [error, setError] = useState<{ message: string; detail?: string }>(), [note, setNote] = useState(''), [askAi, setAskAi] = useState<'generate' | 'regenerate' | 'compose'>(), [regenMenu, setRegenMenu] = useState(false);
  const [ratio, setRatio] = useState<ReuseAspectRatio>(initialRatio ?? 'original'), [dragOver, setDragOver] = useState(false);
  const [full, setFull] = useState(false), [compare, setCompare] = useState(false), [removing, setRemoving] = useState<string>();
  const draftRef = useRef<ReuseDraft | undefined>(undefined), input = useRef<HTMLInputElement>(null);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  // Escape closes the cost dialog, the full-screen preview and the layout menu.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; setAskAi(undefined); setFull(false); setRegenMenu(false); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const show = useCallback((v: ReuseStudioView) => {
    setView(v); setDraft(v.draft); draftRef.current = v.draft;
    const first = v.draft.ratios[0]; setRatio(first);
    // A creative made before (even if changed since, e.g. in Customize Manually) opens on its review; else the uploads.
    setStep(v.draft.outputs[first] ? 'result' : 'upload');
    return v;
  }, []);
  const load = useCallback(async (did: string) => show(await productApi.reuseDraft(templateId, did)), [templateId, show]);
  // Continue the latest simple draft of the template's current revision (a reload loses nothing), or wait for the first
  // upload to start one. A draft of an older revision stays under All creatives (continued here, a master repaired since
  // would still show the old revision's problems); a draft the person started meanwhile (a first photo) is never replaced.
  useEffect(() => {
    let live = true;
    void Promise.all([productApi.get(templateId), productApi.reuseDrafts(templateId)]).then(async ([t, r]) => {
      setTemplate(t);
      const current = t.product.revisions.at(-1)?.revision, d = r.drafts.find(x => x.simple && (current === undefined || x.templateRevision === current));
      if (!d || draftRef.current) return;
      const fetched = await productApi.reuseDraft(templateId, d.id);
      if (!live || draftRef.current) return;
      const v = show(fetched);
      // The size chosen with the template wins over the one this draft had before (kept in the draft from now on).
      if (!live || !initialRatio || (v.draft.ratios.length === 1 && v.draft.ratios[0] === initialRatio)) return;
      const next = await productApi.updateReuseDraft(templateId, v.draft.id, { ratios: [initialRatio], expectedRevision: v.draft.revision });
      setDraft(next); draftRef.current = next; setRatio(initialRatio);
      if (!next.outputs[initialRatio]) { setStep('upload'); return; }
      // Made in this size before: drawn again with every change kept (free, no AI request).
      setStep('result'); setDraft(await productApi.reuseGenerate(templateId, next.id).then(g => { draftRef.current = g; return g; }));
    }).catch(e => setError(friendly(e)));
    return () => { live = false; };
  }, [templateId, show, initialRatio]);
  /** The draft, made on first use (its template products left out). */
  const ensure = async () => {
    if (draftRef.current) return draftRef.current;
    // The size chosen before the first photo is part of the draft from the start.
    const d = await productApi.createReuseDraft(templateId, { simple: true, name: `${template?.template.name ?? 'Creative'} · new products`, ratios: [ratio] });
    const v = await load(d.id); return v.draft;
  };
  /** A change saved to the draft (shown at once). */
  const change = async (patch: Omit<ReuseDraftChange, 'expectedRevision'>, optimistic?: (d: ReuseDraft) => ReuseDraft) => {
    const d = draftRef.current; if (!d) return;
    if (optimistic) setDraft(optimistic(d));
    setSaving(true); setError(undefined);
    try { const next = await productApi.updateReuseDraft(templateId, d.id, { ...patch, expectedRevision: d.revision }); setDraft(next); draftRef.current = next; return next; }
    catch (e) { setError(friendly(e)); await load(d.id).catch(() => undefined); return undefined; }
    finally { setSaving(false); }
  };
  const addFiles = async (files: File[]) => {
    const images = files.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name));
    if (!images.length) { setError({ message: 'Please choose product photos (PNG, JPG or WebP).' }); return; }
    const items = images.map(file => ({ key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, name: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '), url: URL.createObjectURL(file), file }));
    setPending(p => [...p, ...items]); setError(undefined); setStep('upload');
    for (const item of items) {
      try {
        const d = await ensure();
        setSaving(true);
        const r = await productApi.reuseUpload(templateId, d.id, item.file, { kind: 'product', label: item.name, expectedRevision: (draftRef.current ?? d).revision }, item.file.name);
        setDraft(r.draft); draftRef.current = r.draft;
        setPending(p => p.filter(x => x.key !== item.key)); URL.revokeObjectURL(item.url);
      } catch (e) { setPending(p => p.map(x => (x.key === item.key ? { ...x, error: friendly(e).message } : x))); }
      finally { setSaving(false); }
    }
  };
  /** Another photo for one product (its name, main-product choice and place in the list are kept). */
  const replace = async (id: string, file?: File) => {
    const d = draftRef.current, item = d?.items.find(i => i.id === id); if (!d || !item || !file) return;
    setSaving(true); setError(undefined);
    try { const r = await productApi.reuseUpload(templateId, d.id, file, { kind: 'product', target: id, label: item.label, expectedRevision: d.revision }, file.name); setDraft(r.draft); draftRef.current = r.draft; }
    catch (e) { setError(friendly(e)); }
    finally { setSaving(false); }
  };
  const products = (draft?.items ?? []).filter(i => i.kind === 'product' && !i.objectId && !i.removed).sort((a, b) => a.order - b.order);
  const chosen = products.filter(i => i.included), hero = draft?.placement.hero ?? null;
  const output = draft?.outputs[ratio], fresh = !!output && output.draftRevision === draft?.revision;
  const plan = draft?.ai.plans[ratio], aiUsed = output?.placement === 'ai' && !!plan && !plan.notes.some(n => n.startsWith('Some AI positions'));
  const ai = view?.placement, composer = view?.composition;
  // A common-ratio size not yet composed with AI: its layout and background can be (one approval with the arranging).
  const composeRatios = (draft?.ratios ?? [ratio]).filter(r => isOfferAspectRatio(r) && !draft?.compose?.[r as keyof NonNullable<ReuseDraft['compose']>]);
  const composeCost = composer?.ai && !composer.offline ? Math.round(composeRatios.length * (composer.planCostUsd + (composer.extend ? composer.extendCostUsd : 0)) * 100) / 100 : 0;
  const blocked = (view?.sourceIssues.length ?? 0) > 0;
  /**
   * Generate: each progress line is shown while its real request runs. `compose`: the size's layout and background by AI
   * first. `regenerate`: then the whole creative regenerated for the size by the image model (the approved request).
   */
  const run = async (useAi: boolean, nextVariant?: number, compose = false, regenerate = false) => {
    const d = draftRef.current; if (!d) return;
    const stages = [...(compose ? [`Designing the ${REUSE_ASPECT_LABELS[ratio]} layout`] : []), ...(useAi ? ['Preparing your products', 'Planning the best arrangement', 'Creating your offer creative'] : ['Preparing your products', 'Arranging and creating your offer creative']),
      ...(regenerate ? [`Regenerating your whole creative for ${REUSE_ASPECT_LABELS[ratio]} with AI (about a minute)`] : [])];
    setAskAi(undefined); setRegenMenu(false); setError(undefined); setNote(''); setStep('generating'); setProgress({ stages, at: 0 });
    try {
      let current = await change({ placement: { mode: 'geometry', ...(nextVariant !== undefined ? { variant: nextVariant } : {}) } });
      if (!current) throw new Error('Could not prepare the draft.');
      if (compose && composeRatios.length) {
        try { current = await productApi.reuseCompose(templateId, current.id, { ratios: composeRatios, approveUsd: composeCost }); setDraft(current); draftRef.current = current; }
        catch (e) { setNote(friendly(e).message === FRIENDLY.NOT_CONFIGURED ? 'AI composition isn’t available right now, so this size was composed automatically.' : 'AI couldn’t compose this size this time, so it was composed automatically. Nothing was retried.'); }
        setProgress({ stages, at: 1 });
      }
      setProgress({ stages, at: compose ? 2 : 1 });
      if (useAi) {
        try { current = await productApi.reusePlaceWithAi(templateId, current.id, { approveUsd: aiCost }); setDraft(current); draftRef.current = current; }
        catch (e) { setNote(`${friendly(e).message === FRIENDLY.NOT_CONFIGURED ? FRIENDLY.NOT_CONFIGURED : 'AI couldn’t arrange your products this time, so they were arranged automatically.'}`); }
        if (current.ai.failures.length && current.placement.mode !== 'ai') setNote('AI couldn’t arrange your products this time, so they were arranged automatically. Nothing was retried or charged again.');
        setProgress({ stages, at: compose ? 3 : 2 });
      }
      let done = await productApi.reuseGenerate(templateId, current.id);
      setDraft(done); draftRef.current = done; setRatio(r => (done.ratios.includes(r) ? r : done.ratios[0]));
      if (regenerate && isOfferAspectRatio(ratio)) {
        setProgress({ stages, at: stages.length - 1 });
        try { done = await productApi.reuseRegenerateImage(templateId, done.id, { ratio, approveUsd: regenCost }); setDraft(done); draftRef.current = done; }
        catch (e) { setNote(`AI regeneration did not complete (${e instanceof Error ? e.message : 'no answer was received'}). Nothing was retried. The basic layout (free, not AI) is shown.`); }
      }
      setProgress({ stages, at: stages.length }); setStep('result');
    } catch (e) { setError(friendly(e)); setStep('upload'); }
  };
  // Products that fit in the template's own product places stand in them (its own format): no arrangement to plan, so
  // no AI request.
  // (A common ratio moves the template's artwork as one, so its product places move with it.)
  // (Once made, the creative says itself: products leaving part of the template's display empty are arranged anew.)
  const anchored = output ? output.placement === 'original' : chosen.length > 0 && chosen.length <= (ai?.slots ?? 0) && !!draft?.ratios.every(r => r === 'original' || isOfferAspectRatio(r));
  const placeAi = !anchored && !!ai?.ai, composeAi = !!composer?.ai && composeRatios.length > 0;
  const aiCost = Math.round(((placeAi && ai && !ai.offline ? (draft?.ratios.length ?? 1) * ai.costUsd : 0) + (composeAi ? composeCost : 0)) * 100) / 100;
  // The whole creative regenerated for a common ratio by the image model: offered first whenever the server can.
  const regenInfo = view?.regeneration, regenOffer = isOfferAspectRatio(ratio) && !!regenInfo?.available, regenCost = regenOffer ? regenInfo!.estimates[ratio as OfferAspectRatio] ?? 0 : 0;
  const regenFresh = isOfferAspectRatio(ratio) && !!draft?.regenImages?.[ratio] && draft.regenImages[ratio]!.draftRevision === draft.revision;
  const generate = () => { if (regenOffer) setAskAi('generate'); else if (!placeAi && !composeAi) void run(false); else if (aiCost > 0) setAskAi('generate'); else void run(placeAi, undefined, composeAi); };
  /** The size, chosen before generating and changeable afterwards (saved with the draft; a new size is composed free at once). */
  const pickSize = async (r: ReuseAspectRatio) => {
    setRatio(r); rememberSize(r);
    if (!draftRef.current) return;
    const next = await change({ ratios: [r] }, d => ({ ...d, ratios: [r] }));
    if (next && step === 'result') await refresh();
  };
  /** The preview drawn again with every change kept (free: nothing is re-arranged, no AI request). */
  const refresh = async () => {
    const d = draftRef.current; if (!d) return;
    const stages = ['Updating your offer creative'];
    setError(undefined); setStep('generating'); setProgress({ stages, at: 0 });
    try { const done = await productApi.reuseGenerate(templateId, d.id); setDraft(done); draftRef.current = done; setProgress({ stages, at: 1 }); setStep('result'); }
    catch (e) { setError(friendly(e)); setStep('result'); }
  };
  /** The current size's layout and background designed by AI (approved), keeping the products' arrangement; then drawn again. */
  const composeNow = async () => {
    const d = draftRef.current; if (!d) return;
    setAskAi(undefined); setError(undefined); setNote(''); setStep('generating'); setProgress({ stages: [`Designing the ${REUSE_ASPECT_LABELS[ratio]} layout`, 'Updating your offer creative'], at: 0 });
    try { const next = await productApi.reuseCompose(templateId, d.id, { ratios: [ratio], approveUsd: composeCost }); setDraft(next); draftRef.current = next; }
    catch (e) { setNote(friendly(e).message === FRIENDLY.NOT_CONFIGURED ? 'AI composition isn’t available right now; this size stays composed automatically.' : 'AI couldn’t design this size this time; it stays composed automatically. Nothing was retried.'); }
    await refresh();
  };
  const save = async () => {
    const d = draftRef.current; if (!d) return;
    setSaving(true); setError(undefined);
    try { const next = await productApi.reuseSave(templateId, d.id); setDraft(next); draftRef.current = next; return next; }
    catch (e) { setError(friendly(e)); return undefined; }
    finally { setSaving(false); }
  };
  const saved = !!output?.creativeId && output.savedDraftRevision === draft?.revision;
  // A master saved in a common ratio is that size (its own preview); the original upload stays its source.
  const latestMaster = template?.product.revisions.at(-1), masterCanvas = view?.canvas ?? latestMaster?.canvas ?? template?.template.source;
  const masterPreview = template ? productFileUrl(templateId, latestMaster?.preview ?? template.template.source.inputFile) : undefined;
  const formats = view?.formats ?? [];
  const failed = output?.checks.status === 'failed', notes = output?.checks.issues ?? [], aiSkipped = output?.placement === 'ai' && !aiUsed;
  const startOver = () => { setDraft(undefined); draftRef.current = undefined; setView(undefined); setStep('upload'); setNote(''); setPending([]); };
  const cost = `$${aiCost.toFixed(2)}`;
  // The AI-regenerated creative of this size: shown first once made (the basic layout below it), else offered after it.
  const regenPanel = step === 'result' && draft && isOfferAspectRatio(ratio) && view?.regeneration?.available && <RegeneratePanel templateId={templateId} draft={draft} ratio={ratio} view={view} basicUrl={output ? productFileUrl(templateId, output.preview) : undefined}
    onDraft={d => { setDraft(d); draftRef.current = d; }} onOpenTemplate={onOpenTemplate} />;

  return <div className="sr-page">
    <div className="sr-top"><button type="button" className="ws-btn ws-btn-quiet" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />All templates</button>
      <span className="sr-saved" role="status">{saving ? 'Saving…' : draft ? <><Check size={13} aria-hidden="true" />All changes saved</> : ''}</span></div>
    <header className="sr-head"><h2>Create Your Offer Creative</h2>{step === 'upload' && <p>Upload your product photos. AI will arrange them beautifully in your selected template.</p>}</header>
    <CreativeSteps current={step === 'upload' ? 1 : step === 'generating' ? 2 : 3} />
    {blocked && <div className="sr-error" role="alert"><p>This template needs a quick background repair before its products can be replaced.</p><p className="sr-error-sub">Ask your template owner to open it under Offer Templates → Edit master and fix it.</p></div>}
    {error && <div className="sr-error" role="alert"><p>{error.message}</p>{error.detail && error.detail !== error.message && <details><summary>Technical details</summary><p className="ot-small">{error.detail}</p></details>}</div>}
    {note && <p className="sr-note" role="status"><Check size={14} aria-hidden="true" />{note}</p>}

    {step === 'upload' && <div className="sr-layout">
      <section className="sr-main" aria-label="Upload products">
        <div className={`sr-drop${dragOver ? ' is-over' : ''}${products.length || pending.length ? ' is-compact' : ''}`} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); void addFiles([...e.dataTransfer.files]); }}>
          <span className="sr-drop-icon" aria-hidden="true"><UploadCloud size={26} /></span>
          <div className="sr-drop-text"><strong>Drag your product photos here</strong><span>PNG with a transparent background works best. JPG and WebP work too — add as many as you like.</span></div>
          <button type="button" className="ws-btn ws-btn-primary ws-btn-large" onClick={() => input.current?.click()} disabled={blocked}><ImagePlus size={17} aria-hidden="true" />Upload Products</button>
          <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Upload product photos" hidden onChange={e => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        </div>
        {(products.length > 0 || pending.length > 0) && <>
          <div className="sr-row"><h3>Your products <span className="sr-count">{chosen.length} of {products.length} selected</span></h3></div>
          <ul className="sr-products" aria-label="Your products">
            {products.map(p => { const unknown = !!view && !view.knownCategories.includes(p.category);
              return <li key={p.id} className={`sr-product${p.included ? '' : ' is-off'}${hero === p.id ? ' is-hero' : ''}`} aria-label={`Product ${p.label}`}>
                <div className="sr-product-img">
                  <img src={productFileUrl(templateId, p.asset.file)} alt={p.label} />
                  {hero === p.id && <span className="sr-badge"><Star size={12} aria-hidden="true" />Main product</span>}
                  <label className="sr-include"><input type="checkbox" checked={p.included} aria-label={`Use ${p.label}`} onChange={e => void change({ items: [{ id: p.id, included: e.target.checked }] }, d => ({ ...d, items: d.items.map(i => (i.id === p.id ? { ...i, included: e.target.checked } : i)) }))} />{p.included ? 'Included' : 'Not included'}</label>
                </div>
                <input className="sr-name" value={p.label} maxLength={60} aria-label="Product name" onChange={e => setDraft(d => (d ? { ...d, items: d.items.map(i => (i.id === p.id ? { ...i, label: e.target.value } : i)) } : d))} onBlur={e => void change({ items: [{ id: p.id, label: e.target.value }] })} />
                {unknown && <select className="sr-kind" aria-label={`What is ${p.label}?`} value="" onChange={e => void change({ items: [{ id: p.id, category: e.target.value }] })}><option value="">What is it? (helps sizing)</option>{KIND_CHOICES.map(k => <option key={k} value={k}>{k}</option>)}</select>}
                <button type="button" className={`ws-btn sr-star${hero === p.id ? ' is-on' : ''}`} aria-pressed={hero === p.id} onClick={() => void change({ placement: { hero: hero === p.id ? null : p.id } }, d => ({ ...d, placement: { ...d.placement, hero: hero === p.id ? null : p.id } }))}><Star size={14} aria-hidden="true" />{hero === p.id ? 'Main product' : 'Make main product'}</button>
                <div className="sr-product-actions">
                  <label className="ws-btn ws-btn-quiet sr-replace"><RefreshCw size={14} aria-hidden="true" />Replace<input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`Replace ${p.label}`} onChange={e => { void replace(p.id, e.target.files?.[0]); e.target.value = ''; }} /></label>
                  <button type="button" className="ws-btn ws-btn-quiet sr-remove" aria-label={`Remove ${p.label}`} onClick={() => setRemoving(p.id)}><Trash2 size={14} aria-hidden="true" />Remove</button>
                </div>
                {removing === p.id && <div className="sr-confirm-remove" role="group" aria-label={`Remove ${p.label}?`}><span>Remove this product?</span>
                  <button type="button" className="ws-btn sr-danger" onClick={() => { setRemoving(undefined); void change({ items: [{ id: p.id, removed: true }] }, d => ({ ...d, items: d.items.map(i => (i.id === p.id ? { ...i, removed: true, included: false } : i)) })); }}>Remove</button>
                  <button type="button" className="ws-btn ws-btn-quiet" autoFocus onClick={() => setRemoving(undefined)}>Keep</button></div>}
              </li>; })}
            {pending.map(p => <li key={p.key} className={`sr-product ${p.error ? 'is-error' : 'is-uploading'}`} aria-label={`Uploading ${p.name}`}><div className="sr-product-img"><img src={p.url} alt={p.name} /></div><span className="sr-name">{p.name}</span>
              {p.error ? <><p className="sr-err">{p.error}</p><div className="sr-product-actions"><button type="button" className="ws-btn ws-btn-quiet" onClick={() => { setPending(x => x.filter(y => y.key !== p.key)); void addFiles([p.file]); }}>Try again</button><button type="button" className="ws-icon-button" aria-label={`Remove ${p.name}`} onClick={() => setPending(x => x.filter(y => y.key !== p.key))}><X size={15} /></button></div></>
                : <p className="sr-uploading" role="status"><span className="sr-dot-spin" aria-hidden="true" />Uploading…</p>}</li>)}
            <li className="sr-add-tile"><button type="button" onClick={() => input.current?.click()} disabled={blocked}><ImagePlus size={20} aria-hidden="true" />Add more photos</button></li>
          </ul>
          <p className="sr-hint">{hero ? 'Your main product stands in the middle; the others are grouped around it.' : 'AI picks the main product — or choose one with Make main product.'} The template’s own products are left out; Ganesh Ji, the festive design, text and logos stay as they are.</p>
        </>}
      </section>
      <aside className="sr-aside" aria-label="Your template">
        <section className="sr-size-card" aria-label="Choose your size"><h3>Choose your size</h3>
          <p className="sr-hint">Each size is designed for its shape — never stretched — and saved with your creative.</p>
          <SizePicker value={ratio} onChange={r => void pickSize(r)} original={masterCanvas} disabled={saving} />
          {!REUSE_OFFERED_RATIOS.includes(ratio as typeof REUSE_OFFERED_RATIOS[number]) && <p className="sr-hint">This creative uses {REUSE_ASPECT_LABELS[ratio]} (an earlier size). Choose another to change it.</p>}
          {formats.find(f => f.ratio === ratio)?.note && <p className="sr-hint">{formats.find(f => f.ratio === ratio)!.note}</p>}</section>
        {masterPreview && <figure className="sr-template"><img src={masterPreview} alt={`Template ${template?.template.name ?? ''}`} /><figcaption><span>Your template</span><strong>{template?.template.name}</strong></figcaption></figure>}
        <p className="sr-aside-links"><button type="button" className="ws-btn ws-btn-quiet prt-inline" onClick={onBack}>Choose another template</button><br /><button type="button" className="ws-btn ws-btn-quiet prt-inline" onClick={onAllDrafts}>All creatives from this template</button></p>
      </aside>
      {(products.length > 0 || pending.length > 0) && <div className="sr-cta-bar">
        <p><strong>{chosen.length} product{chosen.length === 1 ? '' : 's'}</strong> ready to arrange{pending.some(p => !p.error) ? ' · finishing uploads…' : ''}</p>
        <div className="sr-cta-actions">{fresh && <button type="button" className="ws-btn ws-btn-quiet" onClick={() => setStep('result')}>See your creative</button>}
          <button type="button" className="ws-btn ws-btn-primary ws-btn-large sr-generate" disabled={!chosen.length || pending.some(p => !p.error) || blocked} onClick={generate}><Sparkles size={17} aria-hidden="true" />Generate Creative</button></div>
      </div>}
    </div>}

    {step === 'generating' && <section className="sr-working" aria-label="Generating" aria-busy="true">
      <span className="sr-spinner" aria-hidden="true" />
      <h3>Creating your offer creative</h3>
      <ol className="sr-progress">{progress.stages.map((s, i) => <li key={s} className={i < progress.at ? 'is-done' : i === progress.at ? 'is-current' : ''} aria-current={i === progress.at ? 'step' : undefined}>
        <span aria-hidden="true">{i < progress.at ? <Check size={13} /> : i === progress.at ? <span className="sr-dot-spin" /> : null}</span>{s}{i === progress.at ? '…' : ''}</li>)}</ol>
      <p className="sr-status" role="status">{progress.stages[progress.at] ? `${progress.stages[progress.at]}…` : 'Your creative is ready!'}</p>
      <p className="sr-hint">Your photos and choices are saved. You can keep this page open.</p>
    </section>}

    {regenFresh && regenPanel}
    {step === 'result' && draft && <section className="sr-result" aria-label="Your creative">
      <div className="sr-stage">
        <div className="sr-stage-bar">
          {output && <span className={`sr-chip${aiUsed ? ' is-ai' : ''}`}>{aiUsed ? <><Sparkles size={13} aria-hidden="true" />Products arranged by AI</> : 'Products arranged automatically'}</span>}
          {output?.composition && <span className={`sr-chip${output.composition.source === 'ai' ? ' is-ai' : ''}`} title={output.composition.layout}>{output.composition.source === 'ai' ? <><Sparkles size={13} aria-hidden="true" />Layout designed by AI</> : 'Layout composed automatically (free, not AI)'}</span>}
          {output?.background.extension && output.background.extension.percent >= 1 && <span className="sr-chip" title={output.background.note}>{output.background.extension.method === 'ai' ? `Background extended by AI · ${output.background.extension.percent} %` : `Background continued · ${output.background.extension.percent} %`}</span>}
          {draft.ratios.length > 1 && <div className="sr-tabs" role="tablist" aria-label="Sizes">{draft.ratios.map(r => <button key={r} type="button" role="tab" aria-selected={ratio === r} onClick={() => setRatio(r)}>{formats.find(f => f.ratio === r)?.label ?? r}</button>)}</div>}
          <span className="sr-spacer" />
          {masterPreview && output && <button type="button" className="ws-btn ws-btn-quiet" aria-pressed={compare} onClick={() => setCompare(v => !v)}><Columns2 size={15} aria-hidden="true" />{compare ? 'Hide template' : 'Compare with template'}</button>}
          {output && <button type="button" className="ws-btn ws-btn-quiet" onClick={() => setFull(true)}><Maximize2 size={15} aria-hidden="true" />Full screen</button>}
        </div>
        {output && !fresh && <div className="sr-banner" role="status"><p>You changed your creative since this preview was made.</p><button type="button" className="ws-btn ws-btn-primary" onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true" />Update preview</button></div>}
        {output ? <div className={`sr-posters${compare ? ' is-compare' : ''}`}>
          {compare && masterPreview && <figure className="sr-poster"><img src={masterPreview} alt="The original template" /><figcaption>Original template</figcaption></figure>}
          <figure className="sr-poster"><img src={productFileUrl(templateId, output.preview)} alt="Your finished creative" />{compare && <figcaption>Your creative</figcaption>}</figure>
        </div> : <p className="sr-hint">Generate this size to see it.</p>}
      </div>
      <aside className="sr-panel">
        <h3>{failed ? 'Almost there' : regenFresh ? 'Basic layout (free, not AI)' : 'Your creative is ready!'}</h3>
        <label className="sr-size-row"><span>Size</span><select aria-label="Creative size" value={ratio} disabled={saving} onChange={e => void pickSize(e.target.value as ReuseAspectRatio)}>
          {[...REUSE_OFFERED_RATIOS, ...(REUSE_OFFERED_RATIOS.includes(ratio as typeof REUSE_OFFERED_RATIOS[number]) ? [] : [ratio])].map(r => <option key={r} value={r}>{r === 'original' && masterCanvas ? `Original · ${formatName(masterCanvas.width, masterCanvas.height)}` : REUSE_ASPECT_LABELS[r]}</option>)}</select></label>
        {output?.composition?.source === 'rules' && composer?.ai && isOfferAspectRatio(ratio) && <button type="button" className="ws-btn" onClick={() => (composeCost > 0 ? setAskAi('compose') : void run(false, undefined, true))}><Sparkles size={15} aria-hidden="true" />Design this size with AI</button>}
        {output && fresh && <PreSaveChecks v={output.validation} />}
        <p className="sr-panel-lead">{failed ? FRIENDLY.NOT_READY : saved ? 'It’s saved to your creatives — you can use it as it is.' : 'Take a look. Save it when you’re happy, or adjust it first.'}</p>
        <button type="button" className={`ws-btn ws-btn-large sr-save${saved ? ' is-saved' : ' ws-btn-primary'}`} disabled={saving || saved || !fresh || failed} onClick={() => void save()}>{saved ? <><Check size={17} aria-hidden="true" />Saved</> : <><Save size={17} aria-hidden="true" />{saving ? 'Saving…' : 'Save Creative'}</>}</button>
        {!saved && !failed && <p className="sr-hint sr-center">After saving, you can turn it into editable layers.</p>}
        <p className="sr-group-label">Quick changes</p>
        <div className="sr-two">
          <button type="button" className="ws-btn" onClick={() => onEdit(draft.id)}><Pencil size={15} aria-hidden="true" />Customize Manually</button>
          <div className="sr-regen"><button type="button" className="ws-btn" aria-expanded={regenMenu} aria-haspopup="menu" disabled={anchored} title={anchored ? 'Your products stand in the template’s own product places, so there is no other layout to try.' : undefined} onClick={() => setRegenMenu(v => !v)}><RefreshCw size={15} aria-hidden="true" />Regenerate Layout</button>
            {regenMenu && <div className="sr-menu" role="menu"><button type="button" role="menuitem" onClick={() => void run(false, (draft.placement.variant ?? 0) + 1)}><LayoutGrid size={15} aria-hidden="true" /><span><strong>Try another layout</strong><small>Free · arranged automatically</small></span></button>
              {ai?.ai && <button type="button" role="menuitem" onClick={() => (aiCost > 0 ? setAskAi('regenerate') : void run(true))}><Sparkles size={15} aria-hidden="true" /><span><strong>Ask AI for a new arrangement</strong><small>{aiCost > 0 ? `About ${cost} · you’ll confirm first` : 'Free'}</small></span></button>}</div>}</div>
        </div>
        {saved && output && fresh && <EditYourCreative templateId={templateId} draftId={draft.id} ratio={ratio} output={output} onOpenRunInEditor={onOpenRunInEditor} onOpenTemplate={onOpenTemplate} />}
        {(notes.length > 0 || aiSkipped) && <details className="sr-more"><summary>Notes on this creative ({notes.length + (aiSkipped ? 1 : 0)})</summary><ul>
          {aiSkipped && <li>AI’s suggested layout didn’t pass our quality checks, so FrameFlow arranged your products itself. You weren’t charged again.</li>}
          {notes.map((i, k) => <li key={k} className={i.blocking ? 'is-blocking' : ''}>{i.message}</li>)}</ul></details>}
        <p className="sr-links"><button type="button" className="ws-btn ws-btn-quiet prt-inline" onClick={() => setStep('upload')}>Change products</button> · <button type="button" className="ws-btn ws-btn-quiet prt-inline" onClick={onAllDrafts}>All creatives from this template</button> · <button type="button" className="ws-btn ws-btn-quiet prt-inline" onClick={startOver}>Start over</button></p>
      </aside>
    </section>}
    {!regenFresh && regenPanel}

    {askAi && <div className="sr-modal-backdrop" onClick={() => setAskAi(undefined)}>
      <div className="sr-modal" role="dialog" aria-modal="true" aria-labelledby="sr-cost-title" onClick={e => e.stopPropagation()}>
        <span className="sr-modal-icon" aria-hidden="true"><Sparkles size={22} /></span>
        <h3 id="sr-cost-title">{askAi === 'compose' ? `Design ${REUSE_ASPECT_LABELS[ratio]} with AI` : askAi === 'generate' ? (composeAi || regenOffer ? 'Design Your Creative with AI' : 'Arrange Products with AI') : 'Ask AI for a New Arrangement'}</h3>
        {askAi === 'generate' && regenOffer && <div className="sr-regen-offer" role="group" aria-label={`Regenerate the whole creative for ${REUSE_ASPECT_LABELS[ratio]} with AI`}>
          <p><strong>Regenerate the whole creative for {REUSE_ASPECT_LABELS[ratio]} with AI (recommended)</strong></p>
          <p>The AI image model ({regenInfo!.model}) redesigns your creative for this shape — background, characters, products, offer and logos rearranged the way a designer would for {REUSE_ASPECT_LABELS[ratio]}. Your product photos and the template’s logos are then put back with their own pixels, QR codes are checked to scan to their own link, and you look at it before using it.</p>
          <dl className="sr-cost"><div><dt>AI regeneration</dt><dd><strong>{regenCost > 0 ? `at most about $${regenCost.toFixed(2)}` : 'Free'}</strong> · one request, never retried (the actual cost is recorded)</dd></div></dl>
          <button type="button" className="ws-btn ws-btn-primary ws-btn-large" autoFocus onClick={() => void run(false, undefined, false, true)}><Sparkles size={16} aria-hidden="true" />Approve & Regenerate with AI</button>
          {(placeAi || composeAi) && <p className="sr-hint">Or arrange it without regenerating the picture:</p>}
        </div>}
        {!(askAi === 'generate' && regenOffer && !placeAi && !composeAi) && <p>{askAi === 'regenerate' ? 'AI will analyze your products and create a new professional layout, with your photos reused.' : askAi === 'compose' || composeAi
          ? `AI plans the ${REUSE_ASPECT_LABELS[ratio]} layout from your template — where the artwork, logos, offer and terms go — and continues the background only where the template's own artwork does not reach. Your products, logos, text, prices and dates are placed exactly as they are; the AI never redraws them.`
          : 'AI will analyze your products and create a professional layout.'}</p>}
        {!(askAi === 'generate' && regenOffer && !placeAi && !composeAi) && <dl className="sr-cost">
          {(askAi === 'compose' || (askAi === 'generate' && composeAi)) && <div><dt>Layout & background</dt><dd>{`$${composeCost.toFixed(2)}`} · {composer?.extend ? 'one layout request and at most one background edit per size' : 'one layout request per size'}</dd></div>}
          {(askAi === 'regenerate' || (askAi === 'generate' && placeAi)) && <div><dt>Arranging products</dt><dd>{`$${(ai && !ai.offline ? (draft?.ratios.length ?? 1) * ai.costUsd : 0).toFixed(2)}`} · {draft && draft.ratios.length > 1 ? `${draft.ratios.length} requests (one per size)` : 'one request'}</dd></div>}
          <div><dt>Estimated total</dt><dd><strong>{askAi === 'compose' ? `$${composeCost.toFixed(2)}` : askAi === 'regenerate' ? `$${(ai && !ai.offline ? (draft?.ratios.length ?? 1) * ai.costUsd : 0).toFixed(2)}` : cost}</strong> · paid OpenAI requests, never retried</dd></div>
          <div><dt>You get</dt><dd>A preview to review with its checks. Nothing is saved until you click Save.</dd></div>
        </dl>}
        <div className="sr-modal-actions">
          {!(askAi === 'generate' && regenOffer && !placeAi && !composeAi) && <button type="button" className={`ws-btn ws-btn-large${askAi === 'generate' && regenOffer ? '' : ' ws-btn-primary'}`} autoFocus={!(askAi === 'generate' && regenOffer)} onClick={() => void (askAi === 'compose' ? composeNow() : askAi === 'regenerate' ? run(true) : run(placeAi, undefined, composeAi))}><Sparkles size={16} aria-hidden="true" />{askAi === 'regenerate' ? 'Approve & Regenerate' : 'Approve & Generate'}</button>}
          {askAi === 'generate' && <button type="button" className="ws-btn ws-btn-large" onClick={() => void run(false)}>{regenOffer ? 'Generate Automatically (Free) · basic layout, not AI' : 'Generate Automatically (Free)'}</button>}
          <button type="button" className="ws-btn ws-btn-quiet" onClick={() => setAskAi(undefined)}>Cancel</button>
        </div>
      </div>
    </div>}

    {full && output && <div className="sr-lightbox" role="dialog" aria-modal="true" aria-label="Full-screen preview" onClick={() => setFull(false)}>
      <button type="button" className="sr-lightbox-close" aria-label="Close full-screen preview" autoFocus onClick={() => setFull(false)}><X size={20} /></button>
      <img src={productFileUrl(templateId, output.preview)} alt="Your finished creative, full screen" onClick={e => e.stopPropagation()} />
    </div>}
  </div>;
}

/**
 * Create Offer Creative regenerated by AI in its size (one approved request): the whole creative — the person's products
 * in the template's design — redesigned for the shape by the image model, the products put back with their own pixels
 * and QR codes checked to scan to their own link, shown beside the basic layout for the person to look at; approved, made
 * editable through the creation pipeline (its elements found, reviewed, decomposed, then the editor).
 */
function RegeneratePanel({ templateId, draft, ratio, view, basicUrl, onDraft, onOpenTemplate }: {
  templateId: string; draft: ReuseDraft; ratio: OfferAspectRatio; view: ReuseStudioView; basicUrl?: string; onDraft: (d: ReuseDraft) => void; onOpenTemplate: (id: string) => void;
}) {
  const info = view.regeneration!, label = REUSE_ASPECT_LABELS[ratio], estimate = info.estimates[ratio] ?? 0;
  const g = draft.regenImages?.[ratio], fresh = !!g && g.draftRevision === draft.revision;
  const [busy, setBusy] = useState(''), [ask, setAsk] = useState(false), [approved, setApproved] = useState(false), [useAi, setUseAi] = useState(true), [error, setError] = useState('');
  const regenerate = async () => {
    setAsk(false); setBusy('regenerate'); setError(''); setApproved(false);
    try { onDraft(await productApi.reuseRegenerateImage(templateId, draft.id, { ratio, approveUsd: estimate })); }
    catch (e) { setError(e instanceof Error ? e.message : 'AI regeneration did not complete. Nothing was retried.'); }
    finally { setBusy(''); }
  };
  const editable = async () => {
    setBusy('continue'); setError('');
    try { const r = await productApi.reuseContinueRegenerated(templateId, draft.id, { ratio, approved, useAi }); onOpenTemplate(r.templateId); }
    catch (e) { setError(e instanceof Error ? e.message : 'It could not be made editable.'); setBusy(''); }
  };
  const confirm = ask ? <div className="prt-confirm" role="group" aria-label="Confirm the AI regeneration cost"><p>Spend {estimate > 0 ? <>at most about <strong>${estimate.toFixed(2)}</strong></> : 'nothing'}? One request to {info.model} (high quality, usually much less than the estimate; the actual cost is recorded). Never retried automatically.</p>
    <div className="ot-row"><button type="button" className="ws-btn ws-btn-primary" onClick={() => void regenerate()}><Sparkles size={14} aria-hidden="true" />Yes, regenerate with AI</button><button type="button" className="ws-btn ws-btn-quiet" onClick={() => setAsk(false)}>Cancel</button></div></div> : null;
  return <section className="rg-panel" aria-label="Regenerate with AI">
    <h3><Sparkles size={16} aria-hidden="true" /> {fresh ? `Regenerated by AI for ${label}` : `Regenerate this creative with AI for ${label} (recommended)`}</h3>
    {!fresh ? <>
      <p className="ot-muted">The AI redesigns your whole creative for {label}: your products, the offer text, logos and decorations rearranged for the shape, from your creative in the template’s own size. Your product photos are then put back with their own pixels and QR codes are checked to scan to their own link; you look at it before you use it.</p>
      {g && <p className="ot-muted">You changed your creative since it was last regenerated: regenerate it again to use it.</p>}
      {busy === 'regenerate' ? <p role="status" className="prt-waiting">Regenerating with AI… usually about a minute.</p>
        : confirm ?? <div className="ot-row"><button type="button" className="ws-btn ws-btn-primary" onClick={() => setAsk(true)}><Sparkles size={15} aria-hidden="true" />Regenerate with AI…</button><span className="ot-muted ot-small">{estimate > 0 ? `About $${estimate.toFixed(2)} at most · you’ll confirm first` : 'Free'}</span></div>}
    </> : <RegeneratedResult beforeUrl={basicUrl} beforeLabel="Basic layout (free, not AI)" resultUrl={productFileUrl(templateId, g.file)} result={g} approved={approved} onApproved={setApproved}>
      {!g.checks.blocking.length && <label className="ot-check"><input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} />
        <span>Find the characters and products in it with AI — one OpenAI request, estimated up to about $0.35 — so each becomes a layer of its own.</span></label>}
      {busy === 'regenerate' ? <p role="status" className="prt-waiting">Regenerating with AI… usually about a minute.</p> : <div className="ot-row">
        {!g.checks.blocking.length && <button type="button" className="ws-btn ws-btn-primary ws-btn-large" disabled={!approved || !!busy} onClick={() => void editable()}><Check size={15} aria-hidden="true" />{busy === 'continue' ? 'Starting…' : 'Use it: make it editable (review & decompose)'}</button>}
        {confirm ?? <button type="button" className="ws-btn" disabled={!!busy} onClick={() => setAsk(true)}><RefreshCw size={14} aria-hidden="true" />Regenerate again…</button>}
      </div>}
      {g.templateId && <p className="ot-muted ot-small">Already made editable. <button type="button" className="ws-btn ws-btn-quiet prt-inline" onClick={() => onOpenTemplate(g.templateId!)}>Open it</button></p>}
    </RegeneratedResult>}
    {error && <div className="sr-error" role="alert"><p>{error}</p></div>}
  </section>;
}
