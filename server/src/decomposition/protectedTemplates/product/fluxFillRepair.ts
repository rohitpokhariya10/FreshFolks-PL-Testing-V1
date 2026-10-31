/** One approved object completion through the existing fal transport. No generation retries or fallback models. */
import sharp from 'sharp';
import { buildProviderInput, endpointRegistry, normalizeProviderOutput } from '../../providers/adapters.js';
import { createFalTransport, type FalTransport } from '../../providers/falClient.js';
import type { LockedRequest } from './lockedCompletion.js';

export const FLUX_FILL_MODEL = endpointRegistry.flux.endpoint;
type Save = (file: string, value: object) => void;
export interface CutoutRepairProvider {
  model: string; offline: boolean;
  repair(request: Pick<LockedRequest, 'image' | 'mask' | 'prompt' | 'size'>, save: Save, operationId: string): Promise<{ image: Buffer; requestId?: string }>;
}
/** Published fal rate: $0.05 per started decimal megapixel, one output. Estimate, not measured billing. */
export function fluxRepairEstimateUsd(size: { width: number; height: number }) {
  if (![size.width, size.height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid repair dimensions.');
  return Math.ceil(size.width * size.height / 1_000_000) * 5 / 100;
}

export function createFluxFillRepair(options: { transport: () => FalTransport; sleep?: (ms: number) => Promise<void>; now?: () => number; timeoutMs?: number }): CutoutRepairProvider {
  return { model: FLUX_FILL_MODEL, offline: false, async repair({ image, mask, prompt, size }, save, operationId) {
    const [im, mm] = await Promise.all([sharp(image).metadata(), sharp(mask).metadata()]);
    if (im.format !== 'png' || mm.format !== 'png' || im.width !== size.width || im.height !== size.height || mm.width !== im.width || mm.height !== im.height) throw new Error('Repair image and mask must be PNGs with identical request dimensions.');
    // Reject an alpha edit mask (OpenAI semantics), gray values, empty masks and full-canvas masks before any upload.
    const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let white = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 255 || ![0, 255].includes(data[i]) || data[i] !== data[i + 1] || data[i] !== data[i + 2]) throw new Error('FLUX needs an opaque black/white mask: white reconstructs, black protects.');
      if (data[i]) white++;
    }
    if (!white || white === info.width * info.height) throw new Error('A bounded reconstruction region and protected context are required.');
    // Validate the existing input builder before uploading; URLs are replaced with the uploaded inputs below.
    const input = buildProviderInput('flux', { imageUrl: 'https://fal.media/input.png', maskUrl: 'https://fal.media/mask.png', width: size.width, height: size.height, maskWidth: mm.width, maskHeight: mm.height, prompt });
    const estimateUsd = fluxRepairEstimateUsd(size), transport = options.transport();
    const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), now = options.now ?? Date.now;
    let requestId: string | undefined;
    save('flux-fill-request.json', { model: FLUX_FILL_MODEL, ...input, image_url: '<repair crop>', mask_url: '<white-means-edit mask>', size, estimateUsd, operationId, maxRetries: 0 });
    try {
      input.image_url = await transport.upload(image, 'image/png');
      input.mask_url = await transport.upload(mask, 'image/png');
      ({ requestId } = await transport.submit(FLUX_FILL_MODEL, input));
      save('flux-fill-submitted.json', { model: FLUX_FILL_MODEL, requestId, operationId, size, estimateUsd });
      const started = now();
      while (await transport.status(FLUX_FILL_MODEL, requestId) !== 'COMPLETED') {
        if (now() - started >= (options.timeoutMs ?? 300_000)) throw new Error(`FLUX request ${requestId} is still pending; it may be billed. Check its saved request ID before another attempt.`);
        await sleep(2000);
      }
      const output = normalizeProviderOutput('flux', await transport.result(FLUX_FILL_MODEL, requestId));
      const result = await transport.download(output.images[0].url), meta = await sharp(result).metadata();
      // Never stretch a malformed/differently sized answer to fit the locked geometry.
      if (meta.format !== 'png' || meta.width !== size.width || meta.height !== size.height || (meta.pages ?? 1) !== 1) throw new Error('FLUX returned an invalid PNG or changed the repair canvas dimensions.');
      save('flux-fill-response.json', { model: FLUX_FILL_MODEL, requestId, size, images: 1, estimateUsd });
      return { image: result, requestId };
    } catch (error) {
      save('flux-fill-error.json', { requestId, operationId, message: error instanceof Error ? error.message : String(error), retried: false });
      throw error;
    }
  } };
}

/** Credentials remain server-side; creating an estimate does not create a transport or send a request. */
export function liveFluxFillRepair(): CutoutRepairProvider | undefined {
  const key = process.env.FAL_KEY?.trim();
  return key ? createFluxFillRepair({ transport: () => createFalTransport(key) }) : undefined;
}
