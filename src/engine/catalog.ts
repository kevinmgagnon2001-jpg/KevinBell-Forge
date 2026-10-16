/**
 * The catalog: everything Forge can make or do, in one place, for the Catalog panel (Catalog.tsx).
 *
 * Each entry runs as a plain request through the same path as typing it (store.ts submitIntent), so
 * the catalog never needs a model, shows in the log, and stays honest with what the words do.
 * Entries marked `added` with a version newer than the one you last opened the catalog on show
 * "new"; things that appeared in the world since then are marked new in "In this world".
 */
import { GROWTH_KINDS } from "./growth.ts";
import { HYPER_SHAPES } from "./hyper.ts";
import { MESHES, RIGS, SKINS, STATS } from "./gauges.ts";
import { MOODS } from "./weather.ts";
import { PRIMITIVES } from "./motion.ts";
import type { Entity, World } from "./types.ts";

export type SectionId = "games" | "toys" | "shapes" | "materials" | "life" | "effects" | "sky" | "gauges" | "moves";

export type CatalogItem = {
  id: string;
  section: SectionId;
  name: string;
  /** A single glyph for the card. */
  glyph: string;
  blurb: string;
  /** What runs when you tap it. */
  intent: string;
  /** Catalog version it arrived in (see CATALOG_VERSION); newer than you last saw shows "new". */
  added?: number;
  /** Extra words the search box matches. */
  tags?: string;
};

/** Bump when entries are added, and mark the new ones with `added: CATALOG_VERSION`. */
export const CATALOG_VERSION = 2;

export const SECTIONS: { id: SectionId; name: string; glyph: string; blurb: string }[] = [
  { id: "games", name: "Games", glyph: "🕹", blurb: "Arcade cabinets and toys you play. Walk up and press Play." },
  { id: "toys", name: "Toys and physics", glyph: "🧱", blurb: "Things that fall, swing, tumble and stack." },
  { id: "shapes", name: "Shapes", glyph: "◆", blurb: "Every asset. Tap to make one in front of you." },
  { id: "materials", name: "Colours and textures", glyph: "🎨", blurb: "For whatever is selected." },
  { id: "life", name: "People and companions", glyph: "🧑", blurb: "Townsfolk with a day of their own, a helper that follows orders." },
  { id: "effects", name: "Effects", glyph: "🔥", blurb: "Fire, smoke, growth, cloth and the fourth dimension." },
  { id: "sky", name: "Weather and time", glyph: "⛅", blurb: "Light, sky and mood." },
  { id: "gauges", name: "Engine room", glyph: "⚙", blurb: "Your device's live stats as machines." },
  { id: "moves", name: "Moves", glyph: "💃", blurb: "Things your body can do." },
];

const SHAPES: [string, string, string, string][] = [
  ["cube", "Cube", "▣", "box block crate"],
  ["sphere", "Sphere", "●", "ball orb globe"],
  ["platform", "Platform", "▭", "slab deck stage"],
  ["pillar", "Pillar", "▮", "column post pole"],
  ["ring", "Ring", "◯", "torus hoop halo"],
  ["gaussian", "Splat", "✺", "gaussian beacon cloud"],
  ["card", "Card", "▯", "panel sign board"],
  ["gem", "Gem", "💎", "jewel diamond"],
  ["crystal", "Crystal", "🔷", "shard quartz"],
  ["knot", "Knot", "➰", "pretzel tangle"],
  ["vase", "Vase", "🏺", "pot urn jar"],
];

const COLORS: [string, string][] = [
  ["red", "🟥"], ["orange", "🟧"], ["yellow", "🟨"], ["green", "🟩"], ["teal", "🩵"], ["blue", "🟦"],
  ["violet", "🟪"], ["pink", "🩷"], ["white", "⬜"], ["black", "⬛"], ["gold", "🟫"],
];

const TEXTURES: [string, string][] = [
  ["marble", "🪨"], ["circuit", "🔌"], ["clay", "🧱"], ["paper", "📜"], ["steel", "🔩"], ["brick", "🧱"], ["grain", "🪵"], ["night", "🌌"],
];

