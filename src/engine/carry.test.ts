import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startIsland } from "../../scripts/island-node.ts";
import { buildManifest, generateIdentity, signManifest, type Capability } from "./island.ts";
import { carryMechanic, enterIsland, islandMechanics, syncIsland } from "./portal-client.ts";
import { LiveVisit } from "./live-visit.ts";
import { CAR, checkMechanic, compileRecipe, mechanicRule, packMechanic, PLANE, type MechanicPackage } from "./mechanic.ts";
import type { View } from "./island-content.ts";

const close = (server: { close: (cb: () => void) => void; closeAllConnections?: () => void }) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });

async function visitor(name: string) {
  const identity = await generateIdentity();
  const signed = await signManifest(await buildManifest(identity, { name, address: `forge://${name.toLowerCase()}.local/v`, entry: { kind: "world", sha256: "", bytes: 0 } }), identity);
  return { identity, signed };
}

async function island(options: { allow?: Capability[]; mechanicFile?: string; maxSpeed?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "forge-carry-"));
  const port = 21000 + Math.floor(Math.random() * 3000);
  const node = await startIsland({ name: "Host", slug: "host", host: "localhost", port, allow: options.allow ?? ["render", "input", "carry"], dir, ...options });
  return { node, dir, stop: async () => {
    await close(node.server);
    rmSync(dir, { recursive: true, force: true });
  } };
}

const view = (x = 0, z = 0): View => ({ position: { x, y: 0.45, z }, forward: { x: 0, y: 0, z: 1 }, budget: 200_000 });

/** Drive with a LiveVisit the way the app does: predict each frame, sync every few frames. */
async function driveOn(live: LiveVisit, frames: number, input: { forward?: number; steer?: number; lift?: number }) {
  const p = live.predictor!;
  for (let i = 0; i < frames; i += 1) {
    p.input(input.forward ?? 0, 0, 0, 1 / 60, { steer: input.steer ?? 0, lift: input.lift ?? 0 });
    if (i % 6 === 5) await live.round(view());
  }
  await live.round(view());
  await live.round(view());
}

test("a visitor drives its own car on someone else's island, and the host agrees to the bit", async () => {
  const { node, stop } = await island();
  try {
    const me = await visitor("Kevin");
    const car = await packMechanic(CAR, me.identity, "Kevin");
    const visit = await enterIsland(me.signed, me.identity, node.address, ["render", "input", "carry"]);
    assert.equal(visit.status, "inside");
    if (visit.status !== "inside") return;
    assert.ok(visit.grant.includes("carry"));

    const carried = await carryMechanic(visit.base, visit.session, car);
    assert.equal(carried.ok, true, JSON.stringify(carried));
    if (!carried.ok) return;
    assert.equal(carried.author, "Kevin");

    // The visitor predicts with the very same mechanic, under the rules the host announced.
    const checked = await checkMechanic(car);
    assert.ok(checked.ok);
    if (!checked.ok) return;
    const live = new LiveVisit(visit.host.manifest.id, { x: 0, y: 0, z: 0 }, (v, inputs) => syncIsland(visit.base, visit.session, v, 4000, inputs));
    live.useRule(mechanicRule(checked.runtime, carried.rules));
    live.walk({ position: { x: 0, y: 0.45, z: 0 }, yaw: 0 });
    await live.round(view());

    await driveOn(live, 120, { forward: 1 });
    await driveOn(live, 90, { forward: 1, steer: 1 });
    const p = live.predictor!;
    assert.equal(p.inFlight, 0, "every input acknowledged");
    assert.equal(p.maxCorrection, 0, "the host never had to correct the visitor: same mechanic, same numbers");
    const slots = p.predicted.slots!;
    assert.ok(slots[5] > 10, `the car is going fast (${slots[5]} m/s)`);
    assert.ok(p.predicted.yaw > 0.2, "and turned left");

    // Another visitor sees a car, not a walker, and can see whose it is.
    const other = await visitor("Ana");
    const visit2 = await enterIsland(other.signed, other.identity, node.address, ["render", "input"]);
    assert.equal(visit2.status, "inside");
    if (visit2.status !== "inside") return;
    const seen = await syncIsland(visit2.base, visit2.session, { ...view(), range: 10_000, budget: 4_000_000 });
    assert.ok(!("error" in seen));
    if ("error" in seen) return;
    const marker = seen.enter.find((e) => e.tags.includes("presence"));
    assert.equal(marker?.customData.look, "car");
    assert.equal(marker?.customData.by, "Kevin");

    // And may keep a copy: it arrives as the same signed package, author and all.
    const listed = await islandMechanics(visit2.base, visit2.session);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].hash, car.hash);
    assert.equal((await checkMechanic(listed[0])).ok, true);
  } finally {
    await stop();
  }
});

