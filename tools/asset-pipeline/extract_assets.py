"""
Step 1 of the attachment pipeline: pull the selected CC0 asset folders out of the cached
MakeHuman community pack zips (.pipeline-tools/asset-packs/*.zip) into
.pipeline-tools/asset-packs/extracted/, then prepare their textures:

  * downscale every texture to <= 1024px (source packs ship 2K-4K textures)
  * "neutralize" the diffuse texture of tintable assets (hair/clothing/hats) — desaturate and
    re-light it to a light neutral gray, keeping alpha. AttachmentPart tints by multiplying the
    texture with the user's chosen color (glTF baseColorFactor), so a pink or brown source texture
    would otherwise skew every chosen color. Glasses keep their authored colors (lenses/frames).

Every selection below was checked against the pack's own packs/<name>.json metadata: all CC0
(see docs/asset-pipeline.md LICENSE_AUDIT). Run with the system Python (needs Pillow):

    python tools/asset-pipeline/extract_assets.py
"""

import io
import json
import os
import zipfile

from PIL import Image, ImageOps

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PACKS_DIR = os.path.join(REPO, ".pipeline-tools", "asset-packs")
OUT_DIR = os.path.join(PACKS_DIR, "extracted")
MAX_TEXTURE = 1024

# pack zip -> [(folder prefix inside the zip, neutralize diffuse for tinting)]
SELECTIONS = {
    "hair01.zip": [
        ("hair/toigo_blunt_bob/", True),
        ("hair/o4saken_long01/", True),
        ("hair/elvs_double_mh_braid/", True),
        ("hair/cortu_short_messy_hair/", True),
        ("hair/culturalibre_hair_02/", True),
        ("hair/culturalibre_hair_05/", True),
        ("hair/culturalibre_hair_01/", True),
        ("hair/rehmanpolanski_hair_bun_brown/", True),
        ("hair/faydaen_hair_1/", True),
        ("hair/toigo_curled_under_bob_with_bangs/", True),
        ("hair/littleright_bobcut_hair/", True),
    ],
    "shirts01.zip": [
        ("clothes/toigo_basic_tucked_t-shirt/", True),
        ("clothes/namuhekam_male_polo_shirt/", True),
        ("clothes/elvs_crude_t-shirt_male/", True),
        ("clothes/toigo_fisherman_sweater/", True),
        ("clothes/toigo_keyhole_tank_top/", True),
        ("clothes/toigo_camisole_top/", True),
    ],
    "pants01.zip": [
        ("clothes/toigo_wool_pants/", True),
        ("clothes/cortu_cargo_pants/", True),
        ("clothes/cortu_jeans_shorts/", True),
        ("clothes/toigo_harem_pants/", True),
    ],
    "shoes01.zip": [
        ("clothes/toigo_mj_cloth_shoes/", True),
        ("clothes/toigo_ankle_boots_male/", True),
        ("clothes/culturalibre_male_boots/", True),
        ("clothes/culturalibre_hero_boots_2/", True),
    ],
    "hats01.zip": [
        ("clothes/jujube_newsboy_cap/", False),
        ("clothes/aethelraed_unraed_cloche_hat/", True),
        ("clothes/joepal_xmas_cap/", False),
    ],
    "glasses01.zip": [
        ("clothes/kwnet_at_optical_glasses/", False),
        ("clothes/spamrakuen_tbm_glasses_frames_01/", False),
        ("clothes/toigo_round_glasses_leopard/", False),
        ("clothes/frankyaye_glasses_library_male/", False),
        ("clothes/spamrakuen_sagerfrogs_glasses_02/", False),
        ("clothes/ews_3d_glasses/", False),
    ],
    "makehuman_system_assets.zip": [
        ("eyes/low-poly/", False),
        ("eyebrows/eyebrow001/", False),
        ("eyelashes/eyelashes01/", False),
        ("teeth/teeth_base/", False),
        ("tongue/tongue01/", False),
    ],
}

