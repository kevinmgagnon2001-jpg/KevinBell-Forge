import { test } from "node:test";
import assert from "node:assert/strict";
import { collidePairs, solidOf, solidsOf, stepBodies, stepWalk, WALK, type Solid, type WalkInput, type WalkState } from "./physics.ts";
import { labWorld, makeSpawned } from "./manifold.ts";
import type { Entity } from "./types.ts";

const flat = () => 0;
const still: WalkInput = { vx: 0, vz: 0, jump: false, fly: null };

function block(id: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, extra: Record<string, string> = {}): Entity {
  const e = makeSpawned(id, { asset: "cube", kinematic: "true", physics: "true", ...extra });
  return { ...e, transform: { ...e.transform, position: { x, y, z }, scale: { x: sx, y: sy, z: sz } } };
}

function walk(state: WalkState, input: WalkInput, solids: Solid[], seconds: number) {
  let s = state;
  let landed = 0;
  let bumped = false;
  const shoved: number[] = [];
  for (let t = 0; t < seconds * 60; t += 1) {
    const r = stepWalk(s, input, solids, 1 / 60, flat);
    s = r.state;
    landed = Math.max(landed, r.landed);
    bumped ||= r.bumped;
    shoved.push(...r.shoved.map((x) => x.id));
    // Jump is a press, not a hold.
    input = { ...input, jump: false };
  }
  return { s, landed, bumped, shoved };
}

test("falls, lands and stands; the lab deck holds you up", () => {
  const air: WalkState = { x: 0, y: 3, z: 0, vy: 0, grounded: false };
  const fell = walk(air, still, [], 1.5);
  assert.equal(fell.s.y, 0);
  assert.ok(fell.s.grounded);
  assert.ok(fell.landed > 5, `landed at ${fell.landed}`);
  const lab = solidsOf(labWorld().entities);
  const onDeck = walk({ x: 0.15, y: 1, z: -2.2, vy: 0, grounded: false }, still, lab, 1);
  assert.ok(Math.abs(onDeck.s.y - 0.16) < 1e-6, `stood at ${onDeck.s.y}`);
});

test("walls stop you, kerbs and stairs do not, a tall box needs a jump", () => {
  const wall = solidsOf([block(1, 2, 1, 0, 0.2, 2, 4)]);
  const stopped = walk({ x: 0, y: 0, z: 0, vy: 0, grounded: true }, { ...still, vx: 3 }, wall, 2);
  assert.ok(stopped.bumped);
  assert.ok(stopped.s.x < 2 - 0.1 - WALK.radius + 0.01 && stopped.s.x > 1.6, `stopped at ${stopped.s.x}`);
  // Walking at a wall at an angle slides along it.
  const slid = walk({ x: 0, y: 0, z: 0, vy: 0, grounded: true }, { ...still, vx: 3, vz: 1 }, wall, 2);
  assert.ok(slid.s.z > 1.5);

  const kerb = solidsOf([block(1, 2, 0.15, 0, 2, 0.3, 4)]);
  const up = walk({ x: 0, y: 0, z: 0, vy: 0, grounded: true }, { ...still, vx: 3 }, kerb, 1);
  assert.ok(up.s.x > 1.5 && Math.abs(up.s.y - 0.3) < 1e-6, `on the kerb at ${up.s.x}, ${up.s.y}`);

  const crate = solidsOf([block(1, 2, 0.36, 0, 1.2, 0.72, 4)]);
  const blocked = walk({ x: 0, y: 0, z: 0, vy: 0, grounded: true }, { ...still, vx: 3 }, crate, 1);
  assert.equal(blocked.s.y, 0);
  const hopped = walk({ x: 0.4, y: 0, z: 0, vy: 0, grounded: true }, { ...still, vx: 3, jump: true }, crate, 0.7);
  assert.ok(Math.abs(hopped.s.y - 0.72) < 1e-6, `jumped onto the crate: ${hopped.s.x}, ${hopped.s.y}`);
});

test("ceilings stop a jump, and you can walk out of anything you start inside", () => {
  const roof = solidsOf([block(1, 0, 1.7, 0, 3, 0.2, 3)]);
  let s: WalkState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  let top = 0;
  s = stepWalk(s, { ...still, jump: true }, roof, 1 / 60, flat).state;
  for (let i = 0; i < 60; i += 1) {
    s = stepWalk(s, still, roof, 1 / 60, flat).state;
    top = Math.max(top, s.y);
  }
  assert.ok(top + WALK.height <= 1.6 + 1e-6, `head reached ${top + WALK.height}`);
  const inside = solidsOf([block(1, 0, 0.5, 0, 1, 1, 1)]);
  const out = walk({ x: 0, y: 0, z: 0, vy: 0, grounded: true }, { ...still, vx: 3 }, inside, 1);
  assert.ok(out.s.x > 2);
});

