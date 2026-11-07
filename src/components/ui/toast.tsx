"use client";

import { create } from "zustand";
import { Icon } from "./Icon";

export type ToastTone = "info" | "success" | "error";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: ToastTone, action?: Toast["action"]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, tone = "info", action) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone, action }] }));
    setTimeout(() => get().dismiss(id), tone === "error" ? 6500 : 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (message: string, action?: Toast["action"]) => useToasts.getState().push(message, "info", action),
  success: (message: string, action?: Toast["action"]) => useToasts.getState().push(message, "success", action),
  error: (message: string, action?: Toast["action"]) => useToasts.getState().push(message, "error", action),
};

const TONE_STYLES: Record<ToastTone, string> = {
  info: "border-white/10 text-neutral-100",
  success: "border-emerald-400/30 text-emerald-50",
  error: "border-rose-400/40 text-rose-50",
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`af-fade-up pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border bg-[#12141c]/95 px-4 py-2.5 text-sm shadow-2xl shadow-black/40 backdrop-blur-md ${TONE_STYLES[t.tone]}`}
        >
          <Icon name={t.tone === "error" ? "x" : t.tone === "success" ? "check" : "sparkles"} size={16} className={t.tone === "error" ? "text-rose-300" : t.tone === "success" ? "text-emerald-300" : "text-indigo-300"} />
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
              className="rounded-md px-2 py-1 text-xs font-semibold text-indigo-300 hover:bg-white/5"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
