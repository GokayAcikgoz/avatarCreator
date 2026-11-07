"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/features/dashboard/hooks/useSession";
import { dashboardApi, Project, ApiError } from "@/features/dashboard/api/client";

export default function DashboardHomePage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [avatarCounts, setAvatarCounts] = useState<Record<string, number>>({});
  const [assetCount, setAssetCount] = useState<number | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/dashboard/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    dashboardApi.listProjects().then(setProjects).catch(() => setProjects([]));
    dashboardApi.getAssetCount().then(setAssetCount).catch(() => setAssetCount(null));
  }, [user]);

  useEffect(() => {
    if (!projects) return;
    projects.forEach((project) => {
      dashboardApi
        .listProjectAvatars(project.id)
        .then((r) => setAvatarCounts((prev) => ({ ...prev, [project.id]: r.total })))
        .catch(() => {});
    });
  }, [projects]);

  const totalAvatars = Object.values(avatarCounts).reduce((sum, n) => sum + n, 0);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newProjectName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const project = await dashboardApi.createProject(newProjectName.trim());
      setProjects((prev) => [project, ...(prev ?? [])]);
      setNewProjectName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create project.");
    } finally {
      setCreating(false);
    }
  };

  const handleLogout = async () => {
    await dashboardApi.logout();
    router.push("/dashboard/login");
  };

  if (loading || !user) {
    return <div className="flex flex-1 items-center justify-center bg-[#0b0d12] text-neutral-500">Loading...</div>;
  }

  return (
    <div className="flex flex-1 flex-col bg-[#0b0d12] px-6 py-10 sm:px-12">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <span className="block text-xs font-medium uppercase tracking-[0.2em] text-indigo-400">AvatarForge</span>
          <h1 className="mt-1 text-2xl font-semibold text-white">Developer Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-500">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/docs" className="text-sm text-neutral-400 hover:text-white">
            API Docs
          </Link>
          <button
            onClick={handleLogout}
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10"
          >
            Log out
          </button>
        </div>
      </header>

      <section className="mb-10 grid grid-cols-3 gap-3 sm:max-w-md">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-2xl font-semibold text-white">{projects?.length ?? "—"}</p>
          <p className="mt-1 text-xs text-neutral-500">Projects</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-2xl font-semibold text-white">{projects ? totalAvatars : "—"}</p>
          <p className="mt-1 text-xs text-neutral-500">Avatars (all projects)</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-2xl font-semibold text-white">{assetCount ?? "—"}</p>
          <p className="mt-1 text-xs text-neutral-500">Catalog assets</p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">New project</h2>
        <form onSubmit={handleCreate} className="flex max-w-md gap-2">
          <input
            type="text"
            placeholder="e.g. My Game"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
          />
          <button
            type="submit"
            disabled={creating}
            className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            Create
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">Projects</h2>
        {projects === null ? (
          <p className="text-sm text-neutral-500">Loading projects...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-neutral-500">No projects yet — create one above to get an API key.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/dashboard/projects/${project.id}`}
                className="rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-indigo-400/50 hover:bg-white/10"
              >
                <h3 className="font-medium text-white">{project.name}</h3>
                <p className="mt-1 text-xs text-neutral-500">
                  Created {new Date(project.createdAt).toLocaleDateString()}
                  {avatarCounts[project.id] !== undefined && ` · ${avatarCounts[project.id]} avatars`}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
