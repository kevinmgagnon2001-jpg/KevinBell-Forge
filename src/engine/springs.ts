/**
 * Secondary motion: things that hang off a body (an antenna, a ponytail, a tail, a belly) lag
 * behind when it speeds up, overshoot when it stops and settle with a wobble. In the spirit of
 * Fast Complementary Dynamics (SIGGRAPH 2023): the body's animation stays exactly as authored, and
 * only the extra parts get physics, as a few damped springs on the CPU. A handful per figure costs
 * nothing next to drawing it.
 *
 * Also here: the gait's phase (DeepPhase, Starke et al. 2022, done by hand). A walk is a cycle; the
 * feet are both on the ground at phase 0 and pi. `stepPhase` finishes the step you are in when you
 * stop, so the feet land instead of sliding back to standing, and `alignPhase` starts the cycle at
 * the phase that matches the legs you already have (out of a dance, a landing), so blends line up.
 */

export type Spring = { x: number; v: number };
export type Spring2 = { x: Spring; z: Spring };

export const spring = (): Spring => ({ x: 0, v: 0 });
export const spring2 = (): Spring2 => ({ x: spring(), z: spring() });

/**
 * One damped spring toward `target`: natural frequency `hz`, damping ratio `zeta` (1 is critical,
 * lower wobbles), plus an outside acceleration `push`. Semi-implicit Euler in steps of at most 1/120 s,
 * so it stays stable at any frame rate.
 */
export function stepSpring(s: Spring, target: number, dt: number, hz: number, zeta: number, push = 0): Spring {
  const w = Math.PI * 2 * hz;
  let { x, v } = s;
  let left = Math.max(0, Math.min(dt, 0.25));
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 120);
    const a = -w * w * (x - target) - 2 * zeta * w * v + push;
    v += a * h;
    x += v * h;
    left -= h;
  }
  return { x, v };
}

export type JiggleParams = { hz: number; zeta: number; /** radians of tilt per m/s² */ gain: number; /** most tilt, radians */ limit: number };

export const JIGGLE: Record<"antenna" | "ponytail" | "belly", JiggleParams> = {
  antenna: { hz: 2.6, zeta: 0.18, gain: 0.06, limit: 0.9 },
  ponytail: { hz: 1.7, zeta: 0.32, gain: 0.08, limit: 1.1 },
  belly: { hz: 4.5, zeta: 0.25, gain: 0.012, limit: 0.12 },
};

/**
 * A part hanging from a body tilts against the body's acceleration (local to the body: x to its left,
 * z forward). Speed up forward and the antenna leans back; stop and it swings forward, then settles.
 * Returns the tilt about x (forward and back) and about z (side to side), in radians.
 */
export function jiggle(state: Spring2, accel: { x: number; z: number }, dt: number, p: JiggleParams): Spring2 {
  const clamp = (v: number) => Math.max(-p.limit, Math.min(p.limit, v));
  // Leaning back is +x rotation for a part pointing up; sideways acceleration to the left tilts it right.
  const x = stepSpring(state.x, 0, dt, p.hz, p.zeta, -accel.z * p.gain * (Math.PI * 2 * p.hz) ** 2);
  const z = stepSpring(state.z, 0, dt, p.hz, p.zeta, accel.x * p.gain * (Math.PI * 2 * p.hz) ** 2);
  return { x: { x: clamp(x.x), v: x.v }, z: { x: clamp(z.x), v: z.v } };
}

/** Track a moving point's velocity and acceleration from its positions, smoothed a little. */
export type Tracker = { px: number; py: number; pz: number; vx: number; vy: number; vz: number; ax: number; ay: number; az: number; ready: boolean };
export const tracker = (): Tracker => ({ px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0, ready: false });

export function track(t: Tracker, x: number, y: number, z: number, dt: number): Tracker {
  if (!t.ready || dt <= 0) return { ...tracker(), px: x, py: y, pz: z, ready: true };
  const vx = (x - t.px) / dt;
  const vy = (y - t.py) / dt;
  const vz = (z - t.pz) / dt;
  // A teleport (respawn, portal) is not an acceleration.
  if (Math.hypot(vx, vy, vz) > 40) return { ...tracker(), px: x, py: y, pz: z, ready: true };
  const k = 1 - Math.exp(-dt * 20);
  const ax = t.ax + (((vx - t.vx) / dt) - t.ax) * k;
  const ay = t.ay + (((vy - t.vy) / dt) - t.ay) * k;
  const az = t.az + (((vz - t.vz) / dt) - t.az) * k;
  const lim = (v: number) => Math.max(-60, Math.min(60, v));
  return { px: x, py: y, pz: z, vx, vy, vz, ax: lim(ax), ay: lim(ay), az: lim(az), ready: true };
}

// ---------- the gait's phase ----------

const TAU = Math.PI * 2;

/**
 * Advance the walk cycle. Moving, the phase runs with the ground speed (one cycle per stride).
 * Stopping, it keeps going at a stepping pace until the next double support (phase 0 or pi), then
 * holds there: the step finishes on the ground.
 */
export function stepPhase(phase: number, speed: number, stride: number, dt: number): number {
  const rate = (speed / Math.max(0.2, stride)) * TAU;
  const settle = TAU * 0.9;
  if (speed > 0.15) return (phase + rate * dt) % TAU;
  const rest = Math.ceil((phase - 1e-6) / Math.PI) * Math.PI;
  const next = phase + settle * dt;
  if (next >= rest) return rest % TAU;
  return next % TAU;
}

/** How far the phase is from a double support (0 when both feet are down, 1 mid-swing). */
export const swingOf = (phase: number) => Math.abs(Math.sin(phase));

/**
 * The phase whose walk legs best match these hips and knees. The walk puts hipL = -sin(phase) * swing
 * and hipR = +sin(phase) * swing, with the knee of the leg swinging forward bent; so the hip spread
 * gives sin, and which knee is bent gives the half of the cycle.
 */
export function alignPhase(hipL: number, hipR: number, kneeL: number, kneeR: number, swing: number): number {
  const s = Math.max(-1, Math.min(1, (hipR - hipL) / 2 / Math.max(0.05, swing)));
  const base = Math.asin(s);
  // The walk bends the left knee when cos(phase) < 0, the right when cos(phase) > 0.
  const leftBent = kneeL > kneeR + 0.02;
  const phase = leftBent ? Math.PI - base : base;
  return ((phase % TAU) + TAU) % TAU;
}
