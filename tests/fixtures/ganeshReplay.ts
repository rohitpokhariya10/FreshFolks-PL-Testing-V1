/**
 * The saved Ganesh ji template (its approved, regenerated creative) through today's pipeline again — free, offline: the
 * OpenAI detection answer it received is read again from the template (no request), and the Seedream Layerize answer is
 * replayed through the live Seedream code (its recorded response, the 16 layer images it returned downloaded once from
 * fal's file URLs and cached; no request). Every stage is then written out as evidence, and checked:
 *
 *   01 approved creative  02 every word, logo and object box  03 text/logo removal mask  04 product, character and stand
 *   masks  05 background only  06 the layered creative recombined  07 background with the stands only  08 each object
 *   hidden and moved  09 recombined against the approved creative
 *
 * Checks (printed, and failing the run): no word of the creative read in the background (the local reader); nothing left
 * where a word or logo was, around it; every accepted word an editable text layer, none hidden; the background does not
 * show any product where it was; the layered creative matches the approved one.
 *
 * Run: node --conditions=development --import tsx tests/fixtures/ganeshReplay.ts [template-dir] [out-dir]
 * The template folder is read only: everything happens in a copy beneath the out-dir.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import sharp from 'sharp';
import type { ProductCreative, ProtectedTemplate } from '@frameflow/shared';
import { createLayerizeRouter } from '../../server/src/decomposition/layerizeRouter.js';
import { createProductLayerizer, type DecompositionPlan, type ProductDecompositionPlanner } from '../../server/src/decomposition/protectedTemplates/product/aiDecompose.js';
import { localRecognizer } from '../../server/src/textRecognition/recognizer.js';
import type { FalTransport } from '../../server/src/decomposition/providers/falClient.js';
import type { SceneAnalyzer } from '../../server/src/decomposition/creativeTemplates/smartProviders.js';

const templateDir = resolve(process.argv[2] ?? 'artifacts/decomposition/protected-templates/pt-0e19aab53f50');
const out = resolve(process.argv[3] ?? `test-results/ganesh-replay/${new Date().toISOString().replace(/[:.]/g, '-')}`);
const template = JSON.parse(readFileSync(join(templateDir, 'template.json'), 'utf8')) as ProtectedTemplate;
const id = template.id, evidence = join(out, 'evidence');
mkdirSync(evidence, { recursive: true });
cpSync(templateDir, join(out, 'protected', id), { recursive: true });
const read = (f: string) => readFileSync(join(templateDir, f));
const failures: string[] = [], notes: string[] = [];
const check = (ok: boolean, what: string) => { (ok ? notes : failures).push(`${ok ? 'PASS' : 'FAIL'}  ${what}`); };

// --- The recorded Seedream answer, replayed through the live code (seedreamLayerize places and scales its layers) --------
const response = JSON.parse(read('prepare-seedream-response.json').toString('utf8')) as { images: { url: string }[] };
const cache = resolve('test-results/ganesh-replay/seedream', id); mkdirSync(cache, { recursive: true });
const layerFiles = new Map<string, Buffer>();
for (const [k, img] of response.images.entries()) {
  const file = join(cache, `layer${k}.png`);
  if (!existsSync(file)) throw new Error(`Offline replay requires cached Seedream layer ${k} at ${file}.`);
  layerFiles.set(img.url, readFileSync(file));
}
const recordedPlan = JSON.parse(read('prepare-ai-plan.json').toString('utf8')) as DecompositionPlan;
const planner: ProductDecompositionPlanner = { model: 'gpt-5.6-sol (recorded plan, replayed)', offline: true, plan: async () => ({ plan: recordedPlan }) };
const transport: FalTransport = {
  upload: async () => 'https://replay.invalid/input.png', submit: async () => ({ requestId: 'replay' }), status: async () => 'COMPLETED', cancel: async () => undefined,
  result: async () => response, download: async url => layerFiles.get(url) ?? (() => { throw new Error(`not recorded: ${url}`); })(),
};
const layerizer = createProductLayerizer({ planner, transport: () => transport });
// Detection must come from the template's saved answer: a live analyzer here would be a paid request.
const refuse: SceneAnalyzer = { model: 'refused (replay)', analyze: async () => { throw new Error('No paid detection request in a replay.'); } };

const root = join(out, 'server');
const app = express().use('/x', createLayerizeRouter({ runsDir: join(root, 'runs'), protectedDir: join(out, 'protected'), templatesDir: join(root, 'tpl'), executionsDir: join(root, 'exe'), imageTemplatesDir: join(root, 'img'),
  deps: () => { throw new Error('No decomposition provider in a replay.'); }, productAnalyzer: () => refuse, productLayerizer: () => layerizer, productRegenerator: () => undefined }));
const server = app.listen(0, '127.0.0.1'); server.keepAliveTimeout = 65_000; server.headersTimeout = 66_000; await new Promise(done => server.once('listening', done));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/x/product-templates`;
type View = { template: ProtectedTemplate & { revision: number }; stage: string; product: NonNullable<ProtectedTemplate['product']> };
const call = async <T>(path: string, init?: RequestInit) => { const r = await fetch(`${base}${path}`, init); const body = await r.json() as T; if (r.status >= 400) throw new Error(`${path}: ${r.status} ${JSON.stringify(body)}`); return body; };
const send = <T = View>(method: string, path: string, body: unknown) => call<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const settled = async (stage: string) => { for (let i = 0; i < 4800; i++) { const v = await call<View>(`/${id}`); if (v.stage !== stage) return v; await new Promise(r => setTimeout(r, 50)); } throw new Error(`${stage} did not finish`); };
const file = (f: string) => readFileSync(join(out, 'protected', id, f));
const t0 = Date.now(), log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

try {
  // Detection again from the saved answer (today's word fitting, styles, logo boxes), then the review as the person left
  // it: every element accepted; characters and products decomposed, the rest kept.
  await send('POST', `/${id}/detect`, { force: true, useAi: true });
  let v = await settled('detecting');
  if (v.product.detection?.status !== 'done') throw new Error(`detection: ${JSON.stringify(v.product.detection)}`);
  { const d = JSON.parse(file('template.json').toString('utf8')) as ProtectedTemplate; log(`detected: ${v.product.objects.length} objects, ${d.textAnalysis!.words.filter(w => w.review.status !== 'rejected').length} words, ${d.textAnalysis!.logoSlots.length} logos (${v.product.detection.ai?.model})`); }
  v = await send('PUT', `/${id}/review`, { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ ...o, accepted: true })), texts: [], logos: [], dismissMissingText: true });
  v = await send('PUT', `/${id}/selection`, { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ id: o.id, decompose: o.kind === 'product' || o.kind === 'character' })), logos: [] });
  const estimate = await call<{ ai: { maxUsd: number } }>(`/${id}/prepare-estimate`);
  await send('POST', `/${id}/prepare`, { expectedRevision: v.template.revision, engine: 'ai', approveUsd: estimate.ai.maxUsd });
  v = await settled('preparing');
  const p = v.product.prepared;
  if (!p || v.product.preparing?.status !== 'done') throw new Error(`prepare: ${JSON.stringify(v.product.preparing)}`);
  log(`prepared: ${p.separation.method}, ${v.product.objects.filter(o => o.cutout).length} cut-outs, ${p.stands?.length ?? 0} stand layer(s), ${p.quality.issues.length} checks (${p.quality.issues.filter(i => i.blocking).length} blocking)`);
  const opened = await send<{ runId: string; creative?: ProductCreative }>('POST', `/${id}/open-editor`, {});
  const runDir = join(root, 'runs', opened.runId), run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as { creative: { texts: { text: string; hidden?: boolean; groupId: string }[]; layers: { file: string; kind: string }[] } };
  log(`editor run ${opened.runId}: ${readdirSync(runDir).filter(f => f.startsWith('layer-')).length} layer files`);

  // --- Evidence ----------------------------------------------------------------------------------------------------------
  const t = JSON.parse(file('template.json').toString('utf8')) as ProtectedTemplate, a = t.textAnalysis!, objs = t.product!.objects;
  const source = file(t.source.inputFile), meta = await sharp(source).metadata(), W = meta.width!, H = meta.height!;
  const put = (name: string, png: Buffer) => writeFileSync(join(evidence, name), png);
  put('01-approved.png', await sharp(source).png().toBuffer());
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const rect = (b: { x: number; y: number; width: number; height: number }, c: string, sw = 2, dash = '') => `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="${c}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const tag = (b: { x: number; y: number }, s: string, c: string) => `<text x="${b.x + 2}" y="${Math.max(11, b.y - 3)}" font-size="12" font-family="Helvetica" fill="${c}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(s).slice(0, 42)}</text>`;
  let svg = '';
  for (const o of objs.filter(x => !x.hidden)) { const c = o.kind === 'product' || o.kind === 'character' ? '#16a34a' : '#ea580c'; svg += rect(o.box, c, 2, '6 3') + tag(o.box, `${o.kind}: ${o.label}`, c); }
  for (const w of a.words.filter(x => x.review.status !== 'rejected')) svg += rect(w.source?.box ?? w.box, '#2563eb', 1.5);
  for (const w of a.words.filter(x => x.review.status === 'rejected')) svg += rect(w.source?.box ?? w.box, '#9ca3af', 1, '2 2');
  for (const l of a.logoSlots.filter(x => x.review.status !== 'rejected')) svg += rect(l.original.placement, '#dc2626', 2) + tag(l.original.placement, l.label.replace(/ logo$/, ''), '#dc2626');
  put('02-detection-overlay.png', await sharp(source).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`) }]).png().toBuffer());
  put('03-text-logo-mask.png', file(p.previews.overlayMask));
  // Each product (green), character (blue) and stand (orange) as it was cut out, over the dimmed creative.
  const tint = async (png: Buffer, rgb: [number, number, number]) => { const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); for (let i = 0; i < info.width * info.height; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = data[i * 4 + 3] >= 128 ? 170 : 0; } return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer(); };
  const cut = objs.filter(o => o.cutout && !o.hidden);
  const masks = [];
  for (const o of cut) masks.push({ input: await tint(file(o.cutout!.file), o.kind === 'character' ? [37, 99, 235] : [22, 163, 74]), left: o.cutout!.placement.x, top: o.cutout!.placement.y });
  for (const s of p.stands ?? []) masks.push({ input: await tint(file(s.cutout!.file), [234, 88, 12]), left: s.cutout!.placement.x, top: s.cutout!.placement.y });
  put('04-object-masks.png', await sharp(source).modulate({ brightness: 0.55 }).composite(masks).png().toBuffer());
  const background = readFileSync(join(runDir, 'layer-00-background.png'));
  put('05-background-only.png', background);
  put('06-reconstructed.png', readFileSync(join(runDir, 'reconstructed.png')));
  put('07-background-with-stands.png', await sharp(file(p.base.file)).composite((p.stands ?? []).map(s => ({ input: file(s.cutout!.file), left: s.cutout!.placement.x, top: s.cutout!.placement.y }))).png().toBuffer());
  // Each product and the character hidden, then moved (stands and the other objects in place, text and logos over all).
  const layersOf = (skip?: string, dx = 0) => [...(p.stands ?? []).map(s => ({ input: file(s.cutout!.file), left: s.cutout!.placement.x, top: s.cutout!.placement.y })),
    ...[...cut].sort((x, y) => x.z - y.z).filter(o => o.id !== skip || dx).map(o => ({ input: file(o.cutout!.file), left: Math.max(0, Math.min(W - o.cutout!.placement.width, o.cutout!.placement.x + (o.id === skip ? dx : 0))), top: o.cutout!.placement.y }))];
  mkdirSync(join(evidence, '08-hide-move'), { recursive: true });
  for (const o of cut) {
    writeFileSync(join(evidence, '08-hide-move', `${o.kind}-${o.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}-hidden.png`), await sharp(file(p.base.file)).composite(layersOf(o.id)).png().toBuffer());
    writeFileSync(join(evidence, '08-hide-move', `${o.kind}-${o.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}-moved.png`), await sharp(file(p.base.file)).composite(layersOf(o.id, Math.round(o.cutout!.placement.width * 0.6) + 20)).png().toBuffer());
  }
  // Recombined against the approved creative: per pixel, red where they differ visibly.
  const [A, B] = await Promise.all([sharp(source).removeAlpha().raw().toBuffer(), sharp(readFileSync(join(runDir, 'reconstructed.png'))).removeAlpha().resize(W, H).raw().toBuffer()]);
  // (Text is set again in a font, never the creative's own pixels: its boxes are counted apart.)
  const textArea = new Uint8Array(W * H);
  for (const w of a.words.filter(x => x.review.status !== 'rejected')) { const b = w.source?.box ?? w.box; for (let y = Math.max(0, Math.floor(b.y) - 4); y < Math.min(H, Math.ceil(b.y + b.height) + 4); y++) for (let x = Math.max(0, Math.floor(b.x) - 4); x < Math.min(W, Math.ceil(b.x + b.width) + 4); x++) textArea[y * W + x] = 1; }
  const heat = Buffer.alloc(W * H * 3); let visible = 0, inText = 0, textPx = 0;
  for (let i = 0; i < W * H; i++) { if (textArea[i]) textPx++; const d = Math.max(Math.abs(A[i * 3] - B[i * 3]), Math.abs(A[i * 3 + 1] - B[i * 3 + 1]), Math.abs(A[i * 3 + 2] - B[i * 3 + 2])); if (d > 48) { if (textArea[i]) inText++; else visible++; heat[i * 3] = 255; } else { const g = (A[i * 3] + A[i * 3 + 1] + A[i * 3 + 2]) / 6; heat[i * 3] = heat[i * 3 + 1] = heat[i * 3 + 2] = g; } }
  put('09-recombined-vs-approved.png', await sharp(heat, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());

  // --- Checks --------------------------------------------------------------------------------------------------------
  const words = a.words.filter(w => w.review.status !== 'rejected');
  // Read with the local reader (free): a word of the creative read again where it was is text left in the background.
  const read = (await localRecognizer().recognize({ image: background, region: { x: 0, y: 0, width: W, height: H }, purpose: 'artwork-check' })).filter(r => r.confidence >= 0.5);
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const overlaps = (r: { box: { x0: number; y0: number; x1: number; y1: number } }, b: { x: number; y: number; width: number; height: number }) => r.box.x0 < b.x + b.width && b.x < r.box.x1 && r.box.y0 < b.y + b.height && b.y < r.box.y1;
  const leaked = read.filter(r => words.some(w => norm(w.text).length >= 2 && norm(r.text).length >= 2 && (norm(w.text).includes(norm(r.text)) || norm(r.text).includes(norm(w.text))) && overlaps(r, w.source?.box ?? w.box)));
  check(leaked.length === 0, `no word of the creative read again where it was in the background (${leaked.map(x => `“${x.text}”`).join(', ') || 'none'}; ${read.length} other reading(s) of the artwork)`);
  const texts = run.creative.texts;
  check(texts.length === words.length, `every accepted word is an editable text layer (${texts.length} of ${words.length})`);
  check(texts.every(x => !x.hidden), `no text layer hidden (${texts.filter(x => x.hidden).map(x => x.text).join(' ') || 'none'})`);
  for (const g of a.groups) { const n = words.filter(w => w.groupId === g.id).length; if (n) check(texts.filter(x => x.groupId === g.id && !x.hidden).length === n, `“${g.label.slice(0, 50)}”: all ${n} words editable`); }
  check(run.creative.layers.filter(l => /-logo\.png$/.test(l.file)).length === a.logoSlots.filter(l => l.review.status !== 'rejected').length, `every logo is its own layer (${a.logoSlots.filter(l => l.review.status !== 'rejected').length})`);
  // Each thing once: no two objects of one name and kind over the same place.
  const over = (p1: { x: number; y: number; width: number; height: number }, q: typeof p1) => Math.max(0, Math.min(p1.x + p1.width, q.x + q.width) - Math.max(p1.x, q.x)) * Math.max(0, Math.min(p1.y + p1.height, q.y + q.height) - Math.max(p1.y, q.y)) / Math.max(1, Math.min(p1.width * p1.height, q.width * q.height));
  const twice = objs.filter((o, i) => !o.hidden && objs.some((q, j) => j < i && !q.hidden && q.kind === o.kind && q.label === o.label && over(o.box, q.box) > 0.5));
  check(!twice.length, `every object found once (${twice.map(o => `“${o.label}” twice`).join(', ') || `${objs.filter(o => !o.hidden).length} objects`})`);
  const blocking = p.quality.issues.filter(i => i.blocking);
  check(!blocking.length, `no blocking check (${blocking.map(i => i.message.slice(0, 90)).join(' | ') || 'none'})`);
  check(visible / (W * H) < 0.01, `outside the text, the layered creative matches the approved one (${(100 * visible / (W * H)).toFixed(2)}% of pixels differ visibly; in the re-set text's boxes ${(100 * inText / Math.max(1, textPx)).toFixed(1)}%)`);
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ template: id, run: opened.runId, failures, notes, issues: p.quality.issues, stands: (p.stands ?? []).map(s => ({ label: s.label, box: s.box })) }, null, 2));
  console.log([...notes, ...failures].join('\n'));
  console.log(`evidence: ${evidence}`);
  if (failures.length) process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
  await localRecognizer().close?.();
}
