# Avatar Asset Pipeline

> Phase 9 expanded the catalog to 41 selectable assets (+5 face parts), added generated facial hair,
> a tone-neutral skin, and a scripted post-process / thumbnail pipeline. Current commands:
> [`tools/asset-pipeline/README.md`](../tools/asset-pipeline/README.md). Runtime details (layering,
> materials, single skeleton): [`avatar-system.md`](avatar-system.md). The license audit below still
> applies; the added assets were verified the same way (CC0 per asset, enforced by `extract_assets.py`).

MakeHuman → Blender (MPFB2) → GLB → AvatarForge, as verified and run end-to-end on 2026-08-09.

## Why this chain

MakeHuman's own asset data (base mesh, blend-shape targets, rigs) is CC0 — verified directly from
`LICENSE.ASSETS.md` in both `makehumancommunity/makehuman` and `makehumancommunity/mpfb2`. CC0 is
public domain: no restriction on commercial use, modification, redistribution, SaaS delivery, or
bundling into our own SDK, and no attribution required. That's the only reason this base is usable
as a foundation for a commercial, redistributable product — see the asset-strategy research from
the previous phase for the sources that looked "free" but weren't (Mixamo, Reallusion, Sketchfab,
HumGen3D all prohibit exactly our use case: serving/redistributing the asset to many end users).

We use **MPFB2** (MakeHuman Plugin For Blender), not the classic standalone MakeHuman app, because:

- It runs inside Blender, which is fully scriptable headlessly (`blender --background --python`).
  The classic MakeHuman app needs its own GUI process and is much harder to automate.
- It exposes character creation, targets, rigging, and export as a documented Python **service
  API** (`HumanService`, `TargetService`, `RigService`, `ExportService`, ...), not just UI panels.
- Blender's own glTF exporter (mature, first-class shape-key and armature support) does the actual
  GLB export — MPFB2 just stages the scene for it.

Per CLAUDE.md's own instruction: **MakeHuman/MPFB2 is the technical base mesh + rig + morph
foundation only.** Final hair, clothing, face variety, materials, and animation are AvatarForge's
own authored content on top of this base — not a re-skinned MakeHuman character.

## One-time tool setup

```
winget install --id BlenderFoundation.Blender.LTS.4.5
git clone --depth 1 https://github.com/makehumancommunity/mpfb2.git .pipeline-tools/mpfb2
python -c "import zipfile,os; ..."   # zip src/mpfb/ contents to .pipeline-tools/mpfb-extension.zip
"<blender>/blender.exe" --command extension install-file -r user_default -e .pipeline-tools/mpfb-extension.zip
```

MPFB2 ships its own bundled data (base mesh, targets, rigs — ~73MB) inside the addon; no separate
asset-pack download is needed for body/face/rig work. The optional `makehuman_system_assets` pack
(eyes, eyebrows, teeth, sample hair/clothes) is only needed once we source/author real hair and
clothing content (Phase 4+), and must go through the same license check as everything else.

`.pipeline-tools/` is gitignored — it's a rebuildable local tool cache, not project content.

## Running the pipeline

```
"<blender>/blender.exe" --background --python tools/blender-pipeline/generate_base_character.py
```

The script (`tools/blender-pipeline/generate_base_character.py`):

1. `HumanService.create_human()` — spawns the base mesh (19,158 verts).
2. `TargetService.load_target(mesh, path/to/*.target.gz, weight=...)` — applies named morphs.
3. `HumanService.add_builtin_rig(mesh, "default")` — binds the MakeHuman skeleton (163 bones).
4. `ExportService.create_character_copy()` + `bake_modifiers_remove_helpers()` — duplicates the
   character and strips sculpting helper geometry (19,158 → 13,380 verts in our export).
5. `bpy.ops.export_scene.gltf(..., export_format="GLB", export_morph=True, export_skins=True)`.

