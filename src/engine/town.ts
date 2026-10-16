/**
 * Townsfolk: people with a memory and a day, who find their way through a crowd.
 *
 *   NPCs with memory and a day (after Generative Agents, Park et al. 2023): each person has a memory
 *   stream (what they saw, where they went, who they talked to, and now and then a reflection that
 *   sums up a stretch of it) and a plan for the day built from their habits. Plans and reflections
 *   are made here, on the device, by rules; a model can rewrite a plan through the same shape later,
 *   asked every few minutes and in batches, never per frame. Ask "what did Mia do today?".
 *
 *   Crowds that find their way (after TRACE & PACER, CVPR 2023, made small): a planner gives each
 *   person a goal; a reciprocal velocity-obstacle step (sampled RVO, van den Berg et al. 2008, the
 *   idea ORCA sharpened) picks the velocity closest to where they want to go that does not run into
 *   anyone or anything soon; and, as in the paper's loop, someone who stops making progress replans
 *   around the obstacle.
 *
 * Everything is deterministic for a given start (seeded), and pure: `stepTown` takes the town and
 * returns the next one. The renderer steps it every frame and writes positions back now and then.
 */
import type { Entity, World } from "./types.ts";
import { IDENTITY, V3 } from "./types.ts";
import { PLAZA_RADIUS } from "./terrain.ts";

export const NPC_TAG = "npc";
export const MAX_TOWNSFOLK = 24;

export type Memory = { /** Town minutes since the town began. */ at: number; text: string; kind: "saw" | "went" | "talked" | "plan" | "reflect"; importance: number };
export type PlanStep = { /** Hour the step starts. */ from: number; place: string; doing: string };
export type Mind = {
  traits: string[];
  plan: PlanStep[];
  memory: Memory[];
  /** A place someone sent them to, until they get there. */
  errand?: string;
  /** Names of things they have noticed (so a new tower is news once). */
  seen?: string[];
};
export type Town = {
  /** Town clock, minutes since it began. One real second is one town minute. */
  minutes: number;
  /** Hour of the day when the clock began. */
  startHour: number;
  minds: Record<number, Mind>;
};

export type Body = { x: number; z: number; vx: number; vz: number; yaw: number; speed: number; stuck: number; detour: { x: number; z: number; until: number } | null; lastTalk: Record<number, number> };

const NAMES = ["Mia", "Leo", "Ava", "Kai", "Zoe", "Eli", "Ivy", "Max", "Ruby", "Finn", "Nora", "Theo", "Luna", "Sam", "Iris", "Owen", "Maya", "Jude", "Lily", "Ezra", "Rosa", "Arlo", "Cleo", "Nico"];
const SUITS = ["#8a3b3b", "#3b5f8a", "#4f7a3d", "#7a5a2e", "#5b3b7a", "#2e6b6b", "#8a6a3b", "#46505c", "#7a3b5e", "#3b7a5a"];
const SKINS = ["#f1c9a5", "#e0ac8a", "#c68e6a", "#a8704c", "#7d5236", "#5a3a24", "#f5d6bd", "#d39f7a"];
const TRAITS = ["early bird", "night owl", "chatty", "shy", "curious", "busy", "dreamy", "sporty"];

export function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- places ----------

export type Place = { name: string; x: number; z: number; outdoor: boolean };

/** Where people can go: the plaza's own spots, plus anything with a name worth walking to. */
export function placesOf(world: Pick<World, "entities">): Place[] {
  const out: Place[] = [
    { name: "the plaza", x: 0, z: 4, outdoor: true },
    { name: "the lamps", x: PLAZA_RADIUS - 2, z: 2, outdoor: true },
    { name: "the far side", x: -PLAZA_RADIUS + 3, z: -3, outdoor: true },
    { name: "the meadow", x: 6, z: PLAZA_RADIUS - 2.5, outdoor: true },
  ];
  for (const e of Object.values(world.entities)) {
    if (e.tags.includes(NPC_TAG) || e.tags.includes("architect") || e.tags.includes("helm") || e.tags.includes("tetris") || e.tags.includes("floor")) continue;
    const p = e.transform.position;
    if (Math.hypot(p.x, p.z) > PLAZA_RADIUS + 6 || e.name.length < 2) continue;
    // A body under a roof (a café, a hall, the bench's desk) is shelter.
    const shelter = /\b(cafe|café|hall|house|home|shop|bar|pub|inn|tent|hut|shelter|bench|terminal|tv)\b/i.test(e.name);
    out.push({ name: e.name, x: p.x, z: p.z, outdoor: !shelter });
  }
  return out;
}

