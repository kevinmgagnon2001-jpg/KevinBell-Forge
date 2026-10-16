/**
 * Physics for the world's bodies and for the person walking in it. Plain numbers, no renderer, so it
 * runs the same in the page, in tests and on a host.
 *
 *   solidsOf    every entity that blocks: its axis-aligned box (rotations are boxed in), whether it
 *               moves on its own (dynamic) and the slide of a marble ramp.
 *   stepWalk    the walker: gravity, jumping, standing on things, stepping up kerbs and stairs up to
 *               STEP high, sliding along walls, bumping its head, and shoving loose objects.
 *   stepBody    a loose object (physics on, not kinematic): gravity, landing and bouncing, friction,
 *               sliding off walls, stacking on whatever is under it, rolling if round. A body at rest
 *               sleeps: it comes back as the very same object, so nothing re-renders.
 *   collidePairs  loose objects knocking into each other (equal-and-opposite, by mass).
 *
 * The ground is the land itself (terrain.ts): the plaza at y = 0, then meadow and hills; the lake is
 * walked on at its surface.
 */
import type { Entity, Quat, Vec3 } from "./types.ts";
import { heightAt, PLAZA_RADIUS, WATER_Y } from "./terrain.ts";

export type Solid = {
  id: number;
  min: Vec3;
  max: Vec3;
  /** Moves on its own (physics on, not kinematic): it gets shoved instead of blocking. */
  dynamic: boolean;
  /** Round: rolls instead of sliding. */
  round: boolean;
  /** A ramp's push for whatever rests on it ("vx,vz"), from customData.slide. */
  slide: string;
};

/** How the walker is built and moves. Feet are FOOT below the avatar entity's position. */
export const WALK = {
  radius: 0.24,
  height: 1.42,
  foot: 0.62,
  /** Tallest ledge walked straight up onto. */
  step: 0.4,
  /** Take-off speed, m/s: about 0.8 m high. */
  jump: 5.2,
  gravity: -15,
  /** A shove's speed, as a share of the walker's. */
  shove: 1.25,
} as const;

const EPS = 1e-4;

/** Where something stands with nothing under it. */
export function groundAt(x: number, z: number): number {
  if (Math.hypot(x, z) < PLAZA_RADIUS) return 0;
  return Math.max(heightAt(x, z), WATER_Y);
}

/** Things you pass through: yourself, the worn helm, ghosts of visitors, portals, splats, hoops. */
const PASS_TAGS = ["architect", "helm", "worn", "agent", "presence", "visitor", "device-screen", "tv"];
const SOLID_ASSETS = new Set(["cube", "platform", "pillar", "sphere", "gem", "crystal", "knot", "vase", "card", "gauge"]);

function assetOf(entity: Entity): string {
  return entity.representation.kind === "mesh" ? entity.representation.assetId : entity.representation.kind;
}

/** Half extents of a box after a rotation: the box that holds the turned box. */
function turnedHalf(h: Vec3, q: Quat): Vec3 {
  const { x, y, z, w } = q;
  const m = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  const e = [h.x, h.y, h.z];
  const out = m.map((row) => Math.abs(row[0]) * e[0] + Math.abs(row[1]) * e[1] + Math.abs(row[2]) * e[2]);
  return { x: out[0], y: out[1], z: out[2] };
}

export function isDynamic(entity: Entity): boolean {
  return !!entity.physics && !entity.physics.isKinematic;
}

/** The box an entity fills, or null when it does not block anything. */
export function solidOf(entity: Entity): Solid | null {
  if (entity.tags.some((tag) => PASS_TAGS.includes(tag))) return null;
  if (entity.customData.neural) return null;
  const asset = assetOf(entity);
  if (!SOLID_ASSETS.has(asset)) return null;
  const p = entity.transform.position;
  const s = entity.transform.scale;
  if (![p.x, p.y, p.z, s.x, s.y, s.z].every(Number.isFinite)) return null;
  const base = { id: entity.id, dynamic: isDynamic(entity), round: asset === "sphere", slide: entity.customData.slide ?? "" };
  // A gauge stands on its position, about this big whatever it wears (Gauges.tsx).
  if (asset === "gauge") return { ...base, min: { x: p.x - 0.42, y: p.y, z: p.z - 0.42 }, max: { x: p.x + 0.42, y: p.y + 1.6, z: p.z + 0.42 } };
  const half = { x: Math.abs(s.x) / 2, y: Math.abs(s.y) / 2, z: Math.abs(s.z) / 2 };
  // Round things keep their size however they roll; for the rest, box in the rotation.
  const h = base.round ? half : turnedHalf(half, entity.transform.rotation);
  return { ...base, min: { x: p.x - h.x, y: p.y - h.y, z: p.z - h.z }, max: { x: p.x + h.x, y: p.y + h.y, z: p.z + h.z } };
}

