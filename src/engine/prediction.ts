/**
 * Client-side prediction for a visitor walking on someone else's island (work item 13).
 *
 * The host is the only authority, but waiting a round trip before your own avatar moves feels broken.
 * So the visitor moves at once and tells the host what it did:
 *
 *   visitor: press key -> step() locally, show it at once -> send the input (seq n) with every unacked one
 *   host:    apply each input once, in order, with the same step() plus anything only it knows (walls,
 *            other players) -> reply with the last seq it applied and the resulting state
 *   visitor: drop acked inputs -> restart from the host's state -> replay the inputs still in flight
 *
 * When the host agrees (the usual case) the replay lands exactly where the visitor already was, and
 * nothing moves. When it disagrees (a wall the visitor did not know about), the shown position glides
 * to the corrected one over a few frames instead of snapping.
 *
 * Other players are not predicted: their snapshots are played back a little in the past and
 * interpolated, so they move smoothly however unevenly packets arrive.
 */
import type { Vec3 } from "./types.ts";

/** One frame of input. forward/strafe in [-1, 1] (W/S, D/A), turn in radians. */
export type MoveInput = { seq: number; forward: number; strafe: number; turn: number; dt: number };
export type MoveState = { position: Vec3; yaw: number };
/** An axis-aligned box the mover cannot enter (in x and z; y is ignored). */
export type Blocker = { min: Vec3; max: Vec3 };

export const WALK_SPEED = 4.6; // metres per second, the pilot's walking speed
export const MAX_DT = 0.1; // a host never trusts a longer frame than this
export const BODY_RADIUS = 0.3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

/** Does a body at (x, z) overlap the box? */
function hits(b: Blocker, x: number, z: number): boolean {
  return x > b.min.x - BODY_RADIUS && x < b.max.x + BODY_RADIUS && z > b.min.z - BODY_RADIUS && z < b.max.z + BODY_RADIUS;
}

/**
 * The movement rule both sides run. Deterministic: the same state and input always give the same
 * result, which is what lets the visitor's replay agree with the host. Inputs are clamped here, so a
 * visitor cannot walk faster by sending larger numbers.
 */
export function step(state: MoveState, input: MoveInput, blockers: Blocker[] = []): MoveState {
  const dt = clamp(input.dt, 0, MAX_DT);
  const yaw = state.yaw + clamp(input.turn, -Math.PI, Math.PI);
  let f = clamp(input.forward, -1, 1);
  let s = clamp(input.strafe, -1, 1);
  const n = Math.hypot(f, s);
  if (n > 1) {
    f /= n;
    s /= n;
  }
  // Same frame as the pilot (src/components/forge/pilot.tsx): facing (sin yaw, cos yaw), right (-cos yaw, sin yaw).
  const dx = (Math.sin(yaw) * f - Math.cos(yaw) * s) * WALK_SPEED * dt;
  const dz = (Math.cos(yaw) * f + Math.sin(yaw) * s) * WALK_SPEED * dt;
  let { x, z } = state.position;
  // Slide along walls: try each axis on its own.
  if (!blockers.some((b) => hits(b, x + dx, z))) x += dx;
  if (!blockers.some((b) => hits(b, x, z + dz))) z += dz;
  return { position: { x, y: state.position.y, z }, yaw };
}

/** Host side: applies each visitor input exactly once, in order. */
export class HostMover {
  state: MoveState;
  ack = 0;
  constructor(start: MoveState) {
    this.state = { position: { ...start.position }, yaw: start.yaw };
  }
  /** Inputs may repeat (the visitor resends until acked) or arrive out of order; old ones are ignored. */
  apply(inputs: MoveInput[], blockers: Blocker[] = []): { ack: number; state: MoveState } {
    for (const input of [...inputs].sort((a, b) => a.seq - b.seq)) {
      if (!Number.isInteger(input.seq) || input.seq <= this.ack) continue;
      this.state = step(this.state, input, blockers);
      this.ack = input.seq;
    }
    return { ack: this.ack, state: { position: { ...this.state.position }, yaw: this.state.yaw } };
  }
}

/** Visitor side: moves at once, reconciles with the host, smooths corrections. */
export class Predictor {
  /** Where the visitor really is, by its best guess (host state + unacked inputs). */
  predicted: MoveState;
  private pending: MoveInput[] = [];
  private seq = 0;
  /** The newest ack applied: a late reply carrying an older one is ignored. */
  private acked = 0;
  /** Shown minus predicted: a correction still being glided away. */
  private offset: Vec3 = { x: 0, y: 0, z: 0 };
  /** The largest correction the host has made so far (metres). */
  maxCorrection = 0;
  /** Fraction of a correction removed per second (exponential glide). */
  smoothing: number;
  blockers: Blocker[];

