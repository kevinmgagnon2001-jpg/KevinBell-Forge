import assert from "node:assert/strict";
import test from "node:test";
import { deckCommand } from "./deck-bridge.ts";
import { buildTetris, labWorld } from "./manifold.ts";
import { runHarness } from "./vm.ts";

test("a deck session answers state and refuses a guest command", () => {
  const world = labWorld();
  const before = Object.keys(world.entities).length;
  const started = runHarness(world, "start a droid deck session", { kind: "message", arguments: {}, message: "no" });
  assert.equal(started.ok, true, started.result);
  assert.equal(started.proposal.toolName, "deck_bridge");
  assert.match(started.result, /"schema":2/);
  assert.match(started.result, /"phase":"READY"/);
  assert.match(started.result, /Not proot/);
  const decks = Object.values(started.world.entities).filter((entity) => entity.customData.method === "deck");
  assert.equal(decks.length, 1);
  assert.equal(Object.keys(started.world.entities).length, before + 1);
  assert.equal(Object.values(started.world.entities).filter((entity) => entity.customData.neural === "splat").length, 1);
  const again = deckCommand(started.world, { command: "start" });
  assert.equal(Object.values(again.world.entities).filter((entity) => entity.customData.method === "deck").length, 1);
  const guest = deckCommand(started.world, { command: "run" });
  assert.equal(guest.ok, false);
  assert.equal(guest.code, 7);
  assert.equal(guest.world, started.world);
  for (const command of ["guest", "cdp", "env", "override", "prefs"]) {
    const refused = deckCommand(started.world, { command });
    assert.equal(refused.code, 7, command);
    assert.equal(refused.world, started.world);
  }
});

test("deck input moves the live piece and stops when the session is idle", () => {
  const world = buildTetris(labWorld());
  const started = deckCommand(world, { command: "start" });
  const live = Object.values(started.world.entities).filter((entity) => entity.tags.includes("live"));
  const before = Math.min(...live.map((entity) => entity.transform.position.x));
  const moved = deckCommand(started.world, { command: "input", key: "left" });
  assert.equal(moved.ok, true, moved.detail);
  const after = Object.values(moved.world.entities).filter((entity) => entity.tags.includes("live"));
  assert.ok(Math.min(...after.map((entity) => entity.transform.position.x)) < before);
  const stopped = deckCommand(moved.world, { command: "stop" });
  assert.match(stopped.detail, /"phase":"IDLE"/);
  const denied = deckCommand(stopped.world, { command: "input", key: "right" });
  assert.equal(denied.code, 4);
});
