# FrameFlow AI Layer Editing — completion report

Verified on 1 November 2026. Implementation complete; offline verification complete. No real paid image-edit request was made by the agent. A subsequent user live attempt returned HTTP 400 (`invalid_value`); see the compatibility correction below. Real model fidelity, identity preservation and edge quality remain unverified.

## Git and recovery

- Active project folder after the authorized transfer: `/Users/rohitpokhariya/Downloads/FrameFlow-template-studio`.
- Feature branch: `feat/ai-object-edit`, preserved by one local feature commit. Run `git log -1 --oneline` for its hash. Nothing was pushed or merged.
- Base: `1efc835dedfae259e3ce9e93b6b2b763cfac56be`; `main` remains unchanged.
- `feat/flux-fill-repair` and the earlier `feat/ai-layer-edit` branch remain at `25a2d33bc02639f903995bddb41c1bd08354eb41`. FLUX-only changes were not merged into this branch.
- The original folder's three partial AI paths (`shared/src/index.ts`, `server/src/decomposition/layerEdit.ts`, `shared/src/layerEdit.ts`) are preserved in the stash named `preserve/original-ai-layer-edit-before-ai-object-edit-transfer-2026-11-01`, including untracked files. Restore that stash on `feat/ai-layer-edit` when returning to the earlier work.
- The completed feature was verified and committed in `/private/tmp/frameflow-ai-object-edit` before Git removed that worktree and switched the original folder to this branch. There is now one active project folder.
- Earlier, the temporary directory had disappeared. The exact recorded edits were recovered from session history and verified again. The Downloads recovery/verified ZIPs remain available as historical backups from before this authorized transfer.
- Credentials, saved creatives, generated assets and the original dependency installation are retained in the original folder. Runtime data is not part of the feature commit.

## Implemented behavior

The existing right-side Layer inspector contains **AI Edit Layer** for a single selected visual object. It supports generic products, characters and decorations from saved product creatives and recognized decomposition layers. Text, logos, backgrounds, hidden/locked layers, missing sources and unsupported selections receive guidance instead of generation controls.

The server resolves the image from the saved creative/object/revision or curated decomposition run. It checks membership, source hash and saved revision; it never accepts a client image URL or filesystem path. It reuses the existing `experimentAccess` guard. This application has no per-user login/ownership system; the existing same-origin/local-access boundary is preserved, not represented as account authentication.

The actual selected image is cropped to its visible alpha bounds and placed with expansion room in a 1024 × 1024 reference canvas. The shared OpenAI `images.edit` adapter sends this reference, the user's instruction and generic identity-preservation instructions. The prompt asks to keep recognizable design, branding, color, texture, face/clothes, style, lighting and perspective except where the instruction changes them. No entire poster, text-only generation, FLUX repair, segmentation service or extra paid cleanup is used.

The edit omits `background` and asks for the object on a flat colour selected to differ from the source object. The existing local plain-background cutout utility produces the transparent PNG without another provider call. Native alpha is still accepted if returned. Existing adapter callers retain their previous settings. Empty, corrupt, wrong-size, clipped, substantial detached-object and remaining-chroma outputs are rejected. Semantic identity and aesthetic quality still require human preview; these checks cannot prove that the model drew the correct object.

The full candidate silhouette is retained. Its dimensions follow reference pixel scale and can grow beyond the original cutout. The visible centre remains the anchor; the existing Konva top-left rotation convention determines the new origin. Apply preserves rotation, opacity, layer ID and stacking order. It does not fit the result back into the original silhouette. Expanded content can overlap neighbours or extend beyond the canvas; use the existing position/size controls after review.

Generate produces a Before/After candidate without changing the document or creative revision. Apply verifies the local image, persists the PNG in IndexedDB, rechecks the saved server revision, and atomically updates the selected layer's asset and bounds in one undo step. Undo/redo retain both assets. Existing browser persistence, Save creative, revision creation and PNG export are reused. A subsequent edit resolves the latest applied candidate as its reference, or the saved uploaded asset after saving.

