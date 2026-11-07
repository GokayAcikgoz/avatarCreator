"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/controls";
import { Icon, Spinner } from "@/components/ui/Icon";
import { toast } from "@/components/ui/toast";
import { API_URL } from "@/lib/apiClient";
import { useAvatarStore } from "../state/avatarStore";
import { useEditorUi } from "../state/editorUi";
import { useCloudAvatar } from "../hooks/useCloudAvatar";

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't access the clipboard — select and copy it manually.");
  }
}

export function ShareDialog() {
  const open = useEditorUi((s) => s.shareOpen);
  const setOpen = useEditorUi((s) => s.setShareOpen);
  const cloud = useAvatarStore((s) => s.cloud);
  const { save, setVisibility } = useCloudAvatar();
  const [busy, setBusy] = useState(false);

  const close = () => setOpen(false);
  const isPublic = cloud.visibility === "Public";
  const pageUrl = typeof window !== "undefined" && cloud.avatarId ? `${window.location.origin}/avatar/${cloud.avatarId}` : "";
  const apiUrl = cloud.avatarId ? `${API_URL}/api/v1/avatars/public/${cloud.avatarId}` : "";

  const toggle = async () => {
    setBusy(true);
    await setVisibility(isPublic ? "Private" : "Public");
    setBusy(false);
  };

  return (
    <Dialog open={open} onClose={close} title="Share your avatar" description="Public avatars get a page anyone can open, and a configuration URL any app can load." width="md">
      {!cloud.avatarId ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-neutral-300">Save your avatar first — sharing works on saved avatars.</p>
          <Button
            variant="primary"
            onClick={async () => {
              setBusy(true);
              await save();
              setBusy(false);
            }}
            disabled={busy}
          >
            {busy ? <Spinner /> : <Icon name="cloud" size={16} />} Save avatar
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${isPublic ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-neutral-400"}`}>
                <Icon name={isPublic ? "globe" : "lock"} size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-white">{isPublic ? "Public" : "Private"}</p>
                <p className="text-xs text-neutral-400">{isPublic ? "Anyone with the link can view it." : "Only you (and your API keys' apps) can see it."}</p>
              </div>
            </div>
            <Button onClick={toggle} disabled={busy} variant={isPublic ? "secondary" : "primary"} size="sm">
              {busy ? <Spinner size={14} /> : null}
              {isPublic ? "Make private" : "Make public"}
            </Button>
          </div>

          {isPublic && (
            <>
              <div>
                <p className="mb-1.5 text-xs font-medium text-neutral-300">Share page</p>
                <div className="flex gap-2">
                  <input readOnly value={pageUrl} onFocus={(e) => e.target.select()} className="h-9 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 font-mono text-xs text-neutral-200" />
                  <Button size="sm" className="h-9" onClick={() => copy(pageUrl, "Link")}>
                    <Icon name="copy" size={14} /> Copy
                  </Button>
                  <a href={pageUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-xl border border-white/10 px-3 text-neutral-300 hover:bg-white/5" aria-label="Open share page">
                    <Icon name="external" size={15} />
                  </a>
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-neutral-300">Configuration API (no key needed for public avatars)</p>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-neutral-300">
                  <span className="text-indigo-300">GET</span> {apiUrl}
                </div>
                <Button size="sm" className="mt-2" onClick={() => copy(`curl ${apiUrl}`, "curl command")}>
                  <Icon name="code" size={14} /> Copy curl
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
