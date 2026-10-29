/**
 * AI word boxes fitted to the letters they name. The analysis model reads a downscaled copy of the picture and its word
 * boxes can be off by more than a stroke: on a tall 2534 × 4096 Onam creative every line sat 13–28 px above its letters
 * (the last one 50 px, a whole line), and the words of each body line were squeezed together, 11–17 % too close, so the
 * last words of a line were up to ~130 px left of their letters. Such a line's ink colour is measured on the background,
 * its letters stay in the picture, and the overlay gate (prepare.ts) refuses to send it.
 *
 * Each line is fitted on its own, conservatively, in this order:
 *  1 Letters: the on-device recognizer (tesseract, no network) reads a band around the line, never reaching another line
 *    (at most half a line past the gap to it). Its words are matched to the line's words by their text; the vertical move
 *    most matches agree on is the line's, and the matched words' letter edges give the line's horizontal map (a stretch
 *    and a shift). Matched words take their letters' left and right edges; the others follow the line's map. Heights stay.
 *    Light lettering on a dark or coloured ground (white words on a ribbon, a button, a badge) is not read by the
 *    recognizer as it is: when too few words are read, the band is read again with its colours inverted.
 *  2 Strokes: when the letters cannot be read (artwork lettering, too few matches, matches that disagree), the line moves
 *    as one to where the picture has the most letter strokes inside its words and the fewest in the gaps between them,
 *    half a line before and after it and just above and below it; only when that is clearly better than where it is and
 *    clearly better than any place a line away (else it is ambiguous). A guess from strokes alone moves a line at most one
 *    line (a busy ornament beside the words — sweets, a pattern — has more strokes than the letters), and never onto a
 *    line placed by its letters or left where it was.
 *  3 Otherwise the line stays as the analysis gave it, for a person to correct.
 * Deterministic and local; no provider is involved.
 */
import sharp from 'sharp';
import type { Rgba } from '../pixels.js';
import type { WordRecognizer } from '../../../textRecognition/recognizer.js';

type Box = { x: number; y: number; width: number; height: number };
export interface LineFit {
  /** letters: read by the recognizer; strokes: by the picture's letter strokes; kept: not moved. */
  method: 'letters' | 'strokes' | 'kept';
  /** Each word's box (same order as given); the boxes given when kept. */
  boxes: Box[];
  /** The line's vertical move, and how far its words moved at most (px). */
  dy: number; moved: number;
  /** Letters: the words matched / given. */
  matched?: number;
  /** Automatic placement was inconclusive; ask a person to check the source lettering. */
  needsReview?: boolean;
  reason?: string;
}

const extent = (boxes: Box[]) => ({ left: Math.min(...boxes.map(b => b.x)), top: Math.min(...boxes.map(b => b.y)), right: Math.max(...boxes.map(b => b.x + b.width)), bottom: Math.max(...boxes.map(b => b.y + b.height)) });
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const lineHeight = (boxes: Box[]) => median(boxes.map(b => b.height));
const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
const round = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) });
const furthest = (from: Box[], to: Box[]) => Math.max(0, ...from.map((b, i) => Math.max(Math.abs(to[i].x - b.x), Math.abs(to[i].x + to[i].width - b.x - b.width), Math.abs(to[i].y - b.y))));

/** How far each line may move up and down: never onto another line (half a line past the gap to it, at most 1.5 lines). */
export function lineLimits(lines: Box[][]): { up: number; down: number }[] {
  const spans = lines.map(l => l.length ? extent(l) : undefined);
  return lines.map((boxes, i) => {
    const me = spans[i];
    if (!me) return { up: 0, down: 0 };
    const half = lineHeight(boxes) / 2, reach = 3 * half;
    let up = reach, down = reach;
    spans.forEach((o, j) => {
      if (!o || j === i || o.right <= me.left || o.left >= me.right) return;
      if (o.bottom <= me.top + half) up = Math.min(up, Math.max(0, me.top - o.bottom) + half);
      else if (o.top >= me.bottom - half) down = Math.min(down, Math.max(0, o.top - me.bottom) + half);
    });
    return { up: Math.floor(up), down: Math.floor(down) };
  });
}

