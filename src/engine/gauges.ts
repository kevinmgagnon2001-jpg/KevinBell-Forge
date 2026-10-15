/**
 * The engine room: the device's own numbers (frame rate, heat, battery, memory, ...) shown as
 * machines in the lab. A boiler whose pressure is memory, a thermometer that is the phone's heat,
 * a piston that pumps at the frame rate.
 *
 * Everything here is data, so the harness (and the model driving it) only ever picks names:
 *
 *   STATS   what is measured. Each reads one number from a LiveSample and knows its range.
 *   MESHES  what it looks like. Each is drawn by one component in Gauges.tsx, keyed by its id.
 *   SKINS   what it is made of. Colours and finish, shared by every mesh.
 *   RIGS    whole rooms placed in one call ("engine room", "steam", "cyber").
 *
 * A gauge is an ordinary entity tagged "gauge" with customData { stat, mesh, skin }. To add a mesh,
 * add an entry to MESHES and a component to GAUGE_PARTS in Gauges.tsx; to add a skin, add an entry
 * to SKINS. Nothing else changes: the tools, the instant commands and the prompt line read these lists.
 *
 * Instant commands: `gaugeIntent` turns plain requests ("add a neon thermometer for heat",
 * "make the gauges brass", "build the engine room") into tool calls without waiting for a model.
 */
import type { Entity, World } from "./types.ts";
import { IDENTITY, V3 } from "./types.ts";

/** One reading of the device. -1 (or NaN) means the device does not say. */
export type LiveSample = {
  fps: number;
  /** Average frame time, ms. */
  frameMs: number;
  /** Highest refresh the screen can show (Galaxy S26 Ultra: 120). */
  refresh: number;
  draws: number;
  triangles: number;
  /** JS heap in use, MB. */
  heapMb: number;
  /** Device memory in use, percent (Android), else -1. */
  memPct: number;
  /** Battery, percent. */
  battery: number;
  charging: boolean;
  /** Battery temperature, degrees C. */
  tempC: number;
  /** Android thermal status 0..6. */
  thermal: number;
  /** Android thermal headroom: 0 cool, 1.0 throttling starts. */
  headroom: number;
  /** Power flowing out of the battery, watts (negative while charging). */
  watts: number;
};

export const EMPTY_SAMPLE: LiveSample = {
  fps: 0,
  frameMs: 0,
  refresh: 60,
  draws: 0,
  triangles: 0,
  heapMb: -1,
  memPct: -1,
  battery: -1,
  charging: false,
  tempC: -1,
  thermal: -1,
  headroom: -1,
  watts: Number.NaN,
};

export type StatSpec = {
  id: string;
  label: string;
  unit: string;
  /** Words people use for it, for the instant commands. */
  words: string[];
  min: number;
  /** Fixed top of the scale, or a function of the sample (frame rate tops out at the screen's refresh). */
  max: number | ((s: LiveSample) => number);
  /** Fraction of the scale past which the gauge warns, and where it is in danger. */
  warn: number;
  danger: number;
  /** true when a low reading is the bad one (battery, frame rate). */
  lowIsBad?: boolean;
  read: (s: LiveSample) => number;
  /** The mesh this stat is drawn with when nobody says. */
  mesh: string;
};

const known = (n: number) => Number.isFinite(n) && n >= 0;

