# Web creator on the Avatar API — Phase 9

Goal of this phase: avatars can be created in the browser **and** everything the browser does goes
through the same API an external app uses, so AvatarForge can run as an API product.

Phase 8 left one deliberate gap (see `developer-platform.md` §15): the creator's Save/Load wrote to
`localStorage` only. That gap is closed, and the creator itself was rebuilt around it.

## 1. Flow

```
/create ── edit (everything autosaves a local draft) ──► Save
   │                                                      │
   │                     not signed in → sign-in / create-account dialog (in place, no navigation)
   │                                                      ▼
   │     POST /api/v1/avatars  (session cookie)  or  PUT /api/v1/avatars/{id}
   │     PUT  /api/v1/avatars/{id}/thumbnail  (portrait PNG captured from the viewer)
   │     URL becomes /create?avatarId={id}
   ▼
My avatars (GET /api/v1/avatars → the account's avatars) · Share (visibility Public → /avatar/{id})
Export: PNG / GLB / JSON in the browser, or HD PNG / GLB via POST /render and /export
```

- One account system: the same cookie session signs into the creator and the developer dashboard.
- Ownership: session-created avatars belong to the account (`OwnerUserId`); API-key avatars to the
  key's project. Accounts can open their projects' avatars too (dashboard "Open in Creator").
- Drafts: every change is saved to the browser (debounced), including which saved avatar it edits,
  so a reload never loses work. Signed-in users are warned before leaving with unsaved account changes.
- Status pill: *Draft on this device* / *Unsaved changes* / *Saving…* / *Saved*.
- Keyboard: Ctrl/⌘+S save, Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo (slider drags coalesce).

## 2. API additions (all covered by integration tests)

| Endpoint | Notes |
|---|---|
| `POST /api/v1/avatars` | now also with a session cookie (owner = account) |
| `GET /api/v1/avatars` | key → project's avatars; session → account's avatars; never unscoped |
| `GET/PUT /api/v1/avatars/{id}/configuration` | CLAUDE.md §24 |
| `PUT /api/v1/avatars/{id}/thumbnail` | raw PNG/WebP/JPEG ≤ 1 MB, magic bytes verified, old file deleted |
| `POST /api/v1/avatars/render` | CLAUDE.md §28 body shape (`avatarId`, `animation`, `time`, `camera`, `background`) |
| `POST …/render` options | `camera` full/front/portrait/threeQuarter, `background` transparent/#hex, animation pose |
| `POST …/export` | `includeAnimations` — single skeleton, all clips as glTF animations |
| `GET /api/v1/catalog`, `/presets`, `/expressions`, `/animations[/{id}]` | public reference data |

Server-side validation (`AvatarConfigurationValidator`): ranges, hex colors, expression ids, asset
existence **and slot**, one accessory per slot, morph limits — all problems returned at once in
`details.errors`. Per-account limit of 200 saved avatars; per-account rate limit 240 req/min;
Blender renders capped at 2 concurrent processes; a render that can't start Blender is a `503`.

## 3. Creator features added this phase

Skin tone, iris color, body type/height/shoulders/legs, 8 more hairstyles, beards & mustaches
(generated), 4 tops, 2 bottoms, 2 boots, 2 hats, 5 glasses, presets, style-coherent randomize,
undo/redo, 7 more animations (13 total) with cross-fades and expression coupling, camera framings per
category, new premium UI (desktop rail + panel, mobile tabs + sheet), loading/error states,
thumbnails rendered by the real viewer. Details: [`avatar-system.md`](avatar-system.md).

## 4. Verified end to end

A scripted headless-Chromium session against the running API + web app:

1. open `/create` → apply the *Studio* preset → rename
2. Save → sign-in dialog → create account → saved (URL gets `?avatarId=`)
3. Randomize → status *Unsaved changes* → Ctrl+Z restores
4. reload → the avatar reopens from the account, status *Saved*
5. My avatars shows it with its thumbnail
6. Share → Make public → the `/avatar/{id}` page renders it for an anonymous visitor
7. Export: PNG and GLB download in the browser; HD PNG renders on the server (Blender) and downloads

`dotnet test`: 58/58 (38 from earlier phases + 20 new: session CRUD and isolation, thumbnails,
configuration endpoints, validation, presets pass validation, catalog endpoints, animated/posed
renders, GLB with one skin and every clip). `tsc`, `eslint`, `next build`: clean.

## 5. Phase 10 — quality pass and "Create from a photo"

