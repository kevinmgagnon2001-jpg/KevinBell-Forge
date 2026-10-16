import { test } from "node:test";
import assert from "node:assert/strict";
import { askTown, cleanTown, hourOf, NPC_TAG, placesOf, planDay, stepTown, steer, timeToHit, townIntent, type Body, type Town } from "./town.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import type { World } from "./types.ts";

const call = (world: World, tool: string, args: Record<string, string>) => executeProposal(world, { kind: "tool_call", toolName: tool, arguments: args });
const folkOf = (w: World) => Object.values(w.entities).filter((e) => e.tags.includes(NPC_TAG));

function run(world: World, seconds: number, dt = 1 / 30): { world: World; bodies: Record<number, Body>; minGap: number } {
  let town = world.town!;
  let bodies: Record<number, Body> = {};
  let minGap = Infinity;
  const places = placesOf(world);
  for (let t = 0; t < seconds; t += dt) {
    const out = stepTown(world, town, bodies, dt, places);
    town = out.town;
    bodies = out.bodies;
    const ids = Object.keys(bodies).map(Number);
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) minGap = Math.min(minGap, Math.hypot(bodies[ids[i]].x - bodies[ids[j]].x, bodies[ids[i]].z - bodies[ids[j]].z));
  }
  return { world: { ...world, town }, bodies, minGap };
}

test("time to hit: head on, passing, already touching", () => {
  assert.ok(Math.abs(timeToHit(-4, 0, 2, 0, 1) - 1.5) < 1e-9);
  assert.equal(timeToHit(-4, 3, 2, 0, 1), Infinity);
  assert.equal(timeToHit(0.5, 0, 0, 0, 1), 0);
});

test("steering: two people walking at each other both step aside", () => {
  let a = { x: -4, z: 0, vx: 1.2, vz: 0, r: 0.32 };
  let b = { x: 4, z: 0, vx: -1.2, vz: 0, r: 0.32 };
  let closest = Infinity;
  for (let i = 0; i < 300; i += 1) {
    const va = steer(a, { x: 1.2, z: 0 }, [{ ...b }], [], 1.2);
    const vb = steer(b, { x: -1.2, z: 0 }, [{ ...a }], [], 1.2);
    a = { ...a, x: a.x + va.x / 30, z: a.z + va.z / 30, vx: va.x, vz: va.z };
    b = { ...b, x: b.x + vb.x / 30, z: b.z + vb.z / 30, vx: vb.x, vz: vb.z };
    closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
  }
  assert.ok(closest > 0.55, `closest ${closest}`);
  assert.ok(a.x > 3 && b.x < -3, "both got past");
});

test("a day's plan follows habits", () => {
  const places = placesOf(labWorld());
  const early = planDay(["early bird"], places, 1);
  const owl = planDay(["night owl"], places, 1);
  assert.ok(early[1].from < owl[1].from);
  assert.equal(early[0].place, "home");
  assert.equal(early[3].doing, "lunch");
});

test("fill the plaza: people arrive, walk their plans without walking into each other or the exhibits, and remember", () => {
  const filled = call(labWorld(), "fill_town", { count: "10", seed: "5" });
  assert.ok(filled.ok, filled.result);
  assert.equal(folkOf(filled.world).length, 10);
  assert.ok(filled.world.town && Object.keys(filled.world.town.minds).length === 10);
  const { world, bodies, minGap } = run(filled.world, 60);
  assert.ok(minGap > 0.3, `people stay apart: ${minGap}`);
  const moved = folkOf(world).filter((e) => Math.hypot(bodies[e.id].x - e.transform.position.x, bodies[e.id].z - e.transform.position.z) > 1);
  assert.ok(moved.length >= 5, `${moved.length} walked`);
  const memories = Object.values(world.town!.minds).reduce((n, m) => n + m.memory.length, 0);
  assert.ok(memories > 10, `memories ${memories}`);
  assert.ok(hourOf(world.town!) > hourOf(filled.world.town!), "the town clock runs");
  const mia = folkOf(world)[0];
  const asked = askTown(world, { name: mia.name });
  assert.ok(asked.ok && asked.detail.startsWith(mia.name) && asked.detail.includes("Today:"), asked.detail);
  assert.ok(askTown(world, {}).detail.includes("10 people"));
});

test("errands, rain and saves", () => {
  const filled = call(labWorld(), "fill_town", { count: "3" }).world;
  const leo = folkOf(filled)[1];
  const sent = call(filled, "send_npc", { name: leo.name, place: "bench" });
  assert.ok(sent.ok, sent.result);
  const { world, bodies } = run(sent.world, 40);
  const bench = Object.values(world.entities).find((e) => e.name === "Bench")!;
  assert.ok(Math.hypot(bodies[leo.id].x - bench.transform.position.x, bodies[leo.id].z - bench.transform.position.z) < 4, "Leo got to the bench");
  assert.ok(world.town!.minds[leo.id].memory.some((m) => m.text.includes("asked to go to Bench")));
  assert.ok(!call(filled, "send_npc", { name: "Nobody", place: "bench" }).ok);
  const json = JSON.parse(JSON.stringify(world.town)) as Town;
  const clean = cleanTown(json, world.entities)!;
  assert.equal(Object.keys(clean.minds).length, 3);
  assert.equal(cleanTown({ minutes: "x" }, world.entities), undefined);
});

test("instant commands", () => {
  const w = labWorld();
  assert.deepEqual(townIntent("Fill the plaza with people", w), { tool: "fill_town", arguments: { count: "8" } });
  assert.deepEqual(townIntent("fill the bench with regulars", w), { tool: "fill_town", arguments: { count: "8", place: "bench" } });
  assert.deepEqual(townIntent("add 5 people", w), { tool: "fill_town", arguments: { count: "5" } });
  assert.equal(townIntent("what did Mia do today?", w), null, "nobody lives here yet");
  const filled = call(w, "fill_town", { count: "4", seed: "1" }).world;
  const name = folkOf(filled)[0].name;
  assert.deepEqual(townIntent(`what did ${name} do today?`, filled), { tool: "ask_town", arguments: { name } });
  assert.deepEqual(townIntent(`send ${name} to the bench`, filled), { tool: "send_npc", arguments: { name, place: "bench" } });
  assert.deepEqual(townIntent("everyone go home", filled), { tool: "send_npc", arguments: { name: "everyone", place: "home" } });
  assert.equal(townIntent("who is here", filled)?.tool, "ask_town");
  assert.equal(townIntent("clear the crowd", filled)?.tool, "delete_entity");
  assert.equal(townIntent("paint the cube red", filled), null);
});
