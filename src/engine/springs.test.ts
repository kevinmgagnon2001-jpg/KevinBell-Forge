import { test } from "node:test";
import assert from "node:assert/strict";
import { alignPhase, jiggle, JIGGLE, spring, spring2, stepPhase, stepSpring, swingOf, track, tracker } from "./springs.ts";

test("a spring settles on its target, stable at any frame rate", () => {
  for (const dt of [1 / 240, 1 / 60, 1 / 20, 0.2]) {
    let s = { x: 1, v: 0 };
    for (let t = 0; t < 6; t += dt) s = stepSpring(s, 0, dt, 2, 0.3);
    assert.ok(Math.abs(s.x) < 0.01 && Math.abs(s.v) < 0.1, `dt ${dt}: ${s.x}`);
  }
  // Under damped, it overshoots.
  let s = { x: 1, v: 0 };
  let low = 1;
  for (let i = 0; i < 120; i += 1) {
    s = stepSpring(s, 0, 1 / 60, 2, 0.2);
    low = Math.min(low, s.x);
  }
  assert.ok(low < -0.3);
  assert.deepEqual(stepSpring(spring(), 0, 0, 2, 1), spring());
});

test("jiggle: the antenna leans back when you speed up, swings forward when you stop, then settles", () => {
  let j = spring2();
  for (let i = 0; i < 30; i += 1) j = jiggle(j, { x: 0, z: 8 }, 1 / 60, JIGGLE.antenna);
  assert.ok(j.x.x < -0.05, `leans back ${j.x.x}`);
  let forward = 0;
  for (let i = 0; i < 40; i += 1) {
    j = jiggle(j, { x: 0, z: -8 }, 1 / 60, JIGGLE.antenna);
    forward = Math.max(forward, j.x.x);
  }
  assert.ok(forward > 0.05);
  for (let i = 0; i < 600; i += 1) j = jiggle(j, { x: 0, z: 0 }, 1 / 60, JIGGLE.antenna);
  assert.ok(Math.abs(j.x.x) < 0.01);
  for (let i = 0; i < 60; i += 1) j = jiggle(j, { x: 1000, z: 0 }, 1 / 60, JIGGLE.antenna);
  assert.ok(Math.abs(j.z.x) <= JIGGLE.antenna.limit);
});

test("tracking a point gives its acceleration, and a jump across the map is not one", () => {
  let t = tracker();
  for (let i = 0; i <= 60; i += 1) {
    const time = i / 60;
    t = track(t, 0.5 * 3 * time * time, 0, 0, 1 / 60);
  }
  assert.ok(Math.abs(t.ax - 3) < 0.3, `a ${t.ax}`);
  t = track(t, 500, 0, 0, 1 / 60);
  assert.equal(t.ax, 0);
});

test("the gait's phase: stopping finishes the step on the ground; moving runs with speed", () => {
  let ph = 1.0;
  for (let i = 0; i < 120; i += 1) ph = stepPhase(ph, 0, 1.15, 1 / 60);
  assert.ok(swingOf(ph) < 1e-9, "both feet down");
  assert.ok(Math.abs(ph - Math.PI) < 1e-9, "the step in progress finished, not reversed");
  const held = stepPhase(ph, 0, 1.15, 1 / 60);
  assert.equal(held, ph);
  // One stride per cycle: 1.15 m at 1.15 m/s is one cycle a second.
  let p = 0;
  for (let i = 0; i < 30; i += 1) p = stepPhase(p, 1.15, 1.15, 1 / 60);
  assert.ok(Math.abs(p - Math.PI) < 1e-6);
  // Slow walking does not stall at each footfall.
  let slow = 0;
  for (let i = 0; i < 120; i += 1) slow = stepPhase(slow, 0.3, 1.15, 1 / 60);
  assert.ok(slow > 1);
});

test("aligning: the cycle starts where the legs already are", () => {
  const swing = 0.42;
  for (const ph of [0.3, 1.2, 2.0, 2.8, 3.6, 4.5, 5.6]) {
    const hipL = -Math.sin(ph) * swing;
    const hipR = Math.sin(ph) * swing;
    const kneeL = 0.08 + Math.max(0, -Math.cos(ph)) * 0.65;
    const kneeR = 0.08 + Math.max(0, Math.cos(ph)) * 0.65;
    const got = alignPhase(hipL, hipR, kneeL, kneeR, swing);
    const d = Math.atan2(Math.sin(got - ph), Math.cos(got - ph));
    assert.ok(Math.abs(d) < 1e-6, `phase ${ph} -> ${got}`);
  }
});
