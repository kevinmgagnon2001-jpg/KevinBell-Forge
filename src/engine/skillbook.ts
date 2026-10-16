/**
 * The skill library, after Voyager (an agent that keeps every program that worked as a named skill,
 * and builds new ones out of old ones). Here a skill is a short program of tool calls:
 *
 *   - Every change that works is remembered (`World.recent`, the last few calls and what each made).
 *   - "Do that again, but taller", "another one, red, to the left", "again 3 times" re-runs the last
 *     change with tweaks; copies go to the next free spot instead of on top of each other.
 *   - "Remember the last 3 things as campfire" keeps them as a skill. Steps that changed something an
 *     earlier step made refer to it by position (@0, @1, ...), so the skill works on its new copies.
 *   - "Campfire", "build a campfire, but bigger" runs it in front of you. A model can also call a
 *     skill by name like any tool, with arguments that override the ones it was saved with.
 *
 * Skills are saved with the world, shared with linked devices, and undone like any change.
 */
import { normalizeColor, NAMED_COLORS } from "./color.ts";
import { toolByName } from "./os.ts";
import type { Entity, Skill, World } from "./types.ts";

export type RecentCall = {
  tool: string;
  args: Record<string, string>;
  /** Entities this call made (new ids). */
  made: number[];
};

export const MAX_RECENT = 10;
export const MAX_SKILLS = 24;

/** Calls that change nothing worth repeating, or are about skills themselves. */
const UNREPEATABLE = new Set(["undo", "query_scene", "define_skill", "repeat", "save_skill", "list_skills", "sandbox_list", "sandbox_read", "deck_bridge", "compat_map", "play_move"]);
/** Builders that place a whole fixed layout: repeated as they are, never moved about. */
const FIXED = new Set(["build_play", "build_gauge_rig", "place_portal", "apply_method"]);

/** Remember a call that worked, and what it made. */
export function noteCall(before: World, after: World, tool: string, args: Record<string, string>): World {
  if (UNREPEATABLE.has(tool)) return after;
  const made: number[] = [];
  for (let id = before.nextId; id < after.nextId; id += 1) if (after.entities[id]) made.push(id);
  const recent = [...(after.recent ?? []), { tool, args, made }].slice(-MAX_RECENT);
  return { ...after, recent };
}

export function cleanRecent(value: unknown): RecentCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is RecentCall => !!row && typeof row === "object" && typeof (row as RecentCall).tool === "string" && !!(row as RecentCall).args && typeof (row as RecentCall).args === "object")
    .map((row) => ({
      tool: row.tool,
      args: Object.fromEntries(Object.entries(row.args).filter(([, v]) => typeof v === "string")),
      made: Array.isArray(row.made) ? row.made.filter((id) => Number.isSafeInteger(id)) : [],
    }))
    .slice(-MAX_RECENT);
}

// ---------- tweaks ----------

