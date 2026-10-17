/**
 * Forge's own planner: plain requests turned into tool calls with no model loaded.
 *
 * The resident model is opt-in, so this is what answers most of the time. It reads a sentence the
 * way a person means it and plans the calls the harness runs as one change (harness.ts executePlan):
 *
 *   splitClauses  "make a red cube, then paint it blue and throw it" -> three requests, run in turn
 *   planIntent    one request -> calls, what to select after, and a line to say
 *   suggest       the closest things it does know, for a request it could not read
 *
 * What it reads:
 *   - things by name (forgiving a typo), by kind and colour ("the red cube", "all the spheres"),
 *     by pronoun ("it" is the selection, "them" the last group made or changed), "me", "everything"
 *   - counts in digits or words ("three", "a dozen", "a few"), sizes ("tiny", "huge", "twice as big")
 *   - arrangements: a row, a circle, a stack or tower, a grid, a pyramid, scattered
 *   - places: coordinates, "here", "in front of me", "behind me", "to my left", "on the bench",
 *     "next to the gold", "above the column", "in the middle", "high up"
 *   - verbs: make, paint, move, raise, lower, grow, shrink, stretch, rename, turn into, texture,
 *     copy, delete, clear, throw, drop, undo, walk, turn, select, how many, where is, what is here
 *
 * Pure: it reads the world and returns a plan; it never changes anything itself.
 */
import { NAMED_COLORS } from "./color.ts";
import { defaultScale } from "./manifold.ts";
import type { Entity, Vec3, World } from "./types.ts";

export type PlanCall = { tool: string; arguments: Record<string, string> };

export type Plan = {
  calls: PlanCall[];
  /** What the planner understood, as a short line for the log. */
  say: string;
  /** Select this after the plan runs (null keeps the selection; "spawned" picks the last made). */
  select?: number | "spawned" | null;
  /** The ids this plan is about, so "them" finds them next time. "spawned" means what it makes. */
  group?: number[] | "spawned";
  /** How sure: 1 a clear reading; lower when a default filled a gap. */
  sure: number;
};

export type PlanContext = {
  world: World;
  selectedId: number | null;
  /** The last group made or changed ("them"). */
  group?: number[];
};

// ---------- words ----------

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  dozen: 12, couple: 2, pair: 2, few: 3, several: 4, handful: 5, bunch: 6, lots: 8, many: 8,
  single: 1, double: 2, triple: 3, twice: 2, half: 0.5,
};

/** Shape words to the harness's assets. Order matters: longer phrases first. */
const KINDS: [RegExp, string][] = [
  [/^(?:cubes?|box(?:es)?|blocks?|crates?|dice|die|bricks?)$/, "cube"],
  [/^(?:spheres?|balls?|orbs?|globes?|bubbles?|planets?)$/, "sphere"],
  [/^(?:platforms?|slabs?|decks?|stages?|tiles?)$/, "platform"],
  [/^(?:pillars?|columns?|posts?|poles?|obelisks?)$/, "pillar"],
  [/^(?:rings?|torus|tori|hoops?|donuts?|doughnuts?|halos?|portals?)$/, "ring"],
  [/^(?:splats?|gaussians?|beacons?|clouds?|wisps?)$/, "gaussian"],
  [/^(?:cards?|panels?|signs?|boards?)$/, "card"],
  [/^(?:gems?|jewels?|diamonds?|rubies|ruby|emeralds?|sapphires?)$/, "gem"],
  [/^(?:crystals?|shards?|quartz)$/, "crystal"],
  [/^(?:knots?|pretzels?|tangles?)$/, "knot"],
  [/^(?:vases?|pots?|urns?|jars?)$/, "vase"],
];

/** Words that are a thing in general ("the thing", "objects"). */
const THING = /^(?:things?|objects?|shapes?|stuff|items?|bodies|body|pieces?)$/;

const COLOR_ALIASES: Record<string, string> = {
  purple: "violet", lavender: "violet", magenta: "pink", rose: "pink", grey: "gray", silver: "gray",
  cyan: "teal", turquoise: "teal", aqua: "teal", navy: "indigo", lime: "green", emerald: "green",
  crimson: "red", scarlet: "red", golden: "gold", brown: "stone", tan: "amber", beige: "amber",
  yellowish: "yellow", reddish: "red", bluish: "blue", greenish: "green", sky: "blue", cream: "white",
  ivory: "white", charcoal: "black", dark: "black",
};

const COLORS = new Set(NAMED_COLORS.map((c) => c.name));
const RAINBOW = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "violet", "pink"];

const TEXTURES = ["marble", "circuit", "clay", "paper", "steel", "brick", "grain", "night"];
const TEXTURE_ALIASES: Record<string, string> = { wood: "grain", wooden: "grain", metal: "steel", metallic: "steel", bricks: "brick", stone: "marble", stars: "night", starry: "night", tech: "circuit" };

const SIZES: [RegExp, number][] = [
  [/^(?:tiny|teeny|mini|miniature|wee)$/, 0.4],
  [/^(?:small|little|smaller)$/, 0.65],
  [/^(?:big|large|bigger|larger)$/, 1.6],
  [/^(?:huge|giant|massive|enormous|gigantic|colossal|humongous)$/, 2.4],
];

function colorOf(word: string): string | null {
  const w = word.toLowerCase();
  if (COLORS.has(w)) return w;
  return COLOR_ALIASES[w] ?? null;
}

function kindOf(word: string): string | null {
  for (const [re, kind] of KINDS) if (re.test(word)) return kind;
  return null;
}

