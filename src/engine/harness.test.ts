import assert from "node:assert/strict";
import test from "node:test";
import { executeProposal } from "./harness.ts";
import { emptyWorld, stepWorld } from "./manifold.ts";
import type { Entity, ProposedAction, World } from "./types.ts";
import { IDENTITY, V3 } from "./types.ts";

function call(name: string, args: Record<string, string>): ProposedAction {
  return { kind: "tool_call", toolName: name, arguments: args };
}

function box(id: number): Entity {
  return {
    id,
    name: "Box",
    transform: {
      position: V3(0, 0, 0),
      rotation: { ...IDENTITY },
      scale: V3(1, 1, 1),
    },
    representation: { kind: "mesh", assetId: "cube" },
    physics: null,
    tags: [],
    customData: {},
  };
}

test("spawn then query", () => {
  let world = emptyWorld();
  const spawned = executeProposal(
    world,
    call("spawn_entity", { name: "Platform", x: "0", y: "0", z: "0", asset: "platform" }),
  );
  assert.match(spawned.result, /Spawned 'Platform'/);
  assert.equal(Object.keys(spawned.world.entities).length, 1);
  world = spawned.world;
  const queried = executeProposal(world, call("query_scene", { tag: "spawned" }));
  assert.match(queried.result, /Found 1 entities/);
  assert.match(queried.result, /Platform#/);
});

test("apply velocity then integrate", () => {
  const placed = box(1);
  let world: World = { ...emptyWorld(), entities: { 1: placed }, nextId: 2 };
  const pushed = executeProposal(world, call("apply_velocity", { id: "1", vx: "2", vy: "0", vz: "0" }));
  world = pushed.world;
  const startX = world.entities[1].transform.position.x;
  world = stepWorld(world, 1);
  assert.ok(world.entities[1].transform.position.x > startX);
  assert.ok(world.entities[1].physics);
});

test("gravity rests on the floor", () => {
  let world: World = { ...emptyWorld(), entities: { 1: box(1) }, nextId: 2 };
  world = executeProposal(world, call("apply_velocity", { id: "1", vx: "0", vy: "3", vz: "0" })).world;
  world = stepWorld(world, 180);
  const entity = world.entities[1];
  assert.ok(entity.transform.position.y >= entity.transform.scale.y / 2 - 1e-4);
  assert.ok(Math.abs(entity.physics?.velocity.y ?? 1) < 0.05);
});

test("rejects unknown tool and missing args", () => {
  const world = emptyWorld();
  const unknown = executeProposal(world, call("nuke_world", {}));
  assert.match(unknown.result, /not registered/);
  const missing = executeProposal(world, call("spawn_entity", { name: "X" }));
  assert.match(missing.result, /missing required argument/);
  assert.equal(unknown.world.events.at(-1)?.ok, false);
});

test("a default spawn sits off the platform center and can be recolored", () => {
  let world = emptyWorld();
  world = executeProposal(world, call("spawn_entity", { name: "Court", x: "0", y: "0", z: "0", asset: "platform" })).world;
  const spawned = executeProposal(world, call("spawn_entity", { name: "Cube", x: "0", y: "0", z: "0", asset: "cube" }));
  assert.match(spawned.result, /off the platform center/);
  const cube = Object.values(spawned.world.entities).find((entity) => entity.name === "Cube");
  assert.ok(cube);
  assert.ok(Math.hypot(cube.transform.position.x, cube.transform.position.z) > 0.4);
  world = spawned.world;
  const painted = executeProposal(world, call("set_color", { id: String(cube.id), color: "violet" }));
  assert.match(painted.result, /violet/);
  assert.equal(painted.world.entities[cube.id].customData.color, "#a06bf0");
  assert.equal(Object.keys(painted.world.entities).length, 2);
  const placed = executeProposal(
    world,
    call("spawn_entity", { name: "North", x: "4", y: "0", z: "0", asset: "pillar" }),
  );
  const north = Object.values(placed.world.entities).find((entity) => entity.name === "North");
  assert.equal(north?.transform.position.x, 4);
});

test("kinematic body refuses velocity", () => {
  const entity = box(4);
  entity.physics = {
    mass: 1,
    velocity: V3(),
    angularVelocity: V3(),
    isKinematic: true,
    solver: "rigid",
  };
  const world = { ...emptyWorld(), entities: { 4: entity }, nextId: 5 };
  const out = executeProposal(world, call("apply_velocity", { id: "4", vx: "1", vy: "0", vz: "0" }));
  assert.match(out.result, /kinematic/);
});
