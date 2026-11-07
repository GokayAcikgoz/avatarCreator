# Asset pipeline

Everything in `public/models`, `public/textures`, `public/thumbnails` and `api/server-assets` is
produced by these scripts — nothing is hand-edited. Heavy inputs (MakeHuman pack zips, MPFB2,
raw Blender exports) live in the git-ignored `.pipeline-tools/` cache.

## Full rebuild, in order

| # | Command | Produces |
|---|---|---|
| 1 | `python tools/asset-pipeline/extract_assets.py` | Extracts the selected CC0 assets (license checked per asset — non-CC0 aborts), downscales textures to ≤1024 px, neutralizes tintable diffuse maps |
| 2 | `blender --background --python tools/blender-pipeline/generate_attachments.py [-- a.glb,b.glb]` | Raw rigged GLBs in `.pipeline-tools/raw-attachments/` (MPFB2) |
| 3 | `python tools/asset-pipeline/prepare_skin_texture.py` | `public/textures/skin_detail.webp` (tone-neutral skin detail map) |
| 4 | `npm run assets:facial-hair` | Hair textures + `beard_*` / `mustache_*` GLBs generated from the body |
| 5 | `npm run assets:postprocess [ids…]` | Material fixes, browser copy (meshopt) → `public/models`, server copy → `api/server-assets` |
| 6 | `npm run assets:clips` | `shared/animation-clips.json` |
| 7 | `npm run dev` + `npm run assets:thumbnails [ids…]` | `public/thumbnails/*.png` rendered by the real viewer (`/studio/thumbnail`, dev only) |
| 8 | `npm run dev` + `npm run assets:face-calibration` | `shared/face-calibration.json` (photo → face sliders; rerun when the body or face morphs change) |

On an API host you only need `npm run assets:server`: it rebuilds `api/server-assets/` from the
committed `public/` files, no Blender or source packs required.

The body and face parts come from `tools/blender-pipeline/generate_face_system.py` (see
`docs/asset-pipeline.md`); step 5 also post-processes them.

## Adding an asset (e.g. a new hairstyle)

1. Add its pack folder to `SELECTIONS` in `extract_assets.py` (`True` = tintable) and run it.
2. Add `(out.glb, mhclo path, "Hair"|"Clothes", 0)` to `ATTACHMENTS` in `generate_attachments.py`,
   run Blender for just that file.
3. `npm run assets:postprocess <id>`.
4. Add an entry to `shared/asset-catalog.json` — slot, palette, `styles` (drives randomize),
   `incompatibleWith`, license/author/source. Optional `layer` if it stacks unusually.
5. `npm run assets:thumbnails <id>`.

No code changes: the editor, randomizer, validator, API catalog (upserted on the next API boot) and
Blender renderer all read the catalog.

## Scripts

| File | Purpose |
|---|---|
| `extract_assets.py` | Selection + license gate + texture prep |
| `image_ops.py` | Pillow helpers called from Node (texture neutralization) |
| `prepare_skin_texture.py` | Skin detail map (see `docs/avatar-system.md` §3) |
| `postprocess_attachments.mjs` | Alpha/metallic/double-sided policy, helper cleanup, eyebrow neutralization, skin material on the body, dual output |
| `gltf-utils.mjs` | `bakeBindShape` — canonical rest pose for server copies |
| `build_server_assets.mjs` | `public/` → `api/server-assets/` without Blender |
| `generate_facial_hair_textures.py`, `generate_facial_hair.mjs` | Our facial hair (landmark regions, `_GROW` combing, shell recipe) |
| `build_animation_clips.mjs` | Animation library: FK-calibrated joint motions, hinge-aware arms, IK, ground contact → sampled deltas |
| `render_thumbnails.mjs` | Catalog thumbnails via headless Chromium (`CHROMIUM_PATH` or Playwright's cache) |
| `calibrate_face_metrics.mjs` | `shared/face-calibration.json` from the real viewer + MediaPipe |

## QA tools

All drive the real web viewer through the dev-only `/studio/thumbnail` page (`STUDIO_URL` / `WEB_ORIGIN`
override the default `http://localhost:3000`); output goes to `.pipeline-tools/qa/`.

| Command | What it checks |
|---|---|
| `node tools/asset-pipeline/qa_animation_sheets.mjs [clips…] [--frames=8] [--views=front,side,three,upperR]` | One contact sheet per clip: rows = camera angles, columns = moments |
| `node tools/asset-pipeline/qa_look_sheet.mjs facial-hair \| facial-hair-colors \| presets \| face-sliders` | Close-up comparison sheets (every beard/mustache, colors, presets, sliders at ±extremes) |
| `node tools/asset-pipeline/qa_photo_analysis.mjs` | Photo analysis vs ground truth on synthetic selfies (exit 1 on a miss) |
| `node tools/asset-pipeline/qa_photo_e2e.mjs` | Create-from-photo in `/create`: upload → review → apply → undo, plus the camera flow with a fake camera |
| `node tools/asset-pipeline/qa_live_face.mjs` | Live face with a fake camera video: the avatar's smile follows, its head stays straight |
| `node tools/asset-pipeline/qa_editor_smoke.mjs` | Every animation button, save with a new account, reload restores, server-side posed render |