export type Tweak = {
  /** Multiply the size by this, per axis. */
  scale: [number, number, number] | null;
  color: string | null;
  /** Where copies go, seen from you. */
  side: "left" | "right" | "front" | "back" | null;
  /** Raise (m). */
  up: number;
  times: number;
};

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/** Read "taller, red, to the left, 3 times" (any order, any of them). */
export function readTweak(text: string): Tweak {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ")} `;
  const much = /\b(much|way|a lot|really|very|twice as)\b/.test(t) ? 2 : /\b(a bit|slightly|a little|bit)\b/.test(t) ? 1.2 : 1.5;
  let scale: [number, number, number] | null = null;
  const by = (x: number, y: number, z: number) => {
    const s = scale ?? [1, 1, 1];
    scale = [s[0] * x, s[1] * y, s[2] * z];
  };
  if (/\b(taller|longer legs|stretch(ed)? up)\b/.test(t)) by(1, much, 1);
  if (/\b(shorter|squat|flatter|squashed)\b/.test(t)) by(1, 1 / much, 1);
  if (/\b(bigger|larger|huge|giant|grow)\b/.test(t)) by(much, much, much);
  if (/\b(smaller|tiny|little one|mini|shrink)\b/.test(t)) by(1 / much, 1 / much, 1 / much);
  if (/\b(wider|fatter|broader|thicker)\b/.test(t)) by(much, 1, much);
  if (/\b(thinner|narrower|slimmer|skinnier)\b/.test(t)) by(1 / much, 1, 1 / much);
  const words = t.trim().split(/\s+/);
  let color: string | null = null;
  for (const word of words) {
    if (NAMED_COLORS.some((c) => c.name === word) || word === "grey" || word === "purple") {
      color = normalizeColor(word);
      break;
    }
  }
  const side = /\bto the left\b|\bon the left\b|\bleftward/.test(t) ? "left" : /\bto the right\b|\bon the right\b|\brightward/.test(t) ? "right" : /\b(in front|ahead|forward|closer)\b/.test(t) ? "front" : /\b(behind|further back|farther)\b/.test(t) ? "back" : null;
  const up = /\b(higher|up high|in the air|floating|above)\b/.test(t) ? 1.2 : 0;
  let times = 1;
  const n = t.match(/\b(\d{1,2})\s*(?:times|more|copies|of them)\b/) ?? t.match(/\bx\s?(\d{1,2})\b/) ?? t.match(/\b(\d{1,2})\s+(?:more|again)\b/) ?? t.match(/\banother\s+(\d{1,2})\b/);
  if (n) times = Number(n[1]);
  else {
    const w = t.match(/\b(twice|thrice|(?:two|three|four|five|six|seven|eight)\s+(?:times|more|copies))\b/);
    if (w) times = COUNT_WORDS[w[1].split(/\s+/)[0]] ?? 1;
  }
  return { scale, color, side, up, times: Math.max(1, Math.min(8, times)) };
}

const tweaked = (tweak: Tweak) => !!(tweak.scale || tweak.color || tweak.up);

// ---------- running steps ----------

type Dispatch = (world: World, tool: string, args: Record<string, string>) => { ok: boolean; detail: string; world: World };
type Step = { tool: string; arguments: Record<string, string> };

/** Arguments with @k (the k-th entity this run made) swapped for real ids. */
function resolve(args: Record<string, string>, made: number[]): Record<string, string> | { missing: string } {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!value.includes("@")) {
      out[key] = value;
      continue;
    }
    const parts = value.split(",").map((part) => {
      const m = part.trim().match(/^@(\d+)$/);
      if (!m) return part.trim();
      const id = made[Number(m[1])];
      return id == null ? null : String(id);
    });
    if (parts.some((p) => p == null)) return { missing: key };
    out[key] = parts.join(",");
  }
  return out;
}

const avatarOf = (world: World) => Object.values(world.entities).find((e) => e.tags.includes("architect"));

function footprint(entities: Entity[]) {
  let cx = 0;
  let cz = 0;
  for (const e of entities) {
    cx += e.transform.position.x;
    cz += e.transform.position.z;
  }
  cx /= entities.length;
  cz /= entities.length;
  let r = 0;
  for (const e of entities) r = Math.max(r, Math.hypot(e.transform.position.x - cx, e.transform.position.z - cz) + Math.max(e.transform.scale.x, e.transform.scale.z) / 2);
  return { cx, cz, r: Math.max(0.4, r) };
}

/**
 * A free spot for a group of radius r: starting at (ax, az) and stepping along (dx, dz), the first
 * place where nothing else (but the group itself, the floor and the lab's fixtures) stands within reach.
 */
export function freeSpot(world: World, ax: number, az: number, dx: number, dz: number, r: number, ignore: Set<number>, first = 1): { x: number; z: number } {
  const others = Object.values(world.entities).filter((e) => !ignore.has(e.id) && !e.tags.includes("helm") && !e.tags.includes("worn") && !(e.transform.scale.x > 4 && e.transform.scale.z > 4));
  const step = Math.max(1.4, r * 2 + 0.5);
  for (let k = first; k < first + 24; k += 1) {
    const x = ax + dx * step * k;
    const z = az + dz * step * k;
    const clear = others.every((e) => Math.hypot(e.transform.position.x - x, e.transform.position.z - z) > r + Math.max(e.transform.scale.x, e.transform.scale.z) / 2 + 0.25);
    if (clear) return { x, z };
  }
  return { x: ax + dx * step * first, z: az + dz * step * first };
}

