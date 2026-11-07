"""
Procedural, tileable hair textures for AvatarForge's own facial-hair assets (no third-party art):

  strands.png  - a soft, dense base with fine, gently curved strands growing downward; alpha is
                 high in the body of the hair and breaks up into individual strand tips
  stubble.png  - a faint shadow (the skin darkening of short regrowth) plus fine dots / dashes

Neutral gray-white so the viewer/renderer tint (facialHair.color) sets the actual color.
Deterministic (fixed seeds) so re-running reproduces byte-identical inputs.

    python tools/asset-pipeline/generate_facial_hair_textures.py
"""

import math
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(REPO, ".pipeline-tools", "facial-hair")


def wrapped(draw_fn, size, x, y):
    """Draw at (x, y) and at every wrapped neighbour so the texture tiles seamlessly."""
    for dx in (-size, 0, size):
        for dy in (-size, 0, size):
            draw_fn(x + dx, y + dy)


def tileable_noise(size, cells, seed):
    """Smooth value noise that tiles: a small random grid upscaled with wrap-around padding."""
    rng = random.Random(seed)
    grid = Image.new("L", (cells, cells))
    grid.putdata([rng.randint(0, 255) for _ in range(cells * cells)])
    padded = Image.new("L", (cells + 2, cells + 2))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            padded.paste(grid, (1 + dx * cells, 1 + dy * cells))
    scale = size / cells
    big = padded.resize((int((cells + 2) * scale), int((cells + 2) * scale)), Image.BICUBIC)
    off = int(scale)
    return big.crop((off, off, off + size, off + size))


def strands(size=512, count=9000, seed=7):
    rng = random.Random(seed)
    s = 2  # supersample
    big = Image.new("RGBA", (size * s, size * s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big, "RGBA")
    for _ in range(count):
        x, y = rng.uniform(0, size), rng.uniform(0, size)
        length = rng.uniform(18, 48)
        angle = math.pi / 2 + rng.uniform(-0.28, 0.28)  # mostly downward (+y in image space)
        curl = rng.uniform(-0.02, 0.02)
        shade = rng.randint(150, 245)
        width = rng.choice((1, 1, 1, 2))

        def draw_strand(px, py, angle=angle, length=length, curl=curl, shade=shade, width=width):
            segments = 6
            a = angle
            cx, cy = px, py
            for k in range(segments):
                nx = cx + math.cos(a) * length / segments
                ny = cy + math.sin(a) * length / segments
                alpha = int(255 * (1 - k / segments) ** 0.5)
                draw.line([(cx * s, cy * s), (nx * s, ny * s)], fill=(shade, shade, shade, alpha), width=width * s)
                cx, cy, a = nx, ny, a + curl * 8

        wrapped(draw_strand, size, x, y)
    img = big.resize((size, size), Image.LANCZOS)

    # Soft body underneath the strands: hair reads as a mass, not a net of lines.
    r, g, b, a = img.split()
    body = tileable_noise(size, 16, seed + 1).point(lambda v: int(150 + v * 0.35))
    a = ImageChops.lighter(a, body)
    shade = ImageChops.multiply(r, tileable_noise(size, 32, seed + 2).point(lambda v: int(200 + v * 0.2)))
    shade = ImageChops.lighter(shade, Image.new("L", (size, size), 120))
    return Image.merge("RGBA", (shade, shade, shade, a))


def stubble(size=512, count=26000, seed=11):
    rng = random.Random(seed)
    s = 2
    big = Image.new("RGBA", (size * s, size * s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big, "RGBA")
    for _ in range(count):
        x, y = rng.uniform(0, size), rng.uniform(0, size)
        length = rng.uniform(1.5, 4.0)
        angle = math.pi / 2 + rng.uniform(-0.6, 0.6)
        shade = rng.randint(90, 200)
        alpha = rng.randint(170, 245)

        def draw_dot(px, py, length=length, angle=angle, shade=shade, alpha=alpha):
            ex, ey = px + math.cos(angle) * length, py + math.sin(angle) * length
            draw.line([(px * s, py * s), (ex * s, ey * s)], fill=(shade, shade, shade, alpha), width=s)

        wrapped(draw_dot, size, x, y)
    img = big.resize((size, size), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.35))
    # The even shadow of regrowth under the dots (fine grain only: low-frequency blotches read as dirt).
    r, g, b, a = img.split()
    shadow = tileable_noise(size, 128, seed + 1).point(lambda v: int(62 + v * 0.1))
    a = ImageChops.lighter(a, shadow)
    r = ImageChops.lighter(r, Image.new("L", (size, size), 110))
    return Image.merge("RGBA", (r, r, r, a))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, img in (("strands", strands()), ("stubble", stubble())):
        path = os.path.join(OUT_DIR, f"{name}.png")
        img.save(path, optimize=True)
        print(f"wrote {path} ({os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    main()