const placeByName = (places: Place[], name: string) => places.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;

// ---------- making people ----------

/** A day's plan from habits and the places there are. */
export function planDay(traits: string[], places: Place[], seed: number): PlanStep[] {
  const rand = rng(seed);
  const pick = () => places[Math.floor(rand() * places.length)].name;
  const favourite = pick();
  const cafe = places.find((p) => /\b(cafe|café|bar|pub|inn|kitchen|diner)\b/i.test(p.name))?.name ?? places.find((p) => /bench/i.test(p.name))?.name ?? pick();
  const early = traits.includes("early bird") ? -1.5 : traits.includes("night owl") ? 1.5 : 0;
  const social = traits.includes("chatty") ? "the plaza" : traits.includes("shy") ? "the far side" : pick();
  return [
    { from: 0, place: "home", doing: "sleeping" },
    { from: 7 + early, place: pick(), doing: traits.includes("sporty") ? "a morning jog" : "a morning walk" },
    { from: 9 + early / 2, place: favourite, doing: traits.includes("busy") ? "working" : traits.includes("curious") ? "looking around" : "passing the time" },
    { from: 12, place: cafe, doing: "lunch" },
    { from: 13.5, place: pick(), doing: traits.includes("dreamy") ? "daydreaming" : "an errand" },
    { from: 16, place: social, doing: traits.includes("chatty") ? "catching up with people" : "a quiet afternoon" },
    { from: 18.5, place: "the lamps", doing: "watching the evening come in" },
    { from: 20 + early, place: favourite, doing: "winding down" },
    { from: 22 + early, place: "home", doing: "going to bed" },
  ];
}

export function hourOf(town: Town): number {
  return (((town.startHour + town.minutes / 60) % 24) + 24) % 24;
}
export const dayOf = (town: Town) => Math.floor((town.startHour * 60 + town.minutes) / 1440);

export function stepNow(mind: Mind, hour: number): PlanStep {
  let now = mind.plan[0];
  for (const step of mind.plan) if (hour >= step.from) now = step;
  return now;
}

export const clock = (town: Town, at: number) => {
  const h = (((town.startHour + at / 60) % 24) + 24) % 24;
  return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
};

/** A person: a figure entity, and their mind. */
export function makeTownsfolk(id: number, slot: number, seed: number, places: Place[], at: { x: number; z: number }): { entity: Entity; mind: Mind } {
  const rand = rng(seed * 31 + slot);
  const name = NAMES[(slot + Math.floor(seed)) % NAMES.length];
  const traits = [TRAITS[Math.floor(rand() * TRAITS.length)], TRAITS[Math.floor(rand() * TRAITS.length)]].filter((t, i, all) => all.indexOf(t) === i);
  const home = { x: Math.cos(slot * 2.4) * (PLAZA_RADIUS - 1.2), z: Math.sin(slot * 2.4) * (PLAZA_RADIUS - 1.2) };
  const entity: Entity = {
    id,
    name,
    transform: { position: V3(at.x, 0.78 * 0.92, at.z), rotation: { ...IDENTITY }, scale: V3(0.92, 0.92, 0.92) },
    representation: { kind: "hybrid", meshId: "agent_body", gsId: "agent_detail" },
    physics: null,
    tags: ["agent", NPC_TAG],
    customData: {
      color: SKINS[Math.floor(rand() * SKINS.length)],
      suit: SUITS[Math.floor(rand() * SUITS.length)],
      role: "resident",
      yaw: String(rand() * Math.PI * 2),
      homeX: home.x.toFixed(2),
      homeZ: home.z.toFixed(2),
    },
  };
  return { entity, mind: { traits, plan: planDay(traits, places, seed * 7 + slot), memory: [], seen: [] } };
}

