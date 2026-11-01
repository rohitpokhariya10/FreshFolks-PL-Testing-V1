import { describe, expect, it, vi } from 'vitest';
import { LayerEditApiError } from './layerEditApi';
import { createSingleFlight, failureFeedback, formatElapsed, generateOutcome, layerEditPhase, layerEditRecovery, type PhaseInput } from './layerEditFlow';

const base: PhaseInput = { eligible: true, busy: '', stale: false, quote: false, candidate: false, imageReady: false, imageFailed: false, pending: false };
const phase = (s: Partial<PhaseInput>) => layerEditPhase({ ...base, ...s });

describe('AI Edit Layer phases', () => {
  it('walks one generation through each state, showing exactly one phase at a time', () => {
    const steps: Array<[Partial<PhaseInput>, string]> = [
      [{}, 'ready'],
      [{ busy: 'estimate' }, 'checking-cost'],
      [{ quote: true }, 'approval'],
      [{ quote: true, busy: 'generate', pending: true }, 'generating'],
      [{ quote: true, candidate: true }, 'processing'],
      [{ quote: true, candidate: true, imageReady: true }, 'compare'],
      [{ quote: true, candidate: true, imageReady: true, busy: 'apply' }, 'applying'],
      [{}, 'ready'], // Applied: the panel returns to a fresh prompt for the next edit.
    ];
    for (const [input, expected] of steps) expect(phase(input)).toBe(expected);
  });
  it('never reports generating and stale together; an invalidated request leaves the generating state', () => {
    expect(phase({ quote: true, busy: 'generate', pending: true, stale: true })).toBe('stale');
    expect(phase({ quote: true, candidate: true, imageReady: true, stale: true })).toBe('stale');
    expect(phase({ pending: true, stale: true })).toBe('stale');
    // Discarding wins over everything, so its spinner is the only one shown.
    expect(phase({ quote: true, busy: 'discard', pending: true, stale: true })).toBe('discarding');
  });
  it('distinguishes recoverable, checking, failed-preview and unavailable states', () => {
    expect(phase({ pending: true })).toBe('pending');
    expect(phase({ pending: true, busy: 'status' })).toBe('checking-status');
    expect(phase({ quote: true, candidate: true, imageFailed: true })).toBe('preview-failed');
    expect(phase({ eligible: false, pending: true, busy: 'generate' })).toBe('unavailable');
  });
});

