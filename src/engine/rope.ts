/**
 * Ropes, cables and string lights (after Stable Cosserat Rods, in a light version: a chain of
 * particles solved by position-based dynamics, with stretch held exactly, bending resisted by
 * skip-one links, and collisions against the world's solids, the land and the people in it).
 *
 *   rope     hangs from a point and swings; walk into it and it swishes aside.
 *   cable    slung between two things with a little sag; it follows them when they move.
 *   lights   a cable hung with glowing bulbs (festoon lights), which bloom at night.
 *
 * An end is a point ("x,y,z") or a thing ("@id"): the top of that entity, followed live.
 * hangRope is the tool; ropeIntent reads plain requests. Rope.tsx draws and steps them.
 */
import type { Entity, World } from "./types.ts";
import { IDENTITY, V3 } from "./types.ts";
import type { Solid } from "./physics.ts";

export const ROPE_TAG = "rope";
export type RopeKind = "rope" | "cable" | "lights";
export const ROPE_KINDS: RopeKind[] = ["rope", "cable", "lights"];

type P = { x: number; y: number; z: number };

/** How each kind is built: thickness, how much it resists bending, how much air slows it. */
export const ROPE_LOOK: Record<RopeKind, { radius: number; bend: number; drag: number; color: string }> = {
  rope: { radius: 0.028, bend: 0.12, drag: 0.6, color: "#b08a5a" },
  cable: { radius: 0.018, bend: 0.3, drag: 0.4, color: "#17191d" },
  lights: { radius: 0.008, bend: 0.05, drag: 0.5, color: "#202226" },
};

export type RopeSpec = { kind: RopeKind; a: P; b: P | null; length: number };

export type RopeSim = {
  n: number;
  /** Rest length of one link. */
  rest: number;
  pos: Float64Array;
  prev: Float64Array;
};

/** Things that push the rope aside: upright cylinders (people). */
export type Pusher = { x: number; y: number; z: number; r: number; h: number };

export type RopeWorld = {
  solids: Solid[];
  ground: (x: number, z: number) => number;
  /** Wind, m/s², across the ground. */
  wind?: { x: number; z: number };
  pushers?: Pusher[];
};

export const GRAVITY = -9.81;
const SUBSTEPS = 4;
const ITERATIONS = 6;

/** Links for a rope of this length: about one every 12 cm, between 8 and 40. */
export function linksFor(length: number): number {
  return Math.max(8, Math.min(40, Math.round(length / 0.12)));
}

/** A new rope at rest-ish: a cable laid on a gentle curve between its ends, a rope hanging down. */
export function makeRope(spec: RopeSpec): RopeSim {
  const links = linksFor(spec.length);
  const n = links + 1;
  const rest = spec.length / links;
  const pos = new Float64Array(n * 3);
  const { a, b } = spec;
  for (let i = 0; i < n; i += 1) {
    const t = i / links;
    if (b) {
      // A parabola dipping by about what the extra length allows.
      const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const dip = Math.sqrt(Math.max(0, spec.length * spec.length - span * span)) * 0.5;
      pos[i * 3] = a.x + (b.x - a.x) * t;
      pos[i * 3 + 1] = a.y + (b.y - a.y) * t - dip * 4 * t * (1 - t);
      pos[i * 3 + 2] = a.z + (b.z - a.z) * t;
    } else {
      pos[i * 3] = a.x;
      pos[i * 3 + 1] = a.y - rest * i;
      pos[i * 3 + 2] = a.z;
    }
  }
  return { n, rest, pos, prev: Float64Array.from(pos) };
}

function link(pos: Float64Array, i: number, j: number, rest: number, wi: number, wj: number, stiffness: number) {
  const w = wi + wj;
  if (w <= 0) return;
  const dx = pos[j * 3] - pos[i * 3];
  const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
  const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) return;
  const c = ((d - rest) / d / w) * stiffness;
  pos[i * 3] += dx * c * wi;
  pos[i * 3 + 1] += dy * c * wi;
  pos[i * 3 + 2] += dz * c * wi;
  pos[j * 3] -= dx * c * wj;
  pos[j * 3 + 1] -= dy * c * wj;
  pos[j * 3 + 2] -= dz * c * wj;
}

function tether(pos: Float64Array, i: number, to: P, most: number) {
  const dx = pos[i * 3] - to.x;
  const dy = pos[i * 3 + 1] - to.y;
  const dz = pos[i * 3 + 2] - to.z;
  const d = Math.hypot(dx, dy, dz);
  if (d <= most || d < 1e-9) return;
  const k = most / d;
  pos[i * 3] = to.x + dx * k;
  pos[i * 3 + 1] = to.y + dy * k;
  pos[i * 3 + 2] = to.z + dz * k;
}

