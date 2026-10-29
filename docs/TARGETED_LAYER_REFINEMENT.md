# Targeted layer refinement, editable text and bank logo overlays

An approved AI creative (an aspect-ratio regeneration or an AI design variation) becomes an editable template whose words and logos are overlays, never baked-in pixels, and whose product, character or decoration cut-outs can be repaired one layer at a time.

## What already existed (reused)

- **The approved picture is the template's source.** Detection runs on the final image, so every box is in its coordinates.
- **Words are editable layers.** Each word is its own element, so a word that appears twice gets two layers. Words are grouped into lines and keep their detected styles.
- **Logos are image layers.** They can be moved or hidden, and replaced for free in the creative editor (`uploadAsset`) or at review.
- **No duplicates.** Prepare removes the text and logo pixels from the background, and its residue and logo-leftover checks catch anything that remains. Seedream receives the picture without text or logos.
- **Revision history.** An object's picture is replaced or restored as a new revision of the creative, and `GET …/creatives/:cid?revision=` reads earlier ones.

## Added

### Words checked against the source (`service.ts` `runDetect`)

For an approved regeneration (not an AI variation, which has its own word-by-word review), each word found in the final picture is compared with the source template's words. The source words are the base template's source and the words of its latest snapshot (`sourceTemplate`).

A word the source does not have is marked **needs review**, so the person sees it before saving. So is a word the regeneration's own check listed as added (`checks.extraWords`). Examples are a changed price ("50%" for "26%") or an invented claim. Nothing is removed automatically. The check is written to `analysis-source-words.json` (`{ source, flagged }`).

### Logos from authentic pixels (`service.ts` `runDetect`)

Each detected logo slot is cut from the original upload when there is one, or else from the base template's source picture (`restoreLogosFromOriginal`).

A logo with no clear match is marked **needs review** so an authentic file can be uploaded; it is never redrawn. The outcome is written to `analysis-regeneration-logos.json` (`{ source, logos }`).

### Refine Cutout (creative editor → Products and characters → Refine cutout)

This works on one product, character or decoration layer at a time. Text and logos are overlays and are never refined as pictures.

**Defect mask: only verified pixels are trusted (`cutoutDefects`).** A decomposed object partly hidden behind another element has an estimate where it was hidden. A real case: a multi-door refrigerator whose lower-right corner stood behind a dishwasher had a flat grey block there. It also kept the dishwasher's side wall as a lighter seam, because the dishwasher's own cut-out had missed it.

For the template's own cut-out, the check uses the picture it was cut from (`snapshot.source`), the object's `cutout.placement`, and the cut-outs of the elements in front of it (higher `z`, overlapping). The defect mask is:

- what those front layers hide, plus a margin of 4% of the layer's smaller side;
- solid pixels that differ from the picture by more than 40 in a channel, in a patch rather than a lone pixel, plus a 2 px margin.

A layer that differs almost everywhere was redrawn as a whole, so then only what is hidden counts. Everything else is **verified** and kept byte for byte. There is no such evidence for a replaced or refined picture, or for a master adapted to another canvas, so nothing is marked there.

- **Free rebuild:** defects are continued from the nearest verified pixels along each row and column, weighted by 1/distance². The door's shading and divider line carry through. The outline is kept. One-pixel spurs of the estimated outline are cleared, and the inside of a defect is made solid.
- **AI path:** the defects are painted magenta in the request and the prompt asks for them to be redrawn. Only verified pixels are put back over the answer. The earlier restore put back every solid pixel, which pasted the grey block over the repair. A defect the model left magenta or clear is rebuilt locally and counted (`unrepairedPixels`).

| Step | What happens | Cost |
| --- | --- | --- |
| **Clean up (free)** | `refineCutout`, on this computer. It removes specks and stray fragments (pieces smaller than max(32 px, 0.5 % of the object)) and faint haze more than 2 px away from the object. It fills pinholes (at most max(4 px, 0.05 %) and not reaching the edge), keeping real openings such as a handle's gap or a glass panel. It defringes soft edge pixels with the object's own colour. Nothing is eroded: every solid pixel stays. | none |
| **Complete with AI…** | Shows the provider, model, request size and estimate first. One request is sent only after approval and is never retried. The cut-out goes on a plain #00FF00 ground (`refineRequest`) with the repair instruction (`refinePrompt`). The answer is keyed, despilled, and the original's solid pixels are put back exactly (`refineResult`), followed by the local pass. If the request fails, the layer is unchanged. Usage is recorded as `pcr-<creative>-<op>-ai-repair.json`. | about $0.27 (1024²) or $0.38 (1024 × 1536 / 1536 × 1024) |
| **Compare → "I have compared it…" → Use this picture** | Only that object's picture is replaced, as a new revision, with the same box. Everything else in the creative is identical. **Original** restores the template's picture. | none |

Routes are `GET /:id/creatives/:cid/objects/:oid/refine` (estimate) and `POST …/refine/local`, `…/refine/ai` (`approveUsd`) and `…/refine/apply` (`expectedRevision`, `file`, `approved: true`). Results are stored as `pcr-<creative>-<hash>.png`.

## Tests (no network, nothing charged)

- `cutoutRefine.test.ts`: the local clean-up keeps the handle, the window and every solid pixel. The AI result is keyed, with the original's pixels put back and the completed part kept.
- `refineCutout.test.ts` (HTTP, counting test double):
  - the free path sends 0 requests;
  - the AI path is refused without approval;
  - a failure leaves the creative unchanged and is not retried;
  - an approved request sends exactly 1 request and records its cost;
  - apply replaces only that layer, and the earlier revision is still readable;
  - a logo cannot be refined.
- `overlayGuards.test.ts`: changed and invented words are flagged and the source's own words are not. Every logo is restored from the base or flagged. All boxes lie within the final 1536 × 1536 picture.
- `tests/e2e-image-templates/refine-cutout.spec.ts` (offline browser): the AI confirmation is shown and cancelled, then the free clean-up is compared, approved and applied. The test checks that only the Television layer changed.

## Limits

- Refine Cutout is in the product creative editor (Offer Templates → Use template → the creative, including the "· master editor" one), not in the main Konva editor. An applied refinement is a new creative revision: the next Edit master → Open in Editor opens it, and saving from either editor keeps it. A duplicate gets its own copy of the refined picture.
- The free rebuild is a continuation, not a redraw. Where the hidden part holds a feature the visible part does not continue, it carries the nearest feature across. On the real refrigerator, this leaves a small dark patch about 12 × 13 px beside the dispenser. The AI path redraws such areas.
- The AI repair has not been checked live: its quality on real cut-outs is unverified.
- Some templates have no regeneration record, so the word check does not apply to them. These are a text-free or Original-size variation, and a template made directly from an upload.
