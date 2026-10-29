# Product decomposition continuation — 2026-10-29

Continued the existing working tree on `main` from `727379d`. This checkpoint repairs decomposition and editability and verifies the two workflows. It is **not an unconditional visual sign-off for a client presentation**: live generative quality has not been tested, and the limitations below remain.

## Root causes and implementation

- Text removal left low-contrast antialiasing outside its mask. Flat fills preserved letter-shaped differences on gradients; subsequent row interpolation could pull a dark signboard rim through the repaired area. `prepare.ts` fills padded word areas on plain panels with a bounded smooth colour field sampled away from contrasting borders. Divider rules remain intact.
- The residue gate could sample an entirely masked four-pixel ring and interpret missing samples as black. It now seeks actual unmasked samples. The rejection threshold is unchanged. Known compositions also receive logo-leftover validation.
- Narrow word and logo boxes clipped ink. `wordFit.ts` and `detect.ts` fit word ink and extend automatic logo boxes over adjoining artwork; styling uses the word's original measured colour and supports bold figures within a regular line. `service.ts` preserves manual corrections and reports movement from final coordinates. Inconclusive fits are reported for manual review in the API and UI. Both the repairable 45-pixel offset and an offset beyond a small line's safe reach are tested.
- Applying an AI background only inside product outlines left stand fragments behind. `prepare.ts` and `risers.ts` preserve structural artwork and separate the stands removed by the provider into editable layers above its background.
- Badge/signboard compatibility code restored raster lettering and hid editable words. Prepare version 7 keeps all accepted words live. A second legacy path in `reuseStudio.ts` also needed the version check: without it, all 42 words became raster lettering during reuse. Older revisions retain their compatibility behaviour.
- `reuseCompose.ts` retains a text group's plate when the group stays in its original position. Redetection also avoids retaining a duplicate object alongside the administrator's reviewed object.

The existing master-creation and Create Offer Creative screens remain separate. Ordinary editor canvas resizing is unchanged. Tests use copied stores; original saved masters and confidential assets were not migrated or overwritten.

## Aspect ratios and AI

| Path | Verification |
| --- | --- |
| Original | Existing dimensions/geometry, legacy drafts and source-preservation tests; real recorded 9:16 master opened at its original size |
| 1:1 | Composition/persistence tests; upload regeneration and detection-approval browser test; synthetic variation workflow |
| 4:5 | Composition/persistence tests and regeneration/detection approval HTTP coverage; no visual sign-off |
| 9:16 | Composition/persistence tests; reuse regeneration/approval/editability browser test with a provider double; recorded Ganesh master visually inspected |
| 16:9 | Composition/persistence tests; upload regeneration → editor → reload → PNG export with a provider double; real recorded master reused with a replacement product, edited, saved, reloaded and exported using the free composition path |

`ratioRegeneration.ts::liveRatioRegenerator` implements an actual OpenAI `images.edit` request using the configured image model. `service.ts::runRegenerate` and `reuseStudio.ts::regenerateImage` share the injected regenerator from `layerizeRouter.ts`. All four non-original ratios use this capability. The original option does not require regeneration.

Generation is optional and cost-gated. Approval of the result precedes downstream detection/decomposition. Tests cover failed requests, retry approval, QR payload preservation and replacement-product protection. The replay refuses missing cached provider assets instead of downloading them; it cannot invoke paid detection or regeneration.

No paid inference was invoked during this continuation. The browser regeneration provider is deliberately a test double that fits the original onto a blurred cover. Its screenshots prove routing, approvals, dimensions and persistence, **not professional AI recomposition**. The Ganesh reuse preview uses deterministic free composition; it is not new AI artwork. Its decomposition replays recorded Seedream output or uses the explicitly offline fixture.

## Visual evidence

These files remain local and ignored by Git:

- `test-results/ganesh-replay/codex-plane/evidence/01-approved.png`
- `test-results/ganesh-replay/codex-plane/evidence/05-background-only.png`
- `test-results/ganesh-replay/codex-plane/evidence/06-reconstructed.png`
- `test-results/ganesh-browser/01b-product-hidden.png`
- `test-results/ganesh-browser/02-master-edited-reloaded.png`
- `test-results/ganesh-browser/03-master-export.png`
- `test-results/ganesh-browser/04-reuse-16x9.png`
- `test-results/ganesh-browser/05-reuse-editor.png`
- `test-results/ganesh-browser/06-reuse-export.png`
- `test-results/ratio-regeneration/04b-master-export.png`
- `test-results/ratio-regeneration/06-offer-regenerated-9x16.png`

The approved original, repaired background, recombination, edited master, reuse preview/export and representative mock outputs were inspected. The headline panel and validity pill no longer show the earlier lettering ghosts or dark stripes. The replay has 42 visible text elements, 19 logo layers, 14 object cutouts, eight stand layers and no blocking checks. No source word was read again in its original background position by the local recognizer.