/** Push a particle out of the world: solids (by the shallowest way out), people, and the land. Returns true on contact. */
function collide(pos: Float64Array, i: number, r: number, world: RopeWorld): boolean {
  let touched = false;
  let x = pos[i * 3];
  let y = pos[i * 3 + 1];
  let z = pos[i * 3 + 2];
  for (const s of world.solids) {
    if (x < s.min.x - r || x > s.max.x + r || y < s.min.y - r || y > s.max.y + r || z < s.min.z - r || z > s.max.z + r) continue;
    const outs = [s.min.x - r - x, s.max.x + r - x, s.min.y - r - y, s.max.y + r - y, s.min.z - r - z, s.max.z + r - z];
    let best = 0;
    for (let k = 1; k < 6; k += 1) if (Math.abs(outs[k]) < Math.abs(outs[best])) best = k;
    if (best < 2) x += outs[best];
    else if (best < 4) y += outs[best];
    else z += outs[best];
    touched = true;
  }
  for (const p of world.pushers ?? []) {
    if (y < p.y || y > p.y + p.h) continue;
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    const room = p.r + r;
    if (d >= room) continue;
    const k = d > 1e-6 ? room / d : 0;
    if (k) {
      x = p.x + dx * k;
      z = p.z + dz * k;
    } else x = p.x + room;
    touched = true;
  }
  const floor = world.ground(x, z) + r;
  if (y < floor) {
    y = floor;
    touched = true;
  }
  pos[i * 3] = x;
  pos[i * 3 + 1] = y;
  pos[i * 3 + 2] = z;
  return touched;
}

/**
 * One frame of the rope. `a` and `b` are where its ends are held now (b null: the end hangs free).
 * Stable at any frame time up to 0.1 s (it substeps), and it never stretches past a few percent.
 */
export function stepRope(sim: RopeSim, kind: RopeKind, a: P, b: P | null, dt: number, world: RopeWorld): void {
  const { n, rest, pos, prev } = sim;
  const look = ROPE_LOOK[kind];
  const h = Math.min(0.1, Math.max(0, dt)) / SUBSTEPS;
  if (h <= 0) return;
  const keep = Math.exp(-look.drag * h);
  const wind = world.wind ?? { x: 0, z: 0 };
  const free = (i: number) => (i === 0 || (b && i === n - 1) ? 0 : 1);
  for (let step = 0; step < SUBSTEPS; step += 1) {
    // Move on with what it had (Verlet), under gravity and the wind.
    for (let i = 0; i < n; i += 1) {
      if (!free(i)) continue;
      for (let k = 0; k < 3; k += 1) {
        const at = pos[i * 3 + k];
        const v = (at - prev[i * 3 + k]) * keep;
        prev[i * 3 + k] = at;
        const force = k === 1 ? GRAVITY : k === 0 ? wind.x : wind.z;
        pos[i * 3 + k] = at + v + force * h * h;
      }
    }
    // The held ends.
    pos[0] = a.x;
    pos[1] = a.y;
    pos[2] = a.z;
    prev[0] = a.x;
    prev[1] = a.y;
    prev[2] = a.z;
    if (b) {
      const e = (n - 1) * 3;
      pos[e] = b.x;
      pos[e + 1] = b.y;
      pos[e + 2] = b.z;
      prev[e] = b.x;
      prev[e + 1] = b.y;
      prev[e + 2] = b.z;
    }
    for (let it = 0; it < ITERATIONS; it += 1) {
      // Stretch, sweeping both ways so a long chain settles evenly; then bending, softly.
      if (it % 2 === 0) for (let i = 0; i < n - 1; i += 1) link(pos, i, i + 1, rest, free(i), free(i + 1), 1);
      else for (let i = n - 2; i >= 0; i -= 1) link(pos, i, i + 1, rest, free(i), free(i + 1), 1);
      for (let i = 0; i < n - 2; i += 1) link(pos, i, i + 2, rest * 2, free(i), free(i + 2), look.bend);
    }
    // Long-range tethers: no particle is further from a held end than the rope between them, so a
    // long chain never stretches however few iterations it gets.
    for (let i = 1; i < n; i += 1) {
      if (!free(i)) continue;
      tether(pos, i, a, rest * i);
      if (b) tether(pos, i, b, rest * (n - 1 - i));
    }
    for (let i = 0; i < n; i += 1) {
      if (!free(i)) continue;
      if (collide(pos, i, look.radius + 0.01, world)) {
        // Friction where it rests on something: most of the sliding goes.
        for (let k = 0; k < 3; k += 1) prev[i * 3 + k] += (pos[i * 3 + k] - prev[i * 3 + k]) * 0.4;
      }
    }
    // A last stretch pass so what collisions moved stays joined.
    for (let i = 0; i < n - 1; i += 1) link(pos, i, i + 1, rest, free(i), free(i + 1), 1);
  }
}

