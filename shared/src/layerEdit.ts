/** References are resolved against saved server data, never client-supplied URLs or uploads. */
export const LAYER_EDIT_LIMITS = { prompt: 1000, uploadBytes: 25 * 1024 * 1024, pixels: 4096 * 4096 } as const;
/**
 * One extra reference image (the original product, attached to a chained edit). Priced like the single input image already in
 * regenEstimateUsdForSize: 6,800 image tokens at gpt-image-2's $8 per million input image tokens.
 */
export const LAYER_EDIT_REFERENCE_USD = 0.05;
export type LayerEditTarget =
  | { kind: 'creative'; templateId: string; creativeId: string; layerId: string; revision: number }
  | { kind: 'run'; runId: string; layerId: string };
/** A rectangle of the layer's own image, as fractions of its width and height (0–1). */
export interface LayerEditRegion { x: number; y: number; width: number; height: number }
export interface LayerEditSource { target: LayerEditTarget; sourceSha256: string; sourceCandidateId?: string }
/** What the quote and the generation are made for. Optional fields keep older clients' requests valid. */
export interface LayerEditOptions {
  /** The instruction: it decides the edit type, the framing and the checks (no AI call is made to read it). */
  prompt?: string;
  /** Limit the edit to this area: everything outside it is kept exactly as it is. */
  region?: LayerEditRegion;
  /** Default true: when this layer is an earlier AI edit of a known original product, attach the original as identity reference. */
  useOriginalReference?: boolean;
}
/** Edit types read locally from the instruction. A request can have several (e.g. open the doors and make them red). */
export type LayerEditOperation = 'state' | 'color' | 'material' | 'add' | 'remove' | 'clean' | 'replace' | 'general';
export interface LayerEditIntent {
  operations: LayerEditOperation[];
  /** False only when the person explicitly asked for a different object (replace). */
  preserveIdentity: boolean;
  /** Parts may swing, fold or extend outside the current outline, so the frame keeps room around the object. */
  expandsSilhouette: boolean;
  /** Set when the physical change cannot be inferred safely. Generating then needs an explicit confirmation. */
  clarification?: string;
  /** The earlier recorded edit this one reverses (e.g. close after open): the result is checked against the image before it. */
  reverses?: string;
}
/** Which images the edit uses. The current layer is always the image edited; the original is only an identity reference. */
export interface LayerEditReferences {
  current: { sha256: string; aiEdits: number };
  original?: { sha256: string; attached: boolean; instructions: string[]; unrecordedEdits: number };
  /** Why no original product reference is available for this layer, when it is not the original itself. */
  unavailable?: string;
}
export interface LayerEditEstimate {
  available: boolean; provider: 'OpenAI'; model: string; offline: boolean; size: { width: number; height: number };
  estimateUsd: number; sourceSha256: string; reason?: string;
  intent?: LayerEditIntent; references?: LayerEditReferences; region?: LayerEditRegion;
}
export interface LayerEditRequest extends LayerEditSource, LayerEditOptions {
  prompt: string; operationId: string; approveUsd: number; model: string;
  /** Required when the estimate asked for a clarification: the person chose to generate the instruction as written. */
  confirmAmbiguous?: boolean;
}
/** One automated identity signal. `skipped` checks name what could not be verified automatically. */
export interface LayerEditIdentityCheck { id: 'contamination' | 'edges' | 'scale' | 'finish' | 'structure' | 'silhouette' | 'outside-region'; label: string; status: 'pass' | 'warn' | 'fail' | 'skipped'; detail: string }
/**
 * consistent: every applicable check passed (still automated evidence, not a guarantee).
 * review-required: some identity aspects could not be checked automatically; compare Before and After.
 * drift-suspected: the result appears to be a different or altered product. Apply needs an explicit confirmation.
 */
export type LayerEditIdentityStatus = 'consistent' | 'review-required' | 'drift-suspected';
export interface LayerEditCandidate extends LayerEditEstimate {
  operationId: string; target: LayerEditTarget; status: 'candidate'; costUsd?: number; requestId?: string;
  image: { base64: string; mimeType: 'image/png'; width: number; height: number; sha256: string };
  /** Relative to the original asset. Centre anchor; dimensions may expand beyond the original silhouette. */
  geometry: { width: number; height: number; centerX: number; centerY: number };
  /** Results recorded before the identity gate have only `background` and `identity: 'review-required'`. */
  validation: { background: 'transparent' | 'removed'; identity: LayerEditIdentityStatus; checks?: LayerEditIdentityCheck[]; limitation?: string };
}
/**
 * Where a running edit is: waiting for a provider slot (nothing sent yet), sent and waiting for OpenAI, or its result received
 * and being checked. Kept on the server, so a reload, a lost connection or a restart can tell what happened.
 */
export type LayerEditPhase = 'queued' | 'submitting' | 'received';
/**
 * Public statuses (unchanged): running (with its phase), candidate, applied, discarded, failed (definite: not sent, rejected by
 * the provider, or received but unusable) and uncertain (sent; whether the provider finished, and billed, is unknown).
 */
export interface LayerEditStatus {
  operationId: string; status: 'running' | 'uncertain' | 'candidate' | 'applied' | 'discarded' | 'failed'; message?: string; candidate?: LayerEditCandidate;
  phase?: LayerEditPhase;
  /** When the request was handed to the provider, if it was (ms since epoch). */
  submittedAt?: number;
  /** For failed/uncertain/discarded edits: whether a provider charge is possible ('none' only when nothing was sent). */
  billing?: 'none' | 'possible' | 'charged';
}
