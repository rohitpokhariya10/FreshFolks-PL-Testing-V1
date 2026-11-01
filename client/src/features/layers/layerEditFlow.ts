/**
 * The AI Edit Layer panel's interaction rules, kept free of React so they can be tested directly.
 * The panel still owns its state with useState/useRef; these helpers only decide what that state means.
 */
import { LayerEditApiError } from './layerEditApi';

export type LayerEditBusy = '' | 'estimate' | 'generate' | 'status' | 'apply' | 'discard';
/** Exactly one phase is shown at a time, so loading, stale and error messages never appear together. */
export type LayerEditPhase =
  | 'unavailable' | 'ready' | 'checking-cost' | 'approval' | 'generating' | 'processing' | 'preview-failed'
  | 'pending' | 'checking-status' | 'compare' | 'applying' | 'discarding' | 'stale';
/** What the last status check (or an interrupted response) established about a request whose result is not loaded. */
export type PendingStatus = 'unchecked' | 'running' | 'interrupted' | 'uncertain' | 'failed';

export interface PhaseInput {
  eligible: boolean; busy: LayerEditBusy; stale: boolean;
  quote: boolean; candidate: boolean; imageReady: boolean; imageFailed: boolean; pending: boolean;
}
export function layerEditPhase(s: PhaseInput): LayerEditPhase {
  if (!s.eligible) return 'unavailable';
  if (s.busy === 'discard') return 'discarding';
  // An invalidated request leaves the generating state at once; its late result is discarded, never applied.
  if (s.stale) return 'stale';
  if (s.busy === 'generate') return 'generating';
  if (s.busy === 'apply') return 'applying';
  if (s.busy === 'status') return 'checking-status';
  if (s.busy === 'estimate') return 'checking-cost';
  if (s.candidate) return s.imageFailed ? 'preview-failed' : s.imageReady ? 'compare' : 'processing';
  if (s.pending) return 'pending';
  if (s.quote) return 'approval';
  return 'ready';
}

/**
 * One operation at a time. Each begin() returns a token; work that resumes after an await must still hold the current
 * token, so a superseded request (discarded, or replaced) can never update the panel or end a newer operation.
 * A stale generation may be preempted by Discard: its eventual response is then ignored.
 */
export function createSingleFlight<K extends string>() {
  let current: { kind: K; token: number } | null = null, counter = 0;
  return {
    get kind() { return current?.kind ?? null; },
    begin(kind: K, preempt?: (running: K) => boolean) {
      if (current && !preempt?.(current.kind)) return 0;
      current = { kind, token: ++counter };
      return counter;
    },
    holds: (token: number) => current?.token === token,
    end(token: number) { if (current?.token !== token) return false; current = null; return true; },
  };
}

/** A request whose result has not been loaded into the panel. Stored per layer so reloading or reselecting can collect it. */
export interface RecoveryEntry { id: string; snapshot: string; prompt?: string }
const LEGACY_KEY = 'frameflow-layer-edit-pending';
const parse = (raw: string | null): RecoveryEntry | undefined => {
  try { const r = JSON.parse(raw ?? 'null') as Partial<RecoveryEntry> | null; return r && typeof r.id === 'string' && typeof r.snapshot === 'string' ? { id: r.id, snapshot: r.snapshot, ...(typeof r.prompt === 'string' ? { prompt: r.prompt } : {}) } : undefined; }
  catch { return undefined; }
};
export function layerEditRecovery(storage: () => Storage, documentId: string, variantId: string, layerId: string) {
  const key = `${LEGACY_KEY}:${JSON.stringify([documentId, variantId, layerId])}`;
  return {
    key,
    /** This layer's request, if it was made from the layer as it is now. The previous client's single entry is adopted once. */
    read(matches: (snapshot: string) => boolean): RecoveryEntry | undefined {
      try {
        const own = parse(storage().getItem(key));
        if (own) return matches(own.snapshot) ? own : undefined;
        const legacy = parse(storage().getItem(LEGACY_KEY));
        if (legacy && matches(legacy.snapshot)) { storage().setItem(key, JSON.stringify(legacy)); storage().removeItem(LEGACY_KEY); return legacy; }
      } catch { /* Recovery storage is optional for reading. */ }
      return undefined;
    },
    /** Throws when storage is unavailable: a paid request must not start without a way to recover it. */
    write(entry: RecoveryEntry) { storage().setItem(key, JSON.stringify(entry)); },
    clear(id: string) { try { if (parse(storage().getItem(key))?.id === id) storage().removeItem(key); } catch { /* optional */ } },
  };
}

