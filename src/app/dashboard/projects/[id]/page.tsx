"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/features/dashboard/hooks/useSession";
import {
  dashboardApi,
  Project,
  ApiKeySummary,
  AvatarSummary,
  UsageSummary,
  ApiError,
} from "@/features/dashboard/api/client";
import { absoluteApiUrl } from "@/lib/apiClient";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, loading } = useSession();

  const [project, setProject] = useState<Project | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[] | null>(null);
  const [avatars, setAvatars] = useState<AvatarSummary[] | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [justCreatedKey, setJustCreatedKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renamingAvatarId, setRenamingAvatarId] = useState<string | null>(null);
  const [avatarNameDraft, setAvatarNameDraft] = useState("");

  useEffect(() => {
    if (!loading && !user) router.push("/dashboard/login");
  }, [loading, user, router]);

  const reloadAll = () => {
    dashboardApi.getProject(id).then((p) => { setProject(p); setNameDraft(p.name); }).catch(() => {});
    dashboardApi.listApiKeys(id).then(setApiKeys).catch(() => setApiKeys([]));
    dashboardApi.listProjectAvatars(id).then((r) => setAvatars(r.items)).catch(() => setAvatars([]));
    dashboardApi.getUsage(id).then(setUsage).catch(() => {});
  };

  useEffect(() => {
    if (user) reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  const handleRename = async () => {
    if (!nameDraft.trim()) return;
    try {
      const updated = await dashboardApi.renameProject(id, nameDraft.trim());
      setProject(updated);
      setRenaming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rename failed.");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete project "${project?.name}"? This cannot be undone.`)) return;
    await dashboardApi.deleteProject(id);
    router.push("/dashboard");
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    try {
      const created = await dashboardApi.createApiKey(id, newKeyName.trim());
      setJustCreatedKey(created.key);
      setNewKeyName("");
      dashboardApi.listApiKeys(id).then(setApiKeys);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create key.");
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm("Revoke this API key? Any app using it will stop working immediately.")) return;
    await dashboardApi.revokeApiKey(id, keyId);
    dashboardApi.listApiKeys(id).then(setApiKeys);
  };

  const handleRenameAvatar = async (avatarId: string) => {
    if (!avatarNameDraft.trim()) return;
    try {
      await dashboardApi.renameAvatar(avatarId, avatarNameDraft.trim());
      setRenamingAvatarId(null);
      dashboardApi.listProjectAvatars(id).then((r) => setAvatars(r.items));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rename failed.");
    }
  };

  const handleDeleteAvatar = async (avatarId: string, name: string) => {
    if (!confirm(`Delete avatar "${name}"? This cannot be undone.`)) return;
    await dashboardApi.deleteAvatar(avatarId);
    dashboardApi.listProjectAvatars(id).then((r) => setAvatars(r.items));
  };

  if (loading || !user || !project) {
    return <div className="flex flex-1 items-center justify-center bg-[#0b0d12] text-neutral-500">Loading...</div>;
  }

  return (
    <div className="flex flex-1 flex-col bg-[#0b0d12] px-6 py-10 sm:px-12">
      <Link href="/dashboard" className="mb-6 text-sm text-neutral-500 hover:text-white">
        ← Back to projects
      </Link>

      <header className="mb-10 flex items-start justify-between">
        <div>
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xl font-semibold text-white outline-none focus:border-indigo-400"
              />
              <button onClick={handleRename} className="rounded-full bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400">
                Save
              </button>
              <button onClick={() => setRenaming(false)} className="text-xs text-neutral-500 hover:text-white">
                Cancel
              </button>
            </div>
          ) : (
            <h1 className="text-2xl font-semibold text-white">
              {project.name}{" "}
              <button onClick={() => setRenaming(true)} className="ml-2 text-xs font-normal text-neutral-500 hover:text-indigo-400">
                rename
              </button>
            </h1>
          )}
          <p className="mt-1 text-sm text-neutral-500">Created {new Date(project.createdAt).toLocaleDateString()}</p>
        </div>
        <button
          onClick={handleDelete}
          className="rounded-full border border-red-500/30 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
        >
          Delete project
        </button>
      </header>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {/* Usage */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">Usage</h2>
        {usage ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Requests today", usage.requestsToday],
              ["Requests this month", usage.requestsThisMonth],
              ["Successful", usage.successfulRequests],
              ["Failed", usage.failedRequests],
              ["Renders", usage.renderCount],
              ["Exports", usage.exportCount],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-2xl font-semibold text-white">{value}</p>
                <p className="mt-1 text-xs text-neutral-500">{label}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Loading usage...</p>
        )}

        {usage && usage.recentRequests.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Operation</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {usage.recentRequests.map((r, i) => (
                  <tr key={i} className="border-t border-white/5 text-neutral-300">
                    <td className="px-3 py-2">{r.operation}</td>
                    <td className={`px-3 py-2 ${r.statusCode >= 400 ? "text-red-400" : "text-emerald-400"}`}>{r.statusCode}</td>
                    <td className="px-3 py-2">{r.durationMs}ms</td>
                    <td className="px-3 py-2 text-neutral-500">{new Date(r.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* API Keys */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">API Keys</h2>

        {justCreatedKey && (
          <div className="mb-4 rounded-xl border border-indigo-400/40 bg-indigo-500/10 p-4">
            <p className="mb-2 text-sm text-indigo-200">
              Copy this key now — it will never be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-black/30 px-3 py-2 text-xs text-white">{justCreatedKey}</code>
              <button
                onClick={() => navigator.clipboard.writeText(justCreatedKey)}
                className="shrink-0 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleCreateKey} className="mb-4 flex max-w-md gap-2">
          <input
            type="text"
            placeholder="Key name, e.g. Production"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
          />
          <button type="submit" className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400">
            Create key
          </button>
        </form>

        {apiKeys && apiKeys.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-xs text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Key</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Rate limit</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id} className="border-t border-white/5 text-neutral-300">
                    <td className="px-3 py-2">{key.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-neutral-500">{key.keyPrefix}...</td>
                    <td className="px-3 py-2">
                      {key.isActive ? (
                        <span className="text-emerald-400">Active</span>
                      ) : (
                        <span className="text-neutral-600">Revoked</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{key.rateLimitPerMinute}/min</td>
                    <td className="px-3 py-2 text-right">
                      {key.isActive && (
                        <button onClick={() => handleRevoke(key.id)} className="text-xs text-red-400 hover:text-red-300">
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Avatars */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">Avatars</h2>
        {avatars === null ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : avatars.length === 0 ? (
          <p className="text-sm text-neutral-500">
            None yet — create one via the Assets/Avatars API with a key above, or from{" "}
            <Link href="/create" className="text-indigo-400 hover:text-indigo-300">
              the avatar creator
            </Link>
            .
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {avatars.map((avatar) => (
              <div key={avatar.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                {avatar.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- API-hosted thumbnail on another origin
                  <img src={absoluteApiUrl(avatar.thumbnailUrl)!} alt="" className="mb-3 aspect-square w-full rounded-lg bg-[radial-gradient(circle_at_50%_30%,rgba(124,124,255,0.18),transparent_70%)] object-cover" />
                )}
                {renamingAvatarId === avatar.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={avatarNameDraft}
                      onChange={(e) => setAvatarNameDraft(e.target.value)}
                      autoFocus
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none focus:border-indigo-400"
                    />
                    <button onClick={() => handleRenameAvatar(avatar.id)} className="shrink-0 text-xs text-indigo-400 hover:text-indigo-300">
                      Save
                    </button>
                    <button onClick={() => setRenamingAvatarId(null)} className="shrink-0 text-xs text-neutral-500 hover:text-white">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <h3 className="font-medium text-white">{avatar.name}</h3>
                )}
                <p className="mt-1 text-xs text-neutral-500">
                  {avatar.visibility} · Updated {new Date(avatar.updatedAt).toLocaleDateString()}
                </p>
                <div className="mt-3 flex items-center gap-3 text-xs">
                  <Link href={`/create?avatarId=${avatar.id}`} className="text-indigo-400 hover:text-indigo-300">
                    Open in Creator
                  </Link>
                  <button
                    onClick={() => { setRenamingAvatarId(avatar.id); setAvatarNameDraft(avatar.name); }}
                    className="text-neutral-400 hover:text-white"
                  >
                    Rename
                  </button>
                  <button onClick={() => handleDeleteAvatar(avatar.id, avatar.name)} className="text-red-400 hover:text-red-300">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
