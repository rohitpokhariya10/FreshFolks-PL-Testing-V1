# Cut-out verification after a decomposition

## Current continuation (30 October 2026)

**Incomplete: do not treat passing workflow tests as visual acceptance.** The historical implementation and measurements
below describe the earlier product-only verifier, not the current layer-evidence output.

On by default (`FRAMEFLOW_CUTOUT_VERIFICATION=0` turns it off), usable Seedream layers now drive ownership for products and characters. Each raw
RGBA layer is registered against the source and competing layers. Final cutouts retain registered alpha, verified source
interiors, and the provider's hidden-object drawing. A confirmed copied foreground is continued locally only when donors
exist; missing donors remain transparent. Hidden shape, local interpolation, rejected evidence, and duplicated foreground
ownership are reported as uncertain. In particular, an inferred surface is not authentic recovered geometry.

The previous conversion to a binary mask discarded soft alpha, grew foreign source pixels into the edge, and switched
silhouettes at occlusions. `evidenceCutout` removes that conversion for usable evidence. Background removal also includes
the reviewed product footprint while protecting identified decorations and frames. This removed the central Navratri
floor dash but did not eliminate every shadow remnant.

Raw provider PNGs and evidence reports persist through preparation, snapshots, creative duplication, and editor import.
Partial artwork overlaps retain stacking and explicitly warn that the rest of the decoration remains in the background.
They are **not complete independently movable decorations**. Non-evidence products still use the older verifier below.
The check is on by default since 30 October 2026 (`FRAMEFLOW_CUTOUT_VERIFICATION=0` turns it off); it applies to templates prepared from then on, and saved creatives are not rewritten.

`recordedLayerizer.ts` is an explicit offline test adapter: it requires an exact decoded provider-input match and valid
PNG layers, never fetches expired provider URLs, and never activates in production. Run a copied-store replay with:

```sh
node --conditions=development --import tsx tests/fixtures/layerEvidenceReplay.ts SOURCE LAYERS NEW_OUTPUT on
```

Current image acceptance and validation details: [DECOMPOSITION_CONTINUATION.md](DECOMPOSITION_CONTINUATION.md).

## Historical product-only verifier (superseded where layer evidence is available)

A post-processing stage behind a feature flag. After the decomposition (OpenAI planner → Seedream Layerize, or the local or SAM 3 separation) has made each object's layer, every **product** layer is checked against the evidence the decomposition left and repaired on this computer, before the template is reviewed. It sends nothing anywhere and charges nothing.

## Turning it on

| Where | How |
| --- | --- |
| Server | On by default. `FRAMEFLOW_CUTOUT_VERIFICATION=0` in the environment (`.env`) turns it off, and `prepare` then behaves exactly as before. |
| Code | `createLayerizeRouter({ productCutoutVerification: () => true })`, which passes `cutoutVerification` to the product service and `verifyCutouts` to `prepareProduct`. |
| Tests | `setup({ cutoutVerification: true })` (`productServer.fixture.ts`). |

It applies to templates prepared while it is on. Templates and creatives saved before are not changed.

## Why it is needed

A product's cut-out is the clean picture's pixels inside its ownership mask, plus a completion: the part hidden behind products in front is continued from the product's own mask pixels (`prepare.ts`, step 4). Three things go wrong, all seen in saved creatives:

- **The mask takes a neighbour's pixels.** The completion then copies them, for example a refrigerator's corner rebuilt as a flat grey block from a dishwasher's side wall.
- **The mask takes the backdrop's decoration.** A festive wheel or a chevron is kept inside a refrigerator's layer while the background plate holds it too, so it moves with the product as a copy.
- **The mask runs past the product.** The backdrop under an air conditioner, or a soundbar's pixels inside a television's layer, come along with it.

## What it uses (`cutoutRefine.ts:cutoutDefects`, shared with the manual Refine cutout)

- **The picture**, at each layer pixel's place.
- **The layers in front of it**, by z-order and overlap, and their alpha at the same place.
- **The background plate** (`snapshot.base`), the decomposition's picture without its objects.

Each pixel of the layer is classified:

| Class | Test |
| --- | --- |
| hidden | at least half covered by a layer in front |
| the plate's content | matches the plate at the same place, softened (σ 1.5) or as is, within 2 px and 32 levels a channel; in a patch that reaches the layer's outline, mostly in colours rare among the product's own (8 levels a channel, under 0.5%) |
| differing | solid pixels unlike the picture by more than 40, in patches, not along the edge |
| verified | everything else: kept byte for byte |

