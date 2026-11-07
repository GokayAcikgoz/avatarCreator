"use client";

import { FormEvent, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/controls";
import { Spinner } from "@/components/ui/Icon";
import { describeApiError } from "@/lib/apiClient";
import { useSession } from "./sessionStore";

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  /** Why we're asking — shown under the title ("Sign in to save your avatar…"). */
  reason?: string;
  onSignedIn?: () => void;
}

export function AuthDialog({ open, onClose, reason, onSignedIn }: AuthDialogProps) {
  const [mode, setMode] = useState<"signIn" | "register">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = useSession((s) => s.signIn);
  const register = useSession((s) => s.register);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") await register(email.trim(), password);
      else await signIn(email.trim(), password);
      setPassword("");
      onClose();
      onSignedIn?.();
    } catch (err) {
      setError(describeApiError(err, "Couldn't sign you in."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={mode === "signIn" ? "Sign in to AvatarForge" : "Create your AvatarForge account"} description={reason} width="sm">
      <div className="mb-5 grid grid-cols-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1 text-sm">
        {(["signIn", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`rounded-lg py-1.5 font-medium transition ${mode === m ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white"}`}
          >
            {m === "signIn" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-neutral-300">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-indigo-400/70"
            placeholder="you@example.com"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-neutral-300">
          Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-indigo-400/70"
            placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
          />
        </label>
        {error && <p className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 h-10">
          {busy ? <Spinner /> : null}
          {mode === "signIn" ? "Sign in" : "Create account"}
        </Button>
        <p className="text-center text-[11px] leading-relaxed text-neutral-500">
          The same account opens the developer dashboard, where you can create API keys for your own apps.
        </p>
      </form>
    </Dialog>
  );
}