/**
 * Every line of AI words fitted to its letters (see above), in the order given. keep: lines left as they are (corrected
 * by a person, rotated, not the analysis's); they still hold their place, so no other line moves onto them.
 */
export async function fitLines(source: Rgba, lines: { text: string; box: Box }[][], recognizer?: WordRecognizer, keep: boolean[] = []): Promise<LineFit[]> {
  const limits = lineLimits(lines.map(l => l.map(w => w.box))), out: LineFit[] = [];
  for (const [i, line] of lines.entries()) {
    const boxes = line.map(w => w.box), kept: LineFit = { method: 'kept', boxes, dy: 0, moved: 0 };
    if (!line.length || keep[i]) { out.push(kept); continue; }
    const read = recognizer ? await fitByLetters(source, line, limits[i], recognizer) : undefined;
    if (read && 'boxes' in read) { out.push(read); continue; }
    const shift = lineShift(source, boxes, limits[i]);
    if (shift.dx || shift.dy) {
      const moved = boxes.map(b => ({ ...b, x: b.x + shift.dx, y: b.y + shift.dy }));
      out.push({ method: 'strokes', boxes: moved, dy: shift.dy, moved: furthest(boxes, moved), reason: read?.reason });
    } else out.push({ ...kept, needsReview: !!read?.reason || !!shift.reason, reason: [read?.reason, shift.reason].filter(Boolean).join('; ') || undefined });
  }
  // A line moved by its strokes alone that lands on another line (placed by its letters, or left where it was) moved onto
  // that line's letters: it stays where the analysis put it.
  const across = (a: Box[], b: Box[]) => { const p = extent(a), q = extent(b); return Math.min(p.right, q.right) > Math.max(p.left, q.left) ? Math.max(0, Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top)) : 0; };
  out.forEach((f, i) => {
    if (f.method !== 'strokes') return;
    const onto = out.findIndex((g, j) => j !== i && g.method !== 'strokes' && across(f.boxes, g.boxes) > lineHeight(f.boxes) * 0.25);
    if (onto >= 0) out[i] = { method: 'kept', boxes: lines[i].map(w => w.box), dy: 0, moved: 0, needsReview: true, reason: [f.reason, `its strokes lay on the line “${lines[onto].map(w => w.text).join(' ').slice(0, 40)}”`].filter(Boolean).join('; ') };
  });
  return out;
}

/**
 * The analysis's own words (one list, each naming its group and line) fitted line by line before anything is measured
 * from them; rotated lines stay. Returns the words with their fitted boxes and what each line did.
 */
export async function fitSceneWords<W extends { text: string; group: string; line: string; box: Box & { rotation?: number } }>(source: Rgba, words: W[], recognizer?: WordRecognizer): Promise<{ words: W[]; lines: { text: string; method: LineFit['method']; dy: number; moved: number; matched?: number; needsReview?: boolean; reason?: string }[]; reviewIndexes: number[] }> {
  const byLine = new Map<string, number[]>();
  words.forEach((w, i) => { const key = `${w.group}:${w.line}`; byLine.set(key, [...(byLine.get(key) ?? []), i]); });
  const groups = [...byLine.values()], fits = await fitLines(source, groups.map(ix => ix.map(i => ({ text: words[i].text, box: words[i].box }))), recognizer, groups.map(ix => ix.some(i => !!words[i].box.rotation)));
  const out = [...words];
  groups.forEach((ix, g) => { if (fits[g].method !== 'kept') ix.forEach((i, k) => { out[i] = { ...words[i], box: { ...words[i].box, ...fits[g].boxes[k] } }; }); });
  return { words: out, reviewIndexes: groups.flatMap((ix, g) => fits[g].needsReview ? ix : []), lines: groups.map((ix, g) => ({ text: ix.map(i => words[i].text).join(' ').slice(0, 120), method: fits[g].method, dy: fits[g].dy, moved: fits[g].moved, matched: fits[g].matched, needsReview: fits[g].needsReview, reason: fits[g].reason })) };
}