/** Unit direction on the ground for a side, seen from the avatar (its right when none is given). */
function sideDir(world: World, side: Tweak["side"]): [number, number] {
  const yaw = Number(avatarOf(world)?.customData.yaw) || 0;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Facing +z with yaw 0, your right is -x.
  if (side === "left") return [fz, -fx];
  if (side === "front") return [fx, fz];
  if (side === "back") return [-fx, -fz];
  return [-fz, fx];
}

function applyLook(world: World, ids: number[], tweak: Tweak): World {
  if (!tweaked(tweak) || !ids.length) return world;
  const entities = { ...world.entities };
  for (const id of ids) {
    const e = entities[id];
    if (!e || e.tags.includes("architect")) continue;
    const s = e.transform.scale;
    const [kx, ky, kz] = tweak.scale ?? [1, 1, 1];
    const clamp = (v: number) => Math.max(0.05, Math.min(40, v));
    const scale = { x: clamp(s.x * kx), y: clamp(s.y * ky), z: clamp(s.z * kz) };
    const p = e.transform.position;
    // Grow from the ground up: the bottom stays where it was.
    const y = p.y + (scale.y - s.y) / 2 + tweak.up;
    entities[id] = {
      ...e,
      transform: { ...e.transform, scale, position: { ...p, y } },
      customData: tweak.color ? { ...e.customData, color: tweak.color } : e.customData,
    };
  }
  return { ...world, entities };
}

function moveGroup(world: World, ids: number[], x: number, z: number): World {
  const group = ids.map((id) => world.entities[id]).filter(Boolean);
  if (!group.length) return world;
  const { cx, cz } = footprint(group);
  const entities = { ...world.entities };
  for (const e of group) {
    const p = e.transform.position;
    entities[e.id] = { ...e, transform: { ...e.transform, position: { x: p.x + x - cx, y: p.y, z: p.z + z - cz } } };
  }
  return { ...world, entities };
}

export type RunResult = { ok: boolean; detail: string; world: World; made: number[] };

/** Run steps once: @k references resolve to what this run made. */
export function runSteps(world: World, steps: Step[], dispatch: Dispatch, overrides: Record<string, string> = {}): RunResult {
  let current = world;
  const made: number[] = [];
  const notes: string[] = [];
  for (const step of steps) {
    const schema = toolByName(step.tool);
    const merged = { ...step.arguments };
    // Arguments given at call time win over the saved ones, where the tool takes them.
    for (const [key, value] of Object.entries(overrides)) if (schema && key in schema.parameters && key in merged) merged[key] = value;
    const args = resolve(merged, made);
    if ("missing" in args) return { ok: false, detail: `a step refers to something an earlier step did not make (${args.missing})`, world, made: [] };
    const before = current.nextId;
    const out = dispatch(current, step.tool, args);
    if (!out.ok) return { ok: false, detail: `${step.tool}: ${out.detail}`, world, made: [] };
    for (let id = before; id < out.world.nextId; id += 1) if (out.world.entities[id]) made.push(id);
    current = out.world;
    notes.push(out.detail);
  }
  return { ok: true, detail: notes.join("; "), world: current, made };
}

/**
 * Run a call or a skill `times` times with a tweak. Copies of what it made go to free spots: beside
 * the original (repeat) or in front of you (a skill by name). Changes to existing things just run again.
 */
