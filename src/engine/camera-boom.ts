/**
 * The third-person camera's boom: a line from a pivot over the shoulders out to where the camera
 * wants to be. When a wall, an exhibit or a hill is in the way, the camera slides in along the
 * line to just in front of it, so the body is never hidden behind something; it pulls in at once
 * and eases back out once the way is clear.
 */
import type { Solid } from "./physics.ts";

/** Room kept between the camera and what it would hit, m. */
export const BOOM = { pad: 0.22, min: 0.6, outRate: 3.2 } as const;

type P = { x: number; y: number; z: number };

/** Where a segment from `a` to `b` first enters a box grown by `grow`, as a share 0..1 of the way (1 when it does not). */
export function segmentHit(a: P, b: P, s: Solid, grow = 0): number {
  let enter = 0;
  let exit = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const o = a[axis];
    const d = b[axis] - o;
    const lo = s.min[axis] - grow;
    const hi = s.max[axis] + grow;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return 1;
      continue;
    }
    const t0 = (lo - o) / d;
    const t1 = (hi - o) / d;
    enter = Math.max(enter, Math.min(t0, t1));
    exit = Math.min(exit, Math.max(t0, t1));
    if (enter > exit) return 1;
  }
  // Starting inside it (the pivot in a thin exhibit): ignore it rather than snap to the body.
  if (enter <= 0) return 1;
  return enter;
}

/**
 * How far out along the boom the camera may sit (metres from the pivot), against the solids and
 * the land. Solids the pivot is inside, and loose (dynamic) things, do not count.
 */
export function boomReach(pivot: P, want: P, solids: Solid[], ground: (x: number, z: number) => number): number {
  const len = Math.hypot(want.x - pivot.x, want.y - pivot.y, want.z - pivot.z);
  if (len < 1e-6) return 0;
  let t = 1;
  for (const s of solids) {
    if (s.dynamic) continue;
    // Small things (a vase, a gem) can pass in front of the camera.
    if (s.max.x - s.min.x < 0.35 && s.max.z - s.min.z < 0.35) continue;
    t = Math.min(t, segmentHit(pivot, want, s, 0.05));
  }
  // The land: march along the boom and stop just above where it dips under the ground.
  const steps = Math.max(4, Math.ceil(len / 0.4));
  for (let i = 1; i <= steps; i += 1) {
    const k = (i / steps) * t;
    const x = pivot.x + (want.x - pivot.x) * k;
    const y = pivot.y + (want.y - pivot.y) * k;
    const z = pivot.z + (want.z - pivot.z) * k;
    if (y < ground(x, z) + 0.15) {
      t = Math.min(t, ((i - 1) / steps) * t);
      break;
    }
  }
  return Math.max(BOOM.min, t * len - BOOM.pad);
}

/** Ease the boom's length: in at once, out gently. */
export function easeBoom(current: number, reach: number, dt: number): number {
  if (!Number.isFinite(current) || reach < current) return reach;
  return current + (reach - current) * (1 - Math.exp(-dt * BOOM.outRate));
}
