import { test } from "node:test";
import assert from "node:assert/strict";
import { boundsOf, makeBody, newRigidWorld, push, rigidIntent, rotate, stepRigid } from "./rigid.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import type { Solid } from "./physics.ts";

const flat = () => 0;
const ID = { x: 0, y: 0, z: 0, w: 1 };
const run = (w: ReturnType<typeof newRigidWorld>, seconds: number, statics: Solid[] = []) => {
  for (let t = 0; t < seconds; t += 1 / 60) stepRigid(w, 1 / 60, -9.81, statics, flat);
};
const upOf = (q: { x: number; y: number; z: number; w: number }) => rotate(q, { x: 0, y: 1, z: 0 });

test("a box dropped on the ground lands, settles flat and sleeps without sinking", () => {
  const w = newRigidWorld();
  const box = makeBody(1, { x: 0, y: 1, z: 0 }, ID, { x: 0.25, y: 0.25, z: 0.25 }, 1);
  w.bodies.push(box);
  run(w, 3);
  assert.ok(Math.abs(box.p.y - 0.25) < 0.02, `rests on the ground: ${box.p.y.toFixed(3)}`);
  assert.ok(box.asleep, "and sleeps");
});

test("a stack of five boxes stands", () => {
  const w = newRigidWorld();
  for (let i = 0; i < 5; i += 1) w.bodies.push(makeBody(i + 1, { x: 0, y: 0.2 + i * 0.4, z: 0 }, ID, { x: 0.3, y: 0.2, z: 0.3 }, 1));
  run(w, 4);
  const top = w.bodies[4];
  assert.ok(Math.abs(top.p.x) < 0.05 && Math.abs(top.p.z) < 0.05, `the top stays over the bottom: ${top.p.x.toFixed(3)}, ${top.p.z.toFixed(3)}`);
  assert.ok(Math.abs(top.p.y - 1.8) < 0.08, `and at its height: ${top.p.y.toFixed(3)}`);
  assert.ok(upOf(top.q).y > 0.99, "upright");
});

test("a box tipped over an edge tumbles: it turns as it falls", () => {
  const w = newRigidWorld();
  const ledge: Solid = { id: 99, min: { x: -2, y: 0, z: -1 }, max: { x: 0, y: 1, z: 1 }, dynamic: false, round: false, slide: "" };
  const box = makeBody(1, { x: 0.05, y: 1.25, z: 0 }, ID, { x: 0.25, y: 0.25, z: 0.25 }, 1);
  w.bodies.push(box);
  push(box, { x: 0.6, y: 0, z: 0 });
  run(w, 3, [ledge]);
  assert.ok(box.p.y < 0.6, `fell off the ledge: ${box.p.y.toFixed(2)}`);
  const turned = Math.acos(Math.min(1, Math.abs(upOf(box.q).y)));
  assert.ok(turned > 0.2 || Math.abs(upOf(box.q).x) > 0.2 || Math.abs(box.q.w) < 0.99, "and turned on the way");
});

test("dominoes: push the first and they all fall", () => {
  const w = newRigidWorld();
  const n = 8;
  for (let i = 0; i < n; i += 1) w.bodies.push(makeBody(i + 1, { x: i * 0.32, y: 0.25, z: 0 }, ID, { x: 0.04, y: 0.25, z: 0.12 }, 0.4));
  run(w, 1);
  assert.ok(w.bodies.every((b) => upOf(b.q).y > 0.98), "they stand on their own first");
  push(w.bodies[0], { x: 0.25, y: 0, z: 0 }, { x: 0, y: 0.45, z: 0 });
  run(w, 6);
  const fallen = w.bodies.filter((b) => upOf(b.q).y < 0.7).length;
  assert.ok(fallen >= n - 1, `${fallen} of ${n} fell`);
  for (const b of w.bodies) assert.ok(b.p.y > 0 && Number.isFinite(b.p.x));
});

test("bounds of a turned box hold it", () => {
  const b = makeBody(1, { x: 0, y: 0, z: 0 }, { x: 0, y: Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8) }, { x: 1, y: 0.5, z: 0.2 }, 1);
  const box = boundsOf(b);
  assert.ok(Math.abs(box.max.x - (Math.SQRT1_2 * 1.2)) < 1e-9 && Math.abs(box.max.y - 0.5) < 1e-9);
});

test("toys from words and tools: dominoes, a Jenga tower, knocking them over", () => {
  assert.deepEqual(rigidIntent("line up 30 dominoes"), { tool: "build_dominoes", arguments: { count: "30" } });
  assert.deepEqual(rigidIntent("build a jenga tower"), { tool: "build_jenga", arguments: {} });
  assert.equal(rigidIntent("knock them over")?.tool, "knock_over");
  assert.equal(rigidIntent("make a red cube"), null);
  const w = labWorld();
  const d = executeProposal(w, { kind: "tool_call", toolName: "build_dominoes", arguments: { count: "10" } });
  assert.ok(d.ok, d.result);
  const dom = Object.values(d.world.entities).filter((e) => e.tags.includes("dominoes"));
  assert.equal(dom.length, 10);
  assert.ok(dom.every((e) => e.physics && !e.physics.isKinematic && e.tags.includes("rigid")));
  const j = executeProposal(w, { kind: "tool_call", toolName: "build_jenga", arguments: { levels: "6" } });
  assert.equal(Object.values(j.world.entities).filter((e) => e.tags.includes("jenga")).length, 18);
  const k = executeProposal(d.world, { kind: "tool_call", toolName: "knock_over", arguments: {} });
  const first = Object.values(k.world.entities).filter((e) => e.tags.includes("dominoes")).sort((a, b) => a.id - b.id)[0];
  assert.ok(Math.hypot(first.physics!.velocity.x, first.physics!.velocity.z) > 1);
});

test("a Jenga tower of 12 layers stands until it is shoved", () => {
  const w = newRigidWorld();
  const block = { x: 0.125, y: 0.075, z: 0.375 };
  let id = 1;
  for (let level = 0; level < 12; level += 1) {
    const turn = level % 2 ? Math.PI / 2 : 0;
    for (let k = -1; k <= 1; k += 1) {
      const off = k * 0.254;
      w.bodies.push(makeBody(id++, { x: Math.cos(turn) * off, y: 0.075 + level * 0.151 + 0.001, z: -Math.sin(turn) * off }, { x: 0, y: Math.sin(turn / 2), z: 0, w: Math.cos(turn / 2) }, block, 0.5));
    }
  }
  run(w, 3);
  const top = w.bodies.slice(-3);
  for (const b of top) assert.ok(b.p.y > 1.6, `the top layer is still up: ${b.p.y.toFixed(2)}`);
  for (const b of top) push(b, { x: 2, y: 0, z: 0 });
  run(w, 3);
  assert.ok(w.bodies.slice(-3).some((b) => b.p.y < 1.5), "shoved, the top comes down");
});
