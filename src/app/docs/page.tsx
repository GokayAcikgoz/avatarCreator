import type { Metadata } from "next";
import Link from "next/link";
import { ReactNode } from "react";

export const metadata: Metadata = { title: "API documentation" };

const API = (process.env.NEXT_PUBLIC_AVATARFORGE_API_URL ?? "http://localhost:5080").replace(/\/$/, "");

const SECTIONS: [string, string][] = [
  ["getting-started", "Getting started"],
  ["authentication", "Authentication"],
  ["configuration", "Avatar configuration"],
  ["avatars", "Avatars"],
  ["catalog", "Catalog & presets"],
  ["render", "Render & export"],
  ["animations", "Animation data"],
  ["validation", "Validation"],
  ["projects", "Projects & API keys"],
  ["usage", "Usage"],
  ["rate-limits", "Rate limits"],
  ["errors", "Errors"],
];

function Code({ children }: { children: string }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/50 p-4 font-mono text-[12.5px] leading-relaxed text-neutral-300">
      <code>{children}</code>
    </pre>
  );
}

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-300",
  POST: "bg-indigo-500/15 text-indigo-300",
  PUT: "bg-amber-500/15 text-amber-300",
  DELETE: "bg-rose-500/15 text-rose-300",
};

function Endpoint({ method, path, auth, children }: { method: string; path: string; auth: string; children?: ReactNode }) {
  return (
    <div className="border-t border-white/[0.06] py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${METHOD_STYLES[method]}`}>{method}</span>
        <span className="text-neutral-100">{path}</span>
        <span className="ml-auto rounded-full border border-white/10 px-2 py-0.5 font-sans text-[10.5px] text-neutral-400">{auth}</span>
      </div>
      {children && <div className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">{children}</div>}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-white/[0.06] py-12 first:border-t-0 first:pt-0">
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-white">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-neutral-400">{children}</div>
    </section>
  );
}

const C = ({ children }: { children: ReactNode }) => <code className="rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[12px] text-neutral-200">{children}</code>;

const CONFIG_EXAMPLE = `{
  "version": 1,
  "body": { "type": "athletic", "height": 0.62, "shoulderWidth": 0.72, "proportion": 0.55 },
  "face": {
    "shape": "square", "skinTone": "#8D5A3B", "eyeShape": "almond", "eyeColor": "#2B1B12",
    "eyebrows": "natural", "nose": "wide", "mouth": "full", "earShape": "standard",
    "morphs": { "chin-width-incr": 0.6, "nose-scale-horiz-incr": 0.55 },
    "expression": "neutral"
  },
  "hair": { "style": "hair_swept", "color": "#1B1210" },
  "facialHair": { "beardStyle": "beard_short", "mustacheStyle": "mustache_classic", "color": "#1B1210" },
  "clothing": {
    "top": "top_polo", "topColor": "#F5F5F5",
    "bottom": "bottom_wool_pants", "bottomColor": "#495057",
    "shoes": "shoes_ankle_boots", "shoesColor": "#6B4F3A"
  },
  "accessories": ["glasses_wayfarer"],
  "accessoryColors": {}
}`;

export default function DocsPage() {
  return (
    <div className="min-h-dvh bg-[#07080c] text-neutral-200">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#07080c]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-white">
            AvatarForge <span className="font-normal text-neutral-500">/ API</span>
          </Link>
          <nav className="ml-auto flex items-center gap-2 text-sm">
            <Link href="/create" className="rounded-lg px-3 py-1.5 text-neutral-300 hover:text-white">
              Creator
            </Link>
            <Link href="/dashboard" className="rounded-xl bg-white px-3.5 py-1.5 text-sm font-semibold text-[#0b0d12] hover:bg-neutral-200">
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-4 sm:px-6">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-52 shrink-0 overflow-y-auto py-10 lg:block">
          <nav className="flex flex-col gap-0.5 text-sm">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-lg px-3 py-1.5 text-neutral-400 transition hover:bg-white/[0.04] hover:text-white">
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 max-w-3xl flex-1 py-10">
          <h1 className="text-3xl font-semibold tracking-tight text-white">AvatarForge API <span className="text-lg font-normal text-neutral-500">v1</span></h1>
          <p className="mt-3 text-neutral-400">
            Base URL <C>{API}</C>. JSON in, JSON out. The web creator on this site is built entirely on these endpoints — nothing it does is private.
            Interactive OpenAPI (Swagger) is served at <C>/swagger</C> in development.
          </p>

          <div className="mt-10">
            <Section id="getting-started" title="Getting started">
              <p>
                Create an account and a project in the <Link href="/dashboard" className="text-indigo-300 hover:text-indigo-200">developer dashboard</Link>, generate an API key
                (shown once), then:
              </p>
              <Code>{`# Browse the catalog, presets and animations
curl ${API}/api/v1/assets?category=hair -H "X-API-Key: af_live_…"
curl ${API}/api/v1/presets
curl ${API}/api/v1/animations

# Create an avatar for one of your users (configuration: see below)
curl -X POST ${API}/api/v1/avatars \\
  -H "X-API-Key: af_live_…" -H "Content-Type: application/json" \\
  -d '{ "name": "Player 1", "configuration": { …AvatarConfiguration… } }'

# Render it: waving, portrait framing, transparent PNG
curl -X POST ${API}/api/v1/avatars/render \\
  -H "X-API-Key: af_live_…" -H "Content-Type: application/json" \\
  -d '{ "avatarId": "<id>", "animation": "wave", "time": 0.4, "camera": "portrait", "background": "transparent", "format": "png" }'
# → { "status": "completed", "url": "/storage/renders/….png", "format": "png" }

# Or a single-skeleton GLB with all ${""}animations embedded
curl -X POST ${API}/api/v1/avatars/<id>/export \\
  -H "X-API-Key: af_live_…" -H "Content-Type: application/json" -d '{ "format": "glb", "includeAnimations": true }'`}</Code>
            </Section>

            <Section id="authentication" title="Authentication">
              <p>Two schemes, never mixed within one request:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong className="text-white">API key</strong> — <C>X-API-Key: af_live_…</C>, for your servers/apps. Avatars you create belong to the key&apos;s project; a key can only
                  reach its own project&apos;s avatars. Keep keys server-side; never ship them in a browser bundle.
                </li>
                <li>
                  <strong className="text-white">Session cookie</strong> — HTTP-only cookie from <C>POST /api/v1/auth/login</C>, for people signed into the web creator or dashboard. Avatars
                  created this way belong to the account (&quot;My avatars&quot;).
                </li>
              </ul>
              <Endpoint method="POST" path="/api/v1/auth/register" auth="none">Email + password (≥ 8 characters, PBKDF2-SHA256 hashed).</Endpoint>
              <Endpoint method="POST" path="/api/v1/auth/login" auth="none">Sets the session cookie (14 days).</Endpoint>
              <Endpoint method="POST" path="/api/v1/auth/logout" auth="session" />
              <Endpoint method="GET" path="/api/v1/auth/me" auth="session" />
            </Section>

            <Section id="configuration" title="Avatar configuration">
              <p>
                An avatar is a small, versioned JSON document — never a baked model. Every renderer (the browser viewer, the server&apos;s Blender pipeline, your own SDK) rebuilds the
                avatar from it, so it&apos;s cheap to store and diff.
              </p>
              <Code>{CONFIG_EXAMPLE}</Code>
              <ul className="list-disc space-y-1.5 pl-5">
                <li><C>body.height</C>, <C>shoulderWidth</C>, <C>proportion</C>: 0–1, where 0.5 is the authored body. Height maps to ~158–186 cm.</li>
                <li><C>face.morphs</C>: shape-key name → weight (−1…1). Structural keys: head width, chin, cheeks, eyes, nose, mouth, lips.</li>
                <li><C>face.expression</C>: one of <C>GET /api/v1/expressions</C>. Blinking is procedural and not stored.</li>
                <li>Asset ids (<C>hair.style</C>, <C>facialHair.*</C>, <C>clothing.*</C>, <C>accessories</C>) come from <C>GET /api/v1/assets</C> and must match the slot they&apos;re used in.</li>
                <li>Colors are <C>#RRGGBB</C>; tintable assets list their palette in <C>metadata.colors</C>, but any color is accepted.</li>
              </ul>
            </Section>

            <Section id="avatars" title="Avatars">
              <Endpoint method="POST" path="/api/v1/avatars" auth="key · session">Body <C>{"{ name?, configuration, visibility? }"}</C>. Returns 201 with the avatar.</Endpoint>
              <Endpoint method="GET" path="/api/v1/avatars" auth="key · session">Key → the project&apos;s avatars. Session → the account&apos;s own avatars. <C>?page=&amp;pageSize=</C> (≤ 100).</Endpoint>
              <Endpoint method="GET" path="/api/v1/avatars/{id}" auth="key · session" />
              <Endpoint method="PUT" path="/api/v1/avatars/{id}" auth="key · session">Partial update: any of <C>name</C>, <C>configuration</C>, <C>visibility</C> (<C>Private</C>/<C>Public</C>).</Endpoint>
              <Endpoint method="DELETE" path="/api/v1/avatars/{id}" auth="key · session" />
              <Endpoint method="GET" path="/api/v1/avatars/{id}/configuration" auth="key · session">Just the configuration document.</Endpoint>
              <Endpoint method="PUT" path="/api/v1/avatars/{id}/configuration" auth="key · session">Replace the configuration (validated like create).</Endpoint>
              <Endpoint method="PUT" path="/api/v1/avatars/{id}/thumbnail" auth="key · session">Raw PNG / WebP / JPEG body, ≤ 1 MB. Real image signatures are checked (not the Content-Type) → <C>thumbnailUrl</C>.</Endpoint>
              <Endpoint method="GET" path="/api/v1/avatars/public/{id}" auth="none">Only for avatars marked <C>Public</C>; no owner information. Powers the share pages on this site.</Endpoint>
            </Section>

            <Section id="catalog" title="Catalog & presets">
              <p>Reference data an editor needs. Everything except assets is public; calls made with a key still count toward its project&apos;s usage.</p>
              <Endpoint method="GET" path="/api/v1/assets" auth="key · session"><C>?category=&amp;slot=&amp;search=&amp;page=&amp;pageSize=</C>. Each asset has its model/thumbnail URL, compatibility rules, style tags, palette and license.</Endpoint>
              <Endpoint method="GET" path="/api/v1/assets/{id}" auth="key · session" />
              <Endpoint method="GET" path="/api/v1/catalog" auth="none">Editor categories, color palettes and body types.</Endpoint>
              <Endpoint method="GET" path="/api/v1/presets" auth="none">Curated starting looks — each a complete, valid configuration.</Endpoint>
              <Endpoint method="GET" path="/api/v1/expressions" auth="none">Expression presets as ARKit blendshape weights.</Endpoint>
              <Endpoint method="GET" path="/api/v1/animations" auth="none">Animation library metadata; <C>?include=tracks</C> adds keyframes.</Endpoint>
              <Endpoint method="GET" path="/api/v1/animations/{id}" auth="none" />
            </Section>

            <Section id="render" title="Render & export">
              <p>Both run a real headless Blender pipeline on the server — the same assembly the viewer does, including skin tone, iris color, body proportions, facial hair and clothing layers.</p>
              <Endpoint method="POST" path="/api/v1/avatars/{id}/render" auth="key · session" />
              <Endpoint method="POST" path="/api/v1/avatars/render" auth="key · session">Same, with <C>avatarId</C> in the body.</Endpoint>
              <Code>{`{
  "format": "png",
  "width": 1024, "height": 1024,          // 64–2048
  "camera": "full",                        // full | front | portrait | threeQuarter
  "background": "transparent",            // or "#RRGGBB"
  "animation": "wave",                     // optional pose from GET /api/v1/animations
  "time": 0.4                              // seconds into the animation
}`}</Code>
              <Endpoint method="POST" path="/api/v1/avatars/{id}/export" auth="key · session">
                <C>{"{ \"format\": \"glb\", \"includeAnimations\": true }"}</C> → one skeleton (163 joints), every garment re-targeted onto it, 52 ARKit face blendshapes, and each animation as a
                glTF animation — loads directly in Blender, Unity and Unreal.
              </Endpoint>
              <p>Responses are <C>{"{ status: \"completed\", url, format }"}</C>; download the <C>url</C> from the API host. Renders typically take 5–15 s.</p>
            </Section>

            <Section id="animations" title="Animation data">
              <p>
                Clips are data, not code: per-bone rotation <em>deltas</em> sampled at a fixed fps, applied on top of each bone&apos;s rest rotation (<C>final = rest × delta</C>), plus a root
                translation delta in meters. Bone names are the rig&apos;s glTF node names (e.g. <C>upperarm01.L</C>). A track of exactly 4 values (root: 3) is constant.
              </p>
              <Code>{`{
  "id": "wave", "name": "Wave", "duration": 1.6, "loop": true, "fadeIn": 0.3,
  "expression": "smile",                 // signature facial expression while playing
  "frames": 39,
  "tracks": { "upperarm01.R": [x, y, z, w, x, y, z, w, …], … },
  "root": [dx, dy, dz, …]
}`}</Code>
            </Section>

            <Section id="validation" title="Validation">
              <p>The server validates every configuration independently of any client. All problems are reported at once:</p>
              <Code>{`400 {
  "error": {
    "code": "INVALID_CONFIGURATION",
    "message": "The configuration has 2 problems.",
    "details": { "errors": [
      "face.skinTone must be a #RRGGBB hex color.",
      "hair.style: 'shoes_cloth' is a 'shoes' asset and can't be used as hair."
    ] }
  }
}`}</Code>
              <p>
                Asset combinations that don&apos;t fit (e.g. voluminous hair under a cap, low flats with shorts) return <C>INCOMPATIBLE_ASSETS</C> with the violating pairs, and only one
                accessory per slot (one hat, one pair of glasses) is allowed.
              </p>
            </Section>

            <Section id="projects" title="Projects & API keys">
              <Endpoint method="POST" path="/api/v1/projects" auth="session">Body <C>{"{ name }"}</C> — the project belongs to the signed-in user.</Endpoint>
              <Endpoint method="GET" path="/api/v1/projects" auth="session" />
              <Endpoint method="PUT" path="/api/v1/projects/{id}" auth="session" />
              <Endpoint method="DELETE" path="/api/v1/projects/{id}" auth="session" />
              <Endpoint method="GET" path="/api/v1/projects/{id}/avatars" auth="session" />
              <Endpoint method="POST" path="/api/v1/projects/{id}/api-keys" auth="session">Project owner only. Returns the plaintext key once; only a SHA-256 hash is stored.</Endpoint>
              <Endpoint method="GET" path="/api/v1/projects/{id}/api-keys" auth="session">Prefixes only.</Endpoint>
              <Endpoint method="DELETE" path="/api/v1/projects/{id}/api-keys/{keyId}" auth="session">Revoked keys fail on their very next request.</Endpoint>
            </Section>

            <Section id="usage" title="Usage">
              <Endpoint method="GET" path="/api/v1/projects/{id}/usage" auth="session">Requests today / this month, success vs. failure, renders, exports and the 20 latest calls — computed from real request logs.</Endpoint>
            </Section>

            <Section id="rate-limits" title="Rate limits">
              <p>
                Per API key: the key&apos;s own limit (default 60/min). Per signed-in account: 240/min. Responses carry <C>X-RateLimit-Limit</C> and <C>X-RateLimit-Remaining</C>; over the limit you
                get <C>429 RATE_LIMITED</C> with <C>Retry-After</C>. Server renders are additionally queued (a few Blender processes at a time).
              </p>
            </Section>

            <Section id="errors" title="Errors">
              <p>One shape everywhere: <C>{"{ \"error\": { \"code\", \"message\", \"details\" } }"}</C></p>
              <table className="mt-2 w-full text-left text-[13px]">
                <tbody>
                  {[
                    ["400", "VALIDATION_FAILED · INVALID_CONFIGURATION · INCOMPATIBLE_ASSETS"],
                    ["401", "UNAUTHORIZED — missing/invalid key or session"],
                    ["403", "FORBIDDEN — authenticated, but not the owner"],
                    ["404", "AVATAR_NOT_FOUND · ASSET_NOT_FOUND · PROJECT_NOT_FOUND"],
                    ["409", "EMAIL_ALREADY_REGISTERED · AVATAR_LIMIT_REACHED (200 per account)"],
                    ["415", "Thumbnail isn't a PNG/WebP/JPEG image"],
                    ["429", "RATE_LIMITED"],
                    ["500 / 503 / 504", "RENDER_FAILED · RENDERER_UNAVAILABLE · RENDER_TIMEOUT"],
                  ].map(([status, meaning]) => (
                    <tr key={status} className="border-t border-white/[0.06]">
                      <td className="py-2 pr-4 align-top font-mono text-neutral-200">{status}</td>
                      <td className="py-2 text-neutral-400">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>
        </main>
      </div>
    </div>
  );
}
