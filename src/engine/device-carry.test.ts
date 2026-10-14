import assert from "node:assert/strict";
import test from "node:test";
import { carryAlong, carryOf, deviceDistance, deviceOf, drop, ensureScreen, handSpot, pickUp, pullOut, putAway, SCREEN_REACH, STAND, summonStep } from "./device-apps.ts";
import type { Entity } from "./types.ts";

function avatar(x: number, z: number, yaw = 0): Entity {
  return {
    id: 1,
    name: "Architect",
    transform: { position: { x, y: 0.45, z }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    representation: { kind: "hybrid", meshAssetId: "avatar", particleCount: 0 } as unknown as Entity["representation"],
    physics: null,
    tags: ["architect"],
    customData: { yaw: String(yaw) },
  };
}

const world = (x: number, z: number, yaw = 0) => ensureScreen({ entities: { 1: avatar(x, z, yaw) }, nextId: 2 }, "phone");
const device = (w: { entities: Record<number, Entity> }) => deviceOf(w)!;

test("the phone waits on its stand, and can only be picked up within reach", () => {
  const far = world(-6, 6);
  assert.equal(carryOf(device(far)), "lying");
  assert.deepEqual(device(far).transform.position, STAND);
  assert.equal(pickUp(far), far, "too far away: nothing happens");
  const near = world(STAND.x - 1, STAND.z);
  assert.ok(deviceDistance(near) < SCREEN_REACH);
  assert.equal(carryOf(device(pickUp(near))), "pocket");
});

test("pull out, put away, drop: it goes from pocket to hand and back, and stays where it is dropped", () => {
  let w = pickUp(world(STAND.x - 1, STAND.z, 0));
  w = pullOut(w);
  assert.equal(carryOf(device(w)), "out");
  // In front of you (yaw 0 faces +z), facing back towards you.
  const out = device(w);
  assert.ok(out.transform.position.z > STAND.z + 0.4);
  assert.ok(Math.abs(Number(out.customData.yaw) - Math.PI) < 0.01);
  w = putAway(w);
  assert.equal(carryOf(device(w)), "pocket");
  w = drop(w);
  assert.equal(carryOf(device(w)), "lying");
  assert.ok(device(w).transform.position.z > STAND.z, "dropped in front of you");
  assert.equal(pullOut(w), w, "nothing to pull out once it is dropped");
});

test("a carried phone follows you; a dropped one does not", () => {
  let w = pickUp(world(STAND.x - 1, STAND.z));
  const entities = { ...w.entities };
  carryAlong(entities, { position: { x: 40, y: 0.45, z: -30 }, yaw: 1 });
  assert.deepEqual(device({ entities }).transform.position, handSpot({ position: { x: 40, y: 0.45, z: -30 }, yaw: 1 }, "pocket").position);
  w = drop(w);
  const still = { ...w.entities };
  carryAlong(still, { position: { x: 40, y: 0.45, z: -30 }, yaw: 1 });
  assert.deepEqual(device({ entities: still }).transform.position, device(w).transform.position);
});

test("a lost phone, summoned, flies back in an arc and lands in your hand", () => {
  const w = world(30, 30, 0.5);
  const from = device(w).transform.position;
  const mid = summonStep(w, from, 0.5);
  assert.equal(carryOf(device(mid)), "lying");
  assert.equal(device(mid).customData.flight, "1");
  const hand = handSpot({ position: { x: 30, y: 0.45, z: 30 }, yaw: 0.5 }, "out").position;
  assert.ok(device(mid).transform.position.y > Math.max(from.y, hand.y), "up in the air on the way");
  const landed = summonStep(w, from, 1);
  assert.equal(carryOf(device(landed)), "out");
  assert.deepEqual(device(landed).transform.position, hand);
  assert.equal(device(landed).customData.flight, undefined);
});

test("an older fixed screen in a saved world is replaced by the phone", () => {
  const old = world(0, 0);
  const d = device(old);
  const stale = { ...old, entities: { ...old.entities, [d.id]: { ...d, customData: { ...d.customData, model: "" } } } };
  const fresh = ensureScreen(stale, "phone");
  assert.notEqual(device(fresh).id, d.id);
  assert.equal(Object.values(fresh.entities).filter((e) => e.tags.includes("device-screen")).length, 1);
  assert.equal(ensureScreen(fresh, "phone"), fresh);
});