/** Where a person is headed now: an errand, else their plan's place (shelter in the rain), else home. */
export function goalOf(entity: Entity, mind: Mind, places: Place[], hour: number, raining: boolean): { place: string; x: number; z: number; doing: string } {
  const home = { x: Number(entity.customData.homeX) || 0, z: Number(entity.customData.homeZ) || 0 };
  if (mind.errand) {
    const p = placeByName(places, mind.errand);
    if (p) return { place: p.name, x: p.x, z: p.z, doing: "an errand" };
  }
  const step = stepNow(mind, hour);
  if (step.place === "home") return { place: "home", ...home, doing: step.doing };
  let p = placeByName(places, step.place);
  if (p && raining && p.outdoor) p = places.find((q) => !q.outdoor) ?? p;
  if (!p) return { place: "home", ...home, doing: step.doing };
  return { place: p.name, x: p.x, z: p.z, doing: raining && p.name !== step.place ? "keeping out of the rain" : step.doing };
}

// ---------- the crowd's steering ----------

export type Disc = { x: number; z: number; r: number; vx?: number; vz?: number; id?: number };
export const RADIUS = 0.32;

/** Seconds until two discs touch, moving at relative velocity (vx, vz); Infinity if they never do. */
export function timeToHit(dx: number, dz: number, vx: number, vz: number, r: number): number {
  // Solve |d + v t| = r for the first t >= 0.
  const a = vx * vx + vz * vz;
  const b = 2 * (dx * vx + dz * vz);
  const c = dx * dx + dz * dz - r * r;
  if (c < 0) return 0;
  if (a < 1e-9) return Infinity;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 ? t : Infinity;
}

/**
 * Sampled reciprocal velocity obstacles: of a fan of candidate velocities, take the one closest to the
 * preferred velocity, charged for how soon it would hit someone (each side takes half the turn, so two
 * people step aside instead of both stopping) or something.
 */
export function steer(self: Disc & { vx: number; vz: number }, pref: { x: number; z: number }, people: Disc[], solids: Disc[], maxSpeed: number): { x: number; z: number } {
  const candidates: { x: number; z: number }[] = [pref, { x: 0, z: 0 }];
  const prefAngle = Math.atan2(pref.z, pref.x);
  for (let i = 0; i < 16; i += 1) {
    const a = prefAngle + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 8;
    for (const k of [1, 0.55]) candidates.push({ x: Math.cos(a) * maxSpeed * k, z: Math.sin(a) * maxSpeed * k });
  }
  let best = candidates[0];
  let bestCost = Infinity;
  for (const v of candidates) {
    let ttc = Infinity;
    for (const o of people) {
      // Reciprocal: judge the move against the average of our velocity and theirs.
      const rvx = 2 * v.x - self.vx - (o.vx ?? 0);
      const rvz = 2 * v.z - self.vz - (o.vz ?? 0);
      ttc = Math.min(ttc, timeToHit(self.x - o.x, self.z - o.z, rvx, rvz, self.r + o.r));
    }
    for (const o of solids) ttc = Math.min(ttc, timeToHit(self.x - o.x, self.z - o.z, v.x, v.z, self.r + o.r));
    const cost = Math.hypot(v.x - pref.x, v.z - pref.z) + 1.6 / Math.max(ttc, 0.05);
    if (cost < bestCost) {
      bestCost = cost;
      best = v;
    }
  }
  return best;
}

/** Solid things people walk round: anything low enough to bump into, as a disc. */
export function solidsOf(world: Pick<World, "entities">): Disc[] {
  const out: Disc[] = [];
  for (const e of Object.values(world.entities)) {
    if (e.tags.includes(NPC_TAG) || e.tags.includes("architect") || e.tags.includes("helm") || e.tags.includes("floor") || e.tags.includes("worn")) continue;
    const p = e.transform.position;
    const s = e.transform.scale;
    if (p.y - s.y / 2 > 1.6 || p.y + s.y / 2 < 0.05) continue;
    if (s.x > 6 && s.z > 6) continue;
    out.push({ x: p.x, z: p.z, r: Math.min(2.5, Math.max(s.x, s.z) * 0.55) });
  }
  return out;
}

