/**
 * A companion that does what you ask (after SIMA: instructions in, a plan of small skills out, run
 * against the world's own state rather than pixels). "Follow me", "wait here", "come here",
 * "go to the bench", "bring me the gold", "put the clay on the bench", "stack the cubes here".
 *
 *   readOrders     words to a queue of tasks (no model needed); the resident model can fill in
 *                  with companionPrompt when the words are not understood, answering in the same
 *                  little language, which readOrders then reads.
 *   stepCompanion  one frame: walk (with the walker's physics), pick things up, carry them over
 *                  the head, set them down, stack them, report back.
 *   summon         a companion beside you.
 */
import type { Entity, Vec3, World } from "./types.ts";
import { IDENTITY, V3 } from "./types.ts";
import { solidOf, solidsFor, stepWalk, WALK, groundAt, type Solid } from "./physics.ts";

export const COMPANION_TAG = "companion";
const SPEED = 3.1;
const CLOSE = 0.75;

export type Task =
  | { kind: "follow" }
  | { kind: "wait" }
  | { kind: "go"; to: Target }
  | { kind: "fetch"; thing: number; to: Target }
  | { kind: "say"; text: string };

/** Where to go: you (live), a point, or a thing (beside it). */
export type Target = { me: true } | { at: { x: number; z: number } } | { thing: number };

export type CompanionState = {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  yaw: number;
  /** What it carries (an entity id), over its head. */
  held: number | null;
  queue: Task[];
  /** What it last said, and for how long more it shows. */
  said: string;
  sayFor: number;
  /** How long it has made no progress (to step round things). */
  stuck: number;
};

const NAMES_OK = (e: Entity) =>
  !e.tags.some((t) => ["architect", "helm", "floor", "fixture", "agent", "npc", COMPANION_TAG, "rope", "flag", "presence", "visitor", "device-screen", "tv", "tetris", "marble", "blocks", "breakout"].includes(t));

/** Things small enough to carry: up to about a metre across. */
export function carriable(e: Entity): boolean {
  if (!NAMES_OK(e)) return false;
  const s = solidOf(e);
  if (!s) return false;
  return s.max.x - s.min.x <= 1.2 && s.max.y - s.min.y <= 1.2 && s.max.z - s.min.z <= 1.2;
}

const clean = (t: string) => t.trim().toLowerCase().replace(/^(the|a|an|my|some|all( of)?( the)?)\s+/, "").replace(/[.!?]+$/, "");

/** Things matching a word: a name ("gold"), a kind ("cubes", "balls", "spheres"), or "everything". */
export function thingsCalled(world: World, words: string): Entity[] {
  const q = clean(words);
  const list = Object.values(world.entities).filter(carriable);
  if (!q) return [];
  const named = list.filter((e) => e.name.toLowerCase() === q || e.name.toLowerCase() === q.replace(/s$/, ""));
  if (named.length) return named;
  const kind = q.replace(/s$/, "").replace(/^(box|boxe|crate|block)$/, "cube").replace(/^(ball|orb)$/, "sphere");
  const byKind = list.filter((e) => e.representation.kind === "mesh" && e.representation.assetId === kind);
  if (byKind.length) return byKind;
  if (/^(everything|things|stuff|it all)$/.test(q)) return list;
  return list.filter((e) => e.name.toLowerCase().includes(q) && q.length > 2);
}

function thingNamed(world: World, words: string): Entity | null {
  const q = clean(words);
  if (!q) return null;
  const all = Object.values(world.entities).filter((e) => !e.tags.includes("helm") && !e.tags.includes(COMPANION_TAG));
  return all.find((e) => e.name.toLowerCase() === q) ?? all.find((e) => e.name.toLowerCase().startsWith(q)) ?? all.find((e) => q.length > 2 && e.name.toLowerCase().includes(q)) ?? null;
}