test("arriving at speed: a plane keeps its airspeed across the boundary", async () => {
  const { node, stop } = await island();
  try {
    const me = await visitor("Pilot");
    const plane = await packMechanic(PLANE, me.identity, "Pilot");
    const visit = await enterIsland(me.signed, me.identity, node.address, ["render", "input", "carry"]);
    if (visit.status !== "inside") return assert.fail(visit.reason);
    const carried = await carryMechanic(visit.base, visit.session, plane);
    if (!carried.ok) return assert.fail(carried.reason);
    const checked = await checkMechanic(plane);
    if (!checked.ok) return assert.fail(checked.reason);
    const live = new LiveVisit(visit.host.manifest.id, { x: 0, y: 0, z: 0 }, (v, inputs) => syncIsland(visit.base, visit.session, v, 4000, inputs));
    live.useRule(mechanicRule(checked.runtime, carried.rules));
    // Coming in at 30 m/s, 20 m up, full throttle.
    const slots = [0, 20, 0, 0, 0, 30, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    live.walk({ position: { x: 0, y: 20, z: 0 }, yaw: 0, slots });
    await live.round(view());
    await driveOn(live, 60, { forward: 1 });
    const p = live.predictor!;
    assert.equal(p.maxCorrection, 0);
    assert.ok(p.predicted.slots![5] > 25, `still flying fast (${p.predicted.slots![5]})`);
    assert.ok(p.predicted.position.y > 10, "still in the air");
    assert.ok(p.predicted.position.z > 20, "and covered ground");
  } finally {
    await stop();
  }
});

test("the island's speed limit holds for carried mechanics, and the visitor is told it up front", async () => {
  const { node, stop } = await island({ maxSpeed: 8 });
  try {
    const me = await visitor("Speedy");
    const visit = await enterIsland(me.signed, me.identity, node.address, ["render", "input", "carry"]);
    if (visit.status !== "inside") return assert.fail(visit.reason);
    const car = await packMechanic(CAR, me.identity, "Speedy");
    const carried = await carryMechanic(visit.base, visit.session, car);
    if (!carried.ok) return assert.fail(carried.reason);
    assert.equal(carried.rules.maxSpeed, 8);
    const checked = await checkMechanic(car);
    if (!checked.ok) return assert.fail(checked.reason);
    const live = new LiveVisit(visit.host.manifest.id, { x: 0, y: 0, z: 0 }, (v, inputs) => syncIsland(visit.base, visit.session, v, 4000, inputs));
    live.useRule(mechanicRule(checked.runtime, carried.rules));
    live.walk({ position: { x: 0, y: 0.45, z: 0 }, yaw: 0 });
    await live.round(view());
    await driveOn(live, 180, { forward: 1 });
    const p = live.predictor!;
    assert.equal(p.maxCorrection, 0, "the visitor already applied the same limit");
    assert.ok(p.predicted.position.z <= 8 * 3 + 1e-6, `no further than 8 m/s allows (${p.predicted.position.z})`);
  } finally {
    await stop();
  }
});

test("carrying needs the island's permission, and a tampered mechanic is refused", async () => {
  const closed = await island({ allow: ["render", "input"] });
  try {
    const me = await visitor("Kevin");
    const visit = await enterIsland(me.signed, me.identity, closed.node.address, ["render", "input", "carry"]);
    if (visit.status !== "inside") return assert.fail(visit.reason);
    assert.ok(!visit.grant.includes("carry"));
    const refused = await carryMechanic(visit.base, visit.session, await packMechanic(CAR, me.identity, "Kevin"));
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.reason, /carry was not granted/);
  } finally {
    await closed.stop();
  }
  const open = await island();
  try {
    const me = await visitor("Mallory");
    const visit = await enterIsland(me.signed, me.identity, open.node.address, ["render", "input", "carry"]);
    if (visit.status !== "inside") return assert.fail(visit.reason);
    const pkg = await packMechanic(CAR, me.identity, "Mallory");
    const tampered: MechanicPackage = { ...pkg, summary: "now with extra speed" };
    const refused = await carryMechanic(visit.base, visit.session, tampered);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.reason, /signature/);
    // Without a session.
    const stranger = await carryMechanic(visit.base, "0".repeat(36), pkg);
    assert.equal(stranger.ok, false);
  } finally {
    await open.stop();
  }
});

