/**
 * Generate AI Variations → AI design variations: the whole creative redesigned by the image model, 3–5 times, for a
 * festival or theme and one size (the six sizes of every flow), each in its own design direction, its logos, products,
 * QR codes and words kept and checked. Nothing is sent until the estimate is approved; changing a choice sends nothing.
 * A chosen variation, looked at and approved, is made editable through the creation pipeline (its elements found in it,
 * reviewed, decomposed, then the editor); the base template is never changed.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Maximize2, RefreshCw, Sparkles, Wand2, X } from 'lucide-react';
import { aiVariationBusinessWords, aiVariationRetriable, aiVariationWarnings, AI_VARIATION_COUNTS, AI_VARIATION_THEME_LABELS, AI_VARIATION_THEMES, REUSE_ASPECT_LABELS, type AiVariationJob, type AiVariationResult, type AiVariationTheme, type ProductAspectRatio } from '@frameflow/shared';
import { productApi, productFileUrl, type AiVariationsInfo } from './api';
import { SizePicker } from './SizeControls';
import { Alert, Badge } from '../templateStudio/ui';

/** A variation's design direction in a few words (its sentence up to the colon). */
const directionName = (d: string) => d.split(':')[0];
const sizeName = (r: ProductAspectRatio) => (r === 'original' ? 'Original size' : REUSE_ASPECT_LABELS[r]);

