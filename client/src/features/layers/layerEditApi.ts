import type { LayerEditCandidate, LayerEditEstimate, LayerEditOptions, LayerEditRequest, LayerEditSource, LayerEditStatus } from '@frameflow/shared';
/** operationStatus/billing: what the server recorded for the operation, when the error concerns one (never guessed here). */
export class LayerEditApiError extends Error { constructor(message: string, public readonly code: string, public readonly operationStatus?: LayerEditStatus['status'], public readonly billing?: LayerEditStatus['billing']) { super(message); } }
const BASE = '/api/layerize-experiment/layer-edits';
async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', cache: 'no-store', signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new LayerEditApiError(json.error?.message ?? `Layer editing is unavailable (${response.status}).`, json.error?.code ?? 'HTTP_ERROR', json.error?.status, json.error?.billing);
  return json as T;
}
/** `revision`: the editor's current saved creative revision, so a save made while an edit was pending does not block it. */
const atRevision = (revision?: number) => revision === undefined ? '' : `?revision=${revision}`;
export const layerEditApi = {
  /** Free: the price, the edit type read from the prompt, and which reference images would be sent. */
  estimate: (source: LayerEditSource & LayerEditOptions) => call<LayerEditEstimate>('/estimate', source),
  generate: (request: LayerEditRequest, signal?: AbortSignal) => call<LayerEditCandidate>('', request, signal),
  /** Free: the latest unfinished edit of this layer made from its current image, found on the server (not this browser). */
  open: (source: LayerEditSource) => call<{ operationId?: string; status?: LayerEditStatus['status']; prompt?: string }>('/open', source),
  status: (id: string, revision?: number) => call<LayerEditStatus>(`/${encodeURIComponent(id)}${atRevision(revision)}`),
  /** acceptIdentityRisk: the person confirmed a result flagged as a possible different product is the same product. */
  apply: (id: string, revision?: number, acceptIdentityRisk = false) => call<LayerEditStatus>(`/${encodeURIComponent(id)}/apply`, { ...(revision === undefined ? {} : { revision }), ...(acceptIdentityRisk ? { acceptIdentityRisk: true } : {}) }),
  /** reason 'identity': rejected as not the same product (kept on the server for review, never applied). */
  discard: (id: string, reason?: 'identity') => call<LayerEditStatus>(`/${encodeURIComponent(id)}/discard`, reason ? { reason } : {}),
};
export async function imageHash(blob: Blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('');
}
