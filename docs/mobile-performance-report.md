# Mobile Performance Report — Phase 6.5 (Real Device Validation)

Every number below comes from a Playwright `_android` session driving a **physically connected,
real** phone via ADB/CDP — not browser device emulation, not headless SwiftShader. Test date:
2026-08-13, this machine + device. Raw output: `mobile_results.json`, `thermal_results.json`
(scratchpad), scripts: `mobile_full_test.js`, `mobile_thermal_test.js`.

## Device coverage — 1 of 3 requested tiers

CLAUDE.md's instruction was explicit: **do not fabricate a device**. No iPhone and no mid-range
Android were physically available in this environment. Only the device below was tested. The
Low/Mid columns in every table are marked `N/A` — not filled with estimates, not omitted
silently.

| | |
|---|---|
| Device | Samsung Galaxy S23 (SM-S911B) |
| Tier | **High** (flagship, Snapdragon 8 Gen 2 / SM8550, ~7.2 GB RAM) |
| OS | Android 16 (SDK 36) |
| Browser | Chrome 150.0.7871.187 |
| Network | USB (`adb reverse tcp:3000 tcp:3000`) → local production server, no wireless/cellular latency |
| Build | Production (`next build && next start`), same build tested in Phase 6 |
| Power state | Charging via USB throughout (battery 89→92%, ~40°C) — see thermal caveat below |

## Bug found and fixed before any numbers were trustworthy

First real-device load revealed the header action row (Randomize/Reset/Load/Save/Export) and the
animation pill bar didn't fit a 360px-wide screen and weren't scrollable — Chrome expanded the
whole page's layout viewport to 442px to accommodate the overflow (`window.innerWidth` ≠
`window.screen.width`), which desktop devtools emulation never surfaces because it doesn't
reproduce this specific mobile-Chrome viewport-widening behavior. Fixed by giving both rows
`overflow-x-auto` + `min-w-0` (the same pattern `CategoryNav`'s horizontal mode already used
correctly) — `src/features/avatar/ui/EditorHeaderActions.tsx`, `AnimationBar.tsx`,
`CreateEditor.tsx`, `ExportMenu.tsx`. Verified `window.innerWidth` returned to exactly 360
(matching `window.screen.width`) after the fix, rebuilt, redeployed, then re-ran every test below
against the corrected build. This is exactly the kind of bug real-device testing exists to catch.

## Load metrics

| Metric | Low | Mid | High (Galaxy S23) |
|---|---|---|---:|
| DOM content loaded | N/A | N/A | 129 ms |
| Avatar load ("Loading Avatar..." → real GLB visible) | N/A | N/A | 931 ms |
| Network idle | N/A | N/A | 1,511 ms |

## Rendering FPS

Sampled via an injected `requestAnimationFrame` counter over fixed windows (1.2–4 s per
interaction), running concurrently with the real interaction (CDP `Input.dispatchTouchEvent` for
rotate/zoom/morph drag, native `.click()` for everything else).

| Metric | Low | Mid | High (Galaxy S23) |
|---|---|---|---:|
| Avg FPS (idle) | N/A | N/A | 59.9 |
| Min FPS (idle) | N/A | N/A | 59.5 |
| Rotate (drag) | N/A | N/A | 59.9 avg / 59.5 min |
| Zoom (pinch) | N/A | N/A | 59.9 avg / 59.5 min |
| Walk / Run / Wave / Jump / Dance | N/A | N/A | 59.9 avg / 58.8–59.5 min (all 6) |
| Combined (Dance + Smile + options panel open) | N/A | N/A | 59.9 avg / 59.5 min |

Every animation and interaction tested pins at essentially exactly 59.9 fps average — this is the
device's 60 Hz display vsync ceiling, not a measured performance limit. On this device the app is
vsync-bound, not compute-bound; these numbers show zero dropped frames under any tested load, but
they cannot tell us how much *extra* headroom exists above 60 fps, because nothing here asked the
device to exceed it.

## Interaction latency

