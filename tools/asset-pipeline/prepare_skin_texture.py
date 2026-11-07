"""
Builds the avatar's skin detail texture from MakeHuman's CC0 `young_caucasian_female2` skin
(makehuman_system_assets pack, license verified CC0 in packs/makehuman_system_assets.json).

The body GLB ships without any material, so the viewer used to fall back to three.js's default
(white, fully metallic) material and `face.skinTone` was never applied. This script produces a
*tone-neutral* detail map instead of a fixed-ethnicity skin:

    detail = clamp(texture_linear / reference_linear * 0.78)

i.e. every channel is divided by the texture's own average skin color, so the result is a
near-white map that keeps pores, lips, knuckles, eye sockets and shading variation but carries no
hue of its own. Viewer and Blender renderer then use the identical formula

    final_color = detail * (skinTone_linear / 0.78)

so any skin tone (the `face.skinTone` hex in the AvatarConfiguration) looks natural, and the
glTF baseColorFactor stays within [0, 1] for every realistic tone.

Also removes anatomical detail (nipples) and the "MakeHuman.org" watermark — this is a
general-audience avatar platform, and the watermark sits outside every UV island anyway.

    python tools/asset-pipeline/prepare_skin_texture.py
"""

import io
import os
import zipfile

from PIL import Image, ImageDraw, ImageFilter

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PACK = os.path.join(REPO, ".pipeline-tools", "asset-packs", "makehuman_system_assets.zip")
SOURCE = "skins/young_caucasian_female2/young_lightskinned_female_diffuse2.png"
OUT_SIZE = 2048
OUTPUTS = [
    os.path.join(REPO, "public", "textures", "skin_detail.webp"),
    os.path.join(REPO, "api", "server-assets", "textures", "skin_detail.webp"),
]

# Normalized (u, v) centers + radius of the regions to blend away, measured on the source map.
SOFTEN_SPOTS = [(0.319, 0.297, 0.028), (0.430, 0.297, 0.028)]
WATERMARK_BOX = (0.965, 0.72, 1.0, 1.0)
# Torso sample box used to measure the texture's own average skin color.
REFERENCE_BOX = (0.25, 0.30, 0.50, 0.45)
TARGET_MEAN = 0.78
CHROMA_KEEP = 0.5


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def main() -> None:
    with zipfile.ZipFile(PACK) as z:
        im = Image.open(io.BytesIO(z.read(SOURCE))).convert("RGB")
    im = im.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
    W, H = im.size

    # 1. Blend anatomical spots into the surrounding skin via a soft-masked heavy blur.
    blurred = im.filter(ImageFilter.GaussianBlur(radius=W * 0.02))
    mask = Image.new("L", im.size, 0)
    draw = ImageDraw.Draw(mask)
    for u, v, r in SOFTEN_SPOTS:
        draw.ellipse([(u - r) * W, (v - r) * H, (u + r) * W, (v + r) * H], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=W * 0.008))
    im = Image.composite(blurred, im, mask)

    # 2. Watermark: fill with the background color sampled just left of it.
    bg = im.getpixel((int(W * 0.95), int(H * 0.99)))
    ImageDraw.Draw(im).rectangle(
        [WATERMARK_BOX[0] * W, WATERMARK_BOX[1] * H, WATERMARK_BOX[2] * W, WATERMARK_BOX[3] * H], fill=bg
    )

    # 3. Reference (average) skin color, in linear space.
    box = im.crop((int(REFERENCE_BOX[0] * W), int(REFERENCE_BOX[1] * H), int(REFERENCE_BOX[2] * W), int(REFERENCE_BOX[3] * H)))
    pixels = list(box.getdata())
    ref = [sum(srgb_to_linear(p[i] / 255) for p in pixels) / len(pixels) for i in range(3)]
    print("reference linear skin color:", [round(c, 4) for c in ref])

    # 4. Per-channel normalization through 256-entry LUTs (exact, and fast on 4M pixels).
    luts = []
    for i in range(3):
        gain = TARGET_MEAN / ref[i]
        luts.extend(int(round(linear_to_srgb(srgb_to_linear(v / 255) * gain) * 255)) for v in range(256))
    detail = im.point(luts)

    # 5. Keep only half of the map's own chroma variation. The face region is naturally pinker than
    #    the torso the reference was measured on; at full strength that reads as an orange cast once
    #    multiplied by a tone. Lips/cheeks stay slightly warmer, the chosen tone stays faithful.
    gray = detail.convert("L").convert("RGB")
    detail = Image.blend(gray, detail, CHROMA_KEEP)

    for out in OUTPUTS:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        detail.save(out, "WEBP", quality=84, method=6)
        print(f"wrote {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
