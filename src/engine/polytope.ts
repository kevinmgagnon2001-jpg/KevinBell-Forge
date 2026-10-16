/**
 * Four-dimensional shapes, after the 4D bubble in Adventure Time ("Bubble creator"): the regular
 * polytopes, turned through 4D and projected down to 3D (and from there to the screen), so their
 * edges slide through each other the way a tesseract's cubes turn inside out.
 *
 *   tesseract  16 vertices,   32 edges  (the hypercube)
 *   24-cell    24 vertices,   96 edges
 *   600-cell  120 vertices,  720 edges  (600 tetrahedra)
 *   120-cell  600 vertices, 1200 edges  (120 dodecahedra; the dual of the 600-cell, built from it)
 *
 * Everything is built from coordinates and checked (every edge the same length), deterministic and
 * pure. `project` turns a shape by angles in the six planes of 4D and casts it into 3D from a point
 * out along w; `w` is kept for colouring by depth.
 */

export type Vec4 = [number, number, number, number];
export type Polytope = { name: string; vertices: Vec4[]; edges: [number, number][] };

const PHI = (1 + Math.sqrt(5)) / 2;

function dist(a: Vec4, b: Vec4): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
}

/** Edges: every pair at the shortest distance there is (within a tolerance). */
function edgesAt(vertices: Vec4[], length?: number): [number, number][] {
  let best = length ?? Infinity;
  if (length == null) for (let i = 1; i < vertices.length; i += 1) best = Math.min(best, dist(vertices[0], vertices[i]));
  const edges: [number, number][] = [];
  for (let i = 0; i < vertices.length; i += 1) for (let j = i + 1; j < vertices.length; j += 1) if (Math.abs(dist(vertices[i], vertices[j]) - best) < 1e-6) edges.push([i, j]);
  return edges;
}

/** Scale so every vertex sits on the unit 3-sphere. */
function unit(vertices: Vec4[]): Vec4[] {
  const r = Math.hypot(...vertices[0]);
  return vertices.map((v) => v.map((x) => x / r) as Vec4);
}

export function tesseract(): Polytope {
  const vertices: Vec4[] = [];
  for (let i = 0; i < 16; i += 1) vertices.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  return { name: "tesseract", vertices: unit(vertices), edges: edgesAt(unit(vertices)) };
}

export function cell24(): Polytope {
  const vertices: Vec4[] = [];
  for (let a = 0; a < 4; a += 1)
    for (let b = a + 1; b < 4; b += 1)
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          const v: Vec4 = [0, 0, 0, 0];
          v[a] = sa;
          v[b] = sb;
          vertices.push(v);
        }
  const u = unit(vertices);
  return { name: "24-cell", vertices: u, edges: edgesAt(u) };
}

/** The 12 even permutations of four positions. */
function evenPermutations(): number[][] {
  const out: number[][] = [];
  const perm = (rest: number[], done: number[]) => {
    if (!rest.length) {
      let inversions = 0;
      for (let i = 0; i < done.length; i += 1) for (let j = i + 1; j < done.length; j += 1) if (done[i] > done[j]) inversions += 1;
      if (inversions % 2 === 0) out.push(done);
      return;
    }
    rest.forEach((x, i) => perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...done, x]));
  };
  perm([0, 1, 2, 3], []);
  return out;
}

export function cell600(): Polytope {
  const vertices: Vec4[] = [];
  // 16: (±½, ±½, ±½, ±½)
  for (let i = 0; i < 16; i += 1) vertices.push([i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5, i & 8 ? 0.5 : -0.5]);
  // 8: (±1, 0, 0, 0) and its permutations
  for (let a = 0; a < 4; a += 1)
    for (const s of [-1, 1]) {
      const v: Vec4 = [0, 0, 0, 0];
      v[a] = s;
      vertices.push(v);
    }
  // 96: ½(±φ, ±1, ±1/φ, 0), even permutations
  const base = [PHI / 2, 0.5, 1 / (2 * PHI), 0];
  for (const p of evenPermutations())
    for (let signs = 0; signs < 8; signs += 1) {
      const v: Vec4 = [0, 0, 0, 0];
      for (let k = 0; k < 3; k += 1) v[p[k]] = base[k] * (signs & (1 << k) ? -1 : 1);
      v[p[3]] = 0;
      vertices.push(v);
    }
  return { name: "600-cell", vertices, edges: edgesAt(vertices, 1 / PHI) };
}