export function solidsOf(entities: Record<number, Entity> | Entity[]): Solid[] {
  const list = Array.isArray(entities) ? entities : Object.values(entities);
  const out: Solid[] = [];
  for (const entity of list) {
    const solid = solidOf(entity);
    if (solid) out.push(solid);
  }
  return out;
}

type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

function hits(s: Solid, b: Box): boolean {
  return s.min.x < b.maxX - EPS && s.max.x > b.minX + EPS && s.min.y < b.maxY - EPS && s.max.y > b.minY + EPS && s.min.z < b.maxZ - EPS && s.max.z > b.minZ + EPS;
}

/** Overlaps in x and z only: the solid is above or below the box's footprint. */
function under(s: Solid, b: Box): boolean {
  return s.min.x < b.maxX - EPS && s.max.x > b.minX + EPS && s.min.z < b.maxZ - EPS && s.max.z > b.minZ + EPS;
}

// ---------- the walker ----------

export type WalkState = {
  /** Feet. */
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
};

export type WalkInput = {
  /** Wanted horizontal velocity, m/s. */
  vx: number;
  vz: number;
  /** Jump this step (only leaves the ground when standing on something). */
  jump: boolean;
  /** Flying: -1..1 up or down, no gravity. null walks. */
  fly: number | null;
  /** Climb speed while flying, m/s. */
  flySpeed?: number;
};

export type WalkResult = {
  state: WalkState;
  /** Loose objects shoved this step, with the velocity they were given. */
  shoved: { id: number; vx: number; vz: number }[];
  /** Speed when landing this step (0 when not landing). */
  landed: number;
  /** Ran into a wall this step. */
  bumped: boolean;
};

function walkerBox(x: number, y: number, z: number): Box {
  const r = WALK.radius;
  return { minX: x - r, maxX: x + r, minY: y, maxY: y + WALK.height, minZ: z - r, maxZ: z + r };
}

/** Highest thing under the footprint at or below `top`: the land, or a solid's upper face. */
function supportUnder(x: number, z: number, box: Box, top: number, solids: Solid[], ground: (x: number, z: number) => number): { y: number; solid: Solid | null } {
  let best = { y: ground(x, z), solid: null as Solid | null };
  for (const s of solids) {
    if (s.max.y > top + EPS || s.max.y <= best.y) continue;
    if (under(s, box)) best = { y: s.max.y, solid: s };
  }
  return best;
}

/**
 * One step of the walker. Solids it already stands inside are ignored, so a world edited around
 * you (or a bad save) never traps you: you walk out.
 */
