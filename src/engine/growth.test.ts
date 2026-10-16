import { test } from "node:test";
import assert from "node:assert/strict";
import { grayScott, GROWTHS, GROWTH_KINDS, growthIntent } from "./growth.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";

test("each kind grows a real pattern: bounded, not flat, and the same for the same seed", () => {
  for (const kind of GROWTH_KINDS) {
    const g = GROWTHS[kind];
    const b = grayScott(48, 1200, g.feed, g.kill, 3);
    let min = 1;
    let max = 0;
    let sum = 0;
    for (const v of b) {
      assert.ok(v >= 0 && v <= 1);
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
    }
    assert.ok(max - min > 0.2, `${kind} has contrast: ${min.toFixed(2)}..${max.toFixed(2)}`);
    const cover = sum / b.length;
    assert.ok(cover > 0.02 && cover < 0.6, `${kind} covers part of it: ${cover.toFixed(2)}`);
  }
  assert.deepEqual(grayScott(24, 200, 0.0545, 0.062, 5), grayScott(24, 200, 0.0545, 0.062, 5));
});

test("words and the tool", () => {
  assert.deepEqual(growthIntent("grow moss on the column"), { tool: "grow", arguments: { kind: "moss", thing: "the column" } });
  assert.deepEqual(growthIntent("frost the bench"), { tool: "grow", arguments: { kind: "frost", thing: "the bench" } });
  assert.deepEqual(growthIntent("let the steel rust"), { tool: "grow", arguments: { kind: "rust", thing: "steel" } });
  assert.deepEqual(growthIntent("clean the column"), { tool: "grow", arguments: { kind: "none", thing: "the column" } });
  assert.equal(growthIntent("make a red cube"), null);
  const w = labWorld();
  const ran = executeProposal(w, { kind: "tool_call", toolName: "grow", arguments: { kind: "crystal", thing: "column" } });
  assert.ok(ran.ok, ran.result);
  const col = Object.values(ran.world.entities).find((e) => e.name === "Column")!;
  assert.equal(col.customData.growth, "crystal");
  const clean = executeProposal(ran.world, { kind: "tool_call", toolName: "grow", arguments: { kind: "none", thing: "column" } });
  assert.equal(Object.values(clean.world.entities).find((e) => e.name === "Column")!.customData.growth, undefined);
});
