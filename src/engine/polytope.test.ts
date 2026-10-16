import { test } from "node:test";
import assert from "node:assert/strict";
import { cell120, cell24, cell600, hyperColor, project, shapeOf, tesseract, turnAt, type Polytope } from "./polytope.ts";

function check(shape: Polytope, vertices: number, edges: number, degree: number) {
  assert.equal(shape.vertices.length, vertices, `${shape.name} vertices`);
  assert.equal(shape.edges.length, edges, `${shape.name} edges`);
  const d = (i: number, j: number) => Math.hypot(...shape.vertices[i].map((x, k) => x - shape.vertices[j][k]));
  const len = d(...shape.edges[0]);
  for (const [a, b] of shape.edges) assert.ok(Math.abs(d(a, b) - len) < 1e-6, `${shape.name}: every edge the same length`);
  const count = new Array(vertices).fill(0);
  for (const [a, b] of shape.edges) {
    count[a] += 1;
    count[b] += 1;
  }
  assert.ok(count.every((c) => c === degree), `${shape.name}: ${degree} edges at every vertex`);
  for (const v of shape.vertices) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9, "on the unit 3-sphere");
}

test("the regular polytopes are what they should be", () => {
  check(tesseract(), 16, 32, 4);
  check(cell24(), 24, 96, 8);
  check(cell600(), 120, 720, 12);
  check(cell120(), 600, 1200, 4);
  assert.equal(shapeOf("120-cell"), shapeOf("120-cell"), "built once");
});

test("turning through 4D and casting to 3D", () => {
  const shape = tesseract();
  const out = new Float32Array(shape.vertices.length * 3);
  const depth = new Float32Array(shape.vertices.length);
  project(shape, [0, 0, 0, 0, 0, 0], out, depth);
  // Unturned, the near cube (w > 0) is bigger than the far one.
  const near = shape.vertices.findIndex((v) => v[3] > 0);
  const far = shape.vertices.findIndex((v) => v[3] < 0 && v[0] === shape.vertices[near][0] && v[1] === shape.vertices[near][1] && v[2] === shape.vertices[near][2]);
  assert.ok(Math.abs(out[near * 3]) > Math.abs(out[far * 3]));
  // A turn in xw swaps x and w over a quarter turn.
  project(shape, [0, 0, Math.PI / 2, 0, 0, 0], out, depth, 1e9);
  const v = shape.vertices[0];
  assert.ok(Math.abs(depth[0] - v[0]) < 1e-6 && Math.abs(out[0] + v[3]) < 1e-6);
  const t = turnAt(10);
  assert.equal(t.length, 6);
  for (const w of [-1, 0, 1]) assert.ok(hyperColor(w).every((c) => c >= 0 && c <= 1));
  assert.ok(hyperColor(-1)[0] > 0.9 && hyperColor(1)[1] > 0.9, "red near, green far");
});
