# Reuse Template studio — 2026-10-26

A saved Product with Text master template reused with the person's own product set, copy, logos and output formats, then
saved as creatives that open in the editor or go on to the separately approved OpenAI + Seedream decomposition.
Separate from Generate AI Variations (unchanged). Built and verified offline only: no OpenAI or fal request, no commit.

## Where

**Offer Templates → Product templates → card → Reuse Template** (beside Use template, Generate AI Variations, Edit master).
It opens the template's reuse drafts (Continue editing) or **Start a new reuse**, which loads the saved reviewed revision
(products, characters, words, logos, background, podium) without any new detection.

## Create a New Creative (the simple flow, default since 26 Oct evening)

**Reuse Template** now opens **Create a New Creative**: (1) **+ Upload Products** or drag photos (several at once;
thumbnails, select/deselect, rename, Make main product, remove, add more; a "What is it?" choice only when a photo's kind
isn't recognised); every product of the template is left out of the new creative automatically (the template is never
changed; Ganesh Ji, the festive art, text and logos stay); (2) **Generate My Creative** — one confirmation when AI
arranging costs money (about $0.08 per size, OpenAI), "Arrange automatically (free)" otherwise; the status messages
("Preparing your products…", "Finding the best arrangement…", "Creating your design…") each follow a real request;
(3) the finished poster with **Regenerate Layout** (another automatic layout free, or ask AI again with approval),
**Edit Creative** (the detailed studio on the same draft: drag, corner handles, Size +/−/Reset, replace, add, remove,
text, sizes) and **Save Creative**, then **Decompose & Edit** or **Open in Editor**. The draft saves as it changes and a
reload continues it. Hierarchy: the main product is the person's choice or the one with the most presence, in the
middle, never under 80 % of the tallest; others alternate beside it by size; clearly shorter ones stand in front beside
it (never in front of it); products clear of the character, logos, text and decorations. Regenerate Layout cycles
mirrored sides, then the next main product. The detailed studio and all drafts stay one click away.

Evidence: `test-results/simple-reuse/` (01 start, 02 uploaded, 03 result + 03b 390 px, 04 customise, 05 inspect,
06 editor, 07 export, 08 five products) and `test-results/simple-reuse/real-template/` (a safe copy of the real
"Ganesh ji" template with realistic product cut-outs from the user's own live batch: A two products at original and
4:9, B five products at original and 16:9; arranged automatically, as no AI provider was used).

## What it does