// ---------- one step of the town ----------

export type TownStep = { town: Town; bodies: Record<number, Body>; news: string[] };

export function bodyOf(e: Entity): Body {
  return { x: e.transform.position.x, z: e.transform.position.z, vx: 0, vz: 0, yaw: Number(e.customData.yaw) || 0, speed: 0, stuck: 0, detour: null, lastTalk: {} };
}

export function remember(mind: Mind, m: Memory): Mind {
  let memory = [...mind.memory, m];
  // Every dozen new things, sum up the oldest stretch in one reflection (the stream stays short).
  if (memory.length > 36) {
    const old = memory.slice(0, 14);
    const talks = old.filter((x) => x.kind === "talked").map((x) => x.text.replace(/^talked with (\w+).*/, "$1"));
    const places = old.filter((x) => x.kind === "went").map((x) => x.text.replace(/^went to /, "").replace(/ for .*/, ""));
    const top = (list: string[]) => {
      const n = new Map<string, number>();
      for (const v of list) n.set(v, (n.get(v) ?? 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([v, c]) => (c > 1 ? `${v} (${c} times)` : v));
    };
    const parts = [places.length ? `spent time at ${top(places).join(" and ")}` : "", talks.length ? `talked most with ${top(talks).join(" and ")}` : ""].filter(Boolean);
    const reflection: Memory = { at: old[old.length - 1].at, kind: "reflect", importance: 6, text: parts.length ? `Looking back: ${parts.join(", ")}.` : "Looking back: a quiet stretch." };
    memory = [reflection, ...memory.slice(14)];
  }
  return { ...mind, memory };
}

/**
 * Advance the town by dt real seconds. bodies: live positions by entity id (made from the entities
 * when missing). Returns the next town, bodies, and lines worth logging.
 */
export function stepTown(world: Pick<World, "entities" | "weather">, town: Town, bodies: Record<number, Body>, dt: number, places = placesOf(world), solids = solidsOf(world)): TownStep {
  const step = Math.min(dt, 0.1);
  const minutes = town.minutes + step;
  const next: Town = { ...town, minutes, minds: { ...town.minds } };
  const hour = hourOf(next);
  const raining = (world.weather?.rain ?? 0) > 0.2 || (world.weather?.snow ?? 0) > 0.5 || (world.weather?.storm ?? 0) > 0.3;
  const folk = Object.values(world.entities).filter((e) => e.tags.includes(NPC_TAG) && next.minds[e.id]);
  const out: Record<number, Body> = {};
  for (const e of folk) out[e.id] = bodies[e.id] ? { ...bodies[e.id] } : bodyOf(e);
  const me = Object.values(world.entities).find((e) => e.tags.includes("architect"));
  const news: string[] = [];

  for (const e of folk) {
    const b = out[e.id];
    let mind = next.minds[e.id];
    const goal = goalOf(e, mind, places, hour, raining);
    // Arrived somewhere new: remember it; an errand is done.
    const there = Math.hypot(goal.x - b.x, goal.z - b.z);
    const last = mind.memory[mind.memory.length - 1];
    if (there < 1.6 && !(last?.kind === "went" && last.text.startsWith(`went to ${goal.place}`))) {
      mind = remember(mind, { at: minutes, kind: "went", importance: 3, text: `went to ${goal.place} for ${goal.doing}` });
      if (mind.errand && goal.place.toLowerCase() === mind.errand.toLowerCase()) {
        news.push(`${e.name} got to ${goal.place}.`);
        mind = { ...mind, errand: undefined };
      }
    }
    // Something new nearby is worth a memory.
    const seen = new Set(mind.seen ?? []);
    for (const p of places) {
      if (seen.has(p.name) || p.name.startsWith("the ")) continue;
      if (Math.hypot(p.x - b.x, p.z - b.z) < 5) {
        seen.add(p.name);
        mind = remember(mind, { at: minutes, kind: "saw", importance: 4, text: `noticed ${/^[A-Z]/.test(p.name) ? p.name : `the ${p.name}`}` });
      }
    }
    if (seen.size !== (mind.seen ?? []).length) mind = { ...mind, seen: [...seen].slice(-40) };

    // Talk with a neighbour standing near, now and then.
    let talking = false;
    for (const o of folk) {
      if (o.id === e.id) continue;
      const ob = out[o.id];
      const d = Math.hypot(ob.x - b.x, ob.z - b.z);
      if (d < 1.7 && there < 3 && ob.speed < 0.4 && b.speed < 0.6) {
        talking = true;
        if (minutes - (b.lastTalk[o.id] ?? -1e9) > 45) {
          b.lastTalk = { ...b.lastTalk, [o.id]: minutes };
          const topic = mind.memory.slice().reverse().find((m) => m.kind === "saw")?.text.replace(/^noticed /, "") ?? (raining ? "the weather" : goal.doing);
          mind = remember(mind, { at: minutes, kind: "talked", importance: 5, text: `talked with ${o.name} about ${topic}` });
        }
        b.yaw = Math.atan2(ob.x - b.x, ob.z - b.z);
      }
    }
    next.minds[e.id] = mind;

    // Where to walk: the goal (or a detour round what blocked the way), slowing to stand.
    let tx = goal.x;
    let tz = goal.z;
    if (b.detour && minutes < b.detour.until) {
      tx = b.detour.x;
      tz = b.detour.z;
    } else b.detour = null;
    const dx = tx - b.x;
    const dz = tz - b.z;
    const dist = Math.hypot(dx, dz);
    // Spread out where people gather: each stands on their own spot round the goal.
    const settle = 0.9 + (e.id % 5) * 0.25;
    const pace = (Number(e.id % 3) * 0.12 + 1.15) * (goal.doing.includes("jog") ? 2 : 1);
    const want = dist > settle ? Math.min(pace, (dist - settle) * 1.2 + 0.2) : 0;
    const pref = dist > 1e-6 ? { x: (dx / dist) * want, z: (dz / dist) * want } : { x: 0, z: 0 };
    const people: Disc[] = [];
    for (const o of folk) {
      if (o.id === e.id) continue;
      const ob = out[o.id];
      if (Math.abs(ob.x - b.x) < 5 && Math.abs(ob.z - b.z) < 5) people.push({ x: ob.x, z: ob.z, r: RADIUS, vx: ob.vx, vz: ob.vz });
    }
    if (me) people.push({ x: me.transform.position.x, z: me.transform.position.z, r: RADIUS + 0.1, vx: 0, vz: 0 });
    const near = solids.filter((s) => Math.abs(s.x - b.x) < 5 + s.r && Math.abs(s.z - b.z) < 5 + s.r);
    const v = want > 0 ? steer({ x: b.x, z: b.z, r: RADIUS, vx: b.vx, vz: b.vz }, pref, people, near, pace) : { x: 0, z: 0 };
    const k = 1 - Math.exp(-step * 6);
    b.vx += (v.x - b.vx) * k;
    b.vz += (v.z - b.vz) * k;
    b.x += b.vx * step;
    b.z += b.vz * step;
    // Never inside a solid: pushed back out to its edge.
    for (const s of near) {
      const ox = b.x - s.x;
      const oz = b.z - s.z;
      const d = Math.hypot(ox, oz);
      if (d < s.r + RADIUS && d > 1e-6) {
        b.x = s.x + (ox / d) * (s.r + RADIUS);
        b.z = s.z + (oz / d) * (s.r + RADIUS);
      }
    }
    b.speed = Math.hypot(b.vx, b.vz);
    if (b.speed > 0.15 && !talking) b.yaw = Math.atan2(b.vx, b.vz);
    // Replan when stuck: wanting to move, getting nowhere, for a couple of seconds.
    b.stuck = want > 0.3 && b.speed < want * 0.25 ? b.stuck + step : Math.max(0, b.stuck - step);
    if (b.stuck > 2 && !b.detour) {
      const side = e.id % 2 ? 1 : -1;
      const px = -dz / Math.max(dist, 1e-6);
      const pz = dx / Math.max(dist, 1e-6);
      b.detour = { x: b.x + (px * side * 2.2 + dx / Math.max(dist, 1e-6)) , z: b.z + (pz * side * 2.2 + dz / Math.max(dist, 1e-6)), until: minutes + 2.5 };
      b.stuck = 0;
    }
  }
  return { town: next, bodies: out, news };
}

// ---------- tools ----------

export function townOf(world: Pick<World, "town">): Town | null {
  return world.town ?? null;
}

/** fill_town: add count people (default 8), spread round the plaza or a named place. */
export function fillTown(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const have = Object.values(world.entities).filter((e) => e.tags.includes(NPC_TAG)).length;
  const asked = Math.max(1, Math.min(MAX_TOWNSFOLK, Math.floor(Number(args.count) || 8)));
  const count = Math.min(asked, MAX_TOWNSFOLK - have);
  if (count <= 0) return { ok: false, detail: `the town is full (${MAX_TOWNSFOLK} people)`, world };
  const places = placesOf(world);
  const where = args.place ? placeByName(places, args.place) ?? places.find((p) => p.name.toLowerCase().includes(args.place!.toLowerCase())) : null;
  const town: Town = world.town ?? { minutes: 0, startHour: world.weather?.hour ?? 16.5, minds: {} };
  const minds = { ...town.minds };
  const entities = { ...world.entities };
  let nextId = world.nextId;
  const names: string[] = [];
  const seed = Number(args.seed) || nextId * 13 + have;
  for (let i = 0; i < count; i += 1) {
    const slot = have + i;
    const a = slot * 2.399963;
    const r = 2.2 + (slot % 4) * 1.1;
    const at = where ? { x: where.x + Math.cos(a) * r * 0.6, z: where.z + Math.sin(a) * r * 0.6 } : { x: Math.cos(a) * Math.min(PLAZA_RADIUS - 2, r + 3), z: Math.sin(a) * Math.min(PLAZA_RADIUS - 2, r + 3) };
    const made = makeTownsfolk(nextId, slot, seed, places, at);
    // A regular of a place starts the day there.
    if (where) made.mind.plan = made.mind.plan.map((s, k) => (k === 2 || k === 3 ? { ...s, place: where.name } : s));
    made.mind.memory = [{ at: town.minutes, kind: "plan", importance: 2, text: `planned the day: ${made.mind.plan.slice(1, 5).map((s) => `${s.doing} at ${s.place}`).join(", ")}` }];
    entities[nextId] = made.entity;
    minds[nextId] = made.mind;
    names.push(made.entity.name);
    nextId += 1;
  }
  return {
    ok: true,
    detail: `${count} ${count === 1 ? "person arrives" : "people arrive"}${where ? ` at ${where.name}` : ""}: ${names.join(", ")}. Each has a plan for the day and remembers it; ask "what did ${names[0]} do today?"`,
    world: { ...world, entities, nextId, town: { ...town, minds } },
  };
}

function personByName(world: World, name: string): Entity | null {
  const key = name.trim().toLowerCase();
  return Object.values(world.entities).find((e) => e.tags.includes(NPC_TAG) && e.name.toLowerCase() === key) ?? null;
}

/** ask_town: what someone did today, what they are doing, or who is about. Read only. */
export function askTown(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const town = world.town;
  if (!town) return { ok: false, detail: 'nobody lives here yet; say "fill the plaza with people"', world };
  if (!args.name?.trim()) {
    const folk = Object.values(world.entities).filter((e) => e.tags.includes(NPC_TAG));
    return { ok: true, detail: `It is ${clock(town, town.minutes)}. ${folk.length} people: ${folk.map((e) => `${e.name} (${goalOf(e, town.minds[e.id] ?? { traits: [], plan: [], memory: [] }, placesOf(world), hourOf(town), false).doing})`).join(", ")}.`, world };
  }
  const who = personByName(world, args.name);
  const mind = who ? town.minds[who.id] : undefined;
  if (!who || !mind) return { ok: false, detail: `nobody here is called ${args.name}`, world };
  const today = dayOf(town);
  const sinceMidnight = (today * 1440 - town.startHour * 60);
  const events = mind.memory.filter((m) => m.at >= sinceMidnight || mind.memory.length < 6);
  const step = stepNow(mind, hourOf(town));
  const lines = events.slice(-8).map((m) => `${clock(town, m.at)} ${m.text}`);
  return {
    ok: true,
    detail: `${who.name} (${mind.traits.join(", ")}) is ${mind.errand ? `on an errand to ${mind.errand}` : `${step.doing} at ${step.place}`}. Today: ${lines.length ? lines.join("; ") : "nothing yet"}.`,
    world,
  };
}

/** send_npc: send someone (or everyone) to a place, or home. */
export function sendTownsfolk(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const town = world.town;
  if (!town) return { ok: false, detail: "nobody lives here yet", world };
  const places = placesOf(world);
  const target = (args.place ?? "").trim();
  const home = /^(home|bed)$/i.test(target);
  const place = home ? null : placeByName(places, target) ?? places.find((p) => p.name.toLowerCase().includes(target.toLowerCase()) && target.length > 2) ?? null;
  if (!home && !place) return { ok: false, detail: `no place called ${target}; try ${places.slice(0, 6).map((p) => p.name).join(", ")}`, world };
  const everyone = /^(everyone|everybody|all|\*)$/i.test((args.name ?? "").trim());
  const folk = everyone ? Object.values(world.entities).filter((e) => e.tags.includes(NPC_TAG)) : [personByName(world, args.name ?? "")].filter((e): e is Entity => !!e);
  if (!folk.length) return { ok: false, detail: `nobody here is called ${args.name}`, world };
  const minds = { ...town.minds };
  for (const e of folk) {
    const mind = minds[e.id];
    if (!mind) continue;
    if (home) {
      const now = hourOf(town);
      minds[e.id] = { ...mind, errand: undefined, plan: [...mind.plan.filter((s) => s.from <= now), { from: now, place: "home", doing: "heading home" }].sort((a, b) => a.from - b.from) };
    } else minds[e.id] = { ...mind, errand: place!.name };
    minds[e.id] = remember(minds[e.id], { at: town.minutes, kind: "plan", importance: 5, text: `was asked to go to ${home ? "home" : place!.name}` });
  }
  return { ok: true, detail: `${everyone ? "Everyone heads" : `${folk[0].name} heads`} to ${home ? "home" : place!.name}.`, world: { ...world, town: { ...town, minds } } };
}

/** Saved towns are checked on load. */
export function cleanTown(value: unknown, entities: Record<number, Entity>): Town | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Town;
  const minutes = Number(raw.minutes);
  const startHour = Number(raw.startHour);
  if (!Number.isFinite(minutes) || !Number.isFinite(startHour) || !raw.minds || typeof raw.minds !== "object") return undefined;
  const minds: Record<number, Mind> = {};
  for (const [key, mind] of Object.entries(raw.minds)) {
    const id = Number(key);
    if (!entities[id] || !mind || !Array.isArray(mind.plan) || !Array.isArray(mind.memory)) continue;
    minds[id] = {
      traits: Array.isArray(mind.traits) ? mind.traits.filter((t) => typeof t === "string").slice(0, 4) : [],
      plan: mind.plan.filter((s) => s && typeof s.place === "string" && Number.isFinite(s.from)).slice(0, 16),
      memory: mind.memory.filter((m) => m && typeof m.text === "string" && Number.isFinite(m.at)).slice(-40),
      ...(typeof mind.errand === "string" ? { errand: mind.errand } : {}),
      seen: Array.isArray(mind.seen) ? mind.seen.filter((s) => typeof s === "string").slice(-40) : [],
    };
  }
  return { minutes: Math.max(0, minutes), startHour: ((startHour % 24) + 24) % 24, minds };
}

