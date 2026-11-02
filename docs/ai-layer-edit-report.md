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
| `POST /layer-edits/estimate` | Resolve/validate the selected reference and return model, size, estimated cost, the edit type read from `prompt`, and the reference images (`references`); no AI call. Optional `prompt`, `region`, `useOriginalReference`. |
| `POST /layer-edits` | One approved reference-image generation. `confirmAmbiguous: true` is required when the estimate asked for a clarification. |
| `GET /layer-edits/:id` | Read local request status/candidate (with its identity verdict); no resubmission. |
| `POST /layer-edits/:id/apply` | Validate the source revision and retain the candidate as an applied reference; client updates its document. A result flagged `drift-suspected` needs `acceptIdentityRisk: true` (HTTP 422 `IDENTITY_REVIEW_REQUIRED` otherwise). |
| `POST /layer-edits/:id/discard` | Discard an unused pending candidate. `reason: "identity"` rejects it as another product: its image is kept on the server for review until the preview expires, never served or applied. |

Prompts are limited to 1,000 characters; JSON requests are bounded; reference images are limited to 25 MB and 4,096² pixels. File/operation identifiers are validated. Unexpected endpoint errors are returned without raw storage paths or provider bodies. SDK retries are zero; the service also submits only once per operation ID.

## Pricing and provider support

Default live model: **OpenAI GPT Image 2**, high quality, one output PNG, with local background removal. Edits that move parts (open, close, raise …), add a feature or replace the object use the square 1024 × 1024 frame; other edits use a frame shaped like the object within the same 1,048,576-pixel budget (for example 928 × 1120), so the estimate never exceeds the square one's. The dated `gpt-image-2-2026-04-21` ID is also recognized. Other live model configurations are disabled for this feature until their pricing is verified.

The displayed estimate reuses the project's helper:

- High-quality square output estimate: $0.211.
- Assumed 6,800 image-input tokens at $8 per million: $0.0544.
- Assumed 1,500 text-input tokens at $5 per million: $0.0075.
- Total $0.2729, displayed as **approximately $0.27 USD per candidate**.
- When an earlier AI edit's original product is attached as a second input image (default for chained edits, can be left out in the approval card): **+$0.05** (the same 6,800 image tokens), shown before approval.

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

## False "The layer changed during generation" — 2 November 2026

**Incident.** Ornate Golden Appliance Showcase (`pt-0dd04956555b`), creative `pc-9ef215`, layer `object-po-a996c422e6` (Freestanding dishwasher), prompt "open this". Operation `4a334bdd` (started 00:22:14 IST) was rejected; the immediate retry `7a2d07f3` (00:24:30) succeeded. Both records have the same target, revision 1 and source hash `2267c918105b…`. The failed record has a provider request ID (`req_bd14b7a9…`) and cost ($0.22), so the server sent it and received a result. It ended `discarded` with its candidate deleted at 00:23:38. The server never rejected it. The editor's own render-time check did: that title appears only in the panel's `stale` phase while generating. No Save happened (no `pcr-9ef215-r2.json`). No client or server source file changed during 00:22–00:24, so HMR or a server restart is ruled out. The exact client-side change in that browser session was not recorded and is still unproven.

**Reproduced offline on the real saved template** (`tests/e2e-image-templates/ai-layer-edit-stale.spec.ts`, held fake provider, before the fix). Each action ran alone against its own held "open this" request:

- No conflict: a click on the dishwasher, pressing a resize or rotate handle (rotation 0), zoom/Fit, window resize, hiding and showing another layer, Save creative.
- False conflict:
  - Reordering another layer past it, and reordering it back: `zIndex` renumbering.
  - Changing the canvas fill, then Undo: `variant.canvas` was in the fingerprint.
  - Pressing the handles of a rotated object: `onTransformEnd` re-normalised 12.3° to 12.299999999999955°.
- A genuine 5 px slip-drag was rejected, as it should be, but the client then **deleted the completed paid result** (status `discarded`).

