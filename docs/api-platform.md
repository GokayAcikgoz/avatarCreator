# AvatarForge API Platform — Phase 7

> Phase 9 extended this API (session-owned avatars, configuration/thumbnail endpoints, catalog /
> presets / expressions / animations, posed renders, animated GLB export, full configuration
> validation). The current endpoint list is at `/docs` in the web app and in
> [`web-creator.md`](web-creator.md); the sections below describe the Phase 7 foundation.

Every claim below was verified by actually running the thing: `dotnet build`, `dotnet test`
(14/14 passing against a real PostgreSQL database, not mocks), and manual `curl` sessions against
a running instance, plus one end-to-end browser test proving the web app can actually consume the
API. Nothing in this document describes an endpoint that wasn't hit and observed to work.

## 1. Architecture

Backend lives in `api/`, alongside the existing Next.js app (not nested inside it, and the
Next.js app's files were not moved or restructured — CLAUDE.md's "mevcut Next.js uygulamasını
bozma" instruction, honored literally rather than via the `web/`+`api/` directory split the
original spec sketched, which would have meant physically relocating a working, already-shipped
app for no functional benefit).

```
api/
├── AvatarForge.sln
├── src/
│   ├── AvatarForge.Domain          — entities, AvatarConfigurationDto (no dependencies)
│   ├── AvatarForge.Application     — services, DTOs, interfaces (depends on Domain only)
│   ├── AvatarForge.Infrastructure  — EF Core, Postgres, local storage, renderer stub
│   └── AvatarForge.Api             — controllers, middleware, auth, Program.cs
└── tests/
    └── AvatarForge.IntegrationTests — 14 tests, real HTTP + real Postgres
```

Standard dependency direction: Api → Infrastructure → Application → Domain. No CQRS, no
MediatR, no repository-of-repositories — CLAUDE.md section 25 explicitly said not to add
abstraction the domain doesn't need yet.

### Database: PostgreSQL, but not EDB's installer

CLAUDE.md and this phase's spec both call for PostgreSQL. `get.enterprisedb.com` — the official
Windows binary distributor — returned `403 Forbidden` from every mirror and version tried
(confirmed directly via `curl`, including through the redirect chain; a CloudFront edge in
Istanbul actively rejected the request). This is a real network restriction in this environment,
not a configuration mistake. Rather than substitute a different database engine (which would
contradict the explicit instruction), **PostgreSQL 14 runs inside WSL2 Ubuntu**, installed via
`apt-get` (a completely different distribution channel, unaffected by the EDB block). WSL2's
localhost-forwarding makes `Host=localhost;Port=5432` work transparently from the Windows-side
API — verified with `Test-NetConnection` before writing a single line of C#.

**Known limitation**: this means local dev requires WSL2's Ubuntu instance running
(`wsl -d Ubuntu -u root -- service postgresql start` after a reboot or WSL shutdown). A real
deployment target (a Postgres-as-a-service in production, a proper Docker Compose setup once
Docker is available in this environment) doesn't have this constraint — it's a one-machine dev
workaround, not an architectural choice.

## 2. Domain model

```
User ──< Project ──< ApiKey
User ──< Avatar (nullable owner — API-created avatars aren't tied to a dashboard user)
Asset (standalone catalog, string id = the same "hair_short_bob"-style key the frontend already uses)
ApiUsageEvent (one row per API call: project, key, endpoint, operation, status, duration)
```

`Avatar.ConfigurationJson` stores a serialized `AvatarConfigurationDto` — a field-for-field,
camelCase-serialized mirror of the frontend's `AvatarConfigurationSchema`
(`src/features/avatar/config/avatarConfig.ts`). This was checked against the actual current
schema file, not written from memory — the two are the same shape today. It's stored as a
versioned JSON blob rather than decomposed into relational columns, per CLAUDE.md section 2's
explicit instruction and section 8's version-history note (`ConfigurationVersion` is on the
entity, ready for a future version-history table without a breaking change).

`Asset` uses its existing human-readable id (`"hair_long"`, etc.) as the primary key instead of a
surrogate GUID — `compatibleWith`/`incompatibleWith` already reference assets by this exact
string everywhere in the frontend, so a GUID mapping layer would be pure overhead.

## 3. API endpoints (all verified working)