export function AiDesignVariations({ templateId, canvas, onOpenTemplate, onError }: { templateId: string; canvas: { width: number; height: number }; onOpenTemplate?: (templateId: string) => void; onError: (m: string) => void }) {
  const [info, setInfo] = useState<AiVariationsInfo>(), [job, setJob] = useState<AiVariationJob>();
  const [ratio, setRatio] = useState<ProductAspectRatio>('original'), [theme, setTheme] = useState<AiVariationTheme>('original'), [customTheme, setCustomTheme] = useState(''), [count, setCount] = useState<number>(3);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(''), [chosen, setChosen] = useState<number>(), [looked, setLooked] = useState(false), [accepted, setAccepted] = useState(false), [confirmed, setConfirmed] = useState(false), [useAi, setUseAi] = useState(true), [full, setFull] = useState<string>();
  const [askRetry, setAskRetry] = useState<number>();
  const load = useCallback(() => productApi.aiVariations(templateId).then(i => { setInfo(i); setJob(j => j ?? i.jobs[0]); }), [templateId]);
  useEffect(() => { void load().catch((e: Error) => onError(e.message)); }, [load, onError]);
  // Polled only while the server is making them.
  useEffect(() => {
    if (job?.status !== 'running') return;
    const t = setInterval(() => { void productApi.aiVariation(templateId, job.id).then(setJob).catch(() => undefined); }, 1500);
    return () => clearInterval(t);
  }, [job, templateId]);
  if (!info) return null;
  const each = info.estimates[ratio] ?? 0, total = Math.round(each * count * 100) / 100, running = job?.status === 'running';
  const change = (f: () => void) => { f(); setConfirm(false); };
  const start = async () => {
    if (total > 0 && !confirm) { setConfirm(true); return; }
    setBusy('start'); setConfirm(false); onError(''); setChosen(undefined); setLooked(false);
    try { setJob(await productApi.startAiVariations(templateId, { ratio, theme, ...(theme === 'custom' ? { customTheme: customTheme.trim() } : {}), count, approveUsd: total })); }
    catch (e) { onError(e instanceof Error ? e.message : 'The AI variations could not be started.'); }
    finally { setBusy(''); }
  };
  const editable = async (r: AiVariationResult) => {
    if (!job) return;
    setBusy(`use-${r.index}`); onError('');
    try { const out = await productApi.continueAiVariation(templateId, job.id, r.index, { approved: looked, useAi, acceptWarnings: accepted, confirmBusinessText: confirmed }); setJob(await productApi.aiVariation(templateId, job.id)); onOpenTemplate?.(out.templateId); }
    catch (e) { onError(e instanceof Error ? e.message : 'It could not be made editable.'); }
    finally { setBusy(''); }
  };
  /** One variation that failed or cannot be used, made again on its own (its estimate approved); the others are kept. */
  const retry = async (r: AiVariationResult) => {
    if (!job) return;
    setAskRetry(undefined); setBusy(`retry-${r.index}`); onError(''); setChosen(c => (c === r.index ? undefined : c));
    try { setJob(await productApi.retryAiVariation(templateId, job.id, r.index, { approveUsd: info.estimates[job.ratio] ?? 0 })); }
    catch (e) { onError(e instanceof Error ? e.message : 'The variation could not be made again.'); }
    finally { setBusy(''); }
  };
  const ready = job?.results.filter(r => r.status === 'ready').length ?? 0;
  return <section className="ts-card prt-aivar" aria-label="AI design variations"><div className="ts-card-body prt-var-form">
    <h3><Sparkles size={16} aria-hidden="true" /> AI design variations</h3>
    <p className="ot-muted">The AI image model ({info.model || 'not configured'}) makes distinct designs within the creative’s own template family — background, decoration, colours and festive styling restyled, products, characters and decorations placed and scaled differently in each — keeping its brand identity and its text inside the artwork’s own containers. Its logos, products, QR codes, prices, dates and every word are kept; each result is checked and put back with their own pixels before you see it. Your template is not changed.</p>
    {!info.available ? <Alert>AI design variations need the image model: configure the OpenAI key on the server.</Alert> : <>
      <div className="ot-field"><span>Size</span><SizePicker value={ratio} onChange={r => change(() => setRatio(r as ProductAspectRatio))} original={canvas} disabled={running || !!busy} /></div>
      <div className="ot-field"><span>Festival or theme</span><div className="prt-seg" role="radiogroup" aria-label="Festival or theme">{AI_VARIATION_THEMES.map(t => <button key={t} type="button" role="radio" aria-checked={theme === t} disabled={running || !!busy} onClick={() => change(() => setTheme(t))}>{AI_VARIATION_THEME_LABELS[t]}</button>)}</div>
        {theme === 'custom' && <input className="prt-aivar-custom" value={customTheme} maxLength={160} aria-label="Custom theme" placeholder="e.g. Onam: pookalam flower carpets, banana leaves, gold and green" onChange={e => change(() => setCustomTheme(e.target.value))} />}
        <span className="ot-muted ot-small">Theme decoration only: the creative’s wording, offers and terms stay exactly as they are.</span></div>
      <div className="ot-field"><span>How many</span><div className="prt-seg" role="radiogroup" aria-label="How many AI variations">{AI_VARIATION_COUNTS.map(n => <button key={n} type="button" role="radio" aria-checked={count === n} disabled={running || !!busy} onClick={() => change(() => setCount(n))}>{n} variations</button>)}</div></div>
      {confirm && <div className="prt-confirm" role="group" aria-label="Confirm the AI variations cost"><p>Spend at most about <strong>${total.toFixed(2)}</strong>? {count} requests to {info.model} (one per variation, high quality, {sizeName(ratio)}), made one after another; the actual cost is recorded. Never retried automatically.</p></div>}
      <div className="ot-row"><button type="button" className="ws-btn ws-btn-primary ws-btn-large" disabled={running || !!busy || (theme === 'custom' && !customTheme.trim())} onClick={() => void start()}><Sparkles size={15} aria-hidden="true" />
        {running ? `Designing… ${ready} of ${job!.count} ready` : confirm ? `Yes, spend $${total.toFixed(2)} and generate` : `Generate ${count} AI variations`}</button>
        {confirm ? <button type="button" className="ws-btn ws-btn-quiet" onClick={() => setConfirm(false)}>Cancel</button> : <span className="ot-muted ot-small">{total > 0 ? `About $${total.toFixed(2)} at most · you’ll confirm first` : 'Free (test image model)'}</span>}</div>
    </>}
    {job && <div aria-label="Generated AI variations">
      <p className="ot-muted">{AI_VARIATION_THEME_LABELS[job.theme]}{job.customTheme ? ` (${job.customTheme})` : ''} · {sizeName(job.ratio)} · {job.size.width} × {job.size.height} px · {job.offline ? 'test image model (offline, free)' : `${job.model}, $${job.costUsd.toFixed(3)} so far (estimate $${job.estimateUsd.toFixed(2)})`}</p>
      <div className="ot-grid is-wide prt-var-grid">{job.results.map(r => {
        const c = r.checks, blocked = !!c?.blocking.length, warnings = aiVariationWarnings(c), look = warnings.length > 0, business = aiVariationBusinessWords(c), again = info.estimates[job.ratio] ?? 0;
        return <article key={r.index} className={`ot-card${chosen === r.index ? ' is-inspected' : ''}`} aria-label={`AI variation ${r.index + 1}`} data-status={r.status}>
          {r.file ? <button type="button" className="prt-var-preview" aria-label={`Enlarge AI variation ${r.index + 1}`} onClick={() => setFull(r.file)}><img src={productFileUrl(templateId, r.file)} alt={`AI variation ${r.index + 1}: ${directionName(r.direction)}`} /></button>
            : <div className={r.status === 'failed' ? 'prt-var-failed' : 'prt-var-pending'}><p>{r.status === 'failed' ? r.error : r.status === 'running' ? 'Designing this variation… usually about a minute.' : 'Waiting for its turn.'}</p></div>}
          <div className="ot-card-body">
            <div className="ot-row"><h3>Variation {r.index + 1} · {directionName(r.direction)}</h3>
              {r.status === 'failed' && <Badge tone="danger">Failed</Badge>}
              {c && <Badge tone={blocked ? 'danger' : look ? 'warn' : 'ok'}>{blocked ? 'Cannot be used' : look ? 'Check it' : 'Checks passed'}</Badge>}{r.templateId && <Badge tone="ok">Made editable</Badge>}{(r.attempts ?? 1) > 1 && <Badge>Made again</Badge>}</div>
            {aiVariationRetriable(r) && job.status !== 'running' && (askRetry === r.index
              ? <div className="prt-confirm" role="group" aria-label={`Confirm making AI variation ${r.index + 1} again`}><p>Make this variation again? One request to {job.model}{again > 0 ? <>, at most about <strong>${again.toFixed(2)}</strong></> : ' (free test model)'}. The other variations are kept as they are; never retried automatically.</p>
                <div className="ot-row"><button type="button" className="ws-btn ws-btn-primary" disabled={!!busy} onClick={() => void retry(r)}><RefreshCw size={14} aria-hidden="true" />Yes, make it again</button><button type="button" className="ws-btn ws-btn-quiet" onClick={() => setAskRetry(undefined)}>Cancel</button></div></div>
              : <div className="ot-row"><button type="button" className="ws-btn" disabled={!!busy} onClick={() => setAskRetry(r.index)}><RefreshCw size={14} aria-hidden="true" />{busy === `retry-${r.index}` ? 'Starting…' : 'Retry this variation…'}</button><span className="ot-muted ot-small">{again > 0 ? `About $${again.toFixed(2)} at most · you’ll confirm first` : 'Free (test image model)'}</span></div>)}
            {c && <ul className="sr-checks" aria-label={`Checked: variation ${r.index + 1}`}>
              {c.blocking.map(b => <li key={b} className="is-warn"><span className="sr-check-mark" aria-hidden="true">!</span><span>{b}</span></li>)}
              <li className={c.assets.some(a => a.status === 'not-found') ? 'is-warn' : 'is-ok'}><span className="sr-check-mark" aria-hidden="true">{c.assets.some(a => a.status === 'not-found') ? '!' : <Check size={12} />}</span><span><strong>Products & logos</strong> {c.assets.filter(a => a.status === 'restored').length} of {c.assets.length} put back with their own pixels{c.assets.some(a => a.status === 'not-found') ? `; check: ${c.assets.filter(a => a.status === 'not-found').map(a => a.label).join(', ')}` : ''}.</span></li>
              {c.qr.length > 0 && <li className={c.qr.some(q => q.status === 'failed') ? 'is-warn' : 'is-ok'}><span className="sr-check-mark" aria-hidden="true">{c.qr.some(q => q.status === 'failed') ? '!' : <Check size={12} />}</span><span><strong>QR codes</strong> scan to your original link{c.qr.some(q => q.status === 'restored') ? ' (put back from your original)' : ''}.</span></li>}
              <li className={c.missingWords.length ? 'is-warn' : 'is-ok'}><span className="sr-check-mark" aria-hidden="true">{c.missingWords.length ? '!' : <Check size={12} />}</span><span><strong>Text</strong> {c.missingWords.length ? `not read in it — check: ${c.missingWords.join(', ')}` : 'every word of your template read in it'}.</span></li>
              {c.extraWords && <li className={c.extraWords.length ? 'is-warn' : 'is-ok'}><span className="sr-check-mark" aria-hidden="true">{c.extraWords.length ? '!' : <Check size={12} />}</span><span><strong>Nothing added</strong> {c.extraWords.length ? `read in it but not in your template — check for invented copy: ${c.extraWords.join(', ')}` : 'no word your template does not have'}.</span></li>}
            </ul>}
            {r.status === 'ready' && !blocked && !r.templateId && (chosen === r.index
              ? <div className="prt-confirm" role="group" aria-label={`Use AI variation ${r.index + 1}`}>
                <label className="ot-check"><input type="checkbox" checked={looked} onChange={e => setLooked(e.target.checked)} /><span>I have looked at this variation: its text, prices, dates, products, logos and QR code are right.</span></label>
                {look && <label className="ot-check"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>I accept these warnings: {warnings.join('; ')}.</span></label>}
                {business.length > 0 && <label className="ot-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span><strong>I checked each of these added words and none is a new price, offer, date or claim:</strong> {business.join(', ')}. (The reading on this computer can misread; if any is new business content, make the variation again instead.)</span></label>}
                <label className="ot-check"><input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} /><span>Find the characters and products in it with AI — one OpenAI request, estimated up to about $0.35 — so each becomes a layer of its own.</span></label>
                <div className="ot-row"><button type="button" className="ws-btn ws-btn-primary" disabled={!looked || (look && !accepted) || (business.length > 0 && !confirmed) || !!busy || !onOpenTemplate} onClick={() => void editable(r)}><Wand2 size={14} aria-hidden="true" />{busy === `use-${r.index}` ? 'Starting…' : 'Use this variation: make it editable (review & decompose)'}</button>
                  <button type="button" className="ws-btn ws-btn-quiet" onClick={() => setChosen(undefined)}>Cancel</button></div></div>
              : <div className="ot-row"><button type="button" className="ws-btn" disabled={!!busy} onClick={() => { setChosen(r.index); setLooked(false); setAccepted(false); setConfirmed(false); }}><Check size={14} aria-hidden="true" />Choose this variation</button>
                <button type="button" className="ws-btn ws-btn-quiet" onClick={() => setFull(r.file)}><Maximize2 size={14} aria-hidden="true" />Inspect</button></div>)}
            {r.templateId && onOpenTemplate && <button type="button" className="ws-btn ws-btn-quiet" onClick={() => onOpenTemplate(r.templateId!)}>Open its editable template</button>}
          </div>
        </article>; })}</div>
    </div>}
    {full && <div className="sr-lightbox" role="dialog" aria-modal="true" aria-label="AI variation, full screen" onClick={() => setFull(undefined)}>
      <button type="button" className="sr-lightbox-close" aria-label="Close" autoFocus onClick={() => setFull(undefined)}><X size={20} /></button>
      <img src={productFileUrl(templateId, full)} alt="AI variation, full screen" onClick={e => e.stopPropagation()} />
    </div>}
  </div></section>;
}