/**
 * Each word's box made the box of its own letters: grown over the parts of its letters past it and shrunk off what is
 * no letter. The model's word boxes, even fitted (above: "heights stay", edges as read), can cut a word's letters — the
 * 9:16 Ganesh headline's "A" box ended in its right leg, "grand" above its descender, "Bappa" through its "B" — and a
 * word's colour, size and place are measured in its box: white "A grand" was stored as the mint of its letters' soft
 * edges, drawn nearly invisible on its green signboard, its size and baseline off.
 *
 * Per line, on a plain ground (60 % of what is just around its words or more near its commonest colours, at most three:
 * a plate over a panel; else the line stays as it is): the
 * band's ink (unlike the ground) in connected pieces, never in another line's words. A piece is a word's when 40 % of it
 * or more lies in that word's box (the one holding most of it); a piece taller than 1.5 lines, wider than the line,
 * reaching the band's edge, or flat and long is a rule, a frame or a border, no letter; a small one (a dot, a comma) only next to that
 * word's other letters (a frame's dots inside a loose box are no letters). Each word's box becomes its pieces' box, one
 * pixel out for their soft edges; each edge moves at most half a line. A word without pieces keeps its box.
 */
export function fitWordsToInk<W extends { text: string; group: string; line: string; box: Box & { rotation?: number } }>(source: Rgba, words: W[]): W[] {
  const { width: SW, height: SH, data } = source, out = [...words], byLine = new Map<string, number[]>();
  words.forEach((w, i) => { const key = `${w.group}:${w.line}`; byLine.set(key, [...(byLine.get(key) ?? []), i]); });
  const dist = (i: number, g: number[]) => Math.max(Math.abs(data[i * 4] - g[0]), Math.abs(data[i * 4 + 1] - g[1]), Math.abs(data[i * 4 + 2] - g[2]));
  for (const ix of byLine.values()) {
    if (ix.some(i => words[i].box.rotation)) continue;
    const boxes = ix.map(i => words[i].box), lh = lineHeight(boxes), e = extent(boxes);
    if (lh < 6) continue;
    const others = words.filter((_, i) => !ix.includes(i)).map(w => w.box);
    const X0 = Math.max(0, Math.floor(e.left - lh)), X1 = Math.min(SW, Math.ceil(e.right + lh)), Y0 = Math.max(0, Math.floor(e.top - 0.5 * lh)), Y1 = Math.min(SH, Math.ceil(e.bottom + 0.6 * lh));
    const BW = X1 - X0, BH = Y1 - Y0, inBox = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
    const blocked = new Uint8Array(BW * BH);
    for (const b of others) for (let y = Math.max(Y0, Math.floor(b.y)); y < Math.min(Y1, Math.ceil(b.y + b.height)); y++) for (let x = Math.max(X0, Math.floor(b.x)); x < Math.min(X1, Math.ceil(b.x + b.width)); x++) blocked[(y - Y0) * BW + x - X0] = 1;
    // The ground: just around the words (a third of a line out), its commonest colours (a panel inside a badge's frame: not
    // a mix of the frame's colours); plain when 60 % of it or more is near them.
    const GX0 = Math.max(X0, Math.floor(e.left - 0.3 * lh)), GX1 = Math.min(X1, Math.ceil(e.right + 0.3 * lh)), GY0 = Math.max(Y0, Math.floor(e.top - 0.3 * lh)), GY1 = Math.min(Y1, Math.ceil(e.bottom + 0.3 * lh));
    const around: number[][] = [[], [], []];
    for (let y = GY0 - Y0; y < GY1 - Y0; y += 2) for (let x = GX0 - X0; x < GX1 - X0; x += 2) {
      if (blocked[y * BW + x] || boxes.some(b => inBox(b, x + X0, y + Y0))) continue;
      const i = ((y + Y0) * SW + x + X0) * 4; for (let c = 0; c < 3; c++) around[c].push(data[i + c]);
    }
    if (around[0].length < 20) continue;
    // (Up to three colours, each common there: a word on a yellow plate over a cream panel has both around it. Each the
    // commonest of what is left, with everything near it.)
    const total = around[0].length, grounds: number[][] = [], near = (k: number, g: number[]) => Math.max(...[0, 1, 2].map(c => Math.abs(around[c][k] - g[c]))) <= 30;
    let rest = Array.from({ length: total }, (_, k) => k);
    for (let round = 0; round < 3 && rest.length; round++) {
      const tally = new Map<number, number[]>();
      for (const k of rest) { const key = (around[0][k] >> 4 << 8) | (around[1][k] >> 4 << 4) | (around[2][k] >> 4), b = tally.get(key); if (b) b.push(k); else tally.set(key, [k]); }
      const top = [...tally.values()].sort((p, q) => q.length - p.length)[0], g = [0, 1, 2].map(c => median(top.map(k => around[c][k]))), members = rest.filter(k => near(k, g));
      if (round && members.length < total * 0.15) break;
      grounds.push(g); rest = rest.filter(k => !near(k, g));
    }
    if (total - rest.length < total * 0.6) continue;
    const off = (i: number) => Math.min(...grounds.map(g => dist(i, g)));
    // Ink: clearly unlike the ground (at least 45 % of the strongest difference inside the words, and 40).
    const strongest: number[] = [];
    for (const b of boxes) for (let y = Math.max(0, b.y); y < Math.min(SH, b.y + b.height); y += 2) for (let x = Math.max(0, b.x); x < Math.min(SW, b.x + b.width); x += 2) strongest.push(off(y * SW + x));
    strongest.sort((p, q) => p - q);
    const T = Math.max(40, 0.45 * (strongest[Math.floor(strongest.length * 0.98)] ?? 0)), ink = new Uint8Array(BW * BH);
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) if (!blocked[y * BW + x] && off((y + Y0) * SW + x + X0) > T) ink[y * BW + x] = 1;
    // Pieces (8-connected), each given to the word holding most of it.
    const seen = new Uint8Array(BW * BH), mine: { x0: number; y0: number; x1: number; y1: number; small: boolean }[][] = ix.map(() => []);
    for (let s = 0; s < BW * BH; s++) {
      if (!ink[s] || seen[s]) continue;
      const stack = [s], counts = new Array<number>(ix.length).fill(0); seen[s] = 1;
      let size = 0, x0 = BW, y0 = BH, x1 = -1, y1 = -1;
      while (stack.length) {
        const q = stack.pop()!, qx = q % BW, qy = (q - qx) / BW; size++;
        x0 = Math.min(x0, qx); x1 = Math.max(x1, qx); y0 = Math.min(y0, qy); y1 = Math.max(y1, qy);
        boxes.forEach((b, k) => { if (inBox(b, qx + X0, qy + Y0)) counts[k]++; });
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = qx + dx, Y = qy + dy; if (X < 0 || Y < 0 || X >= BW || Y >= BH) continue; const t = Y * BW + X; if (ink[t] && !seen[t]) { seen[t] = 1; stack.push(t); } }
      }
      const k = counts.indexOf(Math.max(...counts));
      // (Nor a flat rule — a panel's border line, broken by its ornament into pieces narrower than the line.)
      if (counts[k] < size * 0.4 || y1 - y0 + 1 > 1.5 * lh || x1 - x0 + 1 > e.right - e.left || x0 === 0 || y0 === 0 || x1 === BW - 1 || y1 === BH - 1) continue;
      if (y1 - y0 + 1 <= 0.12 * lh && x1 - x0 + 1 >= 0.8 * lh) continue;
      mine[k].push({ x0: x0 + X0, y0: y0 + Y0, x1: x1 + X0 + 1, y1: y1 + Y0 + 1, small: Math.max(x1 - x0 + 1, y1 - y0 + 1) < 0.25 * lh });
    }
    ix.forEach((i, k) => {
      const big = mine[k].filter(p => !p.small); if (!big.length) return;
      const bx0 = Math.min(...big.map(p => p.x0)), bx1 = Math.max(...big.map(p => p.x1)), by0 = Math.min(...big.map(p => p.y0)), by1 = Math.max(...big.map(p => p.y1));
      const near = mine[k].filter(p => !p.small || (p.x1 >= bx0 - 0.3 * lh && p.x0 <= bx1 + 0.3 * lh && p.y1 >= by0 - 0.3 * lh && p.y0 <= by1 + 0.3 * lh));
      const b = words[i].box, limit = lh / 2, clamp = (v: number, was: number) => Math.max(was - limit, Math.min(was + limit, v));
      const left = clamp(Math.min(...near.map(p => p.x0)) - 1, b.x), right = clamp(Math.max(...near.map(p => p.x1)) + 1, b.x + b.width);
      const top = clamp(Math.min(...near.map(p => p.y0)) - 1, b.y), bottom = clamp(Math.max(...near.map(p => p.y1)) + 1, b.y + b.height);
      out[i] = { ...words[i], box: { ...b, ...round({ x: Math.max(0, left), y: Math.max(0, top), width: Math.min(SW, right) - Math.max(0, left), height: Math.min(SH, bottom) - Math.max(0, top) }) } };
    });
  }
  return out;
}

