/**
 * Create Offer Creative, step 1: the creative's size, then the saved templates as large cards, one action each (Use This
 * Template). For anyone: no versions, stages, layers or plans — only templates ready to use are shown. Templates made
 * from a creative (Decompose & Edit) follow the masters in their own row. The size goes with the chosen template into
 * the next steps (kept in its draft); this browser remembers the last one chosen.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, Check, LayoutTemplate } from 'lucide-react';
import { REUSE_OFFERED_RATIOS, type ReuseAspectRatio } from '@frameflow/shared';
import { productApi, productFileUrl, type ProductListItem } from './api';
import { SizePicker } from './SizeControls';

const SIZE_KEY = 'frameflow.offerCreative.size';
/** The size last chosen in Create Offer Creative (here, or while making a creative), if one was. */
const rememberedSize = (): ReuseAspectRatio | undefined => { try { const v = localStorage.getItem(SIZE_KEY); return (REUSE_OFFERED_RATIOS as readonly string[]).includes(v ?? '') ? v as ReuseAspectRatio : undefined; } catch { return undefined; } };
export const rememberSize = (r: ReuseAspectRatio) => { try { localStorage.setItem(SIZE_KEY, r); } catch { /* remembered for this visit only */ } };

export const CREATIVE_STEPS = ['Choose Template', 'Upload Products', 'Generate', 'Review & Save'] as const;
/** Where the person is in the four steps of Create Offer Creative. */
export function CreativeSteps({ current }: { current: 0 | 1 | 2 | 3 }) {
  return <ol className="cg-steps" aria-label="Steps">{CREATIVE_STEPS.map((s, i) => <li key={s} className={i === current ? 'is-current' : i < current ? 'is-done' : ''} aria-current={i === current ? 'step' : undefined}>
    <span className="cg-step-dot">{i < current ? <Check size={12} aria-hidden="true" /> : i + 1}</span><span className="cg-step-label">{s}</span></li>)}</ol>;
}

/** A canvas size in words (Square, Portrait 4:5, Landscape 16:9 …). */
export function formatName(width: number, height: number) {
  const r = width / Math.max(1, height), known: [number, string][] = [[1, 'Square'], [4 / 5, 'Portrait 4:5'], [9 / 16, 'Story 9:16'], [16 / 9, 'Landscape 16:9'], [3 / 4, 'Portrait 3:4'], [4 / 3, 'Landscape 4:3']];
  const near = known.find(([k]) => Math.abs(r - k) / k < 0.03);
  return near ? near[1] : r > 1 ? 'Landscape' : 'Portrait';
}

/** `onUse`: the template and the size chosen here (undefined when none was ever chosen: a creative continued keeps its own). */
export function TemplateGallery({ onUse: choose }: { onUse: (id: string, ratio?: ReuseAspectRatio) => void }) {
  const [templates, setTemplates] = useState<ProductListItem[]>(), [error, setError] = useState(''), [chosen, setChosen] = useState<ReuseAspectRatio | undefined>(rememberedSize);
  const size = chosen ?? 'original';
  const chooseSize = (r: ReuseAspectRatio) => { setChosen(r); rememberSize(r); };
  const onUse = (id: string) => choose(id, chosen);
  useEffect(() => { void productApi.list().then(r => setTemplates(r.templates)).catch(() => setError('We couldn’t load your templates. Check your connection and try again.')); }, []);
  const ready = (templates ?? []).filter(t => t.revisions > 0);
  const fromCreative = (t: ProductListItem) => /^variation-/.test(t.source.origin?.kind === 'upload' ? t.source.origin.filename ?? '' : '');
  const masters = ready.filter(t => !fromCreative(t)), mine = ready.filter(fromCreative);
  const card = (t: ProductListItem) => <article key={t.id} className="cg-card" aria-label={`Template ${t.name}`}>
    <button type="button" className="cg-thumb" onClick={() => onUse(t.id)} aria-label={`Use ${t.name}`} tabIndex={-1}>
      <img src={productFileUrl(t.id, t.master?.preview ?? t.source.inputFile)} alt="" loading="lazy" style={{ aspectRatio: `${(t.master?.canvas ?? t.source).width} / ${(t.master?.canvas ?? t.source).height}` }} />
    </button>
    <div className="cg-card-body">
      <h3>{t.name}</h3>
      <p className="cg-meta">{formatName((t.master?.canvas ?? t.source).width, (t.master?.canvas ?? t.source).height)} format · ready to use</p>
      <button type="button" className="ws-btn ws-btn-primary cg-use" onClick={() => onUse(t.id)}>Use This Template<ArrowRight size={15} aria-hidden="true" /></button>
    </div>
  </article>;
  return <div className="cg-page">
    <header className="cg-head"><h2>Choose a template</h2><p>Pick the design for your offer. You’ll add your own product photos next — the festive artwork, text and logos stay as they are.</p></header>
    <CreativeSteps current={0} />
    <section className="cg-size" aria-label="Choose your size"><h3>Choose your size</h3>
      <p>Your creative is designed for this shape — never stretched. Original keeps each template’s own size. You can still change it before you save.</p>
      <SizePicker value={size} onChange={chooseSize} /></section>
    {error && <div className="sr-error" role="alert"><p>{error}</p></div>}
    {!templates && !error ? <div className="cg-grid" aria-busy="true" aria-label="Loading templates">{[0, 1, 2].map(i => <div key={i} className="cg-card cg-skeleton" aria-hidden="true"><div className="cg-thumb" /><div className="cg-card-body"><span /><span /></div></div>)}</div>
      : templates && !ready.length ? <section className="cg-empty"><LayoutTemplate size={30} aria-hidden="true" /><h3>No templates yet</h3><p>Ask your template owner to add one under Offer Templates. It will appear here, ready to use.</p></section>
      : <>
        <div className="cg-grid">{masters.map(card)}</div>
        {mine.length > 0 && <section className="cg-mine" aria-label="Templates made from your creatives"><h3>Made from your creatives</h3><div className="cg-grid is-compact">{mine.map(card)}</div></section>}
      </>}
  </div>;
}
