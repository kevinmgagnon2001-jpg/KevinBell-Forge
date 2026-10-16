/**
 * Rigid bodies that tumble: oriented boxes with real rotation, for dominoes, Jenga towers and
 * stacks of crates (Papers roadmap: the new solver core, here as a sequential-impulse solver with
 * warm starting, the well-tried cousin of AVBD; the block-descent version can replace solveContacts
 * later without changing anything around it).
 *
 *   contacts      sample points on each box (corners and edge middles) that sit inside another box,
 *                 a static solid or under the ground, each with a normal and a depth.
 *   stepRigid     gravity, then contact impulses (non-penetration, friction, a little bounce)
 *                 iterated with last step's impulses as the start, then integrate; bodies that
 *                 stay still fall asleep and wake when something knocks them.
 *
 * Plain numbers; Viewport.tsx keeps a RigidWorld in step with the entities tagged "rigid".
 */
import type { Entity, Quat, Vec3, World } from "./types.ts";
import type { Solid } from "./physics.ts";

export const RIGID_TAG = "rigid";

type V = Vec3;

export type RBody = {
  id: number;
  p: V;
  q: Quat;
  v: V;
  w: V;
  /** Half extents. */
  h: V;
  invM: number;
  /** Inverse inertia in the body's own axes (a box's is diagonal). */
  invI: V;
  mu: number;
  bounce: number;
  /** Seconds it has been nearly still, and whether it sleeps. */
  still: number;
  asleep: boolean;
};

export type RigidWorld = {
  bodies: RBody[];
  /** Last step's impulses at each contact, to start the next from (warm starting). */
  cache: Map<string, { n: number; t1: number; t2: number }>;
};

export const newRigidWorld = (): RigidWorld => ({ bodies: [], cache: new Map() });

// ---------- small vector and quaternion helpers ----------

const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = (a: V) => Math.hypot(a.x, a.y, a.z);

/** Rotate v by q. */
export function rotate(q: Quat, v: V): V {
  const t = mul(cross(q, v), 2);
  return add(add(v, mul(t, q.w)), cross(q, t));
}
const unrotate = (q: Quat, v: V): V => rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);