| Area | Behaviour |
| --- | --- |
| Products | Thumbnail list; select / deselect each or all; show / hide; move up / down; **Replace** with an uploaded picture; **Restore** the template's picture; **Remove** from this draft (a "Removed" section restores it); **+ Add Product** (name and kind; any number, no slot needed). "Show the empty stage" hides every product in the preview. |
| Uploads | PNG / JPEG / WebP, cut out on this computer (`cutOutUpload`: own transparency kept, plain backdrop removed, a photo's scene kept and reported). Composited as layers: the product's own pixels are never redrawn. |
| Placement | **Keep the template's places** (its own product set, original size only); **Arrange on this computer** (free fixed rules: compressed real heights per category, tallest in the middle, a lone product as the hero, a front row only for clearly shorter products, on the podium's top surface, below the text, beside the character, clear of badges/logos/text); **AI Smart Placement** (one approved OpenAI request per format with a picture of the composition without products and its geometry; every box checked — canvas, stage, size, text/logo/decoration cover, hiding — and a refused box replaced by the rule's box with the reason; never retried; cost recorded as an estimate). Drag in the preview to correct; Smaller / Larger; undo or reset corrections per format. |
| Formats | Original plus the common offer-creative ratios **Square 1:1, Portrait 4:5, Story 9:16, Landscape 16:9**, each recomposed for its shape (see *Aspect ratios* below). Drafts made earlier with Portrait 3:9 or 4:9 keep them: they still open, compose (the slice / mirrored-side frames described here) and save exactly as before; those two are no longer offered for new choices. |
| Text & logos | Per group: text (fitted into the template's area for it), font, weight, colour, size, alignment, show/hide, back to the template's. Logos: show/hide, replace, restore. Offers are only what the person types. |
| Output | **Generate Reused Creative** draws every chosen format as one complete poster with its checks (blocking: products off the canvas or over text, missing pictures, source defects; needs a look: slice/mirror notes, stage note, small text, AI boxes refused). **Save reused creatives** makes each format a creative of the template (new revision when saved again; uploads/background/shadows copied as the creative's own files). Failed formats cannot be saved. |
| Next | Per saved format: **Decompose & Edit** (variationComposition → the existing handoff → review → choose → separate OpenAI + Seedream approval → Inspect → editor) or **Open in editor (its own layers, free)**. |
| Persistence | `prd-<id>.json` per draft (optimistic revisions): items, uploads, text/logo edits, formats, placement mode, AI plans (operation/response ids, items they were made for, rejected boxes), corrections per format, outputs (previews, checks, creative ids/revisions). The master revision is only read. |

## Aspect ratios — 2026-10-28

**Where the size is chosen.** *Create Offer Creative* → template → **Choose your size** (Original · *its shape*, Square
1:1, Portrait 4:5, Story 9:16, Landscape 16:9), before the first **Generate Creative**; the draft is created with it. Using
the template again (or a template made from a creative with **Edit Individual Elements**) opens the saved size, and
**Size** on the result changes it (recomposed at once, free). One list in `shared/src/productTemplates.ts`
(`OFFER_ASPECT_RATIOS`, also used by AI variations).

**How each size is composed** (`server/src/decomposition/protectedTemplates/product/reuseCompose.ts`). The template is read
as its artwork block (between a plain header and footer, widened to cover its character and stage), the band colours,
and the elements that sit in the bands (header and footer logos, QR codes, terms and validity lines; a plate painted
under a line is cut out to travel with it). The artwork block is placed whole at **one scale**, never stretched, at most
its own pixels, never cut at its top or bottom; a little may be cropped at the sides with every decoration wholly in or
out (a wide stage may lose up to 30 % at its ends). Then every band element is **re-laid out as its own layer**: taller
sizes stack header · artwork · footer with the bands re-spaced and logo rows re-flowed; landscape sizes put the scene on
one side and the offer column (brand logos, offer terms, bank logos, validity) on the other, on a panel in the band's
colour. Logos keep their proportions and pictures; text is re-wrapped with its exact words; a character cut by a
narrow size is re-anchored at its side; products stand in the template's own (mapped) places when they fit them, else
are arranged on the mapped stage as before. A size of the template's own shape keeps every element where it was.

**AI composition (optional, priced, approved).** *Design Your Creative with AI* / *Design this size with AI* sends, per
size, one layout request (`liveReuseComposer`: the placement planner's pattern — OpenAI Responses, strict JSON schema,
no retries, request and answer saved) with the template's picture, its structure and the rules' proposal, and — only
where the plan leaves canvas the template's artwork does not cover — one masked image edit of only that area
(`createOpenAIBackgroundReconstructor`, gpt-image-2). Estimates: about $0.08 per layout, $0.12 per edit (not measured).
Every AI box is checked (inside the canvas, readable size, clear of the artwork's protected areas and of each other);
a refused one is laid out by the rules, an artwork placement that cuts the character, stage or text is refused whole.
The image model only ever receives the text-, logo- and product-free background; its pixels are composited only inside
the continued area (never over the artwork or a band) and read back with the local word reader — drawn lettering
refuses it. Without approval, an OpenAI key, or after a failure, the free continuation is used: the block's own edge
colours, softly (plain edges continue exactly), reported as a share of the canvas.

**Master size (first-time master creation).** *OpenAI + Seedream test → Offer Templates → New product template* →
Upload → Review → Choose → Decompose → **Size** → Save. On the Inspect screen, **Size of the master template** offers
Original (today's behaviour, unchanged) and the four common ratios. With a ratio, *Save and preview …* saves the
original as version 1 (the source, never changed afterwards), then composes the chosen size from it with this same
engine (`POST /product-templates/:id/master-size`, free) and shows it with its checks; *Design this size with AI…* is the
approved AI composition above (the reuse compose route on the master's own draft, `master: true`, never listed with
reuse drafts). *Save … master template* (`POST …/master-size/save`) writes version 2: `editorCreative` holds every
layer at the exact canvas (text as editable words again; plates and the offer panel as their own layers), objects and
background structure are mapped into it, words / logo slots / plates stay the original's source evidence, and
`adaptation: { fromRevision, ratio, source, layout, validation }` links it to the original; the revision ref carries
`aspectRatio`, `canvas`, `preview`, `fromRevision`, and `product.masterRatio` the choice. *Open in Editor* opens the
adapted master; *Use template* creatives are that size; Create Offer Creative shows it as its format and reuses it as
designed (Original), while any other common ratio is composed from the original version (same element ids, so a
draft's choices apply to both). *Change the master's size* on the saved screen makes another size from the same original.

**Checked before saving** (`ReuseOutput.validation`, shown on the result): exact size; every kept logo, text group and
product shown, whole and unchanged (its own picture, its exact words); readability (text size; contrast measured on the
finished poster); clipping. A recomposed size that fails its size or protected-element check cannot be saved.

**Stored.** `prd-*.json`: `ratios` (the chosen size), `compose[ratio]` (the approved AI plan: model, operation id,
artwork placement, boxes, refused boxes, the continuation file `prx-*`), outputs with `composition`, `validation` and
`background.extension`. Saved creative: its canvas and `origin.ratio`. A template made from it (Decompose & Edit):
`product.variation.aspectRatio`, its canvas that ratio. Cached files: `pcp-*` (cut-out plates), `pcl-*` (panels),
`prb-*` (backgrounds). Older drafts and templates without these fields are read as before (laid out by the rules).

**Tests (offline).** `reuseCompose.test.ts` (rules plan per ratio, AI-plan checks, AI pixels never over the artwork, the
HTTP journey with a mocked planner and image editor, refused lettering, legacy drafts, the derived template's ratio);
`tests/e2e-image-templates/aspect-ratio.spec.ts` (choose 9:16 → approve → checks → save; reuse keeps 9:16, switch to 16:9);
`tests/e2e-image-templates/master-aspect-ratio.spec.ts` (first-time master: upload → review → decompose → 16:9 →
preview → AI design approved → save → editor → reuse in 9:16).

**Limits.** The live layout planner and image edit are unverified (test doubles only); their output quality and real
cost need a check on your own template, with approval. Without AI, a landscape size of a square template continues
about a quarter of the canvas from its own edge colours (behind the offer column). Text is re-wrapped by rules; very
long copy in a narrow column is set smaller (flagged by the readability check).

## Files

| File | Change |
| --- | --- |
| `shared/src/productTemplates.ts` | `REUSE_ASPECT_RATIOS`, labels, `reuseCanvasFor`, draft/item/output/plan types; creative origin `reuse`; background methods `slice`, `mirror-extend`. |
| `server/src/decomposition/protectedTemplates/product/reuseLayout.ts` (new) | Frames, backgrounds, element mapping and re-anchoring, art rows. |
| `server/src/decomposition/protectedTemplates/product/reusePlacement.ts` (new) | Geometry placement, AI box checks, live OpenAI placement planner, `reuseCategory`. |
| `server/src/decomposition/protectedTemplates/product/reuseStudio.ts` (new) | Drafts, uploads, compose, checks, generate, AI placement, save, open, decompose. |
| `.../product/creatives.ts` | `replaceWith` (a server-made next revision). |
| `.../product/service.ts`, `.../product/routes.ts`, `server/src/decomposition/layerizeRouter.ts` | Studio wiring, `/product-templates/:id/reuse…` routes, `productPlacement` option (live planner only with an OpenAI key). |
| `client/src/features/productTemplates/ReuseStudio.tsx` (new), `api.ts`, `ProductTemplates.tsx`, `ProductTemplatePage.tsx` (exports two helpers), `productTemplates.css`, `client/src/features/masterTemplates/OfferTemplates.tsx` | UI and entry points. |
| `.../product/productServer.fixture.ts`, `tests/fixtures/imageTemplateOfflineServer.ts` | Fake placement planner injection (no network). |
| `.../product/reuseStudio.test.ts` (new), `tests/e2e-image-templates/reuse-studio.spec.ts` (new) | Tests. |

## Verification (offline)

- `npx vitest run …/reuseStudio.test.ts` plus the 11 earlier product test files (`--maxWorkers=2`): 12 files, 35 tests passed. `npm run typecheck` and `npm run build` passed; ESLint `--max-warnings 0` on every changed file passed.
- `FRAMEFLOW_PRODUCT_REFERENCE=1 FRAMEFLOW_PRODUCT_REUSE_PROOF=1 FRAMEFLOW_OFFLINE_E2E_PORT=3387 npx playwright test -c playwright.offline.config.ts tests/e2e-image-templates/reuse-studio.spec.ts tests/e2e-image-templates/product-reuse.spec.ts --project=desktop --workers=1`: 4 passed (the reuse journey and the 3 variation journeys).
- Screenshots: `test-results/reuse-studio/` (01 studio, 02 the four posters, 03 results, 04 reopened, 04b 390 px, 05 inspect, 06 export).
- A copy of the real "Ganesh ji" template (`pt-c533f7a238e7`) was reused read-only in a scratch store: four complete formats, no blocking check.

## Limitations

- The real template's background still has the pastel display risers painted on the podium (not separated when it was prepared). They remain behind re-arranged products (partly covered). Every re-arranged output carries a "check the stage" note. Removing them needs the risers marked as stand layers in Review and a new preparation, or an approved AI background cleanup (not built).
- Formats are recomposed from the template's own artwork: a slice shows the middle of the artwork; a wider format continues its sides by mirroring. A redrawn frame for each format (as a designer would) needs paid AI outpainting (not built; flagged).
- AI placement is verified only with a test double; the live planner (OpenAI, about $0.08 per format, estimate) is unverified.
- Text is re-wrapped by rules; very long copy in 3:9 is set smaller (flagged). AI copy suggestions are not part of the studio.
