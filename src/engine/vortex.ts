/**
 * Smoke rings (Papers roadmap: smoke rings and vortices): vortex filaments, the way fluid people
 * model them. A ring is a loop of short vortex segments; each moves with the velocity all the
 * segments induce on it (Biot–Savart, with a smoothed core so nothing blows up), so a ring glides
 * forward on its own, and two rings one behind the other leapfrog: the back one shrinks, speeds
 * through the front one, which widens and slows, and they swap. Smoke is tracer particles carried
 * by the same velocity field.
 */

export type V = { x: number; y: number; z: number };

export type Ring = {
  /** Loop of filament nodes (closed: the last joins the first). */
  nodes: V[];
  /** Circulation (strength), m²/s. */
  gamma: number;
  /** Core radius, m. */
  core: number;
};

/** A ring of `n` nodes, centred at `c`, radius `r`, travelling along unit `axis`. */
export function makeRing(c: V, axis: V, r: number, gamma = 0.9, n = 28, core = 0.06): Ring {
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const a = { x: axis.x / len, y: axis.y / len, z: axis.z / len };
  // Two directions across the axis.
  const helper = Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = norm(cross(a, helper));
  const v = cross(a, u);
  const nodes: V[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    // Order round the axis so the ring moves along +axis (right-hand rule).
    nodes.push({ x: c.x + (u.x * Math.cos(t) + v.x * Math.sin(t)) * r, y: c.y + (u.y * Math.cos(t) + v.y * Math.sin(t)) * r, z: c.z + (u.z * Math.cos(t) + v.z * Math.sin(t)) * r });
  }
  return { nodes, gamma, core };
}

const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V): V => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Velocity induced at `p` by all rings (smoothed Biot–Savart over straight segments). */
export function velocityAt(p: V, rings: Ring[]): V {
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (const ring of rings) {
    const n = ring.nodes.length;
    const k = ring.gamma / (4 * Math.PI);
    const c2 = ring.core * ring.core;
    for (let i = 0; i < n; i += 1) {
      const a = ring.nodes[i];
      const b = ring.nodes[(i + 1) % n];
      // Segment midpoint approximation: dl × r / (|r|² + core²)^(3/2).
      const dlx = b.x - a.x;
      const dly = b.y - a.y;
      const dlz = b.z - a.z;
      const rx = p.x - (a.x + b.x) / 2;
      const ry = p.y - (a.y + b.y) / 2;
      const rz = p.z - (a.z + b.z) / 2;
      const r2 = rx * rx + ry * ry + rz * rz + c2;
      const f = k / (r2 * Math.sqrt(r2));
      vx += (dly * rz - dlz * ry) * f;
      vy += (dlz * rx - dlx * rz) * f;
      vz += (dlx * ry - dly * rx) * f;
    }
  }
  return { x: vx, y: vy, z: vz };
}

/** Move every ring with the velocity at its own nodes (midpoint rule), and slowly lose strength. */
export function stepRings(rings: Ring[], dt: number, decay = 0.04): void {
  const h = Math.min(0.05, Math.max(0, dt));
  const mids = rings.map((ring) =>
    ring.nodes.map((p) => {
      const v = velocityAt(p, rings);
      return { x: p.x + v.x * h * 0.5, y: p.y + v.y * h * 0.5, z: p.z + v.z * h * 0.5 };
    }),
  );
  const half = rings.map((ring, i) => ({ ...ring, nodes: mids[i] }));
  rings.forEach((ring, ri) => {
    ring.nodes = ring.nodes.map((p, i) => {
      // The midpoint rule: the field of the half-stepped rings, at the half-stepped node.
      const v = velocityAt(mids[ri][i], half);
      return { x: p.x + v.x * h, y: p.y + v.y * h, z: p.z + v.z * h };
    });
    ring.gamma *= Math.exp(-decay * h);
  });
}

/** A ring's centre and mean radius. */
export function ringShape(ring: Ring): { c: V; r: number } {
  const n = ring.nodes.length;
  const c = ring.nodes.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n, z: s.z + p.z / n }), { x: 0, y: 0, z: 0 });
  const r = ring.nodes.reduce((s, p) => s + Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z), 0) / n;
  return { c, r };
}

/** Smoke tracers wrapped round a ring's core (a torus of points), to be carried by the field. */
export function tracersFor(ring: Ring, count: number, seed = 1): V[] {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const n = ring.nodes.length;
  const out: V[] = [];
  for (let k = 0; k < count; k += 1) {
    const i = Math.floor(rand() * n);
    const a = ring.nodes[i];
    const b = ring.nodes[(i + 1) % n];
    const t = norm({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    const { c } = ringShape(ring);
    const out1 = norm({ x: a.x - c.x, y: a.y - c.y, z: a.z - c.z });
    const up = cross(t, out1);
    const ang = rand() * Math.PI * 2;
    const rad = ring.core * (0.4 + rand() * 1.4);
    out.push({ x: a.x + (out1.x * Math.cos(ang) + up.x * Math.sin(ang)) * rad, y: a.y + (out1.y * Math.cos(ang) + up.y * Math.sin(ang)) * rad, z: a.z + (out1.z * Math.cos(ang) + up.z * Math.sin(ang)) * rad });
  }
  return out;
}

/** Plain requests: "blow a smoke ring", "blow two smoke rings", "smoke rings". */
export function smokeRingIntent(intent: string): { count: number } | null {
  const t = intent.trim().toLowerCase();
  if (!/\bsmoke rings?\b|\bvortex rings?\b/.test(t)) return null;
  const words: Record<string, number> = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5 };
  const m = t.match(/\b(\d+|one|two|three|four|five)\b/);
  const count = m ? Number(m[1]) || words[m[1]] || 1 : /\brings\b/.test(t) ? 2 : 1;
  return { count: Math.max(1, Math.min(5, count)) };
}
