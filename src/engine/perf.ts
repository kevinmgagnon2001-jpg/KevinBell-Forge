/**
 * Auto quality: Forge watches its own frame rate (and, on Android, how hot the phone is) and steps
 * the picture down a rung when it struggles, or back up when it has room. The overlay that shows
 * the numbers is PerfOverlay.tsx; the hardware tier picks the starting rung (hardware.ts).
 *
 * The ladder, best first. Sharpness goes first (cheap to change), then shadows, then scenery detail
 * (which rebuilds the land, so it changes least often).
 */
import type { Quality, SceneryChoice } from "./hardware.ts";

/**
 * post: the picture's finishing (PostFX.tsx). "eleven" is everything: ambient occlusion at full
 * size, bloom, AgX tone mapping, SMAA, a vignette and grain, 4096 shadows and a denser meadow; it may
 * run at 30-45 fps. "high" keeps occlusion at half size and bloom; "lite" is bloom and SMAA.
 */
export type Post = "eleven" | "high" | "lite" | "none";
export type Rung = { name: string; scenery: SceneryChoice; dpr: number; shadows: boolean; post: Post };

export const LADDER: Rung[] = [
  { name: "11", scenery: "full", dpr: 2, shadows: true, post: "eleven" },
  { name: "Ultra", scenery: "full", dpr: 2, shadows: true, post: "high" },
  { name: "High", scenery: "full", dpr: 1.5, shadows: true, post: "lite" },
  { name: "Medium", scenery: "lite", dpr: 1.5, shadows: true, post: "none" },
  { name: "Low", scenery: "lite", dpr: 1.25, shadows: false, post: "none" },
  { name: "Lowest", scenery: "min", dpr: 1, shadows: false, post: "none" },
  { name: "Plain", scenery: "off", dpr: 1, shadows: false, post: "none" },
];

const at = (name: string) => LADDER.findIndex((r) => r.name === name);

/** Where the hardware tier starts on the ladder (and the best it may climb to). */
export function startRung(quality: Quality): number {
  const i = LADDER.findIndex((r) => r.scenery === quality.scenery && r.shadows === quality.shadows);
  if (quality.scenery === "full") return quality.dpr[1] >= 2 ? at("11") : at("High");
  if (quality.scenery === "lite") return at("Medium");
  if (quality.scenery === "min") return at("Lowest");
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
/**
 * Whether a frame's time is a pause, not a slow frame: the first frame after the page comes back
 * (another app, the lock screen, the GitHub page a report opens) spans the whole time away. Without
 * knowing, a frame over two seconds is taken as a pause too; a real stall that long is not a frame
 * rate problem but a freeze, and errors or Android's "not responding" catch those.
 */
export function isPauseGap(deltaMs: number, resumed: boolean): boolean {
  return resumed || deltaMs > 2000;
}

export function frameStats(times: number[]): { fps: number; avg: number; worst: number } {
  if (!times.length) return { fps: 0, avg: 0, worst: 0 };
  const total = times.reduce((a, b) => a + b, 0);
  const avg = total / times.length;
  return { fps: avg > 0 ? 1000 / avg : 0, avg, worst: Math.max(...times) };
}
