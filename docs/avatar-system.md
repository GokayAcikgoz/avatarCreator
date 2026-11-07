# Avatar system — how an avatar is built, rendered and animated

This covers the runtime avatar (web viewer and the API's Blender renderer) as rebuilt in Phase 9.
Asset *production* is in [`tools/asset-pipeline/README.md`](../tools/asset-pipeline/README.md);
the API surface in [`api-platform.md`](api-platform.md).

## 1. One source of truth: `shared/`

| File | Contents | Read by |
|---|---|---|
| `asset-catalog.json` | categories, palettes, body types, every asset (slot, model, thumbnail, styles, compatibility, license) | web (`assetManifest.ts`), API (`SharedCatalog` → `AssetSeeder` upsert on boot, validator), Blender (via resolver) |
| `avatar-presets.json` | 6 complete configurations | web Presets tab, `GET /api/v1/presets` |
| `expressions.json` | ARKit weight sets per expression | web face driver, API validator + renderer |
| `animation-clips.json` | 13 sampled clips (generated) | web `AnimationMixer`, API pose sampler, GLB export |
| `rig-spec.json` | body-shape bones and ranges, skin reference, iris UV layout, garment layers | web + API + Blender |
| `face-calibration.json` | photo → face-slider mapping (generated, see §11) | web photo analysis |

The files are embedded into the API assembly at build time, so the API and the web creator cannot
disagree about ids, ranges or rules. `AssetSeeder` upserts the catalog on every boot (new assets
reach existing databases without migrations; removed ones are kept for old avatars).

## 2. One skeleton

Every garment/hair/face-part GLB was rigged to the same MakeHuman "default" armature (163 joints).
At load time each attachment's `SkinnedMesh` is **re-bound to the body's bones** (keeping its own
inverse bind matrices) and its own copy of the armature is removed:

- one `AnimationMixer` drives everything — no drift between body and clothes;
- exports (browser `GLTFExporter` and the API's Blender export) contain **one** skeleton.

Blender needs every skeleton to share one rest pose; meshopt quantization folds a scale into the
inverse bind matrices, so `build_server_assets.mjs` / `postprocess_attachments.mjs` bake that "bind
shape" back into the vertices for the server copies (`gltf-utils.mjs#bakeBindShape`).

## 3. Materials

- **Skin**: the body GLB carries a tone-neutral detail map (`public/textures/skin_detail.webp`,
  derived from a CC0 MakeHuman skin: normalized per channel, half its chroma kept, anatomical detail
  removed). Color = `detail × tone_linear / 0.78` — identical in three.js and Blender. Not clamped:
  for very fair tones the red factor exceeds 1, and clamping it flattened the hue to white (GLB
  export clamps, as glTF requires).
- **Tone mapping**: Khronos PBR Neutral in both renderers (three.js `NeutralToneMapping`, Blender view
  transform "Khronos PBR Neutral") — base colors come out as picked. API renders with a solid
  background composite it after tone mapping, so the requested `#RRGGBB` is exact.
- **Hair**: textures are re-toned by the pipeline (`image_ops.py hair_tone`: strand contrast mapped
  into 150–240 so a blond tint never shows black stripes, color bled into transparent texels so
  mipmaps don't draw dark fringes); object-space normal maps some community hair ships are dropped
  (they shade as dark streaks when read as tangent-space). In the viewer hair uses a low-specular
  physical material (≈ Blender's specular 0.15) and a second, alpha-blended pass of the same cards
  adds the soft strand tips the alpha-tested pass cuts away. Hair shipped with a flat, strand-less
  texture (*Swept*) gets synthesized streaks along its locks' UV axis (`image_ops.py hair_strands`)
  instead of reading as a plastic helmet.
- **Eyebrows**: the brow texture's fine strokes sat below the alpha cutoff and vanished (thin, washed
  out brows); the pipeline boosts their alpha ×1.8, and brows get the same soft second pass as hair.
- **Eyes**: the iris ring (UV centers/radius in `rig-spec.json`) is recolored per texel by luminance,
  keeping pupil and fibers. Browser: `CanvasTexture`; Blender: numpy on the image.
- **Tints**: tintable textures were neutralized to ~80% gray by the pipeline, so `texture × color`
  shows the chosen color faithfully. Eyebrows follow the hair color (35% darker, sRGB).
- **Garments** are alpha-tested and double-sided (several community garments have flipped faces).

## 4. Layering — why clothes never show the body or each other

Form-fitted proxies share the skin surface, and some genuinely intersect (a trouser waistband
through a shirt). Three mechanisms, identical in both renderers:

1. **Push-out by layer** (`rig-spec.json garmentLayers`: shoes 1 · bottom 2 · top 3 · hair 4 · hats 4.5,
   per-asset override e.g. the tucked tee 1.5): each garment is moved `1.2 mm + 0.8 mm × layer` along
   its bind-pose normal, before skinning (vertex shader in the browser, Displace modifier in Blender).
2. **Retract where covered**: the outer piece reports its lowest point; the covered piece pulls its
   surface 12 mm inside above it (trousers under a shirt's hem) — 25 mm for hair under a hat's rim.
3. A small constant depth bias for near-coplanar ties. A *slope-scaled* bias is deliberately not
   used: it made grazing-angle faces jump in front of outer layers (waistband outlines on shirts,
   "caged" hair, triangle artifacts in beards).

The body's 8 MakeHuman macro morphs have non-zero default weights — that blend is the shape every
garment was fitted to — so the face driver adds to those defaults instead of zeroing unknown morphs.

Asset combinations the geometry can't support are declared, not hidden: e.g. the canvas flats are
incompatible with shorts (the body's ankle skin is baked away for boots), voluminous hair with hats.

## 5. Facial hair (our own assets, v2)

`generate_facial_hair.mjs` builds each style from the body's own face surface:

- **Regions from measured landmarks**: the lip-volume and nose morph targets locate the vermilion
  border, the lower lip and the nose bottom per angle around the head (the upper-lip skin on this
  face is only ~6 mm tall, which is why v1 mustaches were two blotches at the mouth corners). A
  mustache is a band from the nose down past the lip border (it overhangs the lip), full in the
  middle and thinning toward drooping ends; beards add cheeks/jaw/chin/neck up to a cheek line.
- Mustaches are subdivided once (clean thin shapes); coverage is smoothed over the mesh.
- Exported with the body's skin weights and the morph targets that move the region (beards follow
  smiles, jaw and face sliders), a per-vertex coverage alpha, UVs into a procedural strand/stubble
  texture (mustache strands combed outward), and `_GROW`: the normal combed downward (hair hangs),
  its length the local thickness (fuller chin). One custom attribute on purpose — Blender's glTF
  importer mis-merges several of different sizes.
- The **shell recipe** `[offset, opacity, taper, shade]`: viewer and Blender stack copies grown by
  `offset × _GROW`; outer shells only keep the denser core (`taper` → rounded, thinning edges) and
  inner shells are darker (`shade` → depth). Blender builds them as real geometry with the offset
  applied to every shape key.
- Stubble is a fine-grained shadow plus dots (low-frequency noise read as dirt), densest around the
  mouth and chin, fading out over a wide, well-smoothed band (no hard patch edge on the coarse mesh).
- The body's default macro blend (the 8 MakeHuman targets with non-zero default weights) is baked into
  the facial hair's base positions **and normals**, and every kept target carries normal deltas too.
  Copying only position deltas had left the hair lit with un-blended normals (blotchy patches).

## 6. Body shape

- Height: uniform scale 0.92–1.08 (≈158–186 cm).
- Shoulder width / leg length: bone **translations** (never scales — children would scale too),
  factors from `rig-spec.json`; longer legs lift the root by the extra length so feet stay grounded.
- Body types are named combinations of those two sliders.

## 7. Animation

Clips are authored in `build_animation_clips.mjs` as pose functions of time and sampled at 24 fps into
quaternion deltas (`final = rest × delta`) plus a root offset. The builder carries its own forward-
kinematics solver over the rig's rest pose, so poses are described anatomically, never with guessed
axis signs:

- **Calibrated joint motions**: "hip flexion", "knee flexion", "spine bends forward", "finger curls
  into the palm"… are rotations about body axes whose sign is *measured* at build time (e.g. hip
  flexion must move the knee forward). A wrong-way bend can't be authored. (Phase 9's hand-set sign
  table had the elbow backwards — the run's arms bent the wrong way.)
- **Hinge-aware arms**: the upper arm is rolled so the elbow's real hinge (measured from the rest
  pose, which is already bent 43°) lies in the plane the forearm should fold in; the elbow then only
  flexes. Upper-arm roll beyond ~100° is reported as a QA warning.
- **Analytic arm IK** (law of cosines on measured bone lengths) with an elbow pole: hands reach the
  chin (Think), the belly (Laugh), the thighs (Sit), each other (Clap), a point in front of the chest
  (Thumbs Up).
- **Hands**: fingers point / palms face where asked — forearm pronation takes the roll (±110°), the
  wrist the rest (capped at 75°).
- **Ground contact**: the root is moved so the lowest sole point (heel, ball, toe tips) stands on the
  floor every frame; pelvis rise/fall in the walk and the run's flight phases come out of that.
- Gait curves are smooth periodic keyframes (walk: heel strike → toe-off → swing; run: ~90° elbows,
  flight phases, swing-leg fold under the hip). ~45 KB gzipped for all 13 clips.

Review tooling: `qa_animation_sheets.mjs` renders every clip at N moments from front / side / 3-4 /
close-up with the real viewer (`__afStudio.pose(clip, t)` freezes the mixer on one frame).

- Browser: `buildClips` turns deltas into absolute `THREE.AnimationClip`s (every animated bone in
  every clip, so cross-fades never freeze a limb); switching uses `crossFadeTo` with the clip's
  `fadeIn`. A clip's signature `expression` (wave → smile, laugh → laugh) is blended by the mixer's
  own weights. `sit` fades in a stool.
- API renders sample one frame (`AnimationSampler`, same slerp) and pose the Blender armature.
- GLB export embeds every clip (browser: with the leg-length root lift baked in).

## 8. Viewer

`AvatarViewer` (R3F) → `AvatarStage` (RoomEnvironment IBL + key/fill/rim lights, stage disc,
blob shadow, stool, orbit controls with animated framings per category) → `AvatarModel` (body rig,
parts, mixer, face driver, capture/export handle) → `Attachment` (clone, re-bind, materials, shells,
layer shader). Each part has its own error boundary: a failed asset is skipped, a failed body falls
back to the procedural placeholder, a failed WebGL context shows a message — the editor keeps working.

### Live face

Camera tracking (`src/features/photo/liveFace.ts`) publishes the latest mirrored ARKit weights and
head rotation; `AvatarModel` blends them in (FaceDriver's live layer replaces expression and blink;
`HeadPoseDriver` adds turn/nod/tilt over the neck and head after the mixer). See
[`web-creator.md`](web-creator.md) §5.

### Living eyes

`viewer/gaze.ts`: the eye bones (never animated by clips) look at the person — the camera — while
they are in front of the avatar (±60°), with small saccades every 0.6–2.4 s and occasional short
glances away; range ±19° sideways / ±11° vertically, relative to the head, critically damped. It runs
with blinking (editor, share page, landing hero) and is off for studio captures and exports, which
stay deterministic with eyes at rest.

## 9. Verified

- Every clip reviewed on multi-angle contact sheets (run: forward-bent elbows and fists; clap: palms
  meet, fingers up; think: knuckles under the chin, elbow resting on the other forearm; sit: hands on
  the thighs; thumbs up: thumb to the sky), palm orientation and hand targets checked numerically.
- Facial hair: every style from front / 3-4 / side, in six colors; Blender render compared.
- Viewer vs Blender: same skin tone, iris color, beards, layering (polo over trousers, hat over long
  hair) — renders compared side by side.
- Browser GLB export: one skeleton — every mesh's skin references the same 163 joint nodes (one `root`) — and all 13 clips. API GLB export: a single skin, 13 animations (integration-tested).

## 10. Known limitations

- Body sliders move bones only; there are no body-mass morphs (garments aren't fitted to them).
- `face.shape`, `eyeShape`, `nose`, `mouth`, `earShape` are stored labels; the geometry comes from
  `face.morphs` (there is no ear-shape morph in the current body).
- Facial hair shells read well at normal distances; at extreme close-up the layers are visible. The
  API's GLB export carries the single surface plus the shell recipe (a generic glTF viewer shows it
  flat); the browser's GLB export contains the full shells.
- Animations are procedural keyframes, not motion capture; locomotion is in place (no root travel).
- Some community hair (e.g. *Swept*) has no strand texture at all and reads as a solid shape.

## 11. Create from a photo

On-device analysis (`src/features/photo/`), described in [`web-creator.md`](web-creator.md) §5.
`calibrate_face_metrics.mjs` measures how each face slider moves 7 landmark ratios on our own avatar
(the real viewer + the real MediaPipe pipeline) and records the ratios of MediaPipe's canonical
(average human) face; `suggestFromAnalysis` maps a photo's ratios relative to that average onto the
sliders, both ways.