// ---------- instant commands ----------

export type TownCall = { tool: "fill_town" | "ask_town" | "send_npc" | "delete_entity"; arguments: Record<string, string> };

const COUNTS: Record<string, number> = { a: 1, one: 1, two: 2, couple: 2, three: 3, few: 4, four: 4, five: 5, six: 6, some: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12, lots: 14, crowd: 14, many: 14 };

/**
 * "fill the plaza with people", "fill the café with regulars", "add 5 people", "what did Mia do
 * today?", "where is Leo", "who is here", "send Mia to the bench", "everyone go home".
 */
export function townIntent(intent: string, world: World): TownCall | null {
  const text = intent.trim().toLowerCase().replace(/[’'?!.]/g, "").replace(/\s+/g, " ");
  const folk = Object.values(world.entities).filter((e) => e.tags.includes(NPC_TAG));
  const crowdWord = "(people|regulars|crowd|folks|townsfolk|townspeople|locals|villagers|npcs|residents|visitors|neighbours|neighbors|a crowd)";
  const fill = text.match(new RegExp(`^(?:please\\s+)?(?:fill|populate|pack)\\s+(?:up\\s+)?(?:the\\s+)?(.+?)\\s+with\\s+(?:(\\w+)\\s+)?${crowdWord}$`));
  if (fill) {
    const where = fill[1].trim();
    const count = fill[2] ? (COUNTS[fill[2]] ?? (Number(fill[2]) || 8)) : 8;
    const isPlaza = /^(plaza|square|lab|world|place|town|area)$/.test(where);
    return { tool: "fill_town", arguments: { count: String(count), ...(isPlaza ? {} : { place: where }) } };
  }
  const add = text.match(new RegExp(`^(?:please\\s+)?(?:add|spawn|bring|bring in|invite|make)\\s+(?:in\\s+)?(\\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|a few|some|a dozen|lots of|a couple of)?\\s*(?:more\\s+)?${crowdWord}(?:\\s+(?:to|at|in)\\s+(?:the\\s+)?(.+))?$`));
  if (add) {
    const word = (add[1] ?? "some").replace(/^a (few|dozen|couple of)$/, "$1").replace(/ of$/, "").replace(/^lots$/, "lots");
    const count = /^\d+$/.test(word) ? Number(word) : add[2] === "a crowd" ? 14 : (COUNTS[word] ?? 6);
    return { tool: "fill_town", arguments: { count: String(count), ...(add[3] && !/^(plaza|square)$/.test(add[3]) ? { place: add[3] } : {}) } };
  }
  if (!folk.length) return null;
  if (/^(who is (here|around|in town)|whos (here|around)|how is (the )?town|what is everyone doing|whats everyone doing|what are (the )?people doing)$/.test(text)) return { tool: "ask_town", arguments: {} };
  const named = folk.find((e) => new RegExp(`(^|[^a-z])${e.name.toLowerCase()}([^a-z]|$)`).test(text));
  if (/^(everyone|everybody|all of you)\b.*\b(go home|home|to bed)\b/.test(text) || /^send everyone home$/.test(text)) return { tool: "send_npc", arguments: { name: "everyone", place: "home" } };
  const everyoneTo = text.match(/^(?:everyone|everybody|send everyone)\s+(?:go\s+)?to\s+(?:the\s+)?(.+)$/);
  if (everyoneTo) return { tool: "send_npc", arguments: { name: "everyone", place: everyoneTo[1] } };
  if (/^(clear|remove|delete|send away|get rid of)\b.*\b(people|crowd|townsfolk|npcs|everyone|town)$/.test(text)) return { tool: "delete_entity", arguments: { id: folk.map((e) => e.id).join(",") } };
  if (!named) return null;
  const name = named.name;
  if (/\b(what did|what has|how was|tell me about|what is|whats|where is|wheres|how is|hows|what does|what are)\b/.test(text)) return { tool: "ask_town", arguments: { name } };
  const send = text.match(new RegExp(`(?:send\\s+${name.toLowerCase()}\\s+to|tell\\s+${name.toLowerCase()}\\s+to\\s+go\\s+to|${name.toLowerCase()},?\\s+(?:please\\s+)?go\\s+to|ask\\s+${name.toLowerCase()}\\s+to\\s+go\\s+to)\\s+(?:the\\s+)?(.+)$`));
  if (send) return { tool: "send_npc", arguments: { name, place: send[1].trim() } };
  if (new RegExp(`(send|tell)\\s+${name.toLowerCase()}\\s+(to go\\s+)?home|${name.toLowerCase()},?\\s+go home`).test(text)) return { tool: "send_npc", arguments: { name, place: "home" } };
  return null;
}
