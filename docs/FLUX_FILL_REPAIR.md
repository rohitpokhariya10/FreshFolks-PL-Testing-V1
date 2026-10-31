# FLUX Fill repair integration — 2026-10-31

Implemented on `feat/flux-fill-repair`, created from clean local `main` at `1efc835`. No commits, pushes, merges, or changes to other branch refs. The final source working tree contains 11 modified files and 3 new files, all unstaged. Generated verification artifacts are ignored under `test-results/flux-fill-repair/`.

## Existing path and the provider change

`RefineCutout.tsx` → `productApi.refineInfo/refineWithAi` → existing `/product-templates/:id/creatives/:cid/objects/:oid/refine` GET and `/refine/ai` POST → `registerProductTemplateRoutes` → `createProductCreatives.refineWithAi`.

Previously that function called the shared `RatioRegenerator.regenerate`, implemented by `liveRatioRegenerator` in `ratioRegeneration.ts`: OpenAI `images.edit` with GPT Image 2. Known defects used `lockedRequest` and `lockedCompletion`; without defects, it fell back to a whole-object `refineRequest`/`refineResult` edit.

Repair now receives a separate provider dependency and calls `createFluxFillRepair.repair` through the existing server fal transport. The endpoint is `fal-ai/flux-pro/v1/fill`; the request contains only `image_url`, `mask_url`, `prompt`, `num_images: 1`, and `output_format: "png"`. It uses the server's existing `FAL_KEY`; no browser credential or new dependency was added. SDK submission retries remain disabled. Queue status polling only reads the same request; failure never submits another request or falls back to another model. Request IDs and estimated cost are saved with the repair artifacts.

The GPT regenerator and its wiring for resizing, AI variations, and other features are unchanged. `cutoutRefine.ts`, decomposition, extraction, background processing, template CRUD, authentication, and Konva code are unchanged.

## Reused safeguards

- `defectsOf` → `cutoutDefects`: original picture, original object placement, front-layer alpha/geometry, and existing product background checks identify the authorized defect region.
- `lockedRequest`: existing crop and context. Its FLUX mode uses a native-resolution crop padded to a 32-pixel grid, with a minimum 64-pixel side. Padding adds context/ground; it does not resize the object. Opaque white means reconstruct; black protects everything else. There is no additional editable margin for FLUX. Dimensions above the existing fal input builder's 4096-pixel side limit are refused.
- `lockedCompletion`: unchanged compositing and acceptance gate. Only authorized solid-interior RGB pixels may change. All original alpha, soft edges, and all pixels outside the hole are retained exactly. The model's background is never used as output transparency. Drift, unfilled holes, seams, tone changes, and green spill are checked before a candidate is offered.
- `refined`, `applyRefinement`, `write`, `next`, `expect`, and `ProtectedStore`: existing content-addressed PNGs, explicit visual approval, revision checks and revision saving. Rejected `pcx-` candidates cannot be applied. Failed requests leave the creative and original cutout intact.
- `createFalTransport`, `buildProviderInput('flux')`, and `normalizeProviderOutput('flux')`: existing bounded server networking, authentication, input schema, one-image response validation and safety refusal handling.
- `refineCutout`: free local cleanup remains as before.

Necessary behavior change: no whole-object fallback when a reliable missing region cannot be identified. The estimate returns `available: false` with the reason; a direct approved POST is also blocked before provider access. This applies to intact layers and to uploaded/already-refined layers without original geometry evidence. No automatic GPT fallback was added.

## Exact source files changed

| File | Change |
| --- | --- |
| `server/src/decomposition/protectedTemplates/product/fluxFillRepair.ts` | New repair-only fal adapter, validation and dimensional cost estimate |
| `server/src/decomposition/protectedTemplates/product/lockedCompletion.ts` | FLUX mask and native canvas option; source geometry checks; legacy mode retained |
| `server/src/decomposition/protectedTemplates/product/creatives.ts` | Existing repair action uses FLUX, its cost, and the existing gate; blocks unknown regions |
| `server/src/decomposition/protectedTemplates/product/service.ts` | Passes repair-only dependency into existing creative service |
| `server/src/decomposition/layerizeRouter.ts` | Defaults repair dependency to server FLUX; GPT dependency unchanged |
| `client/src/features/productTemplates/RefineCutout.tsx` | Displays provider and unavailable-region reason in existing interface |
| `client/src/features/productTemplates/api.ts` | Repair estimate response includes provider and optional reason |
| `server/src/decomposition/protectedTemplates/product/fluxFillRepair.test.ts` | New offline adapter and pricing tests |
| `server/src/decomposition/protectedTemplates/product/lockedCompletion.test.ts` | Runs geometry checks for both mask formats; adds seam and soft-alpha checks |
| `server/src/decomposition/protectedTemplates/product/refineCutout.test.ts` | Existing HTTP journey extended for masked repair, failure, rejection, editing and saving |
| `server/src/decomposition/protectedTemplates/product/productServer.fixture.ts` | Injects repair test provider separately from resizing |
| `tests/fixtures/imageTemplateOfflineServer.ts` | Explicit offline repair stand-in |
| `tests/e2e-image-templates/refine-cutout.spec.ts` | Unknown-region refusal, fal confirmation rendering, and existing free cleanup/revision journey |
| `docs/FLUX_FILL_REPAIR.md` | This report |

