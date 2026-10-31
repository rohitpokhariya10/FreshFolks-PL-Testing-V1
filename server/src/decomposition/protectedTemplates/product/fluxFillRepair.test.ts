import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { FalTransport } from '../../providers/falClient.js';
import { createFluxFillRepair, FLUX_FILL_MODEL, fluxRepairEstimateUsd, liveFluxFillRepair } from './fluxFillRepair.js';
import { lockedRequest } from './lockedCompletion.js';

afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const image = await sharp({ create: { width: 120, height: 220, channels: 4, background: '#888888' } }).png().toBuffer();
  const hole = new Uint8Array(120 * 220);
  for (let y = 100; y < 190; y++) for (let x = 80; x < 110; x++) hole[y * 120 + x] = 1;
  return (await lockedRequest(image, hole, 'Refrigerator', 'flux'))!;
}
function fake(image: Buffer) {
  const transport: FalTransport = {
    upload: vi.fn(async (_bytes, mime) => { expect(mime).toBe('image/png'); return 'https://fal.media/upload.png'; }),
    submit: vi.fn(async () => ({ requestId: 'mock-fill' })), status: vi.fn(async () => 'COMPLETED' as const),
    result: vi.fn(async () => ({ images: [{ url: 'https://fal.media/result.png' }], has_nsfw_concepts: [false] })),
    download: vi.fn(async () => image), cancel: vi.fn(),
  };
  return transport;
}
describe('FLUX Fill repair adapter (mock transport only)', () => {
  it('sends exactly the supported fields, one PNG, correct mask and one submission; records an estimate, not measured cost', async () => {
    const req = await fixture(), t = fake(req.image), save = vi.fn();
    vi.mocked(t.status).mockResolvedValueOnce('IN_QUEUE').mockResolvedValueOnce('IN_PROGRESS');
    const sleep = vi.fn(async () => {}), provider = createFluxFillRepair({ transport: () => t, sleep });
    const result = await provider.repair(req, save, 'op');
    expect(t.submit).toHaveBeenCalledExactlyOnceWith(FLUX_FILL_MODEL, { image_url: 'https://fal.media/upload.png', mask_url: 'https://fal.media/upload.png', prompt: req.prompt, num_images: 1, output_format: 'png' });
    expect(t.upload).toHaveBeenNthCalledWith(1, req.image, 'image/png');
    expect(t.upload).toHaveBeenNthCalledWith(2, req.mask, 'image/png');
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ image: req.image, requestId: 'mock-fill' });
    expect(save).toHaveBeenCalledWith('flux-fill-submitted.json', expect.objectContaining({ requestId: 'mock-fill', estimateUsd: 0.05, size: req.size }));
    expect(result).not.toHaveProperty('costUsd');
  });
  it.each(['dimensions', 'alpha', 'empty', 'full'] as const)('rejects an invalid %s mask before upload/submission', async kind => {
    const req = await fixture(), t = fake(req.image);
    req.mask = await sharp({ create: { width: kind === 'dimensions' ? 1 : req.size.width, height: req.size.height, channels: 4,
      background: { r: kind === 'full' ? 255 : 0, g: kind === 'full' ? 255 : 0, b: kind === 'full' ? 255 : 0, alpha: kind === 'alpha' ? 0 : 1 } } }).png().toBuffer();
    await expect(createFluxFillRepair({ transport: () => t }).repair(req, vi.fn(), 'op')).rejects.toThrow();
    expect(t.upload).not.toHaveBeenCalled(); expect(t.submit).not.toHaveBeenCalled();
  });
  it.each(['submit', 'status', 'result', 'download'] as const)('never retries a failed %s call or submits a replacement', async stage => {
    const req = await fixture(), t = fake(req.image);
    vi.mocked(t[stage]).mockRejectedValue(new Error('connection failed'));
    await expect(createFluxFillRepair({ transport: () => t }).repair(req, vi.fn(), 'op')).rejects.toThrow('connection failed');
    expect(t.submit).toHaveBeenCalledTimes(1); expect(t[stage]).toHaveBeenCalledTimes(1);
  });
  it.each(['empty', 'multiple', 'safety', 'size', 'corrupt'] as const)('rejects a %s response', async kind => {
    const req = await fixture(), t = fake(req.image);
    if (kind === 'empty') vi.mocked(t.result).mockResolvedValue({ images: [] });
    if (kind === 'multiple') vi.mocked(t.result).mockResolvedValue({ images: [{ url: 'https://fal.media/a.png' }, { url: 'https://fal.media/b.png' }] });
    if (kind === 'safety') vi.mocked(t.result).mockResolvedValue({ images: [{ url: 'https://fal.media/a.png' }], has_nsfw_concepts: [true] });
    if (kind === 'size') vi.mocked(t.download).mockResolvedValue(await sharp(req.image).resize(64, 64).png().toBuffer());
    if (kind === 'corrupt') vi.mocked(t.download).mockResolvedValue(Buffer.from('invalid'));
    await expect(createFluxFillRepair({ transport: () => t }).repair(req, vi.fn(), 'op')).rejects.toThrow();
    expect(t.submit).toHaveBeenCalledTimes(1);
  });
  it('stops polling on timeout without another paid submission', async () => {
    const req = await fixture(), t = fake(req.image), save = vi.fn();
    vi.mocked(t.status).mockResolvedValue('IN_PROGRESS');
    let clock = 0;
    await expect(createFluxFillRepair({ transport: () => t, now: () => clock++, timeoutMs: 1 }).repair(req, save, 'op')).rejects.toThrow('may be billed');
    expect(t.submit).toHaveBeenCalledTimes(1); expect(t.result).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith('flux-fill-error.json', expect.objectContaining({ requestId: 'mock-fill', retried: false }));
  });
  it('uses only the server FAL_KEY and does not need an OpenAI key', () => {
    vi.stubEnv('FAL_KEY', ''); vi.stubEnv('OPENAI_API_KEY', 'not-used');
    expect(liveFluxFillRepair()).toBeUndefined();
    vi.stubEnv('FAL_KEY', 'offline-test-key'); vi.stubEnv('OPENAI_API_KEY', '');
    expect(liveFluxFillRepair()?.model).toBe(FLUX_FILL_MODEL); // constructing is free; repair is never invoked
  });
  it.each([[1000, 1000, 0.05], [1001, 1000, 0.10], [2000, 1000, 0.10], [2001, 1000, 0.15], [1024, 1024, 0.10]])('prices %i × %i at $%f from actual pixels', (width, height, cost) => {
    expect(fluxRepairEstimateUsd({ width, height })).toBe(cost);
  });
});