export const STATS: StatSpec[] = [
  { id: "fps", label: "Frame rate", unit: "fps", words: ["fps", "frame rate", "framerate", "frames", "speed"], min: 0, max: (s) => Math.max(60, s.refresh), warn: 0.5, danger: 0.25, lowIsBad: true, read: (s) => s.fps, mesh: "piston" },
  { id: "frame", label: "Frame time", unit: "ms", words: ["frame time", "frametime", "latency", "lag", "ms"], min: 0, max: 50, warn: 0.4, danger: 0.66, read: (s) => s.frameMs, mesh: "gearbox" },
  { id: "heat", label: "Heat", unit: "°C", words: ["heat", "temperature", "temp", "hot", "thermal", "warm"], min: 20, max: 50, warn: 0.6, danger: 0.8, read: (s) => s.tempC, mesh: "thermometer" },
  { id: "throttle", label: "Throttle", unit: "%", words: ["throttle", "throttling", "headroom", "cpu", "processor", "chip", "load"], min: 0, max: 100, warn: 0.7, danger: 0.9, read: (s) => (known(s.headroom) ? s.headroom * 100 : known(s.thermal) ? (s.thermal / 4) * 100 : -1), mesh: "coil" },
  { id: "battery", label: "Battery", unit: "%", words: ["battery", "charge", "power left", "juice"], min: 0, max: 100, warn: 0.3, danger: 0.15, lowIsBad: true, read: (s) => s.battery, mesh: "cell" },
  { id: "power", label: "Power draw", unit: "W", words: ["power", "watts", "draw", "drain", "wattage"], min: 0, max: 12, warn: 0.6, danger: 0.85, read: (s) => (Number.isFinite(s.watts) ? Math.max(0, s.watts) : -1), mesh: "smokestack" },
  { id: "memory", label: "Memory", unit: "%", words: ["memory", "ram", "heap"], min: 0, max: 100, warn: 0.75, danger: 0.9, read: (s) => (known(s.memPct) ? s.memPct : known(s.heapMb) ? Math.min(100, (s.heapMb / 1024) * 100) : -1), mesh: "boiler" },
  { id: "draws", label: "Draw calls", unit: "", words: ["draw calls", "draws", "gpu", "graphics", "render"], min: 0, max: 600, warn: 0.6, danger: 0.85, read: (s) => s.draws, mesh: "bars" },
  { id: "triangles", label: "Triangles", unit: "k", words: ["triangles", "polygons", "polys", "tris"], min: 0, max: 1500, warn: 0.6, danger: 0.85, read: (s) => s.triangles / 1000, mesh: "boiler" },
];

export type MeshSpec = { id: string; label: string; words: string[]; note: string };

export const MESHES: MeshSpec[] = [
  { id: "thermometer", label: "Thermometer", words: ["thermometer", "mercury", "tube"], note: "a glass column that fills and glows hotter" },
  { id: "boiler", label: "Boiler", words: ["boiler", "tank", "furnace", "steam"], note: "a riveted tank with a pressure dial that vents steam near the top" },
  { id: "dial", label: "Pressure dial", words: ["dial", "needle", "speedometer", "pressure dial"], note: "a round dial with a sweeping needle" },
  { id: "piston", label: "Piston engine", words: ["piston", "engine", "pump", "crank", "flywheel"], note: "a piston and flywheel that run at the reading" },
  { id: "cell", label: "Charge cell", words: ["cell", "capacitor", "canister", "jar", "vat"], note: "a glass vat of glowing fluid, the level is the reading" },
  { id: "coil", label: "Tesla coil", words: ["coil", "tesla", "arc", "spark", "reactor"], note: "a coil whose sparks grow with the reading" },
  { id: "gearbox", label: "Gearbox", words: ["gearbox", "gear box", "gears", "cogs", "clockwork", "gear train"], note: "a train of gears that spins faster as the reading climbs, with a small dial" },
  { id: "smokestack", label: "Smokestack", words: ["smokestack", "smoke stack", "chimney", "funnel"], note: "a firebox and chimney: the fire window fills and the smoke thickens with the reading" },
  { id: "bars", label: "Bar meter", words: ["bar meter", "bar graph", "led bar", "equalizer", "vu meter", "level meter", "segment meter"], note: "a column of lit segments, warn and danger zones in their own colours, with a peak marker" },
];

export type SkinSpec = {
  id: string;
  label: string;
  words: string[];
  body: string;
  trim: string;
  glass: string;
  /** The reading's own light: liquid, sparks, dial face lamps. */
  glow: string;
  /** The colour the glow turns past `danger`. */
  hot: string;
  needle: string;
  face: string;
  metalness: number;
  roughness: number;
  /** How strongly the glow lights up (neon skins burn brighter). */
  emissive: number;
};