**Changes (client only; no server, provider, prompt or pipeline change).**

- `layerEdit.ts`: the source fingerprint leaves out `zIndex` and the canvas fill. It keeps the image, placement, eligibility fields, canvas size and creative identity. Snapshots in both earlier formats are still accepted for recovery. Adds `layerEditChanges` and `describeLayerEditChanges` for diagnostics.
- `LayerEditPanel.tsx`:
  - A result that arrives after a client-detected change is no longer discarded. It stays on the server and in the layer's recovery record.
  - The conflict card names what changed, for example "Changed: position (x 688 → 692.5)".
  - Once the layer matches the request again (for example after Undo), an explicit **Check request status** re-verifies it and collects the result. Undo alone never revives it, and only Discard deletes it.
- `layerEditFlow.ts`: every stale rejection is logged to the console and kept, last 20, in `localStorage['frameflow-layer-edit-conflicts']`. Each entry holds the operation, layer, where it was detected (client or server), whether a result arrived, before/after fingerprints and versions, and the changed fields with numeric before/after values. It holds no image, prompt or name.
- `layerGeometry.ts` / `DesignLayerNode.tsx`: a Transformer gesture that changed nothing commits nothing.

**Still protected.** Moving, resizing, rotating, replacing, hiding, locking or deleting the selected layer, or resizing the canvas, still invalidates the request, including when the change is undone. The server still re-verifies the saved source bytes on status and Apply.

## Product identity drift — 2 November 2026

**Incident.** Ornate Golden Appliance Showcase (`pt-0dd04956555b`), creative `pc-9ef215`, layer `object-po-26b435b116` (Multi-door refrigerator). Two applied edits:

| Edit | Record / request | Reference sent | Result |
| --- | --- | --- | --- |
| open | `b4a8b638`, `req_981728fa…`, $0.22 | the original (`80b0c3…`, 191 × 355 px) | dark graphite became light silver; the asymmetric 40/60 door split became 50/50; bright `#00ff00` strips in the door seam (652 near-exact key pixels) |
| close | `b875268c`, `req_d38739ae…`, $0.22 | **the AI "open" result** (`4b8214…`), not the original | kept every drift, including the green strips; feet added; about 10 % larger than the original |

**Root causes (from the recorded requests and local reconstruction).**

1. Chained edits sent only the previous AI result. Drift compounded and the original product was never seen again, although it is still resolvable through the creative object's template picture.
2. A weak reference: the product (only 191 × 355 px in the 1254² creative) was upscaled to 301 × 560 inside a 1024² frame, about 16 % of the image, on a saturated chroma key. GPT Image 2 re-renders the whole image; the installed SDK (OpenAI 7.23.0) documents that `gpt-image-2` ignores `input_fidelity`.
3. The prompt asked for the key colour in "visible gaps … through the object", and the cut-out removes only background reachable from the image edges. The leftover-key check looked only at the current key, with a 2 % limit, so the green strips passed and became "product" for the next edit.
4. No identity check: `identity: 'review-required'` was hard-coded.