export function stepWalk(state: WalkState, input: WalkInput, solids: Solid[], dt: number, ground: (x: number, z: number) => number = groundAt): WalkResult {
  let { x, y, z, vy, grounded } = state;
  // Inset top and bottom, so the floor under you and a ceiling just over your head still count.
  const startBox = { ...walkerBox(x, y, z), minY: y + 0.02, maxY: y + WALK.height - 0.02 };
  const blocking = solids.filter((s) => !s.dynamic && !hits(s, startBox));
  const loose = solids.filter((s) => s.dynamic);
  let bumped = false;

  // Across: one axis at a time, in short hops so a fast walker cannot pass through a thin wall.
  const travel = Math.hypot(input.vx, input.vz) * dt;
  const hops = Math.max(1, Math.ceil(travel / 0.12));
  const along = (axis: "x" | "z", d: number) => {
    if (!d) return;
    const nx = axis === "x" ? x + d : x;
    const nz = axis === "z" ? z + d : z;
    const box = walkerBox(nx, y + 0.001, nz);
    let rise = 0;
    let limit = Math.abs(d);
    let blocked = false;
    for (const s of blocking) {
      if (!hits(s, box)) continue;
      const up = s.max.y - y;
      // A kerb, a stair, a low box: step onto it if there is room for your head on top.
      if ((grounded || input.fly !== null) && up <= WALK.step && !blocking.some((o) => o !== s && hits(o, walkerBox(nx, s.max.y + 0.001, nz)))) {
        rise = Math.max(rise, up);
        continue;
      }
      blocked = true;
      // How far you can go before touching it.
      const room = d > 0 ? (axis === "x" ? s.min.x - WALK.radius - x : s.min.z - WALK.radius - z) : (axis === "x" ? x - s.max.x - WALK.radius : z - s.max.z - WALK.radius);
      limit = Math.min(limit, Math.max(0, room - EPS));
    }
    if (blocked) {
      bumped = true;
      if (axis === "x") x += Math.sign(d) * limit;
      else z += Math.sign(d) * limit;
      return;
    }
    x = nx;
    z = nz;
    if (rise > 0) y += rise;
  };
  for (let i = 0; i < hops; i += 1) {
    along("x", (input.vx * dt) / hops);
    along("z", (input.vz * dt) / hops);
  }

  // Up and down.
  if (input.fly !== null) {
    vy = input.fly * (input.flySpeed ?? 4.6);
  } else {
    if (grounded && input.jump) {
      vy = WALK.jump;
      grounded = false;
    }
    vy += WALK.gravity * dt;
  }
  let ny = y + vy * dt;
  const foot = walkerBox(x, y, z);
  const support = supportUnder(x, z, foot, y + 0.02, [...blocking, ...loose], ground);
  let landed = 0;
  if (ny <= support.y) {
    if (!grounded && vy < 0) landed = -vy;
    ny = support.y;
    vy = Math.max(0, vy);
    grounded = vy === 0 || input.fly !== null;
  } else if (grounded && input.fly === null && vy <= 0 && ny - support.y < 0.22) {
    // Walking down a slope or off a low step: stay on the ground instead of hopping.
    ny = support.y;
    vy = 0;
  } else {
    grounded = false;
  }
  if (ny > y) {
    // Heads hit ceilings.
    for (const s of blocking) {
      if (s.min.y < y + WALK.height - EPS) continue;
      if (!under(s, foot)) continue;
      if (ny + WALK.height > s.min.y) {
        ny = s.min.y - WALK.height;
        vy = Math.min(0, vy);
      }
    }
  }
  y = ny;

  // Loose objects you walk into get shoved the way you are going.
  const shoved: WalkResult["shoved"] = [];
  const speed = Math.hypot(input.vx, input.vz);
  if (speed > 0.1) {
    const reach = walkerBox(x + (input.vx / speed) * 0.08, y + 0.05, z + (input.vz / speed) * 0.08);
    for (const s of loose) if (hits(s, reach)) shoved.push({ id: s.id, vx: input.vx * WALK.shove, vz: input.vz * WALK.shove });
  }
  return { state: { x, y, z, vy, grounded }, shoved, landed, bumped };
}

// ---------- loose objects ----------

/** How lively a body is: bounce (0..1) and how fast sliding dies away (per second). */
export function materialOf(entity: Entity): { bounce: number; friction: number } {
  const round = assetOf(entity) === "sphere";
  const bounce = Number(entity.customData.bounce);
  const friction = Number(entity.customData.friction);
  return {
    bounce: Number.isFinite(bounce) ? Math.max(0, Math.min(0.95, bounce)) : round ? 0.5 : 0.25,
    friction: Number.isFinite(friction) ? Math.max(0, friction) : round ? 0.5 : 4,
  };
}

const SLEEP = 0.03;

/** True when the body is lying on something and not moving: it can sleep. */
function resting(entity: Entity, self: Solid, solids: Solid[], ground: (x: number, z: number) => number): boolean {
  const v = entity.physics?.velocity;
  if (!v || Math.hypot(v.x, v.y, v.z) > SLEEP) return false;
  const box: Box = { minX: self.min.x, maxX: self.max.x, minY: self.min.y, maxY: self.max.y, minZ: self.min.z, maxZ: self.max.z };
  const support = supportUnder(entity.transform.position.x, entity.transform.position.z, box, self.min.y + 0.01, solids, ground);
  return Math.abs(self.min.y - support.y) < 0.002 && !support.solid?.slide;
}

function rolled(q: Quat, vx: number, vz: number, radius: number, dt: number): Quat {
  const speed = Math.hypot(vx, vz);
  if (speed < 1e-4 || radius <= 0) return q;
  // Rolling forward along v turns the ball about the axis up × v.
  const angle = (speed * dt) / radius;
  const ax = vz / speed;
  const az = -vx / speed;
  const s = Math.sin(angle / 2);
  const r = { x: ax * s, y: 0, z: az * s, w: Math.cos(angle / 2) };
  // r * q
  return {
    x: r.w * q.x + r.x * q.w + r.y * q.z - r.z * q.y,
    y: r.w * q.y - r.x * q.z + r.y * q.w + r.z * q.x,
    z: r.w * q.z + r.x * q.y - r.y * q.x + r.z * q.w,
    w: r.w * q.w - r.x * q.x - r.y * q.y - r.z * q.z,
  };
}