Feedback after Phase 9: some animations looked wrong (the run's arms bent backwards), beards looked
poor, and people wanted to start from their own photo. What changed:

- **Animations** re-authored on an anatomical solver (details in
  [`avatar-system.md`](avatar-system.md) §7): every joint direction is calibrated against the rig by
  forward kinematics, arms use a hinge-aware solver + analytic IK (hands reach the chin, the belly,
  the thighs; palms face where they should), feet are planted by a ground solver. Every clip was
  reviewed on multi-angle contact sheets rendered by the real viewer.
- **Facial hair v2**: regions from measured face landmarks, mustaches that actually cover the upper
  lip, hair that grows downward, tapered edges and shaded depth; identical in the viewer and Blender.
- **Hair & skin**: no black strand lines on tinted hair, soft card edges (second blended pass),
  low-specular hair, true-color tone mapping (Khronos PBR Neutral, in both renderers), fair skin
  tones no longer wash out to white, exact API background colors.
- **Face sliders go both ways** (narrower face, smaller eyes…), verified clean to −0.6.
- **Living eyes**: the avatar makes eye contact with the viewer and its eyes move naturally
  (saccades, glances); **bolder eyebrows**; strand detail on hair that had none.

### Create from a photo

Entry points: *Presets → Create from a photo*, the landing page's *Start from a selfie*
(`/create?photo=1`).

```
selfie (getUserMedia) or upload ──► canvas (≤1024 px) ──► MediaPipe Face Landmarker (478 pts + blendshapes)
                                                     └──► MediaPipe hair segmenter (confidence mask)
                  analyzeFace()  — skin, eyes, hair length/color/bangs, beard/mustache, proportions
                  suggestFromAnalysis() — palette snapping, catalog tags, calibrated face sliders
                  review dialog (every trait can be switched off) ──► one undoable edit
```

- **Private by design**: the runtime and models are self-hosted (`public/mediapipe/`, prepared by
  `scripts/prepare-mediapipe.mjs` before `dev`/`build`); the photo only ever exists in a canvas in
  the page. Nothing is sent to the API — the result is an ordinary configuration, saved like any other.
- **Only visible, editable traits** are read. No gender, age or ethnicity inference: the body is the
  same for everyone.
- Skin: cheeks + forehead (hair masked out), white-balanced on the eye whites, kept inside the
  real-skin gamut. Eyes: the iris ring inside the eyelids, matched by hue (exposure-invariant). Hair:
  segmentation mask (with a color-model fallback for hair the model misses) → length from how far it
  falls below the chin, bangs, color. Facial hair: the segmenter's beard pixels, or how much darker
  chin / cheeks / upper lip are than the skin. Proportions: 7 landmark ratios, mapped to face sliders
  through `shared/face-calibration.json` (an average human face keeps the base shape).
- Warnings for dark/bright photos, turned heads, small faces, closed eyes, several faces.

Verified: `qa_photo_analysis.mjs` — 6 synthetic "selfies" of avatars with known traits, all traits
recovered (skin ΔE < 9, hair length/color/bangs, eye color, beard type, mustache);
`qa_photo_e2e.mjs` — upload → review → apply → the draft configuration contains the traits → Ctrl+Z
restores; camera flow with Chromium's fake camera (selfie → traits; test pattern → "No face found").

### Live face (camera → avatar face, CLAUDE.md §13)

*Live face* in the animation dock turns on the camera; a mirrored preview appears in the corner of
the 3D view (status *Live* / *Looking for your face*, close button, "Your camera stays on this
device").

- MediaPipe Face Landmarker in VIDEO mode (`src/features/photo/liveFace.ts`): 52 ARKit blendshapes —
  the avatar's own morph names, so they feed the face rig directly — plus the head rotation from
  MediaPipe's facial transformation matrix. Left/right are swapped so the avatar behaves like a mirror.
- The first ~0.5 s of a session is taken as the person's neutral head pose (camera angle and posture
  aren't a nod). ~30 detections/s, fewer when detection is slow (CPU fallback); a frame counts as
  current for 3 detection intervals.
- In the viewer the live layer fades in/out over ~0.2 s, replaces the preset/animation expression and
  the procedural blink, drives the eyes through the `eyeLook*` weights, and adds the head pose on top
  of whatever animation plays (`viewer/headPose.ts`, neck01/neck02/head like the clip builder).
- Verified (`qa_live_face.mjs`): Chromium's fake camera plays a video of a face alternating neutral /
  smiling; the avatar's `mouthSmile` follows (0 ↔ 0.9) and its head stays straight (< 0.02 rad).

## 6. Known limitations

- The API renders synchronously (5–15 s); a job queue is the next step for volume.
- No email verification / password reset yet.
- Browser GLB exports are uncompressed (~15–20 MB with all clips); the server export is ~10 MB.
- PostgreSQL runs in WSL on this dev machine (EDB installer blocked — see `api-platform.md`).
- Photo analysis was validated on synthetic renders (no real people's photos were used). It reads
  traits the avatar system can express; unusual lighting, heavy makeup or head coverings reduce accuracy,
  which is why every suggestion is reviewed before it is applied.
