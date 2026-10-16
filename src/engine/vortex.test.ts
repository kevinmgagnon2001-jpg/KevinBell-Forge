import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRing, ringShape, smokeRingIntent, stepRings, tracersFor, velocityAt } from "./vortex.ts";

test("a ring glides forward along its axis, keeping its size", () => {
  const ring = makeRing({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 1 }, 0.3);
  const before = ringShape(ring);
  for (let i = 0; i < 60; i += 1) stepRings([ring], 1 / 30);
  const after = ringShape(ring);
  assert.ok(after.c.z - before.c.z > 0.3, `it travels: ${(after.c.z - before.c.z).toFixed(2)} m in 2 s`);
  assert.ok(Math.abs(after.c.x) < 0.02 && Math.abs(after.c.y - 1.5) < 0.02, "straight");
  assert.ok(Math.abs(after.r - before.r) < 0.03, "about the same size");
});

test("two rings one behind the other leapfrog", () => {
  const front = makeRing({ x: 0, y: 0, z: 0.35 }, { x: 0, y: 0, z: 1 }, 0.3);
  const back = makeRing({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0.3);
  let passed = false;
  let backSmaller = false;
  for (let i = 0; i < 400 && !passed; i += 1) {
    stepRings([front, back], 1 / 30, 0);
    const f = ringShape(front);
    const b = ringShape(back);
    if (b.r < f.r - 0.03) backSmaller = true;
    if (b.c.z > f.c.z + 0.05) passed = true;
  }
  assert.ok(backSmaller, "the back ring shrinks while the front one widens");
  assert.ok(passed, "and goes through it");
});

test("the field swirls round the core and is calm far away", () => {
  const ring = makeRing({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0.3);
  const mid = velocityAt({ x: 0, y: 0, z: 0 }, [ring]);
  assert.ok(mid.z > 0.3, "through the middle it blows forward");
  const outside = velocityAt({ x: 0.45, y: 0, z: 0 }, [ring]);
  assert.ok(outside.z < 0, "outside the ring it flows back");
  const far = velocityAt({ x: 20, y: 0, z: 0 }, [ring]);
  assert.ok(Math.hypot(far.x, far.y, far.z) < 1e-3);
  const smoke = tracersFor(ring, 200, 3);
  assert.equal(smoke.length, 200);
  for (const p of smoke) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 0.3) < 0.2);
});

test("words", () => {
  assert.deepEqual(smokeRingIntent("blow a smoke ring"), { count: 1 });
  assert.deepEqual(smokeRingIntent("blow two smoke rings"), { count: 2 });
  assert.deepEqual(smokeRingIntent("smoke rings!"), { count: 2 });
  assert.equal(smokeRingIntent("make a ring"), null);
});