/**
 * One step of a loose object against everything else (`solids` must not include it). Kinematic and
 * physics-free entities come back unchanged, and so does a body asleep on something.
 */
export function stepBody(entity: Entity, dt: number, gravity: number, solids: Solid[], ground: (x: number, z: number) => number = groundAt): Entity {
  const phys = entity.physics;
  if (!phys || phys.isKinematic) return entity;
  const self = solidOf({ ...entity, tags: entity.tags.filter((tag) => !PASS_TAGS.includes(tag)) });
  const p = entity.transform.position;
  if (!self) {
    // Not a solid shape: falls to the ground, nothing more (and sleeps there).
    const floor = ground(p.x, p.z) + Math.max(0.02, entity.transform.scale.y / 2);
    const still = Math.hypot(phys.velocity.x, phys.velocity.y, phys.velocity.z) < SLEEP;
    if (still && Math.abs(p.y - floor) < 0.002) return entity;
    const vy = phys.velocity.y + gravity * dt;
    let y = p.y + vy * dt;
    const v = { x: phys.velocity.x, y: vy, z: phys.velocity.z };
    if (y <= floor) {
      y = floor;
      v.y = 0;
      const keep = Math.exp(-4 * dt);
      v.x = Math.hypot(v.x, v.z) * keep < SLEEP ? 0 : v.x * keep;
      v.z = v.x === 0 ? 0 : v.z * keep;
    }
    return { ...entity, physics: { ...phys, velocity: v }, transform: { ...entity.transform, position: { x: p.x + v.x * dt, y, z: p.z + v.z * dt } } };
  }
  if (resting(entity, self, solids, ground)) return entity;
  const { bounce, friction } = materialOf(entity);
  const hx = (self.max.x - self.min.x) / 2;
  const hy = (self.max.y - self.min.y) / 2;
  const hz = (self.max.z - self.min.z) / 2;
  const v = { x: phys.velocity.x, y: phys.velocity.y + gravity * dt, z: phys.velocity.z };
  const statics = solids.filter((s) => !s.dynamic);
  const box = (x: number, y: number, z: number): Box => ({ minX: x - hx, maxX: x + hx, minY: y - hy, maxY: y + hy, minZ: z - hz, maxZ: z + hz });
  const start = box(p.x, p.y + 0.01, p.z);
  const walls = statics.filter((s) => !hits(s, start));
  let x = p.x;
  let z = p.z;
  // Across, axis by axis: a wall stops that part of the motion and throws it back with the bounce.
  for (const axis of ["x", "z"] as const) {
    const d = v[axis] * dt;
    if (!d) continue;
    const nx = axis === "x" ? x + d : x;
    const nz = axis === "z" ? z + d : z;
    const moved = box(nx, p.y + 0.01, nz);
    const wall = walls.find((s) => hits(s, moved));
    if (wall) {
      v[axis] = -v[axis] * bounce;
      continue;
    }
    x = nx;
    z = nz;
  }
  // Down onto whatever is under it (other loose bodies too, so things stack).
  const footprint = box(x, p.y, z);
  const support = supportUnder(x, z, footprint, p.y - hy + 0.02, solids, ground);
  let y = p.y + v.y * dt;
  let onSomething = false;
  if (y - hy <= support.y) {
    y = support.y + hy;
    // A marble ramp is a rail: it catches what lands on it instead of bouncing it off.
    v.y = v.y < -1.2 && !support.solid?.slide ? -v.y * bounce : 0;
    onSomething = v.y === 0;
  } else if (v.y > 0) {
    for (const s of walls) {
      if (s.min.y < p.y + hy - EPS || !under(s, footprint)) continue;
      if (y + hy > s.min.y) {
        y = s.min.y - hy;
        v.y = 0;
      }
    }
  }
  if (onSomething) {
    const slide = support.solid?.slide;
    if (slide) {
      // A marble ramp sets the pace.
      const [sx, sz] = slide.split(",").map((part) => Number(part.trim()));
      if (Number.isFinite(sx)) v.x = sx;
      if (Number.isFinite(sz)) v.z = sz;
    } else {
      const keep = Math.exp(-friction * dt);
      v.x *= keep;
      v.z *= keep;
      if (Math.hypot(v.x, v.z) < SLEEP) {
        v.x = 0;
        v.z = 0;
      }
    }
  }
  const rotation = self.round && onSomething ? rolled(entity.transform.rotation, v.x, v.z, hx, dt) : entity.transform.rotation;
  return { ...entity, physics: { ...phys, velocity: v }, transform: { ...entity.transform, rotation, position: { x, y, z } } };
}

