# Export Pipeline — Phase 8

Every claim below was verified by actually running the pipeline: real `curl` calls against a
running API, real Blender subprocess invocations, real downloaded files inspected byte-for-byte
(PNG magic bytes + alpha channel, glTF magic bytes + mesh/material/skin counts), and 3 automated
integration tests that do the same thing on every `dotnet test` run.

## The problem Phase 7 left open

Phase 7's `/render` and `/export` endpoints returned a real `501 Not Implemented` — a deliberate,
honest placeholder (CLAUDE.md section 35 forbids a fake `200`). Phase 8's job was to replace that
with a genuine implementation, reusing the existing MakeHuman → Blender → GLB pipeline rather than
inventing a new one.

## Why a new intermediate asset copy was needed

The production GLBs in `public/models/` are meshopt-compressed (Phase 6's optimization — real,
correct for the browser). Blender 4.5's stock glTF importer here does not support
`EXT_meshopt_compression`:

```
RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version
```

Rather than touch the production asset pipeline, `.pipeline-tools/decompress_for_blender.mjs`
produces a parallel, Blender-importable copy at `api/server-assets/` using the exact same
`gltf-transform` toolchain already installed for Phase 5/6's compression work — reading each
compressed GLB and disposing its `EXTMeshoptCompression` extension before re-writing, which
strips compression while keeping geometry, materials, shape keys, and skins byte-identical in
substance. Confirmed by re-importing the result into Blender and finding all 74 shape keys
(structural + ARKit) and all 163 bones present with their exact original names.

**`api/server-assets/` is gitignored, not committed** — it's fully reproducible from
`public/models/` any time:

```bash
cd .pipeline-tools
node decompress_for_blender.mjs
```

Run this once after cloning the repo, or whenever `public/models/` changes, before the API can
serve real renders/exports.

## Architecture

```
AvatarConfiguration (from the DB)
        ↓
AssetResolver (Application/Infrastructure)  — config → real file paths under server-assets/
        ↓
BlenderAvatarRenderer (Infrastructure)       — writes a JSON job file, runs Blender headless
        ↓
tools/blender-pipeline/assemble_avatar.py    — imports body + attachments, applies morphs/colors,
                                                exports GLB or renders PNG
        ↓
IObjectStorage (LocalFileSystemObjectStorage) — saves the output, returns a download URL
```

`IAvatarRenderer` (the interface, unchanged from Phase 7) is now backed by
`BlenderAvatarRenderer` instead of `NotImplementedAvatarRenderer`. Nothing above it — the
controllers, the DTOs, the API contract — changed at all.

### AssetResolver

Maps an `AvatarConfigurationDto` to real files:

- Body: hardcoded `avatar-base-poc.glb` (not a selectable asset, always present).
- Hair/top/bottom/shoes/accessories: looked up by id in the same `Assets` table the `/assets` API
  serves, `ModelUrl` (`/models/attachments/x.glb`) remapped to `server-assets/attachments/x.glb`.
- Always-on body-completeness parts (eyes/eyebrows/eyelashes/teeth/tongue) — same 5 ids as the
  frontend's `ALWAYS_ON_ASSET_IDS`.
