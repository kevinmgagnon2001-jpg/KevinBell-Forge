/**
 * Cluster LOD cut. Brian Karis, "Nanite: A Deep Dive", SIGGRAPH 2021.
 * Screen-space error matches zeux/meshoptimizer demo/nanite.cpp:
 *   pixels = height * worldError / (dist * 2 * tan(fovY/2))
 * The mesh is an indexed-triangle icosphere, the shape Blender writes to glTF.
 * Each parent is the real coarser face, so a uniform cut stays closed.
 * This is not Epic's Nanite, not Vulkan, and not nanite-webgpu.
 *
 * Spherical subdivision's true sagitta on a unit mesh is ~0.15, which stays
 * under a pixel only from outside the lab. Parents carry a smaller monotonic
 * slack so the same test changes the cut while you walk up to the gem.
 */

export type Vec = { x: number; y: number; z: number };

export type ClusterNode = {
  id: number;
  children: number[];
  center: Vec;
  radius: number;
  /** World-space simplification error. Leaves are 0. Parents are strictly larger. */
  error: number;
  depth: number;
  triangles: Float32Array;
};

export type ClusterDag = {
  nodes: ClusterNode[];
  root: number;
  leafTriangles: number;
};

function v(x: number, y: number, z: number): Vec {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

function mid(a: Vec, b: Vec): Vec {
  return v(a.x + b.x, a.y + b.y, a.z + b.z);
}

type Tri = [Vec, Vec, Vec];

function icosahedron(): Tri[] {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    v(-1, t, 0), v(1, t, 0), v(-1, -t, 0), v(1, -t, 0),
    v(0, -1, t), v(0, 1, t), v(0, -1, -t), v(0, 1, -t),
    v(t, 0, -1), v(t, 0, 1), v(-t, 0, -1), v(-t, 0, 1),
  ];
  const faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return faces.map(([a, b, c]) => [verts[a], verts[b], verts[c]]);
}

function octahedron(): Tri[] {
  const p = [v(1, 0, 0), v(-1, 0, 0), v(0, 1, 0), v(0, -1, 0), v(0, 0, 1), v(0, 0, -1)];
  const faces: Array<[number, number, number]> = [
    [0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0],
    [0, 4, 3], [4, 1, 3], [1, 5, 3], [5, 0, 3],
  ];
  return faces.map(([a, b, c]) => [p[a], p[b], p[c]]);
}