The replay reports visible differences outside padded text regions at 0.18% of total image pixels (channel difference greater than 48); 16.3% of pixels inside text regions differ. This supports preservation of the recombined artwork, not exact background restoration or exact typography. Hidden regions remain estimates, and warnings stay available.

The browser verified independent refrigerator movement/hiding, LG-logo movement, text changed from GANESH to FESTIVE, saved edits after reload, correct export size, one replacement product with the uploaded asset hash, all 42 live texts and all 19 logo overlays. It also edits and persists text after reuse and optional decomposition.

## Tests

- Focused acceptance: **43 passed** across word fitting, decomposition completeness, background quality, ratio regeneration and reuse composition.
- Reuse compatibility/editability: **11 passed**.
- Serial recheck of `imageTemplates.test.ts` and `backgroundQuality.test.ts`: **39 passed** (the two background tests overlap the acceptance set).
- Relevant desktop browser suite: **6 passed**, serially, in 2.7 minutes. Includes Ganesh replay, master/variation/editor workflow and four ratio regeneration/approval tests.
- Latest broad suite: **1,706 passed, 30 skipped, 13 failed** across 191 files. Ten assertion failures reproduce on untouched `727379d`; three additional five-second timeouts all pass in the serial recheck. The broad suite is not green.
- Typecheck, lint and production build are required again before committing this checkpoint. Build retains the existing bundle-size advisory.

The ten reproduced baseline failures are in `productAiDecomposition.test.ts` (1), `productReadiness.test.ts` (1), `generator-costs.test.ts` (1), `pipeline.test.ts` (6), and `router.test.ts` (1). The baseline archive used the same installed dependencies and the local readiness fixture. No assertion or residue threshold was relaxed to hide these failures.

Local logs: `/tmp/frameflow-acceptance.log`, `/tmp/frameflow-reuse-final.log`, `/tmp/frameflow-timeout-recheck.log`, `/tmp/frameflow-full-final.log`, `/tmp/frameflow-baseline-tests.log`, `/tmp/frameflow-baseline-readiness.log`, `/tmp/frameflow-browser-final.log`, and `/tmp/frameflow-{typecheck,lint,build}-delivery.log`.

Reproduce the focused checks:

```sh
npx vitest run server/src/decomposition/protectedTemplates/product/wordFit.test.ts server/src/decomposition/protectedTemplates/product/decompositionCompleteness.test.ts server/src/decomposition/protectedTemplates/product/backgroundQuality.test.ts server/src/decomposition/protectedTemplates/product/ratioRegeneration.test.ts server/src/decomposition/protectedTemplates/product/reuseCompose.test.ts server/src/decomposition/protectedTemplates/product/reuseStudio.test.ts --maxWorkers=1
```

Run the browser checks serially. The Ganesh test requires the private replay copy and cached assets; otherwise it skips. Never point the fixture at the production store:

```sh
FRAMEFLOW_SAVED_VARIATION_FIXTURE=test-results/ganesh-replay/codex-plane FRAMEFLOW_GANESH_REPLAY_ID=pt-0e19aab53f50 npx playwright test -c playwright.offline.config.ts --project=desktop --workers=1 --output=test-results/offline-final tests/e2e-image-templates/ganesh-replay.spec.ts tests/e2e-image-templates/product-full-workflow.spec.ts tests/e2e-image-templates/ratio-regeneration.spec.ts
```

## Remaining limitations

1. Real AI visual quality is unverified. A separately approved paid run with an estimate is needed before claiming that the live model professionally adapts this artwork across every ratio.
2. The free 16:9 Ganesh composition is editable and preserves product identity, but the single replacement product is too small among many empty stands. Logo blocks retain their original background colours. This needs manual layout polish or a verified generative result for a presentation. *Fixed later the same day (abandoned stands left out, product arranged as the hero; live AI regeneration verified): see `ASPECT_RATIO_ADAPTATION_2026-10-29.md`. The logo backdrops on the free layout remain.*
3. The saved administrator-defined IDFC logo crop ends about five pixels before the tiny CREDIT CARDS lettering. The rendered result still clips those pixels. The saved correction was preserved; review and enlarge that crop before a final presentation. Counting 19 logo layers does not establish perfect logo fidelity. *Fixed later the same day: a published revision cuts that logo whole (the saved correction unchanged); see `ASPECT_RATIO_ADAPTATION_2026-10-29.md`.*
4. Some stand, podium and badge repairs remain visibly approximate when products or text are hidden. Estimated fonts are not identical to the source. Existing outline/cutout warnings remain unresolved and visible.
5. A decorative circle beside ACME in the synthetic variation triggers the conservative logo-leftover guard. The end-to-end variation test explicitly saves a draft with that warning; it does not claim clean master approval. The repaired Ganesh master has no blocking issues.
6. Mock first-time regenerated exports show the test double's fitted poster and imperfect mock coordinates. They are unsuitable as visual demonstration assets, even though the interaction tests pass.
7. The original stored Ganesh master was not automatically upgraded. The verified repaired master is in an isolated local replay copy.
