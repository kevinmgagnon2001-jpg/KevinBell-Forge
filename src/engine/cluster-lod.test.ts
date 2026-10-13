import assert from "node:assert/strict";
import test from "node:test";
import { buildClusterDag, projectError, selectCut } from "./cluster-lod.ts";

test("the cluster cut gets coarser as the camera backs away", () => {
  const dag = buildClusterDag();
  const root = dag.nodes[dag.root];
  assert.ok(root.children.length > 0);
  assert.ok(root.error > 0);
  assert.equal(dag.nodes.find((node) => node.depth === 0)?.error, 0);
  assert.equal(root.triangles.length / 9 < 20, true);
  const counts = [0.6, 2, 8, 40].map((z) => selectCut(dag, { x: 0, y: 0, z }, 50, 800, 1).triangles);
  for (let i = 1; i < counts.length; i += 1) {
    assert.ok(counts[i] <= counts[i - 1], `counts ${counts.join(",")}`);
  }
  assert.ok(counts[0] > counts[counts.length - 1], `counts ${counts.join(",")}`);
  assert.ok(counts[counts.length - 1] < dag.leafTriangles);
  assert.equal(dag.leafTriangles, 320);
  const close = projectError(root.error, 0.6, root.radius, 50, 800);
  const away = projectError(root.error, 40, root.radius, 50, 800);
  assert.ok(close > away);
});