Verified output (`public/models/avatar-base-poc.glb`, 3.45MB): 1 mesh, 12 shape keys (targets),
1 skin with 163 joints, loads and renders correctly in Three.js/R3F with morph targets and skeleton
both intact (see `src/features/avatar/viewer/RealAvatar.tsx`).

## Morph target naming reference (CLAUDE.md → MakeHuman target file)

Every morph CLAUDE.md's face system asks for maps to a real, existing CC0 target file. Names below
are relative to `data/targets/` inside the addon. Bilateral traits (eyes, cheeks) need both the `l-`
and `r-` file loaded together as one logical slider.

| CLAUDE.md slider | MakeHuman target file(s) |
|---|---|
| FaceWidth | `head/head-scale-horiz-incr.target.gz` |
| JawWidth | `chin/chin-width-incr.target.gz` |
| CheekSize | `cheek/l-cheek-volume-incr.target.gz` + `cheek/r-cheek-volume-incr.target.gz` |
| EyeSize | `eyes/l-eye-scale-incr.target.gz` + `eyes/r-eye-scale-incr.target.gz` |
| EyeSpacing | `eyes/l-eye-trans-out.target.gz` + `eyes/r-eye-trans-out.target.gz` |
| NoseWidth | `nose/nose-scale-horiz-incr.target.gz` |
| NoseLength | `nose/nose-scale-vert-incr.target.gz` |
| MouthWidth | `mouth/mouth-scale-horiz-incr.target.gz` |
| LipSize | `mouth/mouth-upperlip-volume-incr.target.gz` + `mouth/mouth-lowerlip-volume-incr.target.gz` |

Only FaceWidth, JawWidth, and EyeSize are wired into the app today (proof of concept, per scope).
Each target ships as a one-directional `-incr` file; MakeHuman also ships the matching `-decr` file
for the opposite direction — a real "-1 to 1" slider needs both loaded and cross-faded, which the
current POC doesn't do yet (its sliders are 0–1, honestly reflecting what's actually wired).

**Facial expressions** (Smile/Sad/Angry/Surprised/Blink/Laugh) are not single named targets in
MakeHuman — they're composed from a 34-item FACS-style action-unit library at
`targets/expression/units/{race}/*.target.gz` (e.g. `mouth-corner-puller`, `eyebrows-left-up`,
`eye-left-closure`). Building a named expression means combining several units into one baked shape
key via `TargetService.create_shape_key(..., create_from_mix=True)` — not yet done, but the
mechanism is confirmed to exist and work the same way as the body/face targets above.

## Bone naming (gotcha: dots get stripped — correction from earlier phases)

MPFB2's `default` rig uses names like `upperarm01.L` internally, and **the exported GLB's own JSON
still has the dot** — verified directly by reading the raw glTF node names in Phase 6
(`upperarm01.L` is present in `nodes[65].name`, confirmed byte-for-byte from the file, not assumed).
Earlier phases' docs incorrectly attributed the dot-stripping to Blender's exporter. Having now
checked both ends of the pipeline directly: **Three.js's `GLTFLoader` sanitizes node names as it
builds the scene graph**, so `bone.name` inside the running app is `upperarm01L` (no dot) even
though the source file says `upperarm01.L`. Functionally nothing changes — `DRIVEN_BONE_NAMES` in
`useProceduralSkeletonDriver.ts` already uses the no-dot form because that's what was observed live
in the browser when it was written — but the earlier "fix it in the export step" framing was wrong.
Always verify names against the *live* `scene.traverse()` output (e.g. via
`window.__r3f.scene.traverse(...)`, temporarily exposed through `Canvas`'s `onCreated`), not just
the static GLB JSON, since the two can legitimately differ.

Full bone list (163) is available via `default.mhskel`-derived rigs. Other bundled rig options,
each pre-computed from the current body shape's vertex positions (so they stay correct through body
morphs):