- Shape keys: `AvatarConfiguration.Face.Morphs` merged with the resolved expression preset's
  ARKit weights (`ExpressionPresets.cs`, a byte-for-byte C# port of `expressions.ts`) — the exact
  same combined set the web viewer's `useFaceMorphDriver` applies.

Every resolved path is re-verified to still resolve inside `ServerAssetsRoot` before being handed
to the subprocess (`Path.GetFullPath` + prefix check) — defense in depth per CLAUDE.md section 15,
even though nothing here ever touches a caller-supplied path (only asset ids, looked up
server-side).

### assemble_avatar.py

One script, two operations, driven entirely by a JSON job file (never command-line string
concatenation — see Security below):

- **export**: imports body + all attachments, applies shape keys, selects everything, exports one
  merged GLB.
- **render**: same import/apply step, then sets up a camera (re-tuned for a square 1:1 output —
  the web viewer's own `[0,0.95,6.5]`/fov 30 was tuned for its wider canvas and left too much
  empty space in a square render) and a 3-light key/fill/rim setup, renders to PNG.

Color tinting inserts a Multiply node between each material's texture and its Principled BSDF
Base Color input — mirroring `AttachmentPart.tsx`'s texture-tint approach rather than replacing
the texture outright. A stray `Icosphere` helper object (present in every authored export from
the asset pipeline) is stripped on import.

Verified output, both operations:

| Test | Result |
|---|---|
| Export (9 attachments incl. all 5 body-completeness parts) | Valid GLB: 10 meshes, 9 materials, 10 skins, glTF magic header correct |
| Render (1024×1024, transparent) | Valid RGBA PNG; corner pixel `(0,0,0,0)`, avatar pixel opaque with correct tinted color |
| Render through the full API (not just the script directly) | `curl` → `{"status":"completed","url":"/storage/renders/....png"}` → downloaded → same checks pass |

## Security (CLAUDE.md section 15)

- **No shell involved**: `Process.Start` uses `ArgumentList`, never a concatenated command string
  — nothing a filename or config value could contain is ever interpreted as a shell metacharacter.
- **No caller-supplied paths reach the subprocess**: the job JSON's paths all come from
  `AssetResolver`, which only ever resolves server-known asset ids against `ServerAssetsRoot`
  (re-verified per-path, see above). The only thing genuinely from the caller is width/height and
  the avatar's own configuration (asset ids + numeric morph values), never a path.
- **Absurd render sizes rejected before Blender ever runs**: width/height bounded to
  `[64, 2048]` (configurable via `Blender:MinRenderDimension`/`MaxRenderDimension`) — a request for
  `50000×50000` gets a real `400 VALIDATION_FAILED`, verified via `curl` and an integration test.
- **Timeout + cleanup**: `TimeoutSeconds` (default 90) bounds the subprocess; on timeout the
  process tree is killed (`Process.Kill(entireProcessTree: true)`) and a `504 RENDER_TIMEOUT` is
  returned. Each request gets its own fresh temp directory (`%TEMP%/avatarforge-render/<guid>/`),
  deleted in a `finally` block regardless of success or failure.
- **stdout/stderr captured and logged** on any non-zero exit or missing `ASSEMBLE_OK` marker in
  stdout — a `500 RENDER_FAILED` is returned with the exit code; the actual Blender error goes to
  the server log, not the client response.

## Two real bugs found and fixed while wiring this up

1. **`/storage` 404'd on every download.** `app.UseStaticFiles()` with no options only serves
   `wwwroot` — a second `UseStaticFiles` registration with an explicit `PhysicalFileProvider`
   pointed at the storage root was needed. Found by literally trying to download a rendered file
   and getting a 404, not by inspection.
2. **`.glb` downloads 404'd even after fixing (1).** ASP.NET Core's static file middleware only
   serves recognized MIME types by default, and `.glb` isn't in the built-in map — added a
   `FileExtensionContentTypeProvider` mapping `.glb` → `model/gltf-binary`. Same discovery method:
   downloaded a real export, got a 404, checked the response, found the real cause.

## Performance (measured, not estimated)

| Operation | Observed time | Notes |
|---|---:|---|
| Render 1024×1024, 9 meshes, transparent | ~7.7s end-to-end via `curl` (Blender startup + import + light setup + 64-sample EEVEE render + save) | Cold Blender start dominates; a warm/pooled Blender process would be faster, not attempted this phase |
| Export (GLB, same 9 meshes) | Included in the same full-flow timing above | Export skips rendering entirely, so it's the faster of the two in isolation |

Synchronous (the request thread waits for Blender), per CLAUDE.md section 11's explicit MVP
allowance. The response model (`{"status":"completed","url":"..."}`) is already shaped for a
future `pending`/`processing`/`completed`/`failed` state machine — `BlenderAvatarRenderer` is the
only class that would need to change to move this to a background job queue.

## Known limitations

- **Single Blender process per request, no pooling/warm-start.** Each render pays Blender's full
  startup cost. A production deployment doing meaningful render volume should add a
  worker-pool/queue — architecture supports it (see above), not built this phase.
- **Camera/lighting are a first reasonable pass, not exhaustively tuned.** One correction pass was
  made (initial framing left too much empty space in the square output) and re-verified visually;
  further art-direction polish is possible but wasn't the point of this phase.
- **`server-assets/` must be regenerated manually** after any change to `public/models/` — not
  wired into the Blender asset-authoring pipeline's own scripts, to avoid touching
  `generate_attachments.py`/`generate_face_system.py` (CLAUDE.md's explicit "don't rewrite the
  existing pipeline" instruction).
- **No pooling of Blender processes across requests** and **Blender's install path is
  machine-specific config** (`Blender:BlenderExecutablePath` in appsettings) — a production
  deployment must set this to wherever Blender is actually installed on that host.
