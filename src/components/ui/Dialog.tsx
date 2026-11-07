"use client";

import { ReactNode, useEffect, useRef } from "react";
import { Icon } from "./Icon";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: "sm" | "md" | "lg";
}

const WIDTHS = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl" };

/** Accessible modal: focus moves in on open and back out on close, Escape and backdrop click dismiss. */
export function Dialog({ open, onClose, title, description, children, width = "md" }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("input, button:not([data-close]), [tabindex]:not([tabindex='-1'])");
    (first ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`af-fade-up relative flex max-h-[92dvh] w-full ${WIDTHS[width]} flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0f1119] shadow-2xl shadow-black/60 outline-none sm:rounded-3xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 pb-4 pt-5">
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {description && <p className="mt-1 text-sm text-neutral-400">{description}</p>}
          </div>
          <button type="button" data-close onClick={onClose} className="-mr-2 rounded-lg p-2 text-neutral-400 transition hover:bg-white/5 hover:text-white" aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
