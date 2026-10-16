import { test } from "node:test";
import assert from "node:assert/strict";
import { carriable, companionOf, companionPrompt, freshState, ordersFromModel, readOrders, stepCompanion, summon, thingsCalled, type CompanionState } from "./companion.ts";
import { labWorld } from "./manifold.ts";
import type { Vec3, World } from "./types.ts";

function setup() {
  const world = summon(labWorld(), {}).world;
  const self = companionOf(world)!;
  return { world, self };
}

/** Run the companion for `seconds`, applying what it moves to the world. */
function run(world: World, state: CompanionState, me: Vec3, yaw: number, seconds: number) {
  let w = world;
  let s = state;
  const said: string[] = [];
  for (let t = 0; t < seconds; t += 1 / 30) {
    const self = companionOf(w)!;
    const step = stepCompanion(w, self, s, me, yaw, 1 / 30);
    s = step.state;
    if (step.done) said.push(step.done);
    const entities = { ...w.entities, [self.id]: { ...self, transform: { ...self.transform, position: { x: s.x, y: s.y, z: s.z } } } };
    for (const m of step.moved) entities[m.id] = { ...entities[m.id], transform: { ...entities[m.id].transform, position: m.position } };
    w = { ...w, entities };
  }
  return { world: w, state: s, said };
}

test("words to orders: follow, wait, come, go, bring, stack; nonsense is not an order", () => {
  const { world } = setup();
  const me = { x: 0, y: 0.78, z: -2 };
  assert.deepEqual(readOrders("follow me", world, me, 0)?.tasks, [{ kind: "follow" }]);
  assert.deepEqual(readOrders("wait here", world, me, 0)?.tasks, [{ kind: "wait" }]);
  assert.equal(readOrders("come here", world, me, 0)?.tasks[0].kind, "go");
  const bring = readOrders("bring me the gold", world, me, 0)!;
  assert.equal(bring.tasks[0].kind, "fetch");
  const stack = readOrders("stack the cubes here", world, me, 0)!;
  assert.equal(stack.tasks.length, 3, "Clay, Steel and Gold");
  const two = readOrders("go to the bench and then wait", world, me, 0)!;
  assert.deepEqual(two.tasks.map((t) => t.kind), ["go", "wait"]);
  assert.match(readOrders("bring me the moon", world, me, 0)!.reply, /can't find/);
  assert.equal(readOrders("sing a song about trees", world, me, 0), null);
  assert.ok(!carriable(Object.values(world.entities).find((e) => e.name === "Bench")!), "the bench is too big");
  assert.equal(thingsCalled(world, "balls").length >= 1, true);
});

test("it follows you, and brings you what you ask for", () => {
  const { world, self } = setup();
  const me = { x: 1, y: 0.78, z: -3 };
  let s = freshState(self);
  let r = run(world, s, me, 0, 4);
  assert.ok(Math.hypot(r.state.x - me.x, r.state.z - me.z) < 2, "keeps close behind you");
  s = { ...r.state, queue: readOrders("bring me the gold", r.world, me, 0)!.tasks };
  r = run(r.world, s, me, 0, 20);
  const gold = Object.values(r.world.entities).find((e) => e.name === "Gold")!;
  assert.ok(Math.hypot(gold.transform.position.x - me.x, gold.transform.position.z - me.z) < 1.6, "the gold is in front of you");
  assert.ok(r.said.includes("Done!"));
  assert.equal(r.state.held, null);
});

test("it stacks things on one spot, one on top of another", () => {
  const { world, self } = setup();
  const me = { x: 0, y: 0.78, z: -1 };
  const s = { ...freshState(self), queue: readOrders("stack the cubes here", world, me, 0)!.tasks };
  const r = run(world, s, me, 0, 60);
  const cubes = ["Clay", "Steel", "Gold"].map((n) => Object.values(r.world.entities).find((e) => e.name === n)!.transform.position);
  const ys = cubes.map((p) => p.y).sort((a, b) => a - b);
  for (const p of cubes) assert.ok(Math.hypot(p.x - cubes[0].x, p.z - cubes[0].z) < 0.05, "one spot");
  assert.ok(ys[1] - ys[0] > 0.6 && ys[2] - ys[1] > 0.6, `stacked: ${ys.map((y) => y.toFixed(2)).join(", ")}`);
});

test("the model fallback speaks the same little language", () => {
  const { world } = setup();
  assert.match(companionPrompt("tidy up the cubes", world), /Things it can carry: .*Gold/);
  const line = ordersFromModel("1. go to the bench\n2. bring me the clay\nsome chatter");
  assert.equal(line, "go to the bench then bring me the clay");
  assert.equal(readOrders(line, world, { x: 0, y: 0.78, z: 0 }, 0)?.tasks.length, 2);
});