export const SKINS: SkinSpec[] = [
  { id: "brass", label: "Brass", words: ["brass", "steampunk", "steam punk", "victorian", "gold"], body: "#a8792f", trim: "#5b3a1a", glass: "#e8dcc0", glow: "#ffb347", hot: "#ff4a1c", needle: "#2a1a0c", face: "#efe2c2", metalness: 0.85, roughness: 0.32, emissive: 0.9 },
  { id: "copper", label: "Copper", words: ["copper", "verdigris", "patina", "bronze", "rust"], body: "#b0643a", trim: "#3f7a6a", glass: "#d6efe6", glow: "#6ff0c4", hot: "#ff7043", needle: "#1d2a26", face: "#e3ece2", metalness: 0.8, roughness: 0.42, emissive: 0.9 },
  { id: "neon", label: "Neon", words: ["neon", "cyber", "cyberpunk", "synthwave", "vapor"], body: "#191a2e", trim: "#ff2fb4", glass: "#9ff6ff", glow: "#21f3ff", hot: "#ff2f6d", needle: "#ff2fb4", face: "#0b0c1a", metalness: 0.6, roughness: 0.25, emissive: 2.2 },
  { id: "chrome", label: "Chrome", words: ["chrome", "steel", "silver", "clean", "lab"], body: "#c9ced6", trim: "#5c6470", glass: "#e9f1ff", glow: "#7fb4ff", hot: "#ff5a5a", needle: "#c0262d", face: "#f4f6fa", metalness: 0.95, roughness: 0.18, emissive: 1.1 },
  { id: "ember", label: "Ember iron", words: ["ember", "iron", "forge", "lava", "dark"], body: "#2b2624", trim: "#6b4a32", glass: "#ffd9b0", glow: "#ff7a1c", hot: "#ffe14d", needle: "#ffcf73", face: "#1a1513", metalness: 0.7, roughness: 0.6, emissive: 1.6 },
];

export const GAUGE_TAG = "gauge";

const byId = <T extends { id: string }>(list: T[], id: string | undefined) => list.find((item) => item.id === id?.trim().toLowerCase());
export const statById = (id: string | undefined) => byId(STATS, id);
export const meshById = (id: string | undefined) => byId(MESHES, id);
export const skinById = (id: string | undefined) => byId(SKINS, id);

/** The reading as a fraction of its scale (0..1), or null when the device does not say. */
export function gaugeLevel(stat: StatSpec, sample: LiveSample): number | null {
  const value = stat.read(sample);
  if (!Number.isFinite(value) || value < 0) return null;
  const max = typeof stat.max === "function" ? stat.max(sample) : stat.max;
  return Math.max(0, Math.min(1, (value - stat.min) / (max - stat.min)));
}

export type GaugeMood = "calm" | "warn" | "danger" | "unknown";

export function gaugeMood(stat: StatSpec, level: number | null): GaugeMood {
  if (level == null) return "unknown";
  if (stat.lowIsBad) return level <= stat.danger ? "danger" : level <= stat.warn ? "warn" : "calm";
  return level >= stat.danger ? "danger" : level >= stat.warn ? "warn" : "calm";
}

/** "41.2 °C", "118 fps", "n/a". */
export function gaugeText(stat: StatSpec, sample: LiveSample): string {
  const value = stat.read(sample);
  if (!Number.isFinite(value) || value < 0) return "no reading";
  const digits = value < 10 && stat.unit !== "%" ? 1 : 0;
  return `${value.toFixed(digits)}${stat.unit ? ` ${stat.unit}` : ""}`;
}

/** Where gauges stand when nobody says: two rows of three either side of the bench, facing the deck. */
export const GAUGE_SLOTS: { x: number; z: number }[] = [
  { x: -2.3, z: 4.25 },
  { x: 2.6, z: 4.25 },
  { x: -3.45, z: 4.25 },
  { x: 3.75, z: 4.25 },
  { x: -4.6, z: 4.0 },
  { x: 4.9, z: 4.0 },
  { x: -2.9, z: -3.75 },
  { x: 3.2, z: -3.75 },
  { x: -4.3, z: -3.6 },
  { x: 4.6, z: -3.6 },
];
const DECK_TOP = 0.16;

export function gauges(world: World): Entity[] {
  return Object.values(world.entities)
    .filter((entity) => entity.tags.includes(GAUGE_TAG))
    .sort((a, b) => a.id - b.id);
}

function freeSlot(world: World): { x: number; z: number; yaw: number } {
  const taken = gauges(world).map((g) => g.transform.position);
  const slot = GAUGE_SLOTS.find((s) => !taken.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 0.6));
  const at = slot ?? { x: ((taken.length % 9) - 4) * 1.2, z: -5.2 };
  // Face the middle of the deck.
  return { ...at, yaw: Math.atan2(0.15 - at.x, 0.4 - at.z) };
}

