# Developer Platform — Phase 8

Builds directly on `docs/api-platform.md` (Phase 7) — nothing there was redesigned, only extended.
Every claim below was verified: `dotnet test` (34/34 passing against real PostgreSQL and, for the
render/export tests, a real Blender subprocess), manual `curl` sessions covering every new
endpoint, and a real-browser Playwright pass through the actual dashboard UI (register → login →
create project → create API key → verify the key is never shown again after reload).

See `docs/export-pipeline.md` for the render/export implementation specifically — this document
covers the rest of Phase 8.

## 1. Authentication — two schemes, never mixed

CLAUDE.md was explicit: don't confuse dashboard auth with API auth. So:

| | Dashboard | Developer API |
|---|---|---|
| Mechanism | Secure HTTP-only cookie session | `X-API-Key` header |
| Scheme name | `Cookies` | `ApiKey` |
| Issued by | `POST /api/v1/auth/login` | `POST /api/v1/projects/{id}/api-keys` |
| Used for | Project/key management, usage, avatar ownership views | Assets, Avatars, Render, Export |

No JWT (CLAUDE.md section 2 explicitly said not to use one for the browser session). Password
hashing is PBKDF2-SHA256, 210,000 iterations (OWASP's 2023 minimum recommendation), salted
per-user, framework-only (`System.Security.Cryptography`, no new dependency) — mirrors the
SHA-256 approach already used for API key hashing rather than pulling in ASP.NET Core Identity's
full membership system for what's a two-function need (hash, verify).

Cookie config: `HttpOnly`, `SameSite=Lax`, `Secure` required outside Development. Unauthenticated
dashboard requests get a real `401`/`403` JSON response — not a redirect to a login page that
doesn't exist on this host (the default cookie-auth behavior, explicitly overridden).

Verified: register → login → `/auth/me` round-trips the same user; wrong password → `401`;
duplicate email → `409`; short password → `400`; logout actually expires the cookie
(`Set-Cookie: ...=; expires=Thu, 01 Jan 1970...`, confirmed via a real HTTP response inspection,
re-verified after an earlier test gave a false negative from not properly capturing the
Set-Cookie header — the server was correct the whole time).

## 2. Dashboard (`/dashboard`)

Real Next.js pages, not mockups — `/dashboard/login`, `/dashboard/register`, `/dashboard` (home:
create + list projects), `/dashboard/projects/[id]` (rename/delete, API keys, usage, avatars).
Screenshotted in a real Chromium session mid-flow: register → land on dashboard → create a
project → open it → create an API key → see the plaintext key once → reload → key shows only its
prefix, never the secret again.

Talks to the API via `src/features/dashboard/api/client.ts`, `credentials: "include"` on every
call so the session cookie crosses the dev-mode port boundary (3000 → 5080).

## 3. Project management

New beyond Phase 7's create/read: `GET /projects` (list mine), `PUT /projects/{id}` (rename),
`DELETE /projects/{id}` — all cookie-authenticated, all ownership-checked (`project.UserId` must
equal the session's user id, or `403`). Verified: a second registered user gets `403` trying to
rename or delete someone else's project; delete-then-get returns `404`; calling these without a
cookie at all returns `401`.

Create, get-by-id and API key creation are session-authenticated and owner-only too; the owner of
a new project is always the signed-in user (an earlier unauthenticated, `userId`-in-the-body
version let anyone create projects in — and mint keys for — other people's accounts).

## 4. API key management

New: `GET /projects/{id}/api-keys` (list — prefixes only, verified the plaintext never appears in
the response body via an integration test asserting `DoesNotContain`), `DELETE
/projects/{id}/api-keys/{keyId}` (revoke). A revoked key is rejected on its **very next** use —
verified end-to-end: create key → use it successfully → revoke it → same key now gets `401`.

## 5. Avatar ownership — closing a real Phase 7 gap

Phase 7's docs flagged this explicitly: *"Avatars created via API key aren't linked to a Project
yet."* Fixed this phase via a new `Avatar.OwnerProjectId`, set from the authenticating key's
`ProjectId` at creation time.

This unlocks real authorization on every avatar endpoint (`GET`/`PUT`/`DELETE`/render/export),
now accepting **either** scheme:

- **Via API key**: allowed if the avatar has no project (legacy data) or belongs to *this key's*
  project — a different project's key now gets a real `403`, verified with two independently
  created keys.
- **Via dashboard cookie**: allowed if the avatar's project belongs to the logged-in user —
  verified both the positive case (owner can view/rename/delete) and negative case (a second
  user gets `403`).

`GET /projects/{id}/avatars` is the dashboard's "my avatars" view (ownership-checked, same
pattern as usage below). `GET /avatars` (the flat list) is now scoped to the calling key's own
project — previously it listed every avatar in the system regardless of caller, a real security
gap silently closed alongside the ownership work above, not just documented.

## 6. Public avatars

`GET /api/v1/avatars/public/{id}` — unauthenticated, returns `404` for anything not explicitly
`Visibility: Public`, and the success response deliberately omits `ownerProjectId` (verified via
`TryGetProperty` returning false) so no ownership information leaks through the public surface.

## 7. Usage — real aggregates, not mock data

`GET /projects/{id}/usage` (cookie-auth, ownership-checked) computes, from the same
`ApiUsageEvent` table Phase 7 already populated: requests today, requests this month,
successful/failed counts, render count, export count, and the 20 most recent calls. The dashboard
renders these numbers directly — a fresh project genuinely shows all zeros in the screenshot
above, not placeholder data.

**Bug found and fixed while building this**: the original middleware ordering let a thrown
`ApiException` (e.g. the `400`/`501` cases) unwind past `UsageTrackingMiddleware`'s post-`next()`
code entirely, so failed calls went completely unrecorded — confirmed by querying the usage table
directly and finding the failing test calls missing. Fixed by reordering
`ExceptionHandlingMiddleware` to run *inside* `UsageTrackingMiddleware` (closer to the
controllers), so a thrown exception is already a real status code by the time tracking reads it.
Re-verified via direct SQL query showing the previously-missing rows present after the fix.

## 8. API documentation (`/docs`)

A real page, not generated Swagger JSON dumped into a template — Getting Started (a genuine
5-step curl + fetch walkthrough using endpoints that actually work), Authentication, Projects,
API Keys, Assets, Avatars, Compatibility, Errors, Rate Limits, Usage, Export & Render. Every
endpoint shown is real; render/export are explicitly described as running a real headless Blender
pipeline, not glossed over as a black box.

## 9. CORS — configuration-driven, fails closed

`Cors:AllowedOrigins` (appsettings) / `API_ALLOWED_ORIGINS` (env var, takes precedence) — a
comma-separated allow-list, never a wildcard. If unset, the policy is configured with an
unreachable placeholder origin rather than `AllowAnyOrigin()`, so a misconfigured production
deployment fails closed (rejects all cross-origin calls) instead of silently allowing everything.

Verified: an `OPTIONS` preflight from `http://localhost:3000` (the configured dev origin) gets
`Access-Control-Allow-Origin: http://localhost:3000`; the identical preflight from
`http://evil.example.com` gets **no** CORS headers at all — the browser blocks it.

## 10. Production configuration

`appsettings.Production.json` is intentionally near-empty — no connection string, no CORS
origins, no Blender paths. ASP.NET Core's standard configuration chain
(`appsettings.json` → `appsettings.{Environment}.json` → environment variables) means these must
be supplied as real environment variables in production:

| Variable | Purpose |
|---|---|
| `ConnectionStrings__Default` | PostgreSQL connection string |
| `API_ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |
| `Blender__BlenderExecutablePath` | Path to `blender.exe`/`blender` on the deployment host |
| `Blender__AssembleScriptPath` | Path to `tools/blender-pipeline/assemble_avatar.py` |
| `Blender__ServerAssetsRoot` | Path to the regenerated `server-assets/` directory |

Nothing in source control contains a real secret — the dev connection string lives in
`dotnet user-secrets`, not `appsettings.Development.json`.

## 11. Security checklist (delta from Phase 7)

| Item | Status |
|---|---|
| Password hashing | PBKDF2-SHA256, 210k iterations, salted — verified no plaintext/reversible storage |
| Session cookie | HttpOnly, SameSite=Lax, Secure outside dev |
| Avatar ownership | Real, enforced both auth schemes — closes the Phase 7-documented gap |
| CORS | Configuration-driven, fails closed, verified both allow and deny cases |
| Render/export path safety | No shell, no caller-supplied paths, dimension bounds, timeout + cleanup — see `docs/export-pipeline.md` |
| Secrets in source control | None — connection string in user-secrets, prod values via env vars |

## 12. Testing

34 integration tests, all against real infrastructure (`WebApplicationFactory<Program>` + real
PostgreSQL `avatarforge_test` database + a real Blender subprocess for the render/export cases —
nothing mocked):

- `ApiKeyAuthTests` (3), `AssetCatalogTests` (4), `AvatarCrudTests` (4) — Phase 7, still passing
- `RenderExportTests` (3) — **rewritten this phase**: previously asserted `501`, now assert a real
  downloadable PNG/GLB with correct magic bytes, plus the absurd-dimensions rejection
- `RateLimitTests` (1) — Phase 7, still passing
- `DashboardAuthTests` (5) — register/login/me, wrong password, duplicate email, short password, logout
- `ProjectManagementTests` (5) — list-mine, rename, cross-user 403, delete-then-404, auth-required
- `ApiKeyRevokeTests` (2) — revoked key rejected, key list never exposes the secret
- `AvatarOwnershipTests` (4) — project linkage, dashboard owner access, cross-key 403, public visibility
- `CorsTests` (2) — allowed and disallowed origins

One test bug was found and fixed during this phase (not a server bug): a reused, already-logged-in
`HttpClient` made an "unauthenticated request" test pass for the wrong reason —
`WebApplicationFactory.CreateClient()` persists cookies by default, which wasn't the assumption
the other tests were written under (they manually thread cookie strings, which remains correct,
just redundant for same-client calls). Fixed by using a genuinely fresh client for that one case.

## 13. Known limitations

- **No email verification, no password reset.** Registration is instant and unverified — fine for
  a developer dashboard MVP, would need addressing before handling real customer accounts.
- **No pagination on the dashboard's project/key/avatar lists** — fine at current scale, will need
  it once a real user accumulates dozens of projects.
- **No audit log of who revoked what** — `RevokedAt` is stored on the key itself, but there's no
  separate audit trail.
- **Render/export limitations** — see `docs/export-pipeline.md`'s own Known Limitations section
  (no process pooling, camera/lighting is a first pass, manual `server-assets/` regeneration).
- **Billing/subscriptions/SDKs** — explicitly out of scope this phase per CLAUDE.md sections 20–21.

## 14. Acceptance flow — verified end-to-end

```
Register → Login → Dashboard → Create Project → Create API Key
  → API documentation (/docs) → Call Assets API → Create Avatar
  → Open Avatar → Export PNG → Export GLB
```

Every step above was actually run, not assumed: the dashboard flow via a real Playwright browser
session (screenshots retained), the API-key flow via `curl` against a running instance, render and
export producing real, byte-verified downloadable files. Phase 7's 501 placeholders are gone —
replaced with a genuine, tested, security-reviewed implementation.

## 15. Gaps found on a follow-up self-review, and closed

Asked directly whether anything was missing, a section-by-section re-read against this document's
own spec turned up real gaps — not invented ones, and not brushed past as "future work":

- **Dashboard "Avatar count"/"Asset count"** (§3) were computed but never surfaced. Added as stat
  tiles on the dashboard home page — asset count is a real query against `GET /assets` (which
  required extending `AssetsController` to accept a dashboard cookie session as well as an API
  key, read-only, not usage-tracked since it isn't tied to a project's key).
- **Avatar rename/delete from the dashboard** (§18) existed on the backend (already
  ownership-checked) but had no UI. Added inline rename and a delete button to each avatar card,
  verified in a real browser (renamed, then deleted, confirmed gone).
- **"Open in Creator" link** (§18) — added `/create?avatarId=...`, which fetches that avatar's
  saved configuration and loads it into the existing editor via its existing `loadConfig` action.
  Verified visually: hair, clothing, and colors all matched the saved configuration exactly.
- **`/avatar/{publicId}`** (§19) — the backend endpoint existed; the actual page didn't. Built
  `/avatar/[id]`, reusing the existing `AvatarViewer`/`AnimationBar` components in a read-only
  shell, with a real "not available" state for private/nonexistent ids. Verified both states.
- **Usage-tracking operation names** — render/export were tagged `render.png`/`export.glb`;
  renamed to `avatar.render`/`avatar.export` to match this document's own naming exactly.
- **Missing failure-path tests** (§22: invalid avatar, Blender failure, timeout, cleanup) — added
  `RenderFailureTests.cs`: a nonexistent avatar id returns `404` (not `500`); a broken Blender
  script path produces a real `500 RENDER_FAILED`; an artificially tiny timeout produces a real
  `504 RENDER_TIMEOUT` (the process is genuinely killed, not simulated); and a render's temp
  directory count is asserted unchanged before/after, confirming cleanup actually runs.

**A real regression was caught and fixed while closing these**: extending `AssetsController` to
accept a dashboard cookie (for the asset-count tile) made one existing test
(`Revoked_key_is_rejected_on_its_next_use`) fail — not because revocation broke, but because the
test reused one `HttpClient` for both a dashboard login and an "API-key-only" check, and
`WebApplicationFactory`'s client persists cookies by default. The lingering session cookie let the
"revoked key" request succeed via the *cookie* path even though the key itself was correctly
rejected — confirmed with a direct `curl` reproduction (no cookie involved) showing the revoked key
alone genuinely gets `401`. Fixed by giving that test two separate clients, matching what a real
external API consumer (no dashboard session) actually looks like. All 38 tests pass after the fix.

**One thing deliberately left alone** *(closed in Phase 9 — see [`web-creator.md`](web-creator.md): the creator now saves to the account through the Avatar API)*: the web creator (`/create`)'s own Save/Load button still
writes to browser localStorage only, unconnected to the backend Avatar API. Avatars that show up
in the dashboard are ones created *through the API* (matching this phase's own acceptance flow,
built for external apps/games integrating via a key) — not ones a visitor saves in the reference
web client. Bridging those two would mean reworking an already-shipped, already-tested save flow
from earlier phases for a use case this phase didn't actually ask for; noted here as a real,
deliberate scope boundary rather than silently ignored.
