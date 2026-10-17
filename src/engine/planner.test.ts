import { test } from "node:test";
import assert from "node:assert/strict";
import { executePlan } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import { findTarget, normalize, planIntent, readItems, splitClauses, suggest, type Plan, type PlanContext } from "./planner.ts";
import type { World } from "./types.ts";

const ctx = (world: World = labWorld(), selectedId: number | null = null, group?: number[]): PlanContext => ({ world, selectedId, group });

function run(world: World, intent: string, selectedId: number | null = null, group?: number[]): { world: World; plan: Plan; made: number[] } {
  const plan = planIntent(ctx(world, selectedId, group), intent);
  assert.ok(plan, `planned: ${intent}`);
  const ran = executePlan(world, plan.calls);
  assert.ok(ran.ok || !plan.calls.length, `${intent}: ${ran.results.join("; ")}`);
  const made: number[] = [];
  for (let id = world.nextId; id < ran.world.nextId; id += 1) if (ran.world.entities[id]) made.push(id);
  return { world: ran.world, plan, made };
}

const asset = (w: World, id: number) => {
  const r = w.entities[id].representation;
  return r.kind === "mesh" ? r.assetId : r.kind;
};

test("words: polite padding goes, clauses split at new verbs only", () => {
  assert.equal(normalize("Could you please make a cube"), "make a cube");
  assert.equal(normalize("I'd like to paint it red"), "paint it red");
  assert.deepEqual(splitClauses("make a red cube, then paint it blue and throw it"), ["make a red cube", "paint it blue", "throw it"]);
  assert.deepEqual(splitClauses("a red cube and a blue sphere"), ["a red cube and a blue sphere"]);
  assert.deepEqual(splitClauses("string lights between the bench and the terminal"), ["string lights between the bench and the terminal"]);
});

test("items: counts in words, colours, sizes, several kinds at once", () => {
  const items = readItems("three big red cubes and two tiny gold balls");
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].kind, items[0].count, items[0].color, items[0].size], ["cube", 3, "red", 1.6]);
  assert.deepEqual([items[1].kind, items[1].count, items[1].color, items[1].size], ["sphere", 2, "gold", 0.4]);
  assert.equal(readItems("a dozen crates")[0].count, 12);
  assert.equal(readItems("some orbs")[0].count, 3);
  assert.equal(readItems("a ring of 8 pillars").length, 1, "the ring is the layout");
});

test("a row of five red cubes: five red cubes side by side in front of you", () => {
  const { world, made, plan } = run(labWorld(), "a row of five red cubes");
  assert.equal(made.length, 5);
  assert.equal(plan.select, "spawned");
  for (const id of made) {
    assert.equal(asset(world, id), "cube");
    assert.equal(world.entities[id].customData.color, "#e15a4a");
  }
  const xs = made.map((id) => world.entities[id].transform.position);
  const spread = Math.hypot(xs[0].x - xs[4].x, xs[0].z - xs[4].z);
  assert.ok(spread > 4, `spread ${spread}`);
  assert.equal(world.undo.length, labWorld().undo.length + 1, "one undo step for the lot");
});

test("stacks sit on each other; on the bench sits on the bench", () => {
  const { world, made } = run(labWorld(), "stack 4 crates on the bench");
  assert.equal(made.length, 4);
  const bench = world.entities[3];
  const benchTop = bench.transform.position.y + bench.transform.scale.y / 2;
  const ys = made.map((id) => world.entities[id].transform.position.y).sort((a, b) => a - b);
  assert.ok(Math.abs(ys[0] - (benchTop + 0.5)) < 0.05, `first on the bench ${ys[0]}`);
  assert.ok(Math.abs(ys[3] - ys[0] - 3) < 0.05, "stacked a cube apart");
  const p = world.entities[made[0]].transform.position;
  assert.ok(Math.hypot(p.x - bench.transform.position.x, p.z - bench.transform.position.z) < 0.01);
});

test("a circle of rainbow pillars; a huge gold sphere in the middle", () => {
  const ring = run(labWorld(), "a circle of 8 rainbow pillars around me");
  assert.equal(ring.made.length, 8);
  assert.equal(new Set(ring.made.map((id) => ring.world.entities[id].customData.color)).size, 8);
  const big = run(labWorld(), "a huge gold sphere in the middle");
  const s = big.world.entities[big.made[0]];
  assert.ok(s.transform.scale.x > 1.8, "huge");
  assert.ok(Math.abs(s.transform.position.x) < 0.1 && Math.abs(s.transform.position.z) < 0.1);
  assert.ok(Math.abs(s.transform.position.y - s.transform.scale.y / 2) < 0.02, "resting on the ground");
});