/** "here" (in front of you), "by/on the bench", "there". */
function placeFrom(world: World, words: string | undefined, me: Vec3, yaw: number): Target | null {
  const w = (words ?? "").trim().toLowerCase();
  if (!w || /^(here|over here|in front of me|by me|to me|me)$/.test(w)) return { at: { x: me.x + Math.sin(yaw) * 1.3, z: me.z + Math.cos(yaw) * 1.3 } };
  const thing = thingNamed(world, w.replace(/^(by|on|next to|beside|near|onto|on top of|at|to|in front of)\s+/, ""));
  return thing ? { thing: thing.id } : null;
}

export type Orders = { tasks: Task[]; reply: string } | null;

/** Words to tasks. Several instructions can be joined with "and" or "then". */
export function readOrders(text: string, world: World, me: Vec3, yaw: number): Orders {
  const tasks: Task[] = [];
  const replies: string[] = [];
  const parts = text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/\b(?:and then|then|and|,)\b/)
    .map((s) => s.trim().replace(/^(please|can you|could you|hey|buddy|companion)\s+/g, ""))
    .filter(Boolean);
  for (const part of parts) {
    let m: RegExpMatchArray | null;
    if (/^(follow( me)?|come with me|stay with me|keep up)\b/.test(part)) {
      tasks.push({ kind: "follow" });
      replies.push("Right behind you.");
    } else if (/^(wait|stay|stop|hold on|stay (here|put))\b/.test(part)) {
      tasks.push({ kind: "wait" });
      replies.push("I'll wait here.");
    } else if (/^(come( here| back)?|to me|over here)\b/.test(part)) {
      tasks.push({ kind: "go", to: { me: true } });
      replies.push("Coming!");
    } else if ((m = part.match(/^(?:go|walk|run|head)\s+(?:to|over to)?\s*(.+)$/))) {
      const to = placeFrom(world, m[1], me, yaw);
      if (!to) return null;
      tasks.push({ kind: "go", to });
      replies.push("On my way.");
    } else if ((m = part.match(/^(?:bring|fetch|get|grab)(?: me)?\s+(.+?)(?:\s+(?:to|here|over here))?$/))) {
      const things = thingsCalled(world, m[1]);
      if (!things.length) return { tasks: [], reply: `I can't find ${clean(m[1])} I can carry.` };
      tasks.push({ kind: "fetch", thing: things[0].id, to: { me: true } });
      replies.push(`Getting the ${things[0].name}.`);
    } else if ((m = part.match(/^(?:stack|pile|gather|collect|put|move|carry|take)\s+(.+?)\s+(here|over here|in front of me|(?:by|on|next to|beside|near|onto|on top of|at|to)\s+.+)$/))) {
      const things = thingsCalled(world, m[1]);
      const to = placeFrom(world, m[2], me, yaw);
      if (!things.length) return { tasks: [], reply: `I can't find ${clean(m[1])} I can carry.` };
      if (!to) return { tasks: [], reply: `Where is ${m[2].replace(/^(by|on|next to|beside|near|onto|on top of|at|to)\s+/, "")}?` };
      // A stack lands in one spot: fix it now, so "here" means where you stood when you asked.
      const spot = "thing" in to ? to : to;
      for (const t of things.slice(0, 8)) tasks.push({ kind: "fetch", thing: t.id, to: spot });
      replies.push(things.length > 1 ? `Stacking ${things.length} of them.` : `Moving the ${things[0].name}.`);
    } else return null;
  }
  if (!tasks.length) return null;
  return { tasks, reply: replies.join(" ") };
}

/** The prompt for the resident model when readOrders cannot read the words. */
export function companionPrompt(text: string, world: World): string {
  const things = Object.values(world.entities)
    .filter(carriable)
    .slice(0, 24)
    .map((e) => e.name)
    .join(", ");
  const places = Object.values(world.entities)
    .filter((e) => e.tags.includes("fixture") || e.tags.includes("exhibit"))
    .slice(0, 16)
    .map((e) => e.name)
    .join(", ");
  return [
    "You command a helpful companion robot in a small world. Rewrite the request as short commands, one per line, using only:",
    "follow me | wait | come here | go to <place> | bring me <thing> | stack <things> here | put <thing> on <place>",
    `Things it can carry: ${things || "none"}. Places: ${places || "none"}.`,
    `Request: "${text.slice(0, 200)}"`,
    "Commands:",
  ].join("\n");
}

