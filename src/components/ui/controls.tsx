"use client";

import { ButtonHTMLAttributes, ReactNode, useId, useRef } from "react";
import { Icon } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-[#7c7cff] to-[#b56bff] text-white shadow-lg shadow-indigo-500/20 hover:brightness-110 disabled:opacity-50",
  secondary: "border border-white/10 bg-white/[0.04] text-neutral-100 hover:bg-white/[0.08] disabled:opacity-40",
  ghost: "text-neutral-300 hover:bg-white/[0.06] hover:text-white disabled:opacity-40",
  danger: "border border-rose-400/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 disabled:opacity-40",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "h-8 gap-1.5 rounded-lg px-3 text-xs" : "h-9 gap-2 rounded-xl px-4 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:cursor-not-allowed ${sizing} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({ label, icon, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-300 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:pointer-events-none disabled:opacity-30 ${className}`}
      {...props}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{children}</h3>
      {action}
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** For ranges that go both ways (e.g. face sliders): the fill starts here instead of at `min`. */
  origin?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

export function Slider({ label, value, min = 0, max = 1, step = 0.01, origin, onChange, format }: SliderProps) {
  const id = useId();
  const pct = (v: number) => ((v - min) / (max - min || 1)) * 100;
  const fill = pct(value);
  // Bipolar sliders (origin inside the range) fill from the origin to the value.
  const bipolar = origin !== undefined && origin > min && origin < max;
  const from = bipolar ? Math.min(pct(origin), fill) : 0;
  const to = bipolar ? Math.max(pct(origin), fill) : fill;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="text-neutral-300">
          {label}
        </label>
        <span className="font-mono text-[11px] text-neutral-500">{format ? format(value) : `${Math.round(fill)}%`}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={bipolar ? "af-range af-range-bipolar" : "af-range"}
        style={{ ["--from" as string]: `${from}%`, ["--fill" as string]: `${to}%` }}
      />
    </div>
  );
}

interface ColorPickerProps {
  colors: string[];
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  allowCustom?: boolean;
}

export function ColorPicker({ colors, value, onChange, label, allowCustom = true }: ColorPickerProps) {
  const customRef = useRef<HTMLInputElement>(null);
  const isCustom = !colors.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={label ?? "Color"}>
      {colors.map((hex) => {
        const active = value.toLowerCase() === hex.toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={hex}
            title={hex}
            onClick={() => onChange(hex)}
            style={{ backgroundColor: hex }}
            className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-[#0d0f16] transition hover:scale-110 ${
              active ? "ring-2 ring-white" : "ring-1 ring-white/15"
            }`}
          />
        );
      })}
      {allowCustom && (
        <>
          <button
            type="button"
            onClick={() => customRef.current?.click()}
            aria-label="Custom color"
            title="Custom color"
            className={`flex h-7 w-7 items-center justify-center rounded-full bg-[conic-gradient(from_0deg,#ff5f6d,#ffc371,#8ce99a,#4dabf7,#b197fc,#ff5f6d)] ring-offset-2 ring-offset-[#0d0f16] transition hover:scale-110 ${
              isCustom ? "ring-2 ring-white" : "ring-1 ring-white/15"
            }`}
          >
            {isCustom && <span className="h-3.5 w-3.5 rounded-full border border-white/70" style={{ backgroundColor: value }} />}
          </button>
          <input ref={customRef} type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="sr-only" tabIndex={-1} aria-hidden="true" />
        </>
      )}
    </div>
  );
}

export function Chip({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
        active ? "border-indigo-400/60 bg-indigo-500/15 text-white" : "border-white/[0.08] bg-white/[0.03] text-neutral-300 hover:border-white/20 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-white/15 bg-white/5 px-1 py-px font-mono text-[10px] text-neutral-400">{children}</kbd>;
}

export { Icon };
