import assert from "node:assert/strict";
import test from "node:test";
import { assignZones, diff, ghostZones, idealLod, selectForViewer, visible, zoneOf, type Known, type RepEntity, type Viewer } from "./replication.ts";

const cost = [4000, 1000, 250, 40]; // full, mid, coarse, proxy
const at = (id: number, x: number, z: number, radius = 1, extra: Partial<RepEntity> = {}): RepEntity => ({
  id, position: { x, y: 0, z }, radius, version: 1, cost, ...extra,
});
const viewer = (extra: Partial<Viewer> = {}): Viewer => ({
  id: "v", position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, fovDeg: 90, range: 100, tier: "high", budget: 1_000_000, nearRadius: 2, ...extra,
});

test("only what the camera can see is sent", () => {
  const v = viewer();
  assert.equal(visible(at(1, 0, 10), v), true); // straight ahead
  assert.equal(visible(at(2, 0, -10), v), false); // behind
  assert.equal(visible(at(3, 0, 500), v), false); // too far
  assert.equal(visible(at(4, 0, -1.5), v), true); // behind but within the near radius
  assert.equal(visible(at(5, 0, -10, 1, { always: true }), v), true); // own avatar
  assert.equal(visible(at(6, 12, 10, 8), v), true); // centre outside the cone, but the sphere pokes in
});

test("detail drops with distance and with weaker devices", () => {
  const near = at(1, 0, 1.5);
  const far = at(2, 0, 60);
  assert.equal(idealLod(near, viewer()), 0);
  assert.ok(idealLod(far, viewer()) > idealLod(near, viewer()));
  assert.ok(idealLod(near, viewer({ tier: "low" })) > idealLod(near, viewer()));
  assert.ok(idealLod(far, viewer({ tier: "low" })) <= cost.length - 1);
});

test("a tight budget keeps everything visible as proxies and sharpens the closest first", () => {
  const world = [at(1, 0, 2), at(2, 0, 10), at(3, 0, 40), at(4, 0, -50)];
  const roomy = selectForViewer(world, viewer());
  assert.deepEqual(roomy.picks.map((p) => p.id), [1, 2, 3]); // 4 is behind
  const tight = selectForViewer(world, viewer({ budget: 40 * 3 + 960 }));
  assert.ok(tight.bytes <= 40 * 3 + 960);
  assert.equal(tight.picks.length, 3);
  const byId = new Map(tight.picks.map((p) => [p.id, p.lod]));
  assert.ok((byId.get(1) ?? 9) < (byId.get(3) ?? 0)); // the near one got the detail
  const starved = selectForViewer(world, viewer({ budget: 80 }));
  assert.equal(starved.picks.length, 2);
  assert.deepEqual(starved.dropped, [3]); // least important is dropped first
});

test("the visitor's own avatar is always sent, even past the budget", () => {
  const me = at(9, 0, 0, 1, { always: true });
  const s = selectForViewer([me, at(1, 0, 5)], viewer({ budget: 10 }));
  assert.ok(s.picks.some((p) => p.id === 9));
});

test("after the first frame only changes go out", () => {
  const world = [at(1, 0, 4), at(2, 0, 8)];
  const v = viewer();
  const versions = new Map([[1, 1], [2, 1]]);
  const first = diff(new Map(), selectForViewer(world, v), versions);
  assert.deepEqual(first.delta.enter.map((e) => e.id), [1, 2]);
  const same = diff(first.next, selectForViewer(world, v), versions);
  assert.deepEqual(same.delta, { enter: [], update: [], leave: [] });
  versions.set(2, 2);
  const moved = diff(same.next, selectForViewer(world, v), versions);
  assert.deepEqual(moved.delta.update.map((e) => e.id), [2]);
  const turned = diff(moved.next, selectForViewer(world, viewer({ forward: { x: 0, y: 0, z: -1 } })), versions);
  assert.deepEqual(turned.delta.leave, [1, 2]);
  const empty: Known = new Map();
  assert.equal(empty.size, 0);
});

test("a huge island splits into zones across the owner's machines, with ghosts at the seams", () => {
  assert.equal(zoneOf({ x: 15, y: 0, z: -1 }, 10), "1,-1");
  const load = new Map([["0,0", 900], ["1,0", 500], ["0,1", 400], ["1,1", 100]]);
  const plan = assignZones(load, [{ id: "rig", capacity: 1000 }, { id: "laptop", capacity: 600 }]);
  assert.equal(plan.get("0,0"), "rig");
  assert.equal(plan.get("1,0"), "laptop");
  assert.equal(plan.size, 4);
  assert.deepEqual(ghostZones({ x: 5, y: 0, z: 5 }, 1, 10, 1), []); // middle of a zone
  assert.deepEqual(ghostZones({ x: 9.5, y: 0, z: 5 }, 1, 10, 1), ["1,0"]); // near the east edge
  assert.equal(ghostZones({ x: 9.5, y: 0, z: 9.5 }, 1, 10, 1).length, 3); // corner touches three neighbours
});
