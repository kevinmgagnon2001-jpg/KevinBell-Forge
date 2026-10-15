/**
 * The lab's texture packs as real surfaces (the texture deck in Viewport.tsx wraps them on solids).
 *
 * Each pack is painted in the page, tileable, at 512 px: a colour map, a normal map for its bumps and
 * grooves, and where it matters a roughness map (brushed steel, circuit copper) or a glow map (circuit
 * traces, night stars), with a finish to match: polished marble, metallic steel, rough brick and clay.
 * One tile is about a metre, and each solid repeats it to its size instead of stretching one picture
 * over a long column.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { TexturePack } from "@/engine/asset-url";
import type { Vec3 } from "@/engine/types";

export type Surface = {
  key: string;
  map: Texture;
  normalMap?: Texture;
  roughnessMap?: Texture;
  emissiveMap?: Texture;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
  normalScale: number;
};

// ---------- tileable noise ----------

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const wrap = (n: number, p: number) => ((n % p) + p) % p;

/** Value noise in [0, 1] that repeats every `period` cells, so tiles meet without a seam. */
function tnoise(x: number, y: number, period: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash(wrap(ix, period), wrap(iy, period), seed);
  const b = hash(wrap(ix + 1, period), wrap(iy, period), seed);
  const c = hash(wrap(ix, period), wrap(iy + 1, period), seed);
  const d = hash(wrap(ix + 1, period), wrap(iy + 1, period), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal tileable noise in [0, 1]; u, v in [0, 1). */
function fbm(u: number, v: number, base: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = base;
  for (let i = 0; i < octaves; i += 1) {
    sum += tnoise(u * p, v * p, p, seed + i * 7) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixRgb = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** What a pack is at one point of its tile. */
type Texel = { rgb: [number, number, number]; height: number; rough?: number; glow?: [number, number, number] };
type Pack = { roughness: number; metalness: number; normal: number; glow?: string; glowIntensity?: number; roughMap?: boolean; paint: (u: number, v: number) => Texel };

const MARBLE_A = hex("#efece6");
const MARBLE_B = hex("#d9d4cc");
const MARBLE_VEIN = hex("#5f5a66");
const STEEL = hex("#b9bec6");
const CLAY = hex("#b65f3c");
const CLAY_DARK = hex("#7c3a22");
const PAPER = hex("#efe8d9");
const PAPER_LINE = hex("#9fb6d6");
const BRICK = [hex("#8f3f2c"), hex("#a24b33"), hex("#7c3727"), hex("#9a5238")];
const MORTAR = hex("#c9c1b4");
const WOOD = [hex("#a5713f"), hex("#94622f"), hex("#b37f49"), hex("#8a5a2c")];
const WOOD_DARK = hex("#5e3a19");
const PCB = hex("#0d3a2b");
const COPPER = hex("#c98b3e");
const NIGHT_A = hex("#070b1d");
const NIGHT_B = hex("#1b1446");

const PACKS: Record<TexturePack, Pack> = {
  marble: {
    roughness: 0.12,
    metalness: 0,
    normal: 0.15,
    paint: (u, v) => {
      const n = fbm(u, v, 3, 5, 1);
      const vein = Math.abs(Math.sin((u * 2 + v + n * 2.6) * Math.PI * 2));
      const line = Math.pow(1 - vein, 14) * 0.85 + Math.pow(1 - Math.abs(Math.sin((v * 3 - u + n * 1.8) * Math.PI * 2)), 30) * 0.4;
      const rgb = mixRgb(mixRgb(MARBLE_A, MARBLE_B, fbm(u, v, 6, 3, 2)), MARBLE_VEIN, clamp01(line));
      return { rgb, height: 0.5 - line * 0.1 };
    },
  },
  steel: {
    roughness: 1,
    metalness: 1,
    normal: 0.25,
    roughMap: true,
    paint: (u, v) => {
      // Brushed: long streaks along u.
      const streak = tnoise(u * 3, v * 220, 220, 3) * 0.6 + tnoise(u * 9, v * 90, 90, 4) * 0.4;
      const g = 0.88 + (streak - 0.5) * 0.16;
      return { rgb: [STEEL[0] * g, STEEL[1] * g, STEEL[2] * g], height: streak * 0.25, rough: 0.22 + streak * 0.22 };
    },
  },
  brick: {
    roughness: 0.92,
    metalness: 0,
    normal: 1.4,
    paint: (u, v) => {
      // Running bond: 4 bricks across, 14 courses up a metre-ish tile.
      const rows = 14;
      const cols = 4;
      const row = Math.floor(v * rows);
      const x = u * cols + (row % 2 ? 0.5 : 0);
      const col = Math.floor(x);
      const fx = x - col;
      const fy = v * rows - row;
      const mortar = Math.min(fx, 1 - fx) * 4.5 < 0.08 || Math.min(fy, 1 - fy) < 0.09;
      const grit = fbm(u, v, 32, 3, 5);
      if (mortar) return { rgb: mixRgb(MORTAR, [150, 144, 134], grit * 0.6), height: 0.15 + grit * 0.05 };
      const base = BRICK[Math.floor(hash(wrap(col, cols), row, 9) * BRICK.length)];
      const edge = clamp01(Math.min(Math.min(fx, 1 - fx) * 4.5, Math.min(fy, 1 - fy)) * 6);
      return { rgb: mixRgb(base, [60, 26, 18], grit * 0.35), height: 0.6 + edge * 0.3 + grit * 0.1 };
    },
  },
  grain: {
    roughness: 0.55,
    metalness: 0,
    normal: 0.7,
    paint: (u, v) => {
      // Four planks with growth rings.
      const planks = 4;
      const p = Math.floor(v * planks);
      const fy = v * planks - p;
      const seam = Math.min(fy, 1 - fy) < 0.025;
      const n = fbm(u, v, 4, 4, 11 + p);
      const ring = Math.abs(Math.sin((fy * 3 + n * 4 + hash(p, 1, 12) * 5) * Math.PI * 3));
      const base = WOOD[p % WOOD.length];
      const rgb = mixRgb(base, WOOD_DARK, Math.pow(1 - ring, 6) * 0.55 + fbm(u, v, 40, 2, 13) * 0.15);
      return { rgb: seam ? mixRgb(rgb, [30, 18, 8], 0.7) : rgb, height: seam ? 0 : 0.6 + ring * 0.08 };
    },
  },
  clay: {
    roughness: 0.96,
    metalness: 0,
    normal: 1,
    paint: (u, v) => {
      const n = fbm(u, v, 8, 5, 21);
      const speck = tnoise(u * 128, v * 128, 128, 22) > 0.93 ? 0.5 : 0;
      return { rgb: mixRgb(CLAY, CLAY_DARK, clamp01(n * 0.7 + speck - 0.15)), height: n };
    },
  },
  paper: {
    roughness: 0.9,
    metalness: 0,
    normal: 0.35,
    paint: (u, v) => {
      const fibre = fbm(u, v, 64, 3, 31) * 0.6 + tnoise(u * 256, v * 24, 24, 32) * 0.4;
      const line = Math.abs((v * 24) % 1 - 0.5) > 0.47 ? 0.5 : 0;
      return { rgb: mixRgb(mixRgb(PAPER, [222, 212, 192], fibre * 0.5), PAPER_LINE, line), height: fibre * 0.4 };
    },
  },
  circuit: {
    roughness: 1,
    metalness: 0.35,
    normal: 0.9,
    roughMap: true,
    glow: "#ffffff",
    glowIntensity: 1.3,
    paint: (u, v) => {
      // A grid of cells; each carries a horizontal or vertical trace, some with a pad.
      const cells = 12;
      const cx = Math.floor(u * cells);
      const cy = Math.floor(v * cells);
      const fx = u * cells - cx;
      const fy = v * cells - cy;
      const r = hash(cx, cy, 41);
      const horizontal = r < 0.45 && Math.abs(fy - 0.5) < 0.09;
      const vertical = r >= 0.45 && r < 0.85 && Math.abs(fx - 0.5) < 0.09;
      const pad = hash(cx, cy, 42) > 0.78 && Math.hypot(fx - 0.5, fy - 0.5) < 0.2;
      const hole = pad && Math.hypot(fx - 0.5, fy - 0.5) < 0.07;
      const trace = (horizontal || vertical || pad) && !hole;
      const n = fbm(u, v, 24, 2, 43);
      if (!trace) return { rgb: mixRgb(PCB, [6, 28, 20], n * 0.5), height: hole ? 0 : 0.3, rough: 0.7 };
      const pulse = 0.5 + 0.5 * Math.sin((u + v) * Math.PI * 8);
      return { rgb: COPPER, height: 0.7, rough: 0.3, glow: [40 * pulse, 220 * pulse, 190 * pulse] };
    },
  },
  night: {
    roughness: 0.45,
    metalness: 0.05,
    normal: 0.1,
    glow: "#ffffff",
    glowIntensity: 1.6,
    paint: (u, v) => {
      const neb = fbm(u, v, 3, 5, 51);
      const rgb = mixRgb(NIGHT_A, NIGHT_B, clamp01((neb - 0.35) * 2));
      const s = tnoise(u * 180, v * 180, 180, 52);
      const star = s > 0.965 ? (s - 0.965) / 0.035 : 0;
      const tint: [number, number, number] = hash(Math.floor(u * 180), Math.floor(v * 180), 53) > 0.7 ? [255, 214, 170] : [210, 225, 255];
      const glow = mixRgb([30 * neb, 10 * neb, 60 * neb], tint, star);
      return { rgb: mixRgb(rgb, tint, star * 0.8), height: 0.5, glow };
    },
  },
};

function canvasTexture(size: number, data: Uint8ClampedArray<ArrayBuffer>, srgb: boolean): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(new ImageData(data, size, size), 0, 0);
  const texture = new CanvasTexture(canvas);
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

type Painted = Omit<Surface, "key">;
const painted = new Map<string, Painted>();

/** Paint a pack at `size` pixels (cached). */
function paint(pack: TexturePack, size: number): Painted {
  const id = `${pack}@${size}`;
  const hit = painted.get(id);
  if (hit) return hit;
  const def = PACKS[pack];
  const n = size * size;
  const color = new Uint8ClampedArray(new ArrayBuffer(n * 4));
  const heights = new Float32Array(n);
  const rough = def.roughMap ? new Uint8ClampedArray(new ArrayBuffer(n * 4)) : null;
  const glow = def.glow ? new Uint8ClampedArray(new ArrayBuffer(n * 4)) : null;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = def.paint(x / size, y / size);
      const i = y * size + x;
      color.set([t.rgb[0], t.rgb[1], t.rgb[2], 255], i * 4);
      heights[i] = t.height;
      if (rough) {
        const r = Math.round(clamp01(t.rough ?? def.roughness) * 255);
        rough.set([r, r, r, 255], i * 4);
      }
      if (glow) glow.set([t.glow?.[0] ?? 0, t.glow?.[1] ?? 0, t.glow?.[2] ?? 0, 255], i * 4);
    }
  }
  // Normals from the height field (wrapping, so the tile edges match).
  const normal = new Uint8ClampedArray(new ArrayBuffer(n * 4));
  const strength = def.normal * (size / 256) * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const h = (xx: number, yy: number) => heights[wrap(yy, size) * size + wrap(xx, size)];
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      normal.set([(-dx / len) * 127.5 + 127.5, (dy / len) * 127.5 + 127.5, (1 / len) * 127.5 + 127.5, 255], (y * size + x) * 4);
    }
  }
  const out: Painted = {
    map: canvasTexture(size, color, true),
    normalMap: canvasTexture(size, normal, false),
    roughnessMap: rough ? canvasTexture(size, rough, false) : undefined,
    emissiveMap: glow ? canvasTexture(size, glow, true) : undefined,
    roughness: def.roughness,
    metalness: def.metalness,
    emissive: def.glow,
    emissiveIntensity: def.glowIntensity,
    normalScale: 1,
  };
  painted.set(id, out);
  return out;
}