test("it, them, names with a typo, kind and colour", () => {
  const w = labWorld();
  assert.deepEqual(findTarget(ctx(w, 9), " it ")?.ids, [9]);
  assert.deepEqual(findTarget(ctx(w, null, [5, 6]), " them ")?.ids, [5, 6]);
  assert.deepEqual(findTarget(ctx(w), " the colum ")?.ids, [8], "one typo forgiven");
  assert.deepEqual(findTarget(ctx(w), " the steel ")?.ids, [6]);
  assert.equal(findTarget(ctx(w), " all the cubes ")?.ids.length, 3);
  assert.deepEqual(findTarget(ctx(w), " the blue sphere ")?.ids, [9]);
});

test("edits: paint, grow, move, raise, put on, rename, reshape, texture", () => {
  let w = labWorld();
  w = run(w, "paint the red cube blue").world;
  assert.equal(w.entities[5].customData.color, "#4c8df5", "Clay was the red one");
  w = run(w, "make it twice as big", 9).world;
  assert.ok(Math.abs(w.entities[9].transform.scale.x - 1.56) < 0.01);
  assert.ok(Math.abs(w.entities[9].transform.position.y - 0.56 - 0.39) < 0.02, "grown from the ground up");
  const before = w.entities[8].transform.position.y;
  w = run(w, "raise the column 2 meters").world;
  assert.ok(Math.abs(w.entities[8].transform.position.y - before - 2) < 0.01);
  w = run(w, "put the gold on the bench").world;
  const gold = w.entities[7].transform.position;
  assert.ok(Math.abs(gold.z - 4.15) < 0.01 && gold.y > 0.9);
  w = run(w, "rename the steel to Ferro").world;
  assert.equal(w.entities[6].name, "Ferro");
  w = run(w, "turn the sample into a ring").world;
  assert.equal(asset(w, 9), "ring");
  w = run(w, "give the clay a marble texture").world;
  assert.equal(w.entities[5].customData.src, "tex:marble");
  w = run(w, "make the column taller").world;
  assert.ok(w.entities[8].transform.scale.y > 2.4);
});

test("throw, kick, drop, copy, delete, clear, undo", () => {
  let w = labWorld();
  const thrown = run(w, "throw the sample sphere up");
  assert.ok((thrown.world.entities[9].physics?.velocity.y ?? 0) > 5);
  w = run(w, "a red cube").world;
  const cube = w.nextId - 1;
  const copies = run(w, "copy it 3 times", cube);
  assert.equal(copies.made.length, 3);
  assert.equal(copies.world.entities[copies.made[0]].customData.color, "#e15a4a");
  w = copies.world;
  const dropped = run(w, "drop the gold").world;
  assert.ok(dropped.entities[7].transform.position.y > 2);
  assert.ok(dropped.entities[7].physics, "it falls");
  const fewer = run(w, "delete the red cubes").world;
  assert.equal(Object.values(fewer.entities).filter((e) => e.customData.color === "#e15a4a").length, 0);
  const cleared = run(w, "clear everything I made").world;
  assert.ok(!cleared.entities[cube] && cleared.entities[7], "lab exhibits stay");
  assert.ok(cleared.entities[1], "you stay");
  const back = run(cleared, "undo").world;
  assert.ok(back.entities[cube], "undo brings them back");
  const twice = planIntent(ctx(w), "undo 2 times");
  assert.equal(twice?.calls.length, 2);
});

test("questions answer without changing anything", () => {
  const w = labWorld();
  const count = planIntent(ctx(w), "how many cubes are there?");
  assert.equal(count?.calls.length, 0);
  assert.match(count!.say, /^3 cubes/);
  assert.match(planIntent(ctx(w), "where is the gold?")!.say, /Gold is [\d.]+ m/);
  assert.match(planIntent(ctx(w), "what's here?")!.say, /things here/);
  assert.match(planIntent(ctx(w, 9), "what is that?")!.say, /^Sample: a blue sphere/);
  assert.match(planIntent(ctx(w), "help")!.say, /Try:/);
});

test("your body: walk, turn; agents; games", () => {
  const w = labWorld();
  assert.equal(planIntent(ctx(w), "walk forward 3")?.calls.length, 3);
  assert.equal(planIntent(ctx(w), "turn around")?.calls[0].arguments.move, "turn-right");
  assert.equal(planIntent(ctx(w), "turn around")?.calls.length, 7, "half a turn of 0.45 rad steps");
  assert.equal(planIntent(ctx(w), "turn left 45 degrees")?.calls.length, 2);
  assert.match(planIntent(ctx(w), "a red cube in front of me")!.say, /in front of you/);
  assert.equal(planIntent(ctx(w), "spawn a scout named Ivy")?.calls[0].arguments.name, "Ivy");
  assert.equal(planIntent(ctx(w), "play tetris")?.calls[0].arguments.kind, "tetris");
});

test("unknown words: no plan, and close suggestions", () => {
  assert.equal(planIntent(ctx(), "sing me the song of the sea"), null);
  assert.ok(suggest("set the benchh on fire").some((s) => /fire/.test(s)));
  assert.ok(suggest("domino line").some((s) => /dominoes/.test(s)));
  assert.equal(suggest("zzzz").length, 3);
});
