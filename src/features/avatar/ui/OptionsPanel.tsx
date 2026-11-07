"use client";

import { CATEGORIES } from "../config/assetManifest";
import { AssetCategory } from "../config/assetMetadata";
import { AssetSlot, CameraFocus, useAvatarStore } from "../state/avatarStore";
import { Icon } from "@/components/ui/Icon";
import { AccessoriesPanel, BodyPanel, EyesPanel, FacePanel, FacialHairPanel, PresetsPanel, SlotPanel } from "./panels";

const DESCRIPTIONS: Record<string, string> = {
  presets: "Pick a starting look — everything stays editable.",
  body: "Build, height, proportions and skin tone.",
  face: "Sculpt the face and choose an expression.",
  eyes: "Eye color and shape.",
  hair: "Style and color.",
  facialHair: "Beards and mustaches that move with every expression.",
  top: "Shirts, tees and knitwear.",
  bottom: "Trousers and shorts.",
  shoes: "Everyday shoes and boots.",
  accessories: "Hats and eyewear — one of each.",
};

/** Where the camera glides when a category opens (the face tabs frame the face, shoes frame the feet...). */
export const CATEGORY_FOCUS: Record<string, CameraFocus> = {
  presets: "full",
  body: "full",
  face: "face",
  eyes: "face",
  hair: "face",
  facialHair: "face",
  top: "upper",
  bottom: "lower",
  shoes: "feet",
  accessories: "face",
};

function PanelFor({ category }: { category: AssetCategory }) {
  switch (category.kind) {
    case "presets":
      return <PresetsPanel />;
    case "body":
      return <BodyPanel />;
    case "face":
      return <FacePanel />;
    case "eyes":
      return <EyesPanel />;
    case "facialHair":
      return <FacialHairPanel />;
    case "accessories":
      return <AccessoriesPanel slots={category.slots ?? []} />;
    case "slot":
      return <SlotPanel slot={category.slot as AssetSlot} allowNone={category.allowNone} />;
  }
}

export function OptionsPanel() {
  const selected = useAvatarStore((s) => s.selectedCategory);
  const category = CATEGORIES.find((c) => c.id === selected) ?? CATEGORIES[0];
  return (
    <div className="flex h-full flex-col">
      <div className="hidden border-b border-white/[0.06] px-5 pb-4 pt-5 lg:block">
        <h2 className="text-lg font-semibold tracking-tight text-white">{category.label}</h2>
        <p className="mt-0.5 text-xs text-neutral-400">{DESCRIPTIONS[category.id] ?? ""}</p>
      </div>
      <div key={category.id} className="af-fade-up min-h-0 flex-1 overflow-y-auto">
        <PanelFor category={category} />
      </div>
    </div>
  );
}

export function CategoryRail({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const selected = useAvatarStore((s) => s.selectedCategory);
  const selectCategory = useAvatarStore((s) => s.selectCategory);
  const focusCamera = useAvatarStore((s) => s.focusCamera);

  const choose = (id: string) => {
    selectCategory(id);
    focusCamera(CATEGORY_FOCUS[id] ?? "full");
  };

  if (orientation === "horizontal") {
    return (
      <nav className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 py-2.5" aria-label="Customization categories">
        {CATEGORIES.map((cat) => {
          const active = selected === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => choose(cat.id)}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition ${
                active ? "bg-white text-[#0b0d12]" : "bg-white/[0.05] text-neutral-300"
              }`}
            >
              <Icon name={cat.icon} size={15} />
              {cat.label}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-1 p-2.5" aria-label="Customization categories">
      {CATEGORIES.map((cat) => {
        const active = selected === cat.id;
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => choose(cat.id)}
            aria-current={active ? "page" : undefined}
            className={`group flex flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-[10.5px] font-medium transition ${
              active ? "bg-white/[0.08] text-white" : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100"
            }`}
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                active ? "bg-gradient-to-br from-[#7c7cff] to-[#b56bff] text-white shadow-lg shadow-indigo-500/25" : "bg-white/[0.04] group-hover:bg-white/[0.07]"
              }`}
            >
              <Icon name={cat.icon} size={18} />
            </span>
            <span className="leading-tight">{cat.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