The UI prevents duplicate clicks and requires fresh approval for regeneration. Durable operation IDs prevent repeat submission after reconnect/restart. Check request status reads the existing result without calling AI. Timeouts/network interruptions are marked uncertain and never automatically retried. Switching selection discards late results; changed geometry, assets or creative state disable stale Apply. Storage failure preserves the original and lets Apply be retried without generation.

Discard removes the pending image without creating a creative revision. Abandoned previews expire after one day; applied server reference copies expire after seven days. Small operation records remain for idempotency. The browser image and saved creative revisions use the existing persistence system; save an applied edit before relying on it long term.

## Live Before/After canvas comparison

Once the candidate has been decoded and checked, **After — AI Edited** is selected automatically. Both thumbnails are keyboard-accessible buttons with a selected border and checkmark. Selecting **Before — Original** restores the original bitmap and geometry; selecting After replaces that one Konva node's bitmap and uses the same expanded bounds and rotated centre anchor as Apply. It never adds an overlapping duplicate layer. Other layers keep their render order, pixels and geometry.

`LayerEditPreviewProvider` holds only temporary React state and a decoded image. No preview action enters the Redux document, undo history, localStorage or IndexedDB. Each candidate is decoded once; toggling is local and makes no API calls. Failed decoding keeps the original canvas and disables Apply. Native image transparency is retained by the renderer; this enhancement does not change the provider or background-removal code.

Apply is enabled only when After is selected and the source is still current. It reuses the existing single undoable image-and-bounds commit. Discard immediately selects Before, then releases the candidate after the existing discard request completes. Save creative, Save Master Template and Export PNG are disabled during comparison, with an explanation beside the canvas. Apply or Discard restores those actions; exports always use accepted document data.

Dragging and transform handles for the compared object are disabled during preview. Inspector changes, other document edits, Undo or Redo end the canvas override and invalidate the candidate; undoing back to the earlier geometry does not reactivate a stale preview. Selection changes/deselection clear the override and discard the abandoned request. Switching designs unmounts the preview provider. Reload starts with committed pixels only; request recovery remains a deliberate status check and never applies automatically. Zoom and comparison toggles do not change the document.

Two defects found during browser verification were corrected: the canvas notice now overlays the heading so it cannot resize the viewport or trigger automatic zoom; unmount cleanup waits one microtask to distinguish React development StrictMode's simulated unmount from leaving the selected layer. A real unmount still discards an abandoned operation, while reloading and explicitly checking status can recover the saved candidate. An active layer comparison also takes precedence over a retained whole-design AI preview.

### Exact files for this canvas-preview continuation

| File | Change |
| --- | --- |
| `client/src/features/layers/LayerEditPreview.tsx` (new) | Temporary React context, source/version guard and render-only geometry override. |
| `client/src/features/layers/LayerEditPreview.test.ts` (new) | Preview isolation, geometry, restoration, selection and source-version tests. |
| `client/src/features/layers/LayerEditPanel.tsx` | Selectable Before/After, decoded-image validation/cancellation, current-source Apply and StrictMode-safe recovery cleanup. |
| `client/src/features/layers/layerEdit.css` | Selected thumbnail states and canvas notice without viewport resizing. |
| `client/src/features/canvas/CanvasWorkspace.tsx` | Connect the override to both existing layer render paths and display the comparison notice. |
| `client/src/features/canvas/DesignLayerNode.tsx` | Replace the bitmap in the same Konva image node; preserve stack, opacity, rotation and anchor. |
| `client/src/features/editor/EditorShell.tsx` | Scope the preview provider to the open editor/document. |
| `client/src/features/export/ExportButton.tsx` | Block unresolved comparison export with Apply/Discard guidance. |
| `client/src/features/masterTemplates/CreativeSaveButton.tsx` | Apply the same guard to creative/master saving. |
| `tests/e2e-image-templates/ai-layer-edit.spec.ts` | Real Konva pixel tests, persistence/export/navigation, double Apply, failed/missing/late decoding and optional dev-client verification. |
| `docs/ai-layer-edit-report.md` | Current implementation, exact files, evidence and usage. |