/** The rope's length now, end to end along its links. */
export function ropeLength(sim: RopeSim): number {
  let total = 0;
  for (let i = 0; i < sim.n - 1; i += 1) total += Math.hypot(sim.pos[i * 3 + 3] - sim.pos[i * 3], sim.pos[i * 3 + 4] - sim.pos[i * 3 + 1], sim.pos[i * 3 + 5] - sim.pos[i * 3 + 2]);
  return total;
}

/** Fastest-moving particle's speed per frame, for sleeping a still rope. */
export function ropeMotion(sim: RopeSim): number {
  let most = 0;
  for (let i = 0; i < sim.pos.length; i += 1) most = Math.max(most, Math.abs(sim.pos[i] - sim.prev[i]));
  return most;
}

// ---------- ends ----------

/** "x,y,z" or "@id" (the top of that entity), as saved on the rope. */
export function parseEnd(text: string | undefined): P | number | null {
  if (!text) return null;
  const t = text.trim();
  if (t.startsWith("@")) {
    const id = Number(t.slice(1));
    return Number.isInteger(id) ? id : null;
  }
  const parts = t.split(",").map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? { x: parts[0], y: parts[1], z: parts[2] } : null;
}

/** Where an end is held now: a point, or the top centre of a thing (null when that thing is gone). */
export function endPoint(end: P | number | null, entities: Record<number, Entity>): P | null {
  if (end == null) return null;
  if (typeof end !== "number") return end;
  const e = entities[end];
  if (!e) return null;
  const p = e.transform.position;
  const top = e.tags.includes("architect") || e.tags.includes("agent") ? 0.55 : Math.abs(e.transform.scale.y) / 2;
  return { x: p.x, y: p.y + top, z: p.z };
}

// ---------- the tool ----------

const avatarOf = (world: World) => Object.values(world.entities).find((e) => e.tags.includes("architect"));

/** A thing by name ("the bench", "pillar"), not ropes, the helm or the floor. */
export function thingNamed(world: World, name: string): Entity | null {
  const q = name.trim().toLowerCase().replace(/^(the|a|an|my)\s+/, "");
  if (!q) return null;
  const list = Object.values(world.entities).filter((e) => !e.tags.includes(ROPE_TAG) && !e.tags.includes("helm") && !e.tags.includes("floor"));
  if (/^(me|you|myself|yourself)$/.test(q)) return avatarOf(world) ?? null;
  return list.find((e) => e.name.toLowerCase() === q) ?? list.find((e) => e.name.toLowerCase().startsWith(q)) ?? list.find((e) => e.name.toLowerCase().includes(q)) ?? null;
}