/** Turn a model's commands back into one line readOrders understands. */
export function ordersFromModel(text: string): string {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((l) => /^(follow|wait|come|go|bring|stack|put)\b/i.test(l))
    .slice(0, 6)
    .join(" then ");
}

// ---------- the companion in the world ----------

export function companionOf(world: Pick<World, "entities">): Entity | undefined {
  return Object.values(world.entities).find((e) => e.tags.includes(COMPANION_TAG));
}

/** summon_companion: a companion appears beside you, following. */
export function summon(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const existing = companionOf(world);
  const me = Object.values(world.entities).find((e) => e.tags.includes("architect"));
  const p = me?.transform.position ?? { x: 0, y: 0.78, z: 0 };
  const yaw = Number(me?.customData.yaw) || 0;
  if (existing) return { ok: true, detail: `${existing.name} is already here.`, world };
  const id = world.nextId;
  const name = args.name?.trim() || "Pip";
  const entity: Entity = {
    id,
    name,
    transform: { position: V3(p.x + Math.cos(yaw) * 1.1, p.y, p.z - Math.sin(yaw) * 1.1), rotation: { ...IDENTITY }, scale: V3(0.85, 0.85, 0.85) },
    representation: { kind: "hybrid", meshId: "agent_body", gsId: "agent_detail" },
    physics: null,
    tags: ["agent", COMPANION_TAG],
    customData: { color: "#7afcff", suit: "#2a1d4f", role: "companion", yaw: String(yaw) },
  };
  return {
    ok: true,
    detail: `${name} appears beside you. Ask: "follow me", "bring me the gold", "stack the cubes here", "wait here".`,
    world: { ...world, entities: { ...world.entities, [id]: entity }, nextId: id + 1 },
  };
}

/** order_companion: tell the companion what to do, in words (it reads them with readOrders). */
export function orderCompanion(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  let w = world;
  let note = "";
  if (!companionOf(w)) {
    const made = summon(w, {});
    w = made.world;
    note = `${companionOf(w)!.name} appears beside you. `;
  }
  const self = companionOf(w)!;
  const me = Object.values(w.entities).find((e) => e.tags.includes("architect"));
  const orders = readOrders(args.words ?? "", w, me?.transform.position ?? { x: 0, y: 0.78, z: 0 }, Number(me?.customData.yaw) || 0);
  if (!orders) return { ok: false, detail: `${self.name} doesn't understand "${args.words ?? ""}"`, world };
  if (!orders.tasks.length) return { ok: false, detail: `${self.name}: ${orders.reply}`, world };
  const seq = String((Number(self.customData.orderSeq) || 0) + 1);
  const next = { ...self, customData: { ...self.customData, orders: JSON.stringify(orders.tasks), orderSeq: seq, reply: orders.reply } };
  return { ok: true, detail: `${note}${self.name}: ${orders.reply}`, world: { ...w, entities: { ...w.entities, [self.id]: next } } };
}

/** Saved orders back to tasks (anything malformed is dropped). */
export function ordersOf(e: Entity): Task[] {
  try {
    const parsed = JSON.parse(e.customData.orders || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is Task => !!t && typeof t === "object" && ["follow", "wait", "go", "fetch", "say"].includes((t as Task).kind)).slice(0, 12);
  } catch {
    return [];
  }
}