/** Step 1: the line's letters read by the recognizer. A fit, or why there is none. */
async function fitByLetters(source: Rgba, line: { text: string; box: Box }[], limit: { up: number; down: number }, recognizer: WordRecognizer): Promise<LineFit | { reason: string }> {
  const boxes = line.map(w => w.box), lh = lineHeight(boxes), e = extent(boxes), spread = (e.right - e.left) * 0.25 + lh;
  const region = { x: Math.max(0, Math.floor(e.left - spread)), y: Math.max(0, Math.floor(e.top - limit.up)) };
  const r = { ...region, width: Math.min(source.width, Math.ceil(e.right + spread)) - region.x, height: Math.min(source.height, Math.ceil(e.bottom + limit.down)) - region.y };
  if (r.width < 8 || r.height < 8) return { reason: 'too small to read' };
  const image = await sharp(Buffer.from(source.data.buffer, source.data.byteOffset, source.data.length), { raw: { width: source.width, height: source.height, channels: 4 } }).extract({ left: r.x, top: r.y, width: r.width, height: r.height }).png().toBuffer();
  const read = async (png: Buffer) => (await recognizer.recognize({ image: png, region: r, purpose: 'template' })).map(f => ({ key: norm(f.text), x0: r.x + f.box.x0, x1: r.x + f.box.x1, y0: r.y + f.box.y0, y1: r.y + f.box.y1 })).filter(f => f.key);
  const first = await read(image), fit = lettersFit(source, line, limit, r, first);
  if ('boxes' in fit) return fit;
  // Light lettering on a dark or coloured ground (white words on a ribbon or a button): read again with its colours
  // inverted, with what was read as it is.
  const again = lettersFit(source, line, limit, r, [...first, ...await read(await sharp(image).negate({ alpha: false }).png().toBuffer())]);
  return 'boxes' in again ? again : fit;
}