const tiled = new Map<string, Surface>();

/**
 * A pack as it should look on a solid of `scale` metres: about one tile per metre, so a long column
 * repeats the pattern instead of stretching it. Shared between solids of the same size.
 */
export function surfaceFor(pack: TexturePack, scale: Vec3, size = 512): Surface {
  const across = Math.max(1, Math.min(12, Math.round(Math.max(scale.x, scale.z))));
  const up = Math.max(1, Math.min(12, Math.round(scale.y)));
  const key = `${pack}@${size}:${across}x${up}`;
  const hit = tiled.get(key);
  if (hit) return hit;
  const base = paint(pack, size);
  const repeat = (t: Texture | undefined) => {
    if (!t) return undefined;
    const c = t.clone();
    c.repeat.set(across, up);
    c.needsUpdate = true;
    return c;
  };
  const surface: Surface = { ...base, key, map: repeat(base.map)!, normalMap: repeat(base.normalMap), roughnessMap: repeat(base.roughnessMap), emissiveMap: repeat(base.emissiveMap) };
  tiled.set(key, surface);
  return surface;
}

/** A small picture of a pack for the texture deck's buttons. */
export function packPreview(pack: TexturePack): string {
  const p = paint(pack, 96);
  const image = p.map.image as HTMLCanvasElement | undefined;
  return image?.toDataURL?.() ?? "";
}