const num = (v: string | undefined) => (v != null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * hang_rope: kind rope (hangs from a point in front of you, about 3 m up), cable or lights (between
 * `from` and `to`: names of things, or "here" for in front of you). length in metres; sag is the
 * extra share of length a cable gets over its span (default 0.06).
 */
export function hangRope(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const kind = (ROPE_KINDS as string[]).includes(args.kind ?? "") ? (args.kind as RopeKind) : "rope";
  const me = avatarOf(world);
  const yaw = Number(me?.customData.yaw) || 0;
  const mp = me?.transform.position ?? { x: 0, y: 0.62, z: 0 };
  const ahead = (d: number, y: number): P => ({ x: mp.x + Math.sin(yaw) * d, y, z: mp.z + Math.cos(yaw) * d });
  const groundY = mp.y - 0.62;
  const resolve = (name: string | undefined, fallback: P): { end: string; at: P; label: string } | { error: string } => {
    const n = (name ?? "").trim();
    if (!n || /^(here|there|this|in front( of me)?)$/i.test(n)) return { end: `${round(fallback.x)},${round(fallback.y)},${round(fallback.z)}`, at: fallback, label: "here" };
    const thing = thingNamed(world, n);
    if (!thing) return { error: `nothing called "${n}" to tie it to` };
    const at = endPoint(thing.id, world.entities)!;
    return { end: `@${thing.id}`, at, label: thing.name };
  };
  let a: { end: string; at: P; label: string };
  let b: { end: string; at: P; label: string } | null = null;
  let length: number;
  if (kind === "rope") {
    const top = resolve(args.from, ahead(1.6, groundY + 3.2));
    if ("error" in top) return { ok: false, detail: top.error, world };
    a = top;
    const drop = top.at.y - groundY;
    length = Math.max(0.5, Math.min(12, num(args.length) ?? Math.max(1, drop - 0.35)));
  } else {
    const from = resolve(args.from, ahead(1.2, groundY + 2.6));
    if ("error" in from) return { ok: false, detail: from.error, world };
    const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const fallback = { x: from.at.x - side.x * 4, y: from.at.y, z: from.at.z - side.z * 4 };
    const to = resolve(args.to, fallback);
    if ("error" in to) return { ok: false, detail: to.error, world };
    if (to.end === from.end) return { ok: false, detail: "both ends are the same place", world };
    a = from;
    b = to;
    const span = Math.hypot(to.at.x - from.at.x, to.at.y - from.at.y, to.at.z - from.at.z);
    const sag = Math.max(0, Math.min(0.5, num(args.sag) ?? (kind === "lights" ? 0.08 : 0.05)));
    length = Math.max(0.5, Math.min(24, num(args.length) ?? span * (1 + sag)));
    if (length < span) length = span * 1.01;
  }
  const id = world.nextId;
  const color = args.color?.trim() || ROPE_LOOK[kind].color;
  const entity: Entity = {
    id,
    name: args.name?.trim() || (kind === "lights" ? "String lights" : kind === "cable" ? "Cable" : "Rope"),
    transform: { position: V3(a.at.x, a.at.y, a.at.z), rotation: { ...IDENTITY }, scale: V3(0.12, 0.12, 0.12) },
    representation: { kind: "mesh", assetId: "rope" },
    physics: null,
    tags: ["spawned", ROPE_TAG],
    customData: { rope: kind, a: a.end, ...(b ? { b: b.end } : {}), length: String(round(length)), color, ...(kind === "lights" && args.bulbs ? { bulbs: args.bulbs } : {}) },
  };
  const what = kind === "lights" ? `String lights run from ${a.label} to ${b!.label}` : kind === "cable" ? `A cable is slung from ${a.label} to ${b!.label}` : `A rope hangs from ${a.label === "here" ? "a hook in front of you" : a.label}`;
  return {
    ok: true,
    detail: `${what}, ${round(length)} m long. ${kind === "rope" ? "Walk into it and it swings." : "It sags under its own weight and follows what it is tied to."}`,
    world: { ...world, entities: { ...world.entities, [id]: entity }, nextId: id + 1 },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

export type RopeCall = { tool: "hang_rope"; arguments: Record<string, string> };

/** Plain requests: "hang a rope", "string lights between the bench and the terminal", "a cable from here to the pillar". */
export function ropeIntent(intent: string): RopeCall | null {
  const text = intent.trim().toLowerCase().replace(/[’']/g, "");
  if (text.split(/\s+/).length > 16) return null;
  const kind: RopeKind | null = /\b(string|fairy|festoon|party|christmas|twinkle|bistro)\s+lights?\b|\blights? (string|strand)\b|\bbunting\b/.test(text)
    ? "lights"
    : /\b(cable|wire|power ?line|zip ?line)\b/.test(text)
      ? "cable"
      : /\b(rope|vine|lasso|line)\b/.test(text)
        ? "rope"
        : null;
  if (!kind) return null;
  if (/\b(delete|remove|cut|paint|colou?r)\b/.test(text)) return null;
  if (!/\b(hang|string|put|add|make|run|stretch|tie|give|place|drape|sling|spawn|create)\b/.test(text) && !/^(a |some )?(rope|cable|string lights|lights)\b/.test(text)) return null;
  const args: Record<string, string> = { kind };
  const pair = text.match(/\b(?:between|from)\s+(.+?)\s+(?:and|to)\s+(.+?)\s*$/);
  if (pair) {
    args.from = pair[1];
    args.to = pair[2];
  } else {
    const one = text.match(/\b(?:from|on|off)\s+(?:the\s+)?(.+?)\s*$/);
    if (one && kind === "rope") args.from = one[1];
  }
  const len = text.match(/(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\b/);
  if (len) args.length = len[1];
  return { tool: "hang_rope", arguments: args };
}