| Rig name | Use case |
|---|---|
| `default` | Full MakeHuman skeleton incl. individual fingers/toes — used for this POC |
| `default_no_toes` | Same, fewer bones |
| `game_engine` / `game_engine_with_breast` | Simplified, real-time-friendly bone count |
| `mixamo` / `mixamo_unity` | Mixamo-convention bone names, for tooling/retargeting compatibility only — **do not use Mixamo's actual character or animation files**, that data isn't ours to redistribute (see asset-strategy doc) |
| `cmu_mb`, `openpose` | Motion-capture / pose-estimation compatible topologies |
| `rigify/*` | Full production control rig (IK/FK) for hand-authoring animation in Blender |

For production, `game_engine` (fewer bones) is the likely choice over `default` (163 bones) —
see Performance below.

## Current AvatarForge integration

- `src/features/avatar/viewer/RealAvatar.tsx` loads the base body GLB via `useGLTF` and drives it
  using `useProceduralSkeletonDriver` (below).
- `src/features/avatar/ui/OptionsPanel.tsx` drives `SkinnedMesh.morphTargetInfluences` directly by
  name via `morphTargetDictionary`, sourced from Zustand store state — proving the
  slider → store → GLB morph target → real-time render chain end to end.
- Both `RealAvatar`/`AvatarAssembly` and the original `PlaceholderAvatar` (primitive-based,
  procedural) still exist; `avatarStore.avatarSource` selects which one `AvatarViewerScene` renders.
  Nothing was deleted.

### Shared procedural animation (`useProceduralSkeletonDriver.ts`)

The 13-bone, per-name delta-rotation driver from the body POC was factored out of `RealAvatar` into
`src/features/avatar/viewer/useProceduralSkeletonDriver.ts` so **every** attachment (hair, clothing,
accessories) can drive its own copy of the same rig with identical math. This is a stand-in for real
authored `AnimationClip`s, not final animation content — the `AnimationController` contract (an
animation name in the store) doesn't change when real clips replace this later.

## Hair / Clothing / Accessories (Phase 4)

### Where the assets came from

Sourced from the official `makehumancommunity` asset packs (`static.makehumancommunity.org/assets/assetpacks/`),
**not** the MakeHuman/MPFB2 addon's own bundled data (that only ships the base body + targets + rigs).
Confirmed CC0 for the packs we used two independent ways:

1. Each pack's `packs/<name>.json` metadata lists a `"license"` field per individual asset — verified
   `"CC0"` for all 11 items pulled into this build (see `LICENSE_AUDIT` below).
2. Primary-source FAQ, fetched directly: *"Can I reuse the system assets and build a character
   generator of my own? By all means... All core assets (the base mesh, targets, skins…) are shared
   under CC0. This means you in practice have no limits on what you can do with the assets."*
   (`static.makehumancommunity.org/mpfb/faq/build_other_chargen.html`) — this is the exact "avatar
   creator selling access to a generator" use case, addressed directly, not inferred.

Packs used: `makehuman_system_assets` (eyes/eyebrows/eyelashes/teeth/tongue — body completeness),
`hair01`, `shirts01`, `pants01`, `shoes01`, `hats01`, `glasses01`. Larger/CC-BY packs (`hair02/03`,
`shirts02/03`, ...) exist for future expansion but need an attribution credits page before use (CC-BY
requires crediting the author — still fully commercial/SaaS/redistribution-safe, just not
attribution-free like CC0).

