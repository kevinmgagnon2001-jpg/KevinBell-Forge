import { test } from "node:test";
import assert from "node:assert/strict";
import { hyperIntent, shapeFrom } from "./hyper.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import type { World } from "./types.ts";

const call = (world: World, tool: string, args: Record<string, string>) => executeProposal(world, { kind: "tool_call", toolName: tool, arguments: args });

test("words to shapes", () => {
  assert.equal(shapeFrom("a tesseract"), "tesseract");
  assert.equal(shapeFrom("make a 600-cell"), "600-cell");
  assert.equal(shapeFrom("24 cell please"), "24-cell");
  assert.equal(shapeFrom("a very many pointed 4d bubble"), "120-cell");
  assert.equal(shapeFrom("a red cube"), null);
});

test("a 4D bubble floats in front of you, and undoes", () => {
  const w = labWorld();
  const ran = call(w, "place_hyper", { shape: "120-cell" });
  assert.ok(ran.ok, ran.result);
  const e = ran.world.entities[ran.world.nextId - 1];
  assert.equal(e.customData.hyper, "120-cell");
  assert.equal(e.representation.kind === "mesh" && e.representation.assetId, "hyper");
  assert.ok(e.transform.position.y > 1);
  assert.equal(call(ran.world, "undo", {}).world.entities[e.id], undefined);
});

test("the sword: held, and put away", () => {
  const held = call(labWorld(), "wield", { item: "hyper-sword" });
  const me = Object.values(held.world.entities).find((e) => e.tags.includes("architect"))!;
  assert.equal(me.customData.wield, "hyper-sword");
  const away = call(held.world, "wield", { item: "none" });
  assert.equal(Object.values(away.world.entities).find((e) => e.tags.includes("architect"))!.customData.wield, undefined);
});

test("instant commands", () => {
  assert.deepEqual(hyperIntent("make a 4d bubble"), { tool: "place_hyper", arguments: { shape: "120-cell" } });
  assert.deepEqual(hyperIntent("put a tesseract here"), { tool: "place_hyper", arguments: { shape: "tesseract" } });
  assert.deepEqual(hyperIntent("give me the 4d sword"), { tool: "wield", arguments: { item: "hyper-sword" } });
  assert.deepEqual(hyperIntent("put the sword away"), { tool: "wield", arguments: { item: "none" } });
  assert.equal(hyperIntent("build a tower"), null);
  assert.equal(hyperIntent("paint the tesseract red"), null);
});
