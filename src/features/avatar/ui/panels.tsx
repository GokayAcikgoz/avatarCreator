"use client";

import { ReactNode } from "react";
import { useAvatarStore, AssetSlot, currentSelections, getSlotAsset, getSlotColor } from "../state/avatarStore";
import { useEditorUi } from "../state/editorUi";
import { ASSET_MANIFEST, BODY_TYPES, PALETTES, getAsset, getAssetColors, getAssetsBySlot, incompatibleWithSelection } from "../config/assetManifest";
import { AssetMetadata } from "../config/assetMetadata";
import { FACE_MORPHS } from "../config/faceMorphs";
import { EXPRESSION_PRESETS } from "../config/expressions";
import { AVATAR_PRESETS } from "../config/presets";
import { heightScale } from "../config/rigSpec";
import { Chip, ColorPicker, SectionTitle, Slider } from "@/components/ui/controls";
import { Icon } from "@/components/ui/Icon";
import { AssetCard } from "./AssetCard";

const EYE_MORPHS = new Set(["Eye Size", "Eye Spacing"]);
const FACE_GROUPS: [string, string[]][] = [
  ["Face", ["Face Width", "Jaw Width", "Cheeks"]],
  ["Nose", ["Nose Width", "Nose Length"]],
  ["Mouth", ["Mouth Width", "Lips"]],
];
const BASE_HEIGHT_CM = 172;

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-white/[0.05] px-5 py-5 last:border-b-0">
      <SectionTitle action={action}>{title}</SectionTitle>
      {children}
    </section>
  );
}

function blockedReason(assetId: string, selections: (string | null)[]): string | null {
  const blockers = incompatibleWithSelection(assetId, selections);
  if (blockers.length === 0) return null;
  return `Doesn't fit with ${blockers.map((id) => getAsset(id)?.name ?? id).join(", ")} — remove it first`;
}

function MorphSlider({ label }: { label: string }) {
  const def = FACE_MORPHS.find((m) => m.label === label)!;
  const value = useAvatarStore((s) => s.config.face.morphs[def.targets[0]] ?? 0);
  const setMorph = useAvatarStore((s) => s.setMorph);
  return (
    <Slider
      label={label}
      value={value}
      min={def.min}
      max={def.max}
      origin={0}
      onChange={(v) => setMorph(def.targets, v)}
      format={(v) => `${v > 0 ? "+" : ""}${Math.round((v >= 0 ? v / def.max : v / -def.min) * 100)}`}
    />
  );
}

