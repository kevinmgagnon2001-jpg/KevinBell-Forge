/**
 * Auto quality: Forge watches its own frame rate (and, on Android, how hot the phone is) and steps
 * the picture down a rung when it struggles, or back up when it has room. The overlay that shows
 * the numbers is PerfOverlay.tsx; the hardware tier picks the starting rung (hardware.ts).
 *
 * The ladder, best first. Each rung draws the world at `scale` of the screen's pixels and upscales
 * it (FSR 1-style, Upscaler.tsx): the picture stays at full sharpness (`dpr`) while the GPU shades
 * fewer pixels. Then shadows go, then scenery detail (which rebuilds the land, so it changes least).
 */
import type { Quality, SceneryChoice } from "./hardware.ts";

export type Rung = { name: string; scenery: SceneryChoice; dpr: number; shadows: boolean; scale: number };

export const LADDER: Rung[] = [
  { name: "Ultra", scenery: "full", dpr: 2, shadows: true, scale: 1 },
  { name: "High", scenery: "full", dpr: 2, shadows: true, scale: 0.77 },
  { name: "Medium", scenery: "lite", dpr: 2, shadows: true, scale: 0.67 },
  { name: "Low", scenery: "lite", dpr: 1.5, shadows: false, scale: 0.67 },
  { name: "Lowest", scenery: "min", dpr: 1.5, shadows: false, scale: 0.5 },
  { name: "Plain", scenery: "off", dpr: 1, shadows: false, scale: 0.75 },
];

/** Pixels shaded per CSS pixel, per axis: the output sharpness times the render scale. */
export function effectiveDpr(rung: Rung): number {
  return rung.dpr * rung.scale;
}

/** The internal render size for an output size and a scale (whole pixels, at least 1). */
export function renderSize(width: number, height: number, scale: number): { width: number; height: number } {
  const s = Math.min(1, Math.max(0.25, Number.isFinite(scale) ? scale : 1));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/**
 * `?upscale=0.5` (0.25..1) fixes the render scale, `?upscale=off` turns upscaling off; null when the
 * address says nothing. For comparing on a device.
 */
export function upscaleOverride(search: string): number | null {
  const raw = new URLSearchParams(search).get("upscale");
  if (raw == null) return null;
  if (raw === "off" || raw === "0" || raw === "1") return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(1, Math.max(0.25, n)) : null;
}

/** Where the hardware tier starts on the ladder (and the best it may climb to). */
export function startRung(quality: Quality): number {
  const i = LADDER.findIndex((r) => r.scenery === quality.scenery && r.shadows === quality.shadows);
  if (quality.scenery === "full") return quality.dpr[1] >= 2 ? 0 : 1;
  if (quality.scenery === "lite") return 2;
  if (quality.scenery === "min") return 4;
  return i >= 0 ? i : LADDER.length - 1;
}

/** Android's thermal status: 0 none, 1 light, 2 moderate, 3 severe, 4 critical, ... (-1 unknown). */
export type Sample = { now: number; fps: number; thermal: number };

export type AutoState = {
  rung: number;
  /** The best rung this device may use. */
  ceiling: number;
  lowSince: number | null;
  highSince: number | null;
  lastChange: number;
  lastUp: number;
  noUpUntil: number;
};

export const AUTO = {
  /** Below this frame rate for `lowFor` ms, step down. */
  lowFps: 28,
  lowFor: 4000,
  /** Above this for `highFor` ms (and calm long enough since the last change), try a step up. */
  highFps: 55,
  highFor: 25000,
  settle: 40000,
  /** A step up that is followed by a step down this soon was a mistake; stay put for `backoff`. */
  regret: 60000,
  backoff: 300000,
  /** Android "moderate" heat steps down at most this often. */
  heatEvery: 20000,
};

export function autoStart(rung: number, now: number): AutoState {
  return { rung, ceiling: rung, lowSince: null, highSince: null, lastChange: now, lastUp: -Infinity, noUpUntil: 0 };
}

/** The next state after one sample. The rung changes by at most one step. */
export function autoStep(state: AutoState, sample: Sample): AutoState {
  const { now, fps, thermal } = sample;
  const bottom = LADDER.length - 1;
  const down = (s: AutoState): AutoState => {
    if (s.rung >= bottom) return { ...s, lowSince: null, highSince: null };
    const regretted = now - s.lastUp < AUTO.regret;
    return { ...s, rung: s.rung + 1, lastChange: now, lowSince: null, highSince: null, noUpUntil: regretted ? now + AUTO.backoff : s.noUpUntil };
  };
  // Hot phone: severe heat steps down now; moderate heat steps down every so often.
  if (thermal >= 3 && now - state.lastChange > 3000) return down(state);
  if (thermal === 2 && now - state.lastChange > AUTO.heatEvery) return down(state);

  let s = state;
  if (fps < AUTO.lowFps) {
    s = { ...s, highSince: null, lowSince: s.lowSince ?? now };
    if (now - (s.lowSince ?? now) >= AUTO.lowFor) return down(s);
    return s;
  }
  s = { ...s, lowSince: null };
  if (fps > AUTO.highFps && thermal < 1) {
    s = { ...s, highSince: s.highSince ?? now };
    const ready = now - (s.highSince ?? now) >= AUTO.highFor && now - s.lastChange >= AUTO.settle && now >= s.noUpUntil;
    if (ready && s.rung > s.ceiling) return { ...s, rung: s.rung - 1, lastChange: now, lastUp: now, highSince: null };
    return s;
  }
  return { ...s, highSince: null };
}

/** Frames per second, the average frame time and the worst frame, from frame times in ms. */
export function frameStats(times: number[]): { fps: number; avg: number; worst: number } {
  if (!times.length) return { fps: 0, avg: 0, worst: 0 };
  const total = times.reduce((a, b) => a + b, 0);
  const avg = total / times.length;
  return { fps: avg > 0 ? 1000 / avg : 0, avg, worst: Math.max(...times) };
}