  constructor(start: MoveState, options: { smoothing?: number; blockers?: Blocker[] } = {}) {
    this.predicted = { position: { ...start.position }, yaw: start.yaw };
    this.smoothing = options.smoothing ?? 12;
    this.blockers = options.blockers ?? [];
  }

  /** A frame of input: applied at once. Returns the input to send (with its sequence number). */
  input(forward: number, strafe: number, turn: number, dt: number): MoveInput {
    const cmd: MoveInput = { seq: ++this.seq, forward, strafe, turn, dt };
    this.pending.push(cmd);
    this.predicted = step(this.predicted, cmd, this.blockers);
    this.decay(dt);
    return cmd;
  }

  /** Everything the host has not acknowledged yet: send all of it each time, so a lost packet costs nothing. */
  unacked(): MoveInput[] {
    return this.pending.slice();
  }

  /** A reply from the host. Replays what it has not seen yet on top of what it says. */
  reconcile(ack: number, state: MoveState) {
    if (ack < this.acked) return; // a reply that was overtaken by a newer one
    this.acked = ack;
    this.pending = this.pending.filter((p) => p.seq > ack);
    let s: MoveState = { position: { ...state.position }, yaw: state.yaw };
    for (const p of this.pending) s = step(s, p, this.blockers);
    const before = this.shown().position;
    const moved = Math.hypot(s.position.x - this.predicted.position.x, s.position.z - this.predicted.position.z);
    this.maxCorrection = Math.max(this.maxCorrection, moved);
    this.predicted = s;
    // Keep showing where we were; glide from there.
    this.offset = { x: before.x - s.position.x, y: before.y - s.position.y, z: before.z - s.position.z };
    if (Math.hypot(this.offset.x, this.offset.z) > 3) this.offset = { x: 0, y: 0, z: 0 }; // too far to glide: snap
  }

  private decay(dt: number) {
    const k = Math.exp(-this.smoothing * Math.max(0, dt));
    this.offset = { x: this.offset.x * k, y: this.offset.y * k, z: this.offset.z * k };
    if (Math.hypot(this.offset.x, this.offset.y, this.offset.z) < 1e-4) this.offset = { x: 0, y: 0, z: 0 };
  }

  /** Where to draw the visitor's own avatar this frame. */
  shown(): MoveState {
    const p = this.predicted.position;
    return { position: { x: p.x + this.offset.x, y: p.y + this.offset.y, z: p.z + this.offset.z }, yaw: this.predicted.yaw };
  }

  get inFlight(): number {
    return this.pending.length;
  }
}

/** Snapshots of another player, played back `delay` seconds in the past and interpolated. */
export class Interpolator {
  private snaps: { t: number; position: Vec3 }[] = [];
  delay: number;
  /** Extrapolate at most this long past the newest snapshot, then hold still. */
  maxExtrapolate: number;
  constructor(delay = 0.1, maxExtrapolate = 0.25) {
    this.delay = delay;
    this.maxExtrapolate = maxExtrapolate;
  }

  /** A snapshot taken by the host at time `t` (host clock, seconds). Late or duplicate ones are dropped. */
  push(t: number, position: Vec3) {
    if (this.snaps.length && t <= this.snaps[this.snaps.length - 1].t) return;
    this.snaps.push({ t, position: { ...position } });
    if (this.snaps.length > 64) this.snaps.shift();
  }

  /** Where to draw it at host time `now`. */
  at(now: number): Vec3 | null {
    if (!this.snaps.length) return null;
    const t = now - this.delay;
    const s = this.snaps;
    if (t <= s[0].t) return { ...s[0].position };
    for (let i = 1; i < s.length; i += 1) {
      if (t <= s[i].t) {
        const a = s[i - 1];
        const b = s[i];
        const u = (t - a.t) / (b.t - a.t);
        return { x: a.position.x + (b.position.x - a.position.x) * u, y: a.position.y + (b.position.y - a.position.y) * u, z: a.position.z + (b.position.z - a.position.z) * u };
      }
    }
    const last = s[s.length - 1];
    if (s.length < 2) return { ...last.position };
    const prev = s[s.length - 2];
    const over = Math.min(t - last.t, this.maxExtrapolate);
    const span = last.t - prev.t;
    const v = { x: (last.position.x - prev.position.x) / span, y: (last.position.y - prev.position.y) / span, z: (last.position.z - prev.position.z) / span };
    return { x: last.position.x + v.x * over, y: last.position.y + v.y * over, z: last.position.z + v.z * over };
  }
}