/** The letters' fit of a line from what was read in the band `r` (fitByLetters). A fit, or why there is none. */
function lettersFit(source: Rgba, line: { text: string; box: Box }[], limit: { up: number; down: number }, r: Box, found: { key: string; x0: number; x1: number; y0: number; y1: number }[]): LineFit | { reason: string } {
  const boxes = line.map(w => w.box), lh = lineHeight(boxes);
  // Candidates: a read word with the same letters, its centre within the line's allowed move.
  const options = line.map((w, k) => { const b = boxes[k], cy = b.y + b.height / 2, key = norm(w.text);
    return key ? found.filter(f => f.key === key).map(f => ({ f, dy: (f.y0 + f.y1) / 2 - cy })).filter(o => o.dy >= -limit.up && o.dy <= limit.down) : []; });
  // The vertical move most words agree on (within a quarter line); ties: the smaller move.
  const tolerance = lh / 4, votes = options.flat().map(o => o.dy).sort((a, b) => Math.abs(a) - Math.abs(b));
  let dy = 0, support = 0;
  for (const v of votes) { const n = options.filter(os => os.some(o => Math.abs(o.dy - v) <= tolerance)).length; if (n > support) { support = n; dy = v; } }
  const words = line.filter(w => norm(w.text)).length;
  if (support < Math.min(2, words) || support < words * 0.4) return { reason: `the letters were read for ${support} of ${words} words` };
  // The same words as well supported half a line or more away (a line printed twice): ambiguous.
  const rival = Math.max(0, ...votes.filter(v => Math.abs(v - dy) >= lh / 2).map(v => options.filter(os => os.some(o => Math.abs(o.dy - v) <= tolerance)).length));
  if (rival >= support) return { reason: 'ambiguous: the same words were read as well on another line' };
  // Each agreeing word takes, of its readings near that move, the narrowest (reading a rule or an ornament with a word
  // only ever widens it), left to right without crossing.
  const matched: { k: number; f: typeof found[number] }[] = [];
  options.forEach((os, k) => { const near = os.filter(o => Math.abs(o.dy - dy) <= tolerance).sort((a, b) => (a.f.x1 - a.f.x0) - (b.f.x1 - b.f.x0) || Math.abs(a.dy - dy) - Math.abs(b.dy - dy))[0]; if (near) matched.push({ k, f: near.f }); });
  const byAi = [...matched].sort((p, q) => boxes[p.k].x - boxes[q.k].x);
  if (byAi.some((m, j) => j && m.f.x0 < byAi[j - 1].f.x1 - lh / 4)) return { reason: 'the read words are in a different order' };
  dy = median(matched.map(m => (m.f.y0 + m.f.y1) / 2 - (boxes[m.k].y + boxes[m.k].height / 2)));
  // Which letter edges are evidence: not one cut at the band's border (a rule or ornament running on from the word, read
  // with it), nor those of a word read far wider than the line's other words are against their boxes.
  // (The picture's own edge is no cut: nothing runs on past it.)
  const atBorder = (x: number) => (r.x > 0 && x <= r.x + 2) || (r.x + r.width < source.width && x >= r.x + r.width - 2), ratio = (m: typeof matched[number]) => (m.f.x1 - m.f.x0) / Math.max(1, boxes[m.k].width);
  const typical = median(matched.map(ratio)), wide = (m: typeof matched[number]) => matched.length >= 3 && ratio(m) > typical * 1.6;
  const trusted = (m: typeof matched[number], x: number) => !atBorder(x) && !wide(m);
  // The line's horizontal map, through those edges left to right (where the analysis's word boxes and their letters'
  // edges both increase); past the ends, the end piece's stretch, held to 0.67–1.5 (one point: a shift).
  const pts = matched.flatMap(m => [[boxes[m.k].x, m.f.x0], [boxes[m.k].x + boxes[m.k].width, m.f.x1]].filter(([, x]) => trusted(m, x))).sort((p, q) => p[0] - q[0]);
  const control: number[][] = [];
  for (const p of pts) if (!control.length || (p[0] > control[control.length - 1][0] && p[1] > control[control.length - 1][1])) control.push(p);
  if (!control.length) return { reason: 'the read words were cut at the edge of what was read' };
  const slope = (p: number[], q: number[]) => Math.min(1.5, Math.max(0.67, (q[1] - p[1]) / (q[0] - p[0])));
  const map = (x: number) => {
    if (control.length === 1) return x + control[0][1] - control[0][0];
    const j = control.findIndex(p => p[0] >= x);
    if (j === 0) return control[0][1] + (x - control[0][0]) * slope(control[0], control[1]);
    if (j < 0) { const p = control[control.length - 2], q = control[control.length - 1]; return q[1] + (x - q[0]) * slope(p, q); }
    const p = control[j - 1], q = control[j]; return p[1] + (x - p[0]) * (q[1] - p[1]) / (q[0] - p[0]);
  };
  // Each word: its letters' edges where they are evidence; a matched word's other edge at its outermost letter column
  // inside what was read (a rule read with it is a thin stripe, no letter); an unmatched word where the map puts it.
  // Moved by the line's vertical move, and grown to hold taller letters (an edge within a third of a line of the box).
  const fitted = boxes.map((bx, idx) => {
    const m = matched.find(q => q.k === idx), x0 = map(bx.x), x1 = map(bx.x + bx.width), y0 = bx.y + dy, y1 = y0 + bx.height;
    if (!m) return round({ x: x0, y: y0, width: Math.max(1, x1 - x0), height: bx.height });
    const okLeft = trusted(m, m.f.x0), okRight = trusted(m, m.f.x1), cols = okLeft && okRight ? undefined : letterColumns(source, { x: m.f.x0, y: m.f.y0, width: m.f.x1 - m.f.x0, height: m.f.y1 - m.f.y0 });
    const left = okLeft ? m.f.x0 : cols?.[0] ?? x0, right = okRight ? m.f.x1 : cols?.[1] ?? x1;
    const top = m.f.y0 < y0 && y0 - m.f.y0 <= lh / 3 ? m.f.y0 : y0, bottom = m.f.y1 > y1 && m.f.y1 - y1 <= lh / 3 ? m.f.y1 : y1;
    return round({ x: left, y: top, width: Math.max(1, right - left), height: bottom - top });
  });
  if (fitted.some((f, j) => fitted.some((g, q) => q !== j && boxes[q].x > boxes[j].x && g.x < f.x + f.width - lh / 4))) return { reason: 'the fitted words would overlap' };
  return { method: 'letters', boxes: fitted, dy: Math.round(dy), moved: furthest(boxes, fitted), matched: matched.length };
}

