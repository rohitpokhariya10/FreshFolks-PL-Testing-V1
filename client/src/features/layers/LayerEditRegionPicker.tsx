import { useRef, useState, type PointerEvent } from 'react';
import type { LayerEditRegion } from '@frameflow/shared';

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const between = (a: { x: number; y: number }, b: { x: number; y: number }): LayerEditRegion =>
  ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Drag on the layer's own image to limit an AI edit to an area: the server keeps every pixel outside it. Values are
 * fractions of the image. Optional: an edit without an area works as before.
 */
export function LayerEditRegionPicker({ src, region, onChange, disabled }: { src: string; region?: LayerEditRegion; onChange: (region?: LayerEditRegion) => void; disabled?: boolean }) {
  const frame = useRef<HTMLDivElement>(null), [start, setStart] = useState<{ x: number; y: number }>(), [draft, setDraft] = useState<LayerEditRegion>();
  const at = (e: PointerEvent) => { const r = frame.current!.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }; };
  const shown = draft ?? region;
  return <div className="ai-layer-region">
    <div ref={frame} className="ai-layer-region-frame" aria-label="Drag on the image to select the area to edit" role="img"
      onPointerDown={e => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setStart(p); setDraft(between(p, p)); }}
      onPointerMove={e => { if (start) setDraft(between(start, at(e))); }}
      onPointerUp={e => {
        if (!start) return;
        const r = between(start, at(e)); setStart(undefined); setDraft(undefined);
        if (r.width >= 0.02 && r.height >= 0.02) onChange(r);
      }}
      onPointerCancel={() => { setStart(undefined); setDraft(undefined); }}>
      <img src={src} alt="" draggable={false} />
      {shown && <span className="ai-layer-region-box" style={{ left: pct(shown.x), top: pct(shown.y), width: pct(shown.width), height: pct(shown.height) }} />}
    </div>
    <p className="ai-layer-fineprint" role="status">{region
      ? `Area: ${pct(region.width)} × ${pct(region.height)} of the layer. Only this area can change; everything outside it stays exactly as it is.`
      : 'Drag on the image to select the part to change. Everything outside the area stays exactly as it is.'}</p>
    {region && <button type="button" className="ai-layer-link" disabled={disabled} onClick={() => onChange(undefined)}>Remove the area limit</button>}
  </div>;
}