export function runTweaked(world: World, steps: Step[], tweak: Tweak, dispatch: Dispatch, place: { near: number[] } | "front"): RunResult {
  let current = world;
  const made: number[] = [];
  const notes: string[] = [];
  const fixed = steps.some((s) => FIXED.has(s.tool));
  for (let n = 0; n < tweak.times; n += 1) {
    const run = runSteps(current, steps, dispatch, tweak.color ? { color: tweak.color } : {});
    if (!run.ok) return n === 0 ? run : { ok: true, detail: `${notes.join("; ")} (stopped after ${n}: ${run.detail})`, world: current, made };
    let next = run.world;
    if (run.made.length && !fixed) {
      const group = run.made.map((id) => next.entities[id]).filter(Boolean);
      const { r } = footprint(group);
      const ignore = new Set(run.made);
      const anchor = place === "front" ? [] : place.near.map((id) => next.entities[id]).filter(Boolean);
      let spot: { x: number; z: number };
      if (anchor.length) {
        const a = footprint(anchor);
        const [dx, dz] = sideDir(next, tweak.side);
        spot = freeSpot(next, a.cx, a.cz, dx, dz, r, ignore);
      } else {
        // In front of you (or to the side you said), then along your right until there is room.
        const me = avatarOf(next);
        const [fx, fz] = sideDir(next, tweak.side ?? "front");
        const [rx, rz] = sideDir(next, "right");
        const reach = r + 1.4;
        spot = freeSpot(next, (me?.transform.position.x ?? 0) + fx * reach, (me?.transform.position.z ?? 0) + fz * reach, rx, rz, r, ignore, 0);
      }
      next = moveGroup(next, run.made, spot.x, spot.z);
    }
    // A tweak changes what was made; with nothing made, what the call changed.
    const targets = run.made.length ? run.made : steps.flatMap((s) => (s.arguments.id ?? "").split(",").map((v) => Number(v.trim())).filter((id) => Number.isSafeInteger(id) && id > 0 && !!next.entities[id]));
    next = applyLook(next, targets, { ...tweak, color: run.made.length ? tweak.color : null });
    made.push(...run.made);
    notes.push(run.detail);
    current = next;
  }
  const what = made.length ? ` Made ${made.length}: ${made.map((id) => `${current.entities[id]?.name}#${id}`).join(", ")}.` : "";
  return { ok: true, detail: `${notes.length > 1 ? `${notes.length} times. ` : ""}${notes[notes.length - 1] ?? ""}${what}`, world: current, made };
}

// ---------- the tools ----------

export const skillSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

export function findSkill(world: Pick<World, "skills">, name: string): Skill | undefined {
  const key = skillSlug(name);
  return (world.skills ?? []).find((s) => s.name === key);
}

/** repeat: the last change again (or a named skill), with tweaks read from words. */
export function repeatTool(world: World, args: Record<string, string>, dispatch: Dispatch): RunResult {
  const tweak = readTweak(args.words ?? "");
  const times = Number(args.times);
  if (Number.isFinite(times) && times >= 1) tweak.times = Math.min(8, Math.floor(times));
  if (args.skill?.trim()) {
    const skill = findSkill(world, args.skill);
    if (!skill) return { ok: false, detail: `no skill called '${args.skill}'; ${listSkills(world)}`, world, made: [] };
    const run = runTweaked(world, skill.steps, tweak, dispatch, "front");
    return run.ok ? { ...run, detail: `Skill '${skill.name}': ${run.detail}` } : run;
  }
  const last = (world.recent ?? [])[(world.recent ?? []).length - 1];
  if (!last) return { ok: false, detail: "nothing to repeat yet: change something first", world, made: [] };
  const run = runTweaked(world, [{ tool: last.tool, arguments: last.args }], tweak, dispatch, { near: last.made });
  return run.ok ? { ...run, detail: `Again (${last.tool}): ${run.detail}` } : run;
}

/** save_skill: keep the last `count` changes as a named skill. */
export function saveSkill(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const name = skillSlug(args.name ?? "");
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(name)) return { ok: false, detail: "a skill needs a short name that starts with a letter", world };
  if (toolByName(name)) return { ok: false, detail: `'${name}' is already a tool`, world };
  const recent = world.recent ?? [];
  const count = Math.max(1, Math.min(MAX_RECENT, Math.floor(Number(args.count) || 1)));
  if (!recent.length) return { ok: false, detail: "nothing to remember yet: change something first, then save it", world };
  const calls = recent.slice(-count);
  // Ids made by an earlier step become @k, so the skill acts on its own new copies.
  const local = new Map<number, string>();
  const steps: Step[] = [];
  for (const call of calls) {
    const args2: Record<string, string> = {};
    for (const [key, value] of Object.entries(call.args)) {
      args2[key] = key === "id" ? value.split(",").map((part) => local.get(Number(part.trim())) ?? part.trim()).join(",") : value;
    }
    steps.push({ tool: call.tool, arguments: args2 });
    for (const id of call.made) local.set(id, `@${local.size}`);
  }
  const description = (args.description?.trim() || `${steps.length} step${steps.length === 1 ? "" : "s"}: ${steps.map((s) => s.tool).join(", ")}`).slice(0, 160);
  const skill: Skill = { name, description, job: steps.some((s) => /^(spawn|place|build)/.test(s.tool)) ? "create" : "edit", steps };
  const kept = (world.skills ?? []).filter((s) => s.name !== name);
  const replaced = kept.length !== (world.skills ?? []).length;
  return {
    ok: true,
    detail: `${replaced ? "Updated" : "Learned"} the skill '${name}' (${description}). Say "${name.replace(/_/g, " ")}" to build it in front of you, or "${name.replace(/_/g, " ")}, but bigger".`,
    world: { ...world, skills: [...kept, skill].slice(-MAX_SKILLS) },
  };
}

