import assert from "node:assert/strict";
import test from "node:test";
import { propose, sceneRefs } from "./bonded.ts";
import { executeProposal } from "./harness.ts";
import { bootWorld } from "./manifold.ts";
import { DEFAULT_MODEL_PATH, DEMO_SCRIPT, TOOL_NAMES } from "./os.ts";
import type { BondedModel, Entity, World } from "./types.ts";

const model: BondedModel = {
  name: "demo-bonded",
  path: DEFAULT_MODEL_PATH,
  loaded: true,
  validated: false,
};

function named(world: World, name: string): Entity {
  const found = Object.values(world.entities).find((entity) => entity.name === name);
  assert.ok(found, `missing entity ${name}`);
  return found;
}

test("demo script builds the court through bonded intents", () => {
  let world = bootWorld();
  for (const intent of DEMO_SCRIPT) {
    const proposal = propose(model, intent, sceneRefs(world.entities), TOOL_NAMES);
    const executed = executeProposal(world, proposal);
    assert.equal(executed.ok, true, `${intent} → ${executed.result}`);
    world = executed.world;
  }

  for (const name of ["Court", "North", "South", "East", "West", "Halo", "Beacon", "Orb"] as const) {
    named(world, name);
  }

  const court = named(world, "Court");
  assert.equal(court.representation.kind, "mesh");
  assert.equal(court.representation.kind === "mesh" ? court.representation.assetId : "", "platform");

  const beacon = named(world, "Beacon");
  assert.equal(beacon.representation.kind, "gaussian");

  const orb = named(world, "Orb");
  assert.ok(orb.physics);
  assert.equal(orb.physics?.isKinematic, false);
  assert.ok((orb.physics?.velocity.y ?? 0) > 0);
});
