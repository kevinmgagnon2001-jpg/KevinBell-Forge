import assert from "node:assert/strict";
import test from "node:test";
import { heightAt, LAKE, MEADOW_RADIUS, PLAZA_RADIUS, scatter, WATER_Y } from "./terrain.ts";

test("the lab and the meadow around it are flat, so walking off the plaza stays on the ground", () => {
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    for (let r = 0; r < MEADOW_RADIUS; r += 1.5) {
      const h = heightAt(Math.cos(a) * r, Math.sin(a) * r);
      if (r < PLAZA_RADIUS) assert.ok(h < 0 && h > -0.1, `under the plaza at r=${r}: ${h}`);
      else assert.ok(Math.abs(h) < 0.2, `meadow at r=${r}, a=${a.toFixed(1)}: ${h}`);
    }
  }
});

test("the land rises into hills and mountains, and the lake sits below the water", () => {
  assert.ok(heightAt(LAKE.x, LAKE.z) < WATER_Y - 1);
  let tallest = 0;
  for (let a = 0; a < Math.PI * 2; a += 0.1) tallest = Math.max(tallest, heightAt(Math.cos(a) * 200, Math.sin(a) * 200));
  assert.ok(tallest > 30, `mountains reach ${tallest}`);
  assert.equal(heightAt(12.5, -40.25), heightAt(12.5, -40.25));
});

test("scattered things stand on dry ground outside the ring they were asked for", () => {
  const spots = scatter(7, 200, 32, 140, { clump: 0.5 });
  assert.ok(spots.length > 100, `${spots.length} spots`);
  for (const s of spots) {
    const r = Math.hypot(s.x, s.z);
    assert.ok(r >= 32 && r <= 140);
    assert.ok(s.y > WATER_Y);
    assert.equal(s.y, heightAt(s.x, s.z));
  }
  assert.deepEqual(scatter(7, 20, 32, 140), scatter(7, 20, 32, 140));
});
