import assert from "node:assert/strict";
import test from "node:test";
import { IslandHost } from "./island-content.ts";
import { labWorld } from "./manifold.ts";
import { HostMover, Interpolator, Predictor, step, WALK_SPEED, type Blocker, type MoveInput, type MoveState } from "./prediction.ts";
import type { Entity } from "./types.ts";

const FRAME = 1 / 60;
const start: MoveState = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Deterministic pseudo-random numbers, so the lossy network is the same on every run. */
function rng(seed: number) {
  return () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    return seed / 2 ** 32;
  };
}

/**
 * A visitor walking for `seconds` on a host `latency` seconds away (each way). Every frame the visitor
 * sends all unacked inputs; packets can be lost or delayed further (jitter). The host applies them on
 * arrival and replies at once.
 */
function walk(opts: { seconds: number; latency: number; loss?: number; jitter?: number; hostBlockers?: Blocker[]; path?: (t: number) => [number, number, number] }) {
  const random = rng(7);
  const host = new HostMover(start);
  const me = new Predictor(start);
  type Packet<T> = { at: number; body: T };
  let up: Packet<MoveInput[]>[] = [];
  let down: Packet<{ ack: number; state: MoveState }>[] = [];
  const frames: { shown: MoveState; t: number }[] = [];
  const path = opts.path ?? (() => [1, 0, 0]);
  const total = Math.round(opts.seconds / FRAME);
  const settle = Math.round((2 * opts.latency + 0.5) / FRAME);
  for (let f = 0; f < total + settle; f += 1) {
    const t = f * FRAME;
    if (f < total) {
      const [fw, st, turn] = path(t);
      me.input(fw, st, turn * FRAME, FRAME);
    } else me.input(0, 0, 0, FRAME); // standing still while the last replies come in
    const lost = () => random() < (opts.loss ?? 0);
    const delay = () => opts.latency + (opts.jitter ?? 0) * random();
    if (!lost()) up.push({ at: t + delay(), body: me.unacked() });
    for (const p of up.filter((p) => p.at <= t)) {
      const reply = host.apply(p.body, opts.hostBlockers);
      if (!lost()) down.push({ at: t + delay(), body: reply });
    }
    up = up.filter((p) => p.at > t);
    for (const p of down.filter((p) => p.at <= t).sort((a, b) => a.at - b.at)) me.reconcile(p.body.ack, p.body.state);
    down = down.filter((p) => p.at > t);
    frames.push({ shown: me.shown(), t });
  }
  return { host, me, frames, total };
}

test("your own avatar moves on the frame you press the key, whatever the latency", () => {
  const me = new Predictor(start);
  me.input(1, 0, 0, FRAME);
  assert.ok(me.shown().position.z > 0.07, "moved forward at once");
  assert.equal(me.inFlight, 1);
  me.input(0, 1, 0, FRAME); // D: strafe right, which is -x when facing +z (the pilot's frame)
  assert.ok(me.shown().position.x < -0.07);
});

test("at 150 ms each way, with no walls the host agrees exactly: nothing ever jumps", () => {
  const curvy = (t: number): [number, number, number] => [1, Math.sin(t * 2) * 0.5, Math.cos(t) * 1.2];
  const { host, me, frames, total } = walk({ seconds: 4, latency: 0.15, path: curvy });
  assert.ok(me.maxCorrection < 1e-9, `largest correction ${me.maxCorrection}`);
  // Every input reached the host except those sent in the last 150 ms, still on the wire.
  assert.ok(host.ack <= frames.length && host.ack >= frames.length - Math.ceil(0.15 / FRAME) - 1, `ack ${host.ack} of ${frames.length}`);
  // Every frame moves by exactly one walking step or less: no rubber-banding.
  for (let i = 1; i < frames.length; i += 1) assert.ok(dist(frames[i].shown.position, frames[i - 1].shown.position) <= WALK_SPEED * FRAME + 1e-9, `frame ${i}`);
  assert.ok(dist(me.shown().position, host.state.position) < 1e-9);
  assert.ok(total > 0);
});

test("lost and late packets cost nothing: unacked inputs are resent and applied once", () => {
  const { host, me } = walk({ seconds: 3, latency: 0.15, loss: 0.25, jitter: 0.08, path: (t) => [1, 0, t < 1.5 ? 0.8 : -0.8] });
  assert.ok(me.maxCorrection < 1e-9, `largest correction ${me.maxCorrection}`);
  assert.ok(dist(me.shown().position, host.state.position) < 1e-9);
  assert.ok(Math.abs(me.shown().yaw - host.state.yaw) < 1e-12);
});