The seven other dirty files are the preserved compatibility fix and were **not changed by this continuation**: `client/src/features/layers/layerEditApi.ts`, `server/src/decomposition/layerEdit.ts`, `server/src/decomposition/layerEditImage.ts`, `server/src/decomposition/layerEdit.test.ts`, `server/src/decomposition/layerEditProvider.test.ts`, `server/src/decomposition/layerEditRoutes.test.ts`, and `tests/fixtures/imageTemplateOfflineServer.ts`. Their SHA-256 hashes match the pre-preview manifest. The earlier changes in the three shared panel/test/report files remain present too.

### Final canvas-preview verification — 1 November 2026

| Check | Confirmed result |
| --- | --- |
| Focused preview/editor/geometry/export unit tests, 6 files | **46 passed, 0 failed** |
| API, trusted source, decomposition import and browser-persistence regression tests, 7 files | **56 passed, 0 failed** |
| Production desktop browser suite, including existing layers and Refine Cutout | **13 passed, 0 failed** |
| Development StrictMode: canvas comparison, navigation/reload/status recovery, late decoding | **3 passed, 0 failed** |
| Laptop: wider rotated refrigerator and taller character | **2 passed, 0 failed** |
| TypeScript, ESLint, production build, `git diff --check` | **Passed**; Vite emits only its bundle-size advisory |

There are **102 distinct unit/API tests** and **18 passing browser executions covering 13 distinct scenarios** in these final runs. Earlier failing runs exposed the viewport-zoom and development recovery issues described above; the corrected runs have no failures. The reload test also waits for the existing debounced autosave before recording its baseline.

The browser checks inspect the real Konva nodes and pixel data, verify exactly one image per object, compare all unrelated layers, check expanded transparent geometry and rotation/opacity/anchor, and compare exported PNG pixels. They verify repeated keyboard toggles make no API requests or history/persistence changes; Before disables Apply; duplicate Apply clicks produce one undo step; Discard restores exact pixels; Undo/Redo, second editing, save/reload/export, deletion, selection, navigation and stale source checks work. Corrupt, empty and delayed image results leave the committed image intact. Before/After screenshots were visually inspected. Test image content is synthetic; no claim about new real-model output quality is made.

Evidence logs: `/private/tmp/frameflow-canvas-preview-{unit,api,browser,dev,laptop,typecheck,lint,build}.log`. Browser artifacts are under `test-results/ai-canvas-preview-{desktop,dev,laptop}/`, including `before-on-canvas.png`, `after-on-canvas.png`, and original/discarded exports. No paid API calls were made. Before/After switching costs **$0**.

Reproduce the main browser run after `npm run build`:

```sh
env OPENAI_API_KEY= FAL_KEY= GEMINI_API_KEY= CLOUDFLARE_API_TOKEN= FRAMEFLOW_OFFLINE_E2E_PORT=3351 npx playwright test -c playwright.offline.config.ts tests/e2e-image-templates/ai-layer-edit.spec.ts tests/e2e/layers.spec.ts tests/e2e-image-templates/refine-cutout.spec.ts --project=desktop --workers=1 --output=test-results/ai-canvas-preview-desktop
```

For StrictMode verification, an isolated Vite client was started with `FRAMEFLOW_CLIENT_PORT=3353 FRAMEFLOW_API_URL=http://127.0.0.1:3352 npm run dev -w @frameflow/client`. The same tests ran with `FRAMEFLOW_OFFLINE_E2E_PORT=3352 FRAMEFLOW_E2E_DEV_CLIENT=http://127.0.0.1:3353` and `--grep 'Before/After replace|selection, deselection|late candidate'`. Only client assets came from Vite; all API traffic stayed on the fake server. The isolated client was stopped afterward. The laptop run used port 3354, `--project=laptop --grep 'Before/After replace|character pose'`.

