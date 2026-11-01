/** References are resolved against saved server data, never client-supplied URLs or uploads. */
export const LAYER_EDIT_LIMITS = { prompt: 1000, uploadBytes: 25 * 1024 * 1024, pixels: 4096 * 4096 } as const;
export type LayerEditTarget =
  | { kind: 'creative'; templateId: string; creativeId: string; layerId: string; revision: number }
  | { kind: 'run'; runId: string; layerId: string };
export interface LayerEditSource { target: LayerEditTarget; sourceSha256: string; sourceCandidateId?: string }
export interface LayerEditEstimate {
  available: boolean; provider: 'OpenAI'; model: string; offline: boolean; size: { width: number; height: number };
  estimateUsd: number; sourceSha256: string; reason?: string;
}
export interface LayerEditRequest extends LayerEditSource { prompt: string; operationId: string; approveUsd: number; model: string }
export interface LayerEditCandidate extends LayerEditEstimate {
  operationId: string; target: LayerEditTarget; status: 'candidate'; costUsd?: number; requestId?: string;
  image: { base64: string; mimeType: 'image/png'; width: number; height: number; sha256: string };
  /** Relative to the original asset. Centre anchor; dimensions may expand beyond the original silhouette. */
  geometry: { width: number; height: number; centerX: number; centerY: number };
  validation: { background: 'transparent' | 'removed'; identity: 'review-required' };
}
export interface LayerEditStatus { operationId: string; status: 'running' | 'uncertain' | 'candidate' | 'applied' | 'discarded' | 'failed'; message?: string; candidate?: LayerEditCandidate }
