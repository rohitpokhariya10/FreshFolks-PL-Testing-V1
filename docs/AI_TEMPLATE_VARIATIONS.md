# AI template variations (Generate AI Variations → AI design variations)

One saved base template becomes 3–5 genuinely different AI designs for a festival or theme, in any of the six sizes. A chosen design continues through the existing creation pipeline: analysis, review, decomposition, editable layers, save, editor and export.

## Flow

1. **Offer Templates → a template → Generate AI Variations.** This is the existing entry point; it opens the template's *Generate with AI* tab. The new **AI design variations** card sits at the top, and the earlier layered modes (typography, AI products, AI backdrop) remain below, unchanged.
2. **Choose:**
   - **Size:** the six shared sizes (Original, Square 1:1, Portrait 4:5, Story 9:16, Landscape 16:9, PL One Banner 885 × 286), from the shared ratio engine.
   - **Festival or theme:** keep original, Diwali, Holi, Dussehra, Karwa Chauth, or custom.
   - **How many:** 3, 4 or 5.

   Changing a choice sends nothing.
3. **Generate → confirm the estimate.** One `images.edit` request per variation, made one after another and never retried, with the actual cost recorded. Without the approved amount the server refuses (`APPROVAL_REQUIRED`).
4. **Each variation** is the base template's latest revision as designed, rendered and sent with:
   - its own design direction (`VARIATION_DIRECTIONS`): refreshed styling close to the original arrangement, product spotlight, shifted balance, framed composition, alternate campaign palette. These are visibly different placements and scales of the products, characters, decorations and existing text containers;
   - the template-family rule: the same brand identity, visual hierarchy, design grammar and composition style, as one integrated campaign artwork. Any text stays inside the artwork in the same kinds of banners, boxes, pills, ribbons, badges or strips (which may move or resize), never in a detached side panel, information board or a split of picture and text. A different canvas shape adapts the composition without turning it into a different kind of poster, and the festival changes decoration, colours, motifs and atmosphere, never the content;
   - the theme's decoration;
   - the template's exact words;
   - the rule that nothing is added except theme decoration (no text, offer, price, date, logo, brand, QR code, product or person).

   Before it is shown, each result goes through the shared protection (`protectRegenerated`): it is brought to exactly its size, products and logos are put back with their own pixels on a clear match, QR payloads are checked, and missing or added words are listed. PL One Banner uses the safe 3:1 request with the height-only trim.
5. **Preview cards** show each design with its checks; **Inspect** opens it full screen.
   - **No invented business content.** The design directions arrange only the creative's existing elements and name no headline, offer or panel for words. The text rule allows exactly the template's own texts, each once. A text-free template is told the result may contain no words, letters or numbers except what is printed on its products and logos. After generation, four or more words the template does not have block the variation as "Cannot be used: the AI added text…".
   - **Warnings need explicit acceptance.** An added or missing word, or a product or logo not put back with its own pixels, requires "I accept these warnings", which the server also enforces (`acceptWarnings`).
   - **Failed or unusable slots** can be retried one at a time ("Retry this variation…", with that one request's estimate approved). Other variations, their pictures and the costs already recorded are kept. A dropped connection is reported with its cause (for example `terminated (UND_ERR_SOCKET: …)`).
6. **Choose this variation → "I have looked at it" → Use this variation.** The existing `createFromRegenerated` makes a template from that picture (linked to the base: `regeneration.from = { templateId, draftId: "pav-<job>-<index>" }`). Its elements are found in the variation itself (AI detection only if ticked, estimated at up to $0.35), then reviewed, decomposed (with the existing approval), saved and opened in the editor.

The base template and its revisions are never changed. Jobs are stored with the base template as `pav-<id>.json`, with images `pav-<id>-<index>-<hash>.png`.

## Code

| Area | Change |
| --- | --- |
| `shared/src/productTemplates.ts` | `AI_VARIATION_THEMES`, labels, counts, `AiVariationJob`, `regenEstimateUsdForSize` |
| `product/ratioRegeneration.ts` | `variationPrompt`, `VARIATION_DIRECTIONS`, `atSize` (`atRatioSize` uses it) |
| `product/reuseStudio.ts` | `aiVariations`, `startAiVariations`, `aiVariation`, `continueAiVariation` (the template's own creative rendered as in `regenerateImage`) |
| `product/routes.ts` | `GET/POST /:id/ai-variations`, `GET /:id/ai-variations/:jid`, `POST …/:jid/:index/retry` (one approved request), `POST …/:jid/:index/continue` |
| `product/service.ts` | `createFromRegenerated` takes an optional ratio (an Original-size variation) |
| `client/…/AiDesignVariations.tsx` | The card: choices, cost confirmation, previews, choose, make editable |

## Verification

- `aiVariations.test.ts` (HTTP, test doubles):
  - the prompt: five distinct directions, themes, exact words, nothing invented;
  - approval required, nothing sent before it;
  - Journey A (original theme, Original size: 3 distinct designs at the template's exact proportions), B (Holi, 1:1, 4 designs), C (PL One Banner requested at 2496 × 832 and kept at exactly 1770 × 572; Story 9:16);
  - the base template unchanged;
  - Journey D hand-off: refused until looked at, then a template of its own from that exact picture, detected in it.
- `ai-variations.spec.ts` (browser, offline doubles):
  - banner + Diwali: the cost is confirmed, three previews appear, one is made editable and detected;
  - 16:9 + Holi: made editable → reviewed → decomposed → saved → a layer moved in the editor → kept after reload → exported at 2048 × 1152.
- **Real AI visual quality has not been verified**: no paid request was made for this feature.

## First manual test (2026-10-29, `pav-5629757e`, a text-free banner master, Diwali)

- **Variation 2 failed with `terminated`.** The request was sent at 17:08:54 and failed at 17:09:45, with no response or request id. The same process went on to variation 3, so it was neither a server restart nor our 300 s timeout: the HTTP connection was closed mid-response. Only the message had been saved; the cause is now recorded too.
- **Variation 3 drew a "Festive Bonanza" panel of invented offers.** The earlier directions asked for "the headline and offer in a bold rounded panel" on a creative with no text. Fixed as above, and that result now reads as "Cannot be used".

## Limitations

- The Figma file was not accessed (it needs a signed-in connector) and no screenshots came with the request. The directions follow the written brief.
- The offline browser analyser answers with the test poster's own layout, so the banner journey is browser-verified through review, and decomposition-to-editor is browser-verified in 16:9. Real detection reads the real image.
- A template product the model moves behind another, or redraws beyond a clear match, is listed under "Check it" rather than restored. The person approves after looking.
- Theme decoration is new content by design. Wording is never changed, so a festival-specific line (for example "A grand welcome for Bappa") stays as it is under another theme.