function numberOf(word: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

/** Lower case, polite padding dropped, punctuation spaced so words split cleanly. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\b(?:please|pls|plz|kindly|just|now|for me|real quick|quickly)\b/g, " ")
    .replace(/^\s*(?:hey|ok(?:ay)?|so|um+|uh+|yo)\b[,\s]*/g, "")
    .replace(/^\s*(?:can|could|would|will) you\s+/g, "")
    .replace(/^\s*(?:i (?:want|need|would like)(?: you)?(?: to)?|i'd like(?: you)?(?: to)?|let's|lets|let us|go ahead and|try to|i wanna)\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One request in several parts, split where a new verb starts: "then", ";", a full stop, ", and"
 * and " and " before a verb. "a red cube and a blue ball" stays one part.
 */
export function splitClauses(intent: string): string[] {
  const parts = intent
    .split(/\s*(?:;|\.\s+|,?\s*\band then\b|,?\s*\bthen\b|,?\s*\bafter that\b|,?\s*\balso\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    // ", and paint it" / " and throw it": split before a verb, never inside a list of things.
    const pieces = part.split(/\s*(?:,\s*and|,|\band)\s+(?=(?:make|create|spawn|add|build|put|place|paint|colou?r|dye|turn|move|raise|lift|lower|grow|shrink|stretch|rename|copy|duplicate|delete|remove|destroy|clear|throw|toss|launch|kick|push|undo|walk|jump|select|light|set|fill|blow|wave|dance|drop|give|knock|summon)\b)/i);
    for (const piece of pieces) if (piece.trim()) out.push(piece.trim());
  }
  return out.length ? out : [intent.trim()];
}

// ---------- the world, read ----------

const SCENERY_TAGS = ["architect", "helm", "floor", "fixture", "terminal", "tv", "device-screen", "presence", "visitor", "worn"];

function assetOf(entity: Entity): string {
  if (entity.representation.kind === "mesh") return entity.representation.assetId;
  if (entity.representation.kind === "gaussian") return "gaussian";
  return entity.representation.kind;
}

function me(world: World): Entity | undefined {
  return Object.values(world.entities).find((entity) => entity.tags.includes("architect"));
}

function yawOf(entity: Entity | undefined): number {
  return Number(entity?.customData.yaw) || 0;
}

/** Ahead of you and to your right, on the ground. */
function frame(world: World): { at: Vec3; fwd: Vec3; right: Vec3 } {
  const body = me(world);
  const yaw = yawOf(body);
  const at = body?.transform.position ?? { x: 0, y: 0, z: 4 };
  const fwd = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  return { at: { x: at.x, y: 0, z: at.z }, fwd, right: { x: -fwd.z, y: 0, z: fwd.x } };
}

function nearestColorWord(hex: string | undefined): string {
  if (!hex) return "";
  const body = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(body)) return "";
  const rgb = [0, 2, 4].map((i) => Number.parseInt(body.slice(i, i + 2), 16));
  let best = "";
  let bestD = Infinity;
  for (const color of NAMED_COLORS) {
    const other = [1, 3, 5].map((i) => Number.parseInt(color.hex.slice(i, i + 2), 16));
    const d = (rgb[0] - other[0]) ** 2 + (rgb[1] - other[1]) ** 2 + (rgb[2] - other[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = color.name;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** An entity named in the words: exact names first, then one typo for names of five letters or more. */
function byName(world: World, words: string[], text: string, exactOnly = false): Entity | null {
  let best: Entity | null = null;
  for (const entity of Object.values(world.entities)) {
    const name = entity.name.toLowerCase();
    if (name.length < 2 || entity.tags.includes("helm")) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(text) && (!best || name.length > best.name.length)) best = entity;
  }
  if (best || exactOnly) return best;
  for (const word of words) {
    if (word.length < 5 || kindOf(word) || colorOf(word)) continue;
    for (const entity of Object.values(world.entities)) {
      const name = entity.name.toLowerCase();
      if (name.length >= 5 && editDistance(word, name) <= 1) return entity;
    }
  }
  return null;
}

export type Target = { ids: number[]; label: string; plural: boolean };

const PRONOUN_ONE = /\b(?:it|that|this|that one|this one|the selected(?: one| thing)?|selection)\b/;
const PRONOUN_MANY = /\b(?:them|those|these|they|all of them|each of them|both)\b/;

/** Who or what the words are about, or null when they name nothing in the world. */
export function findTarget(ctx: PlanContext, text: string): Target | null {
  const { world } = ctx;
  const words = text.split(/[^a-z0-9#-]+/).filter(Boolean);
  const all = Object.values(world.entities).sort((a, b) => a.id - b.id);
  const loose = all.filter((e) => !e.tags.some((t) => SCENERY_TAGS.includes(t)));

  const tagged = text.match(/(?:#|\b(?:entity|id)\s*#?\s*)(\d+)\b/);
  if (tagged && world.entities[Number(tagged[1])]) {
    const e = world.entities[Number(tagged[1])];
    return { ids: [e.id], label: e.name, plural: false };
  }
  if (/\b(?:everything|all of it|all things|all objects|the (?:whole )?scene|every ?thing)\b/.test(text)) {
    const made = /\b(?:i made|i built|i spawned|we made|spawned)\b/.test(text) ? loose.filter((e) => e.tags.includes("spawned")) : loose;
    return made.length ? { ids: made.map((e) => e.id), label: "everything", plural: true } : null;
  }

  // A name said outright wins over a kind ("the sample sphere" is Sample), unless the name is also a
  // colour word and a kind is named too ("paint the cube gold" is about the cube, not Gold).
  const early = byName(world, words, text, true);
  if (early && !(colorOf(early.name.toLowerCase()) && words.some((w) => kindOf(w) || THING.test(w)))) {
    return { ids: [early.id], label: early.name, plural: false };
  }

  // "all the red cubes", "every sphere", "the blue ones", "the red cube"
  for (let i = 0; i < words.length; i += 1) {
    const kind = kindOf(words[i]);
    const thing = THING.test(words[i]) || words[i] === "ones" || words[i] === "one";
    if (!kind && !thing) continue;
    const before = words.slice(Math.max(0, i - 4), i);
    const color = before.map(colorOf).filter(Boolean).pop() ?? null;
    if (thing && !color) continue;
    const many = /s$|^dice$/.test(words[i]) && words[i] !== "torus" ? true : before.some((w) => w === "all" || w === "every" || w === "each" || w === "both");
    const pool = (kind ? loose.filter((e) => assetOf(e) === kind) : loose).filter((e) => !color || nearestColorWord(e.customData.color) === color);
    // A named fixture can still be "the cube" ("the gold cube" is Gold on the stand).
    const wide = pool.length ? pool : (kind ? all.filter((e) => assetOf(e) === kind && !e.tags.includes("architect")) : []).filter((e) => !color || nearestColorWord(e.customData.color) === color);
    if (!wide.length) continue;
    const label = `${color ? `${color} ` : ""}${kind ?? "thing"}`;
    if (many) return { ids: wide.map((e) => e.id), label: `${label}s`, plural: true };
    // One of several: the selection if it is one, else the newest.
    const sel = ctx.selectedId != null ? wide.find((e) => e.id === ctx.selectedId) : undefined;
    const pick = sel ?? wide[wide.length - 1];
    return { ids: [pick.id], label: pick.name, plural: false };
  }

  const named = byName(world, words, text);
  if (named) return { ids: [named.id], label: named.name, plural: false };

  if (/\b(?:me|myself|my avatar|my body|the avatar|avatar|you)\b/.test(text)) {
    const body = me(world);
    if (body) return { ids: [body.id], label: "you", plural: false };
  }
  if (PRONOUN_MANY.test(text) && ctx.group?.length) {
    const ids = ctx.group.filter((id) => world.entities[id]);
    if (ids.length) return { ids, label: ids.length === 1 ? world.entities[ids[0]].name : "them", plural: ids.length > 1 };
  }
  if (PRONOUN_ONE.test(text) || PRONOUN_MANY.test(text)) {
    if (ctx.selectedId != null && world.entities[ctx.selectedId]) {
      return { ids: [ctx.selectedId], label: world.entities[ctx.selectedId].name, plural: false };
    }
  }
  return null;
}

// ---------- places ----------

type Place = { at: Vec3; base?: number; onTop?: boolean; span?: string; ground?: boolean };

function sizeOf(entity: Entity): Vec3 {
  return entity.transform.scale;
}

/** Where the words put something, or null when they say nowhere. */
export function findPlace(ctx: PlanContext, text: string): Place | null {
  const { world } = ctx;
  const f = frame(world);
  const ahead = (d: number, side = 0): Vec3 => ({ x: f.at.x + f.fwd.x * d + f.right.x * side, y: 0, z: f.at.z + f.fwd.z * d + f.right.z * side });

  const coords = text.match(/\bat\s*\(?\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)(?:\s*[, ]\s*(-?\d+(?:\.\d+)?))?\s*\)?/);
  if (coords) {
    const [x, a, b] = [coords[1], coords[2], coords[3]].map((v) => (v == null ? null : Number(v)));
    const at = b == null ? { x: x!, y: 0, z: a! } : { x: x!, y: a!, z: b };
    return { at, span: coords[0] };
  }
  if (/\b(?:in the (?:middle|center|centre)|at the (?:middle|center|centre|origin)|at origin|at zero)\b/.test(text)) return { at: { x: 0.01, y: 0, z: 0.01 }, span: "middle" };

  const rel = text.match(/\b(on top of|on|onto|above|over|under|beneath|below|next to|beside|by|near|close to|around|in front of|behind|left of|right of|to the left of|to the right of)\s+((?:the|a|my)\s+)?([a-z0-9#][a-z0-9# -]*)/);
  if (rel) {
    const how = rel[1];
    const rest = rel[3];
    const lead = rest.split(/\s+/)[0];
    const isMe = /^(?:me|myself|you)\b/.test(rest);
    if (isMe) {
      if (how === "behind") return { at: ahead(-2.2), span: rel[0].trim() };
      if (/left/.test(how)) return { at: ahead(0.6, -2.2), span: rel[0].trim() };
      if (/right/.test(how)) return { at: ahead(0.6, 2.2), span: rel[0].trim() };
      if (how === "above" || how === "over") return { at: { ...ahead(0.5), y: 3.2 }, span: rel[0].trim() };
      return { at: ahead(2.4), span: rel[0].trim() };
    }
    // Only the noun phrase after the preposition names the anchor.
    const anchor = findTarget({ ...ctx, group: undefined }, ` ${rest.split(/\b(?:and|then|with|named|called)\b/)[0]} `);
    if (lead === "floor" || lead === "ground") {
      // "on the floor": straight down where it is (the caller keeps x and z for a move).
      return { at: { x: NaN, y: 0, z: NaN }, span: rel[0].trim(), ground: true };
    }
    if (anchor) {
      const e = world.entities[anchor.ids[anchor.ids.length - 1]];
      if (e) {
        const p = e.transform.position;
        const s = sizeOf(e);
        const top = p.y + s.y / 2;
        const reach = Math.max(s.x, s.z) / 2 + 1.1;
        if (how === "on top of" || how === "on" || how === "onto") return { at: { x: p.x, y: 0, z: p.z }, base: top, onTop: true, span: rel[0].trim() };
        if (how === "above" || how === "over") return { at: { x: p.x, y: 0, z: p.z }, base: top + 1.4, onTop: true, span: rel[0].trim() };
        if (how === "under" || how === "beneath" || how === "below") return { at: { x: p.x + reach, y: 0, z: p.z }, span: rel[0].trim() };
        const toMe = { x: f.at.x - p.x, z: f.at.z - p.z };
        const len = Math.hypot(toMe.x, toMe.z) || 1;
        const n = { x: toMe.x / len, z: toMe.z / len };
        if (how === "in front of") return { at: { x: p.x + n.x * reach, y: 0, z: p.z + n.z * reach }, span: rel[0].trim() };
        if (how === "behind") return { at: { x: p.x - n.x * reach, y: 0, z: p.z - n.z * reach }, span: rel[0].trim() };
        if (/left/.test(how)) return { at: { x: p.x - f.right.x * reach, y: 0, z: p.z - f.right.z * reach }, span: rel[0].trim() };
        // next to, beside, by, near, around, right of: to its right as you see it.
        return { at: { x: p.x + f.right.x * reach, y: 0, z: p.z + f.right.z * reach }, span: rel[0].trim() };
      }
    }
  }
  if (/\b(?:behind me|at my back)\b/.test(text)) return { at: ahead(-2.2), span: "behind me" };
  if (/\b(?:to my left|on my left|left of me)\b/.test(text)) return { at: ahead(0.6, -2.2), span: "to my left" };
  if (/\b(?:to my right|on my right|right of me)\b/.test(text)) return { at: ahead(0.6, 2.2), span: "to my right" };
  if (/\b(?:here|in front of me|before me|near me|by me|next to me|over here|right here|to me)\b/.test(text)) return { at: ahead(2.4), span: "here" };
  if (/\b(?:far away|in the distance|over there|far off)\b/.test(text)) return { at: ahead(9), span: "over there" };
  return null;
}

function aloft(text: string): number {
  if (/\b(?:in the sky|high up|up high|way up|floating|in the air|hovering|midair|mid-air)\b/.test(text)) return 4;
  return 0;
}

// ---------- making things ----------

type Item = { kind: string; count: number; color: string | null; size: number; rainbow: boolean; random: boolean };

/** "three big red cubes and two tiny gold balls" -> two items. */
export function readItems(text: string): Item[] {
  const words = text.split(/[^a-z0-9.]+/).filter(Boolean);
  const items: Item[] = [];
  let from = 0;
  for (let i = 0; i < words.length; i += 1) {
    const kind = kindOf(words[i]);
    // "a ring of pillars": the ring is the layout, not a thing.
    if (!kind || words[i + 1] === "of") continue;
    const mods = words.slice(from, i).slice(-5);
    from = i + 1;
    let count = /s$|^dice$/.test(words[i]) && !/^(?:torus|glass)$/.test(words[i]) ? 0 : 1;
    let color: string | null = null;
    let size = 1;
    let rainbow = false;
    let random = false;
    for (const m of mods) {
      const n = numberOf(m);
      if (n != null && n >= 1 && n !== 0.5 && m !== "double" && m !== "twice") count = Math.round(n);
      const c = colorOf(m);
      if (c) color = c;
      if (/^(?:rainbow|colou?rful|multicolou?r(?:ed)?)$/.test(m)) rainbow = true;
      if (/^(?:random|randomly|assorted)$/.test(m)) random = true;
      for (const [re, k] of SIZES) if (re.test(m)) size = k;
    }
    if (count === 0) count = 3;
    items.push({ kind, count: Math.max(1, Math.min(40, count)), color, size, rainbow, random });
  }
  return items;
}

type Layout = "row" | "circle" | "stack" | "grid" | "pyramid" | "scatter" | "line-up";

function layoutOf(text: string): Layout | null {
  if (/\b(?:stack|stacked|tower|pile|piled|on top of each other|column of|tall)\b/.test(text)) return "stack";
  if (/\b(?:circle|ring of|around me|in a ring|round|circular)\b/.test(text)) return "circle";
  if (/\b(?:grid|square of|checkerboard|array)\b/.test(text)) return "grid";
  if (/\b(?:pyramid|triangle)\b/.test(text)) return "pyramid";
  if (/\b(?:scatter|scattered|randomly|everywhere|all over|around)\b/.test(text)) return "scatter";
  if (/\b(?:row|line|lined up|side by side|wall of)\b/.test(text)) return "row";
  return null;
}

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Positions for n things of one size around a centre, laid out in the room as you face it. */
function arrange(layout: Layout, n: number, center: Vec3, size: Vec3, f: ReturnType<typeof frame>, seed: number): Vec3[] {
  const gap = Math.max(size.x, size.z) * 1.35 + 0.15;
  const out: Vec3[] = [];
  const along = (u: number, v: number): Vec3 => ({ x: center.x + f.right.x * u + f.fwd.x * v, y: 0, z: center.z + f.right.z * u + f.fwd.z * v });
  if (layout === "stack") {
    for (let i = 0; i < n; i += 1) out.push({ x: center.x, y: size.y * i, z: center.z });
    return out;
  }
  if (layout === "circle") {
    const r = Math.max(1.6, (n * gap) / (2 * Math.PI));
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      out.push({ x: center.x + Math.cos(a) * r, y: 0, z: center.z + Math.sin(a) * r });
    }
    return out;
  }
  if (layout === "grid") {
    const cols = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i += 1) out.push(along((i % cols - (cols - 1) / 2) * gap, Math.floor(i / cols) * gap));
    return out;
  }
  if (layout === "pyramid") {
    let base = 1;
    while ((base * (base + 1)) / 2 < n) base += 1;
    let placed = 0;
    for (let layer = 0; layer < base && placed < n; layer += 1) {
      const width = base - layer;
      for (let k = 0; k < width && placed < n; k += 1, placed += 1) {
        const p = along((k - (width - 1) / 2) * size.x * 1.02, 0);
        out.push({ ...p, y: size.y * layer });
      }
    }
    return out;
  }
  if (layout === "scatter") {
    const rand = seeded(seed);
    const r = Math.max(2.2, Math.sqrt(n) * gap);
    for (let i = 0; i < n; i += 1) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * r;
      out.push({ x: center.x + Math.cos(a) * d, y: 0, z: center.z + Math.sin(a) * d });
    }
    return out;
  }
  for (let i = 0; i < n; i += 1) out.push(along((i - (n - 1) / 2) * gap, 0));
  return out;
}

function titleCase(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

function nameIn(text: string): string | null {
  const m = text.match(/\b(?:named|called|name it|call it)\s+([a-z][\w-]*)/);
  return m ? titleCase(m[1]) : null;
}

/** Height of a freshly made thing's centre above the ground (manifold.ts presentY). */
function liftFor(kind: string, scaleY: number): number {
  const k = scaleY / (defaultScale(kind).y || 1);
  if (kind === "gaussian") return 1.2 * k;
  if (kind === "ring") return 0.85 * k;
  if (kind === "card") return 0.78 * k;
  if (kind === "vase") return 0.7 * k;
  return scaleY / 2;
}

/** The words back, as said to you: "around me" is "around you". */
function yours(text: string): string {
  return text.replace(/\bme\b/g, "you").replace(/\bmy\b/g, "your").replace(/\bmyself\b/g, "yourself");
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function planSpawn(ctx: PlanContext, text: string, items: Item[]): Plan | null {
  if (!items.length) return null;
  const f = frame(ctx.world);
  const found = findPlace(ctx, text);
  const place = found?.ground ? null : found;
  const layout = layoutOf(text.replace(place?.span ?? "\u0000", " "));
  const lift = aloft(text);
  const explicitY = place && place.at.y !== 0 && !place.onTop ? place.at.y : null;
  const center = place?.at ?? { x: f.at.x + f.fwd.x * 2.6, y: 0, z: f.at.z + f.fwd.z * 2.6 };
  const name = nameIn(text);
  const calls: PlanCall[] = [];
  const said: string[] = [];
  let shift = 0;
  const totalWidth = items.reduce((sum, item) => sum + Math.max(defaultScale(item.kind).x, defaultScale(item.kind).z) * item.size * 1.5 * (layout === "stack" || layout === "circle" ? 1 : item.count), 0);
  let cursor = items.length > 1 ? -totalWidth / 2 : 0;
  for (const item of items) {
    const base = defaultScale(item.kind);
    const size = { x: base.x * item.size, y: base.y * item.size, z: base.z * item.size };
    const width = Math.max(size.x, size.z) * 1.5 * (layout === "stack" || layout === "circle" ? 1 : item.count);
    const c = items.length > 1 ? { x: center.x + f.right.x * (cursor + width / 2), y: 0, z: center.z + f.right.z * (cursor + width / 2) } : center;
    cursor += width;
    const spots = item.count > 1 ? arrange(layout ?? (item.kind === "platform" ? "row" : "row"), item.count, c, size, f, ctx.world.nextId + shift) : [c];
    const groundY = place?.onTop ? (place.base ?? 0) : 0;
    spots.forEach((spot, i) => {
      const color = item.rainbow ? RAINBOW[(i + shift) % RAINBOW.length] : item.random ? NAMED_COLORS[Math.floor(seeded(ctx.world.nextId + i * 7 + shift)() * 13)].name : item.color;
      const y = explicitY ?? groundY + liftFor(item.kind, size.y) + spot.y + lift;
      const args: Record<string, string> = {
        name: name ? (item.count > 1 || items.length > 1 ? `${name}${calls.length + 1}` : name) : "",
        x: fmt(spot.x),
        y: fmt(Math.max(0.01, y)),
        z: fmt(spot.z),
        asset: item.kind,
        exact: "1",
      };
      if (!args.name) args.name = item.kind === "gaussian" ? "Splat" : titleCase(item.kind);
      if (color) args.color = color;
      if (item.size !== 1) args.size = fmt(item.size);
      if (lift || (explicitY != null && explicitY > 0.6)) args.float = "1";
      calls.push({ tool: "spawn_entity", arguments: args });
    });
    shift += item.count;
    const sizeWord = item.size < 0.5 ? "tiny " : item.size < 1 ? "small " : item.size > 2 ? "huge " : item.size > 1 ? "big " : "";
    const colorWord = item.rainbow ? "rainbow " : item.random ? "colourful " : item.color ? `${item.color} ` : "";
    said.push(`${item.count > 1 ? `${item.count} ` : "a "}${sizeWord}${colorWord}${item.kind === "gaussian" ? "splat" : item.kind}${item.count > 1 ? "s" : ""}`);
  }
  // Spawns with no explicit height land on the ground; a fixed y is honoured by makeSpawned.
  const where = place?.span && place.span !== "here" ? ` ${yours(place.span)}` : place?.span === "here" ? " in front of you" : "";
  const how = layout && calls.length > 1 ? ` in a ${layout === "stack" ? "stack" : layout === "scatter" ? "scatter" : layout}` : "";
  return { calls, say: `Making ${said.join(" and ")}${how}${where}.`, select: "spawned", group: "spawned", sure: 1 };
}

// ---------- changing things ----------

function scaleWords(text: string): { scale?: number; sx?: number; sy?: number; sz?: number } | null {
  const times = text.match(/\b(\d+(?:\.\d+)?|two|three|four|ten|twice|half)\s*(?:x|times)\s*(?:as\s+)?(bigger|larger|big|large|smaller|small|taller|tall)?/);
  if (times) {
    const n = numberOf(times[1]) ?? 2;
    const shrink = /small/.test(times[2] ?? "");
    const factor = shrink ? 1 / n : n;
    if (/tall/.test(times[2] ?? "")) return { sy: factor };
    return { scale: factor };
  }
  if (/\b(?:double (?:the )?size|twice as big|twice the size|doubled)\b/.test(text)) return { scale: 2 };
  if (/\b(?:half (?:the )?size|half as big|halve)\b/.test(text)) return { scale: 0.5 };
  const much = /\b(?:much|way|a lot|lots|really|very|super)\b/.test(text);
  const bit = /\b(?:a (?:little|bit|tad)|slightly|a touch)\b/.test(text);
  const k = (up: boolean) => (up ? (much ? 2 : bit ? 1.2 : 1.5) : much ? 0.5 : bit ? 0.85 : 0.67);
  if (/\b(?:taller|higher(?! up)|stretch(?: it)? up|longer)\b/.test(text)) return { sy: k(true) };
  if (/\b(?:shorter|squash|squish|flatter|flatten)\b/.test(text)) return { sy: k(false) };
  if (/\b(?:wider|fatter|thicker|broader)\b/.test(text)) return { sx: k(true), sz: k(true) };
  if (/\b(?:thinner|narrower|skinnier|slimmer)\b/.test(text)) return { sx: k(false), sz: k(false) };
  if (/\b(?:bigger|larger|grow|enlarge|embiggen|scale up|huge|giant|big|large)\b/.test(text)) return { scale: k(true) };
  if (/\b(?:smaller|shrink|tiny|little|scale down|small|mini)\b/.test(text)) return { scale: k(false) };
  return null;
}

function distanceIn(text: string, fallback: number): number {
  const m = text.match(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple)\s*(?:m|meters?|metres?|units?|steps?|blocks?|feet|ft)?\b/);
  if (!m) return /\b(?:a (?:little|bit|tad)|slightly)\b/.test(text) ? fallback / 2 : /\b(?:a lot|way|far|much)\b/.test(text) ? fallback * 2.5 : fallback;
  const n = numberOf(m[1].replace(/^a /, "")) ?? fallback;
  return /feet|ft/.test(m[0]) ? n * 0.3 : n;
}

function nudgeOf(ctx: PlanContext, text: string): Vec3 | null {
  const f = frame(ctx.world);
  const d = distanceIn(text, 1);
  if (/\b(?:up|upward|upwards|higher|raise|lift)\b/.test(text)) return { x: 0, y: d, z: 0 };
  if (/\b(?:down|downward|downwards|lower|sink)\b/.test(text)) return { x: 0, y: -d, z: 0 };
  if (/\b(?:left)\b/.test(text)) return { x: -f.right.x * d, y: 0, z: -f.right.z * d };
  if (/\b(?:right)\b/.test(text)) return { x: f.right.x * d, y: 0, z: f.right.z * d };
  if (/\b(?:forward|forwards|ahead|away|further|farther)\b/.test(text)) return { x: f.fwd.x * d, y: 0, z: f.fwd.z * d };
  if (/\b(?:back|backward|backwards|closer|toward me|towards me)\b/.test(text)) return { x: -f.fwd.x * d, y: 0, z: -f.fwd.z * d };
  return null;
}

/** The colour the words change something to: the last colour not part of naming the target. */
function newColor(text: string, target: Target | null, world: World): string | null {
  const words = text.split(/[^a-z]+/).filter(Boolean);
  const colors: { c: string; i: number }[] = [];
  words.forEach((w, i) => {
    const c = colorOf(w);
    if (c) colors.push({ c, i });
  });
  if (!colors.length) return null;
  // A colour right before a kind word names the target ("the red cube"), unless it is the only one.
  const free = colors.filter(({ i }) => !(words[i + 1] && (kindOf(words[i + 1]) || THING.test(words[i + 1]) || words[i + 1] === "ones" || words[i + 1] === "one")));
  const pick = (free.length ? free : colors)[(free.length ? free : colors).length - 1].c;
  // "gold" is also the Gold exhibit's name: "paint the cube gold" means the colour.
  if (target && target.ids.length === 1 && world.entities[target.ids[0]]?.name.toLowerCase() === pick && colors.length === 1 && !/\b(?:to|into|in)\s+\w*\s*$/.test(text)) return pick;
  return pick;
}

function textureIn(text: string, target: Target | null, world: World): string | null {
  const found = [...text.matchAll(/\b(marble|circuit|clay|paper|steel|brick|bricks|grain|night|wood|wooden|metal|metallic|stone|starry|stars|tech)\b/g)].map((m) => m[1]);
  if (!found.length) return null;
  if (!/\b(?:texture|look|finish|skin|pattern|surface|made of|out of|like)\b/.test(text) && !/\b(?:make|turn|paint|cover|wrap|give)\b/.test(text)) return null;
  // "give the clay a marble texture": Clay is the thing, marble the texture.
  const names = new Set((target?.ids ?? []).map((id) => world.entities[id]?.name.toLowerCase()));
  const pick = found.filter((w) => !names.has(w)).pop() ?? found[found.length - 1];
  const word = TEXTURE_ALIASES[pick] ?? pick;
  return TEXTURES.includes(word) ? word : null;
}

function idList(target: Target): string {
  return target.ids.join(",");
}

function noun(target: Target): string {
  return target.label;
}

/** "6 red cubes", "those 6", or a single thing's name. */
function many(target: Target, ids: number[], world: World): string {
  if (ids.length === 1) return world.entities[ids[0]]?.name ?? target.label;
  return target.label === "them" ? `those ${ids.length}` : `${ids.length} ${target.label}`;
}

function strengthOf(text: string): number {
  if (/\b(?:hard|far|high|really|super|very|as hard as|full force)\b/.test(text)) return 1.8;
  if (/\b(?:gently|softly|lightly|a little|a bit|slightly|tap)\b/.test(text)) return 0.5;
  return 1;
}

// ---------- the reader ----------

const HELP_LINE =
  "Try: “a row of five red cubes”, “stack 4 crates on the bench”, “paint it blue”, “make the sphere twice as big”, “move it up 2”, “throw the ball”, “delete the cubes”, “how many spheres?”, “undo”. Join steps with “then”.";

/**
 * One request (already split by splitClauses) to a plan, or null when the words do not say
 * something it can do; the caller then asks the model if one is on, or shows suggest().
 */
export function planIntent(ctx: PlanContext, raw: string): Plan | null {
  const text = ` ${normalize(raw)} `.replace(/\s+/g, " ");
  const t = text.trim();
  if (!t) return null;
  const world = ctx.world;

  // Help and greetings.
  if (/^(?:help|\?|what can (?:you|i) do\??|commands|what do i (?:say|type)\??|how does this work\??|hi|hello|hey there)$/.test(t)) {
    return { calls: [], say: HELP_LINE, sure: 1 };
  }

  // Undo.
  const undo = t.match(/^(?:undo|oops|whoops|take (?:that|it) back|revert|go back|nevermind|never mind|ctrl ?z)(?: (?:that|it|the last (?:one|change|thing)))?(?: (\w+) times?| (\w+) (?:changes|steps))?$/);
  if (undo) {
    const n = Math.max(1, Math.min(16, Math.round(numberOf(undo[1] ?? undo[2] ?? "1") ?? 1)));
    return { calls: Array.from({ length: n }, () => ({ tool: "undo", arguments: {} })), say: n > 1 ? `Undoing the last ${n} changes.` : "Undoing the last change.", sure: 1 };
  }

  // Questions: how many, where is, what is here, what is that.
  const howMany = t.match(/^(?:how many|count(?: the)?|number of)\s+(.+?)\??$/);
  if (howMany) {
    const target = findTarget(ctx, ` all ${howMany[1]} `);
    const label = howMany[1].replace(/\b(?:are there|are here|do i have|is there|in the scene|exist)\b/g, "").trim();
    const n = target?.ids.length ?? 0;
    return { calls: [], say: `${n === 0 ? "No" : n} ${label || "things"}${n && target ? `: ${target.ids.slice(0, 12).map((id) => world.entities[id]?.name).join(", ")}${n > 12 ? "…" : ""}` : ""}.`, group: target?.ids, sure: 1 };
  }
  const where = t.match(/^where(?: is|'s| are)\s+(.+?)\??$/);
  if (where) {
    const target = findTarget(ctx, ` ${where[1]} `);
    if (!target) return { calls: [], say: `I can't find ${where[1]} here.`, sure: 0.8 };
    const f = frame(world);
    const lines = target.ids.slice(0, 6).map((id) => {
      const e = world.entities[id];
      const p = e.transform.position;
      const dx = p.x - f.at.x;
      const dz = p.z - f.at.z;
      const dist = Math.hypot(dx, dz);
      const front = dx * f.fwd.x + dz * f.fwd.z;
      const side = dx * f.right.x + dz * f.right.z;
      const dir = Math.abs(front) > Math.abs(side) ? (front > 0 ? "ahead" : "behind you") : side > 0 ? "to your right" : "to your left";
      return `${e.name} is ${fmt(dist)} m ${dir} (${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`;
    });
    return { calls: [], say: `${lines.join("; ")}.`, select: target.ids[0], group: target.ids, sure: 1 };
  }
  if (/^(?:what(?:'s| is| do i have)? (?:here|in the scene|around(?: me)?)|list (?:everything|all|things|objects)|what's around|what is around|look around|describe (?:the )?scene)\??$/.test(t)) {
    const loose = Object.values(world.entities).filter((e) => !e.tags.some((tag) => SCENERY_TAGS.includes(tag)));
    const counts = new Map<string, number>();
    for (const e of loose) counts.set(assetOf(e), (counts.get(assetOf(e)) ?? 0) + 1);
    const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k === "gaussian" ? "splat" : k}${n > 1 ? "s" : ""}`);
    return { calls: [], say: `${loose.length} things here: ${parts.join(", ") || "nothing yet"}.`, sure: 1 };
  }
  const whatIs = t.match(/^what(?:'s| is) (?:that|this|it|the selected(?: one)?)\??$/);
  if (whatIs) {
    const e = ctx.selectedId != null ? world.entities[ctx.selectedId] : undefined;
    if (!e) return { calls: [], say: "Nothing is selected. Tap something or say its name.", sure: 1 };
    const p = e.transform.position;
    return { calls: [], say: `${e.name}: a ${nearestColorWord(e.customData.color)} ${assetOf(e)} at (${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})${e.tags.length ? `, tagged ${e.tags.slice(0, 4).join(", ")}` : ""}.`, sure: 1 };
  }

  // Selecting.
  const sel = t.match(/^(?:select|pick|choose|focus(?: on)?|highlight|look at)\s+(.+)$/);
  if (sel) {
    const target = findTarget(ctx, ` ${sel[1]} `);
    if (target) return { calls: [], say: `Selected ${noun(target)}.`, select: target.ids[target.ids.length - 1], group: target.ids, sure: 1 };
  }

  // Walking and turning your body.
  const walk = t.match(/^(?:walk|step|go|move|run)(?: me| the avatar| my avatar| myself)?\s+(forward|forwards|ahead|back|backward|backwards|left|right|up|down)(?:\s+(\w+)(?:\s+(?:steps?|times?|m|meters?))?)?$/);
  if (walk) {
    const dir = /forward|ahead/.test(walk[1]) ? "forward" : /back/.test(walk[1]) ? "back" : walk[1];
    const n = Math.max(1, Math.min(10, Math.round(numberOf(walk[2] ?? "1") ?? 1)));
    return { calls: Array.from({ length: n }, () => ({ tool: "control_avatar", arguments: { move: dir } })), say: `Stepping ${dir}${n > 1 ? ` ${n} times` : ""}.`, sure: 1 };
  }
  const turn = t.match(/^(?:turn|rotate|spin)(?: me| the avatar| my avatar| around)?\s+(left|right|around)(?:\s+(\d+)\s*(?:degrees?|deg|°))?$/);
  if (turn) {
    const dir = turn[1] === "around" ? "turn-right" : `turn-${turn[1]}`;
    // Each step is 0.45 rad (manifold.ts steer): a plain turn is a quarter turn, around is a half.
    const degrees = turn[1] === "around" ? 180 : Number(turn[2] ?? 90);
    const n = Math.max(1, Math.min(14, Math.round((degrees * Math.PI) / 180 / 0.45)));
    return { calls: Array.from({ length: n }, () => ({ tool: "control_avatar", arguments: { move: dir } })), say: turn[1] === "around" ? "Turning around." : `Turning ${turn[1]}${turn[2] ? ` ${turn[2]}°` : ""}.`, sure: 1 };
  }
  if (/^jump$/.test(t)) return { calls: [{ tool: "control_avatar", arguments: { move: "up" } }], say: "Jump!", sure: 1 };

  // Agents.
  const agent = t.match(/\b(?:spawn|summon|add|make|create|bring in)\b.*\b(critic|builder|scout)\b(?:.*\b(?:named|called)\s+([a-z][\w-]*))?/);
  if (agent) {
    return { calls: [{ tool: "spawn_agent", arguments: { role: agent[1], name: agent[2] ? titleCase(agent[2]) : titleCase(agent[1]) } }], say: `A ${agent[1]} joins you.`, select: "spawned", sure: 1 };
  }

  // Games.
  const game = t.match(/\b(?:play|build|make|set up|start|open)\b.*\b(tetris|marble run|marble track|marbles run)\b/);
  if (game) {
    const kind = /tetris/.test(game[1]) ? "tetris" : "marble";
    return { calls: [{ tool: "build_play", arguments: { kind } }], say: kind === "tetris" ? "Setting up Tetris." : "Building the marble run.", sure: 1 };
  }

  // Deleting.
  const del = t.match(/^(?:delete|remove|destroy|erase|trash|bin|get rid of|clear|clean up|wipe|vanish|despawn|kill)\b\s*(.*)$/);
  if (del) {
    const rest = del[1] || "it";
    const everything = /^(?:all|everything|the (?:scene|room|floor|lab|plaza)|it all|up|out|the mess|my stuff|all of (?:it|them))?$/.test(rest.trim()) && /^(?:clear|clean up|wipe|delete all|delete everything)/.test(t) ? true : /\beverything\b|\ball of (?:it|them)\b/.test(rest);
    const target = everything ? findTarget(ctx, ` everything ${rest} `) : findTarget(ctx, ` ${rest} `);
    if (!target) return { calls: [], say: `Nothing here matches “${rest}”.`, sure: 0.8 };
    const ids = target.ids.filter((id) => !world.entities[id]?.tags.includes("architect"));
    if (!ids.length) return { calls: [], say: "You stay. Move, paint or resize yourself instead.", sure: 1 };
    return { calls: [{ tool: "delete_entity", arguments: { id: ids.join(",") } }], say: `Removing ${many(target, ids, world)}.`, select: null, sure: 1 };
  }

  // Throwing, kicking, launching.
  const toss = t.match(/^(?:throw|toss|launch|fling|kick|push|shove|hurl|yeet|bounce|flick|send flying)\s+(.+)$/);
  if (toss) {
    const what = toss[1].replace(/\b(?:at|to|toward|towards) me\b|\b(?:up|upward|into the (?:sky|air)|high|hard|far|gently|softly|left|right|forward|away)\b/g, " ");
    const target = findTarget(ctx, ` ${what} `) ?? findTarget(ctx, " it ");
    if (target) {
      const f = frame(world);
      const k = strengthOf(t);
      const up = /\bup\b|\bupward|\bsky|\bair|\bhigh\b/.test(toss[1]);
      const atMe = /\b(?:at me|to me|toward me|towards me)\b/.test(toss[1]);
      const dir = atMe ? { x: -f.fwd.x, z: -f.fwd.z } : /\bleft\b/.test(toss[1]) ? { x: -f.right.x, z: -f.right.z } : /\bright\b/.test(toss[1]) ? { x: f.right.x, z: f.right.z } : { x: f.fwd.x, z: f.fwd.z };
      const v = up ? { x: dir.x * 0.6, y: 9 * k, z: dir.z * 0.6 } : /kick|push|shove|flick/.test(t) ? { x: dir.x * 5 * k, y: 1.2 * k, z: dir.z * 5 * k } : { x: dir.x * 4.5 * k, y: 5.5 * k, z: dir.z * 4.5 * k };
      const ids = target.ids.filter((id) => !world.entities[id]?.tags.some((tag) => tag === "architect" || tag === "floor" || tag === "fixture"));
      if (!ids.length) return { calls: [], say: `${noun(target)} is fixed in place.`, sure: 1 };
      return {
        calls: ids.slice(0, 40).map((id) => ({ tool: "apply_velocity", arguments: { id: String(id), vx: fmt(v.x), vy: fmt(v.y), vz: fmt(v.z), free: "1" } })),
        say: `${/kick/.test(t) ? "Kicking" : /push|shove/.test(t) ? "Pushing" : "Throwing"} ${many(target, ids, world)}${up ? " up" : ""}.`,
        select: ids[ids.length - 1],
        group: ids,
        sure: 1,
      };
    }
  }

  // Dropping something from where it is ("drop the ball", "let it fall").
  const fall = t.match(/^(?:drop|let go of|release|let)\s+(.+?)(?:\s+(?:fall|go|drop))?$/);
  if (fall && !readItems(fall[1]).length) {
    const target = findTarget(ctx, ` ${fall[1]} `);
    if (target) {
      const ids = target.ids.filter((id) => !world.entities[id]?.tags.some((tag) => tag === "architect" || tag === "floor" || tag === "fixture"));
      if (ids.length) {
        const calls: PlanCall[] = [];
        for (const id of ids.slice(0, 40)) {
          const p = world.entities[id].transform.position;
          calls.push({ tool: "set_transform", arguments: { id: String(id), x: fmt(p.x), y: fmt(p.y + 2.5), z: fmt(p.z) } });
          calls.push({ tool: "apply_velocity", arguments: { id: String(id), vx: "0", vy: "0", vz: "0", free: "1" } });
        }
        return { calls, say: `Dropping ${many(target, ids, world)} from up high.`, group: ids, sure: 0.9 };
      }
    }
  }

  // Renaming.
  const rename = t.match(/^(?:rename|call|name)\s+(.+?)\s+(?:to\s+|as\s+)?([a-z][\w-]*)$/);
  if (rename) {
    const target = findTarget(ctx, ` ${rename[1]} `);
    if (target && target.ids.length === 1) {
      return { calls: [{ tool: "edit_entity", arguments: { id: String(target.ids[0]), name: titleCase(rename[2]) } }], say: `${noun(target)} is now ${titleCase(rename[2])}.`, select: target.ids[0], sure: 1 };
    }
  }

  // Copies.
  const copy = t.match(/^(?:copy|duplicate|clone|replicate|another|one more|make another|make (?:a )?copy of)\s*(.*)$/);
  if (copy) {
    const rest = copy[1] || "it";
    const many = rest.match(/\b(\w+) (?:times|copies|more)\b/);
    const n = Math.max(1, Math.min(20, Math.round(numberOf(many?.[1] ?? "1") ?? 1)));
    const target = findTarget(ctx, ` ${rest} `) ?? findTarget(ctx, " it ");
    if (target) {
      const src = world.entities[target.ids[target.ids.length - 1]];
      if (src && !src.tags.includes("architect")) {
        const f = frame(world);
        const kind = assetOf(src);
        const p = src.transform.position;
        const s = src.transform.scale;
        const gap = Math.max(s.x, s.z) * 1.35 + 0.15;
        const size = s.y / (defaultScale(kind).y || 1);
        const calls = Array.from({ length: n }, (_, i) => {
          const args: Record<string, string> = { x: fmt(p.x + f.right.x * gap * (i + 1)), y: fmt(p.y), z: fmt(p.z + f.right.z * gap * (i + 1)), asset: kind, name: `${src.name}${i + 2}` };
          const color = nearestColorWord(src.customData.color);
          if (color) args.color = color;
          if (Math.abs(size - 1) > 0.02) args.size = fmt(size);
          return { tool: "spawn_entity", arguments: args };
        });
        return { calls, say: `${n > 1 ? `${n} copies` : "A copy"} of ${src.name}, beside it.`, select: "spawned", group: "spawned", sure: 1 };
      }
    }
  }

  const makeVerb = /^(?:make|create|spawn|add|build|put|place|drop|give me|give|forge|conjure|summon|generate|i want|i need|we need|need|want|can i have|can i get|get me|bring me|craft|produce|set up|lay out|line up|arrange|scatter|sprinkle|strew|surround me with|ring me with)\b/.test(t);
  const editVerb = /^(?:make|turn|paint|colou?r|dye|tint|change|set|recolou?r|shade|move|shift|slide|nudge|put|place|bring|send|raise|lift|lower|grow|shrink|stretch|scale|resize|enlarge|squash|flatten|rotate|reshape|cover|wrap|give)\b/.test(t);

  // Changing one thing into another shape: "turn it into a sphere", "make the cube a ring".
  const reshape = t.match(/^(?:turn|make|change|transform|morph|reshape|convert)\s+(.+?)\s+(?:into|in to|to|a|an)\s+(?:an? )?([a-z]+)$/);
  if (reshape) {
    const kind = kindOf(reshape[2]);
    const target = kind ? findTarget(ctx, ` ${reshape[1]} `) : null;
    if (kind && target) {
      const ids = target.ids.filter((id) => !world.entities[id]?.tags.includes("architect"));
      if (ids.length) return { calls: [{ tool: "edit_entity", arguments: { id: ids.join(","), asset: kind } }], say: `${many(target, ids, world)} ${ids.length > 1 ? "become" : "becomes"} ${ids.length > 1 ? `${kind}s` : `a ${kind}`}.`, select: ids[ids.length - 1], group: ids, sure: 1 };
    }
  }

  // Spawning: a verb that makes, and at least one thing to make ("a row of 5 red cubes").
  const items = readItems(t.replace(/\b(?:on top of|on|onto|above|over|next to|beside|by|near|in front of|behind|left of|right of|under)\s+(?:the|a|my)?\s*[a-z0-9#-]+(?:\s+(?:cube|sphere|ball|pillar|column|platform|ring|gem|crystal|knot|vase|card|box|block)s?)?/g, " "));
  if (makeVerb && items.length) {
    // "make the cube red" is an edit, not a spawn: a definite article on an existing kind with no count.
    const definite = /^(?:make|turn|put|place|drop|give)\s+(?:the|my|that|this|those|these|all)\b/.test(t);
    if (!definite) return planSpawn(ctx, t, items);
  }

  // Edits on a target.
  if (editVerb || /\b(?:bigger|smaller|taller|shorter|wider|thinner|up|down|left|right)\b/.test(t)) {
    // The target: words after the verb, before the colour or change.
    const body = t.replace(/^(?:make|turn|paint|colou?r|dye|tint|change|set|recolou?r|shade|move|shift|slide|nudge|put|place|bring|send|raise|lift|lower|grow|shrink|stretch|scale|resize|enlarge|squash|flatten|cover|wrap|give)\s+/, "");
    const place = /^(?:move|shift|slide|put|place|bring|send)\b/.test(t) ? findPlace(ctx, ` ${body} `) : null;
    const targetText = place?.span ? body.replace(place.span, " ") : body;
    const target = findTarget(ctx, ` ${targetText} `) ?? (/^(?:paint|colou?r|dye|tint|grow|shrink|stretch|raise|lift|lower|move|shift|nudge)\b/.test(t) && ctx.selectedId != null ? findTarget(ctx, " it ") : null);
    if (!target) return null;
    const ids = target.ids;
    const who = many(target, ids, world);
    const calls: PlanCall[] = [];
    const said: string[] = [];

    const texture = textureIn(t, target, world);
    if (texture) {
      calls.push({ tool: "set_asset", arguments: { id: idList(target), src: `tex:${texture}`, title: texture } });
      said.push(`wrapped ${who} in ${texture}`);
    }
    const color = texture ? null : newColor(t, target, world);
    const rainbow = /\b(?:rainbow|colou?rful|all different colou?rs|random colou?rs?)\b/.test(t);
    if (rainbow) {
      ids.forEach((id, i) => calls.push({ tool: "set_color", arguments: { id: String(id), color: RAINBOW[i % RAINBOW.length] } }));
      said.push(`painted ${who} in rainbow colours`);
    } else if (color && /^(?:make|turn|paint|colou?r|dye|tint|change|set|recolou?r|shade)\b/.test(t)) {
      calls.push({ tool: "set_color", arguments: { id: idList(target), color } });
      said.push(`painted ${who} ${color}`);
    }
    const sizing = scaleWords(t);
    if (sizing && !/^(?:move|shift|slide|put|place|bring|send|raise|lift|lower)\b/.test(t)) {
      if (sizing.scale) {
        // Grown from the ground up: what rested on something keeps resting there.
        for (const id of ids) {
          const e = world.entities[id];
          const p = e.transform.position;
          const k = Math.min(4, Math.max(0.25, sizing.scale));
          const y = p.y + ((k - 1) * e.transform.scale.y) / 2;
          calls.push({ tool: "edit_entity", arguments: { id: String(id), scale: fmt(sizing.scale), x: fmt(p.x), y: fmt(Math.max(0.01, y)), z: fmt(p.z) } });
        }
      } else {
        const args: Record<string, string> = { id: idList(target) };
        for (const [k, v] of Object.entries(sizing)) args[k] = fmt(v);
        calls.push({ tool: "edit_entity", arguments: args });
      }
      const grew = sizing.scale ? (sizing.scale > 1 ? "bigger" : "smaller") : sizing.sy ? (sizing.sy > 1 ? "taller" : "shorter") : (sizing.sx ?? 1) > 1 ? "wider" : "thinner";
      said.push(said.length ? `made ${ids.length > 1 ? "them" : "it"} ${grew}` : `made ${who} ${grew}`);
    }
    if (/^(?:move|shift|slide|nudge|put|place|bring|send|raise|lift|lower)\b/.test(t) || (!calls.length && nudgeOf(ctx, t))) {
      if (place?.ground) {
        for (const id of ids) {
          const e = world.entities[id];
          const p = e.transform.position;
          calls.push({ tool: "set_transform", arguments: { id: String(id), x: fmt(p.x), y: fmt(e.transform.scale.y / 2), z: fmt(p.z) } });
        }
        said.push(`set ${who} down on the ground`);
      } else if (place) {
        const spots = ids.length > 1 ? arrange(layoutOf(t) ?? "row", ids.length, place.at, world.entities[ids[0]].transform.scale, frame(world), world.nextId) : [place.at];
        ids.forEach((id, i) => {
          const e = world.entities[id];
          const s = e.transform.scale;
          const y = place.onTop ? (place.base ?? 0) + s.y / 2 + spots[i].y : place.at.y || Math.max(s.y / 2, e.transform.position.y > s.y / 2 + 0.05 && !place.span ? e.transform.position.y : s.y / 2) + spots[i].y;
          calls.push({ tool: "set_transform", arguments: { id: String(id), x: fmt(spots[i].x), y: fmt(y), z: fmt(spots[i].z) } });
        });
        said.push(`moved ${who} ${place.span === "here" ? "over to you" : yours(place.span ?? "there")}`);
      } else {
        const nudge = nudgeOf(ctx, /^raise|^lift/.test(t) ? `${t} up` : /^lower/.test(t) ? `${t} down` : t);
        if (nudge) {
          calls.push({ tool: "set_transform", arguments: { id: idList(target), x: fmt(nudge.x), y: fmt(nudge.y), z: fmt(nudge.z), delta: "1" } });
          if (ids.length === 1) {
            // set_transform with one id is absolute; give it the end point instead.
            const p = world.entities[ids[0]].transform.position;
            calls[calls.length - 1] = { tool: "set_transform", arguments: { id: String(ids[0]), x: fmt(p.x + nudge.x), y: fmt(Math.max(0, p.y + nudge.y)), z: fmt(p.z + nudge.z) } };
          }
          const d = Math.hypot(nudge.x, nudge.y, nudge.z);
          said.push(`moved ${who} ${nudge.y > 0 ? "up" : nudge.y < 0 ? "down" : "over"} ${fmt(d)} m`);
        }
      }
    }
    if (!calls.length) return null;
    return { calls, say: `${said.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()), select: ids[ids.length - 1], group: ids, sure: 1 };
  }

  // A bare thing ("five red cubes", "a huge gold sphere"): make it.
  if (items.length && !/\?$/.test(t) && /^(?:a|an|one|some|\d+|two|three|four|five|six|seven|eight|nine|ten|dozen|few|several|tiny|small|little|big|large|huge|giant|rainbow|red|orange|yellow|green|teal|blue|indigo|violet|purple|pink|white|black|gray|grey|gold|row|line|stack|tower|circle|ring|grid|pyramid)\b/.test(t)) {
    const plan = planSpawn(ctx, t, items);
    return plan ? { ...plan, sure: 0.85 } : null;
  }
  // A colour alone, about the selection ("blue", "make it gold" handled above).
  const bare = colorOf(t);
  if (bare && ctx.selectedId != null && world.entities[ctx.selectedId]) {
    return { calls: [{ tool: "set_color", arguments: { id: String(ctx.selectedId), color: bare } }], say: `${world.entities[ctx.selectedId].name} ${bare}.`, select: ctx.selectedId, sure: 0.8 };
  }
  return null;
}

// ---------- when it does not understand ----------

/** Example requests, for the help line and for "did you mean". */
export const EXAMPLES = [
  "a row of five red cubes",
  "stack 4 crates on the bench",
  "a circle of 8 rainbow pillars around me",
  "a huge gold sphere in the middle",
  "paint it blue",
  "make the sphere twice as big",
  "move it up 2",
  "put the cube on the bench",
  "throw the ball",
  "kick the cubes",
  "drop the gold",
  "turn it into a ring",
  "give it a marble texture",
  "copy it 3 times",
  "rename it Bob",
  "delete the spheres",
  "clear everything I made",
  "how many cubes?",
  "where is the gold?",
  "what's here?",
  "undo",
  "walk forward 3",
  "turn around",
  "light a campfire",
  "set the bench on fire",
  "put out the fire",
  "make it rain at dusk",
  "fill the plaza with people",
  "line up 30 dominoes",
  "build a jenga tower",
  "give me a red cape",
  "raise a flag",
  "string lights between the bench and the terminal",
  "grow moss on the column",
  "blow two smoke rings",
  "summon a companion",
  "make a 4d bubble",
  "build breakout",
  "build blocks",
  "play tetris",
  "wave",
  "do a little dance",
  "add a neon thermometer",
  "build the engine room",
] as const;

/** The examples closest to the words, best first (shared words, then shared letters). */
export function suggest(intent: string, count = 3): string[] {
  const words = new Set(normalize(intent).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const stem = (w: string) => w.replace(/(?:ing|ed|es|s)$/, "");
  const stems = new Set([...words].map(stem));
  const scored = EXAMPLES.map((example, order) => {
    const ex = example.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    let score = 0;
    for (const w of ex) {
      if (words.has(w)) score += 3;
      else if (stems.has(stem(w))) score += 2;
      else if ([...words].some((u) => u.length >= 4 && editDistance(u, w) <= 1)) score += 1;
    }
    return { example, score, order };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.order - b.order);
  // Pad with the first examples so there is always a choice of `count`.
  const picks = hits.slice(0, count).map((s) => s.example);
  for (const example of EXAMPLES) {
    if (picks.length >= count) break;
    if (!picks.includes(example)) picks.push(example);
  }
  return picks;
}