/** Four children per face, in parent order, so a group of four tiles that face. */
function subdivide(tris: Tri[]): Tri[] {
  const cache = new Map<string, Vec>();
  const point = (a: Vec, b: Vec) => {
    const ka = `${a.x.toFixed(5)},${a.y.toFixed(5)},${a.z.toFixed(5)}`;
    const kb = `${b.x.toFixed(5)},${b.y.toFixed(5)},${b.z.toFixed(5)}`;
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const next = mid(a, b);
    cache.set(key, next);
    return next;
  };
  const out: Tri[] = [];
  for (const [a, b, c] of tris) {
    const ab = point(a, b);
    const bc = point(b, c);
    const ca = point(c, a);
    out.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return out;
}

function triArray(tri: Tri): Float32Array {
  const [a, b, c] = tri;
  return Float32Array.of(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

function bounds(tris: Float32Array[]): { center: Vec; radius: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const tri of tris) {
    for (let i = 0; i < 9; i += 3) {
      x += tri[i];
      y += tri[i + 1];
      z += tri[i + 2];
      n += 1;
    }
  }
  const center = { x: x / n, y: y / n, z: z / n };
  let radius = 0;
  for (const tri of tris) {
    for (let i = 0; i < 9; i += 3) {
      radius = Math.max(radius, Math.hypot(tri[i] - center.x, tri[i + 1] - center.y, tri[i + 2] - center.z));
    }
  }
  return { center, radius };
}

function pack(tris: Float32Array[]): Float32Array {
  const out = new Float32Array(tris.length * 9);
  tris.forEach((tri, index) => out.set(tri, index * 9));
  return out;
}

function nodeFrom(id: number, tris: Float32Array[], children: number[], error: number, depth: number): ClusterNode {
  const box = bounds(tris);
  return { id, children, center: box.center, radius: box.radius, error, depth, triangles: pack(tris) };
}

/**
 * One root. Leaves are the subdiv-2 icosphere (320 tris) in clusters of 4.
 * The next cut is those parent faces (80), then the icosahedron (20), then an octahedron.
 */
export function buildClusterDag(): ClusterDag {
  const coarse = icosahedron();
  const mid = subdivide(coarse);
  const fine = subdivide(mid);
  const nodes: ClusterNode[] = [];
  for (let i = 0; i < mid.length; i += 1) {
    nodes.push(nodeFrom(i, fine.slice(i * 4, i * 4 + 4).map(triArray), [], 0, 0));
  }
  const midStart = nodes.length;
  for (let i = 0; i < mid.length; i += 1) {
    nodes.push(nodeFrom(nodes.length, [triArray(mid[i])], [i], 0.0022, 1));
  }
  const coarseStart = nodes.length;
  for (let i = 0; i < coarse.length; i += 1) {
    const children = [0, 1, 2, 3].map((k) => midStart + i * 4 + k);
    nodes.push(nodeFrom(nodes.length, [triArray(coarse[i])], children, 0.0055, 2));
  }
  const root = nodes.length;
  nodes.push(
    nodeFrom(
      root,
      octahedron().map(triArray),
      coarse.map((_, i) => coarseStart + i),
      0.02,
      3,
    ),
  );
  return { nodes, root, leafTriangles: fine.length };
}

/** pixels of geometric error. meshoptimizer's perspective projection, height in pixels. */
export function projectError(worldError: number, distance: number, radius: number, fovY: number, screenHeight: number): number {
  const dist = Math.max(distance - radius, 0.05);
  const tan = Math.tan((fovY * Math.PI) / 360);
  return (screenHeight * worldError) / (dist * 2 * tan);
}

export type ClusterCut = {
  key: string;
  triangles: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
};

const DEPTH_COLOR: Array<[number, number, number]> = [
  [0.49, 0.88, 0.78],
  [0.42, 0.68, 0.9],
  [0.83, 0.64, 0.29],
  [0.88, 0.45, 0.32],
];

function faceNormal(tri: Float32Array, offset: number): [number, number, number] {
  const ax = tri[offset + 3] - tri[offset];
  const ay = tri[offset + 4] - tri[offset + 1];
  const az = tri[offset + 5] - tri[offset + 2];
  const bx = tri[offset + 6] - tri[offset];
  const by = tri[offset + 7] - tri[offset + 1];
  const bz = tri[offset + 8] - tri[offset + 2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function selectCut(dag: ClusterDag, camera: Vec, fovY: number, screenHeight: number, thresholdPx = 1): ClusterCut {
  const chosen: number[] = [];
  const visit = (id: number) => {
    const node = dag.nodes[id];
    const distance = Math.hypot(camera.x - node.center.x, camera.y - node.center.y, camera.z - node.center.z);
    const pixels = projectError(node.error, distance, node.radius, fovY, screenHeight);
    if (!node.children.length || pixels <= thresholdPx) {
      chosen.push(id);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(dag.root);
  let triangles = 0;
  for (const id of chosen) triangles += dag.nodes[id].triangles.length / 9;
  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  const colors = new Float32Array(triangles * 9);
  let cursor = 0;
  for (const id of chosen) {
    const node = dag.nodes[id];
    const tint = DEPTH_COLOR[Math.min(DEPTH_COLOR.length - 1, node.depth)];
    positions.set(node.triangles, cursor);
    for (let i = 0; i < node.triangles.length; i += 9) {
      const [nx, ny, nz] = faceNormal(node.triangles, i);
      for (let k = 0; k < 3; k += 1) {
        normals[cursor + i + k * 3] = nx;
        normals[cursor + i + k * 3 + 1] = ny;
        normals[cursor + i + k * 3 + 2] = nz;
        colors[cursor + i + k * 3] = tint[0];
        colors[cursor + i + k * 3 + 1] = tint[1];
        colors[cursor + i + k * 3 + 2] = tint[2];
      }
    }
    cursor += node.triangles.length;
  }
  return { key: chosen.join("."), triangles, positions, normals, colors };
}

let cached: ClusterDag | null = null;

export function clusterDag(): ClusterDag {
  cached ??= buildClusterDag();
  return cached;
}