test("flying ignores gravity but not walls", () => {
  const up = walk({ x: 0, y: 0, z: 0, vy: 0, grounded: true }, { ...still, fly: 1, flySpeed: 2 }, [], 1);
  assert.ok(Math.abs(up.s.y - 2) < 0.05);
  const hover = walk(up.s, { ...still, fly: 0 }, [], 1);
  assert.ok(Math.abs(hover.s.y - up.s.y) < 1e-9);
});

test("loose objects get shoved, slide, stop and sleep", () => {
  const crate = block(2, 1.2, 0.3, 0, 0.6, 0.6, 0.6, { kinematic: "false", physics: "true" });
  crate.physics = { ...crate.physics!, isKinematic: false };
  const pushed = walk({ x: 0, y: 0, z: 0, vy: 0, grounded: true }, { ...still, vx: 2 }, solidsOf([crate]), 0.6);
  assert.ok(pushed.shoved.includes(2));
  let entities: Record<number, Entity> = { 2: { ...crate, physics: { ...crate.physics!, velocity: { x: 2.5, y: 0, z: 0 } } } };
  for (let i = 0; i < 180; i += 1) entities = stepBodies(entities, 1 / 60, -9.81, flat);
  const after = entities[2];
  assert.ok(after.transform.position.x > 1.5, `slid to ${after.transform.position.x}`);
  assert.ok(Math.abs(after.transform.position.y - 0.3) < 1e-6);
  assert.equal(stepBodies(entities, 1 / 60, -9.81, flat), entities, "a body at rest sleeps");
});

test("things stack, bounce and knock into each other", () => {
  const base = block(1, 0, 0.5, 0, 1, 1, 1);
  const falling = block(2, 0.1, 3, 0, 0.5, 0.5, 0.5);
  falling.physics = { ...falling.physics!, isKinematic: false };
  let entities: Record<number, Entity> = { 1: base, 2: falling };
  for (let i = 0; i < 240; i += 1) entities = stepBodies(entities, 1 / 60, -9.81, flat);
  assert.ok(Math.abs(entities[2].transform.position.y - 1.25) < 1e-6, `rests on the block at ${entities[2].transform.position.y}`);
  // A ball bounces off the ground before it settles.
  const ball = makeSpawned(3, { asset: "sphere", physics: "true", y: "4" });
  let bounced = false;
  let last = ball.transform.position.y;
  let falling2 = true;
  let world: Record<number, Entity> = { 3: { ...ball, transform: { ...ball.transform, position: { x: 0, y: 4, z: 0 } } } };
  for (let i = 0; i < 300; i += 1) {
    world = stepBodies(world, 1 / 60, -9.81, flat);
    const y = world[3].transform.position.y;
    if (!falling2 && y > last + 1e-6) bounced = true;
    falling2 = y < last;
    last = y;
  }
  assert.ok(bounced);
  // Two balls: the moving one hands its speed on.
  const a = { ...ball, id: 4, transform: { ...ball.transform, position: { x: 0, y: 0.4, z: 0 } }, physics: { ...ball.physics!, velocity: { x: 3, y: 0, z: 0 } } };
  const b = { ...ball, id: 5, transform: { ...ball.transform, position: { x: 0.7, y: 0.4, z: 0 } }, physics: { ...ball.physics!, velocity: { x: 0, y: 0, z: 0 } } };
  const pair: Record<number, Entity> = { 4: a, 5: b };
  assert.ok(collidePairs(pair));
  assert.ok(pair[5].physics!.velocity.x > 1.5 && pair[4].physics!.velocity.x < 1.5);
});

test("what blocks: solids yes; you, the helm, portals and splats no", () => {
  const lab = labWorld();
  const named = (name: string) => Object.values(lab.entities).find((e) => e.name === name)!;
  assert.ok(solidOf(named("Bench")));
  assert.ok(solidOf(named("Column")));
  assert.equal(solidOf(named("ArchitectAvatar")), null);
  assert.equal(solidOf(named("Helm")), null);
  assert.equal(solidOf(named("NeuralBay")), null);
  assert.equal(solidOf(makeSpawned(99, { asset: "portal" })), null);
  // A gauge is about a machine's size, standing on its position.
  const gauge = Object.values(lab.entities).find((e) => e.tags.includes("gauge"))!;
  const g = solidOf(gauge)!;
  assert.equal(g.min.y, gauge.transform.position.y);
});
