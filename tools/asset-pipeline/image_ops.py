"""
Small image helpers the Node post-process step shells out to (Pillow is already a pipeline
dependency via extract_assets.py; Node has no WebP codec without native modules).

    python image_ops.py neutralize <in> <out> [alpha_gain]   # luminance-only, re-lit to ~80% gray, alpha kept (or boosted)
    python image_ops.py hair_strands <in> <out> <u|v>        # adds strand streaks along U or V to a flat hair texture
    python image_ops.py hair_tone <in> <out>    # neutral + compressed contrast + bled edges (hair cards)
    python image_ops.py mean_rgb <in>           # prints the mean RGB (e.g. to tell normal-map spaces apart)
"""

import sys

from PIL import Image, ImageFilter, ImageOps


def _save(out: Image.Image, dst: str) -> None:
    fmt = "WEBP" if dst.lower().endswith(".webp") else "PNG"
    out.save(dst, fmt, **({"quality": 85, "method": 6} if fmt == "WEBP" else {"optimize": True}))


def neutralize(src: str, dst: str, alpha_gain: float = 1.0) -> None:
    im = Image.open(src)
    alpha = im.getchannel("A") if im.mode in ("RGBA", "LA") else None
    if alpha is not None and alpha_gain != 1.0:
        # Fine hair strokes (eyebrows) sit below a 0.5 alpha cutoff and vanish; strengthen them.
        alpha = alpha.point(lambda a: min(255, int(a * alpha_gain)))
    gray = ImageOps.grayscale(im.convert("RGB"))
    if alpha is not None:
        visible = [g for g, a in zip(gray.getdata(), alpha.getdata()) if a > 32]
    else:
        visible = list(gray.getdata())
    mean = (sum(visible) / len(visible)) if visible else 128
    gain = 205.0 / max(mean, 1.0)
    gray = gray.point(lambda v: max(0, min(255, int(v * gain))))
    out = Image.merge("RGBA", (gray, gray, gray, alpha)) if alpha is not None else Image.merge("RGB", (gray, gray, gray))
    _save(out, dst)


def hair_tone(src: str, dst: str) -> None:
    """Hair cards for tinting: some source textures draw strands as near-black lines on white, which
    a blond tint turns into black stripes on gold foil. Map the visible luminance range (5th–95th
    percentile) into 150–240 so strand detail stays but nothing goes black, and bleed the color into
    transparent texels so mipmaps don't pull dark fringes into the card edges."""
    im = Image.open(src).convert("RGBA")
    alpha = im.getchannel("A")
    gray = ImageOps.grayscale(im.convert("RGB"))
    visible = sorted(g for g, a in zip(gray.getdata(), alpha.getdata()) if a > 64) or [128]
    lo = visible[int(len(visible) * 0.05)]
    hi = max(lo + 1, visible[int(len(visible) * 0.95)])
    toned = gray.point(lambda v: max(0, min(255, int(150 + (v - lo) * 90.0 / (hi - lo)))))
    # Edge bleed: blur the visible color outward a few times and use it wherever alpha is low.
    mask = alpha.point(lambda a: 255 if a > 64 else 0)
    fill = toned
    for radius in (2, 4, 8, 16):
        blurred = Image.composite(toned, Image.new("L", toned.size, 200), mask).filter(ImageFilter.BoxBlur(radius))
        fill = Image.composite(fill, blurred, mask)
    out_gray = Image.composite(toned, fill, mask)
    _save(Image.merge("RGBA", (out_gray, out_gray, out_gray, alpha)), dst)


def hair_strands(src: str, dst: str, axis: str) -> None:
    """Some community hair ships a flat, featureless texture and reads as a plastic helmet. Its locks
    are unwrapped as strips along one UV axis, so streaks along that axis become strands: fine
    stretched noise (strands) over coarse stretched noise (clumps), around the original brightness."""
    import random

    im = Image.open(src).convert("RGBA")
    w, h = im.size
    rng = random.Random(5)

    def streaks(cells_across, stretch):
        small = Image.new("L", (max(1, cells_across // stretch), cells_across))
        small.putdata([rng.randint(0, 255) for _ in range(small.width * small.height)])
        img = small.resize((w, h), Image.BICUBIC)
        return img if axis == "u" else img.transpose(Image.Transpose.ROTATE_90).resize((w, h))

    fine = streaks(h // 2, 24)
    coarse = streaks(h // 16, 12)
    base = ImageOps.grayscale(im.convert("RGB"))
    mean = sum(base.getdata()) / (w * h)
    detail = Image.blend(fine, coarse, 0.35)
    toned = detail.point(lambda v: max(0, min(255, int(mean * (0.72 + 0.5 * v / 255.0)))))
    _save(Image.merge("RGBA", (toned, toned, toned, im.getchannel("A"))), dst)


def mean_rgb(src: str) -> None:
    im = Image.open(src).convert("RGB").resize((64, 64))
    n = 64 * 64
    print(" ".join(str(sum(ch.getdata()) // n) for ch in im.split()))


if __name__ == "__main__":
    if len(sys.argv) in (4, 5) and sys.argv[1] == "neutralize":
        neutralize(sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) == 5 else 1.0)
    elif len(sys.argv) == 5 and sys.argv[1] == "hair_strands":
        hair_strands(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) == 4 and sys.argv[1] == "hair_tone":
        hair_tone(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == "mean_rgb":
        mean_rgb(sys.argv[2])
    else:
        raise SystemExit(__doc__)
