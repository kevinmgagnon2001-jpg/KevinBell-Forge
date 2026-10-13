import assert from "node:assert/strict";
import test from "node:test";
import { executeProposal } from "./harness.ts";
import { bootWorld, buildMarble, buildTetris, labWorld, playTetris, stepWorld } from "./manifold.ts";
import type { ProposedAction } from "./types.ts";
import { runHarness } from "./vm.ts";

function spawn(name: string, asset: string, x = "0", y = "0", z = "0"): ProposedAction {
  return { kind: "tool_call", toolName: "spawn_entity", arguments: { name, x, y, z, asset } };
}

test("an edit request does not spawn, then delete and undo round-trip", () => {
  let world = bootWorld();
  world = executeProposal(world, spawn("Court", "platform")).world;
  world = executeProposal(world, spawn("Beacon", "gaussian", "0", "1.8", "0")).world;
  const before = Object.keys(world.entities).length;
  const beacon = Object.values(world.entities).find((entity) => entity.name === "Beacon");
  assert.ok(beacon);

  const edited = runHarness(world, "make it blue", {
    kind: "tool_call",
    toolName: "spawn_entity",
    arguments: { name: "BlueBeacon", x: "0", y: "0", z: "0", asset: "cube", color: "blue" },
  });
  assert.equal(edited.ok, true, edited.result);
  assert.equal(Object.keys(edited.world.entities).length, before);
  assert.equal(edited.world.entities[beacon.id].customData.color, "#4c8df5");
  assert.equal(edited.world.entities[beacon.id].name, "Beacon");
  assert.ok(edited.world.skills.some((skill) => skill.name === "edit_color"));
  assert.ok(edited.attempts.some((attempt) => attempt.ok));

  const removed = runHarness(edited.world, "delete the beacon", {
    kind: "tool_call",
    toolName: "spawn_entity",
    arguments: { name: "Gone", x: "1", y: "0", z: "1", asset: "cube" },
  });
  assert.equal(removed.ok, true, removed.result);
  assert.equal(Object.values(removed.world.entities).some((entity) => entity.name === "Beacon"), false);
  assert.equal(Object.values(removed.world.entities).some((entity) => entity.name === "Gone"), false);

  const restored = runHarness(removed.world, "undo", { kind: "message", arguments: {}, message: "no" });
  assert.equal(restored.ok, true, restored.result);
  assert.equal(Object.values(restored.world.entities).some((entity) => entity.name === "Beacon"), true);
});

test("make them bigger resizes what exists", () => {
  let world = bootWorld();
  world = executeProposal(world, spawn("Court", "platform")).world;
  world = executeProposal(world, spawn("Cube", "cube", "2", "0", "0")).world;
  const cube = Object.values(world.entities).find((entity) => entity.name === "Cube");
  assert.ok(cube);
  const before = cube.transform.scale.x;
  const grown = runHarness(world, "make them bigger", {
    kind: "tool_call",
    toolName: "spawn_entity",
    arguments: { name: "Bigger", x: "0", y: "0", z: "0", asset: "cube" },
  });
  assert.equal(grown.ok, true, grown.result);
  assert.equal(Object.values(grown.world.entities).some((entity) => entity.name === "Bigger"), false);
  assert.ok(grown.world.entities[cube.id].transform.scale.x > before);
});

test("the avatar is your body: steer, recolor, refuse delete, spawn a critic", () => {
  const world = bootWorld();
  const start = world.entities[1].transform.position.z;
  const walked = runHarness(world, "Walk the avatar forward", {
    kind: "tool_call",
    toolName: "spawn_entity",
    arguments: { name: "Walker", x: "0", y: "0", z: "0", asset: "cube" },
  });
  assert.equal(walked.ok, true, walked.result);
  assert.equal(Object.keys(walked.world.entities).length, 1);
  assert.ok(walked.world.entities[1].transform.position.z > start);

  const painted = runHarness(walked.world, "Paint the avatar gold", {
    kind: "tool_call",
    toolName: "spawn_entity",
    arguments: { name: "Gold", x: "1", y: "0", z: "1", asset: "sphere", color: "gold" },
  });
  assert.equal(painted.ok, true, painted.result);
  assert.equal(Object.keys(painted.world.entities).length, 1);
  assert.equal(painted.world.entities[1].customData.color, "#d4a24a");

  const kept = runHarness(painted.world, "delete the avatar", {
    kind: "tool_call",
    toolName: "delete_entity",
    arguments: { id: "1" },
  });
  assert.equal(kept.ok, false);
  assert.equal(kept.world.entities[1].name, "ArchitectAvatar");

  const withCritic = runHarness(kept.world, "Spawn a critic agent named Critic", {
    kind: "message",
    arguments: {},
    message: "no",
  });
  assert.equal(withCritic.ok, true, withCritic.result);
  assert.ok(Object.values(withCritic.world.entities).some((entity) => entity.tags.includes("critic")));
  assert.ok(withCritic.world.entities[1]);
});

