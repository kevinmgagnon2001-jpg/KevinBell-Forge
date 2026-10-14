/**
 * The land around the lab, as numbers (Scenery.tsx draws it). Deterministic: every device sees the
 * same hills, lake and forest, and nothing of it is saved or shared.
 *
 *   plaza    r < PLAZA_RADIUS     the stone floor the lab stands on, at y = 0
 *   meadow   r < MEADOW_RADIUS    almost flat grass, so walking off the plaza stays on the ground
 *   hills    beyond the meadow    rolling, up to ~10 m
 *   lake     LAKE                 a basin below WATER_Y
 *   ranges   r > ~110             mountains, misty with distance
 *
 * Bodies still stand on y = 0 (manifold.ts); the scenery only decorates, it never collides.
 */

export const PLAZA_RADIUS = 15;
export const MEADOW_RADIUS = 30;
export const WATER_Y = -0.7;
export const LAKE = { x: -40, z: -38, r: 15 } as const;
/** How far the land reaches from the lab (half its width). */
export const LAND_HALF = 300;

function hash(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise in [-1, 1]. */
export function noise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
}

/** Fractal noise in about [-1, 1]. */
export function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise2(x * freq + i * 17.3, z * freq - i * 9.1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Sharp ridges in [0, 1], for mountains. */
function ridged(x: number, z: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 5; i += 1) {
    const n = 1 - Math.abs(noise2(x * freq + i * 31.7, z * freq + i * 5.3));
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Ground height at (x, z). Under the plaza it sits just below the stone. */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < PLAZA_RADIUS) return -0.06;
  const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z);
  const shore = smoothstep(LAKE.r * 0.55, LAKE.r * 1.7, lakeD);
  const meadow = fbm(x * 0.07, z * 0.07, 3) * 0.08 * smoothstep(PLAZA_RADIUS, PLAZA_RADIUS + 6, r);
  const hills = (fbm(x * 0.017, z * 0.017) * 0.5 + 0.55) * 11 * smoothstep(MEADOW_RADIUS, MEADOW_RADIUS + 34, r) * shore;
  const ranges = smoothstep(95, 175, r) * (ridged(x * 0.009, z * 0.009) * 62 + 6);
  const basin = -3.2 * (1 - smoothstep(0, LAKE.r * 1.05, lakeD));
  return -0.04 + meadow + hills + ranges + basin;
}

/** How steep the ground is at (x, z): 0 flat, 1 at 45 degrees. */
export function slopeAt(x: number, z: number): number {
  const e = 0.8;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

/** Seeded random in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Spot = { x: number; y: number; z: number; yaw: number; scale: number; tint: number };

/**
 * Up to `count` spots between rings `inner` and `outer`, on dry ground no steeper than `maxSlope`.
 * `clump` (0..1) gathers them into patches (forests, meadows) instead of spreading them evenly.
 */
export function scatter(seed: number, count: number, inner: number, outer: number, opts: { maxSlope?: number; clump?: number; minY?: number; maxY?: number } = {}): Spot[] {
  const rand = seeded(seed);
  const { maxSlope = 0.6, clump = 0, minY = WATER_Y + 0.35, maxY = 40 } = opts;
  const out: Spot[] = [];
  for (let tries = 0; out.length < count && tries < count * 30; tries += 1) {
    // Even over the ring's area, not bunched at its centre.
    const r = Math.sqrt(inner * inner + rand() * (outer * outer - inner * inner));
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (clump > 0 && fbm(x * 0.035 + seed, z * 0.035) * 0.5 + 0.5 < clump * 0.75 * rand() + clump * 0.25) continue;
    const y = heightAt(x, z);
    if (y < minY || y > maxY || slopeAt(x, z) > maxSlope) continue;
    out.push({ x, y, z, yaw: rand() * Math.PI * 2, scale: 0.7 + rand() * 0.6, tint: rand() });
  }
  return out;
}