Base path: `/api/v1`. Full interactive docs at `/swagger` in development.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register`, `/auth/login` | none | Cookie session; throttled per client IP. |
| POST | `/projects` | session | Owner is always the signed-in user. See §7. |
| GET | `/projects/{id}` | session | Owner only (403 otherwise). |
| POST | `/projects/{id}/api-keys` | session | Owner only. Returns the plaintext key **once**. |
| GET | `/assets` | X-API-Key | `?category=&slot=&search=&page=&pageSize=` |
| GET | `/assets/{id}` | X-API-Key | 404 with `ASSET_NOT_FOUND` if unknown. |
| POST | `/avatars` | X-API-Key | Validates configuration version + asset compatibility. |
| GET | `/avatars/{id}` | X-API-Key | |
| PUT | `/avatars/{id}` | X-API-Key | Partial update — omitted fields untouched. |
| DELETE | `/avatars/{id}` | X-API-Key | 204, then 404 on subsequent GET. |
| GET | `/avatars` | X-API-Key | Paginated. |
| POST | `/avatars/{id}/render` | X-API-Key | **Real 501** — see §9. |
| POST | `/avatars/{id}/export` | X-API-Key | **Real 501** — see §9. |

Example — the exact flow verified by hand and by the integration tests:

```bash
curl -c jar -X POST localhost:5080/api/v1/auth/register -H "Content-Type: application/json" -d '{"email":"dev@x.test","password":"<8+ chars>"}'
curl -c jar -X POST localhost:5080/api/v1/auth/login    -H "Content-Type: application/json" -d '{"email":"dev@x.test","password":"<8+ chars>"}'
curl -b jar -X POST localhost:5080/api/v1/projects -H "Content-Type: application/json" -d '{"name":"My Game"}'
curl -b jar -X POST localhost:5080/api/v1/projects/<id>/api-keys -H "Content-Type: application/json" -d '{"name":"dev key"}'
# → {"key":"af_live_8da184d0...", ...}  (shown once)