test("a named object can be nudged without moving the avatar", () => {
  const world = labWorld();
  const gold = Object.values(world.entities).find((entity) => entity.name === "Gold");
  assert.ok(gold);
  const moved = runHarness(world, "move Gold left", { kind: "message", arguments: {}, message: "no" });
  assert.equal(moved.ok, true, moved.result);
  assert.ok(moved.world.entities[gold.id].transform.position.x < gold.transform.position.x);
  assert.equal(moved.world.entities[1].transform.position.x, world.entities[1].transform.position.x);
});

test("tetris and the marble run are real objects", () => {
  const tetris = buildTetris(bootWorld());
  assert.equal(Object.values(tetris.entities).filter((entity) => entity.tags.includes("live")).length, 4);
  const left = playTetris(tetris, "left");
  const live = Object.values(left.entities).find((entity) => entity.tags.includes("live"));
  assert.ok(live);
  assert.equal(live.customData.gx, "2");
  const dropped = playTetris(tetris, "drop");
  assert.equal(Object.values(dropped.entities).filter((entity) => entity.tags.includes("locked")).length, 4);
  const marble = buildMarble(bootWorld());
  const ball = Object.values(marble.entities).find((entity) => entity.name === "Marble");
  assert.ok(ball?.physics && !ball.physics.isKinematic);
  const startZ = ball.transform.position.z;
  const rolled = stepWorld({ ...marble, tick: 0 }, 30);
  const after = rolled.entities[ball.id];
  assert.ok(after.transform.position.z < startZ);
});

test("the selected object nudges when you say move left", () => {
  const world = labWorld();
  const gold = Object.values(world.entities).find((entity) => entity.name === "Gold");
  assert.ok(gold);
  const moved = runHarness(world, "move left", { kind: "message", arguments: {}, message: "no" }, gold.id);
  assert.equal(moved.ok, true, moved.result);
  assert.ok(moved.world.entities[gold.id].transform.position.x < gold.transform.position.x);
});

test("paint it gold colors the solid you are looking at, not the block named Gold", () => {
  const world = labWorld();
  const clay = Object.values(world.entities).find((entity) => entity.name === "Clay");
  const gold = Object.values(world.entities).find((entity) => entity.name === "Gold");
  assert.ok(clay && gold);
  const painted = runHarness(
    world,
    "paint it gold",
    { kind: "tool_call", toolName: "set_color", arguments: { id: String(gold.id), color: "gold" } },
    gold.id,
    clay.id,
  );
  assert.equal(painted.ok, true, painted.result);
  assert.equal(painted.world.entities[clay.id].customData.color, "#d4a24a");
  assert.equal(painted.world.entities[gold.id].customData.color, gold.customData.color);
});

test("paint gold without a name still tints the selection", () => {
  const world = labWorld();
  const steel = Object.values(world.entities).find((entity) => entity.name === "Steel");
  const gold = Object.values(world.entities).find((entity) => entity.name === "Gold");
  assert.ok(steel && gold);
  const painted = runHarness(world, "paint gold", { kind: "message", arguments: {}, message: "no" }, steel.id);
  assert.equal(painted.ok, true, painted.result);
  assert.equal(painted.world.entities[steel.id].customData.color, "#d4a24a");
  assert.equal(painted.world.entities[gold.id].customData.color, gold.customData.color);
});

test("paint the gold red still finds the Gold block", () => {
  const world = labWorld();
  const gold = Object.values(world.entities).find((entity) => entity.name === "Gold");
  assert.ok(gold);
  const painted = runHarness(world, "paint the gold red", { kind: "message", arguments: {}, message: "no" });
  assert.equal(painted.ok, true, painted.result);
  assert.equal(painted.world.entities[gold.id].customData.color, "#e15a4a");
});

test("paint it clay wraps the texture on the solid in front of you", () => {
  const world = labWorld();
  const steel = Object.values(world.entities).find((entity) => entity.name === "Steel");
  const clay = Object.values(world.entities).find((entity) => entity.name === "Clay");
  assert.ok(steel && clay);
  const painted = runHarness(world, "paint it clay", { kind: "message", arguments: {}, message: "no" }, null, steel.id);
  assert.equal(painted.ok, true, painted.result);
  assert.equal(painted.world.entities[steel.id].customData.src, "tex:clay");
  assert.notEqual(painted.world.entities[clay.id].customData.src, "tex:clay");
});