Click-to-settled-frame timing (native `.click()` + 3 rAF settle, real wall-clock). Averaged across
the primary-scenario samples and the 30/50-repeat stress samples together (larger n).

| Metric | Low | Mid | High (Galaxy S23) |
|---|---|---|---:|
| Hair switch | N/A | N/A | ~176 ms |
| Clothing (top) switch | N/A | N/A | ~172 ms |
| Shoes switch | N/A | N/A | ~167 ms |
| Accessory toggle | N/A | N/A | ~185 ms |
| Expression (Smile) | N/A | N/A | 184 ms |
| Randomize | N/A | N/A | ~173 ms |
| Category tab open | N/A | N/A | ~180 ms |

**Morph slider drag: 616–979 ms — caveat, not a product number.** This used CDP
`Input.dispatchTouchEvent` (12+ sequential awaited round-trips per drag) to simulate a finger
drag, so the measurement includes real USB/CDP protocol overhead per event, not just app
responsiveness. A real finger's touch samples are handled natively by the OS/browser with none of
that per-event round-trip cost. The click-based numbers above (native `.click()`, one round trip)
are the trustworthy latency figures; the morph-drag number is reported for completeness but should
not be read as "the app takes ~800ms to respond to a slider."

## Stress tests — no degradation found

First-10 vs. last-10 average, same array, to check for drift under sustained repeated use:

| Test | First-10 avg | Last-10 avg | Δ |
|---|---:|---:|---:|
| Randomize × 50 | 171.3 ms | 173.6 ms | +2.3 ms (noise) |
| Hair switch × 30 | 175.0 ms | 177.0 ms | +2.0 ms (noise) |
| Top switch × 30 | 174.1 ms | 171.1 ms | −3.0 ms (noise) |
| Morph drag × 30 | 659.1 ms | 661.0 ms | +1.9 ms (noise) |

No metric trends upward across ~170 total interactions in this run. Combined with the memory data
below, this rules out both a rendering-side and a memory-pressure-side degradation over sustained
use on this device.

## Memory (JS heap, via CDP `Performance.getMetrics`)

| Checkpoint | JS heap |
|---|---:|
| After initial load | 15.4 MB |
| After primary interaction scenario | 23.6 MB |
| After randomize × 50 | 21.4 MB (down — GC reclaimed) |
| After hair/top/morph × 30 each | 22.4 MB |
| After combined load test | 25.6 MB |
| After PNG export (3 sizes) | 20.4 MB |
| After full export block | 20.0 MB |

Heap oscillates in a 15–26 MB band across the whole run with no monotonic growth — no leak
detected across ~170 interactions + 3 exports.

## Thermal test — 5.7 minutes sustained load (Dance + cycling expressions + morph drag)

18 samples at 20s intervals, real `dumpsys thermalservice` / `dumpsys battery` reads throughout.

| | Start | End | Range across all 18 samples |
|---|---:|---:|---:|
| Thermal status | 0 (nominal) | 0 (nominal) | **0 (nominal) for all 18 samples — never elevated** |
| Max single-sensor temp | 44.1°C | 42.8°C | 42.5–48.8°C |
| Avg sensor temp | 34.7°C | 34.2°C | 34.1–35.2°C |
| Battery temp | 40.2°C | 39.7°C | 39.6–40.3°C |
| FPS (avg / min) | 59.9 / 59.5 | 59.9 / 59.5 | 17 of 18 samples at 59.9/59.5 |

**No thermal throttling.** Temperature at the end of the test was lower than at the start;
`thermalStatus` never left `NONE` across the full 5.7 minutes of Dance + expression-cycling +
morph-dragging.

**One anomaly, disclosed rather than hidden:** at t+202s, one sample read 59.6 avg / **29.9 min**
fps — a single dropped/delayed frame within that 3-second window. The samples immediately before
(t+182s) and after (t+222s) were both back to 59.9/59.5, and the thermal reading at that exact
moment was near the *lowest* of the whole run (42.6°C) — ruling out thermal throttling as the
cause. Most likely a one-off OS/USB-bus scheduling hitch (this test ran over a USB-tethered ADB
connection while charging). Not reproduced on any other sample in this run or in the separate
primary-scenario run.

