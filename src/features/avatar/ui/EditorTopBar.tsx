"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAvatarStore, hasUnsavedChanges } from "../state/avatarStore";
import { useEditorUi } from "../state/editorUi";
import { useCloudAvatar } from "../hooks/useCloudAvatar";
import { useSession } from "@/features/auth/sessionStore";
import { Button, IconButton, Kbd } from "@/components/ui/controls";
import { Icon, Spinner } from "@/components/ui/Icon";
import { toast } from "@/components/ui/toast";
import { ExportMenu } from "./ExportMenu";

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="AvatarForge home">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c7cff] to-[#c86bff] shadow-lg shadow-indigo-500/30">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
      </span>
      <span className="hidden text-[15px] font-semibold tracking-tight text-white sm:block">AvatarForge</span>
    </Link>
  );
}

function SaveStatus() {
  const signedIn = useSession((s) => s.status === "signedIn");
  const saving = useEditorUi((s) => s.saving);
  const dirty = useAvatarStore((s) => hasUnsavedChanges(s));
  const linked = useAvatarStore((s) => Boolean(s.cloud.avatarId));

  let dot = "bg-neutral-500";
  let text = "Draft on this device";
  if (saving) {
    dot = "bg-indigo-400 animate-pulse";
    text = "Saving…";
  } else if (signedIn && linked && !dirty) {
    dot = "bg-emerald-400";
    text = "Saved";
  } else if (signedIn && (dirty || !linked)) {
    dot = "bg-amber-400";
    text = "Unsaved changes";
  }
  return (
    <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[11px] text-neutral-400 md:flex">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function NameField() {
  const name = useAvatarStore((s) => s.cloud.name);
  const setCloud = useAvatarStore((s) => s.setCloud);
  return (
    <input
      value={name}
      maxLength={80}
      onChange={(e) => setCloud({ name: e.target.value })}
      onBlur={(e) => !e.target.value.trim() && setCloud({ name: "My Avatar" })}
      aria-label="Avatar name"
      className="h-8 w-28 min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-sm font-medium text-white outline-none transition hover:border-white/10 focus:border-indigo-400/60 focus:bg-white/[0.04] sm:w-44"
    />
  );
}

function AccountMenu() {
  const user = useSession((s) => s.user);
  const status = useSession((s) => s.status);
  const signOut = useSession((s) => s.signOut);
  const requireAuth = useEditorUi((s) => s.requireAuth);
  const setMyAvatarsOpen = useEditorUi((s) => s.setMyAvatarsOpen);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (status !== "signedIn" || !user) {
    return (
      <Button variant="ghost" onClick={() => requireAuth("Save avatars to your account and reuse them through the AvatarForge API.", null)} disabled={status === "loading" || status === "unknown"}>
        <Icon name="user" size={16} />
        <span className="hidden sm:inline">Sign in</span>
      </Button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/40 to-fuchsia-500/40 text-sm font-semibold uppercase text-white ring-1 ring-white/15 transition hover:ring-white/40"
        title={user.email}
      >
        {user.email[0]}
      </button>
      {open && (
        <div role="menu" className="af-fade-up absolute right-0 top-11 z-40 w-60 overflow-hidden rounded-2xl border border-white/10 bg-[#10121a]/98 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <p className="truncate px-3 pb-2 pt-1.5 text-xs text-neutral-400">{user.email}</p>
          <button role="menuitem" type="button" onClick={() => { setOpen(false); setMyAvatarsOpen(true); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-neutral-200 hover:bg-white/[0.06]">
            <Icon name="folder" size={16} /> My avatars
          </button>
          <Link role="menuitem" href="/dashboard" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-neutral-200 hover:bg-white/[0.06]">
            <Icon name="grid" size={16} /> Developer dashboard
          </Link>
          <Link role="menuitem" href="/docs" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-neutral-200 hover:bg-white/[0.06]">
            <Icon name="code" size={16} /> API documentation
          </Link>
          <div className="my-1 h-px bg-white/[0.06]" />
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              setOpen(false);
              await signOut();
              toast.info("Signed out — your draft stays on this device.");
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-neutral-300 hover:bg-white/[0.06]"
          >
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function EditorTopBar() {
  const canUndo = useAvatarStore((s) => s.past.length > 0);
  const canRedo = useAvatarStore((s) => s.future.length > 0);
  const undo = useAvatarStore((s) => s.undo);
  const redo = useAvatarStore((s) => s.redo);
  const randomize = useAvatarStore((s) => s.randomize);
  const saving = useEditorUi((s) => s.saving);
  const setShareOpen = useEditorUi((s) => s.setShareOpen);
  const setMyAvatarsOpen = useEditorUi((s) => s.setMyAvatarsOpen);
  const signedIn = useSession((s) => s.status === "signedIn");
  const { save } = useCloudAvatar();

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#08090e]/80 px-3 backdrop-blur-xl sm:gap-3 sm:px-4">
      <Logo />
      <span className="hidden h-5 w-px bg-white/10 sm:block" />
      <NameField />
      <SaveStatus />

      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <div className="hidden items-center sm:flex">
          <IconButton label="Undo (Ctrl+Z)" icon="undo" onClick={undo} disabled={!canUndo} />
          <IconButton label="Redo (Ctrl+Shift+Z)" icon="redo" onClick={redo} disabled={!canRedo} />
        </div>
        <Button variant="ghost" onClick={randomize} title="Randomize">
          <Icon name="dice" size={16} />
          <span className="hidden lg:inline">Randomize</span>
        </Button>
        {signedIn && <IconButton label="My avatars" icon="folder" onClick={() => setMyAvatarsOpen(true)} />}
        <IconButton label="Share" icon="link" onClick={() => setShareOpen(true)} className="hidden sm:inline-flex" />
        <ExportMenu />
        <Button variant="primary" onClick={() => save()} disabled={saving} title="Save (Ctrl+S)">
          {saving ? <Spinner /> : <Icon name="cloud" size={16} />}
          <span className="hidden sm:inline">Save</span>
          <span className="hidden xl:inline">
            <Kbd>Ctrl S</Kbd>
          </span>
        </Button>
        <AccountMenu />
      </div>
    </header>
  );
}