/** Plain requests that are orders for the companion (or summon one). */
export function companionIntent(text: string, world: World): { tool: "summon_companion" | "order_companion"; arguments: Record<string, string> } | null {
  const t = text.trim().toLowerCase();
  if (/^(summon|call|get|give me|make)\s+(a |my )?(companion|buddy|helper|sidekick|robot friend)\b/.test(t)) return { tool: "summon_companion", arguments: {} };
  const self = companionOf(world);
  const name = self?.name.toLowerCase();
  const addressed = name && t.startsWith(`${name}`) ? t.slice(name.length).replace(/^[,:\s]+/, "") : t;
  const me = Object.values(world.entities).find((e) => e.tags.includes("architect"));
  const orders = readOrders(addressed, world, me?.transform.position ?? { x: 0, y: 0.78, z: 0 }, Number(me?.customData.yaw) || 0);
  if (!orders) return null;
  // "Go to the bench" alone could be for you; only take it when there is a companion.
  if (!self && orders.tasks.every((task) => task.kind === "go" || task.kind === "wait")) return null;
  return { tool: "order_companion", arguments: { words: addressed } };
}

export function freshState(e: Entity): CompanionState {
  const p = e.transform.position;
  return { x: p.x, y: p.y, z: p.z, vy: 0, grounded: true, yaw: Number(e.customData.yaw) || 0, held: null, queue: [{ kind: "follow" }], said: "", sayFor: 0, stuck: 0 };
}

/** Feet below the figure's position, for its scale. */
const FOOT = WALK.foot * 0.85;

function targetPoint(world: World, t: Target, me: Vec3, from: { x: number; z: number }): { x: number; z: number } | null {
  if ("me" in t) return { x: me.x, z: me.z };
  if ("at" in t) return t.at;
  const e = world.entities[t.thing];
  if (!e) return null;
  // Beside it, on the side facing the companion.
  const s = solidOf(e);
  const p = e.transform.position;
  const half = s ? Math.max(s.max.x - s.min.x, s.max.z - s.min.z) / 2 : 0.3;
  const dx = from.x - p.x;
  const dz = from.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: p.x + (dx / d) * (half + 0.45), z: p.z + (dz / d) * (half + 0.45) };
}

/** Where a carried thing is set down at a target: on top of whatever is already there. */
export function dropSpot(world: World, t: Target, me: Vec3, yaw: number, thing: Entity, solids: Solid[]): Vec3 {
  let x: number;
  let z: number;
  if ("me" in t) {
    x = me.x + Math.sin(yaw) * 1.1;
    z = me.z + Math.cos(yaw) * 1.1;
  } else if ("at" in t) {
    x = t.at.x;
    z = t.at.z;
  } else {
    const e = world.entities[t.thing];
    x = e?.transform.position.x ?? me.x;
    z = e?.transform.position.z ?? me.z;
  }
  const half = Math.abs(thing.transform.scale.y) / 2;
  const hx = Math.abs(thing.transform.scale.x) / 2;
  const hz = Math.abs(thing.transform.scale.z) / 2;
  let top = groundAt(x, z);
  for (const s of solids) {
    if (s.id === thing.id) continue;
    if (s.min.x < x + hx && s.max.x > x - hx && s.min.z < z + hz && s.max.z > z - hz) top = Math.max(top, s.max.y);
  }
  return { x, y: top + half + 0.002, z };
}

export type CompanionStep = { state: CompanionState; moved: { id: number; position: Vec3 }[]; done: string | null };