export function makeGauge(id: number, args: { stat: string; mesh?: string; skin?: string; name?: string; x?: number; z?: number; yaw?: number }, world: World): Entity {
  const stat = statById(args.stat) ?? STATS[0];
  const mesh = meshById(args.mesh)?.id ?? stat.mesh;
  const skin = skinById(args.skin)?.id ?? "brass";
  const slot = args.x != null && args.z != null ? { x: args.x, z: args.z, yaw: args.yaw ?? Math.atan2(0.15 - args.x, 0.4 - args.z) } : freeSlot(world);
  const label = meshById(mesh)?.label ?? mesh;
  return {
    id,
    name: args.name?.trim() || `${stat.label} ${label}`,
    transform: { position: V3(slot.x, DECK_TOP, slot.z), rotation: { ...IDENTITY }, scale: V3(1, 1, 1) },
    representation: { kind: "mesh", assetId: GAUGE_TAG },
    physics: null,
    tags: ["lab", GAUGE_TAG, "spawned"],
    customData: { stat: stat.id, mesh, skin, yaw: String(args.yaw ?? slot.yaw) },
  };
}

export type RigSpec = { id: string; label: string; words: string[]; skin: string; parts: { stat: string; mesh?: string }[] };

export const RIGS: RigSpec[] = [
  {
    id: "engine-room",
    label: "Engine room",
    words: ["engine room", "machine room", "boiler room", "all gauges", "every gauge", "full set", "system stats", "stats room", "inside the phone", "inside my phone", "inside the device"],
    skin: "brass",
    parts: [{ stat: "heat" }, { stat: "fps" }, { stat: "memory" }, { stat: "battery" }, { stat: "throttle" }, { stat: "power" }],
  },
  { id: "steam", label: "Steam works", words: ["steam works", "steampunk room", "steam room"], skin: "brass", parts: [{ stat: "heat", mesh: "thermometer" }, { stat: "memory", mesh: "boiler" }, { stat: "fps", mesh: "piston" }, { stat: "frame", mesh: "dial" }, { stat: "power", mesh: "smokestack" }] },
  { id: "cyber", label: "Cyber core", words: ["cyber core", "cyberpunk room", "neon room", "reactor room"], skin: "neon", parts: [{ stat: "throttle", mesh: "coil" }, { stat: "battery", mesh: "cell" }, { stat: "heat", mesh: "thermometer" }, { stat: "draws", mesh: "bars" }, { stat: "frame", mesh: "bars" }] },
];
export const rigById = (id: string | undefined) => byId(RIGS, id?.replace(/\s+/g, "-"));

/** Place a whole rig. Gauges for the same stats are restyled instead of duplicated. */
export function buildRig(world: World, rig: RigSpec, skinOverride?: string): { world: World; placed: number; restyled: number } {
  const skin = skinById(skinOverride)?.id ?? rig.skin;
  let next = world;
  let placed = 0;
  let restyled = 0;
  for (const part of rig.parts) {
    const existing = gauges(next).find((g) => g.customData.stat === part.stat);
    if (existing) {
      const mesh = part.mesh ?? existing.customData.mesh;
      next = { ...next, entities: { ...next.entities, [existing.id]: { ...existing, customData: { ...existing.customData, mesh, skin } } } };
      restyled += 1;
      continue;
    }
    const id = next.nextId;
    const gauge = makeGauge(id, { stat: part.stat, mesh: part.mesh, skin }, next);
    next = { ...next, entities: { ...next.entities, [id]: gauge }, nextId: id + 1 };
    placed += 1;
  }
  return { world: next, placed, restyled };
}

/** Change mesh, skin or stat on some gauges (ids, or all of them). */
export function styleGauges(world: World, ids: number[] | "all", change: { mesh?: string; skin?: string; stat?: string }): { world: World; count: number; error?: string } {
  const mesh = change.mesh ? meshById(change.mesh)?.id : undefined;
  const skin = change.skin ? skinById(change.skin)?.id : undefined;
  const stat = change.stat ? statById(change.stat)?.id : undefined;
  if (change.mesh && !mesh) return { world, count: 0, error: `mesh must be ${MESHES.map((m) => m.id).join(", ")}` };
  if (change.skin && !skin) return { world, count: 0, error: `skin must be ${SKINS.map((s) => s.id).join(", ")}` };
  if (change.stat && !stat) return { world, count: 0, error: `stat must be ${STATS.map((s) => s.id).join(", ")}` };
  if (!mesh && !skin && !stat) return { world, count: 0, error: "give a mesh, a skin or a stat" };
  const targets = ids === "all" ? gauges(world) : ids.map((id) => world.entities[id]).filter((e): e is Entity => !!e && e.tags.includes(GAUGE_TAG));
  if (!targets.length) return { world, count: 0, error: ids === "all" ? "there are no gauges yet; try: build the engine room" : "no gauge with that id" };
  const entities = { ...world.entities };
  for (const g of targets) {
    const data = { ...g.customData };
    if (mesh) data.mesh = mesh;
    if (skin) data.skin = skin;
    if (stat) data.stat = stat;
    // A gauge still wearing its made-up name follows the change; one someone named keeps its name.
    const autoName = (statId: string, meshId: string) => `${statById(statId)?.label} ${meshById(meshId)?.label}`;
    const name = g.name === autoName(g.customData.stat, g.customData.mesh) ? autoName(data.stat, data.mesh) : g.name;
    entities[g.id] = { ...g, name, customData: data };
  }
  return { world: { ...world, entities }, count: targets.length };
}

