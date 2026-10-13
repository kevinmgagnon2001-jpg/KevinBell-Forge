import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startIsland } from "../../scripts/island-node.ts";
import { buildManifest, generateIdentity, signManifest } from "./island.ts";
import { openPortal } from "./portal-client.ts";

const close = (server: { close: (cb: () => void) => void }) => new Promise<void>((resolve) => server.close(() => resolve()));

test("a live self-hosted island accepts a portal, then disappears when it stops", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-island-"));
  const port = 17420 + Math.floor(Math.random() * 1000);
  const node = await startIsland({ name: "Host", slug: "host", host: "localhost", port, allow: ["render", "portal"], dir });
  try {
    const identity = await generateIdentity();
    const me = await signManifest(
      await buildManifest(identity, { name: "Me", address: "forge://me.local/me", entry: { kind: "world", sha256: "", bytes: 0 } }),
      identity,
    );
    const open = await openPortal(me, identity, node.address, ["render", "fetch"]);
    assert.equal(open.status, "open", JSON.stringify(open));
    if (open.status === "open") {
      assert.deepEqual(open.grant, ["render"]);
      assert.equal(open.host.manifest.id, node.identity.id);
    }
    await close(node.server);
    const gone = await openPortal(me, identity, node.address, ["render"], { timeoutMs: 1500 });
    assert.equal(gone.status, "offline");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the island keeps its identity across restarts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-island-"));
  const port = 18520 + Math.floor(Math.random() * 1000);
  try {
    const first = await startIsland({ name: "A", slug: "a", host: "localhost", port, allow: [], dir });
    await close(first.server);
    const second = await startIsland({ name: "A", slug: "a", host: "localhost", port, allow: [], dir });
    await close(second.server);
    assert.equal(first.identity.id, second.identity.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed or oversized hello is rejected without crashing the node", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-island-"));
  const port = 19620 + Math.floor(Math.random() * 1000);
  const node = await startIsland({ name: "H", slug: "h", host: "localhost", port, allow: ["render"], dir });
  try {
    const junk = await fetch(`http://localhost:${port}/portal/hello`, { method: "POST", body: "not json" });
    assert.equal(junk.status, 400);
    const empty = await fetch(`http://localhost:${port}/portal/hello`, { method: "POST", body: "{}" });
    assert.equal(empty.status, 403);
    const big = await fetch(`http://localhost:${port}/portal/hello`, { method: "POST", body: "x".repeat(200_000) }).catch(() => null);
    assert.ok(big === null || big.status === 400);
    const health = await fetch(`http://localhost:${port}/health`);
    assert.equal(health.status, 200);
  } finally {
    await close(node.server);
    rmSync(dir, { recursive: true, force: true });
  }
});