/**
 * The first and last letter columns inside `box` (a word as read, perhaps with a rule or ornament beside it): columns in
 * which a fifth or more of the box's middle rows differ from its background (its most common colour). A horizontal
 * rule or a dotted line fills only a few rows of a column and is no letter. Undefined: no letter column.
 */
export function letterColumns(source: Rgba, box: Box): [number, number] | undefined {
  const { width: W, height: H, data } = source, x0 = Math.max(0, Math.floor(box.x)), x1 = Math.min(W, Math.ceil(box.x + box.width));
  const y0 = Math.max(0, Math.floor(box.y + box.height * 0.1)), y1 = Math.min(H, Math.ceil(box.y + box.height * 0.9));
  if (x1 - x0 < 2 || y1 - y0 < 4) return undefined;
  const buckets = new Map<number, number>(), key = (i: number) => (data[i] >> 4 << 8) | (data[i + 1] >> 4 << 4) | (data[i + 2] >> 4);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = key((y * W + x) * 4); buckets.set(k, (buckets.get(k) ?? 0) + 1); }
  const ground = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0][0], bg = [(ground >> 8) * 16 + 8, ((ground >> 4) & 15) * 16 + 8, (ground & 15) * 16 + 8];
  const letter = (x: number) => { let n = 0; for (let y = y0; y < y1; y++) { const i = (y * W + x) * 4; if (Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) > 60) n++; } return n >= (y1 - y0) / 5; };
  let first = -1, last = -1;
  for (let x = x0; x < x1; x++) if (letter(x)) { if (first < 0) first = x; last = x; }
  return first < 0 ? undefined : [first, last + 1];
}

