import type { LayerEditCandidate, LayerEditEstimate, LayerEditRequest, LayerEditSource, LayerEditStatus } from '@frameflow/shared';
export class LayerEditApiError extends Error { constructor(message: string, public readonly code: string) { super(message); } }
const BASE = '/api/layerize-experiment/layer-edits';
async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new LayerEditApiError(json.error?.message ?? `Layer editing is unavailable (${response.status}).`, json.error?.code ?? 'HTTP_ERROR');
  return json as T;
}
export const layerEditApi = {
  estimate: (source: LayerEditSource) => call<LayerEditEstimate>('/estimate', source),
  generate: (request: LayerEditRequest) => call<LayerEditCandidate>('', request),
  status: (id: string) => call<LayerEditStatus>(`/${encodeURIComponent(id)}`),
  apply: (id: string) => call<LayerEditStatus>(`/${encodeURIComponent(id)}/apply`, {}),
  discard: (id: string) => call<LayerEditStatus>(`/${encodeURIComponent(id)}/discard`, {}),
};
export async function imageHash(blob: Blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('');
}