/** One line per list, for the model's prompt and the tool descriptions. Short on purpose. */
export function gaugeCatalog(): string {
  return [
    `stat is ${STATS.map((s) => s.id).join(", ")}.`,
    `mesh is ${MESHES.map((m) => m.id).join(", ")}.`,
    `skin is ${SKINS.map((s) => s.id).join(", ")}.`,
    `rig is ${RIGS.map((r) => r.id).join(", ")}.`,
  ].join(" ");
}

// ---------- instant commands (no model) ----------

export type GaugeCall = { tool: "place_gauge" | "style_gauge" | "build_gauge_rig"; arguments: Record<string, string> };

function findWord<T extends { id: string; words: string[] }>(list: T[], lower: string): T | undefined {
  let best: { item: T; at: number; len: number } | undefined;
  for (const item of list) {
    for (const word of [item.id, ...item.words]) {
      const at = lower.search(new RegExp(`\\b${word.replace(/[-\s]+/g, "[-\\s]+")}s?\\b`));
      if (at < 0) continue;
      // Prefer the longest phrase, then the earliest.
      if (!best || word.length > best.len || (word.length === best.len && at < best.at)) best = { item, at, len: word.length };
    }
  }
  return best?.item;
}

/**
 * A plain request about gauges, as tool calls, or null when it is not one (then the model decides).
 * Only clear requests match: a gauge word (or a mesh/skin word next to one) must be present.
 */
export function gaugeIntent(intent: string, world: World): GaugeCall | null {
  const lower = intent.toLowerCase().replace(/[’']/g, "");
  const rig = findWord(RIGS, lower);
  const stat = findWord(STATS, lower);
  const mesh = findWord(MESHES, lower);
  const skin = findWord(SKINS, lower);
  const gaugeWord = /\b(gauges?|meters?|stats?|readouts?|instruments?|engine room)\b/.test(lower);
  const hasGauges = gauges(world).length > 0;
  const restyle = /\b(make|turn|switch|change|reskin|skin|restyle|paint|swap|all|every|the gauges?)\b/.test(lower) && !/\b(add|place|put|build|spawn|create|another|new)\b/.test(lower);

  if (rig && /\b(build|make|add|set up|setup|place|show|give|create|open)\b/.test(lower)) {
    return { tool: "build_gauge_rig", arguments: { rig: rig.id, ...(skin ? { skin: skin.id } : {}) } };
  }
  if (!gaugeWord && !mesh) return null;
  // "make the gauges neon", "turn every gauge into a boiler", "switch the heat gauge to copper".
  if (restyle && hasGauges && (skin || mesh)) {
    const target = stat ? gauges(world).filter((g) => g.customData.stat === stat.id) : [];
    const id = target.length ? target.map((g) => g.id).join(",") : "*";
    return { tool: "style_gauge", arguments: { id, ...(skin ? { skin: skin.id } : {}), ...(mesh ? { mesh: mesh.id } : {}) } };
  }
  if (/\b(add|place|put|build|spawn|create|make|give|show|another|new|want)\b/.test(lower)) {
    if (!stat && !mesh) return gaugeWord ? { tool: "build_gauge_rig", arguments: { rig: "engine-room", ...(skin ? { skin: skin.id } : {}) } } : null;
    const chosen = stat ?? STATS.find((s) => s.mesh === mesh?.id) ?? STATS[0];
    return { tool: "place_gauge", arguments: { stat: chosen.id, ...(mesh ? { mesh: mesh.id } : {}), ...(skin ? { skin: skin.id } : {}) } };
  }
  return null;
}