/** The 120-cell: one vertex at the centre of each of the 600-cell's tetrahedra; neighbours share a face. */
export function cell120(): Polytope {
  const src = cell600();
  const n = src.vertices.length;
  const near: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const [a, b] of src.edges) {
    near[a].add(b);
    near[b].add(a);
  }
  const cells: [number, number, number, number][] = [];
  for (let a = 0; a < n; a += 1)
    for (const b of near[a]) {
      if (b <= a) continue;
      for (const c of near[a]) {
        if (c <= b || !near[b].has(c)) continue;
        for (const d of near[a]) if (d > c && near[b].has(d) && near[c].has(d)) cells.push([a, b, c, d]);
      }
    }
  const vertices = unit(
    cells.map((cell) => {
      const v: Vec4 = [0, 0, 0, 0];
      for (const i of cell) for (let k = 0; k < 4; k += 1) v[k] += src.vertices[i][k] / 4;
      return v;
    }),
  );
  // Two tetrahedra that share a triangle are neighbours.
  const byFace = new Map<string, number>();
  const edges: [number, number][] = [];
  cells.forEach((cell, index) => {
    for (let skip = 0; skip < 4; skip += 1) {
      const key = cell.filter((_, k) => k !== skip).join(",");
      const other = byFace.get(key);
      if (other == null) byFace.set(key, index);
      else edges.push([other, index]);
    }
  });
  return { name: "120-cell", vertices, edges };
}

export const SHAPES = { tesseract, "24-cell": cell24, "600-cell": cell600, "120-cell": cell120 } as const;
export type ShapeName = keyof typeof SHAPES;

const cache = new Map<string, Polytope>();
export function shapeOf(name: ShapeName): Polytope {
  let shape = cache.get(name);
  if (!shape) {
    shape = SHAPES[name]();
    cache.set(name, shape);
  }
  return shape;
}

/** Angles (radians) in the six planes: xy, xz, xw, yz, yw, zw. */
export type Turn4 = [number, number, number, number, number, number];

/** A slow double rotation for time t (seconds): the inside-out turn through w, with a little drift. */
export function turnAt(t: number, speed = 1): Turn4 {
  const s = t * speed;
  return [s * 0.07, s * 0.05, s * 0.31, s * 0.11, s * 0.23, s * 0.17];
}

/**
 * Turn every vertex and cast it into 3D from a point at distance `eye` out along w (perspective: the
 * near side grows, the far side shrinks, so the inner cells show). Writes x, y, z per vertex into
 * `out` and w (after turning, -1..1) into `depth`.
 */
export function project(shape: Polytope, turn: Turn4, out: Float32Array, depth: Float32Array, eye = 2.6, stretch: Vec4 = [1, 1, 1, 1]): void {
  const c = turn.map(Math.cos);
  const s = turn.map(Math.sin);
  const planes: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  const v: Vec4 = [0, 0, 0, 0];
  shape.vertices.forEach((p, i) => {
    v[0] = p[0] * stretch[0];
    v[1] = p[1] * stretch[1];
    v[2] = p[2] * stretch[2];
    v[3] = p[3] * stretch[3];
    for (let k = 0; k < 6; k += 1) {
      if (!s[k]) continue;
      const [a, b] = planes[k];
      const x = v[a];
      const y = v[b];
      v[a] = x * c[k] - y * s[k];
      v[b] = x * s[k] + y * c[k];
    }
    const scale = eye / (eye - v[3]);
    out[i * 3] = v[0] * scale;
    out[i * 3 + 1] = v[1] * scale;
    out[i * 3 + 2] = v[2] * scale;
    depth[i] = v[3];
  });
}

/** The 4D bubble's palette, by depth in w: deep red, through violet, to green. */
export function hyperColor(w: number, t = 0): [number, number, number] {
  // Most of a big polytope sits near w = 0; a steep curve spreads it over all three colours.
  const raw = Math.max(0, Math.min(1, (w + 1) / 2 + Math.sin(t * 0.4) * 0.12));
  const k = raw < 0.5 ? 0.5 * Math.pow(raw * 2, 0.45) : 1 - 0.5 * Math.pow((1 - raw) * 2, 0.45);
  const stops: [number, number, number][] = [
    [1.0, 0.16, 0.32],
    [0.72, 0.28, 1.0],
    [0.2, 1.0, 0.55],
  ];
  const f = k * 2;
  const i = Math.min(1, Math.floor(f));
  const u = f - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
