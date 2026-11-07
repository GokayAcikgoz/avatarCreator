"use client";

import { AssetMetadata } from "../config/assetMetadata";
import { Icon } from "@/components/ui/Icon";

interface AssetCardProps {
  asset?: AssetMetadata;
  /** Renders the "None" option when no asset is given. */
  noneLabel?: string;
  active: boolean;
  disabledReason?: string | null;
  onClick: () => void;
}

export function AssetCard({ asset, noneLabel = "None", active, disabledReason, onClick }: AssetCardProps) {
  const disabled = Boolean(disabledReason);
  const label = asset?.name ?? noneLabel;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={disabledReason ?? label}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border text-left transition ${
        active
          ? "border-indigo-400/70 bg-indigo-500/[0.12] shadow-[0_0_0_1px_rgba(124,124,255,0.35)]"
          : disabled
            ? "cursor-not-allowed border-white/[0.04] opacity-40"
            : "border-white/[0.07] bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]"
      }`}
    >
      <div className="relative aspect-square w-full bg-[radial-gradient(circle_at_50%_35%,rgba(124,124,255,0.14),transparent_70%)]">
        {asset?.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny static thumbnails; next/image optimization adds nothing here
          <img src={asset.thumbnail} alt="" loading="lazy" className="h-full w-full object-contain p-1.5 transition duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-600">
            <Icon name={asset ? "cube" : "x"} size={22} />
          </div>
        )}
        {active && (
          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-white shadow">
            <Icon name="check" size={12} strokeWidth={3} />
          </span>
        )}
      </div>
      <span className="truncate px-2 pb-2 pt-1 text-[11px] font-medium text-neutral-300">{label}</span>
    </button>
  );
}
