/**
 * The size controls shared by the master template's creation and Create Offer Creative: the size picker (the template's
 * own and the common offer-creative ratios, one list in shared) and what was checked before saving.
 */
import { Check } from 'lucide-react';
import { REUSE_ASPECT_LABELS, REUSE_OFFERED_RATIOS, type ReuseAspectRatio, type ReuseValidation } from '@frameflow/shared';
import { formatName } from './TemplateGallery';

/**
 * The creative's size, chosen before it is made (and again on every reuse): the template's own, or one of the common
 * offer-creative ratios. Each is composed for its shape — never stretched — and saved with the creative.
 */
export function SizePicker({ value, onChange, original, disabled }: { value: ReuseAspectRatio; onChange: (r: ReuseAspectRatio) => void; original?: { width: number; height: number }; disabled?: boolean }) {
  const shape = (r: ReuseAspectRatio) => (r === 'original' ? (original ? `${original.width} / ${original.height}` : '1 / 1') : r.replace(':', ' / '));
  return <div className="sr-formats" role="radiogroup" aria-label="Creative size">{REUSE_OFFERED_RATIOS.map(r => <button key={r} type="button" role="radio" aria-checked={value === r} className={`sr-format${value === r ? ' is-on' : ''}`} disabled={disabled} onClick={() => onChange(r)}>
    <span className="sr-shape" style={{ aspectRatio: shape(r) }} aria-hidden="true" />{r === 'original' ? `Original${original ? ` · ${formatName(original.width, original.height)}` : ''}` : REUSE_ASPECT_LABELS[r]}</button>)}</div>;
}
/** What was verified before saving: the exact size, the protected elements, readability and clipping. */
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export function PreSaveChecks({ v }: { v?: ReuseValidation }) {
  if (!v) return null;
  const rows: [string, boolean, string][] = [
    ['Size', v.size.ok, v.size.message],
    ['Logos, text & products', v.protected.ok, v.protected.ok ? `${count(v.protected.logos, 'logo')}, ${count(v.protected.texts, 'text block')} and ${count(v.protected.products, 'product')} — all shown, exact and unchanged.` : v.protected.issues.join(' ')],
    ['Readability', v.readability.ok, v.readability.ok ? 'Every text is large enough and stands out from what is behind it.' : v.readability.issues.join(' ')],
    ['Edges', v.clipping.ok, v.clipping.ok ? 'Nothing is cut off by the edges.' : v.clipping.issues.join(' ')],
  ];
  return <ul className="sr-checks" aria-label="Checked before saving">{rows.map(([title, ok, text]) => <li key={title} className={ok ? 'is-ok' : 'is-warn'}>
    <span className="sr-check-mark" aria-hidden="true">{ok ? <Check size={12} /> : '!'}</span><span><strong>{title}</strong> {text}</span></li>)}</ul>;
}
