import { afterEach, expect, it, vi } from 'vitest';
const { edit } = vi.hoisted(() => ({ edit: vi.fn() }));
vi.mock('../services/openAIClient.js', () => ({ createOpenAIClient: () => ({ images: { edit } }) }));
import { liveRatioRegenerator } from './protectedTemplates/product/ratioRegeneration.js';
afterEach(() => { edit.mockReset(); vi.unstubAllEnvs(); });
it('passes the actual reference file and supported transparency parameter while leaving ordinary adapter calls unchanged', async () => {
  vi.stubEnv('OPENAI_IMAGE_MODEL', 'gpt-image-2');
  const image = Buffer.from('offline-reference-bytes');
  edit.mockResolvedValue({ data: [{ b64_json: image.toString('base64') }], _request_id: 'offline-request', usage: { input_tokens_details: { text_tokens: 1500, image_tokens: 6800 }, output_tokens: 7033 } });
  const provider = liveRatioRegenerator(), save = vi.fn();
  const result = await provider.regenerate({ image, prompt: 'Edit the selected object', size: { width: 1024, height: 1024 }, background: 'transparent' }, save, 'offline-op');
  const [request, options] = edit.mock.calls[0];
  expect(request).toMatchObject({ model: 'gpt-image-2', quality: 'high', n: 1, size: '1024x1024', background: 'transparent', output_format: 'png' });
  expect(Buffer.from(await request.image.arrayBuffer())).toEqual(image);
  expect(request.input_fidelity).toBeUndefined(); expect(request.mask).toBeUndefined();
  expect(options).toMatchObject({ maxRetries: 0, timeout: 300000, headers: { 'X-Client-Request-Id': 'offline-op' } });
  expect(result).toMatchObject({ image, requestId: 'offline-request', costUsd: 0.273 });
  await provider.regenerate({ image, prompt: 'Existing resize request', size: { width: 1024, height: 1536 } }, save, 'offline-existing');
  expect(edit.mock.calls[1][0]).not.toHaveProperty('background');
});
it('does not resubmit when the image API fails or returns no image', async () => {
  const provider = liveRatioRegenerator(), input = { image: Buffer.from('fixture'), prompt: 'Edit', size: { width: 1024, height: 1024 }, background: 'transparent' as const };
  edit.mockRejectedValueOnce(new Error('Offline quota failure'));
  await expect(provider.regenerate(input, () => {}, 'offline-failed')).rejects.toThrow('quota');
  expect(edit).toHaveBeenCalledTimes(1);
  edit.mockResolvedValueOnce({ data: [] });
  await expect(provider.regenerate(input, () => {}, 'offline-empty')).rejects.toThrow('no image');
  expect(edit).toHaveBeenCalledTimes(2);
});