/**
 * Loose objects that overlap push apart along the shallowest axis and trade the speed along it
 * (a mostly elastic knock, weighted by mass). Changes `entities` in place; returns true if any did.
 */
export function collidePairs(entities: Record<number, Entity>): boolean {
  const loose = Object.values(entities).filter(isDynamic);
  let changed = false;
  for (let i = 0; i < loose.length; i += 1) {
    for (let j = i + 1; j < loose.length; j += 1) {
      const a = entities[loose[i].id];
      const b = entities[loose[j].id];
      const sa = solidOf(a);
      const sb = solidOf(b);
      if (!sa || !sb) continue;
      const over = {
        x: Math.min(sa.max.x, sb.max.x) - Math.max(sa.min.x, sb.min.x),
        y: Math.min(sa.max.y, sb.max.y) - Math.max(sa.min.y, sb.min.y),
        z: Math.min(sa.max.z, sb.max.z) - Math.max(sa.min.z, sb.min.z),
      };
      if (over.x <= 0.002 || over.y <= 0.002 || over.z <= 0.002) continue;
      // Resting on top of each other is the stacking above, not a knock.
      if (over.y <= over.x && over.y <= over.z) continue;
      const axis = over.x < over.z ? "x" : "z";
      const pa = a.transform.position;
      const pb = b.transform.position;
      const dir = pa[axis] <= pb[axis] ? -1 : 1;
      const ma = Math.max(0.05, a.physics!.mass);
      const mb = Math.max(0.05, b.physics!.mass);
      const share = mb / (ma + mb);
      const push = over[axis] + 0.002;
      const va = { ...a.physics!.velocity };
      const vb = { ...b.physics!.velocity };
      const closing = (va[axis] - vb[axis]) * -dir;
      if (closing > 0) {
        const e = Math.min(materialOf(a).bounce, materialOf(b).bounce) + 0.3;
        const impulse = ((1 + e) * closing) / (1 / ma + 1 / mb);
        va[axis] += (dir * impulse) / ma;
        vb[axis] -= (dir * impulse) / mb;
      }
      entities[a.id] = { ...a, physics: { ...a.physics!, velocity: va }, transform: { ...a.transform, position: { ...pa, [axis]: pa[axis] + dir * push * share } } };
      entities[b.id] = { ...b, physics: { ...b.physics!, velocity: vb }, transform: { ...b.transform, position: { ...pb, [axis]: pb[axis] - dir * push * (1 - share) } } };
      changed = true;
    }
  }
  return changed;
}

/**
 * Step every loose object once. Returns the same record when everything is asleep, so a still world
 * costs nothing to keep running.
 */
export function stepBodies(entities: Record<number, Entity>, dt: number, gravity: number, ground: (x: number, z: number) => number = groundAt): Record<number, Entity> {
  const loose = Object.values(entities).filter(isDynamic);
  if (!loose.length) return entities;
  const all = solidsOf(entities);
  let next: Record<number, Entity> | null = null;
  for (const body of loose) {
    const others = all.filter((s) => s.id !== body.id);
    const stepped = stepBody(body, dt, gravity, others, ground);
    if (stepped === body) continue;
    next ??= { ...entities };
    next[body.id] = stepped;
  }
  if (!next) return entities;
  collidePairs(next);
  return next;
}

/** Two solids overlap (with `margin` of room around them). */
export function solidsOverlap(a: Solid, b: Solid, margin = 0): boolean {
  return (
    a.min.x < b.max.x + margin - EPS &&
    a.max.x > b.min.x - margin + EPS &&
    a.min.y < b.max.y + margin - EPS &&
    a.max.y > b.min.y - margin + EPS &&
    a.min.z < b.max.z + margin - EPS &&
    a.max.z > b.min.z - margin + EPS
  );
}

/** The world's solids, worked out again only when the entities change (shared by the walker and the feet). */
const solidCache: { entities: Record<number, Entity> | null; solids: Solid[] } = { entities: null, solids: [] };
export function solidsFor(entities: Record<number, Entity>): Solid[] {
  if (solidCache.entities !== entities) {
    solidCache.entities = entities;
    solidCache.solids = solidsOf(entities);
  }
  return solidCache.solids;
}

/** Height of what a foot at (x, z) would stand on, no higher than `top`: the land or a solid's top. */
export function groundUnderFoot(x: number, z: number, top: number, solids: Solid[], ground: (x: number, z: number) => number = groundAt): number {
  const r = 0.05;
  const box: Box = { minX: x - r, maxX: x + r, minY: -Infinity, maxY: Infinity, minZ: z - r, maxZ: z + r };
  return supportUnder(x, z, box, top, solids.filter((s) => !s.dynamic), ground).y;
}
