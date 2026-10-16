import { test } from "node:test";
import assert from "node:assert/strict";
import { burningCells, douse, emptyFire, fireIntent, flammable, fuelFrom, ignite, igniteThing, stepFire, FIRE } from "./fire.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import type { Entity, World } from "./types.ts";

const calm = { wind: { x: 0, z: 0 }, rain: 0 };
const plank = (id: number, x: number, z: number, w: number, d: number): Entity => ({
  id,
  name: "Wooden plank",
  transform: { position: { x, y: 0.1, z }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: w, y: 0.2, z: d } },
  representation: { kind: "mesh", assetId: "cube" },
  physics: null,
  tags: ["spawned"],
  customData: {},
});
const worldOf = (...es: Entity[]): Pick<World, "entities"> => ({ entities: Object.fromEntries(es.map((e) => [e.id, e])) });
const run = (g: ReturnType<typeof emptyFire>, seconds: number, weather = calm) => {
  const out: number[] = [];
  for (let t = 0; t < seconds; t += 0.05) out.push(...stepFire(g, 0.05, weather).burnedOut);
  return out;
};

test("what burns: wood, crates, the bench; not people, stone or the floor", () => {
  const w = labWorld();
  const by = (n: string) => Object.values(w.entities).find((e) => e.name === n)!;
  assert.ok(flammable(by("Bench")));
  assert.ok(!flammable(by("Steel")) && !flammable(by("LabDeck")) && !flammable(by("ArchitectAvatar")));
  assert.ok(flammable(plank(1, 0, 0, 1, 1)));
});

test("fire creeps along a plank, and stops at the bare ground", () => {
  const g = emptyFire();
  fuelFrom(g, worldOf(plank(1, 0, 0, 4, 0.5), plank(2, 0, 3, 1, 0.5)));
  ignite(g, -1.8, 0, 0.2);
  run(g, 6);
  const lit = burningCells(g);
  assert.ok(lit.length >= 3, `it spread: ${lit.length} cells`);
  assert.ok(lit.every((i) => g.owner[i] === 1), "only the plank that was lit (the other is 3 m away)");
});

test("burnt out things are reported, so they can be charred", () => {
  const g = emptyFire();
  fuelFrom(g, worldOf(plank(7, 0, 0, 1, 0.5)));
  igniteThing(g, 7);
  const out = run(g, 40);
  assert.ok(out.includes(7));
  assert.equal(burningCells(g).length, 0, "nothing left burning");
});

test("water puts it out and wet wood will not light; rain slowly does the same", () => {
  const g = emptyFire();
  fuelFrom(g, worldOf(plank(1, 0, 0, 3, 1)));
  igniteThing(g, 1);
  run(g, 1);
  assert.ok(burningCells(g).length > 0);
  const hissed = douse(g, 0, 0, 2, 1);
  assert.ok(hissed > 0, "it hisses");
  run(g, 0.5);
  assert.equal(burningCells(g).length, 0, "out");
  assert.equal(ignite(g, 0, 0, 1), 0, "too wet to light");
  const r = emptyFire();
  fuelFrom(r, worldOf(plank(2, 0, 0, 3, 1)));
  igniteThing(r, 2);
  run(r, 30, { wind: { x: 0, z: 0 }, rain: 1 });
  assert.equal(burningCells(r).length, 0, "rain puts it out in the end");
});

test("the wind carries it downwind", () => {
  const spread = (wind: number) => {
    const g = emptyFire();
    fuelFrom(g, worldOf(plank(1, 0, 0, 6, 0.5)));
    ignite(g, 0, 0, 0.1);
    run(g, 3, { wind: { x: wind, z: 0 }, rain: 0 });
    const xs = burningCells(g).map((i) => (i % g.n) * FIRE.cell + g.originX);
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  const windy = spread(6);
  assert.ok(windy.max > -windy.min, `further downwind (+x): ${windy.min.toFixed(1)}..${windy.max.toFixed(1)}`);
});

test("words and tools: set fire, a campfire, put it out", () => {
  assert.deepEqual(fireIntent("set the bench on fire"), { tool: "set_fire", arguments: { thing: "bench" } });
  assert.deepEqual(fireIntent("light a campfire"), { tool: "make_campfire", arguments: {} });
  assert.deepEqual(fireIntent("put out the fire"), { tool: "put_out_fire", arguments: {} });
  assert.equal(fireIntent("make a red cube"), null);
  const w = labWorld();
  const lit = executeProposal(w, { kind: "tool_call", toolName: "set_fire", arguments: { thing: "bench" } });
  assert.ok(lit.ok, lit.result);
  const bench = Object.values(lit.world.entities).find((e) => e.name === "Bench")!;
  assert.equal(bench.customData.ignite, "1");
  const camp = executeProposal(w, { kind: "tool_call", toolName: "make_campfire", arguments: {} });
  assert.equal(Object.values(camp.world.entities).filter((e) => e.tags.includes("campfire")).length, 3);
  const out = executeProposal(lit.world, { kind: "tool_call", toolName: "put_out_fire", arguments: {} });
  assert.ok(Object.values(out.world.entities).find((e) => e.name === "Bench")!.customData.douse);
});
