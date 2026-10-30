import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordedProductLayerizer } from './recordedLayerizer.js';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'recorded-layerizer-'));
  const image = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#abcdef' } }).png().toBuffer();
  const put = (f: string, value: object) => writeFileSync(join(dir, f), JSON.stringify(value));
  put('prepare-ai-plan.json', { prompt: 'Recorded test', layers: [], background: 'Background', warnings: [] });
  put('prepare-seedream-request.json', { requestId: 'offline-test' });
  put('prepare-ai-planner-response.json', { model: 'recorded-test' });
  put('prepare-seedream-response.json', { layers: [{ z_index: 0, image: { url: 'https://provider.invalid/recorded.png' } }] });
  writeFileSync(join(dir, 'prepare-ai-input-000000000000.png'), image);
  // A lexicographically later unrelated input must not replace the actual pixel match.
  writeFileSync(join(dir, 'prepare-ai-input-ffffffffffff.png'), await sharp(image).negate().png().toBuffer());
  writeFileSync(join(dir, 'z0.png'), image);
  return { dir, image, req: { image, width: 512, height: 512, elements: [], excluded: { textBlocks: 0, words: 0, logos: [] } } };
}
afterEach(() => vi.unstubAllGlobals());
describe('recorded layerizer stays offline', () => {
  it('replays with provider fetch forbidden', async () => {
    const f = await fixture(), blocked = vi.fn(() => { throw new Error('External network forbidden'); });
    vi.stubGlobal('fetch', blocked);
    const replay = recordedProductLayerizer({ dir: f.dir, layers: f.dir });
    const r = await replay.decompose(f.req, () => undefined);
    expect(r.layers).toHaveLength(1); expect(r.seedream).toMatchObject({ offline: true, costUsd: 0 });
    expect(r.planner).toMatchObject({ offline: true, costUsd: 0 }); expect(blocked).not.toHaveBeenCalled();
    await expect(replay.decompose({ ...f.req, width: 513 }, () => undefined)).rejects.toMatchObject({ code: 'RECORDING_MISMATCH' });
    await expect(replay.decompose({ ...f.req, image: await sharp(f.image).tint('#ff0000').png().toBuffer() }, () => undefined)).rejects.toMatchObject({ code: 'RECORDING_MISMATCH' });
  });
  it('refuses incomplete recordings before preparation can start', async () => {
    const f = await fixture();
    writeFileSync(join(f.dir, 'prepare-seedream-response.json'), JSON.stringify({ layers: [{ z_index: 9, image: { url: 'https://provider.invalid/missing.png' } }] }));
    expect(() => recordedProductLayerizer({ dir: f.dir, layers: f.dir })).toThrow(/ENOENT/);
  });
  it('rejects expired-download error bodies saved under PNG filenames', async () => {
    const f = await fixture(); writeFileSync(join(f.dir, 'z0.png'), 'expired download');
    expect(() => recordedProductLayerizer({ dir: f.dir, layers: f.dir })).toThrow(/not a PNG/);
  });
});
