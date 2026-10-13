import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startIsland } from "../../scripts/island-node.ts";
import { applySync, encodeEntry, entryFromWorld, entryInfo, makePortal, placeVisited, portalAt, verifyEntry } from "./island-content.ts";
import { buildManifest, generateIdentity, signManifest } from "./island.ts";
import { labWorld } from "./manifold.ts";
import { enterIsland, syncIsland } from "./portal-client.ts";
import type { Entity } from "./types.ts";

const close = (server: { close: (cb: () => void) => void; closeAllConnections?: () => void }) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });

async function visitor(name: string) {
  const identity = await generateIdentity();
  const signed = await signManifest(
    await buildManifest(identity, { name, address: `forge://${name.toLowerCase()}.local/home`, entry: { kind: "world", sha256: "", bytes: 0 } }),
    identity,
  );
  return { identity, signed };
}

test("walking through a portal downloads the host's world and checks it against the signed hash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-island-"));
  const port = 19620 + Math.floor(Math.random() * 1000);
  const node = await startIsland({ name: "Lab", slug: "lab", host: "localhost", port, allow: ["render", "input", "portal"], dir });
  try {
    const me = await visitor("Ana");
    const visit = await enterIsland(me.signed, me.identity, node.address);
    assert.equal(visit.status, "inside", JSON.stringify(visit));
    if (visit.status !== "inside") return;
    assert.equal(visit.host.manifest.name, "Lab");
    assert.deepEqual(visit.grant.sort(), ["input", "render"]);
    const expected = entryFromWorld(labWorld()).entities.length;
    assert.equal(visit.entry.entities.length, expected);
    assert.ok(expected > 3);
    // The visitor renders the host's scene beside its own, read-only.
    const mine = placeVisited(labWorld(), visit.entry, visit.host.manifest.id, { x: 40, y: 0, z: 0 });
    const visited = Object.values(mine.entities).filter((e) => e.tags.includes("visited"));
    assert.equal(visited.length, expected);
    assert.ok(visited.every((e) => e.tags.includes("read-only") && e.transform.position.x >= 30));
  } finally {
    await close(node.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tampered or swapped world is refused", async () => {
  const id = await generateIdentity();
  const bytes = encodeEntry(entryFromWorld(labWorld()));
  const manifest = await buildManifest(id, { name: "X", address: "forge://x.local/x", entry: await entryInfo(bytes) });
  assert.equal((await verifyEntry(manifest, bytes)).ok, true);
  const evil = bytes.slice();
  evil[evil.length - 3] ^= 1;
  const refused = await verifyEntry(manifest, evil);
  assert.equal(refused.ok, false);
  assert.match(!refused.ok ? refused.reason : "", /hash/);
});

test("two visitors on one island: each gets only its own budget, sees the other, and only changes after the first frame", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-island-"));
  const port = 20720 + Math.floor(Math.random() * 1000);
  const node = await startIsland({ name: "Plaza", slug: "plaza", host: "localhost", port, allow: ["render", "input"], dir });
  try {
    const a = await visitor("Ana");
    const b = await visitor("Ben");
    const va = await enterIsland(a.signed, a.identity, node.address);
    const vb = await enterIsland(b.signed, b.identity, node.address);
    assert.ok(va.status === "inside" && vb.status === "inside");
    if (va.status !== "inside" || vb.status !== "inside") return;
    assert.equal(node.host.visitors, 2);

    const viewA = { position: { x: 0, y: 1.6, z: 6 }, forward: { x: 0, y: 0, z: -1 }, budget: 1500, tier: "low" as const };
    const viewB = { position: { x: 0.5, y: 1.6, z: 8 }, forward: { x: 0, y: 0, z: -1 }, budget: 200_000, tier: "high" as const };
    const b1 = await syncIsland(vb.base, vb.session, viewB);
    const a1 = await syncIsland(va.base, va.session, viewA);
    assert.ok(!("error" in a1) && !("error" in b1));
    if ("error" in a1 || "error" in b1) return;
    assert.ok(a1.bytes <= 1500, `A got ${a1.bytes} bytes`);
    assert.ok(a1.enter.some((e) => e.tags.includes("proxy")), "a small budget gets proxies");
    assert.ok(b1.bytes > a1.bytes);
    // Ben, standing behind Ana and facing the same way, sees her presence marker once she has reported where she is.
    const b2 = await syncIsland(vb.base, vb.session, viewB);
    assert.ok(!("error" in b2));
    if ("error" in b2) return;
    const seen = [...b2.enter, ...b2.update].find((e) => e.tags.includes("visitor"));
    assert.ok(seen, "Ben sees Ana");
    assert.equal(seen!.customData.visitor, a.signed.manifest.id);
    // Nothing moved: Ana's next round is empty except for Ben's marker.
    const a2 = await syncIsland(va.base, va.session, viewA);
    assert.ok(!("error" in a2));
    if ("error" in a2) return;
    assert.ok([...a2.enter, ...a2.update].every((e) => e.tags.includes("visitor")), JSON.stringify(a2.enter.map((e) => e.name)));
    let mirror = new Map<number, Entity>();
    mirror = applySync(mirror, a1);
    mirror = applySync(mirror, a2);
    assert.ok(mirror.size >= a1.enter.length);
    // A visitor without a session gets nothing.
    const stranger = await syncIsland(va.base, "0".repeat(36), viewA);
    assert.ok("error" in stranger);
  } finally {
    await close(node.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a portal is an entity; standing in it yields its address", () => {
  const world = makePortal(labWorld(), "forge://Friend.Example:7420/garden", { x: 3, y: 0, z: -2 });
  const hit = portalAt(world, { x: 3.4, y: 1, z: -2.3 });
  assert.equal(hit?.address, "forge://friend.example:7420/garden");
  assert.equal(portalAt(world, { x: 9, y: 1, z: 9 }), null);
  assert.throws(() => makePortal(labWorld(), "http://nope", { x: 0, y: 0, z: 0 }));
});

test("typing a forge:// address places a portal through the harness, without a model", async () => {
  const { runHarness } = await import("./vm.ts");
  const ran = runHarness(labWorld(), "open a portal to forge://friend.example:7420/garden", { kind: "message", arguments: {}, message: "no" });
  assert.equal(ran.ok, true, ran.result);
  const portals = Object.values(ran.world.entities).filter((e) => e.tags.includes("portal"));
  assert.equal(portals.length, 1);
  assert.equal(portals[0].customData.portal, "forge://friend.example:7420/garden");
});
