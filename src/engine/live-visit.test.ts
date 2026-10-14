import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startIsland } from "../../scripts/island-node.ts";
import { placeVisited, type View } from "./island-content.ts";
import { buildManifest, generateIdentity, signManifest } from "./island.ts";
import { LiveVisit, mergeVisited, removeVisited, visitedIds } from "./live-visit.ts";
import { labWorld } from "./manifold.ts";
import { enterIsland, syncIsland } from "./portal-client.ts";
import type { World } from "./types.ts";

async function visitor(name: string) {
  const identity = await generateIdentity();
  const signed = await signManifest(
    await buildManifest(identity, { name, address: `forge://${name.toLowerCase()}.local/home`, entry: { kind: "world", sha256: "", bytes: 0 } }),
    identity,
  );
  return { identity, signed };
}

const close = (server: { close: (cb: () => void) => void; closeAllConnections?: () => void }) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });

const OFFSET = { x: 40, y: 0, z: 0 };
const half = (world: World, hostId: string) => Object.values(world.entities).filter((e) => e.customData.island === hostId);

test("two players beside one island see it and each other live; stopping the host removes its half", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-live-"));
  const port = 21820 + Math.floor(Math.random() * 1000);
  const node = await startIsland({ name: "Plaza", slug: "plaza", host: "localhost", port, allow: ["render", "input"], dir });
  let stopped = false;
  try {
    const ana = await visitor("Ana");
    const ben = await visitor("Ben");
    const va = await enterIsland(ana.signed, ana.identity, node.address);
    const vb = await enterIsland(ben.signed, ben.identity, node.address);
    assert.ok(va.status === "inside" && vb.status === "inside");
    if (va.status !== "inside" || vb.status !== "inside") return;
    const hostId = va.host.manifest.id;
    let worldA = placeVisited(labWorld(), va.entry, hostId, OFFSET);
    let worldB = placeVisited(labWorld(), vb.entry, hostId, OFFSET);
    const own = Object.keys(labWorld().entities).length;
    const linkA = new LiveVisit(hostId, OFFSET, (view, inputs) => syncIsland(va.base, va.session, view, 2000, inputs), 3);
    const linkB = new LiveVisit(hostId, OFFSET, (view, inputs) => syncIsland(vb.base, vb.session, view, 2000, inputs), 3);
    // Both stand at the near edge of the island looking in (local coordinates).
    const viewA: View = { position: { x: 40, y: 1.6, z: 6 }, forward: { x: 0, y: 0, z: -1 }, budget: 200_000, tier: "high" };
    const viewB: View = { position: { x: 40.5, y: 1.6, z: 8 }, forward: { x: 0, y: 0, z: -1 }, budget: 200_000, tier: "high" };

    // Ana walks onto the island; her movement is predicted and the host walks her too.
    const walk = linkA.walk({ position: viewA.position, yaw: Math.PI });
    for (let round = 0; round < 6; round += 1) {
      for (let f = 0; f < 6; f += 1) walk.input(1, 0, 0, 1 / 60);
      const shown = linkA.toLocal(walk.shown().position);
      const ra = await linkA.round({ ...viewA, position: shown });
      const rb = await linkB.round(viewB);
      assert.ok(ra.status === "live" && rb.status === "live");
      worldA = ra.apply(worldA);
      worldB = rb.apply(worldB);
    }
    assert.ok(walk.maxCorrection < 1e-9, "the host agreed with Ana's prediction");
    // Ben sees Ana's marker where the host put her, beside his own world.
    const marker = half(worldB, hostId).find((e) => e.customData.visitor === ana.signed.manifest.id);
    assert.ok(marker, "Ben sees Ana");
    const anaLocal = linkA.toLocal(walk.predicted.position);
    // It is drawn from a track of the host's snapshots: at most a short extrapolation past her last one.
    const drawn = linkB.others(worldB, performance.now() / 1000 + 10).get(marker!.id)!;
    assert.ok(Math.hypot(drawn.x - anaLocal.x, drawn.z - anaLocal.z) < 1.2, JSON.stringify({ drawn, anaLocal }));
    assert.ok(anaLocal.z < 6 - 0.4, "Ana walked forward");
    assert.ok(half(worldA, hostId).some((e) => e.customData.visitor === ben.signed.manifest.id), "Ana sees Ben");

    // The host changes something: both copies follow.
    const lamp = Object.values(node.host.world.entities).find((e) => !e.tags.includes("presence"))!;
    node.host.setWorld({ ...node.host.world, entities: { ...node.host.world.entities, [lamp.id]: { ...lamp, name: "Moved lamp", transform: { ...lamp.transform, position: { ...lamp.transform.position, y: lamp.transform.position.y + 2 } } } } });
    worldA = (await linkA.round(viewA)).apply(worldA);
    worldB = (await linkB.round(viewB)).apply(worldB);
    for (const w of [worldA, worldB]) {
      const local = w.entities[visitedIds(w, hostId).get(lamp.id)!];
      assert.equal(local?.name, "Moved lamp");
      assert.equal(local.transform.position.x, lamp.transform.position.x + OFFSET.x);
    }

    // The host stops: after a few missed rounds its half is gone and the visitor's own world stays.
    await close(node.server);
    stopped = true;
    let result = await linkB.round(viewB);
    for (let i = 0; i < 5 && result.status === "live"; i += 1) {
      worldB = result.apply(worldB);
      result = await linkB.round(viewB);
    }
    assert.equal(result.status, "gone");
    worldB = result.apply(worldB);
    assert.equal(half(worldB, hostId).length, 0);
    assert.equal(Object.keys(worldB.entities).length, own);
  } finally {
    if (!stopped) await close(node.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merging: enter, update and leave map host ids to stable local ids", () => {
  const base = labWorld();
  const e = Object.values(base.entities)[0];
  const reply = (enter: typeof e[], update: typeof e[], leave: number[]) => ({ tick: 0, enter, update, leave, bytes: 0, dropped: 0 });
  let w = mergeVisited(base, "h", OFFSET, reply([{ ...e, id: 7 }], [], []));
  const id = visitedIds(w, "h").get(7)!;
  assert.ok(id >= base.nextId);
  w = mergeVisited(w, "h", OFFSET, reply([], [{ ...e, id: 7, name: "renamed" }], []));
  assert.equal(visitedIds(w, "h").get(7), id, "same local id after an update");
  assert.equal(w.entities[id].name, "renamed");
  assert.ok(w.entities[id].tags.includes("read-only"));
  w = mergeVisited(w, "h", OFFSET, reply([], [], [7]));
  assert.equal(w.entities[id], undefined);
  assert.deepEqual(Object.keys(removeVisited(placeVisited(base, { forge: "island-world", version: 1, entities: [e] }, "h", OFFSET), "h").entities), Object.keys(base.entities));
});

test("stepping off a visited island and back on starts a new walk the host follows", async () => {
  const { IslandHost } = await import("./island-content.ts");
  const host = new IslandHost(labWorld());
  const token = host.open("ana", ["render", "input"]);
  const link = new LiveVisit("h", OFFSET, async (view, inputs) => {
    const r = host.sync(token, view, inputs);
    return "error" in r ? { error: r.error } : r;
  });
  let world = placeVisited(labWorld(), { forge: "island-world", version: 1, entities: Object.values(labWorld().entities) }, "h", OFFSET);
  link.measure(world);
  assert.ok(link.contains({ x: 40, y: 0, z: 0 }) && !link.contains({ x: 0, y: 0, z: 0 }), "the island sits around x = 40");
  const view: View = { position: { x: 40, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 } };
  for (const startX of [40, 43]) {
    const walker = link.walk({ position: { x: startX, y: 0, z: 0 }, yaw: 0 });
    for (let round = 0; round < 4; round += 1) {
      walker.input(1, 0, 0.1, 1 / 30);
      world = (await link.round(view)).apply(world);
    }
    assert.ok(walker.maxCorrection < 1e-9, `walk from x = ${startX}: the host followed it`);
    link.leave();
  }
});

test("other visitors keep their place between syncs and are drawn from a smooth track", async () => {
  const { IslandHost } = await import("./island-content.ts");
  const host = new IslandHost(labWorld());
  const me = host.open("me", ["render", "input"]);
  const other = host.open("other", ["render", "input"]);
  const link = new LiveVisit("h", OFFSET, async (view) => {
    const r = host.sync(me, view);
    return "error" in r ? { error: r.error } : r;
  });
  let world = labWorld();
  const view: View = { position: { x: 40, y: 0, z: 10 }, forward: { x: 0, y: 0, z: -1 }, budget: 200_000 };
  for (let i = 0; i < 4; i += 1) {
    host.sync(other, { position: { x: i, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 } });
    world = (await link.round(view)).apply(world);
  }
  const marker = half(world, "h").find((e) => e.customData.visitor === "other")!;
  assert.ok(marker, "the other visitor is there");
  assert.equal(marker.transform.position.x, OFFSET.x, "merging keeps the marker where it was first placed");
  const drawn = link.others(world).get(marker.id);
  assert.ok(drawn && drawn.x >= OFFSET.x && drawn.x <= OFFSET.x + 3, "the track gives a position along the path");
});