test("the lab is a forge room, not an empty stage", () => {
  const world = labWorld();
  const names = Object.values(world.entities).map((entity) => entity.name);
  assert.ok(names.includes("ForgeTerminal"));
  assert.ok(names.includes("Helm"));
  assert.ok(names.includes("Clay"));
  assert.ok(names.includes("DropOrb"));
  assert.ok(names.includes("NeuralBay"));
  const solids = Object.values(world.entities).filter((entity) => entity.representation.kind === "mesh");
  assert.ok(solids.length >= 8);
  const splat = world.entities[13];
  assert.equal(splat.customData.neural, "splat");
  assert.equal(Object.values(world.entities).filter((entity) => entity.customData.neural === "splat").length, 1);
  const helm = Object.values(world.entities).find((entity) => entity.tags.includes("helm"));
  assert.ok(helm);
  assert.equal(helm.customData.role, "terminal");
  const kept = runHarness(world, "delete the helm", {
    kind: "tool_call",
    toolName: "delete_entity",
    arguments: { id: String(helm.id) },
  });
  assert.equal(kept.ok, false);
  assert.equal(kept.world.entities[helm.id]?.name, "Helm");
});

test("a loose color paints the tetris piece you are not looking at", () => {
  const world = buildTetris(bootWorld());
  const live = Object.values(world.entities).filter((entity) => entity.tags.includes("live"));
  const board = Object.values(world.entities).find((entity) => entity.customData.play === "tetris");
  assert.equal(live.length, 4);
  assert.ok(board);
  const painted = runHarness(
    world,
    "paint the yellow blocks red",
    { kind: "tool_call", toolName: "set_color", arguments: { id: String(board.id), color: "gold" } },
    board.id,
    board.id,
  );
  assert.equal(painted.ok, true, painted.result);
  assert.ok(live.every((cell) => painted.world.entities[cell.id].customData.color === "#e15a4a"));
  assert.notEqual(painted.world.entities[board.id].customData.color, "#e15a4a");
});

test("the block under the crosshair is the one that changes", () => {
  const world = buildTetris(bootWorld());
  const live = Object.values(world.entities).filter((entity) => entity.tags.includes("live"));
  const gazed = live.find((entity) => entity.customData.gx === "4" && entity.customData.gy === "12");
  assert.ok(gazed);
  const painted = runHarness(world, "paint this block blue", { kind: "message", arguments: {}, message: "no" }, null, gazed.id);
  assert.equal(painted.ok, true, painted.result);
  const blue = Object.values(painted.world.entities).filter((entity) => entity.customData.color === "#4c8df5");
  assert.equal(blue.length, 1);
  assert.equal(blue[0].id, gazed.id);
});

test("the left block is the left column, not the neighbor the model named", () => {
  const world = buildTetris(bootWorld());
  const live = Object.values(world.entities).filter((entity) => entity.tags.includes("live"));
  const minX = Math.min(...live.map((entity) => entity.transform.position.x));
  const wrong = live.find((entity) => entity.transform.position.x > minX + 0.1);
  assert.ok(wrong);
  const painted = runHarness(
    world,
    "paint the left block blue",
    { kind: "tool_call", toolName: "set_color", arguments: { id: String(wrong.id), color: "blue" } },
    wrong.id,
    wrong.id,
  );
  assert.equal(painted.ok, true, painted.result);
  const blue = Object.values(painted.world.entities).filter((entity) => entity.customData.color === "#4c8df5");
  assert.ok(blue.length >= 1);
  assert.ok(blue.every((entity) => Math.abs(entity.transform.position.x - minX) < 0.05));
  assert.equal(painted.world.entities[wrong.id].customData.color === "#4c8df5", wrong.transform.position.x - minX < 0.05);
});

test("nanite builds a cluster cut instead of a splat", () => {
  const world = labWorld();
  const before = Object.keys(world.entities).length;
  const built = runHarness(world, "show nanite", { kind: "message", arguments: {}, message: "no" });
  assert.equal(built.ok, true, built.result);
  assert.equal(built.proposal.toolName, "apply_method");
  assert.equal(built.proposal.arguments.name, "nanite");
  const cluster = Object.values(built.world.entities).find((entity) => entity.customData.method === "nanite");
  assert.ok(cluster);
  assert.equal(Object.keys(built.world.entities).length, before + 1);
  assert.equal(Object.values(built.world.entities).filter((entity) => entity.customData.neural === "splat").length, 1);
});

test("the blue sphere can be resized without naming it or looking at it", () => {
  const world = labWorld();
  const sample = Object.values(world.entities).find((entity) => entity.name === "Sample");
  const orb = Object.values(world.entities).find((entity) => entity.name === "DropOrb");
  assert.ok(sample && orb);
  const grown = runHarness(world, "make the blue sphere bigger", { kind: "message", arguments: {}, message: "no" }, orb.id, orb.id);
  assert.equal(grown.ok, true, grown.result);
  assert.ok(grown.world.entities[sample.id].transform.scale.x > sample.transform.scale.x);
  assert.equal(grown.world.entities[orb.id].transform.scale.x, orb.transform.scale.x);
});