export function listSkills(world: Pick<World, "skills">): string {
  const skills = world.skills ?? [];
  if (!skills.length) return 'no skills yet. Do something, then say "remember that as <name>".';
  return `skills: ${skills.map((s) => `${s.name.replace(/_/g, " ")} (${s.description})`).join("; ")}`;
}

// ---------- instant commands ----------

export type SkillCall = { tool: "repeat" | "save_skill" | "list_skills"; arguments: Record<string, string> };

const NUMBER_WORD = /^(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)$/;
const asNumber = (w: string) => (/^\d+$/.test(w) ? Number(w) : ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 } as Record<string, number>)[w]);

/**
 * Requests about skills, without a model:
 *   "do that again, but taller", "another one, red", "again 3 times"   -> repeat
 *   "remember that as lamp", "save the last 3 things as campfire"       -> save_skill
 *   "campfire", "build a campfire to the left, but bigger"              -> repeat (skill)
 *   "what skills do you know"                                           -> list_skills
 */
export function skillIntent(intent: string, world: Pick<World, "skills" | "recent">): SkillCall | null {
  const text = intent.trim().toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ");
  if (/^(what|which|list|show)\b.*\bskills?\b/.test(text) || /^skills\??$/.test(text)) return { tool: "list_skills", arguments: {} };
  const save = text.match(/^(?:please\s+)?(?:remember|save|keep|learn|store|call|name)\s+(?:that|this|it|those|these|them|the last\s+(\S+)\s+(?:things|steps|commands|changes|moves|ones)|the last (?:thing|step|command|change|one))\s+(?:as|is|was)?\s*(?:a\s+)?(?:skill\s+)?(?:called|named)?\s*["“]?([a-z][a-z0-9 _-]{0,30}?)["”]?[.!]?$/);
  if (save && save[2]) {
    const n = save[1] && NUMBER_WORD.test(save[1]) ? asNumber(save[1]) : save[1] ? null : /^(?:\S+\s+){1}(those|these|them)\b/.test(text) ? Math.min(3, (world.recent ?? []).length) : 1;
    if (n == null) return null;
    return { tool: "save_skill", arguments: { name: save[2].trim(), count: String(n) } };
  }
  const words = text.split(" ").length;
  if (words > 14) return null;
  // A skill by its name leads the request.
  const lead = text.replace(/^(?:(?:please|now|ok|okay|go|can you|could you)\s+)*(?:(?:do|run|build|make|place|put|add|spawn|use|give me|another)\s+)?(?:a|an|the|my|another|one more)?\s*/, "");
  for (const skill of world.skills ?? []) {
    const spoken = skill.name.replace(/_/g, " ");
    if (lead === spoken || lead.startsWith(`${spoken} `) || lead.startsWith(`${spoken},`) || lead.startsWith(`${spoken}s `) || lead === `${spoken}s`) {
      return { tool: "repeat", arguments: { skill: skill.name, words: lead.slice(spoken.length) } };
    }
  }
  if (!(world.recent ?? []).length) return null;
  if (/\b(again|once more|one more( time)?|another one|repeat (that|it|this)|same again|same thing|more of (those|them|these)|another\s+\d+|\d+ more)\b/.test(text) || /^another\b[ ,!.]*(?:but|,|$)/.test(text) || /^(and )?another[.!]?$/.test(text)) {
    if (/^(undo|stop|dont|do not|never)\b/.test(text)) return null;
    return { tool: "repeat", arguments: { words: text } };
  }
  return null;
}

/** For prompts: the skills a model may call like tools. */
export function skillBrief(world: Pick<World, "skills">): string[] {
  return (world.skills ?? []).map((s) => `skill ${s.name}: ${s.description}`);
}
