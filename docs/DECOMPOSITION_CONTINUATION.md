# Decomposition continuation — 30 October 2026

## Update (later the same day)

- **Root cause of the dirty layers in production:** the layer-evidence path below was behind `FRAMEFLOW_CUTOUT_VERIFICATION=1`,
  off by default, so every prepare used the old path: each Seedream layer cut to a binary mask and filled with the flattened
  picture (the medallion and the dishwasher's edge copied into the refrigerator, hidden parts continued as grey smears).
  The check is now **on by default** (`=0` turns it off). It runs on this computer: no paid call, no change in cost.
- **Local alignment of hidden regions** (`layerEvidence.ts`): each completed region takes the layer's drawing shifted by up
  to 2 px when that clearly matches the visible pixels round it better. On Navratri only the refrigerator's strip behind the
  washing machine changed (its handle line now continues); every other layer is byte-identical.
- **One approved AI completion experiment** (OpenAI `gpt-image-2`, `images.edit`, request `req_4014480a215645ddb6f5bcbfbf9d9da1`,
  estimate $0.38, cost from its usage **$0.178**): the existing Refine-cutout request (hidden parts magenta on green) for the
  refrigerator. The model drew a clean refrigerator but about 8% narrower and shifted, so merged into the verified cut-out it
  left seams and a lighter band along the right edge, even after registering it (scale + shift). **Not adopted**; the local
  layer-evidence cut-out is cleaner. Scripts and outputs: `test-results/ai-completion/` (ignored).


Status (morning): incomplete; not committed or pushed. Branch `feat/targeted-layer-refinement`; starting HEAD `fd19579`.
Existing work, original assets, `.env`, and live saved templates were preserved. All replays used copied stores.

## Actual fixes

- Preserve registered provider RGBA instead of reconstructing object edges from binary masks. This removes the
  refrigerator notch, appliance protrusions, and obvious dancer fragments in the real Navratri replay.
- Keep verified source interior pixels. Preserve provider hidden-object geometry where available; identify copied
  foreground regions. Disclose local colour continuation, unresolved pixels, and unverifiable hidden geometry.
- Prevent a copied artwork boundary from feeding neighbouring completion pixels. Restrict source-edge extension to
  independently supported provider pixels, rather than propagating newly admitted source pixels.
- Include reviewed product footprints in background removal, protecting identified scenery. The central refrigerator
  floor dash disappears; some diffuse shadow remnants remain.
- Detect repeated foreground pixels when a provider omitted a usable layer (Ganesh TV/soundbar). Warn instead of
  silently certifying the TV as independent. Preserve raw provider assets and reports through persistence/editor paths.
- Label artwork overlap pieces honestly: they preserve stacking but do not separate the whole decoration.

## Visual evidence and acceptance

Open `test-results/evidence-continuation/review.html` for original / flag-OFF / current comparisons, independent PNGs on
checker, white and dark backgrounds, and hide/move scenes. Original PNGs and native-resolution sheets are linked there.
PASS here is inspected cutout quality, not proof that hidden geometry is authentic.

| Object / requirement | Result | Observation |
| --- | --- | --- |
| Navratri refrigerator | FAIL | Continuous complete-looking silhouette; faint decoration-coloured traces remain on upper door. |
| Washing machine | PASS | No visible neighbouring appliance pixels or old edge protrusions. |
| Dishwasher | PASS | Independent outline; display and handle retained. |
| Deity arms | PASS | Large background panel gone; inspected hands, ornaments and soft edges on dark background. |
| Female dancer | PASS | Obvious backdrop fragments removed; clothes, sticks and ornaments retained. |
| Male dancer | PASS | Clean inspected boundary; source-visible details retained. |
| Whole decorations | FAIL | Production output still contains partial overlap pieces and background artwork. |
| Background on movement | FAIL | Main dash removed, but shadow remnants remain. |
| Hidden geometry fidelity | UNVERIFIED | Plausible provider completions are estimates; no authentic reference verifies them. |
| Ganesh OLED TV | FAIL | Colourful display preserved, but wall panel and soundbar still included. |
| Ganesh soundbar | FAIL | Coloured fragments above it remain. |
| Ganesh subwoofer / two satellites | PASS | Separate inspected cutouts without the TV's wall panel. |

Navratri final: `navratri-final/` (1770×572), six objects plus four partial stacking overlays.
Ganesh final: `ganesh-alpha-final/`, replayed from the **exact recorded text-free input** (1151×2047). The newer original
source does not match the recording and was correctly rejected. This is not proof of current original-source Ganesh
text cleanup or full preparation quality.

## One approved paid experiment

The user approved exactly one SAM-3 medallion request, estimated **$0.005**, with no retries. Executed endpoint
`fal-ai/sam-3/image`; request ID `01a18b66-9686-7242-9474-eb74e9801405`. The experiment deliberately used that approved
endpoint, not the application's default `sam-3-1/image` endpoint. Published price checked at
<https://fal.ai/models/fal-ai/sam-3/image>; actual invoice amount was not retrieved.

Evidence: `test-results/evidence-continuation/approved-medallion-mask/`. Candidate 0 covers the correct full medallion
(128×122 at 955,168, confidence 0.977); candidates 1 and 2 target other decorations and were rejected. Source colours
are retained. This is segmentation, not image generation. The green interior remains as in the source.

Local background rebuilding under this full mask leaves a visible circular patch and edge remnants
(`background-detail.png`). Consequently, the mask is preserved as a validated experiment and **has not been adopted as
finished automatic decoration output**. No repeated paid call, generation call, or live template replacement was made.

Smallest next repair: use the existing `cleanBackground.ts` masked image-edit adapter on a tight medallion neighbourhood,
then composite strictly inside that removal mask and inspect before adopting. Its existing no-retry transport and
outside-mask preservation can be reused. A 1024-square request is approximately **$0.27 by the repository estimator**;
this is an estimate, not a provider-enforced cap. It requires separate explicit cost approval. Ganesh masks and any
additional reconstruction also need their own approved scope. A successful background experiment still needs an
automatic preparation integration; no manual PNG substitution is counted as completing the feature.

The next request is concretely prepared at `test-results/evidence-continuation/proposed-medallion-background/`:
400×400 source neighbourhood, 1024×1024 provider input and mask, exact prompt and SHA-256 hashes in `request.json`.
It has not been sent. Approval for the completed SAM-3 call does not authorize this separate image-generation request.

## Validation actually run

Final bounded checks after the alpha/footprint corrections:

- Typecheck, lint, build: PASS. Build retains the existing large-bundle warning.
- Four focused test files: 19 passed, one newly added test had an incorrect unregistered-edge expectation. The test
  accessor also wrapped an out-of-bounds coordinate onto the following row. Corrected both test assumptions; all eight
  layer-evidence tests then passed. The other three files passed unchanged: **20 focused tests pass in total**.
- Final real Navratri prepare → approve → publish → creative → duplicate → editor replay: PASS, $0 provider cost.
- Final real Konva test: **1 passed**, assets, hide/show, move, resize, duplicate, save/reload and PNG export.
- Final Ganesh recorded-input replay: PASS as a workflow, **FAIL visual acceptance** as described above.
- `git diff --check`: PASS.

Earlier checks in this same continuation, before the last alpha changes (not rerun wholesale):

- Product server suite: **32 files / 144 tests passed**.
- Flag ON browser regression: **10 passed / 1 skipped / 1 failed**. Failure: absent root `Ganesh-Chaturthi.png` returns
  404; test cannot generate its expected four creatives. Flag OFF has the same fixture failure; AI decomposition passes.
- Variation/reuse browser group: **2 passed / 3 skipped** (missing optional reuse fixture/environment).
- Legacy decomposition browser suite: **12 passed / 1 failed**. Launcher-count/order expectation assumes three launchers;
  application has four, including Create Offer Creative. Actual legacy decomposition workflows passed.

Logs are in `test-results/evidence-continuation/*log`; the evidence folder is ignored by Git.

## Compatibility

The established flag-OFF real Navratri baseline (`navratri-http-off/`) matches the original six PNG cutouts and background
byte for byte. New alpha and footprint logic is gated by usable evidence, which only runs with the flag enabled.
No migration, live asset overwrite, main-branch update, commit, or push was performed. The unrelated user PNG remains
untracked and untouched. Commit/push is deferred because the requested visual acceptance criteria still fail.