**Caveat:** the device was charging via USB for the full test (battery couldn't be unplugged
without losing the ADB connection this environment depends on). Charging current adds its own
heat, separate from CPU/GPU load — so this test's thermal numbers are not a pure "GPU/CPU load
only" measurement. Given temperatures still trended flat-to-down, this is judged not to be masking
a real throttling risk, but it's a real methodological limit worth stating rather than omitting.

## Export performance

| Export | Time | Notes |
|---|---:|---|
| JSON config | 349 ms | |
| PNG 512px | 815 ms | First export call — includes one-time `WebGLRenderTarget` + shader warm-up cost |
| PNG 1024px | 223 ms | Post-warmup, steady-state cost |
| PNG 2048px | 189 ms | **2048px is feasible on this device** — no memory failure, actually faster than 1024 post-warmup (JIT/shader cache already hot) |
| GLB (client-side merge) | 1,249 ms | Matches the Phase 6 desktop finding — experimental, correct, not yet optimized (single shared skeleton needs the server-side Blender pipeline, still not built per "no backend yet") |

All three PNG sizes, JSON, and GLB completed successfully with zero errors on this device — no
evidence here to force the "mobile → JSON/PNG only, desktop/API → GLB" fallback for high-end
devices. That question remains open for actual low/mid-tier hardware, which wasn't available to
test.

## Mandated summary table

| Metric | Low | Mid | High (Galaxy S23) |
|---|---|---|---:|
| Initial Load | N/A | N/A | 129 ms |
| Avatar Load | N/A | N/A | 931 ms |
| Avg FPS | N/A | N/A | 59.9 |
| Min FPS | N/A | N/A | 59.5 (steady-state); one 29.9 anomaly, see thermal section |
| Morph Latency | N/A | N/A | 616–979 ms (gesture-simulation + protocol overhead — see caveat) |
| Hair Switch | N/A | N/A | 176 ms |
| Clothing Switch | N/A | N/A | 172 ms |
| Randomize | N/A | N/A | 173 ms |
| PNG 1024 | N/A | N/A | 223 ms |
| GLB Export | N/A | N/A | 1,249 ms |

## Performance budget (real numbers, high-tier only)

| | Target | Basis |
|---|---|---|
| Avatar fully loaded (real device, USB-tethered local server) | **< 1.2 s** | Measured 931 ms |
| Steady-state UI interaction latency | **< 250 ms** | Measured 167–198 ms across every click-based interaction |
| FPS floor, high-tier device | **59 fps sustained** | Measured 59.9 avg / 59.5 min across every animation, combined load, and 17 of 18 thermal-test samples |
| Sustained-load thermal ceiling | **Not yet budgeted for low/mid tiers** | Only high-tier validated; nothing here justifies a number for hardware that wasn't tested |

## Case decision: **Case A** — current rig is fine, do not touch it

On the one real device class actually available (high-end Android), the app sustains 59.9 fps
average / 59.5 fps min across rotate, zoom, all six animations, blink, a combined
Dance+expression+panel-open load, and 5.7 minutes of continuous stress — with zero FPS
degradation across 50 randomizes and 90 additional stress interactions, zero memory growth, and
zero thermal throttling. Every FPS number is vsync-capped at the display's 60 Hz ceiling, meaning
this device shows no measured performance problem to fix. Per the explicit instruction not to
switch to the `game_engine` rig just because it has fewer bones: there is no real-measurement
justification here to do so, and switching would trade a working, verified rig for unnecessary
visual/technical risk on the one tier that's actually confirmed to work well.

**What Case A does *not* claim:** this validates only the high-end tier. Low/Mid remain genuinely
unknown — not assumed fine, not assumed broken. Recommendation: proceed to Phase 7 (the app is
comfortably performant on the hardware tested, and backend work is orthogonal to client rendering
performance), but flag real low/mid-tier device validation as a follow-up to run whenever such
hardware becomes available, before treating "adequate performance" as validated across the full
target device range CLAUDE.md describes.