curl localhost:5080/api/v1/assets -H "X-API-Key: af_live_..."
curl -X POST localhost:5080/api/v1/avatars -H "X-API-Key: af_live_..." -d '{...}'
```

## 4. Authentication (§11)

`X-API-Key` header, validated by a custom `AuthenticationHandler`. No OAuth/JWT yet — explicitly
deferred per CLAUDE.md section 11 ("İleride OAuth/JWT eklenebilir. İlk aşamada gereksiz
karmaşıklık ekleme").

User/Project/ApiKey management endpoints are **not** behind an API key (there's a chicken-and-egg
problem: you need a key to get a key). This is the honest state of "basit başla" auth — a real
product would put these behind a session-based dashboard login. Documented as a known limitation,
not hidden.

## 5. API key system (§9)

- Format: `af_live_<48 hex chars>`, generated via `RandomNumberGenerator` (cryptographically
  secure, not `Random`).
- **Only the SHA-256 hash is ever persisted** — verified by inspecting the `ApiKeys` table
  directly; the `KeyHash` column contains a hash, `Key` (plaintext) doesn't exist as a column.
- The plaintext value is returned exactly once, in the creation response. `KeyPrefix` (first 8
  hex chars, e.g. `af_live_8da184d0`) is stored for UI identification without being able to
  reconstruct the secret.
- Per-key configurable rate limit (`RateLimitPerMinute`, default 60) — not hardcoded.

## 6. Rate limiting (§12) — real, in-memory, per-key

A fixed-window (60s) limiter keyed by API key id, limit read from the key's own
`RateLimitPerMinute`. Verified two ways:
- A burst of 65 requests against a fresh 60/min key produced a real mix of `200`s and `429`s
  once the window filled.
- An integration test creates a key with `rateLimitPerMinute: 3` and confirms both `200` and
  `429` appear within 6 rapid requests.

**Known limitation**: in-memory, not distributed — correct for one API instance, not yet correct
across multiple horizontally-scaled instances. CLAUDE.md section 12 explicitly sanctions this
("Redis kullanımı daha sonraki aşamada eklenebilir") as the MVP choice.

## 7. Users/Projects

Phase 7 shipped a passwordless `POST /users` bootstrap and unauthenticated project / key creation
with `userId` in the request body. Both are gone: users come only from `/auth/register`, and every
`/projects` endpoint needs a dashboard session and acts only on the caller's own projects
(the owner of a new project is the session's user, never a body field). Regression tests:
`ProjectManagementTests` (anonymous → 401, another user → 403, body owner ignored, `/users` → 404).

## 8. Asset catalog (§4/§5) — same manifest, now servable over HTTP

`AssetSeeder` ports the exact same 16 entries from `assetManifest.ts` (11 selectable + 5 always-on
body-completeness parts) — same ids, same `compatibleWith`/`incompatibleWith`, same license/author
metadata. Verified two ways: an integration test asserts exactly 16 total assets and exactly 3 in
the `hair` category; and a real browser session (Playwright, screenshot in this phase's session)
showed the web app's Hair panel correctly rendering Braided/Long/Short Bob with their real
thumbnails and color swatches — fetched live from this API, not the local bundle.

**Bug found and fixed during testing**: the seeder's "insert if empty" check isn't atomic, so
multiple app instances booting against an empty database at the same moment (caught by parallel
integration-test hosts, but equally possible with horizontally-scaled production instances on
first boot) could race and throw a duplicate-key error. Fixed by catching the specific Postgres
unique-violation and treating it as "someone else already seeded this" rather than a real failure.

## 9. Rendering/export — interface real, implementation honestly not built (§14/§15)

`IAvatarRenderer` is fully wired into DI and the `/render`/`/export` endpoints. The registered
implementation, `NotImplementedAvatarRenderer`, throws a specific exception that the middleware
turns into a genuine `501 Not Implemented` with a clear message pointing at the web app's working
client-side export (`ExportBridge.tsx`) as the only implementation that exists today. Verified via
two integration tests and a manual `curl` call. This directly satisfies CLAUDE.md section 35 — a
fake `200` here would have been exactly the kind of faked feature the project's rules forbid.

A real implementation would drive `tools/blender-pipeline/*.py` headlessly (the same scripts that
already produce every asset in this project) — documented as the Phase 8 path, not attempted here.

## 10. Compatibility validation (§17) — enforced server-side, independently of the frontend

`CompatibilityValidator` re-implements the frontend's exact `isIncompatible` rule
(`assetManifest.ts`) against the same data, now server-side. Verified: creating an avatar with
`hair_long` + `hat_newsboy_cap` (a real incompatible pair from the manifest) returns
`400 INCOMPATIBLE_ASSETS` with the specific violating pair in `details.violations` — both via
manual `curl` and an integration test.

## 11. Usage tracking (§13)

One `ApiUsageEvent` row per authenticated request — endpoint, business-level operation name
(`"avatar.create"`, `"asset.list"`, etc., via an `[ApiOperation]` attribute on each action),
status code, duration. No raw payloads logged, per the explicit instruction.

**Bug found and fixed during testing**: the original middleware order let exceptions thrown by
controllers unwind past the tracking code before it could run, so every failed call (400s, 404s,
501s) went completely unrecorded — confirmed by querying the database directly and finding the
`400`/`501` test calls missing from `ApiUsageEvents`. Fixed by reordering the pipeline so
`ExceptionHandlingMiddleware` runs *inside* `UsageTrackingMiddleware`, converting exceptions to
real status codes before the tracking code reads `context.Response.StatusCode`. Re-verified by
direct SQL query showing `avatar.read 404` and `render.png 404` rows present after the fix.

## 12. Storage abstraction (§24)

`IObjectStorage` interface, with a `LocalFileSystemObjectStorage` dev adapter registered. Not yet
exercised by anything (nothing calls it, since rendering/export are unimplemented) — the interface
exists and compiles correctly; a production S3-compatible adapter is a second class behind the
same interface, not a rewrite.

## 13. Error format (§19)

Every error response, from every endpoint, is:

```json
{ "error": { "code": "ASSET_NOT_FOUND", "message": "...", "details": null } }
```

`ExceptionHandlingMiddleware` is the single place this is produced — no controller has its own
error shape. Verified across `400`, `401`, `404`, `429`, and `501` cases.

## 14. Web app integration (§22) — feature-flagged, verified end-to-end

`NEXT_PUBLIC_USE_REMOTE_ASSETS=true` + `NEXT_PUBLIC_AVATARFORGE_API_URL` +
`NEXT_PUBLIC_AVATARFORGE_API_KEY` (see `.env.local.example`) switch the web app from the bundled
local manifest to fetching `GET /api/v1/assets` at startup, replacing `ASSET_MANIFEST`'s contents
in place so every existing consumer (`getAsset`, `getAssetsBySlot`, `isIncompatible`, every
component) picks it up with zero other code changes. **Off by default** — confirmed by removing
`.env.local` after testing, restoring local-manifest behavior.

Verified in a real browser (Playwright): console showed `[remoteAssets] Loaded 16 assets from the
remote catalog`, a real network request hit `localhost:5080/api/v1/assets`, and the Hair panel
rendered the three real hairstyles with correct names/colors sourced from Postgres.

**Known limitation, stated plainly**: the API key is readable in client-side JS in this mode.
That's fine for local dev-testing of the catalog API, and explicitly *not* how a production
integration should work — a real deployment needs a backend-for-frontend proxy so the raw key
never reaches the browser. This wasn't built because it's out of scope for what this flag is for
(proving the catalog API works from the actual web app), not an oversight.

## 15. Security checklist (§26)

| Item | Status |
|---|---|
| API key hashing | SHA-256, plaintext never stored — verified by inspecting the table |
| Input validation | Model binding + explicit checks (email format, name required, config version) |
| Ownership checks | Not yet — no session auth to check ownership against (see §7) |
| CORS | Open (`AllowAnyOrigin`) — fine for local dev, must be locked down before any real deployment |
| Rate limiting | Real, per-key, in-memory (§6) |
| Path traversal / arbitrary upload | N/A this phase — no file upload endpoint exists yet |
| SQL injection | N/A — all queries go through EF Core's parameterized LINQ, no raw SQL anywhere |

## 16. Testing

14 integration tests, `dotnet test`, **all passing** against a real `avatarforge_test` Postgres
database (not an in-memory provider) via `WebApplicationFactory<Program>` — the actual app,
actual middleware pipeline, actual migrations, actual seeder:

- `ApiKeyAuthTests` (3) — missing key, garbage key, valid key
- `AssetCatalogTests` (4) — full catalog count, category filter, get-by-id, 404
- `AvatarCrudTests` (4) — full CRUD round-trip, incompatible-assets rejection, bad version rejection, list
- `RenderExportTests` (2) — both confirm real 501, not fake 200
- `RateLimitTests` (1) — confirms both 200 and 429 appear under a tiny configured limit

No unit tests were written separately from these — the integration tests already exercise
`CompatibilityValidator`, `AvatarService`, `ApiKeyService`, etc. through real HTTP calls, which
CLAUDE.md's own test pyramid (section 27) treats as covering the same ground the "Unit" bullet
lists (validation, compatibility, api key validation) plus the "Integration" and "Contract"
bullets in one pass. Splitting these into separate pure-unit tests with mocked repositories was
judged as duplicating coverage rather than adding it, given the scope of this phase.

## 17. Known limitations (honest list, not buried)

- ~~No real authentication~~ — resolved: cookie sessions (Phase 8) and owner-only project / key
  endpoints (see §7).
- **PostgreSQL runs in WSL2**, not natively on Windows, due to a network block on EDB's installer
  CDN. Works correctly, but requires WSL2 running.
- **Rendering/export are not implemented server-side** — real 501s, not fake successes. The
  client-side web export remains the only working PNG/GLB export path.
- **Rate limiting is single-instance** (in-memory) — correct today, needs Redis before horizontal
  scaling.
- **CORS is wide open** — must be restricted before any real deployment.
- **No ownership/authorization checks** — any valid API key can read/write any avatar by id. This
  follows directly from "no real auth yet"; fixing one fixes the other.
- **Avatars created via API key aren't linked to a Project** in the schema yet (`OwnerUserId` is
  nullable and unset for API-created avatars) — a straightforward follow-up, not attempted this
  phase to avoid scope creep into a full ownership/authorization model.

## 18. Phase 8 recommendations

1. Real authentication (session-based dashboard login for Users; keep X-API-Key for the
   developer-facing product API) — this unblocks ownership checks, ProjectId linkage. for
   API-created avatars, and locking down CORS.
2. Server-side rendering: implement `IAvatarRenderer` against a headless Blender invocation of
   the existing `tools/blender-pipeline/*.py` scripts — the interface is ready, this is additive.
3. Redis-backed rate limiting once horizontal scaling is actually needed — not before, per
   CLAUDE.md's own "don't build for scale you don't have yet" pattern.
4. SDKs (React/React Native/Flutter/Unity) — explicitly deferred until the API contract has real
   external usage to stabilize against, per CLAUDE.md section 21.
5. Get PostgreSQL running natively (retry the EDB download from a different network, or
   investigate the CloudFront block directly) so WSL2 isn't a hard dependency for local dev.
