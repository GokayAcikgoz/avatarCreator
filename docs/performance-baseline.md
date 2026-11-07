# Performance Baseline — Phase 6

Every number below is measured, not estimated — via `.pipeline-tools/measure_baseline.py`
(parses the real GLB JSON chunks), `.pipeline-tools/measure_textures.py` (decodes embedded
textures with PIL), and Playwright scripts against a production (`next build && next start`)
server, not dev mode. Methodology and dates: 2026-08-09, this machine (see caveats at the end).

## Before Phase 6 (end of Phase 5 state)

| Metric | Value |
|---|---|
| Total GLB size (all 17 files: body + 16 attachments) | 15.39 MB |
| Default-equipped set (what loads on first view: body + 5 facial parts + hair + top + bottom + shoes) | 8.48 MB, 10 files |
| Texture format | PNG, all 1024×1024, RGBA |
| Sampled texture bytes (9 of the heavier files) | 8.42 MB |
| Production load time (dom-ready → network-idle) | 2190 ms |
| Draw calls (default outfit) | 5 |
| Triangles rendered | 23,042 |

## After Phase 6 texture optimization (WebP via Blender's own exporter)

| Metric | Before | After | Change |
|---|---|---|---|
| Total GLB size (all 17 files) | 15.39 MB | 3.91 MB | **−74.6%** |
| Default-equipped set | 8.48 MB | 2.48 MB | **−70.8%** |
| Production load time | 2190 ms | 1053 ms | **−52%** |
| Draw calls | 5 | 2 | −3 |
| Triangles rendered | 23,042 | 22,310 | ~unchanged (expected — texture format doesn't touch geometry) |

Largest single-file wins: `hair_short_bob.glb` 3117.6 KB → 451.4 KB, `bottom_cargo_pants.glb`
1537.6 KB → 161.5 KB, `shoes_ankle_boots.glb` 1233.0 KB → 281.3 KB.

## Per-file breakdown (current, post-optimization)

| File | KB | Verts | Tris | Materials | Textures | Bones | Morphs |
|---|---:|---:|---:|---:|---:|---:|---:|
| avatar-base-poc.glb (body) | 1093.7 | 11,985 | 22,308 | 0 | 0 | 163 | 73 |
| body_eyebrows_001.glb | 110.7 | 124 | 192 | 1 | 1 | 163 | 36 |
| body_eyelashes_001.glb | 122.7 | 250 | 368 | 1 | 1 | 163 | 25 |
| body_eyes_lowpoly.glb | 77.1 | 96 | 172 | 1 | 1 | 163 | 8 |
| body_teeth_base.glb | 227.4 | 4,494 | 7,120 | 1 | 1 | 163 | 4 |
| body_tongue_01.glb | 76.3 | 253 | 448 | 1 | 1 | 163 | 5 |
| bottom_cargo_pants.glb | 161.5 | 232 | 392 | 1 | 2 | 163 | 0 |
| bottom_wool_pants.glb | 109.3 | 1,540 | 2,674 | 1 | 1 | 163 | 0 |
| glasses_optical.glb | 83.4 | 3,502 | 6,196 | 1 | 1 | 163 | 0 |
| hair_braided.glb | 207.1 | 8,248 | 9,866 | 1 | 1 | 163 | 0 |
| hair_long.glb | 572.3 | 15,007 | 13,268 | 1 | 2 | 163 | 0 |
| hair_short_bob.glb | 451.4 | 1,837 | 2,858 | 1 | 2 | 163 | 0 |
| hat_newsboy_cap.glb | 50.7 | 557 | 996 | 0 | 0 | 163 | 0 |
| shoes_ankle_boots.glb | 281.3 | 2,416 | 4,120 | 1 | 2 | 163 | 0 |
| shoes_cloth.glb | 162.8 | 804 | 1,004 | 1 | 2 | 163 | 0 |
| top_polo.glb | 101.3 | 2,349 | 4,106 | 1 | 1 | 163 | 0 |
| top_tshirt.glb | 112.9 | 1,553 | 2,700 | 1 | 1 | 163 | 0 |
| **Total** | **3,929** (3.91 MB) | 55,247 | 78,788 | 15 | 20 | — | — |

`body_teeth_base.glb` is disproportionately heavy for what it visually is (4,494 verts —
more than eyes+eyebrows+eyelashes combined) — flagged as a candidate for a lower-poly source
asset in a future pass, not fixed this phase (no measured pipeline lever addresses it; it's a
source-mesh density issue, would need re-authoring or decimation).

## Texture compression: how it was actually solved

The `sharp`/`libvips` bug that blocked `gltf-transform`'s texture-compress step in Phase 4/5
(`colourspace: parameter space not set`) is a known environment issue on this machine,
unrelated to our pipeline logic. Rather than depend on it, texture compression now happens
**inside the already-required Blender export step**: `bpy.ops.export_scene.gltf(...,
export_image_format="WEBP", export_image_quality=82)`. Blender 4.5 ships native WebP encoding
(confirmed: `'WEBP'` is a valid `ImageFormatSettings.file_format` enum value) — zero new
dependencies, fully deterministic, reproducible by anyone who runs the existing
`tools/blender-pipeline/*.py` scripts. This directly satisfies "pipeline reproducible olmalı,
manuel Photoshop/GIMP istemiyorum."

**Bug found and fixed during this change**: `hair_long.glb`'s material was forced to
`alphaMode: MASK` (our own `fix_alpha_mode.mjs` heuristic, based on filename pattern) which made
the hairstyle render completely invisible after the WebP conversion — confirmed via isolated
render testing, not guessed. Root cause was specific to this asset's alpha coverage relative to
the 0.5 cutoff, not a systemic WebP problem (the other two hairstyles work fine under `MASK`).
Fixed by excluding `hair_long.glb` from the `MASK` list (now `OPAQUE`, same as the majority of
attachments); visually re-verified. This also **retroactively corrects a Phase 5 misdiagnosis**:
the "hair gets engulfed by the head at extreme morph values" finding was actually this same
invisibility bug, not a morph/hair-skinning interaction — see `docs/asset-pipeline.md`'s Face
system section for the correction.

Browser compatibility: `EXT_texture_webp` is a standard glTF extension; Three.js's `GLTFLoader`
and every evergreen browser (Chrome, Firefox, Safari 16+) support WebP decoding natively — no
extra loader/transcoder needed, unlike KTX2/Basis. Not using Blender's
`export_image_webp_fallback` (would embed a PNG fallback for pre-2022 Safari) — judged
unnecessary for a new product; noted here as the explicit trade-off, not an oversight.

## Draco vs meshopt — real comparison, not a guess

Tested both on the same two **uncompressed** source files (one morph-target-heavy, one
geometry-heavy) via `gltf-transform`'s `draco` and `meshopt` commands:

| File | Original | Draco | Meshopt |
|---|---:|---:|---:|
| Body (73 morph targets, 163 bones) | 7.04 MB | 6.46 MB (−8.2%) | **1.24 MB (−82.4%)** |
| Hair (15,007 verts, no morphs) | 2.62 MB | 1.97 MB (−24.8%) | 2.02 MB (−22.9%) |

**Decision: meshopt**, not Draco. For our actual asset mix — a 73-morph-target skinned body
plus several geometry-only attachments — Draco barely compresses the body at all (its mesh
codec doesn't meaningfully touch morph target deltas), while meshopt's sparse-accessor +
quantization approach handles both cases well and wins decisively on the file that matters
most. On pure geometry the two are close (Draco slightly ahead), but choosing per-file codecs
would add pipeline complexity for a marginal, secondary gain. `EXT_meshopt_compression` is
already confirmed working end-to-end in the shipped app (every screenshot in Phases 4–6 was
already meshopt-compressed) with no loader configuration needed beyond what
`@react-three/drei`'s `useGLTF` already provides.

## Morph target audit

73 shape keys on the body, categorized:

| Category | Count | Status |
|---|---:|---|
| Structural (9 CLAUDE.md sliders, 4 of them bilateral) | 13 | Actively driven by the Face UI |
| Macro (MakeHuman's built-in gender/age/ethnicity blends) | 8 | Not currently exposed by any slider |
| ARKit face units actually referenced by our 8 expression presets + blink | 23 | Actively driven |
| ARKit face units loaded but not yet used by any preset | 29 | Reserved (see below) |

**Tested removing the unused 37** (8 macro + 29 unused ARKit) via `gltf-transform`: file size
went from 1093.7 KB to **1103.1 KB — slightly larger, not smaller** (`.pipeline-tools/
test_morph_removal.mjs`). Sparse-accessor encoding already makes narrow-impact shape keys
nearly free, so there was nothing to reclaim; re-serializing without them added marginal
overhead instead. Per the "don't call an unmeasured change an optimization" rule: **not
removed**. The 29 reserved ARKit units stay for the reason they were added in Phase 5 — future
webcam face-tracking can drive them directly by their standard ARKit names with zero
translation layer. Removing them would trade that away for a measured net loss.

## Bone usage audit (analysis only — `game_engine` rig switch not implemented this phase)

163 bones per skeleton (body and every attachment carry an identical copy — see "why each
attachment is rigged independently" in `docs/asset-pipeline.md`):

| Group | Count | Driven by our animation system? |
|---|---:|---|
| Core (root/spine/neck/head/arms/legs) referenced in `DRIVEN_BONE_NAMES` | 13 | Yes — procedural Idle/Walk/Run/Wave/Jump/Dance |
| Other spine/limb/pelvis/clavicle/breast bones (needed for correct skin binding even though not explicitly posed) | 34 | No, but required for skin correctness |
| Fingers/hands | 38 | No |
| Toes | 28 | No |
| Facial bones (jaw, eyeballs, orbicularis, temporalis, risorius, ...) | 59 | No — face is driven by shape keys, not bone rotation |

150 of 163 bones are never explicitly posed by our code. They aren't dead weight the way unused
morph targets would be, though — they're part of the skin binding for every vertex in their
region, so removing them isn't a config toggle, it's a different rig (fewer bones bound to fewer
vertex groups), which is exactly what `game_engine` is. This is prep data for that comparison,
per `docs/rig-performance-test-plan.md` — the switch itself is intentionally not made this phase.

## Lazy loading & caching — confirmed already correct, no code change needed for the core behavior

Network trace (production build): opening the app loads exactly **10** `/models/` requests —
body + 5 facial parts + the 3 default-equipped hair/top/bottom/shoes. Opening the Hair category
*without* selecting anything: still 10 requests (no eager fetch of Long/Braided). Selecting
"Long": 11. Switching to "Short Bob" and back to "Long": still 11 total, and specifically
**exactly one** request for `hair_long.glb` across the whole sequence — `@react-three/drei`'s
`useGLTF` cache was already doing the right thing by default; this phase only needed to verify
it, not build it.

**New this phase**: `useAssetPreload` (`src/features/avatar/viewer/useAssetPreload.ts`) — when a
category panel opens, the *other* options in that category are preloaded via
`useGLTF.preload()` so switching between them has no loading flash. Deliberately scoped to
"the category currently open," not "everything" — matches the "preload everything yapma"
instruction.

## Memory leak test

Playwright + Chrome DevTools Protocol (`HeapProfiler.collectGarbage` before each
`performance.memory.usedJSHeapSize` read, to avoid measuring uncollected garbage rather than an
actual leak):

| Step | JS heap used |
|---|---:|
| Initial load | 57.5 MB |
| After 20 hair changes | 57.5 MB |
| After 20 top changes | 57.5 MB |
| After 20 randomizes | 57.5 MB |
| After reset to default | 57.5 MB |

No growth across 60 asset-swap operations. Caveat: `performance.memory` reports at ~0.1 MB
granularity and this doesn't replace a full Chrome DevTools heap-snapshot diff (which would show
retained object graphs, not just aggregate size) — but a flat aggregate across 60 swaps with
forced GC before each read is a meaningful, real signal against a leak, not proof of literally
zero garbage per swap.

## Loading UX

Unchanged this phase because it was already real, not fake: `AvatarViewer.tsx` shows "Loading
Avatar..." via a genuine React `Suspense` fallback (fires exactly while `useGLTF`'s promise is
pending, not a timed/simulated progress bar), and `ViewerErrorBoundary` catches a failed load
without crashing the rest of the editor. Verified still functioning after this phase's asset
regeneration.

## Export system (new this phase)

| Export type | Status | Notes |
|---|---|---|
| Avatar Configuration (JSON) | Working, round-trip tested | `configExport.ts`; Zod-validated on import; version-tagged (`version: 1`) |
| PNG (avatar image) | Working | 512/1024/2048 selectable, transparent-background toggle, renders via an offscreen `WebGLRenderTarget` so the live viewer is untouched during capture; mobile capped to 1024px (device memory) |
| GLB (full 3D model) | Working proof-of-concept, client-side | Merges body + all currently-equipped attachments via Three.js's `GLTFExporter` on the live scene graph. Verified structurally valid: 10 meshes, 10 skins, morph target counts match source exactly (73/8/36/25/4/5). **13.18 MB** — no meshopt/Draco applied to this export path (browser-side `GLTFExporter` doesn't do that compression itself), and each attachment keeps its own full 163-bone skeleton copy rather than being merged into one shared skeleton. Good enough as the requested POC; a **server-side Blender pipeline** (re-using the exact scripts already in `tools/blender-pipeline/`) is the correct path to a properly optimized, single-skeleton downloadable GLB — documented here as the recommendation per the client-vs-server comparison asked for, not built this phase (no backend yet, per explicit instruction). |

Export → Reset → Import round-trip tested end-to-end (hair, top, shoes, a face slider, and an
expression all changed, exported, reset to default, re-imported): avatar visually identical to
pre-export state, confirmed via screenshot comparison, zero console errors.

## Performance budget (derived from the above, not assumed up front)

| | Target | Basis |
|---|---|---|
| Initial load (default avatar, wired network) | **< 2.5 MB transfer** | Current default-equipped set is 2.48 MB post-optimization; this *is* the number, not a guess — budget is "don't regress below what we just measured" |
| Production load time (local, no network latency) | **< 1.2 s** to first fully-loaded avatar | Measured 1053 ms; budget gives ~15% headroom before treating a regression as a problem |
| Draw calls, default outfit | **≤ 10** | Measured 2; generous headroom for future accessory/clothing variety without needing a batching pass |
| Desktop FPS | **Not yet budgeted** | Every FPS number produced so far (Phases 4–6) came from headless SwiftShader software rendering and is explicitly not trustworthy — see `docs/rig-performance-test-plan.md`. A real number requires the real-device testing that plan describes; setting a target before that would be exactly the "keyfi rakam" this phase was told not to produce. |
| Mobile FPS / load / memory | **Not yet budgeted** | Same reason — no physical mobile device was available in this environment this phase. Flagged as the single most important open item before any production/ship decision, not silently skipped. |

## Environment caveats (apply to every number above)

- All load-time/draw-call/FPS numbers come from a **production build served locally**
  (`next build && next start`, `localhost`) — real network latency for actual users is not
  represented and will add to load time proportionally to asset size (which is exactly why the
  70% size reduction above matters more in the real world than the 52% local load-time number
  suggests).
- Browser used for all measurements: headless Chromium via Playwright. No real mobile device,
  no real GPU-accelerated rendering path was available in this environment (confirmed earlier
  via `UNMASKED_RENDERER_WEBGL` reporting SwiftShader). Every size/count/structural measurement
  (file sizes, vertex/triangle/bone/morph counts, network request counts, JS heap) is
  environment-independent and fully trustworthy; every timing/FPS number is directionally
  useful for before/after comparison on *this machine* only.
