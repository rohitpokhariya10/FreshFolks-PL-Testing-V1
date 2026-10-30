/** Offline acceptance replay. All mutations occur in a copied store; never imports a live provider.
 * node --conditions=development --import tsx tests/fixtures/layerEvidenceReplay.ts SOURCE LAYERS OUTPUT on|off
 * LAYERS contains the recorded z<index>.png files.
 */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { ProductCreative, ProtectedTemplate } from '@frameflow/shared';
import { setup } from '../../server/src/decomposition/protectedTemplates/product/productServer.fixture.js';
import { recordedProductLayerizer } from '../../server/src/decomposition/protectedTemplates/product/recordedLayerizer.js';
import { fakeRecognizer } from '../../server/src/textRecognition/recognizer.js';

const [sourceArg, layersArg, outArg, flag] = process.argv.slice(2);
assert(sourceArg && layersArg && outArg && ['on', 'off'].includes(flag), 'Provide SOURCE LAYERS OUTPUT on|off');
const source = resolve(sourceArg), out = resolve(outArg);
assert(!existsSync(out), 'OUTPUT must be new; existing evidence is never overwritten');
const original = readFileSync(join(source, 'template.json')), template = JSON.parse(original.toString()) as ProtectedTemplate;
const layerizer = recordedProductLayerizer({ dir: source, layers: resolve(layersArg) });
const s = await setup({ layerizer, analyzer: false, recognizer: fakeRecognizer([]), cutoutVerification: flag === 'on' });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, new URL(s.base).origin, `Offline replay blocked network access to ${url.origin}`);
  return realFetch(input, init);
}) as typeof fetch;
mkdirSync(out, { recursive: true });
cpSync(source, join(s.protectedDir, template.id), { recursive: true });
const id = template.id, asset = (f: string) => readFileSync(join(s.protectedDir, id, f));
try {
  let v = (await s.call(`/${id}`)).body as Awaited<ReturnType<typeof s.prepared>>;
  // Invalidate the old preparation through the normal selection route; no saved revisions are removed.
  const selection = await s.send('PUT', `/${id}/selection`, { expectedRevision: v.template.revision, objects: [], logos: [] });
  assert.equal(selection.status, 200); v = selection.body;
  const started = await s.send('POST', `/${id}/prepare`, { expectedRevision: v.template.revision, engine: 'ai' });
  assert.equal(started.status, 202);
  v = await s.prepared(id);
  assert.equal(v.product.preparing?.status, 'done', JSON.stringify(v.product.preparing));
  const p = v.product.prepared!;
  assert.equal(p.separation.ai?.offline, true); assert.equal(p.separation.costUsd, 0);
  const objects = [...v.product.objects.filter(o => o.cutout), ...(p.stands ?? []), ...(p.pieces ?? [])].sort((a, b) => a.z - b.z);
  assert.equal(v.product.objects.some(o => o.cutout?.evidence), flag === 'on');
  const evidence = join(out, 'evidence'); mkdirSync(evidence);
  for (const [name, f] of Object.entries({ source: template.source.inputFile, background: p.base.file, recombined: p.previews.recombined, clean: p.clean.file })) writeFileSync(join(evidence, `${name}.png`), asset(f));
  const W = template.source.width, H = template.source.height;
  for (const o of objects) {
    const c = o.cutout!, b = c.placement, layer = asset(c.file), scale = Math.min(4, Math.max(1, Math.floor(650 / b.height)));
    const big = await sharp(layer).resize(b.width * scale, b.height * scale, { kernel: 'nearest' }).png().toBuffer();
    const checker = Buffer.alloc(b.width * b.height * 3);
    for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) checker.fill(((x >> 3) + (y >> 3)) % 2 ? 210 : 255, (y * b.width + x) * 3, (y * b.width + x) * 3 + 3);
    const bgs = [await sharp(checker, { raw: { width: b.width, height: b.height, channels: 3 } }).png().toBuffer(),
      ...await Promise.all(['#ffffff', '#18181c'].map(background => sharp({ create: { width: b.width, height: b.height, channels: 3, background } }).png().toBuffer())),
      await sharp(asset(p.base.file)).extract({ left: b.x, top: b.y, width: b.width, height: b.height }).png().toBuffer()];
    const tiles = await Promise.all(bgs.map(bg => sharp(bg).resize(b.width * scale, b.height * scale, { kernel: 'nearest' }).composite([{ input: big }]).png().toBuffer()));
    await sharp({ create: { width: b.width * scale * 4, height: b.height * scale, channels: 3, background: '#fff' } }).composite(tiles.map((input, i) => ({ input, left: i * b.width * scale, top: 0 }))).png().toFile(join(evidence, `${o.id}-independent.png`));
    writeFileSync(join(evidence, `${o.id}.png`), layer);
    for (const move of [false, true]) {
      const parts = objects.filter(q => q.id !== o.id || move).map(q => { const r = q.cutout!.placement; return { input: asset(q.cutout!.file), left: q.id === o.id ? Math.max(0, Math.min(W - r.width, r.x + Math.round(r.width * 1.4))) : r.x, top: r.y }; });
      await sharp(asset(p.base.file)).composite(parts).png().toFile(join(evidence, `${o.id}-${move ? 'moved' : 'hidden'}.png`));
    }
  }
  const approved = await s.send('POST', `/${id}/approve`, { expectedRevision: v.template.revision, acknowledge: p.quality.issues.map(i => i.id) });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const published = await s.send('POST', `/${id}/publish`, { expectedRevision: approved.body.template.revision });
  assert.equal(published.status, 201);
  const creative = (await s.send<ProductCreative>('POST', `/${id}/creatives`, { name: `Evidence replay ${flag}` })).body;
  for (const o of objects) assert.equal(creative.objects.find(q => q.id === o.id)?.asset.file, o.cutout!.file);
  const opened = await s.send<{ runId: string }>('POST', `/${id}/creatives/${creative.id}/open`, {});
  assert.equal(opened.status, 201);
  const copy = (await s.send<ProductCreative>('POST', `/${id}/creatives/${creative.id}/duplicate`, {})).body;
  assert.deepEqual(copy.objects.map(o => o.asset), creative.objects.map(o => o.asset));
  assert(readFileSync(join(source, 'template.json')).equals(original), 'Source template changed');
  cpSync(s.root, join(out, 'store'), { recursive: true });
  writeFileSync(join(out, 'result.json'), JSON.stringify({ flag, id, creativeId: creative.id, runId: opened.body.runId, canvas: { width: W, height: H }, costUsd: p.separation.costUsd, quality: p.quality, objects: objects.map(o => ({ id: o.id, label: o.label, z: o.z, cutout: o.cutout })) }, null, 2));
  console.log(JSON.stringify({ out, id, flag, objects: objects.length, runId: opened.body.runId, costUsd: 0 }));
} finally { globalThis.fetch = realFetch; await s.close(); }
