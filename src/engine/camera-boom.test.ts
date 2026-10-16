import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOM, boomReach, easeBoom, segmentHit } from "./camera-boom.ts";
import type { Solid } from "./physics.ts";

const wall = (minZ: number, maxZ: number, dynamic = false): Solid => ({ id: 1, min: { x: -3, y: 0, z: minZ }, max: { x: 3, y: 3, z: maxZ }, dynamic, round: false, slide: "" });
const flat = () => 0;
const pivot = { x: 0, y: 1.5, z: 0 };
const want = { x: 0, y: 2.5, z: -5 };
const len = Math.hypot(1, 5);

test("a clear boom reaches all the way", () => {
  assert.ok(Math.abs(boomReach(pivot, want, [], flat) - (len - BOOM.pad)) < 1e-9);
});

test("a wall behind you pulls the camera in front of it", () => {
  const r = boomReach(pivot, want, [wall(-2.6, -2.2)], flat);
  assert.ok(r < len * 0.45 && r > BOOM.min, `in front of the wall: ${r}`);
  assert.ok(Math.abs(segmentHit(pivot, want, wall(-2.6, -2.2)) - 2.2 / 5) < 1e-9);
});

test("loose things, small things, and what you stand inside do not pull it in", () => {
  assert.ok(boomReach(pivot, want, [wall(-2.6, -2.2, true)], flat) > len - 0.3);
  const vase: Solid = { id: 2, min: { x: -0.1, y: 0, z: -3 }, max: { x: 0.1, y: 3, z: -2.8 }, dynamic: false, round: false, slide: "" };
  assert.ok(boomReach(pivot, want, [vase], flat) > len - 0.3);
  assert.ok(boomReach(pivot, want, [wall(-1, 1)], flat) > len - 0.3, "the pivot is inside it");
});

test("a hill behind you stops it above the ground", () => {
  const hill = (_x: number, z: number) => (z < -2 ? 3 : 0);
  assert.ok(boomReach(pivot, want, [], hill) < len * 0.5);
});

test("in at once, out gently", () => {
  assert.equal(easeBoom(4, 1, 1 / 60), 1);
  const out = easeBoom(1, 4, 1 / 60);
  assert.ok(out > 1 && out < 1.2);
  assert.equal(easeBoom(Number.NaN, 3, 1 / 60), 3);
});
