# Rig Performance Test Plan — `default` vs `game_engine`

Not implemented yet (per explicit instruction — Phase 5 is face/expression quality, this is prep
only). This is the plan to execute once Phase 5 closes out.

## Why this comparison exists

The body and every attachment currently use MPFB's `default` rig: 163 bones, including individual
finger and toe bones and a full facial bone set (jaw, eyeballs, orbicularis, temporalis, risorius —
see `docs/asset-pipeline.md`). MPFB bundles a `game_engine` rig variant specifically aimed at
real-time use, with a much smaller bone count. Since every attachment (body + up to ~7 simultaneously
worn items) currently carries and animates its *own* independent copy of the skeleton (see
"why each attachment is rigged independently" in `docs/asset-pipeline.md`), bone count directly
multiplies the per-frame animation cost across everything worn at once — this is the single largest
lever available before touching textures or draw calls.

## What changes to produce the comparison build

One parameter in `tools/blender-pipeline/generate_face_system.py` and
`tools/blender-pipeline/generate_attachments.py`: `HumanService.add_builtin_rig(basemesh, "default")`
→ `HumanService.add_builtin_rig(basemesh, "game_engine")`. Re-run both scripts to produce a parallel
`avatar-base-poc.glb` / `attachments/*.glb` set. `useProceduralSkeletonDriver`'s bone name list
(`DRIVEN_BONE_NAMES`) will need to be checked against `game_engine`'s bone names — some (finger/toe
bones) won't exist and aren't referenced anyway; the ones we actually drive (spine/neck/head/arms/
legs) are expected to carry over, but this must be verified, not assumed.

## Metrics

| Metric | How to measure | Tool |
|---|---|---|
| GLB file size | Per file, body and each attachment | `ls -la` / file size |
| Vertex count | Per mesh | Parse GLB JSON `accessors[POSITION].count`, same technique used throughout this phase |
| Bone count | Per skin | GLB JSON `skins[].joints.length` |
| Draw calls | Full dressed avatar (body + hair + top + bottom + shoes + 2 accessories) | Browser DevTools / `renderer.info.render.calls` (Three.js exposes this directly — `gl.info` in R3F) |
| Texture memory | Sum of decoded texture bytes in VRAM | `renderer.info.memory` / manual sum of texture dimensions × 4 bytes |
| Load time | Cold load (no cache) and warm load (cached), full dressed avatar | Browser Network tab / `performance.now()` around the `useGLTF` promise |
| FPS | Sustained, per animation state (Idle/Walk/Run/Wave/Jump/Dance) | `requestAnimationFrame` counter over a fixed window (same technique as the earlier perf check), on **real hardware**, not headless |
| Morph performance | FPS delta with all 9 structural sliders + an expression + blink active vs. neutral | Same FPS counter, A/B |
| Mobile performance | Same FPS/load metrics on an actual phone | See below — this is the one that actually answers the business question |

## Devices (real hardware — headless/emulated browser numbers are not trustworthy for this decision)

This phase already hit a case where headless Chromium reported ~7 FPS under SwiftShader software
rendering — meaningless for judging real performance. The rig comparison must not repeat that
mistake.

- **Desktop**: one mid-range machine (integrated GPU, not the dev workstation's dedicated GPU) and
  one higher-end machine, both real Chrome/Safari/Firefox.
- **Mobile**: at minimum one mid-tier Android (the actual target per CLAUDE.md's "orta seviye mobil
  cihaz" requirement) and one iPhone, both on real mobile Safari/Chrome, not desktop dev-tools device
  emulation.

## Test matrix

For each rig (`default`, `game_engine`) × each device tier (desktop-mid, desktop-high, mobile-mid,
mobile-high):

1. Cold load time, full default outfit.
2. FPS at idle (steady state, no interaction) — 10s window.
3. FPS during Walk / Run / Dance (the highest-bone-activity states).
4. FPS with all 9 face sliders at max + an expression + auto-blink running simultaneously.
5. Draw call count, dressed vs. undressed (body only).
6. Memory footprint after 2 minutes of use (checked for leaks — see Phase 4/5 test matrix item on
   memory).

## Decision rule

If `game_engine` shows no meaningful FPS/load-time difference from `default` on the **mobile-mid**
device specifically (the tightest real constraint CLAUDE.md sets), keep `default` — it's the fuller,
more expressive rig (finger/toe articulation, more facial bones) and there's no reason to give that
up for a saving that doesn't show up where it matters. If `game_engine` gives a real, measurable win
on mobile-mid, switch and accept the reduced articulation as the right trade for the "usable on
mid-tier mobile" requirement CLAUDE.md sets as a hard constraint.

## Out of scope for this test round

Draco/KTX2 texture compression, mesh simplification, and lazy-loading are separate levers (tracked in
`docs/asset-pipeline.md`'s Performance notes) and should be measured independently — don't conflate a
rig change with a compression change in the same before/after number, or the comparison won't say
which lever actually did what.