describe('one operation at a time', () => {
  it('lets only the first of repeated Generate clicks submit a paid request', async () => {
    const flight = createSingleFlight<'generate' | 'apply' | 'discard'>();
    let release!: () => void;
    const api = vi.fn(() => new Promise<void>(r => { release = r; }));
    const generate = async () => { const t = flight.begin('generate'); if (!t) return; try { await api(); } finally { flight.end(t); } };
    const clicks = [generate(), generate(), generate()];
    expect(api).toHaveBeenCalledTimes(1);
    release(); await Promise.all(clicks);
    // Once finished, a separately approved generation may run.
    void generate(); expect(api).toHaveBeenCalledTimes(2); release();
  });
  it('lets only the first of repeated Apply clicks commit', async () => {
    const flight = createSingleFlight<'apply'>(), commit = vi.fn();
    const apply = async () => { const t = flight.begin('apply'); if (!t) return; try { await Promise.resolve(); commit(); } finally { flight.end(t); } };
    await Promise.all([apply(), apply()]);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('ignores a superseded request: its late result or error cannot update the panel or end the newer operation', () => {
    const flight = createSingleFlight<'generate' | 'discard' | 'estimate'>();
    const old = flight.begin('generate');
    expect(flight.begin('discard')).toBe(0); // A healthy generation cannot be preempted.
    const discard = flight.begin('discard', running => running === 'generate'); // A stale one can.
    expect(discard).toBeGreaterThan(old);
    expect(flight.holds(old)).toBe(false); // The old generation's response is ignored.
    expect(flight.end(old)).toBe(false); expect(flight.kind).toBe('discard');
    expect(flight.end(discard)).toBe(true);
    const next = flight.begin('estimate');
    expect(flight.holds(old)).toBe(false); expect(flight.holds(next)).toBe(true);
  });
});

describe('request outcomes and messages', () => {
  it('forgets only requests that never reached the provider; anything uncertain is checked, never resubmitted', () => {
    for (const code of ['INVALID_LAYER_EDIT', 'STALE_REVISION', 'APPROVAL_REQUIRED', 'NOT_CONFIGURED', 'BUSY', 'ORIGIN_DENIED'])
      expect(generateOutcome(new LayerEditApiError('x', code)).kind).toBe('not-sent');
    expect(generateOutcome(new LayerEditApiError('x', 'IDEMPOTENCY_CONFLICT')).kind).toBe('interrupted');
    expect(generateOutcome(new LayerEditApiError('x', 'LAYER_EDIT_FAILED', 'failed')).kind).toBe('failed');
    expect(generateOutcome(new LayerEditApiError('x', 'LAYER_EDIT_FAILED', 'uncertain')).kind).toBe('uncertain');
    expect(generateOutcome(new LayerEditApiError('x', 'EDIT_DISCARDED')).kind).toBe('discarded');
    expect(generateOutcome(new LayerEditApiError('Bad gateway', 'HTTP_ERROR')).kind).toBe('interrupted');
    expect(generateOutcome(new TypeError('Failed to fetch')).kind).toBe('interrupted');
    expect(generateOutcome(new DOMException('timed out', 'TimeoutError')).kind).toBe('interrupted');
  });
  it('keeps titles short and gives network failures a readable detail', () => {
    expect(failureFeedback(new TypeError('Failed to fetch'), 'Unable to confirm request status.')).toEqual({ tone: 'error', title: 'Unable to confirm request status.', detail: 'FrameFlow could not be reached. Check your connection, then try again.' });
    expect(failureFeedback(new Error('An edit for this layer is already running.'), 'The edit wasn’t started.').detail).toBe('An edit for this layer is already running.');
    expect(failureFeedback(new Error('Same'), 'Same')).toEqual({ tone: 'error', title: 'Same' });
    expect(formatElapsed(65_400)).toBe('1:05'); expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('per-layer request recovery', () => {
  const memory = () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } as Storage;
    return { data, storage: () => storage };
  };
  it('keeps one recoverable request per layer and returns it only for the layer state it was made from', () => {
    const m = memory(), fridge = layerEditRecovery(m.storage, 'doc', 'v1', 'object-fridge'), tv = layerEditRecovery(m.storage, 'doc', 'v1', 'object-tv');
    fridge.write({ id: 'a', snapshot: 'fridge-1', prompt: 'Open the doors' }); tv.write({ id: 'b', snapshot: 'tv-1' });
    expect(fridge.read(s => s === 'fridge-1')).toEqual({ id: 'a', snapshot: 'fridge-1', prompt: 'Open the doors' });
    expect(fridge.read(s => s === 'fridge-2')).toBeUndefined();
    expect(tv.read(() => true)?.id).toBe('b');
    expect(layerEditRecovery(m.storage, 'other-doc', 'v1', 'object-fridge').read(() => true)).toBeUndefined();
    fridge.clear('not-this-one'); expect(fridge.read(() => true)?.id).toBe('a');
    fridge.clear('a'); expect(fridge.read(() => true)).toBeUndefined(); expect(tv.read(() => true)?.id).toBe('b');
  });
  it('adopts a matching request saved by the previous single-entry client, once', () => {
    const m = memory();
    m.data.set('frameflow-layer-edit-pending', JSON.stringify({ id: 'legacy', snapshot: 'fridge-1' }));
    const tv = layerEditRecovery(m.storage, 'doc', 'v1', 'object-tv'), fridge = layerEditRecovery(m.storage, 'doc', 'v1', 'object-fridge');
    expect(tv.read(s => s === 'tv-1')).toBeUndefined();
    expect(fridge.read(s => s === 'fridge-1')?.id).toBe('legacy');
    expect(m.data.has('frameflow-layer-edit-pending')).toBe(false); expect(fridge.read(s => s === 'fridge-1')?.id).toBe('legacy');
  });
  it('refuses to start a paid request when recovery storage is unavailable, and tolerates it when only reading', () => {
    const broken = () => { throw new DOMException('denied', 'SecurityError'); };
    const r = layerEditRecovery(broken as unknown as () => Storage, 'doc', 'v1', 'object-fridge');
    expect(() => r.write({ id: 'a', snapshot: 's' })).toThrow();
    expect(r.read(() => true)).toBeUndefined(); expect(() => r.clear('a')).not.toThrow();
  });
});