## Offline verification

All test commands cleared `OPENAI_API_KEY`, `FAL_KEY`, `GEMINI_API_KEY`, and `CLOUDFLARE_API_TOKEN`. Providers were injected mocks. **Real paid calls: zero.**

- Regression suite: **17 files, 114 tests passed**, covering adapter/network/Seedream contracts, geometry, cutout cleanup/verification, repair HTTP, creative revisions, selection, ratio adaptation/regeneration, AI variations, and access boundaries.
- Expanded geometry suite after final test additions: **12 passed** (8 overlap with the regression suite, 4 additional tests). **118 distinct unit/integration tests passed overall; no remaining failures.** Includes both request formats, unchanged protected RGBA and alpha, correct mask polarity, faithful completion, narrowed/shifted drawing rejection, unfilled rejection, bad-seam/tone rejection, and soft-edge preservation.
- Browser: **7 passed** using the built client and offline fixture server: repair UI, Seedream decomposition to editable layers, and five existing GPT resizing/reuse journeys. The intact browser fixture correctly has no repair region; its cost-dialog rendering uses an explicitly mocked GET estimate. Actual approved repair/failure/revision behavior is exercised by the HTTP test.
- `npm run typecheck`: passed, including client/server/shared and tests.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed; Vite reported a bundle-size warning.
- `git diff --check`: passed.

Initial HTTP runs could not bind localhost in the sandbox; reruns used local-server permission. An older test expected whole-object repair on an intact fixture and initially failed under the new required guard. Its temporary fixture now has a small damaged screen patch, while missing-evidence refusal has explicit coverage. Final checks above pass.

Saved real local fixture: `test-results/demo/navratri-store/protected/pt-a6f742a32148/product-r2.json`, Multi-door refrigerator. Rebuilt the request from the existing stored layer and geometry, sent it through an entirely mocked fal transport, and composited the identity response locally. **192 × 288; 8,826 defect pixels; 5,566 hidden pixels; zero changed protected channels; zero changed alpha values.** This is a transport/compositing check, not a generated repair or evidence of improved visual quality.

Artifacts and logs: `test-results/flux-fill-repair/recorded-check.json`, `request-image.png`, `request-mask.png`, `recorded-fridge-before.png`, `mock-composite.png`, `recorded-check.mts`, and the copied verification logs. The original saved fixture was only read.

## Cost and limitations

Estimate for one output: `ceil(requestWidth × requestHeight / 1_000_000) × $0.05`. This uses the actual padded request dimensions, never the entire poster size. The API response does not provide measured billing here, so the UI continues to label this an estimate.

| Actual request | Estimate |
| --- | --- |
| Recorded refrigerator: 192 × 288 = 55,296 pixels | $0.05 |
| Up to 1,000,000 pixels | $0.05 |
| 1,000,001–2,000,000 pixels | $0.10 |
| 2,000,001–3,000,000 pixels | $0.15 |
| 1024 × 1024 = 1,048,576 pixels | $0.10 |

The endpoint's [official schema](https://fal.ai/models/fal-ai/flux-pro/v1/fill/api) and [pricing page](https://fal.ai/models/fal-ai/flux-pro/v1/fill) were checked on 2026-10-31. Recheck pricing before future paid testing.

No real FLUX output has been generated or visually compared. Provider acceptance of these small native crops and repair quality still need a live check. Existing geometry is deliberately retained: a missing silhouette outside the current alpha cannot be reconstructed by this provider replacement. Uncertain masks are blocked, and quality checks are conservative heuristics, not proof of authentic product geometry. Hidden details remain estimates; the prompt prohibits invented logos, model numbers and branding, and visual approval is still necessary.

## Safe first live refrigerator test

1. Stay on `feat/flux-fill-repair`. Start the normal app with the existing server `FAL_KEY`; no new browser settings or keys are needed.
2. Use a new creative of a saved refrigerator template with original source/front-layer evidence. Keep its original template revision. Do not apply free cleanup first: an applied upload/refinement currently has no original geometry evidence for another AI repair.
3. Choose **Refine cutout → Complete with AI…**. This GET is free. Inspect the provider (`fal.ai`), endpoint, actual dimensions, and displayed estimate. Stop if the app reports no reliable missing region.
4. Obtain explicit approval for that displayed amount before the single paid request. For the recorded fixture above the estimate is $0.05, but use the live screen's actual dimensions and estimate. No such approval has been requested or consumed in this implementation session.
5. Submit once. On network failure, use the saved fal request ID to check the provider dashboard before considering another paid attempt; there is no automatic retry.
6. Compare current and candidate at full size: visible pixels, door seams, proportions, handles, edge quality and transparency. A rejected result cannot be applied. Approve **Use this picture** only after visual review.
7. Open the new revision in the editor, hide/move the foreground washer, then move, resize, hide, save/reload and export the refrigerator layer. Compare against the prior revision and inspect on light/dark backgrounds. Report visual findings before making any claim that FLUX is better.