Final Git state: `feat/ai-object-edit`, HEAD `6c0a271f2c73d308a21b038a77d27bcc9182f0bb`, **16 modified tracked files and 2 new untracked files**, all uncommitted and unstaged. No commit, push, merge, reset, branch switch or worktree creation occurred in this continuation. `main`, `feat/flux-fill-repair` and the recovery stash `0b4d3a3da345e8361cea9c2e963241d787ac10a8` remain unchanged. Environment files, saved creatives/candidates and generated images were not changed by this work.

## API

All paths are under `/api/layerize-experiment`:

| Method and endpoint | Effect |
| --- | --- |
| `POST /layer-edits/estimate` | Resolve/validate the selected reference and return model, size and estimated cost; no AI call. |
| `POST /layer-edits` | One approved reference-image generation. |
| `GET /layer-edits/:id` | Read local request status/candidate; no resubmission. |
| `POST /layer-edits/:id/apply` | Validate the source revision and retain the candidate as an applied reference; client updates its document. |
| `POST /layer-edits/:id/discard` | Discard an unused pending candidate. |

Prompts are limited to 1,000 characters; JSON requests are bounded; reference images are limited to 25 MB and 4,096² pixels. File/operation identifiers are validated. Unexpected endpoint errors are returned without raw storage paths or provider bodies. SDK retries are zero; the service also submits only once per operation ID.

## Pricing and provider support

Default live model: **OpenAI GPT Image 2**, 1024 × 1024, high quality, one output PNG, with local background removal. The dated `gpt-image-2-2026-04-21` ID is also recognized. Other live model configurations are disabled for this feature until their pricing is verified.

The displayed estimate reuses the project's helper:

- High-quality square output estimate: $0.211.
- Assumed 6,800 image-input tokens at $8 per million: $0.0544.
- Assumed 1,500 text-input tokens at $5 per million: $0.0075.
- Total $0.2729, displayed as **approximately $0.27 USD per candidate**.

This is an estimate, not a billing cap or guaranteed charge. Actual token usage can differ; usage-derived cost is shown when returned by the provider. The UI names the model, asks explicit approval for each generation, and explains that failed or discarded results can still be billed. Apply, Discard, movement, resize, Save and Export do not call AI. FLUX repair pricing is not used by this feature.

