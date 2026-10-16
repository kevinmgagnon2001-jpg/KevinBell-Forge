import { test } from "node:test";
import assert from "node:assert/strict";
import { clothIntent, makeCloth, stepCloth, worstStretch, type ClothWorld } from "./cloth.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";

const flat: ClothWorld = { ground: () => 0 };
const at = (c: { pos: Float64Array }, i: number) => ({ x: c.pos[i * 3], y: c.pos[i * 3 + 1], z: c.pos[i * 3 + 2] });

test("a cape hangs down from its pins, gathers, and does not stretch", () => {
  const cape = makeCloth(0.6, 0.9, 8, 12, { x: -0.3, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, "top");
  const pins = cape.pinned.map((i) => at(cape, i));
  for (let f = 0; f < 240; f += 1) stepCloth(cape, pins, 1 / 60, flat);
  const bottom = at(cape, (cape.rows - 1) * cape.cols + 3);
  assert.ok(bottom.y < 0.75 && bottom.y > 0.45, `the hem hangs about 0.9 m down: ${bottom.y.toFixed(2)}`);
  assert.ok(worstStretch(cape) < 1.12, `holds together: ${worstStretch(cape).toFixed(3)}`);
  for (const v of cape.pos) assert.ok(Number.isFinite(v));
});

test("wind lifts a flag out from its pole and keeps it moving", () => {
  const flag = makeCloth(1.2, 0.8, 12, 8, { x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 1 }, "left");
  const pins = flag.pinned.map((i) => at(flag, i));
  // No wind: it droops against the pole.
  const still = makeCloth(1.2, 0.8, 12, 8, { x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 1 }, "left");
  for (let f = 0; f < 300; f += 1) stepCloth(still, pins, 1 / 60, flat);
  const tipStill = at(still, 11);
  let moved = 0;
  let last = 0;
  for (let f = 0; f < 300; f += 1) {
    stepCloth(flag, pins, 1 / 60, { ...flat, wind: { x: 0, y: 0, z: 9 }, time: f / 60 });
    const y = at(flag, 7 * 12 + 11).y;
    if (f > 120) moved += Math.abs(y - last);
    last = y;
  }
  const tip = at(flag, 11);
  assert.ok(tip.z > tipStill.z + 0.3, `the wind holds it out: ${tip.z.toFixed(2)} vs ${tipStill.z.toFixed(2)}`);
  assert.ok(moved > 0.05, "it flutters");
  assert.ok(worstStretch(flag) < 1.15);
});

test("a body pushes the cape out of itself", () => {
  const cape = makeCloth(0.6, 0.9, 8, 12, { x: -0.3, y: 1.5, z: -0.12 }, { x: 1, y: 0, z: 0 }, "top");
  const pins = cape.pinned.map((i) => at(cape, i));
  const body = { a: { x: 0, y: 0.6, z: 0.05 }, b: { x: 0, y: 1.4, z: 0.05 }, r: 0.17 };
  for (let f = 0; f < 200; f += 1) stepCloth(cape, pins, 1 / 60, { ...flat, capsules: [body] });
  for (let i = 0; i < cape.cols * cape.rows; i += 1) {
    const p = at(cape, i);
    if (p.y < 0.6 || p.y > 1.4) continue;
    assert.ok(Math.hypot(p.x - 0, p.z - 0.05) >= 0.17, `particle ${i} is outside the body`);
  }
});

test("capes and flags from words and tools", () => {
  assert.deepEqual(clothIntent("give me a red cape"), { tool: "wear_cape", arguments: { color: "crimson" } });
  assert.deepEqual(clothIntent("take the cape off"), { tool: "wear_cape", arguments: { color: "none" } });
  assert.deepEqual(clothIntent("raise a pirate flag"), { tool: "raise_flag", arguments: { style: "pirate" } });
  assert.equal(clothIntent("make a red cube"), null);
  const w = labWorld();
  const caped = executeProposal(w, { kind: "tool_call", toolName: "wear_cape", arguments: { color: "teal" } });
  assert.ok(caped.ok, caped.result);
  const me = Object.values(caped.world.entities).find((e) => e.tags.includes("architect"))!;
  assert.equal(me.customData.cape, "#11686b");
  const flag = executeProposal(w, { kind: "tool_call", toolName: "raise_flag", arguments: { style: "rainbow" } });
  assert.ok(flag.ok, flag.result);
  assert.equal(flag.world.entities[w.nextId].customData.flag, "rainbow");
});