function build(): CatalogItem[] {
  const items: CatalogItem[] = [
    // Games
    { id: "game-breakout", section: "games", name: "Hyper Breakout", glyph: "🧨", blurb: "Neon brick breaker with combos, capsules and slow time. Best score kept.", intent: "build breakout", tags: "arcade bricks" },
    { id: "game-blocks", section: "games", name: "Blocks", glyph: "🟪", blurb: "The drag-and-place block puzzle, in a cabinet by the bench.", intent: "build blocks", tags: "arcade puzzle" },
    { id: "game-tetris", section: "games", name: "Tetris", glyph: "🧩", blurb: "A full Tetris well. Clear lines, get faster; best lines kept.", intent: "play tetris", tags: "arcade" },
    { id: "game-marble", section: "games", name: "Marble run", glyph: "🎱", blurb: "Ramps and a catch. Release the marble and watch it ride.", intent: "build the marble run", tags: "physics" },
    { id: "game-dominoes", section: "games", name: "Domino run", glyph: "🁫", blurb: "A curve of dominoes. Walk into the first one.", intent: "line up 24 dominoes in a curve", tags: "rigid toys" },
    { id: "game-jenga", section: "games", name: "Jenga", glyph: "🗼", blurb: "Twelve layers that stand until shoved.", intent: "build a jenga tower", tags: "rigid stack" },
    // Toys
    { id: "toy-row", section: "toys", name: "Rainbow row", glyph: "🌈", blurb: "Five cubes in a row, one of each colour.", intent: "a row of five rainbow cubes in front of me", added: 2, tags: "planner" },
    { id: "toy-tower", section: "toys", name: "Crate tower", glyph: "📦", blurb: "Six crates stacked on the bench. Then: throw them.", intent: "stack 6 crates on the bench", added: 2, tags: "planner stack" },
    { id: "toy-circle", section: "toys", name: "Standing stones", glyph: "🗿", blurb: "A circle of pillars around you.", intent: "a circle of 8 white pillars around me", added: 2, tags: "planner henge" },
    { id: "toy-pyramid", section: "toys", name: "Pyramid", glyph: "🔺", blurb: "Ten gold blocks in a pyramid.", intent: "a pyramid of 10 gold cubes", added: 2, tags: "planner" },
    { id: "toy-scatter", section: "toys", name: "Ball pit", glyph: "🫧", blurb: "Twenty colourful balls scattered around.", intent: "scatter 20 colourful small balls around me", added: 2, tags: "planner" },
    { id: "toy-throw", section: "toys", name: "Throw it", glyph: "🤾", blurb: "Throw whatever is selected.", intent: "throw it", added: 2, tags: "planner physics" },
    { id: "toy-drop", section: "toys", name: "Drop it", glyph: "⬇", blurb: "Lift the selection up high and let it fall.", intent: "drop it", added: 2, tags: "planner physics" },
    { id: "toy-rope", section: "toys", name: "Rope swing", glyph: "🪢", blurb: "A rope to jump at and swing on.", intent: "hang a rope", tags: "swing" },
    { id: "toy-lights", section: "toys", name: "String lights", glyph: "💡", blurb: "Glowing bulbs from the bench to the terminal.", intent: "string lights between the bench and the terminal", tags: "rope cable" },
    { id: "toy-knock", section: "toys", name: "Knock it over", glyph: "💥", blurb: "Shove the dominoes or the tower.", intent: "knock them over", tags: "rigid" },
    // Life
    { id: "life-town", section: "life", name: "Townsfolk", glyph: "🏘", blurb: "People with traits, a plan for the day, faces and voices. Walk up and talk.", intent: "fill the plaza with people", tags: "npc town talk" },
    { id: "life-companion", section: "life", name: "Companion", glyph: "🤖", blurb: "Follows, fetches, stacks. Try “bring me the gold”.", intent: "summon a companion", tags: "pip helper" },
    { id: "life-follow", section: "life", name: "Follow me", glyph: "👣", blurb: "Your companion walks with you.", intent: "follow me" },
    { id: "life-fetch", section: "life", name: "Fetch the gold", glyph: "🥇", blurb: "Your companion brings you the gold.", intent: "bring me the gold" },
    { id: "life-critic", section: "life", name: "Critic", glyph: "🧐", blurb: "A second opinion stands in the room.", intent: "spawn a critic named Critic", tags: "agent" },
    // Effects
    { id: "fx-campfire", section: "effects", name: "Campfire", glyph: "🔥", blurb: "Shader flames, embers, smoke and warm light.", intent: "light a campfire", tags: "fire" },
    { id: "fx-burn", section: "effects", name: "Set it alight", glyph: "🧯", blurb: "Fire spreads by fuel and wind; put it out with water (H).", intent: "set the bench on fire", tags: "fire" },
    { id: "fx-out", section: "effects", name: "Put it out", glyph: "💧", blurb: "Rain on the flames.", intent: "put out the fire", tags: "fire water" },
    { id: "fx-rings", section: "effects", name: "Smoke rings", glyph: "💨", blurb: "Two vortex rings that leapfrog.", intent: "blow two smoke rings", tags: "vortex" },
    { id: "fx-cape", section: "effects", name: "Cape", glyph: "🦸", blurb: "A cloth cape that streams in the wind.", intent: "give me a violet cape", tags: "cloth" },
    { id: "fx-flag", section: "effects", name: "Flag", glyph: "🏳", blurb: "A 4D flag on a pole with a gold finial.", intent: "raise a flag", tags: "cloth" },
    { id: "fx-sword", section: "effects", name: "4D sword", glyph: "🗡", blurb: "A blade from the fourth dimension.", intent: "give me the 4d sword", tags: "hyper" },
    { id: "fx-sparkle", section: "effects", name: "Sparkle", glyph: "✨", blurb: "Glitter on the selection.", intent: "make it sparkle", tags: "glint" },
    { id: "fx-music", section: "effects", name: "Score the scene", glyph: "🎵", blurb: "Music for the room.", intent: "score this scene", tags: "sound" },
    // Gauges
    ...RIGS.map((rig) => ({ id: `rig-${rig.id}`, section: "gauges" as const, name: rig.label, glyph: "🏭", blurb: `A whole room of gauges (${rig.parts.length}).`, intent: `build the ${rig.label.toLowerCase()}`, tags: "gauges rig" })),
  ];
  for (const [id, name, glyph, tags] of SHAPES) {
    items.push({ id: `shape-${id}`, section: "shapes", name, glyph, blurb: `A ${name.toLowerCase()} in front of you.`, intent: id === "gaussian" ? "a splat" : `a ${id}`, tags });
  }
  items.push({ id: "shape-huge", section: "shapes", name: "Huge sphere", glyph: "🌕", blurb: "Sizes: tiny, small, big, huge.", intent: "a huge gold sphere in the middle", added: 2 });
  for (const [color, glyph] of COLORS) {
    items.push({ id: `color-${color}`, section: "materials", name: color[0].toUpperCase() + color.slice(1), glyph, blurb: `Paint the selection ${color}.`, intent: `paint it ${color}` });
  }
  items.push({ id: "color-rainbow", section: "materials", name: "Rainbow", glyph: "🌈", blurb: "A different colour for each of the last group.", intent: "paint them rainbow", added: 2 });
  for (const [texture, glyph] of TEXTURES) {
    items.push({ id: `tex-${texture}`, section: "materials", name: `${texture[0].toUpperCase()}${texture.slice(1)} texture`, glyph, blurb: `Wrap the selection in ${texture}.`, intent: `give it a ${texture} texture`, added: 2 });
  }
  for (const kind of GROWTH_KINDS) {
    items.push({ id: `grow-${kind}`, section: "effects", name: kind[0].toUpperCase() + kind.slice(1), glyph: kind === "moss" ? "🌿" : kind === "frost" ? "❄" : kind === "rust" ? "🟤" : "🔮", blurb: `Let ${kind} creep over the column.`, intent: `grow ${kind} on the column`, tags: "growth" });
  }
  for (const shape of HYPER_SHAPES) {
    items.push({ id: `hyper-${shape}`, section: "effects", name: shape === "tesseract" ? "4D bubble" : shape, glyph: "🫧", blurb: "A shape from the fourth dimension, turning through ours.", intent: shape === "tesseract" ? "make a 4d bubble" : `make a 4d ${shape}`, tags: "hyper 4d" });
  }
  const skies: [string, string, string][] = [
    ["Clear afternoon", "☀", "clear afternoon"],
    ["Golden hour", "🌇", "golden hour"],
    ["Rain at dusk", "🌧", "make it rain at dusk"],
    ["Thunderstorm", "⛈", "thunderstorm at night"],
    ["Snowy morning", "🌨", "snowy morning"],
    ["Foggy dawn", "🌫", "foggy dawn"],
    ["Midnight", "🌙", "midnight"],
  ];
  for (const [name, glyph, intent] of skies) items.push({ id: `sky-${name.toLowerCase().replace(/\s+/g, "-")}`, section: "sky", name, glyph, blurb: "Sky, sun, fog and light ease over.", intent, tags: "weather time" });
  for (const mood of MOODS) items.push({ id: `mood-${mood.id}`, section: "sky", name: `${mood.id[0].toUpperCase()}${mood.id.slice(1)} mood`, glyph: "🎭", blurb: `A ${mood.id} cast over the light.`, intent: `make it ${mood.words[0]}`, tags: "mood" });
  for (const stat of STATS) {
    const mesh = MESHES.find((m) => m.id === stat.mesh) ?? MESHES[0];
    items.push({ id: `gauge-${stat.id}`, section: "gauges", name: stat.label, glyph: "🌡", blurb: `${mesh.label} reading ${stat.label.toLowerCase()} live.`, intent: `add a ${stat.label.toLowerCase()} gauge`, tags: "gauge stat" });
  }
  for (const skin of SKINS) items.push({ id: `skin-${skin.id}`, section: "gauges", name: `${skin.label} gauges`, glyph: "🎚", blurb: `Restyle every gauge in ${skin.label.toLowerCase()}.`, intent: `make the gauges ${skin.label.toLowerCase()}`, tags: "skin" });
  for (const prim of PRIMITIVES) items.push({ id: `move-${prim.id}`, section: "moves", name: prim.id[0].toUpperCase() + prim.id.slice(1).replace(/-/g, " "), glyph: "🕺", blurb: "Do it now. Mix them in the Moves panel.", intent: prim.id.replace(/-/g, " "), tags: "emote" });
  return items;
}

