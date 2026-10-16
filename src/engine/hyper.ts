/**
 * 4D things in the world: bubbles that hold a polytope turning through four dimensions, and the hyper
 * sword you can hold (Hyper.tsx draws them; polytope.ts is the geometry). "Make a 4D bubble",
 * "put a 120-cell here", "give me the 4D sword", "put the sword away".
 */
import type { Entity, World } from "./types.ts";
import { IDENTITY, V3 } from "./types.ts";
import type { ShapeName } from "./polytope.ts";

export const HYPER_SHAPES: ShapeName[] = ["tesseract", "24-cell", "600-cell", "120-cell"];
export const HYPER_TAG = "hyper";

const WORDS: [ShapeName, RegExp][] = [
  ["120-cell", /\b(120[- ]?cell|hundred and twenty|dodecaplex|hecatonicosachoron)\b/],
  ["600-cell", /\b(600[- ]?cell|six hundred|tetraplex|hexacosichoron)\b/],
  ["24-cell", /\b(24[- ]?cell|twenty[- ]four|octaplex|icositetrachoron)\b/],
  ["tesseract", /\b(tesseract|hypercube|4d cube|four[- ]d(imensional)? cube)\b/],
];

export function shapeFrom(text: string): ShapeName | null {
  const lower = text.toLowerCase();
  for (const [shape, re] of WORDS) if (re.test(lower)) return shape;
  // "many pointed", "spiky", "crazy" bubbles get the most vertices.
  if (/\b(4d|four[- ]?d(imensional)?|hyper|multi[- ]?dimensional)\b/.test(lower)) return /\b(simple|plain|cube)\b/.test(lower) ? "tesseract" : "120-cell";
  return null;
}

const avatarOf = (world: World) => Object.values(world.entities).find((e) => e.tags.includes("architect"));

/** place_hyper: a 4D bubble floating in front of you (or at x, z). */
export function placeHyper(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const shape = (HYPER_SHAPES as string[]).includes(args.shape ?? "") ? (args.shape as ShapeName) : (shapeFrom(args.shape ?? "") ?? "120-cell");
  const me = avatarOf(world);
  const yaw = Number(me?.customData.yaw) || 0;
  const x = Number.isFinite(Number(args.x)) && args.x != null && args.x !== "" ? Number(args.x) : (me?.transform.position.x ?? 0) + Math.sin(yaw) * 2.4;
  const z = Number.isFinite(Number(args.z)) && args.z != null && args.z !== "" ? Number(args.z) : (me?.transform.position.z ?? 0) + Math.cos(yaw) * 2.4;
  const size = Math.max(0.4, Math.min(6, Number(args.size) || 1.4));
  const id = world.nextId;
  const entity: Entity = {
    id,
    name: args.name?.trim() || (shape === "tesseract" ? "Tesseract" : `${shape[0].toUpperCase()}${shape.slice(1)}`),
    transform: { position: V3(x, 1.1 + size / 2, z), rotation: { ...IDENTITY }, scale: V3(size, size, size) },
    representation: { kind: "mesh", assetId: "hyper" },
    physics: null,
    tags: ["spawned", HYPER_TAG],
    customData: { hyper: shape, color: "#b77bff" },
  };
  const counts: Record<ShapeName, string> = { tesseract: "16 corners, 32 edges", "24-cell": "24 corners, 96 edges", "600-cell": "120 corners, 720 edges", "120-cell": "600 corners, 1200 edges" };
  return {
    ok: true,
    detail: `A 4D bubble floats in front of you: a ${shape} (${counts[shape]}) turning through the fourth dimension. Its edges glow red, violet and green by how deep in w they are.`,
    world: { ...world, entities: { ...world.entities, [id]: entity }, nextId: id + 1 },
  };
}

/** wield: hold the hyper sword, or put it away (item none). */
export function wield(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const me = avatarOf(world);
  if (!me) return { ok: false, detail: "no body to hold it", world };
  const item = (args.item ?? "").trim().toLowerCase();
  if (/^(none|nothing|away|off|drop)$/.test(item)) {
    const { wield: _w, ...rest } = me.customData;
    return { ok: true, detail: "You put the sword away.", world: { ...world, entities: { ...world.entities, [me.id]: { ...me, customData: rest } } } };
  }
  return {
    ok: true,
    detail: "You hold the hyper sword: its blade is a hypercube turning through w, shedding ghost cubes.",
    world: { ...world, entities: { ...world.entities, [me.id]: { ...me, customData: { ...me.customData, wield: "hyper-sword" } } } },
  };
}

export type HyperCall = { tool: "place_hyper" | "wield"; arguments: Record<string, string> };

/** Plain requests, without a model. */
export function hyperIntent(intent: string): HyperCall | null {
  const text = intent.trim().toLowerCase().replace(/[’']/g, "");
  if (text.split(/\s+/).length > 12) return null;
  if (/\b(sword|blade)\b/.test(text)) {
    if (/\b(put|sheathe|sheath|drop|stow|lose)\b.*\b(away|sword|blade)\b|\bput away\b|\bno sword\b/.test(text)) return { tool: "wield", arguments: { item: "none" } };
    if (/\b(give|hold|draw|wield|equip|take|pull out|grab|get)\b/.test(text) || /^(4d|hyper|bubble|finns?)\b.*\bsword\b/.test(text)) return { tool: "wield", arguments: { item: "hyper-sword" } };
    return null;
  }
  const shape = shapeFrom(text);
  if (!shape) return null;
  if (/\b(paint|colou?r|delete|remove)\b/.test(text)) return null;
  const bubble = /\b(bubble|tesseract|hypercube|cell|polytope|4d|hyper)\b/.test(text);
  if (!bubble) return null;
  return { tool: "place_hyper", arguments: { shape } };
}