function normalizeQ(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** World inverse inertia times a vector: R · I⁻¹ · Rᵀ · v. */
function invIWorld(b: RBody, v: V): V {
  if (b.invM === 0 || b.asleep) return { x: 0, y: 0, z: 0 };
  const l = unrotate(b.q, v);
  return rotate(b.q, { x: l.x * b.invI.x, y: l.y * b.invI.y, z: l.z * b.invI.z });
}

/** A box body of mass `mass` (0 for fixed) and half extents `h`. */
export function makeBody(id: number, p: V, q: Quat, h: V, mass: number, mu = 0.6, bounce = 0.05): RBody {
  const m = Math.max(0, mass);
  const ix = (m / 3) * (h.y * h.y + h.z * h.z);
  const iy = (m / 3) * (h.x * h.x + h.z * h.z);
  const iz = (m / 3) * (h.x * h.x + h.y * h.y);
  return {
    id,
    p: { ...p },
    q: normalizeQ(q),
    v: { x: 0, y: 0, z: 0 },
    w: { x: 0, y: 0, z: 0 },
    h: { ...h },
    invM: m > 0 ? 1 / m : 0,
    invI: { x: ix > 0 ? 1 / ix : 0, y: iy > 0 ? 1 / iy : 0, z: iz > 0 ? 1 / iz : 0 },
    mu,
    bounce,
    still: 0,
    asleep: false,
  };
}

/** Corners and edge middles of a box, in its own axes (20 points). */
const SAMPLES: V[] = (() => {
  const out: V[] = [];
  for (const x of [-1, 0, 1])
    for (const y of [-1, 0, 1])
      for (const z of [-1, 0, 1]) {
        const zeros = (x === 0 ? 1 : 0) + (y === 0 ? 1 : 0) + (z === 0 ? 1 : 0);
        if (zeros <= 1) out.push({ x, y, z });
      }
  return out;
})();

export type Contact = {
  a: RBody;
  /** The other body, or null for a static solid or the ground. */
  b: RBody | null;
  /** Point of contact (world). */
  at: V;
  /** Normal pointing out of the other thing into `a`. */
  n: V;
  depth: number;
  key: string;
};

type Boxlike = { p: V; q: Quat; h: V };

/** If world point `c` is inside `box` (grown by `margin`), the way out: normal (world) and depth. */
function inside(c: V, box: Boxlike, margin: number): { n: V; depth: number } | null {
  const d = unrotate(box.q, sub(c, box.p));
  const px = box.h.x + margin - Math.abs(d.x);
  const py = box.h.y + margin - Math.abs(d.y);
  const pz = box.h.z + margin - Math.abs(d.z);
  if (px <= 0 || py <= 0 || pz <= 0) return null;
  let axis: V;
  let depth: number;
  if (px <= py && px <= pz) {
    axis = { x: Math.sign(d.x) || 1, y: 0, z: 0 };
    depth = px;
  } else if (py <= pz) {
    axis = { x: 0, y: Math.sign(d.y) || 1, z: 0 };
    depth = py;
  } else {
    axis = { x: 0, y: 0, z: Math.sign(d.z) || 1 };
    depth = pz;
  }
  return { n: rotate(box.q, axis), depth: depth - margin };
}

const IDQ: Quat = { x: 0, y: 0, z: 0, w: 1 };
const radius = (b: { h: V }) => len(b.h);

/** All contacts this step. */
export function contacts(world: RigidWorld, statics: Solid[], ground: (x: number, z: number) => number): Contact[] {
  const out: Contact[] = [];
  const margin = 0.004;
  const bodies = world.bodies;
  // Sample points sit a hair inside the box's edges, so two boxes stacked edge to edge meet face
  // to face instead of catching each other's sides.
  const pointsOf = (b: RBody) => SAMPLES.map((s) => add(b.p, rotate(b.q, { x: s.x * b.h.x * (s.y ? 0.97 : 1), y: s.y * b.h.y, z: s.z * b.h.z * (s.y ? 0.97 : 1) })));
  const pts = bodies.map(pointsOf);
  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];
    // The ground.
    pts[i].forEach((c, k) => {
      const g = ground(c.x, c.z);
      if (c.y < g + margin && !a.asleep) out.push({ a, b: null, at: c, n: { x: 0, y: 1, z: 0 }, depth: g - c.y, key: `${a.id}:g:${k}` });
    });
    // Static solids (boxes that do not move).
    const ra = radius(a);
    for (const s of statics) {
      if (s.id === a.id || a.asleep) continue;
      const h = { x: (s.max.x - s.min.x) / 2, y: (s.max.y - s.min.y) / 2, z: (s.max.z - s.min.z) / 2 };
      const p = { x: (s.max.x + s.min.x) / 2, y: (s.max.y + s.min.y) / 2, z: (s.max.z + s.min.z) / 2 };
      if (len(sub(a.p, p)) > ra + len(h)) continue;
      const box = { p, q: IDQ, h };
      pts[i].forEach((c, k) => {
        const hit = inside(c, box, margin);
        if (hit) out.push({ a, b: null, at: c, n: hit.n, depth: hit.depth, key: `${a.id}:s${s.id}:${k}` });
      });
      // The static box's corners inside this body (a ledge's edge under a tipping domino).
      for (const s2 of SAMPLES) {
        const c = add(p, { x: s2.x * h.x, y: s2.y * h.y, z: s2.z * h.z });
        const hit = inside(c, a, margin);
        if (hit) out.push({ a, b: null, at: c, n: mul(hit.n, -1), depth: hit.depth, key: `${a.id}:S${s.id}:${s2.x},${s2.y},${s2.z}` });
      }
    }
    // Other bodies: this body's points inside them.
    for (let j = 0; j < bodies.length; j += 1) {
      if (i === j) continue;
      const b = bodies[j];
      if (a.asleep && b.asleep) continue;
      if (len(sub(a.p, b.p)) > ra + radius(b)) continue;
      pts[i].forEach((c, k) => {
        const hit = inside(c, b, margin);
        if (hit) out.push({ a, b, at: c, n: hit.n, depth: hit.depth, key: `${a.id}:${b.id}:${k}` });
      });
    }
  }
  return out;
}