/**
 * A letter stroke: brightness changing sharply between neighbouring pixels of a row, at least 0.4 of the strongest such
 * changes around the line (its letters' own edges, even when they are few: under 1 % of the pixels for one line), so a
 * faint background pattern is no stroke.
 */
const strokeThreshold = (gradients: Float32Array) => { const s = Float32Array.from(gradients).sort(); return Math.max(32, 0.4 * (s[Math.floor(s.length * 0.995)] ?? 0)); };

/**
 * Step 2: how far one line should move as one to sit on its letter strokes; 0, 0 (with why) to stay. limits: how far it
 * may go up and down (lineLimits).
 */
export function lineShift(source: Rgba, boxes: Box[], limits: { up: number; down: number }): { dx: number; dy: number; reason?: string } {
  const { width: W, height: H, data } = source;
  if (!boxes.length) return { dx: 0, dy: 0 };
  // (At most one line up or down: a busy ornament a line away has more strokes than the letters.)
  const lh = lineHeight(boxes), rx = Math.round(0.5 * lh), ryUp = Math.min(Math.round(lh), limits.up), ryDown = Math.min(Math.round(lh), limits.down);
  const { left, top, right, bottom } = extent(boxes), margin = Math.ceil(lh / 2);
  const x0 = Math.max(0, Math.floor(left) - margin - rx), x1 = Math.min(W - 1, Math.ceil(right) + margin + rx), y0 = Math.max(0, Math.floor(top) - margin - ryUp), y1 = Math.min(H, Math.ceil(bottom) + margin + ryDown);
  const ww = x1 - x0, hh = y1 - y0;
  if (lh < 4 || ww < 4 || hh < 4) return { dx: 0, dy: 0, reason: 'too small' };
  const lum = (i: number) => data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114, grad = new Float32Array(ww * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) { const i = (y + y0) * W + x0 + x; grad[y * ww + x] = Math.abs(lum(i + 1) - lum(i)); }
  const T = strokeThreshold(grad), stride = ww + 1, sat = new Float64Array(stride * (hh + 1));
  for (let y = 0; y < hh; y++) { let row = 0; for (let x = 0; x < ww; x++) { if (grad[y * ww + x] > T) row++; sat[(y + 1) * stride + x + 1] = sat[y * stride + x + 1] + row; } }
  const count = (b: Box, dx: number, dy: number) => {
    const ax = Math.max(0, Math.min(ww, Math.round(b.x + dx) - x0)), bx = Math.max(0, Math.min(ww, Math.round(b.x + b.width + dx) - x0));
    const ay = Math.max(0, Math.min(hh, Math.round(b.y + dy) - y0)), by = Math.max(0, Math.min(hh, Math.round(b.y + b.height + dy) - y0));
    return bx <= ax || by <= ay ? 0 : sat[by * stride + bx] - sat[ay * stride + bx] - sat[by * stride + ax] + sat[ay * stride + ax];
  };
  // What must stay empty: the gaps between neighbouring words, half a line before the first word and after the last
  // (a short line moved onto a longer one), and a quarter line just above and below each word (a box across two lines).
  const sorted = [...boxes].sort((a, b) => a.x - b.x), empty: Box[] = [{ x: left - lh / 2, y: top, width: lh / 2, height: bottom - top }, { x: right, y: top, width: lh / 2, height: bottom - top }];
  for (let i = 1; i < sorted.length; i++) { const a = sorted[i - 1], gx = a.x + a.width, gw = sorted[i].x - gx; if (gw >= 2) empty.push({ x: gx, y: top, width: gw, height: bottom - top }); }
  for (const b of boxes) empty.push({ x: b.x, y: b.y - lh / 4, width: b.width, height: lh / 4 }, { x: b.x, y: b.y + b.height, width: b.width, height: lh / 4 });
  const score = (dx: number, dy: number) => boxes.reduce((s, b) => s + count(b, dx, dy), 0) - empty.reduce((s, b) => s + count(b, dx, dy), 0);
  const all: { dx: number; dy: number; value: number }[] = [];
  for (let dy = -ryUp; dy <= ryDown; dy += 2) for (let dx = -rx; dx <= rx; dx += 2) all.push({ dx, dy, value: score(dx, dy) });
  const size = (c: { dx: number; dy: number }) => Math.abs(c.dx) + Math.abs(c.dy);
  all.sort((a, b) => b.value - a.value || size(a) - size(b));
  let best = all[0] ?? { dx: 0, dy: 0, value: 0 };
  for (let dy = best.dy - 2; dy <= best.dy + 2; dy++) for (let dx = best.dx - 2; dx <= best.dx + 2; dx++) {
    if (dy < -ryUp || dy > ryDown || Math.abs(dx) > rx) continue;
    const value = score(dx, dy); if (value > best.value || (value === best.value && size({ dx, dy }) < size(best))) best = { dx, dy, value };
  }
  // Letters shorter than their boxes fit as well a few pixels up or down: the middle of that run, not one end of it.
  let lo = best.dy, hi = best.dy;
  while (lo - 1 >= -ryUp && score(best.dx, lo - 1) >= best.value) lo--;
  while (hi + 1 <= ryDown && score(best.dx, hi + 1) >= best.value) hi++;
  best = { ...best, dy: Math.round((lo + hi) / 2) };
  const here = score(0, 0), area = boxes.reduce((s, b) => s + b.width * b.height, 0), rival = all.find(c => Math.abs(c.dy - best.dy) >= lh / 2);
  if (size(best) < 2) return { dx: 0, dy: 0 };
  if (best.value < here * 1.15 + area * 0.01) return { dx: 0, dy: 0, reason: 'no clearly better place for its strokes' };
  if (rival && best.value < rival.value * 1.1) return { dx: 0, dy: 0, reason: 'ambiguous: a place a line away fits almost as well' };
  return { dx: best.dx, dy: best.dy };
}