test("an island keeps what visitors bring, and its owner can make one the island's own", async () => {
  const first = await island();
  let saved = "";
  try {
    const me = await visitor("Kevin");
    const visit = await enterIsland(me.signed, me.identity, first.node.address, ["render", "input", "carry"]);
    if (visit.status !== "inside") return assert.fail(visit.reason);
    const carried = await carryMechanic(visit.base, visit.session, await packMechanic(PLANE, me.identity, "Kevin"));
    assert.ok(carried.ok);
    const dir = join(first.dir, "mechanics");
    assert.ok(existsSync(dir));
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^plane-/);
    saved = readFileSync(join(dir, files[0]), "utf8");
  } finally {
    await first.stop();
  }

  // A new island, started with that file as its own way of moving.
  const file = join(mkdtempSync(join(tmpdir(), "forge-carry-")), "plane.json");
  writeFileSync(file, saved);
  const second = await island({ mechanicFile: file });
  try {
    const guest = await visitor("Guest");
    const visit = await enterIsland(guest.signed, guest.identity, second.node.address, ["render", "input"]);
    if (visit.status !== "inside") return assert.fail(visit.reason);
    const own = await islandMechanics(visit.base, visit.session);
    assert.equal(own.length, 1);
    assert.equal(own[0].author.name, "Kevin", "the island credits the mechanic's author");
    // A guest who carries nothing moves the island's way: here, everyone flies.
    const r1 = await syncIsland(visit.base, visit.session, { ...view(), walk: 1, yaw: 0, slots: [0, 0.45, 0, 0, 0, 30, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0] }, 4000, [
      { seq: 1, forward: 1, strafe: 0, turn: 0, dt: 0.1, lift: 1 },
      { seq: 2, forward: 1, strafe: 0, turn: 0, dt: 0.1, lift: 1 },
    ]);
    if ("error" in r1) return assert.fail(r1.error);
    assert.equal(r1.you?.state.slots?.length, 16, "moved by the island's mechanic, not by walking");
    assert.ok((r1.you?.state.position.z ?? 0) > 3, "flying forward");
  } finally {
    await second.stop();
    rmSync(join(file, ".."), { recursive: true, force: true });
  }
});

test("a mechanic that is not valid WebAssembly for a mover never runs", async () => {
  const me = await generateIdentity();
  await assert.rejects(packMechanic({ wasm: new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), name: "Empty", look: "car" }, me, "Me"), /step function/);
  const good = compileRecipe(CAR);
  const bad = new Uint8Array(good);
  bad[bad.length - 1] = 0x03; // the closing `end` becomes a `loop`
  await assert.rejects(packMechanic({ wasm: bad, name: "Bad", look: "car" }, me, "Me"));
});
