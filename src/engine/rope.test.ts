import { test } from "node:test";
import assert from "node:assert/strict";
import { endPoint, makeRope, parseEnd, ropeIntent, ropeLength, ropeMotion, stepRope, type RopeWorld } from "./rope.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import type { Solid } from "./physics.ts";
import type { World } from "./types.ts";

const call = (world: World, tool: string, args: Record<string, string>) => executeProposal(world, { kind: "tool_call", toolName: tool, arguments: args });
const open: RopeWorld = { solids: [], ground: () => 0 };
const at = (sim: { pos: Float64Array }, i: number) => ({ x: sim.pos[i * 3], y: sim.pos[i * 3 + 1], z: sim.pos[i * 3 + 2] });
const run = (frames: number, f: () => void) => {
  for (let i = 0; i < frames; i += 1) f();
};

test("a rope hangs straight down from its hook and holds its length", () => {
  const a = { x: 0, y: 3, z: 0 };
  const sim = makeRope({ kind: "rope", a, b: null, length: 2 });
  // Knock it sideways, then let it settle.
  for (let i = 1; i < sim.n; i += 1) sim.prev[i * 3] -= 0.002;
  run(600, () => stepRope(sim, "rope", a, null, 1 / 60, open));
  const end = at(sim, sim.n - 1);
  assert.ok(Math.abs(end.x) < 0.05 && Math.abs(end.z) < 0.05, `hangs under the hook: ${end.x.toFixed(3)}`);
  assert.ok(Math.abs(end.y - 1) < 0.06, `2 m below: ${end.y.toFixed(3)}`);
  assert.ok(Math.abs(ropeLength(sim) - 2) < 0.04, "barely stretches");
  assert.ok(ropeMotion(sim) < 1e-3, "comes to rest");
});

test("a cable between two posts sags in the middle and follows a post that moves", () => {
  const a = { x: -2, y: 2.5, z: 0 };
  let b = { x: 2, y: 2.5, z: 0 };
  const sim = makeRope({ kind: "cable", a, b, length: 4.4 });
  run(400, () => stepRope(sim, "cable", a, b, 1 / 60, open));
  const mid = at(sim, Math.floor(sim.n / 2));
  assert.ok(mid.y < 2.2 && mid.y > 1.5, `sags: ${mid.y.toFixed(2)}`);
  assert.ok(Math.abs(at(sim, sim.n - 1).x - 2) < 1e-9, "held at the far end");
  b = { x: 2, y: 2.5, z: 1 };
  run(200, () => stepRope(sim, "cable", a, b, 1 / 60, open));
  assert.ok(at(sim, Math.floor(sim.n / 2)).z > 0.3, "the middle swings toward the moved end");
});

test("it drapes over a box instead of passing through it, and lies on the ground", () => {
  const box: Solid = { id: 1, min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 }, dynamic: false, round: false, slide: "" };
  const a = { x: 0, y: 3, z: 0 };
  const sim = makeRope({ kind: "rope", a, b: null, length: 4 });
  run(600, () => stepRope(sim, "rope", a, null, 1 / 60, { solids: [box], ground: () => 0 }));
  for (let i = 0; i < sim.n; i += 1) {
    const p = at(sim, i);
    const inside = p.x > -0.49 && p.x < 0.49 && p.z > -0.49 && p.z < 0.49 && p.y < 0.99;
    assert.ok(!inside, `particle ${i} is not inside the box`);
    assert.ok(p.y >= 0, "nor under the ground");
  }
});

test("walking into a rope pushes it aside", () => {
  const a = { x: 0, y: 3, z: 0 };
  const sim = makeRope({ kind: "rope", a, b: null, length: 2.6 });
  run(200, () => stepRope(sim, "rope", a, null, 1 / 60, open));
  for (let f = 0; f < 30; f += 1) {
    const walker = { x: -0.6 + f * 0.04, y: 0, z: 0.05, r: 0.3, h: 1.6 };
    stepRope(sim, "rope", a, null, 1 / 60, { ...open, pushers: [walker] });
  }
  const low = at(sim, sim.n - 1);
  assert.ok(Math.hypot(low.x - 0.6, low.z - 0.05) >= 0.3, "the end is outside the body");
  assert.ok(ropeMotion(sim) > 1e-3, "and swinging");
});

test("big frame times stay stable", () => {
  const a = { x: 0, y: 3, z: 0 };
  const b = { x: 3, y: 3, z: 0 };
  const sim = makeRope({ kind: "lights", a, b, length: 3.3 });
  run(100, () => stepRope(sim, "lights", a, b, 0.25, { ...open, wind: { x: 0, z: 6 } }));
  for (const v of sim.pos) assert.ok(Number.isFinite(v));
  assert.ok(ropeLength(sim) < 3.3 * 1.08);
});

test("ends: points and things, followed live", () => {
  assert.deepEqual(parseEnd("1,2,3"), { x: 1, y: 2, z: 3 });
  assert.equal(parseEnd("@7"), 7);
  assert.equal(parseEnd("nope"), null);
  const w = labWorld();
  const bench = Object.values(w.entities).find((e) => e.name === "Bench")!;
  const p = endPoint(bench.id, w.entities)!;
  assert.ok(Math.abs(p.y - (bench.transform.position.y + bench.transform.scale.y / 2)) < 1e-9, "the top of it");
  assert.equal(endPoint(99999, w.entities), null);
});

test("the tool: a rope in front of you, string lights between two things by name, errors for unknown names", () => {
  const w = labWorld();
  const rope = call(w, "hang_rope", { kind: "rope" });
  assert.ok(rope.ok, rope.result);
  const r = rope.world.entities[w.nextId];
  assert.equal(r.customData.rope, "rope");
  assert.ok(Number(r.customData.length) > 1);
  const lights = call(w, "hang_rope", { kind: "lights", from: "the bench", to: "terminal" });
  assert.ok(lights.ok, lights.result);
  const l = lights.world.entities[w.nextId];
  assert.match(l.customData.a, /^@\d+$/);
  assert.match(l.customData.b, /^@\d+$/);
  const missing = call(w, "hang_rope", { kind: "cable", from: "the moon", to: "bench" });
  assert.equal(missing.ok, false);
});

test("plain requests", () => {
  assert.deepEqual(ropeIntent("hang a rope"), { tool: "hang_rope", arguments: { kind: "rope" } });
  assert.deepEqual(ropeIntent("string lights between the bench and the terminal"), { tool: "hang_rope", arguments: { kind: "lights", from: "the bench", to: "the terminal" } });
  assert.equal(ropeIntent("run a cable from here to the pillar")?.arguments.to, "the pillar");
  assert.equal(ropeIntent("hang a 5 m rope")?.arguments.length, "5");
  assert.equal(ropeIntent("paint the rope red"), null);
  assert.equal(ropeIntent("make a red cube"), null);
});