/** Rejections that happen before the server records a request: no provider call was made and nothing can be charged. */
// IDEMPOTENCY_CONFLICT is deliberately absent: it means this operation was already recorded, so it must be checked, not forgotten.
const NOT_SENT = new Set(['INVALID_LAYER_EDIT', 'STALE_REVISION', 'APPROVAL_REQUIRED', 'NOT_CONFIGURED', 'NOT_FOUND', 'BUSY', 'ORIGIN_DENIED']);
export type GenerateOutcome =
  | { kind: 'not-sent' }   // Safe to forget: no request exists.
  | { kind: 'discarded' }  // The request was discarded while it ran; nothing to recover.
  | { kind: 'failed' }     // The server recorded a definite failure.
  | { kind: 'uncertain' }  // The server cannot tell whether the provider finished.
  | { kind: 'interrupted' }; // The response was lost: the request may still finish. Check status; never resubmit.
export function generateOutcome(error: unknown): GenerateOutcome {
  if (error instanceof LayerEditApiError) {
    if (NOT_SENT.has(error.code)) return { kind: 'not-sent' };
    if (error.code === 'EDIT_DISCARDED' || error.operationStatus === 'discarded') return { kind: 'discarded' };
    if (error.operationStatus === 'failed') return { kind: 'failed' };
    if (error.operationStatus === 'uncertain') return { kind: 'uncertain' };
  }
  return { kind: 'interrupted' };
}

/**
 * One stale-request rejection, recorded so a real conflict can be told apart from an internal synchronization problem.
 * Identifiers, fingerprints and numeric geometry only: no image, prompt, name or other layer content.
 */
export interface LayerEditConflict {
  at: string; operationId?: string; layerId: string;
  /** Where it was detected: the panel while a request ran or showed, sending it, its result's arrival, a status check, or Apply. */
  where: 'during-generation' | 'pending' | 'preview' | 'quote' | 'generate' | 'result' | 'recover' | 'apply';
  side: 'client' | 'server'; code?: string;
  /** Whether a completed provider result exists for this operation (it is kept unless someone discards it). */
  resultArrived: boolean;
  requested: { fingerprint: string; version: number };
  current: { fingerprint?: string; version: number };
  /** Whether the layer is still the selected element. */
  selected: boolean;
  /** The fields that differ now (numbers with before/after). Empty: they match again; only the change counter moved. */
  changed: { field: string; before?: number; after?: number }[];
  layerChanged: boolean;
}
export const CONFLICT_LOG_KEY = 'frameflow-layer-edit-conflicts';
/** Logged to the console and kept (last 20) in this browser under CONFLICT_LOG_KEY. Never throws. */
export function recordLayerEditConflict(storage: () => Storage, conflict: LayerEditConflict) {
  console.warn('[FrameFlow] AI layer edit conflict', conflict);
  try {
    const previous = JSON.parse(storage().getItem(CONFLICT_LOG_KEY) ?? '[]') as unknown;
    storage().setItem(CONFLICT_LOG_KEY, JSON.stringify([...(Array.isArray(previous) ? previous : []), conflict].slice(-20)));
  } catch { /* Diagnostics are optional. */ }
}

export interface Feedback { tone: 'success' | 'info' | 'warning' | 'error'; title: string; detail?: string }
/** A short message for people; the server's sanitized text goes into the expandable details only when it adds something. */
export function failureFeedback(error: unknown, title: string): Feedback {
  const offline = error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError', 'NetworkError'].includes(error.name));
  const detail = offline ? 'FrameFlow could not be reached. Check your connection, then try again.' : error instanceof Error ? error.message : '';
  return { tone: 'error', title, ...(detail && detail !== title ? { detail } : {}) };
}

export const formatElapsed = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
