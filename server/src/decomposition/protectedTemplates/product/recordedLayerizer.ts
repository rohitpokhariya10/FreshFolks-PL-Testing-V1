/**
 * A paid AI decomposition replayed from its recording (development and tests only: never configured from the server's
 * environment). A prepare keeps the planner's plan and Seedream's answer beside the template (prepare-ai-plan.json,
 * prepare-seedream-request.json, prepare-seedream-response.json) and the picture it sent (prepare-ai-input-*.png); with
 * Seedream's layer files saved too (fal's URLs expire), the same picture can be prepared again exactly as then: the real
 * Seedream path (seedreamLayerize: download, placement, sizes) over a transport that answers from the recording.
 *
 * Only the very picture that was sent is answered (its pixels compared): anything else is refused before any layer is
 * read. Nothing is sent anywhere and nothing is charged — it says so (offline, $0), so no cost is added to a template.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { sha256 } from '../pixels.js';
import type { FalTransport } from '../../providers/falClient.js';
import { AiDecompositionError, SEEDREAM_LAYERIZE, seedreamLayerize, type DecompositionPlan, type ProductLayerizer } from './aiDecompose.js';
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

/**
 * `dir`: the template folder of the recorded prepare; `layers`: Seedream's layer files, `z<z_index>.png` (as downloaded
 * from the URLs in its answer while they lasted).
 */
export function recordedProductLayerizer(options: { dir: string; layers: string }): ProductLayerizer {
  const plan = json(join(options.dir, 'prepare-ai-plan.json')) as unknown as DecompositionPlan;
  const response = json(join(options.dir, 'prepare-seedream-response.json')) as { layers?: { z_index: number; image: { url: string } }[] };
  const request = json(join(options.dir, 'prepare-seedream-request.json')) as { requestId?: string };
  const planner = json(join(options.dir, 'prepare-ai-planner-response.json')) as { id?: string; model?: string };
  const sent = readdirSync(options.dir).filter(f => /^prepare-ai-input-[0-9a-f]{12}\.png$/.test(f)).sort();
  if (!sent.length || !response.layers?.length) throw new Error(`No recorded AI decomposition in ${options.dir}.`);
  // Fail before preparation if any layer is missing. No cache miss can fall through to a live
  // download, and later file changes cannot alter this replay.
  const files = response.layers.map(l => {
    if (!Number.isSafeInteger(l.z_index) || l.z_index < 0) throw new Error('Invalid recorded layer index.');
    return { url: l.image.url, file: `z${l.z_index}.png` };
  });
  const byUrl = new Map(files.map(l => {
    const bytes = readFileSync(join(options.layers, l.file));
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Recorded layer ${l.file} is not a PNG; replay refused.`);
    return [l.url, bytes];
  }));
  const inputs = sent.map(f => readFileSync(join(options.dir, f)));
  const requestId = request.requestId ?? 'recorded';
  const transport: FalTransport = {
    // (Never fetched: `.invalid` cannot resolve.)
    async upload() { return 'https://recorded.invalid/input.png'; },
    async submit(endpoint, input) {
      if (endpoint !== SEEDREAM_LAYERIZE || (input as { prompt?: string }).prompt !== plan.prompt) throw new AiDecompositionError('RECORDING_MISMATCH', 'The replayed request is not the recorded one.');
      return { requestId };
    },
    async status() { return 'COMPLETED'; },
    async result() { return response; },
    async cancel() { /* nothing is running */ },
    async download(url) { const bytes = byUrl.get(url); if (!bytes) throw new AiDecompositionError('RECORDING_MISMATCH', 'No recorded layer for the requested URL.'); return bytes; },
  };
  const model = `${planner.model ?? 'planner'} (recorded)`;
  return { planner: model, engine: `${SEEDREAM_LAYERIZE} (recorded request ${requestId})`, offline: true, async decompose(req, save) {
    // The very picture that was sent, or nothing.
    const now = await sharp(req.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let matched = false;
    for (const input of inputs) {
      const then = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (now.info.width === then.info.width && now.info.height === then.info.height && now.data.equals(then.data)) { matched = true; break; }
    }
    if (!matched || req.width !== now.info.width || req.height !== now.info.height)
      throw new AiDecompositionError('RECORDING_MISMATCH', 'This picture is not the one the recorded decomposition was made from: nothing replayed.');
    save('ai-plan.json', plan);
    const s = await seedreamLayerize({ transport, image: req.image, width: req.width, height: req.height, prompt: plan.prompt, save, sleep: async () => undefined, pollIntervalMs: 0 });
    return { plan, planner: { model, offline: true, ...(planner.id ? { responseId: planner.id } : {}), costUsd: 0 },
      seedream: { endpoint: `${SEEDREAM_LAYERIZE} (recorded request ${requestId})`, offline: true, requestId, layers: s.layers.length, costUsd: 0, imageSha256: sha256(req.image) }, layers: s.layers };
  } };
}