const velAt = (b: RBody | null, r: V): V => (b && !b.asleep ? add(b.v, cross(b.w, r)) : { x: 0, y: 0, z: 0 });

function applyImpulse(b: RBody | null, r: V, j: V) {
  if (!b || b.invM === 0 || b.asleep) return;
  b.v = add(b.v, mul(j, b.invM));
  b.w = add(b.w, invIWorld(b, cross(r, j)));
}

function massAlong(a: RBody, b: RBody | null, ra: V, rb: V, n: V): number {
  let k = a.asleep ? 0 : a.invM + dot(n, cross(invIWorld(a, cross(ra, n)), ra));
  if (b && !b.asleep) k += b.invM + dot(n, cross(invIWorld(b, cross(rb, n)), rb));
  return k;
}

/** Contact impulses: no sinking in, friction, a little bounce; started from last step's. */
export function solveContacts(world: RigidWorld, cs: Contact[], dt: number, iterations = 10): void {
  const slop = 0.004;
  const beta = 0.25;
  const prepared = cs.map((c) => {
    const ra = sub(c.at, c.a.p);
    const rb = c.b ? sub(c.at, c.b.p) : { x: 0, y: 0, z: 0 };
    const helper = Math.abs(c.n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const t1 = cross(c.n, helper);
    const l1 = len(t1) || 1;
    const t1n = mul(t1, 1 / l1);
    const t2 = cross(c.n, t1n);
    const kn = massAlong(c.a, c.b, ra, rb, c.n);
    const k1 = massAlong(c.a, c.b, ra, rb, t1n);
    const k2 = massAlong(c.a, c.b, ra, rb, t2);
    const vn0 = dot(sub(velAt(c.a, ra), velAt(c.b, rb)), c.n);
    const bounce = vn0 < -1 ? -vn0 * Math.max(c.a.bounce, c.b?.bounce ?? 0) : 0;
    const bias = Math.max(bounce, (beta / dt) * Math.max(0, c.depth - slop));
    const warm = world.cache.get(c.key) ?? { n: 0, t1: 0, t2: 0 };
    const mu = Math.sqrt(c.a.mu * (c.b?.mu ?? 0.7));
    const s = { c, ra, rb, t1: t1n, t2, kn, k1, k2, bias, mu, pn: warm.n * 0.9, pt1: warm.t1 * 0.9, pt2: warm.t2 * 0.9 };
    // Warm start.
    const j = add(add(mul(c.n, s.pn), mul(t1n, s.pt1)), mul(t2, s.pt2));
    applyImpulse(c.a, ra, j);
    applyImpulse(c.b, rb, mul(j, -1));
    return s;
  });
  for (let it = 0; it < iterations; it += 1) {
    for (const s of prepared) {
      const { c } = s;
      if (s.kn <= 0) continue;
      const dv = sub(velAt(c.a, s.ra), velAt(c.b, s.rb));
      // Friction first (bounded by the normal impulse so far), then the push apart.
      for (const [t, k, which] of [[s.t1, s.k1, "pt1"], [s.t2, s.k2, "pt2"]] as const) {
        if (k <= 0) continue;
        const vt = dot(dv, t);
        const limit = s.mu * s.pn;
        const old = s[which];
        const next = Math.max(-limit, Math.min(limit, old - vt / k));
        const d = next - old;
        s[which] = next;
        applyImpulse(c.a, s.ra, mul(t, d));
        applyImpulse(c.b, s.rb, mul(t, -d));
      }
      const vn = dot(sub(velAt(c.a, s.ra), velAt(c.b, s.rb)), c.n);
      const old = s.pn;
      const next = Math.max(0, old + (s.bias - vn) / s.kn);
      const d = next - old;
      s.pn = next;
      applyImpulse(c.a, s.ra, mul(c.n, d));
      applyImpulse(c.b, s.rb, mul(c.n, -d));
    }
  }
  world.cache = new Map(prepared.map((s) => [s.c.key, { n: s.pn, t1: s.pt1, t2: s.pt2 }]));
}

/** Push a body (wakes it). */
export function push(b: RBody, impulse: V, at?: V) {
  b.asleep = false;
  b.still = 0;
  const r = at ? sub(at, b.p) : { x: 0, y: 0, z: 0 };
  b.v = add(b.v, mul(impulse, b.invM));
  b.w = add(b.w, invIWorld(b, cross(r, impulse)));
}

/**
 * One frame, in substeps of at most 1/120 s. `gravity` is m/s² (negative, down). Returns the ids
 * of bodies that moved.
 */
export function stepRigid(world: RigidWorld, frame: number, gravity: number, statics: Solid[], ground: (x: number, z: number) => number): Set<number> {
  const moved = new Set<number>();
  const steps = Math.max(1, Math.ceil(Math.min(0.1, frame) / (1 / 120)));
  const dt = Math.min(0.1, frame) / steps;
  for (let s = 0; s < steps; s += 1) {
    for (const b of world.bodies) {
      if (b.invM === 0 || b.asleep) continue;
      b.v = { x: b.v.x, y: b.v.y + gravity * dt, z: b.v.z };
    }
    const cs = contacts(world, statics, ground);
    // Something awake and moving touching a sleeper wakes it.
    for (const c of cs) {
      if (c.b && c.b.asleep && !c.a.asleep && len(c.a.v) + len(c.a.w) * 0.3 > 0.25) {
        c.b.asleep = false;
        c.b.still = 0;
      }
      if (c.b && c.a.asleep && !c.b.asleep && len(c.b.v) + len(c.b.w) * 0.3 > 0.25) {
        c.a.asleep = false;
        c.a.still = 0;
      }
    }
    solveContacts(world, cs, dt);
    for (const b of world.bodies) {
      if (b.invM === 0 || b.asleep) continue;
      b.v = mul(b.v, 0.9995);
      b.w = mul(b.w, 0.998);
      b.p = add(b.p, mul(b.v, dt));
      const wq = { x: b.w.x, y: b.w.y, z: b.w.z, w: 0 };
      const q = b.q;
      // q' = q + ½ ω q dt
      const dq = {
        x: 0.5 * dt * (wq.w * q.x + wq.x * q.w + wq.y * q.z - wq.z * q.y),
        y: 0.5 * dt * (wq.w * q.y - wq.x * q.z + wq.y * q.w + wq.z * q.x),
        z: 0.5 * dt * (wq.w * q.z + wq.x * q.y - wq.y * q.x + wq.z * q.w),
        w: 0.5 * dt * (wq.w * q.w - wq.x * q.x - wq.y * q.y - wq.z * q.z),
      };
      b.q = normalizeQ({ x: q.x + dq.x, y: q.y + dq.y, z: q.z + dq.z, w: q.w + dq.w });
      moved.add(b.id);
      // Sleep when still for a while.
      if (len(b.v) < 0.04 && len(b.w) < 0.06) b.still += dt;
      else b.still = 0;
      if (b.still > 0.6) {
        b.asleep = true;
        b.v = { x: 0, y: 0, z: 0 };
        b.w = { x: 0, y: 0, z: 0 };
      }
    }
  }
  return moved;
}

/** The box (axis-aligned) a turned body fills, for the walker and the rest of the world. */
export function boundsOf(b: RBody): { min: V; max: V } {
  let ex = 0;
  let ey = 0;
  let ez = 0;
  for (const axis of [{ x: b.h.x, y: 0, z: 0 }, { x: 0, y: b.h.y, z: 0 }, { x: 0, y: 0, z: b.h.z }]) {
    const r = rotate(b.q, axis);
    ex += Math.abs(r.x);
    ey += Math.abs(r.y);
    ez += Math.abs(r.z);
  }
  return { min: { x: b.p.x - ex, y: b.p.y - ey, z: b.p.z - ez }, max: { x: b.p.x + ex, y: b.p.y + ey, z: b.p.z + ez } };
}

// ---------- toys: dominoes, a Jenga tower, a pile of crates ----------


const avatarOf = (world: World) => Object.values(world.entities).find((e) => e.tags.includes("architect"));
const TONES = ["#ff4d6d", "#ff7ab6", "#b77bff", "#7a6bff", "#4de2c5", "#9cff6b", "#ffd36b"];

function rigidEntity(id: number, name: string, p: V, yaw: number, size: V, mass: number, color: string, group: string): Entity {
  return {
    id,
    name,
    transform: { position: { ...p }, rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, scale: { ...size } },
    representation: { kind: "mesh", assetId: "cube" },
    physics: { mass, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, isKinematic: false, solver: "rigid" },
    tags: ["spawned", RIGID_TAG, group],
    customData: { color },
  };
}

/** The floor height in front of you (the lab deck is a little raised). */
function floorAt(world: World, x: number, z: number, ground: (x: number, z: number) => number): number {
  let top = ground(x, z);
  for (const e of Object.values(world.entities)) {
    if (!e.tags.includes("floor")) continue;
    const p = e.transform.position;
    const s = e.transform.scale;
    if (Math.abs(x - p.x) <= Math.abs(s.x) / 2 && Math.abs(z - p.z) <= Math.abs(s.z) / 2) top = Math.max(top, p.y + Math.abs(s.y) / 2);
  }
  return top;
}

/** build_dominoes: a line (or a curve, `bend` radians over the run) of `count` dominoes ahead of you. */
export function buildDominoes(world: World, args: Record<string, string>, ground: (x: number, z: number) => number): { ok: boolean; detail: string; world: World } {
  const me = avatarOf(world);
  const count = Math.max(3, Math.min(60, Number(args.count) || 24));
  const bend = Math.max(-Math.PI * 1.5, Math.min(Math.PI * 1.5, Number(args.bend) || 0));
  let yaw = Number(me?.customData.yaw) || 0;
  const start = me?.transform.position ?? { x: 0, y: 0, z: 0 };
  let x = start.x + Math.sin(yaw) * 1.2;
  let z = start.z + Math.cos(yaw) * 1.2;
  const size = { x: 0.3, y: 0.5, z: 0.08 };
  const gap = 0.3;
  const entities = { ...world.entities };
  let id = world.nextId;
  for (let i = 0; i < count; i += 1) {
    const y = floorAt(world, x, z, ground) + size.y / 2 + 0.002;
    entities[id] = rigidEntity(id, `Domino ${i + 1}`, { x, y, z }, yaw, size, 0.35, TONES[i % TONES.length], "dominoes");
    id += 1;
    yaw += bend / count;
    x += Math.sin(yaw) * gap;
    z += Math.cos(yaw) * gap;
  }
  return { ok: true, detail: `${count} dominoes stand in a ${bend ? "curving " : ""}line ahead of you. Walk into the first, or say "knock them over".`, world: { ...world, entities, nextId: id } };
}

/** build_jenga: a tower of `levels` layers of three blocks, crossing each layer. */
export function buildJenga(world: World, args: Record<string, string>, ground: (x: number, z: number) => number): { ok: boolean; detail: string; world: World } {
  const me = avatarOf(world);
  const levels = Math.max(3, Math.min(18, Number(args.levels) || 12));
  const yaw = Number(me?.customData.yaw) || 0;
  const p = me?.transform.position ?? { x: 0, y: 0, z: 0 };
  const cx = p.x + Math.sin(yaw) * 1.8;
  const cz = p.z + Math.cos(yaw) * 1.8;
  const base = floorAt(world, cx, cz, ground);
  const block = { w: 0.25, h: 0.15, l: 0.75 };
  const entities = { ...world.entities };
  let id = world.nextId;
  const woods = ["#c89a62", "#b98a55", "#d4a774", "#bf9160"];
  for (let level = 0; level < levels; level += 1) {
    const turn = yaw + (level % 2 ? Math.PI / 2 : 0);
    for (let k = -1; k <= 1; k += 1) {
      const off = k * (block.w + 0.004);
      const x = cx + Math.cos(turn) * off;
      const z = cz - Math.sin(turn) * off;
      const y = base + block.h / 2 + level * (block.h + 0.001) + 0.001;
      const e = rigidEntity(id, `Jenga block ${level * 3 + k + 2}`, { x, y, z }, turn, { x: block.w, y: block.h, z: block.l }, 0.5, woods[(level + k + 3) % woods.length], "jenga");
      e.customData = { ...e.customData, src: "grain", flammable: "1" };
      entities[id] = e;
      id += 1;
    }
  }
  return { ok: true, detail: `A Jenga tower, ${levels} layers high, stands in front of you. Shove it, or knock it over.`, world: { ...world, entities, nextId: id } };
}

/** knock_over: push the first domino, or the top of the tower, or everything rigid nearby. */
export function knockOver(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const group = /jenga|tower|blocks/.test((args.what ?? "").toLowerCase()) ? "jenga" : /domino/.test((args.what ?? "").toLowerCase()) ? "dominoes" : "";
  const list = Object.values(world.entities).filter((e) => e.tags.includes(RIGID_TAG) && (!group || e.tags.includes(group)));
  if (!list.length) return { ok: false, detail: "nothing here to knock over; try building dominoes or a Jenga tower", world };
  const me = avatarOf(world);
  const yaw = Number(me?.customData.yaw) || 0;
  const dominoes = list.filter((e) => e.tags.includes("dominoes")).sort((a, b) => a.id - b.id);
  const entities = { ...world.entities };
  if (dominoes.length && group !== "jenga") {
    const first = dominoes[0];
    const q = first.transform.rotation;
    const facing = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    entities[first.id] = { ...first, physics: { ...first.physics!, velocity: { x: Math.sin(facing) * 1.2, y: 0, z: Math.cos(facing) * 1.2 } } };
    return { ok: true, detail: "You tip the first domino. Click, clack, clack…", world: { ...world, entities } };
  }
  // The tower: the top third gets a shove the way you face.
  const tops = [...list].sort((a, b) => b.transform.position.y - a.transform.position.y).slice(0, Math.max(3, Math.floor(list.length / 3)));
  for (const e of tops) entities[e.id] = { ...e, physics: { ...e.physics!, velocity: { x: Math.sin(yaw) * 2.5, y: 0, z: Math.cos(yaw) * 2.5 } } };
  return { ok: true, detail: "You shove the tower. It sways, and…", world: { ...world, entities } };
}

export function rigidIntent(intent: string): { tool: "build_dominoes" | "build_jenga" | "knock_over"; arguments: Record<string, string> } | null {
  const t = intent.trim().toLowerCase();
  if (t.split(/\s+/).length > 12) return null;
  const n = t.match(/\b(\d+)\b/)?.[1];
  if (/\bdominoe?s?\b/.test(t) && /\b(build|make|set up|line up|place|put|add)\b/.test(t)) return { tool: "build_dominoes", arguments: { ...(n ? { count: n } : {}), ...(/\b(curve|curving|spiral|circle|round)\b/.test(t) ? { bend: "3.2" } : {}) } };
  if (/\b(jenga|tower of blocks|block tower)\b/.test(t) && /\b(build|make|set up|stack|place|put|add)\b/.test(t)) return { tool: "build_jenga", arguments: n ? { levels: n } : {} };
  if (/\b(knock|push|topple|tip)\b.*\b(over|down|them|it|dominoes?|tower|jenga)\b/.test(t)) return { tool: "knock_over", arguments: { what: /jenga|tower/.test(t) ? "tower" : /domino/.test(t) ? "dominoes" : "" } };
  return null;
}