export function PresetsPanel() {
  const applyPreset = useAvatarStore((s) => s.applyPreset);
  const randomize = useAvatarStore((s) => s.randomize);
  const setPhotoOpen = useEditorUi((s) => s.setPhotoOpen);
  return (
    <>
      <Section title="Start from yourself">
        <button
          type="button"
          onClick={() => setPhotoOpen(true)}
          data-testid="open-photo"
          className="flex w-full items-center gap-3 rounded-2xl border border-indigo-400/30 bg-gradient-to-r from-indigo-500/[0.12] to-fuchsia-500/[0.08] px-4 py-3.5 text-left transition hover:border-indigo-400/60 hover:from-indigo-500/[0.18]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/40 to-fuchsia-500/40 text-white">
            <Icon name="camera" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-white">Create from a photo</span>
            <span className="block text-[11px] text-neutral-400">Selfie or upload — analyzed on your device, never uploaded.</span>
          </span>
        </button>
      </Section>
      <Section title="Start from a look">
        <div className="grid grid-cols-2 gap-2.5">
          {AVATAR_PRESETS.map((preset) => {
            const c = preset.configuration;
            const swatches = [c.face.skinTone, c.hair.color, c.clothing.topColor, c.clothing.bottomColor];
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className="group flex flex-col gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 text-left transition hover:border-indigo-400/50 hover:bg-indigo-500/[0.07]"
              >
                <div className="flex -space-x-1.5">
                  {swatches.map((hex, i) => (
                    <span key={i} className="h-6 w-6 rounded-full ring-2 ring-[#0d0f16]" style={{ backgroundColor: hex }} />
                  ))}
                </div>
                <span className="text-sm font-semibold text-white">{preset.name}</span>
                <span className="text-[11px] leading-snug text-neutral-400">{preset.description}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Feeling lucky?">
        <button
          type="button"
          onClick={randomize}
          className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/15 px-4 py-3.5 text-left transition hover:border-indigo-400/60 hover:bg-indigo-500/[0.06]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30 text-white">
            <Icon name="dice" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-white">Randomize</span>
            <span className="block text-[11px] text-neutral-400">A coherent outfit from one style, every time.</span>
          </span>
        </button>
      </Section>
    </>
  );
}

export function BodyPanel() {
  const body = useAvatarStore((s) => s.config.body);
  const skinTone = useAvatarStore((s) => s.config.face.skinTone);
  const setBody = useAvatarStore((s) => s.setBody);
  const setBodyType = useAvatarStore((s) => s.setBodyType);
  const setSkinTone = useAvatarStore((s) => s.setSkinTone);
  return (
    <>
      <Section title="Body type">
        <div className="grid grid-cols-2 gap-2">
          {BODY_TYPES.map((type) => (
            <Chip key={type.id} active={body.type === type.id} onClick={() => setBodyType(type.id)}>
              {type.label}
            </Chip>
          ))}
        </div>
      </Section>
      <Section title="Proportions">
        <div className="flex flex-col gap-4">
          <Slider label="Height" value={body.height} onChange={(v) => setBody("height", v)} format={(v) => `${Math.round(BASE_HEIGHT_CM * heightScale(v))} cm`} />
          <Slider label="Shoulder width" value={body.shoulderWidth} onChange={(v) => setBody("shoulderWidth", v)} />
          <Slider label="Leg length" value={body.proportion} onChange={(v) => setBody("proportion", v)} />
        </div>
      </Section>
      <Section title="Skin tone">
        <ColorPicker colors={PALETTES.skin ?? []} value={skinTone} onChange={setSkinTone} label="Skin tone" />
      </Section>
    </>
  );
}

export function FacePanel() {
  const expression = useAvatarStore((s) => s.config.face.expression);
  const setExpression = useAvatarStore((s) => s.setExpression);
  return (
    <>
      {FACE_GROUPS.map(([title, labels]) => (
        <Section key={title} title={title}>
          <div className="flex flex-col gap-4">
            {labels.filter((l) => FACE_MORPHS.some((m) => m.label === l && !EYE_MORPHS.has(l))).map((label) => (
              <MorphSlider key={label} label={label} />
            ))}
          </div>
        </Section>
      ))}
      <Section title="Expression">
        <div className="grid grid-cols-3 gap-2">
          {EXPRESSION_PRESETS.map((preset) => (
            <Chip key={preset.id} active={expression === preset.id} onClick={() => setExpression(preset.id)}>
              {preset.name}
            </Chip>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">Blinking is automatic and layers on top of any expression.</p>
      </Section>
    </>
  );
}

export function EyesPanel() {
  const eyeColor = useAvatarStore((s) => s.config.face.eyeColor);
  const setEyeColor = useAvatarStore((s) => s.setEyeColor);
  return (
    <>
      <Section title="Eye color">
        <ColorPicker colors={PALETTES.eyes ?? []} value={eyeColor} onChange={setEyeColor} label="Eye color" />
      </Section>
      <Section title="Shape">
        <div className="flex flex-col gap-4">
          {[...EYE_MORPHS].map((label) => (
            <MorphSlider key={label} label={label} />
          ))}
        </div>
      </Section>
    </>
  );
}

function AssetGrid({ assets, selectedId, allowNone, noneLabel, onSelect }: { assets: AssetMetadata[]; selectedId: string | null; allowNone: boolean; noneLabel?: string; onSelect: (id: string | null) => void }) {
  const config = useAvatarStore((s) => s.config);
  const selections = currentSelections(config);
  return (
    <div className="grid grid-cols-3 gap-2">
      {allowNone && <AssetCard noneLabel={noneLabel} active={!selectedId} onClick={() => onSelect(null)} />}
      {assets.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          active={selectedId === asset.id}
          disabledReason={selectedId === asset.id ? null : blockedReason(asset.id, selections)}
          onClick={() => onSelect(asset.id)}
        />
      ))}
    </div>
  );
}

const SLOT_COPY: Record<string, { title: string; colorTitle: string }> = {
  hair: { title: "Hairstyle", colorTitle: "Hair color" },
  top: { title: "Top", colorTitle: "Color" },
  bottom: { title: "Bottom", colorTitle: "Color" },
  shoes: { title: "Footwear", colorTitle: "Color" },
};

export function SlotPanel({ slot, allowNone }: { slot: AssetSlot; allowNone: boolean }) {
  const selectedId = useAvatarStore((s) => getSlotAsset(s.config, slot));
  const color = useAvatarStore((s) => getSlotColor(s.config, slot));
  const selectSlot = useAvatarStore((s) => s.selectSlot);
  const setSlotColor = useAvatarStore((s) => s.setSlotColor);
  const selected = getAsset(selectedId);
  const colors = getAssetColors(selected);
  const copy = SLOT_COPY[slot] ?? { title: slot, colorTitle: "Color" };
  return (
    <>
      <Section title={copy.title}>
        <AssetGrid assets={getAssetsBySlot(slot)} selectedId={selectedId} allowNone={allowNone} noneLabel={slot === "hair" ? "Bald" : "None"} onSelect={(id) => selectSlot(slot, id)} />
      </Section>
      {colors.length > 0 && (
        <Section title={copy.colorTitle}>
          <ColorPicker colors={colors} value={color} onChange={(hex) => setSlotColor(slot, hex)} label={copy.colorTitle} />
        </Section>
      )}
    </>
  );
}

export function FacialHairPanel() {
  const facialHair = useAvatarStore((s) => s.config.facialHair);
  const hairColor = useAvatarStore((s) => s.config.hair.color);
  const selectSlot = useAvatarStore((s) => s.selectSlot);
  const setSlotColor = useAvatarStore((s) => s.setSlotColor);
  const hasAny = facialHair.beardStyle || facialHair.mustacheStyle;
  return (
    <>
      <Section title="Beard">
        <AssetGrid assets={getAssetsBySlot("beard")} selectedId={facialHair.beardStyle} allowNone onSelect={(id) => selectSlot("beard", id)} />
      </Section>
      <Section title="Mustache">
        <AssetGrid assets={getAssetsBySlot("mustache")} selectedId={facialHair.mustacheStyle} allowNone onSelect={(id) => selectSlot("mustache", id)} />
      </Section>
      {hasAny && (
        <Section
          title="Color"
          action={
            facialHair.color.toLowerCase() !== hairColor.toLowerCase() ? (
              <button type="button" onClick={() => setSlotColor("beard", hairColor)} className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200">
                Match hair
              </button>
            ) : undefined
          }
        >
          <ColorPicker colors={PALETTES.hair ?? []} value={facialHair.color} onChange={(hex) => setSlotColor("beard", hex)} label="Facial hair color" />
        </Section>
      )}
    </>
  );
}

const ACCESSORY_SLOT_TITLES: Record<string, string> = { head: "Headwear", face: "Eyewear" };

export function AccessoriesPanel({ slots }: { slots: string[] }) {
  const accessories = useAvatarStore((s) => s.config.accessories);
  const accessoryColors = useAvatarStore((s) => s.config.accessoryColors);
  const toggleAccessory = useAvatarStore((s) => s.toggleAccessory);
  const setAccessoryColor = useAvatarStore((s) => s.setAccessoryColor);
  return (
    <>
      {slots.map((slot) => {
        const assets = ASSET_MANIFEST.filter((a) => a.category === "accessory" && a.slot === slot);
        const selectedId = accessories.find((id) => getAsset(id)?.slot === slot) ?? null;
        const selected = getAsset(selectedId);
        const colors = getAssetColors(selected);
        return (
          <Section key={slot} title={ACCESSORY_SLOT_TITLES[slot] ?? slot}>
            <AssetGrid
              assets={assets}
              selectedId={selectedId}
              allowNone
              onSelect={(id) => {
                if (id) toggleAccessory(id);
                else if (selectedId) toggleAccessory(selectedId);
              }}
            />
            {selected && colors.length > 0 && (
              <div className="mt-4">
                <ColorPicker colors={colors} value={accessoryColors[selected.id] ?? colors[0]} onChange={(hex) => setAccessoryColor(selected.id, hex)} label={`${selected.name} color`} />
              </div>
            )}
          </Section>
        );
      })}
    </>
  );
}