# Marker so re-running the script never neutralizes the same texture twice.
NEUTRALIZED_MARKER = ".neutralized.json"


def verify_license(z: zipfile.ZipFile, pack: str, prefix: str) -> None:
    meta_name = f"packs/{pack}.json"
    if meta_name not in z.namelist():
        return
    meta = json.loads(z.read(meta_name))
    asset_key = prefix.rstrip("/").split("/")[-1]
    entry = meta.get(asset_key)
    if entry is None:
        raise SystemExit(f"{asset_key} not found in {meta_name} — cannot verify its license")
    if entry.get("license") != "CC0":
        raise SystemExit(f"{asset_key} is licensed {entry.get('license')!r}, not CC0 — refusing to extract")


def diffuse_textures(folder: str) -> list[str]:
    """Diffuse maps referenced by the folder's .mhmat files (normal/bump maps are left alone)."""
    result = []
    for name in os.listdir(folder):
        if not name.endswith(".mhmat"):
            continue
        with open(os.path.join(folder, name), encoding="utf-8", errors="ignore") as f:
            for line in f:
                parts = line.strip().split(None, 1)
                if len(parts) == 2 and parts[0] == "diffuseTexture":
                    result.append(os.path.join(folder, os.path.basename(parts[1])))
    return result


def downscale(path: str) -> None:
    im = Image.open(path)
    if max(im.size) <= MAX_TEXTURE:
        return
    scale = MAX_TEXTURE / max(im.size)
    im = im.resize((max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))), Image.LANCZOS)
    im.save(path, optimize=True)


def neutralize(path: str) -> None:
    """Luminance-only copy, re-lit so its mean sits at ~80% gray; alpha channel preserved."""
    im = Image.open(path)
    alpha = im.getchannel("A") if im.mode in ("RGBA", "LA") else None
    gray = ImageOps.grayscale(im.convert("RGB"))
    if alpha is not None:
        # Mean over visible texels only — hair cards are mostly transparent padding.
        visible = [g for g, a in zip(gray.getdata(), alpha.getdata()) if a > 32]
    else:
        visible = list(gray.getdata())
    mean = (sum(visible) / len(visible)) if visible else 128
    gain = 205.0 / max(mean, 1.0)
    gray = gray.point(lambda v: max(0, min(255, int(v * gain))))
    out = Image.merge("RGBA", (gray, gray, gray, alpha)) if alpha is not None else Image.merge("RGB", (gray, gray, gray))
    out.save(path, optimize=True)


def main() -> None:
    for zip_name, selections in SELECTIONS.items():
        pack = zip_name[:-4]
        with zipfile.ZipFile(os.path.join(PACKS_DIR, zip_name)) as z:
            names = z.namelist()
            for prefix, tintable in selections:
                verify_license(z, pack, prefix)
                members = [n for n in names if n.startswith(prefix)]
                if not members:
                    raise SystemExit(f"{prefix} not found in {zip_name}")
                folder = os.path.join(OUT_DIR, prefix)
                marker = os.path.join(folder, NEUTRALIZED_MARKER)
                already_prepared = os.path.exists(marker)
                if not already_prepared:
                    for n in members:
                        z.extract(n, OUT_DIR)
                for n in members:
                    if n.lower().endswith(".png"):
                        downscale(os.path.join(OUT_DIR, n))
                if tintable and not already_prepared:
                    for tex in diffuse_textures(folder):
                        if os.path.exists(tex):
                            neutralize(tex)
                            print(f"  neutralized {os.path.relpath(tex, OUT_DIR)}")
                if not already_prepared:
                    with open(marker, "w") as f:
                        json.dump({"tintable": tintable}, f)
                print(f"{zip_name}: {prefix} ({len(members)} files){' [tintable]' if tintable else ''}")
    print("DONE")


if __name__ == "__main__":
    main()
