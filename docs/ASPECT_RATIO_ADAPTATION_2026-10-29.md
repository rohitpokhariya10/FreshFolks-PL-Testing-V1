# Aspect-ratio adaptation — root cause, fix and live verification (2026-10-29)

Continues `PRODUCT_DECOMPOSITION_VERIFICATION_2026-10-29.md` on `main` (from `727379d` plus that checkpoint's uncommitted work).

## Root cause of the rejected 16:9 Ganesh creative

The rejected image (`test-results/live-ai-2026-10-29/before-rejected-16x9-free.png`) was **not made by AI**. It was the free, deterministic compositor ("Generate Automatically (Free)"): the Ganesh replay test chose that path, and the result screen presented it as "Your creative is ready!", with AI regeneration offered only in a panel underneath.

| Question | Finding |
| --- | --- |
| Engine | `reuseStudio.ts::compose` (rules: `reuseLayout.ts`, `reuseCompose.ts::applyPlan`). No image model was called. |
| Empty stands | One uploaded product fits the template's 14 product places, so it is *slot-anchored* (`slotAnchors`): mode `original`, `keepStands: true`. Every stand layer (`kind: 'podium'`, its own cut-out) was drawn although 13 of the products standing on them were left out. |
| Undersized product | `fitInSlot` caps a replacement at the height of the product it replaces ("at most as large as the original"). `clearOfKeepOut` may shrink it by up to 45 % near the badge. The 16:9 recompose then scales the whole 9:16 artwork block down (~0.55). |
| Products/stands baked into the background? | No. The base (`pbase-…png`) is a clean gold podium without products or risers (Seedream background). The stands were separate layers that the compositor kept. |
| Inappropriate slots | Yes. A display designed for 14 small appliances was kept for one product. |
| Does the AI path really call a model? | Yes. `ratioRegeneration.ts::liveRatioRegenerator` makes one OpenAI `images.edit` request (`gpt-image-2`, high quality, the ratio's own size), never retried. Earlier live runs: Ganesh 1:1 → 9:16 (the current master), Pine Labs 1:1 → 9:16 and → 16:9. |
| Shared by both workflows | Yes. `service.ts::runRegenerate` (master, at upload) and `reuseStudio.ts::regenerateImage` (Create Offer Creative) use the regenerator injected by `layerizeRouter.ts`, the same `regenerationPrompt` and the same `protectRegenerated` checks. |
| AI input defect | The reuse path sent `compose(id, d, 'original')`: the master with **13 abandoned stands and the small product** — with the instruction "keep everything exactly as it is". The model would have kept the broken display. |
| Combination with protected elements | `protectRegenerated` puts the person's product photos back with their own pixels (required: blocks if not found), puts logos back on a clear match, keeps QR payloads, and lists missing words. The approved result becomes a new template that is detected, reviewed and decomposed into editable layers. |
| Editor handoff | The approved AI creative is the template's source; the editor loads that, not the original or a resized fallback. |
| IDFC crop | The administrator's reviewed box ends at x 921; "CREDIT CARDS" ends at x 926 in the creative. Every logo layer was cut from that box: "CREDI CARD". |

## What changed

1. **Abandoned stands** (`reuseStudio.ts::abandonedStands`): a stand layer whose template products have all left their places (and whose places nobody took) is not drawn. A stand that held nothing in the template stays.
2. **Display left partly empty → arranged anew** (`compose`): when an added product would stand among abandoned stands, the products are arranged as one group on the podium by the existing geometry placement, at believable sizes, with the template's stand layers left out. This applies to the free result in every ratio and to the AI's input picture. A template with stands painted into its background (no stand layers) keeps today's slot anchoring.
3. **Prompt: faithful adaptation, not redesign** (`regenerationPrompt`, shared by both workflows): "Convert this exact advertising creative to a <shape> canvas, keeping the same design." It keeps the composition, identity, colours, typography, characters, products and every element. It extends the background and moves or resizes only what the shape requires. It forbids adding any text, offer, price, date, logo, brand name, QR code, product, person, character, decoration or prop, and forbids removing anything. Products, logos and the exact words are named. It no longer names element kinds a creative may not have: an earlier version of this session's prompt asked for "partner logos in neat rows" and a "hero" product, which invites invention.
4. **Product found up to 3× its input size** (`locate(…, most)`), so its own pixels can still be put back if the model resizes it.
5. **Create Offer Creative**: for a common ratio with AI available, Generate opens with **"Regenerate the whole creative for <size> with AI (recommended)"**, its cost and one approval. The AI result is shown first, beside the basic layout. The free path is labelled **"Generate Automatically (Free) · basic layout, not AI"**, the result panel "Basic layout (free, not AI)", and the chip "Layout composed automatically (free, not AI)". The existing AI-arrangement/composition choices and the regeneration panel after a free result remain.
6. **Master creation**: unchanged flow; with a common ratio and the AI box unticked, the upload screen now states that the size will be a basic automatic layout (free), not an AI-redesigned creative.
7. **Logos cut whole** (`detect.ts::finishClippedLogoBoxes`, `wholeLogoSlots`, used by `service.ts::writeSnapshot`): when a revision is published, a logo box whose edge cuts ink on a plain page is extended to the next blank line (≤ 3/5 of its height, never into another logo's box) and cut again as a new file. The reviewed slot and its saved crop are untouched. On the Ganesh master only IDFC FIRST changes (234 → 239 px); the other 18 logos are identical. Revisions published before this keep their crops until the master is published again.

8. **Create Offer Creative draft continuation** (`SimpleReuse.tsx`): a draft continued on opening never replaces one the person just started with a first photo. Only a draft of the master's current revision is continued; older drafts stay under "All creatives from this template". Previously a stored draft of revision 1 (with blocking outline issues) could take over after a quick first upload and disable Generate with "needs a quick background repair". This made the Ganesh browser test fail intermittently.

9. **Flow 1 logos restored from the upload** (`ratioRegeneration.ts::restoreLogosFromOriginal`, applied in `service.ts::runDetect`): after detection on an approved regenerated creative, each logo found in it is found again in the original upload (0.65–1.5× the expected size, pattern and colours agreeing). Its layer is cut from the upload's own pixels, at the regenerated creative's coordinates, before the review and decomposition. A logo not found clearly keeps its drawn crop; `analysis-regeneration-logos.json` records which. On today's live 16:9 master this restores the AU Small Finance Bank logo the model garbled, and also BOBCARD, HDFC, IDFC FIRST (with CREDIT CARDS) and YES BANK (`test-results/live-ai-2026-10-29/master-16x9-logos-restored.png`).
10. **Invented copy flagged** (`protectRegenerated` → `checks.extraWords`, shown as "Nothing added"): words read in the result that neither the original nor (in Create Offer Creative) the template's own copy, logo and product names contain are listed for the person to check before approving. Misreadings within one letter are ignored.

## Live AI verification (approved: 3 requests, max $1.62)

Exactly three `images.edit` requests to `gpt-image-2`, one per run, enforced by a counter. **Actual cost $0.551** (0.184 + 0.184 + 0.183, from each response's usage). Files: `test-results/live-ai-2026-10-29/` (inputs, prompts, raw usage, results, `comparison-16x9.png`).

| Case | Result (inspected) |
| --- | --- |
| Flow 2 — Ganesh master + refrigerator, **16:9** (the rejected case) | Professional landscape. Ganesh left, refrigerator large on the gold podium, no empty stands. Headline signboard, offer and badge right; terms card with all 19 bank logos in rows; temples continued across the width. Refrigerator restored with its own pixels (score 0.91); 13/19 logos restored, the rest drawn legibly; "CREDIT CARDS" whole. No blocking check. |
| Flow 2 — same, **9:16** | Strong portrait: refrigerator large and central, no empty stands, logos legible (13/19 restored). **But the model added decorations not in the template** (potted plants, marigold garlands, lotuses, diyas, cream terms panel). The prompt now forbids new decorative objects; this tweak was made after the run and is **not verified live**. |
| Flow 1 — new master from the square Ganesh upload, **16:9** | Professional landscape. Headline and offer left, Ganesh centre, the full LG product line-up on the podium, every stand holding a product, terms along the bottom. **The small AU Small Finance Bank logo and BOBCARD's tagline were redrawn illegibly.** No logo is known before detection in master creation, so none can be put back. |

These three requests used the earlier, layout-suggesting prompt.

### The faithful-adaptation prompt, live (approved: 2 requests, max $1.08)

Two more `images.edit` requests with the final prompt, **$0.366** (0.183 each). Files: `test-results/live-ai-2026-10-29/faithful-*`.

| Case | Result (inspected) |
| --- | --- |
| Flow 1 — the square Ganesh upload → **16:9** master | The original's own design, widened: headline signboard centred, offer in its original two lines, the same LG line-up on the gold podium, Ganesh left, badge right, temples, bells and lotus border continued to the edges. EMI line, both rows of bank logos in the original's order, validity pill. **Nothing invented** that I could find. Words flagged as added: "ospicard" (OCR of "SBI card") and "federal" (in the original). Small partner logos are redrawn at this size; item 9 restores them after detection. |
| Flow 2 — Ganesh master + refrigerator → **9:16** | The input kept as it is: no invented decorations (the earlier prompt added plants, lotuses, diyas, garlands and a cream panel) and the refrigerator at its relative size. `extraWords: []`; refrigerator and 16/19 logos restored with their own pixels; no blocking check (`faithful-reuse-9x16-vs-old.png`: input · new · old). |

Offline checks on these saved results (no request): invented copy in Flow 2 16:9 and 9:16 → none (`extraWords: []`, checked against the template's own copy). Flow 1 16:9 → none in practice; its one flag ("Validity: Till 30th September") is local OCR missing that white-on-teal pill in the upload. Missing-word lists correctly flag the garbled AU and DBS logo lettering, which item 9 then replaces.

### Flow 1 end to end, live, in the running app (`pt-418571029fc0`, a text-free Navratri appliance scene → 16:9)

The administrator's own run on `localhost:5173`: upload → 16:9 AI regeneration (faithful, $0.183) → approved → AI detection. Detection then showed "AI detection did not complete. No answer was received."

- **Cause: a development-server restart, not the provider or the integration.** The detection request was accepted in background mode at 15:13:29 (`resp_0de4811…`, saved with its job). At 15:13:36 a source edit made in this session restarted `npm run dev` (the API process start time is exactly 15:13:36), dropping the wait for the queued answer. The server then reported the job as `interrupted` and `retrievable`, as designed.
- **Recovered without a new request**: "Retrieve existing request" (`POST …/detect {recover: true}`) collected the answer by its id ($0.115, already billed): 14 elements on the regenerated 2048×1152 image.
- Review (all accepted) → Choose (3 products, 3 characters) → AI decomposition (approved; Seedream, 2 requests, **$0.316**) → 3 non-blocking notices acknowledged → **master revision 1 saved at 2048×1152**, source the regenerated image.
- **Editor** (the real UI): 2048 × 1152, 7 layers (2 dancers, washing machine, dishwasher, refrigerator, deity figure, locked background). The refrigerator hides on its own over a clean reconstructed arch. PNG export 2048×1152. Files: `test-results/live-ai-2026-10-29/flow1-live-editor.png`, `flow1-live-editor-fridge-hidden.png`, `flow1-live-export.png`.

Not run live (cost not approved): Flow 2's regenerated results made editable (detection + decomposition); 1:1 and 4:5 regeneration.

## Tests

- New unit tests: `ratioAdaptation.test.ts` (abandoned stands, a clipped reviewed logo in a dense logo grid, prompt content).
- Browser: `ratio-regeneration.spec.ts` gains a test for AI regeneration chosen at Generate (result first, basic layout labelled). `ganesh-replay.spec.ts` now also asserts no stand layer is shown and the replacement is at least 20 % of the canvas height.
- Product folder + `tests/unit`: 137 passed, 20 skipped, 2 failed. The 2 failures (`productAiDecomposition.test.ts:140`, `productReadiness.test.ts:16`) match the recorded baseline on untouched `727379d`.

## Remaining limitations

1. Flow 1 is verified live end to end on the Navratri scene (above). Flow 2's "make editable" step (detection and decomposition of a regenerated reuse result) is verified with test doubles only. The Flow 1 logo restore is verified offline on the live 16:9 Ganesh master's logos (the Navratri scene has none).
2. Flow 1 logo restoration needs a confident match. A logo the model redrew beyond recognition keeps the drawn crop, reported in `analysis-regeneration-logos.json`; the reviewer can replace it.
3. The free compositor is a basic fallback. It no longer leaves abandoned stands, sizes the product as a hero and keeps "CREDIT CARDS" whole. It still uses a two-column 16:9 layout, keeps the LG and Pine Labs logos' mint backdrop on its white card, and softly blurs extended edges.
4. With stand layers left out and the automatic stage-emptying marked unreliable for this template, the free result keeps its non-blocking note "check it for display stands or marks painted into the background". The base is in fact clean here.
5. The OCR word checks on AI results are advisory. "Missing words" can list words that are visibly present (for example "GANESH", "scapia"). In Flow 1, where no copy is known before detection, "added" words can include text that local OCR missed in the upload (the validity pill).
6. Editing server source files while `npm run dev` runs restarts the API and interrupts an AI request in flight. The request is recoverable with "Retrieve existing request" (no new detection charge).
