import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { TextAnalysis } from '@frameflow/shared';

const { OverlayGateError, prepareProduct } = await import('./prepare.js');
const { detectedPoster } = await import('./productPoster.fixture.js');

// The AI decomposition preflight: whatever is still editable text must be gone from the picture sent, else nothing is
// sent; a symbol that is a badge's own artwork (not editable text) goes with the badge. The picture without text is given
// here as it came out of a removal that failed: the "%" still there (as the live colour-matched removal left a seal's
// white "%").

/**
 * The poster with a shaded seal (green to yellow-green, with a relief texture: not a plain plate) carrying a white "%"
 * (a bar and two dots), and only that "%" as text.
 */
async function sealPoster(review: 'approved' | 'rejected') {
  const { source, analysis, objects } = await detectedPoster(), data = Buffer.from(source.data), W = source.width;
  const seal = { x: 860, y: 300, width: 110, height: 110 }, glyph = { x: 890, y: 330, width: 50, height: 46 };
  for (let y = seal.y; y < seal.y + seal.height; y++) for (let x = seal.x; x < seal.x + seal.width; x++) {
    const t = (x - seal.x) / seal.width, i = (y * W + x) * 4, relief = (x + y) % 6 < 3 ? 30 : -30, c = (v: number) => Math.max(0, Math.min(225, v + relief));
    data.set([c(5 + 179 * t), c(208 + 22 * t - 20), c(126 - 84 * t), 255], i);
  }
  const white = (x: number, y: number) => data.set([255, 255, 255, 255], (y * W + x) * 4);
  for (let x = glyph.x; x < glyph.x + glyph.width; x++) for (let d = -2; d <= 2; d++) white(x, Math.round(glyph.y + 23 + (x - glyph.x - 25) * 0.25) + d);
  for (const [cx, cy] of [[glyph.x + 30, glyph.y + 8], [glyph.x + 20, glyph.y + 38]]) for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= 16) white(cx + x, cy + y);
  const [template] = analysis!.words, at = new Date().toISOString();
  // As the analysis gave it: AI-read, coloured as the seal it is drawn on.
  const word = { ...template, id: 'pw-seal', text: '%', groupId: 'pg-seal', lineId: 'pn-seal', origin: 'ai' as const, box: { ...glyph, rotation: 0 }, source: { ...template.source, box: { ...glyph, rotation: 0 } },
    style: { ...template.style, color: '#5fd85a' }, review: { status: review, at } };
  const group = { ...analysis!.groups[0], id: 'pg-seal', label: '%', lines: [{ id: 'pn-seal', wordIds: ['pw-seal'] }] };
  const picture = { ...source, data };
  return { source: picture, analysis: { ...analysis!, words: [word], groups: [group], logoSlots: [], plates: [] } as TextAnalysis, objects, glyph,
    unremoved: { background: picture, clean: picture, layers: [] } };
}
/** A stand-in for the planner and Seedream: keeps what it would be sent, sends nothing. */
function standIn() {
  const sent: { image: Buffer; width: number; height: number }[] = [];
  return { sent, layerizer: { planner: 'stand-in', engine: 'stand-in', offline: true, decompose: async (request: { image: Buffer; width: number; height: number }) => { sent.push(request); throw new Error('STOPPED_BEFORE_SENDING'); } } };
}

describe('the AI decomposition preflight and a symbol on a badge', { timeout: 120_000 }, () => {
  it('editable text still in the picture (the "%" kept as text in the review) stops it: nothing is sent', async () => {
    const { source, analysis, objects, unremoved } = await sealPoster('approved'), ai = standIn();
    // (Stopped by the overlay gate, before the decomposition's own check of the picture it would send.)
    await expect(prepareProduct({ source, analysis, objects, known: unremoved, paidApproved: true, layerizer: ai.layerizer as never, save: () => undefined })).rejects.toThrow(OverlayGateError);
    expect(ai.sent).toHaveLength(0);
  });

  it('the same "%" as the badge’s artwork passes, and is sent with the badge, unchanged', async () => {
    const { source, analysis, objects, glyph, unremoved } = await sealPoster('rejected'), ai = standIn(), saved = new Map<string, object>();
    await expect(prepareProduct({ source, analysis, objects, known: unremoved, paidApproved: true, layerizer: ai.layerizer as never, save: (f, v) => saved.set(f, v) })).rejects.toThrow('STOPPED_BEFORE_SENDING');
    expect(saved.get('ai-input-check.json')).toMatchObject({ stillVisible: [] });
    expect(ai.sent).toHaveLength(1);
    const { image, width, height } = ai.sent[0], px = await sharp(image).removeAlpha().raw().toBuffer();
    // The white dot of the "%" in the picture sent (at the sent picture's scale).
    const x = Math.round((glyph.x + 30) * width / source.width), y = Math.round((glyph.y + 8) * height / source.height), q = (y * width + x) * 3;
    expect(Math.min(px[q], px[q + 1], px[q + 2])).toBeGreaterThan(230);
  });
});