Ruled out: chroma bleed from semi-transparent pixels (the original's seam is fully opaque; there are no interior semi-transparent pixels). No higher-resolution source of the refrigerator exists.

**Changes.**

- **Edit intent** (`layerEditIntent.ts`, local, no AI call): state change, colour, material, add, remove, repair, replace or general, read from the instruction. Negated and "keep …" clauses are ignored, and colour words without a change cue are descriptions. A contradictory instruction (the reported "open the door and close it out") or an empty, vague one returns a clarification. Generating it then needs an explicit "as written" confirmation, or nothing is sent (`CLARIFICATION_REQUIRED`).
- **References** (`layerEdit.ts`): the image edited is always the current layer, so approved edits are kept. The original product (`creatives.originalPicture`, the same lookup Restore uses) is attached as image 2 only when applied edit records connect the current image to it by exact SHA-256 hashes. Saved layers keep their bytes, so the link survives Save, and a lineage summary survives preview expiry. An untraceable or uploaded image is never paired with the template product, and the estimate says why. The prompt names the earlier recorded instructions. Records now keep the instruction, the edit type, what was sent (without image bytes) and the lineage.
- **Framing** (`layerEditImage.ts`): edits that keep the outline fill 80 % of a frame shaped like the object, within the square's pixel budget. The key colour is the one neither image uses. Measured main colours and proportions are stated in the prompt. The prompt keeps the key colour out of seams, gaps between doors and dark interiors.
- **Area limit**: an optional rectangle drawn in the approval card. The request carries an `images.edit` mask for image 1. Every pixel outside the area is restored exactly from the reference after generation, and the geometry uses the real centre.
- **Despill**: key-colour spill is removed from outline pixels only.
- **Identity gate** (`layerEditIdentity.ts`, local pixel checks) on every new result:
  - keying colour inside the object, compared with the original
  - outline fringe
  - size (one dimension kept for moving parts)
  - colours and finish (CIELAB lightness distribution plus average colour shift)
  - layout (coarse lightness and edge correlation)
  - outline overlap
  - for an area limit, how much the model changed outside it

  Each check runs only where the edit type makes it meaningful. A pure reversal of the last recorded state change (close after open) is checked strictly against the image before that change, at the size the chain implies. Any failure, or two warnings about the product, means `drift-suspected`. Checks that cannot apply, such as layout after opening doors, are named, and the verdict is then `review-required`. `consistent` is still presented as pixel evidence, not a guarantee.
- **Panel**:
  - The approval card shows the edit type, output size, reference images, an attach/leave-out toggle for the original, the area picker and the clarification.
  - The comparison shows the verdict with its checks.
  - A flagged result needs "I compared Before and After: it is the same product" before Apply, or **Reject · not the same product**. Reject is free, the layer is unchanged and nothing is regenerated.

**Calibration on the recorded images.** The same product re-scaled, blurred or tinted scores at least 0.99 layout similarity with a finish distance of 5 or less. The drifted "close" scores 0.53, is 10 lightness units lighter and 12 % / 10 % larger. A different product scores about 0.05 with a distance of 24. Both recorded results are `drift-suspected`: green inside the object, and for the "close", layout, finish and size as well.

**Not verified.** No live request was made. Offline fakes show what is sent, kept and checked; they cannot show how faithfully GPT Image 2 now preserves a product. Multi-image and masked requests to `gpt-image-2` are accepted by the SDK types but have not been sent on this account. The thresholds are calibrated on one real product family plus drawn fixtures.

## Interrupted requests and consecutive edits — 2 November 2026

**Incident.** Template `pt-bf4a46747d65`, layer `object-po-106ae076c2`:

| Time (IST) | Operation | Instruction | Images | Duration | Outcome |
| --- | --- | --- | --- | --- | --- |
| 16:33:05 | `337b337c` | open the door | 1 | 112 s | applied (`req_c23ac4e4…`, $0.221) |
| 16:35:19 | `cb86816e` | close the door (chained) | 2 | 83 s | succeeded (`req_940b1e23…`, $0.23), then discarded |
| 16:37:09 | `f35a5009` | open all doors (chained) | 2 | **56 s** | **uncertain**: transport closed, no HTTP status, no request ID |

**Established:**
- The failure happened inside the provider call, after the request was handed over. Stage B (OpenAI still processing) is most likely, since the other edits needed 83–112 s.
- Not a timeout: the SDK, undici and server deadlines are all 300–310 s.
- Not a server restart: the server process was unchanged, and a restart would have recorded a different message.
- Not the attached reference image: an identical two-image request had succeeded two minutes earlier.

**Unknown:**
- The exact socket error. The service passed a no-op `save` and kept only the top-level error code.
- Whether OpenAI completed and billed it. Check usage at 16:37–16:39 IST.

**OpenAI 7.23.0 `images.edit`, verified in the installed SDK:**
- **No** retrieval by ID, background mode, polling, cancellation, or download after a disconnect.
- **No** idempotency: the client sets no `idempotencyHeader`, so `idempotencyKey` is ignored.
- Streaming exists, but a streamed result is no more recoverable after a disconnect.

A response lost on the connection therefore cannot be fetched again. It stays `uncertain`.

**Lifecycle (`layerEdit.ts`).** The persisted record is the authority.
- **Phases.** `running` records carry a phase, written before each step: `queued` (nothing sent), `submitting` (written just before the provider call) and `received`.
- **Restart.** `queued` becomes a free failure, `submitting` becomes `uncertain`, and `received` is finished from the saved image (validation only, no provider call).
- **Received images.** The provider's image is written to `<id>.output.png` before validation. If it is unusable, the edit is reported as charged and the image is kept for a day.
- **Late responses.** A response that arrives after the server's own deadline is still turned into a candidate.
- **Diagnostics.** Failures keep the allowlisted cause chain (codes, socket byte counts), the phase and the elapsed time.
- **Unreachable provider.** DNS, refused and unreachable errors mean the request never left the server, so they are `failed` with nothing charged.
- **Billing.** `failed`, `uncertain` and `discarded` statuses report `billing: none | possible | charged`. "None" is reported only with evidence.
- **Repeated operation IDs.** A repeated ID returns the stored candidate, or the recorded state. A different request reusing the same ID is refused.
- **One edit per layer.** The lock is keyed by the layer, not the creative revision, so a Save during generation no longer allows a second paid request.
- **Discards.** A discard while queued sends nothing (previously the request was still sent). A discard while the provider works is no longer overwritten, and its cost is recorded.
- **Setting aside.** An `uncertain` or `failed` edit that is discarded keeps its record and outcome (`abandoned`).
- **Lookup.** `POST /layer-edits/open` finds the latest unfinished edit of a layer made from its current image, for a browser that lost its local record.

**Panel:**
- Automatic, bounded, free status checks for requests whose result is not loaded: running, lost response, or found after a reload. They are spaced 1.5–15 s apart and stop after 6 minutes. A failed check never becomes a failed edit.
- A request this browser has no record of is found through the server lookup.
- The pending card shows the request ID, when it was sent, how far it got and what was charged.
- "Provider outcome unknown" offers **Set aside · start a new edit**, which states that a new edit is a separate paid request.
- Discard and manual checks take priority over automatic ones.

**Tests:**
- `layerEditLifecycle.test.ts`: 10 tests over real record files, with a holdable, failing and delayable fake provider and restarts.
- Updated server and client unit tests.
- Browser:
  - new: a provider connection lost after sending
  - updated: lost-response, reselect and reload collection is now automatic

## Remaining practical limits

- No real AI output from the identity-preserving request has been assessed. Mock images prove integration, geometry and the gate's decisions, not photographic or brand fidelity. Exact identity, fine details and requested edits are not guaranteed by the model. The identity gate compares pixels: it cannot read small logos or text, and it cannot judge the colours or layout of parts that an edit moves.
- Some legitimate disconnected decorations can be refused by the conservative artifact check. Ambiguous identity or poor visual quality should be discarded.
- Arbitrary local-only images and unsaved replacement images cannot bypass trusted server source resolution. Save/reopen supported creative objects before editing them. Older direct-run imports need reopening to obtain provenance.
- Recovery uses the server's saved operation and result. OpenAI's `images.edit` cannot retrieve a result whose response was lost (no retrieval, background mode or idempotency for this endpoint), so such an edit stays `uncertain`. Check provider usage, then set it aside. Streaming would show OpenAI's request ID earlier, but it has not been tried live.
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
| `tests/e2e-image-templates/ai-layer-edit-stale.spec.ts` | Real saved templates: harmless activity during a held generation, genuine conflicts, kept results. |
| `client/src/features/layers/layerEditStale.test.ts` | Fingerprint, change-then-Undo, diagnostics and no-op Transformer tests. |
| `docs/ai-layer-edit-report.md` | This report and launch instructions. |

### Identity preservation (2 November 2026)

| File | Change |
| --- | --- |
| `shared/src/layerEdit.ts` | Edit options (prompt, area, original reference), intent, references, identity checks and verdicts; `LAYER_EDIT_REFERENCE_USD`. Older records stay valid. |
| `server/src/decomposition/layerEditIntent.ts` (added) | Local edit-type reading, clarification and reversal detection. |
| `server/src/decomposition/layerEditIdentity.ts` (added) | The identity gate. |
| `server/src/decomposition/layerEditImage.ts` | Intent-aware framing, two-image key choice, area mask and exact compositing, measured palette, intent-specific prompt, outline despill, exact centre for area edits. |
| `server/src/decomposition/layerEdit.ts` | Lineage tracing, original reference, quote = generation plan, gate, Apply confirmation, Reject, richer records. |
| `server/src/decomposition/layerEditSource.ts` | Resolves the original product with the layer. |
| `server/src/decomposition/layerEditRoutes.ts` | Passes `acceptIdentityRisk` and the reject reason. |
| `server/src/decomposition/layerizeRouter.ts` | `CLARIFICATION_REQUIRED` and `IDENTITY_REVIEW_REQUIRED` → HTTP 422. |
| `server/src/decomposition/protectedTemplates/product/creatives.ts` | `originalPicture` (read only), sharing Restore's lookup. |
| `server/src/decomposition/protectedTemplates/product/ratioRegeneration.ts` | Optional extra reference images after the edited image; existing callers unchanged. |
| `client/src/features/layers/LayerEditPanel.tsx`, `layerEditApi.ts`, `layerEditFlow.ts`, `layerEdit.css` | Approval details, reference toggle, clarification, area limit, verdict and checks, confirmation and Reject. |
| `client/src/features/layers/LayerEditRegionPicker.tsx` (added) | Area selection on the layer image. |
| `server/src/decomposition/layerEdit.fixture.ts` (added) | Drawn refrigerator and washing machines, and a fake model that edits the image it receives. |
| `server/src/decomposition/layerEditIntent.test.ts`, `layerEditIdentity.test.ts` (added); `layerEdit.test.ts`, `layerEditProvider.test.ts`, `layerEditRoutes.test.ts`; `client/src/features/layers/layerEditFlow.test.ts` | Offline tests, including the recorded refrigerator edits when present locally. |
| `tests/fixtures/imageTemplateOfflineServer.ts`, `tests/e2e-image-templates/ai-layer-edit.spec.ts` | Size-aware, image-derived offline editor; flagged-result browser test; instruction-only call counting. |

### Interrupted requests (2 November 2026)

| File | Change |
| --- | --- |
| `shared/src/layerEdit.ts` | `LayerEditPhase`; `phase`, `submittedAt`, `billing` on statuses (optional). |
| `server/src/decomposition/layerEdit.ts` | Persisted phases, restart reconciliation, raw output first, late responses, transport diagnostics, undelivered classification, billing, operation replay, per-layer lock, discard races, `open` lookup. |
| `server/src/decomposition/layerEditRoutes.ts` | `POST /layer-edits/open`. |
| `client/src/features/layers/LayerEditPanel.tsx`, `layerEditFlow.ts`, `layerEditApi.ts` | Automatic bounded status checks, server lookup, pending details, set aside, billing text. |
| `server/src/decomposition/layerEditLifecycle.test.ts` (added); `layerEdit.test.ts`, `layerEditRoutes.test.ts`; `client/src/features/layers/layerEditFlow.test.ts` | Lifecycle tests; repeated operations now return the stored result. |
| `tests/fixtures/imageTemplateOfflineServer.ts`, `tests/e2e-image-templates/ai-layer-edit.spec.ts` | `connection lost test` trigger; automatic collection; set-aside browser test. |