test("a wall only the host knows: the host wins, and the avatar glides there instead of snapping", () => {
  const wall: Blocker = { min: { x: -5, y: 0, z: 2 }, max: { x: 5, y: 3, z: 2.5 } };
  const { host, me, frames } = walk({ seconds: 2, latency: 0.15, hostBlockers: [wall] });
  assert.ok(host.state.position.z < 2 - 0.29, "the host stopped the walker at the wall");
  assert.ok(me.maxCorrection > 0, "the host corrected the visitor");
  // The shown position never jumps by more than a step plus a small glide per frame.
  let worst = 0;
  for (let i = 1; i < frames.length; i += 1) worst = Math.max(worst, dist(frames[i].shown.position, frames[i - 1].shown.position));
  assert.ok(worst < 0.25, `largest jump in one frame: ${worst} m`);
  assert.ok(dist(me.shown().position, host.state.position) < 0.01, "converged on the host's answer");
});

test("a visitor cannot walk faster by sending bigger numbers", () => {
  const cheat = step(start, { seq: 1, forward: 50, strafe: 50, turn: 0, dt: 5 });
  assert.ok(dist(cheat.position, start.position) <= WALK_SPEED * 0.1 + 1e-9);
  const host = new HostMover(start);
  host.apply([{ seq: 2, forward: 1, strafe: 0, turn: 0, dt: 0.05 }, { seq: 1, forward: 1, strafe: 0, turn: 0, dt: 0.05 }]);
  assert.equal(host.ack, 2);
  const before = host.state.position.z;
  host.apply([{ seq: 2, forward: 1, strafe: 0, turn: 0, dt: 0.05 }]);
  assert.equal(host.state.position.z, before, "a repeated input is ignored");
});

test("other players play back smoothly from uneven snapshots", () => {
  const random = rng(3);
  const lerp = new Interpolator(0.1);
  const speed = 3;
  // The host snapshots at 20 Hz; packets arrive with up to 60 ms of jitter, some out of order.
  const arrivals: { arrive: number; t: number }[] = [];
  for (let t = 0; t < 3; t += 0.05) arrivals.push({ arrive: t + 0.15 + random() * 0.06, t });
  arrivals.sort((a, b) => a.arrive - b.arrive);
  let last: number | null = null;
  let worst = 0;
  for (let f = 0; f < 180; f += 1) {
    const now = 0.3 + f * FRAME;
    while (arrivals.length && arrivals[0].arrive <= now) {
      const a = arrivals.shift()!;
      lerp.push(a.t, { x: a.t * speed, y: 0, z: 0 });
    }
    const p = lerp.at(now - 0.15)!;
    if (last !== null) {
      assert.ok(p.x >= last - 1e-9, "never moves backwards");
      worst = Math.max(worst, p.x - last);
    }
    last = p.x;
  }
  assert.ok(worst <= speed * FRAME * 1.6, `largest step ${worst}`);
});

test("two visitors on one host: the host walks each from their inputs, each stays under budget", () => {
  const world = labWorld();
  const host = new IslandHost(world);
  const a = host.open("ana-1234", ["render", "input"]);
  const b = host.open("ben-5678", ["render", "input"]);
  const view = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, budget: 8000 };
  const pa = new Predictor(start);
  const pb = new Predictor({ position: { x: 1, y: 0, z: 0 }, yaw: 0 });
  for (let f = 0; f < 30; f += 1) {
    pa.input(1, 0, 0, FRAME);
    pb.input(0, 1, 0, FRAME);
    const ra = host.sync(a, view, pa.unacked());
    const rb = host.sync(b, { ...view, position: { x: 1, y: 0, z: 0 } }, pb.unacked());
    assert.ok(!("error" in ra) && !("error" in rb));
    if ("error" in ra || "error" in rb) return;
    assert.ok(ra.bytes <= 8000 && rb.bytes <= 8000);
    pa.reconcile(ra.you!.ack, ra.you!.state);
    pb.reconcile(rb.you!.ack, rb.you!.state);
  }
  assert.ok(pa.maxCorrection < 1e-9 && pb.maxCorrection < 1e-9);
  const presence = Object.values(host.world.entities).filter((e: Entity) => e.tags.includes("presence"));
  assert.equal(presence.length, 2);
  const ana = presence.find((e) => e.customData.visitor === "ana-1234")!;
  assert.ok(Math.abs(ana.transform.position.z - pa.predicted.position.z) < 1e-9, "others see where the host put Ana");
  const viewer = host.open("cam", ["render"]);
  assert.deepEqual(host.sync(viewer, view, []), { error: "input was not granted", status: 403 });
  assert.deepEqual(host.sync(a, view, [{ seq: 0 } as unknown as MoveInput]), { error: "inputs are malformed", status: 400 });
});
