import * as THREE from "three";
import { RIG_SPEC } from "../config/rigSpec";

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * Builds a copy of the eye texture with only the iris recolored: each iris texel keeps its own
 * luminance (fibers, limbal ring, pupil stay intact) and takes the chosen hue. The UV layout of the
 * iris comes from shared/rig-spec.json, the same numbers the API's Blender renderer uses. Returns
 * a CanvasTexture so GLB export embeds the recolored eyes too.
 */
export function irisTexture(base: THREE.Texture, eyeHex: string): THREE.Texture {
  const image = base.image as CanvasImageSource & { width: number; height: number };
  if (!image?.width) return base;
  const key = `${base.uuid}:${eyeHex}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const size = Math.min(512, image.width);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return base;
  ctx.drawImage(image, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size);
  const data = pixels.data;

  const target = new THREE.Color(eyeHex); // linear
  const { irisCenters, irisRadius } = RIG_SPEC.eyes;
  const feather = irisRadius * 0.12;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size; // glTF UV and canvas rows both run top-down
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      let dist = Infinity;
      for (const [cu, cv] of irisCenters) dist = Math.min(dist, Math.hypot(u - cu, v - cv));
      const mask = Math.min(1, Math.max(0, (irisRadius - dist) / feather));
      if (mask <= 0) continue;
      const i = (y * size + x) * 4;
      const r = toLinear(data[i] / 255);
      const g = toLinear(data[i + 1] / 255);
      const b = toLinear(data[i + 2] / 255);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const scale = lum / 0.12; // the source iris averages ~0.12 linear luminance
      data[i] = Math.round(255 * toSrgb(Math.min(1, r * (1 - mask) + target.r * scale * mask)));
      data[i + 1] = Math.round(255 * toSrgb(Math.min(1, g * (1 - mask) + target.g * scale * mask)));
      data[i + 2] = Math.round(255 * toSrgb(Math.min(1, b * (1 - mask) + target.b * scale * mask)));
    }
  }
  ctx.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = base.flipY;
  texture.wrapS = base.wrapS;
  texture.wrapT = base.wrapT;
  texture.anisotropy = 4;
  cache.set(key, texture);
  if (cache.size > 24) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      cache.get(oldest)?.dispose();
      cache.delete(oldest);
    }
  }
  return texture;
}