export const CATALOG: CatalogItem[] = build();

/** Entries whose words or tags match the search, every word. */
export function searchCatalog(query: string, items: CatalogItem[] = CATALOG): CatalogItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const hay = `${item.name} ${item.blurb} ${item.intent} ${item.tags ?? ""} ${item.section}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** New since the catalog version you last opened on. */
export function isNew(item: CatalogItem, seenVersion: number): boolean {
  return (item.added ?? 1) > seenVersion;
}

const HIDDEN = ["helm", "floor", "presence", "worn"];

export type WorldRow = { id: number; name: string; kind: string; fresh: boolean };

/** What is in the world now, by kind, newest first; fresh when made after `seenId`. */
export function worldRows(world: Pick<World, "entities">, seenId: number): { kind: string; rows: WorldRow[] }[] {
  const groups = new Map<string, WorldRow[]>();
  const all = Object.values(world.entities).filter((e) => !e.tags.some((t) => HIDDEN.includes(t)));
  for (const e of all.sort((a, b) => b.id - a.id)) {
    const kind = kindLabel(e);
    const list = groups.get(kind) ?? [];
    list.push({ id: e.id, name: e.name, kind, fresh: e.id > seenId });
    groups.set(kind, list);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([kind, rows]) => ({ kind, rows }));
}

function kindLabel(e: Entity): string {
  if (e.tags.includes("architect")) return "You";
  if (e.tags.includes("npc")) return "Townsfolk";
  if (e.tags.includes("gauge")) return "Gauges";
  if (e.tags.includes("rigid")) return "Dominoes and blocks";
  if (e.tags.includes("rope")) return "Ropes and lights";
  if (e.tags.includes("hyper")) return "4D";
  if (e.tags.includes("agent")) return "Agents";
  if (e.tags.includes("lab")) return "The lab";
  if (e.tags.includes("tetris") || e.tags.includes("marble") || e.customData.play) return "Games";
  const r = e.representation;
  const asset = r.kind === "mesh" ? r.assetId : r.kind === "gaussian" ? "splat" : r.kind;
  return `${asset[0].toUpperCase()}${asset.slice(1)}s`;
}