**LICENSE_AUDIT** (author + license, straight from each pack's own metadata):

| Asset id | Source file | Author | License |
|---|---|---|---|
| hair_short_bob | `hair01/toigo_blunt_bob` | MargaretToigo | CC0 |
| hair_long | `hair01/o4saken_long01` | punkduck | CC0 |
| hair_braided | `hair01/elvs_double_mh_braid` | Elvaerwyn | CC0 |
| top_tshirt | `shirts01/toigo_basic_tucked_t-shirt` | MargaretToigo | CC0 |
| top_polo | `shirts01/namuhekam_male_polo_shirt` | namuhekam | CC0 |
| bottom_wool_pants | `pants01/toigo_wool_pants` | MargaretToigo | CC0 |
| bottom_cargo_pants | `pants01/cortu_cargo_pants` | Cortu | CC0 |
| shoes_cloth | `shoes01/toigo_mj_cloth_shoes` | MargaretToigo | CC0 |
| shoes_ankle_boots | `shoes01/toigo_ankle_boots_male` | MargaretToigo | CC0 |
| hat_newsboy_cap | `hats01/jujube_newsboy_cap` | jujube | CC0 |
| glasses_optical | `glasses01/kwnet_at_optical_glasses` | kwnet_at | CC0 |


### On-device face analysis (photo → avatar)

| Component | Source | License |
|---|---|---|
| `@mediapipe/tasks-vision` 0.10.17 (JS + wasm, copied to `public/mediapipe/wasm/`) | npm | Apache-2.0 |
| `face_landmarker.task` (`public/mediapipe/models/`) | storage.googleapis.com/mediapipe-models | Apache-2.0 |
| `hair_segmenter.tflite` (`public/mediapipe/models/`) | storage.googleapis.com/mediapipe-models | Apache-2.0 |
| `canonical_face_model.obj` (calibration input only, not shipped) | github.com/google-ai-edge/mediapipe | Apache-2.0 |

### Phase 9 additions (license verified per asset by `tools/asset-pipeline/extract_assets.py`)

| Asset id | Source | Author | License |
|---|---|---|---|
| hair_short_messy | `makehumancommunity hair01/cortu_short_messy_hair` | Cortu | CC0 |
| hair_crop | `makehumancommunity hair01/culturalibre_hair_02` | culturalibre | CC0 |
| hair_swept | `makehumancommunity hair01/culturalibre_hair_05` | culturalibre | CC0 |
| hair_bob_bangs | `makehumancommunity hair01/toigo_curled_under_bob_with_bangs` | MargaretToigo | CC0 |
| hair_bowl | `makehumancommunity hair01/littleright_bobcut_hair` | littleright | CC0 |
| hair_shaggy | `makehumancommunity hair01/faydaen_hair_1` | Faydaen | CC0 |
| hair_bun | `makehumancommunity hair01/rehmanpolanski_hair_bun_brown` | RehmanPolanski | CC0 |
| hair_long_straight | `makehumancommunity hair01/culturalibre_hair_01` | culturalibre | CC0 |
| beard_stubble | `tools/asset-pipeline/generate_facial_hair.mjs` | AvatarForge | Proprietary |
| beard_short | `tools/asset-pipeline/generate_facial_hair.mjs` | AvatarForge | Proprietary |
| beard_full | `tools/asset-pipeline/generate_facial_hair.mjs` | AvatarForge | Proprietary |
| beard_goatee | `tools/asset-pipeline/generate_facial_hair.mjs` | AvatarForge | Proprietary |
| mustache_classic | `tools/asset-pipeline/generate_facial_hair.mjs` | AvatarForge | Proprietary |
| mustache_pencil | `tools/asset-pipeline/generate_facial_hair.mjs` | AvatarForge | Proprietary |
| mustache_horseshoe | `tools/asset-pipeline/generate_facial_hair.mjs` | AvatarForge | Proprietary |
| top_crew_tee | `makehumancommunity shirts01/elvs_crude_t-shirt_male` | Elvaerwyn | CC0 |
| top_sweater | `makehumancommunity shirts01/toigo_fisherman_sweater` | MargaretToigo | CC0 |
| top_tank | `makehumancommunity shirts01/toigo_keyhole_tank_top` | MargaretToigo | CC0 |
| top_camisole | `makehumancommunity shirts01/toigo_camisole_top` | MargaretToigo | CC0 |
| bottom_denim_shorts | `makehumancommunity pants01/cortu_jeans_shorts` | Cortu | CC0 |
| bottom_harem_pants | `makehumancommunity pants01/toigo_harem_pants` | MargaretToigo | CC0 |
| shoes_leather_boots | `makehumancommunity shoes01/culturalibre_male_boots` | culturalibre | CC0 |
| shoes_rain_boots | `makehumancommunity shoes01/culturalibre_hero_boots_2` | culturalibre | CC0 |
| hat_bucket | `makehumancommunity hats01/aethelraed_unraed_cloche_hat` | Aethelraed_Unraed | CC0 |
| hat_santa | `makehumancommunity hats01/joepal_xmas_cap` | Joel Palmius | CC0 |
| glasses_wayfarer | `makehumancommunity glasses01/spamrakuen_tbm_glasses_frames_01` | spamrakuen | CC0 |
| glasses_round | `makehumancommunity glasses01/toigo_round_glasses_leopard` | MargaretToigo | CC0 |
| glasses_sunglasses | `makehumancommunity glasses01/frankyaye_glasses_library_male` | frankyaye | CC0 |
| glasses_rectangle | `makehumancommunity glasses01/spamrakuen_sagerfrogs_glasses_02` | spamrakuen | CC0 |
| glasses_3d | `makehumancommunity glasses01/ews_3d_glasses` | EWS | CC0 |

`Proprietary` = generated by AvatarForge's own pipeline from the CC0 base body (no third-party art).
`culturalibre_heroine_boots_4` (the one CC-BY item in the shoe pack) and politically branded / novelty items were deliberately not used.

### Generation pipeline (reusable — this is the answer to "how do I add a new Hair/Clothing/Accessory")

```
3D Asset (.mhclo + textures, CC0/verified license)
   ↓  extract_selected.py           — pull just the needed asset folder(s) out of the pack zip
   ↓  downscale_textures.py         — PIL, cap every PNG at 1024px (source textures were 2K–4K)
   ↓  generate_attachments.py       — Blender/MPFB2, headless:
   │     1. HumanService.create_human() + add_builtin_rig(basemesh, "default")
   │     2. HumanService.add_mhclo_asset(mhclo_path, basemesh, asset_type=..., material_type="GAMEENGINE")
   │     3. ExportService.create_character_copy() — isolate just this one asset + the rig
   │     4. bpy.ops.export_scene.gltf(..., export_skins=True) → public/models/attachments/<id>.glb
   ↓  fix_alpha_mode.mjs            — gltf-transform: force alphaMode OPAQUE (clothing) or MASK (hair)
   ↓  copy .thumb → public/thumbnails/<id>.png  — MakeHuman .thumb files are plain 256×256 PNGs
   ↓  add an entry to assetManifest.ts
   ↓  AvatarForge (auto-picked up by OptionsPanel / AvatarAssembly, no other code changes)
```

Concretely, to add a 4th hairstyle: extend `ATTACHMENTS` in
`tools/blender-pipeline/generate_attachments.py` with `(filename, mhclo_relative_path, "Hair", 0)`,
re-run the script, run the alpha-mode fix, copy its `.thumb`, add one object to `ASSET_MANIFEST` in
`src/features/avatar/config/assetManifest.ts`. Nothing else in the app changes — this is the
"metadata-driven, no code change per asset" system CLAUDE.md asks for.

### Why each attachment is rigged independently instead of sharing one skeleton

Every attachment (body, hair, top, bottom, shoes, accessories) is exported as its **own** GLB with
its **own** copy of the 163-bone skeleton — they were all rigged to the same MPFB armature before
being split into separate files, so bone names/hierarchy/bind-pose are identical across all of them.
At runtime each one is driven independently by the same `useProceduralSkeletonDriver`, which keeps
them visually synchronized without needing to rebind skinning indices across scenes.

This is simpler and safer than the alternative (re-target every attachment's skin onto one shared
`THREE.Skeleton` instance by bone-name remapping) at the cost of redundant per-bone matrix updates —
fine at this scale, but the shared-skeleton version is the natural next optimization once there are
enough simultaneously-worn items for it to matter (see Performance).

### Two problems hit and fixed during integration

1. **Bone names lose their dots between the GLB file and the live Three.js scene** (`upperarm01.L` →
   `upperarm01L`) — already documented above (correction: this happens in `GLTFLoader`, not export),
   applies identically to attachments.
2. **Z-fighting between form-fitted clothing and the (always-fully-rendered) nude body mesh.**
   Because each attachment is exported standalone, there's no shared "hide the body vertices under
   this garment" mask the way MakeHuman normally computes when exporting a fully-dressed character
   in one pass. Pants and shoes sit close enough to the skin surface to fully lose the depth test in
   some regions, making them invisible despite loading and positioning correctly (confirmed via
   bounding-box logging and an isolated render before diagnosing this). Fixed with
   `material.polygonOffset = true` (`polygonOffsetFactor/Units = -24`) on every attachment material
   in `AttachmentPart.tsx` — biases attachment fragments toward the camera in the depth buffer
   without moving geometry, the standard fix for near-coplanar overlapping surfaces. A small residual
   gap can still show at the shirt/pants waistline on some outfit combinations (independently
   authored garments don't perfectly share a hem line) — cosmetic, not a rendering bug; a proper
   per-outfit body-vertex mask is the eventual real fix.

### Attachment points / slots

`AssetMetadata.slot` doubles as the attachment point. Current slots: `hair`, `top`, `bottom`,
`shoes` (full skinned garments), `head`/`face` (accessories — hat, glasses), plus the always-on
body-completeness slots `eyes`/`eyebrows`/`eyelashes`/`teeth`/`tongue`. Adding e.g. `neck`
(necklace) or `wrist` (watch) needs no schema change — just a new slot string in a manifest entry.
Every accessory today is still a full skinned mesh sharing the rig (uniform code path); a rigid
head/wrist accessory could instead be parented directly to that one bone as a lighter-weight
alternative — noted as a future optimization, not required for correctness.

### Color/material system

glTF `baseColorFactor` (`material.color` in Three.js) multiplies the diffuse texture — setting it
recolors a garment without a separate model per color, exactly matching CLAUDE.md's requirement.
Implemented in `AttachmentPart.tsx`'s `prepareMaterials()`. Colors are curated per-asset in the
manifest (`AssetMetadata.colors`), not computed — an artist/PM decision, not a technical one.

## Face system (Phase 5)

### What got added

`tools/blender-pipeline/generate_face_system.py` supersedes the Phase 3 POC script for the body and
the five body-completeness parts. It loads, in one Blender session:

- The full 9-slider structural set (CLAUDE.md's face system — FaceWidth, JawWidth, CheekSize,
  EyeSize, EyeSpacing, NoseWidth, NoseLength, MouthWidth, LipSize — 13 shape keys since three of
  them are bilateral L+R pairs), same target-file mapping table as before.
- All **52 ARKit face units** (`browDownLeft` … `tongueOut`) via MPFB2's `FaceService`/
  `ARKIT_FACEUNITS` — sourced from the `faceunits01` CC0 pack (`static.makehumancommunity.org`,
  confirmed CC0 per-asset in `packs/faceunits01.json`, author Mika Suominen). This is the same
  standard Apple ARKit/blendshape naming used by real webcam face trackers, chosen specifically so
  a future MediaPipe/ARKit tracker's output could drive these shape keys directly by name, with zero
  translation layer — the "mimari webcam face tracking'e uygun olmalı" requirement from Phase 0.
- `FaceService.interpolate_targets(basemesh)`, which copies the ARKit shape keys (only those — not
  the 9 structural sliders, see below) onto eyes/eyebrows/eyelashes/teeth/tongue using each proxy's
  own MHCLO vertex-correspondence data. This is what keeps eyelids/eyebrows/mouth-adjacent proxies
  moving with expressions and blinking instead of sitting static while the head skin deforms.

Getting `interpolate_targets` to actually work required registering our extracted asset folders
under MPFB's own user-data directory (`LocationService.get_user_data()` — on Windows,
`%APPDATA%\Blender Foundation\Blender\4.5\extensions\.user\user_default\mpfb\data\`), because the
interpolation step re-resolves each child's source `.mhclo` path through MPFB's asset registry
(`ClothesService.find_clothes_absolute_path`), not the raw path we originally passed to
`add_mhclo_asset`. Assets loaded only from an arbitrary folder (as the Phase 4 attachments were)
silently produce zero interpolated shape keys — confirmed by checking `targetNames` in the exported
GLB JSON before and after the fix (0 → 8/36/25/4/5 targets across eyes/eyebrows/eyelashes/teeth/
tongue respectively).

### Runtime architecture: layered morphs

`useFaceMorphDriver.ts` is the shared driver (used by both `RealAvatar` and every `AttachmentPart`,
same pattern as `useProceduralSkeletonDriver`). Three layers, composed every frame:

1. **Structural** — `config.face.morphs`, the 9-slider values, keyed by MakeHuman target names.
2. **Expression** — `config.face.expression`, one selected preset from `expressions.ts`, keyed by
   ARKit names. A preset is a *combination* (e.g. Smile = `mouthSmileLeft/Right` +
   `cheekSquintLeft/Right`), never a single morph.
3. **Blink** — `blinkClock.ts`, a plain module-level function of the shared R3F clock (not Zustand
   state — see the file's own comment for why: a 60fps store write is the wrong tool here). Every
   mesh's `useFrame` calls the same deterministic function with the same `elapsed` time and gets the
   same answer, so body + eyes + eyelashes blink in sync without any cross-component wiring.

Structural and ARKit names never collide (different naming schemes entirely), so layering is a
plain sum; the two `eyeBlink*` keys specifically combine the expression preset's own value with the
procedural blink additively (clamped to 1) so a user-selected "Blink" expression and the idle
auto-blink don't fight.

"Talk" is a static `jawOpen + mouthFunnel` shape, not lip-synced speech — a real morph change, just
not phoneme-accurate. Documented as a simplification, not represented as more than it is.

### Test results (real browser, see conversation for full screenshot set)

- **Individual sliders at max**: FaceWidth, JawWidth, Cheeks, EyeSize, NoseWidth, NoseLength, Lips
  all clean at 1.0 — no visible tearing/explosion. EyeSize, EyeSpacing, NoseLength, MouthWidth capped
  below 1.0 in `faceMorphs.ts` after visual inspection showed those specific targets starting to look
  odd approaching the top of their authored range.
- **All 9 sliders simultaneously at max**: distinct, extreme, but *not* broken — no mesh explosion,
  no texture stretching, no eye/teeth popping through the skin. MakeHuman's targets are professionally
  authored and compose better under simultaneous extremes than a from-scratch morph system typically
  would.
- **Hair/face interaction — a real limitation found, not assumed**: with all 9 structural sliders at
  max *and* the "Long" hairstyle, the hair mesh is engulfed/hidden by the enlarged head (screenshot:
  the head renders fully bald despite Long being the active selection). Root cause: hair doesn't
  receive the 9 structural sliders at all (only the body does), so at extreme combined head-scale
  values the hair — sized for the neutral head — ends up entirely inside the now-larger head surface.
  This does **not** reproduce with any single slider at max with any hairstyle (checked FaceWidth
  alone + Short Bob — clean); it's specifically the combined-extreme-plus-voluminous-hair corner case.
  Per the explicit "don't build the compatibility system unless actually needed" instruction: this is
  documented as a known boundary condition rather than solved with a `morphCompatibility` schema —
  normal single/moderate-slider usage with any hairstyle is unaffected.
- **Expressions**: Smile is clearly visible even at normal (non-zoomed) camera distance — genuine
  mouth-corner and cheek movement, not a subtle tweak. Surprised, Sad, Angry, Laugh, Talk all trigger
  distinct real morph changes on click, no console errors across any of the 8 presets.
- **Blink**: runs continuously and automatically (confirmed via periodic screenshot byte-size
  sampling showing frame-to-frame variation with no user interaction), independent of which
  expression or animation state is active, per the "blink sırasında Walk/Run/Dance çalışabilmeli"
  requirement — blink is computed in the same `useFrame` tick as the skeleton animation, not gated by
  animation state.

### Permanent (pipeline-level) z-fighting fix — partial, and here's exactly why

Investigated whether `polygonOffset` (Phase 4's runtime fix) could be replaced with a real fix
authored into the assets, per instruction not to treat a render-level bias as "solved."

MHCLO files support a `delete_verts` section — the body vertices to hide when that garment is worn,
baked as a Blender MASK modifier and something `ExportService.bake_modifiers_remove_helpers(...,
bake_masks=True)` already bakes into an export. Tested by equipping all 6 current top/bottom/shoe
assets simultaneously on one basemesh and inspecting the resulting modifier stack
(`.pipeline-tools/test_mask_union.py`): **only the two shoe assets** (`toigo_mj_cloth_shoes`,
`toigo_ankle_boots_male`) actually ship `delete_verts` data — the shirt and pants assets we sourced
simply don't have it authored, which is a property of those specific community-contributed files, not
something fixable from our side without hand-authoring vertex-hide data ourselves.

Given that, `generate_face_system.py` now temporarily equips both shoe options before the body
export specifically to bake their union mask permanently — **foot/ankle skin is now genuinely absent
from the body mesh** (verts dropped 13,380 → 11,985), not just depth-biased at render time. Because
of this, "Shoes" was made a mandatory slot in `OptionsPanel.tsx` (`MANDATORY_SLOTS`) — deselecting it
would now expose a real geometry hole, not just bare feet.

Shirt/pants/hat/glasses/hair keep the `polygonOffset` runtime fix (`AttachmentPart.tsx`) because
there's no authored data to bake against. This is an honest, partial result: the *mechanism* for a
real pipeline-level fix is proven and used where the source data supports it; where it doesn't, the
runtime bias remains and is the correct call rather than either leaving z-fighting or hand-authoring
vertex masks under this phase's time budget. Replacing the shirt/pants assets with ones that ship
`delete_verts` (or authoring it ourselves) would let `polygonOffset` be dropped entirely.

## Performance, texture compression, mesh compression, export system (Phase 6)

Moved to **`docs/performance-baseline.md`** — full before/after measurements (WebP texture
pipeline via Blender's own exporter, Draco vs meshopt real comparison, morph/bone audits, lazy
loading + cache verification, memory leak test, the JSON/PNG/GLB export system, and the derived
performance budget). That document supersedes the old "Performance notes" that used to live here;
kept a pointer instead of duplicating numbers that will drift out of sync.

One architectural note that belongs here rather than in the metrics doc: the client-side GLB
export (`ExportBridge.tsx`, `ExportMenu.tsx`) reuses the same "each attachment keeps its own
skeleton" model described above — `Three.js`'s `GLTFExporter` happily serializes multiple
independent skinned meshes from the live scene graph into one GLB, so the POC didn't need any
new merge logic beyond what `AvatarAssembly`'s scene graph already provides. The trade-off is
the same one noted for rendering: no shared-skeleton deduplication, so the exported file carries
one full 163-bone skeleton per equipped item rather than one skeleton total.
