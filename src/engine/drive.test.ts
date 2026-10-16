import { test } from "node:test";
import assert from "node:assert/strict";
import { chase, chasePoint, driveSpeed, KEY_PUSH, PACE } from "./drive.ts";

test("how far the stick is pushed sets the pace: walk, then smoothly up to a run", () => {
  assert.equal(driveSpeed(0), 0);
  assert.equal(driveSpeed(0.05), 0, "a resting thumb does not creep");
  assert.ok(Math.abs(driveSpeed(0.5) - PACE.walk) < 1e-9);
  assert.ok(Math.abs(driveSpeed(1) - PACE.run) < 1e-9);
  let last = 0;
  for (let p = 0.1; p <= 1.0001; p += 0.05) {
    const s = driveSpeed(p);
    assert.ok(s >= last, "never slower for a harder push");
    assert.ok(s - last < 1.2, `no jump at ${p.toFixed(2)}`);
    last = s;
  }
  assert.ok(Math.abs(driveSpeed(KEY_PUSH.jog) - PACE.jog) < 0.4, "a key push jogs");
});

test("the point to chase lies along the push, further for a harder push", () => {
  const near = chasePoint(0, 0, 1, 0, 0.2);
  const far = chasePoint(0, 0, 1, 0, 1);
  assert.ok(near.x > 0 && far.x > near.x && near.z === 0);
});

test("chasing: a point to the side turns you and steps that way; behind you, you pivot first", () => {
  // Facing +z, the point to the left (+x): turn toward it, moving that way already.
  let s = { yaw: 0, x: 0, z: 0 };
  const left = chasePoint(0, 0, 1, 0, 0.6);
  const first = chase(s.yaw, s.x, s.z, left, 3, 1 / 60);
  assert.ok(first.yaw > 0 && first.vx > 0);
  for (let i = 0; i < 30; i += 1) {
    const c = chase(s.yaw, s.x, s.z, chasePoint(s.x, s.z, 1, 0, 0.6), 3, 1 / 60);
    s = { yaw: c.yaw, x: s.x + c.vx / 60, z: s.z + c.vz / 60 };
  }
  assert.ok(Math.abs(s.yaw - Math.PI / 2) < 0.05, `faces the way it goes: ${s.yaw}`);
  // Point straight behind: slow while turning round.
  const back = chase(0, 0, 0, { x: 0, z: -2 }, 7, 1 / 60);
  assert.ok(Math.hypot(back.vx, back.vz) < 7 * 0.3);
  assert.deepEqual(chase(1, 0, 0, { x: 0, z: 0 }, 3, 1 / 60), { yaw: 1, vx: 0, vz: 0 });
});