Official references checked during implementation: [image output costs and input fidelity](https://developers.openai.com/api/docs/guides/image-generation), [token pricing](https://developers.openai.com/api/docs/pricing), and [image edits parameters](https://developers.openai.com/api/reference/resources/images/methods/edit). The API reference describes GPT Image 2 transparency support as **preview**. The feature no longer depends on that option. A failed generation or unsuitable image is reported without an automatic retry or a second paid cleanup call.

### HTTP 400 compatibility correction

The user's saved live operation was marked failed with `HTTP 400 (invalid_value)`. Its original record did not retain the rejected parameter or raw provider response, so the exact cause cannot be recovered from that record. The compatibility correction removes the preview transparency request and explicitly asks for the already-supported local cutout background. Future failures retain only allowlisted status, code, parameter and request ID; raw provider messages, request bodies and credentials are excluded. The duplicate retry warning is removed, and a confirmed failed response directs the user to Discard before starting a separately approved attempt. The original operation record is preserved. No live generation was made to test this correction.

Correction verification: 23 distinct focused unit/API tests passed (the adapter test was rerun after fixing its fixture ID); all four desktop browser cases passed, including plain-background output through Save/reload/export and a simulated HTTP 400 through status/Discard. Typecheck, lint and production build passed. These changes remain uncommitted on `feat/ai-object-edit`; the feature commit and recovery stash are unchanged.

**Paid calls during implementation and verification: zero.** All generation seen in tests/screenshots came from injected offline fixtures.

## Original AI editing verification (before the canvas-preview continuation)

- Selected unit/API regression run: **98 passed, 0 failed**, across 13 files.
- Final exact-provider-request and endpoint review checks: **3 passed, 0 failed** across two files. One route test repeats the regression run; there are **100 distinct unit/API tests** across the two runs.
- Desktop browser run, 1440 × 900: **7 passed, 0 failed**.
- Laptop browser run, 1366 × 768: **3 passed, 0 failed**.
- Typecheck, lint and production build: passed. Build emits Vite's bundle-size advisory; no build errors.
- `git diff --check`: passed.

Unit/API files run with `npx vitest run ... --maxWorkers=2`:

```
server/src/decomposition/layerEditRoutes.test.ts
server/src/decomposition/layerEdit.test.ts
server/src/decomposition/layerEditSource.test.ts
client/src/features/layers/layerEdit.test.ts
server/src/decomposition/layerizeAccess.test.ts
client/src/store/history.test.ts
client/src/store/layers.test.ts
client/src/features/canvas/layerGeometry.test.ts
client/src/features/export/exportPng.test.ts
client/src/features/decomposition/layerizeExperiment.test.ts
server/src/decomposition/protectedTemplates/product/ratioRegeneration.test.ts
server/src/decomposition/protectedTemplates/product/cutoutRefine.test.ts
server/src/decomposition/protectedTemplates/product/creatives.test.ts
```

Final focused run: `server/src/decomposition/layerEditProvider.test.ts` and `server/src/decomposition/layerEditRoutes.test.ts`.

Browser commands:

```sh
FRAMEFLOW_OFFLINE_E2E_PORT=3343 npx playwright test -c playwright.offline.config.ts tests/e2e-image-templates/ai-layer-edit.spec.ts tests/e2e/layers.spec.ts tests/e2e-image-templates/refine-cutout.spec.ts --project=desktop --workers=1 --output=test-results/ai-edit-desktop
FRAMEFLOW_OFFLINE_E2E_PORT=3344 npx playwright test -c playwright.offline.config.ts tests/e2e-image-templates/ai-layer-edit.spec.ts --project=laptop --workers=1 --output=test-results/ai-edit-laptop
npm run typecheck
npm run lint
npm run build
```

Provider keys were explicitly cleared for test commands; the offline browser fixture clears them too. Tests cover a wider opened-door refrigerator, a raised-arm character, reference bytes and API parameters, price approval, duplicate/concurrent attempts, malformed/opaque/clipped output, local alpha extraction, source authorization/curation, stale revisions, discard while running, timeout uncertainty, latest-image second editing, undo/redo, unrelated-layer preservation, moving/rotating, Save/reload/export and browser storage failure. Export verification checks both dimensions and pixels from the edited object. The existing layer controls and Refine Cutout flow pass unchanged.

## Run the feature in the original folder

1. Open `/Users/rohitpokhariya/Downloads/FrameFlow-template-studio` in VS Code. The active branch should be `feat/ai-object-edit`.
2. Start the existing development command:

   ```sh
   cd /Users/rohitpokhariya/Downloads/FrameFlow-template-studio
   git branch --show-current
   npm run dev
   ```

   Open the Vite URL printed in the terminal, normally `http://localhost:5173`. The existing root/server environment files and saved artifacts stay in place. `OPENAI_API_KEY` must be configured server-side for live editing; without it the panel explains that generation is unavailable. Starting the app does not generate an image.

3. In **OpenAI + Seedream test**, open a saved product creative or decomposition run, then **Open in editor**. Reopen legacy browser imports if they lack server provenance.
4. Select the **Refrigerator** object from the Layers list. Show/unlock it first. If the saved creative still marks it hidden/locked, save that change before requesting an edit.
5. In **AI Edit Layer**, enter **“Open both refrigerator doors.”** Click **Generate Edit** to review the estimate; this step makes no AI call.
6. Check the cost approval box and click **Approve and generate**. This is the paid action, approximately $0.27 under the assumptions above.
7. Click **Before — Original** and **After — AI Edited** in the right-side panel to compare the actual advertisement canvas. Switching reuses the candidate and costs $0. Check branding, color, doors, interior, edges and identity. Select After and choose **Apply edit**, or choose **Discard** to keep the original. Save/export are protected until that decision. **Regenerate · new approval** requires another explicit approval before another request. If a candidate was already generated before reloading, select the same object and use **Check request status** to retrieve it without generating again.
8. Adjust position/size/rotation using the existing controls, then **Save creative**. Reload to check persistence and click **Export PNG**. These actions do not generate another image charge.

The previous partial work can be recovered later by switching to `feat/ai-layer-edit`, locating the named stash with `git stash list`, and applying it there. Keep the stash until you have verified the restoration. Switching to the FLUX branch restores its committed repair implementation.

## Remaining practical limits

- No real AI output has been assessed. Mock images prove integration and geometry, not photographic or brand fidelity. Exact identity, fine details and requested edits are not guaranteed by the model.
- Some legitimate disconnected decorations can be refused by the conservative artifact check. Ambiguous identity or poor visual quality should be discarded.
- Arbitrary local-only images and unsaved replacement images cannot bypass trusted server source resolution. Save/reopen supported creative objects before editing them. Older direct-run imports need reopening to obtain provenance.
- Recovery uses the saved local operation/result. The synchronous Images API adapter does not supply a retrieval operation that can recover an unknown provider outcome; check provider usage before approving another request when billing is uncertain.
- The completed feature is preserved in the local feature commit. The original saved runtime data remains local and is excluded from Git; the historical Downloads backups preserve the pre-transfer source and verification evidence.

## Exact changed and added files

### Modified

| File | Purpose |
| --- | --- |
| `client/src/features/decomposition/layerizeExperiment.ts` | Preserve run-layer provenance and exclude text/base layers. |
| `client/src/features/layers/LayerInspector.tsx` | Mount the real AI Edit Layer panel. |
| `client/src/store/editorSlice.ts` | Atomic, validated image-and-bounds Apply action. |
| `server/src/decomposition/layerizeRouter.ts` | Register dedicated guarded routes and injectable provider. |
| `server/src/decomposition/protectedTemplates/product/productServer.fixture.ts` | Inject offline layer editor for integration tests. |
| `server/src/decomposition/protectedTemplates/product/ratioRegeneration.ts` | Optional transparent output parameter; existing calls unchanged. |
| `server/src/decomposition/protectedTemplates/product/uploadCutout.ts` | Expose trim bounds without changing cutout processing. |
| `shared/src/index.ts` | Export the shared contracts. |
| `tests/fixtures/imageTemplateOfflineServer.ts` | Synthetic expanded-object and character responses for browser tests. |

### Added

| File | Purpose |
| --- | --- |
| `client/src/features/layers/LayerEditPanel.tsx` | Prompt, cost approval, preview, status recovery, Apply/Discard. |
| `client/src/features/layers/layerEdit.css` | Scoped panel and checkerboard styling. |
| `client/src/features/layers/layerEdit.ts` | Selection eligibility, snapshot and geometry mapping. |
| `client/src/features/layers/layerEditApi.ts` | Same-origin API and image hashing. |
| `client/src/features/layers/layerEdit.test.ts` | Geometry, isolation, eligibility and history tests. |
| `server/src/decomposition/layerEdit.ts` | Single-attempt ledger, approval, candidate lifecycle and expiry. |
| `server/src/decomposition/layerEditImage.ts` | Reference preparation, identity prompt and output validation. |
| `server/src/decomposition/layerEditSource.ts` | Trusted saved-source resolution. |
| `server/src/decomposition/layerEditRoutes.ts` | Dedicated endpoints and safe errors. |
| `server/src/decomposition/layerEdit.test.ts` | Image, failure, approval, concurrency and recovery tests. |
| `server/src/decomposition/layerEditSource.test.ts` | Curated-run membership and path/type validation. |
| `server/src/decomposition/layerEditRoutes.test.ts` | Actual creative/API/access/revision integration. |
| `server/src/decomposition/layerEditProvider.test.ts` | Exact SDK request and unchanged default adapter settings. |
| `shared/src/layerEdit.ts` | Source, request, cost, geometry, candidate and status types. |
| `tests/e2e-image-templates/ai-layer-edit.spec.ts` | Full editor workflow, stale selection and storage-failure browser tests. |
| `docs/ai-layer-edit-report.md` | This report and launch instructions. |