Colour is never the decision on its own; it guards the plate match against coincidences. Each region (8-connected) is then placed against the verified pixels. A side counts as the product's when at least half of a band just past the region's bounding box on that side is verified product.

| Region | Action |
| --- | --- |
| the plate's content, thinner than max(3 px, 1% of the layer) | **keep** (an edge band, which cannot be told from the product's own rim); a small speck enclosed by the product is **rebuilt** |
| the plate's content, product on two sides across a corner or on two opposite sides | **rebuild** as the product: a decoration over its corner |
| the plate's content, otherwise | **clear** (transparent): the backdrop past its outline |
| hidden, inside as above, or thin | **rebuild** within the outline the decomposition gave it |
| hidden, outside, mostly not its own colours | **clear**: the decomposition's backdrop behind a speaker |
| hidden, outside, in its own colours | **keep and report**: a television behind a soundbar as wide as it is never cut |

The thresholds were measured on 160 saved product cut-outs:

- the Navratri wheel is 20 px thick, with product to its left and below;
- a chevron is 9 px thick, with product to its left and above;
- a purifier's rim is 1–2 px thick;
- the backdrop under an air conditioner is 5 and 11 px thick, with product above at most;
- the block behind its speaker has product on no side.

**Rebuilding** continues the nearest verified pixels along each row and column, weighted by 1/distance². An axis whose two sides agree counts 100 times more, and one whose sides differ counts 100 times less: a soundbar's strip continues the wall on its left and right, not the screen above it. The outline (alpha) is kept, except for one-pixel spurs of the estimated outline. Soft edges are not defringed in this stage, so a rim or soft shadow stays the product's. Clear pixels carry no colour.

## What it reports (`cutout.verification`, optional, on `ProductCutout`)

- **Pixels:** solid, hidden (and behind which layers), the plate's content, kept edge bands, kept hidden, differing.
- **Actions:** rebuilt, cleared, filled, removed, and whether the repair was applied.
- **Detail:** the mean local spread of the luminance around what was rebuilt.
- **Original:** the decomposition's own layer, `{ file, sha256 }`, kept beside the repaired one.
- **`uncertain` and its reasons**, flagged when any of these holds:
  - more than 20% of the product is an estimate;
  - what it hides borders detailed content (detail > 12): a picture, a label or controls;
  - more than 1% of it is hidden, lies past its visible outline and was left as decomposed.

It also adds these to the existing Checks list, all non-blocking:

- `cutouts-verified`: which layers were repaired;
- `uncertain-<id>`: the reasons, with the way to an exact layer — Refine cutout → Complete with AI (its estimate shown and approved first) or a product photo.

**Safety:** a repair that would clear more than 30% of a product is not applied; it is reported instead. Characters, stands, decorations, uploaded product photos and known layers are never changed.

## Results on the saved templates (replay; read-only)

The stage was replayed on every saved template's own cut-outs, background plate and picture (what `prepare` hands it) for 155 product layers in 26 templates:

| Outcome | Layers | Notes |
| --- | --- | --- |
| repaired | 68 | 55 rebuilt, 12 with parts cleared |
| uncertain | 13 | |
| unchanged | 87 | including every colourful one inspected: gaming laptop, smartphones, payment soundbox, flat-screen TV, water purifier |

The slowest template took about 5 s. Fixed:

- the Navratri refrigerators (gray block, washing machine fringe, festive wheel);
- the Ganesh side-by-side refrigerators (chevron);
- the air conditioner (the backdrop and the block behind the speaker);
- the OLED televisions (the soundbar's strip, now the wall panel).

## Known limits

- **A layer that includes a stand or another object whose pixels are neither the plate's nor hidden** cannot be told from the product by this evidence. Example: a microwave's green pedestal. It is reported uncertain when large, and needs a better mask at decomposition time.
- **An object whose detected box is too small** leaves the rest of it in a neighbour's layer. Example: a subwoofer 33 px tall inside a television's layer.
- **A detailed hidden part**, such as a television's picture behind a laptop, is a continuation, not a recovery. It is reported uncertain; the approved AI completion or a product photo is the way to an exact layer.
- **A product whose edge colour matches the backdrop right behind it, and is rare in the product**, could be taken for background. An example is a red logo touching the outline in front of a red wall. The original is kept.
- **A decoration that overlapped a product** now stays in the background plate. In the composed creative it is behind the product, where it had been in front of its corner. Keeping it in front would need a layer of its own.
- **Seedream's raw layers are not stored locally** (only their URLs), so a whole `prepare` cannot be replayed offline. The stage was replayed on the saved cut-outs, which are exactly its inputs.
