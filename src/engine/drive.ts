/**
 * Walking from an analog stick, the way modern action games do it: the stick puts a point on the
 * ground around you (its direction, at a distance that grows with how far you push), and the body
 * chases that point. A light push walks, further jogs, all the way runs, smoothly in between; a push
 * to the side turns you and steps that way, and a push back turns you round (the body pivots before
 * it goes, so it never moonwalks).
 */

/** Ground speeds, m/s. */
export const PACE = { walk: 1.5, jog: 4.6, run: 7.4 };

/** How hard a key push counts (no stick): a jog, or a run with Shift. */
export const KEY_PUSH = { jog: 0.76, run: 1 };

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/** Ground speed for a push of 0..1: a walk up to half way, then easing up through a jog to a run. */
export function driveSpeed(push: number): number {
  const p = Math.max(0, Math.min(1, push));
  if (p < 0.08) return 0;
  if (p < 0.5) return PACE.walk * ((p - 0.08) / 0.42);
  return PACE.walk + (PACE.run - PACE.walk) * smooth((p - 0.5) / 0.5);
}

/** The point the body chases: out along the push, further the harder you push. */
export function chasePoint(x: number, z: number, dirX: number, dirZ: number, push: number): { x: number; z: number } {
  const reach = 0.6 + Math.max(0, Math.min(1, push)) * 1.6;
  return { x: x + dirX * reach, z: z + dirZ * reach };
}

/**
 * Chase it: turn toward the point (faster the more it is behind you) and move toward it, slowing
 * while the point is well off to one side or behind, so the body pivots and then goes.
 * Returns the new facing and the wanted velocity.
 */
export function chase(yaw: number, x: number, z: number, point: { x: number; z: number }, speed: number, dt: number, turnRate = 11): { yaw: number; vx: number; vz: number } {
  const dx = point.x - x;
  const dz = point.z - z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4 || speed <= 0) return { yaw, vx: 0, vz: 0 };
  const want = Math.atan2(dx, dz);
  const off = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
  const rate = turnRate * (1 + Math.abs(off) / Math.PI);
  const step = Math.max(-rate * dt, Math.min(rate * dt, off));
  const next = yaw + step;
  const left = Math.abs(Math.atan2(Math.sin(want - next), Math.cos(want - next)));
  // Facing within ~60 degrees: full speed. Further round: slow to a pivot.
  const go = speed * Math.max(0.15, Math.min(1, Math.cos(Math.max(0, left - 0.35))));
  return { yaw: next, vx: (dx / dist) * go, vz: (dz / dist) * go };
}
