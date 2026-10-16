import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, CATALOG_VERSION, SECTIONS, isNew, searchCatalog, worldRows } from "./catalog.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import { planIntent } from "./planner.ts";
import { routeIntent } from "./route.ts";

test("every catalog entry is understood with no model loaded", () => {
  const world = labWorld();
  const missed: string[] = [];
  for (const item of CATALOG) {
    // Some entries act on the selection or a companion: give them one.
    const routed = routeIntent(world, 9, item.intent);
    const plan = routed ? null : planIntent({ world, selectedId: 9, group: [5, 6, 7] }, item.intent);
    if (!routed && !plan) missed.push(`${item.id}: ${item.intent}`);
  }
  assert.deepEqual(missed, []);
});

test("routed catalog calls run in the harness", () => {
  const world = labWorld();
  const failed: string[] = [];
  for (const item of CATALOG) {
    const routed = routeIntent(world, 9, item.intent);
    if (routed?.kind !== "call") continue;
    // Orders need a companion first; knocking over needs something to knock.
    if (routed.tool === "order_companion" || routed.tool === "knock_over") continue;
    const ran = executeProposal(world, { kind: "tool_call", toolName: routed.tool, arguments: routed.arguments });
    if (!ran.ok) failed.push(`${item.id}: ${ran.result}`);
  }
  assert.deepEqual(failed, []);
});

test("ids are unique, every section has entries, search and new marks work", () => {
  assert.equal(new Set(CATALOG.map((i) => i.id)).size, CATALOG.length);
  for (const section of SECTIONS) assert.ok(CATALOG.some((i) => i.section === section.id), section.id);
  assert.ok(searchCatalog("arcade").some((i) => i.id === "game-breakout"));
  assert.ok(searchCatalog("fire camp").every((i) => /camp/i.test(`${i.name} ${i.intent} ${i.blurb}`)));
  assert.ok(CATALOG.some((i) => isNew(i, 1)));
  assert.ok(!CATALOG.some((i) => isNew(i, CATALOG_VERSION)));
});

test("in this world: grouped by kind, fresh after what you last saw", () => {
  const groups = worldRows(labWorld(), 10);
  const lab = groups.find((g) => g.kind === "The lab");
  assert.ok(lab && lab.rows.length > 5);
  assert.ok(groups.flatMap((g) => g.rows).some((r) => r.fresh));
  assert.ok(!groups.flatMap((g) => g.rows).some((r) => r.name === "Helm"));
});