/** One frame of the companion. `me` is your body's position and facing. */
export function stepCompanion(world: World, self: Entity, s: CompanionState, me: Vec3, myYaw: number, dt: number): CompanionStep {
  const state = { ...s, queue: [...s.queue] };
  const moved: CompanionStep["moved"] = [];
  let done: string | null = null;
  state.sayFor = Math.max(0, state.sayFor - dt);
  const task = state.queue[0] ?? { kind: "follow" as const };
  const solids = solidsFor(world.entities).filter((x) => x.id !== state.held && x.id !== self.id);
  let goal: { x: number; z: number } | null = null;
  let stopAt = CLOSE;
  if (task.kind === "follow") {
    goal = { x: me.x - Math.sin(myYaw) * 1.3 + Math.cos(myYaw) * 0.6, z: me.z - Math.cos(myYaw) * 1.3 - Math.sin(myYaw) * 0.6 };
    stopAt = 0.35;
  } else if (task.kind === "go") {
    goal = targetPoint(world, task.to, me, state);
    if ("me" in task.to) stopAt = 1.2;
  } else if (task.kind === "fetch") {
    const thing = world.entities[task.thing];
    if (!thing) {
      state.queue.shift();
      state.held = null;
      return { state, moved, done: "It's gone." };
    }
    if (state.held !== task.thing) {
      goal = targetPoint(world, { thing: task.thing }, me, state);
      stopAt = 0.3;
    } else {
      const spot = dropSpot(world, task.to, me, myYaw, thing, solids);
      const dx = spot.x - state.x;
      const dz = spot.z - state.z;
      const d = Math.hypot(dx, dz) || 1;
      // Stand just short of the spot, facing it.
      goal = { x: spot.x - (dx / d) * 0.85, z: spot.z - (dz / d) * 0.85 };
      stopAt = 0.25;
    }
  } else if (task.kind === "say") {
    state.said = task.text;
    state.sayFor = 3;
    state.queue.shift();
  }

  // Walk toward the goal, with the walker's physics (walls, steps, gravity).
  let vx = 0;
  let vz = 0;
  if (goal) {
    const dx = goal.x - state.x;
    const dz = goal.z - state.z;
    const d = Math.hypot(dx, dz);
    if (d > stopAt) {
      const pace = Math.min(SPEED, d * 2.2 + 0.4) * (task.kind === "follow" && d > 4 ? 1.6 : 1);
      vx = (dx / d) * pace;
      vz = (dz / d) * pace;
      if (state.stuck > 0.6) {
        // Blocked: step round it, to the side that gets closer.
        const side = Math.sin(state.stuck * 2) > 0 ? 1 : -1;
        vx = (-dz / d) * pace * side * 0.9 + vx * 0.3;
        vz = (dx / d) * pace * side * 0.9 + vz * 0.3;
      }
      const want = Math.atan2(vx, vz);
      const turn = Math.atan2(Math.sin(want - state.yaw), Math.cos(want - state.yaw));
      state.yaw += Math.max(-dt * 8, Math.min(dt * 8, turn));
    } else {
      // Arrived.
      if (task.kind === "go") {
        state.queue.shift();
        done = "Here!";
      } else if (task.kind === "fetch") {
        const thing = world.entities[task.thing]!;
        if (state.held !== task.thing) {
          state.held = task.thing;
          done = null;
        } else {
          const spot = dropSpot(world, task.to, me, myYaw, thing, solids);
          moved.push({ id: thing.id, position: spot });
          state.held = null;
          state.queue.shift();
          const more = state.queue.some((t) => t.kind === "fetch");
          done = more ? null : "Done!";
        }
      }
      if (task.kind !== "follow" && goal) state.yaw = Math.atan2(goal.x - state.x, goal.z - state.z) || state.yaw;
    }
  }
  const walked = stepWalk({ x: state.x, y: state.y - FOOT, z: state.z, vy: state.vy, grounded: state.grounded }, { vx, vz, jump: false, fly: null }, solids, dt);
  const progress = Math.hypot(walked.state.x - state.x, walked.state.z - state.z);
  state.stuck = vx || vz ? (progress < Math.hypot(vx, vz) * dt * 0.3 ? state.stuck + dt : Math.max(0, state.stuck - dt * 2)) : 0;
  state.x = walked.state.x;
  state.y = walked.state.y + FOOT;
  state.z = walked.state.z;
  state.vy = walked.state.vy;
  state.grounded = walked.state.grounded;
  if (state.held != null) {
    const thing = world.entities[state.held];
    if (thing) moved.push({ id: thing.id, position: { x: state.x, y: state.y + 0.62 + Math.abs(thing.transform.scale.y) / 2, z: state.z } });
  }
  // Nothing left to do: back to your side.
  if (!state.queue.length) state.queue.push({ kind: "follow" });
  if (done) {
    state.said = done;
    state.sayFor = 2.5;
  }
  return { state, moved, done };
}
