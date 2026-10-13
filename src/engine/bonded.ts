import { colorWord } from "./color.ts";
import type { BondedModel, Entity, ProposedAction } from "./types.ts";

type SceneRef = { id: number; name: string; asset?: string };

export function nums(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.split(/[^0-9.+-]+/)) {
    if (!tok || tok === "+" || tok === "-" || tok === ".") continue;
    const n = Number(tok);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function resolveEntity(intent: string, scene: SceneRef[]): number | null {
  // "entity 3" / "id 3" / "#3" — not bare coordinates.
  const tagged = intent.matchAll(/\b(?:entity|id)\s*#?\s*(\d+)\b|#(\d+)\b/gi);
  for (const match of tagged) {
    const id = Number(match[1] ?? match[2]);
    if (scene.some((entity) => entity.id === id)) return id;
  }
  let best: SceneRef | null = null;
  const lower = intent.toLowerCase();
  for (const entity of scene) {
    if (entity.name.length >= 2 && lower.includes(entity.name.toLowerCase())) {
      if (!best || entity.name.length > best.name.length) best = entity;
    }
  }
  if (best) return best.id;
  const kinds = ["platform", "pillar", "sphere", "ring", "gaussian", "cube"] as const;
  for (const kind of kinds) {
    if (!lower.includes(kind)) continue;
    const matches = scene.filter((entity) => entity.asset === kind);
    if (matches.length === 1) return matches[0].id;
  }
  return null;
}

function assetFrom(lower: string): string {
  if (lower.includes("splat") || lower.includes("gaussian")) return "gaussian";
  if (lower.includes("sphere") || lower.includes("orb") || lower.includes("ball")) return "sphere";
  if (lower.includes("pillar") || lower.includes("column")) return "pillar";
  if (lower.includes("ring") || lower.includes("torus")) return "ring";
  if (lower.includes("platform") || lower.includes("slab") || lower.includes("deck")) return "platform";
  return "cube";
}

function nameFrom(intent: string, asset: string): string {
  const named = intent.match(/\bnamed\s+["']?([A-Za-z][\w-]*)/i);
  if (named) return named[1];
  switch (asset) {
    case "platform":
      return "Platform";
    case "sphere":
      return "Sphere";
    case "pillar":
      return "Pillar";
    case "ring":
      return "Ring";
    case "gaussian":
      return "Beacon";
    default:
      return "Unnamed";
  }
}

function stripId(values: number[], id: number | null): number[] {
  if (id == null) return values;
  const index = values.findIndex((value) => value === id);
  if (index < 0) return values;
  const next = values.slice();
  next.splice(index, 1);
  return next;
}

function modelNote(model: BondedModel, detail: string): string {
  return `[Bonded:${model.name} @ ${model.path}] ${detail}`;
}

/**
 * Heuristic driver that mirrors a tool-calling GGUF.
 * Query is matched before spawn so "tagged spawned" does not forge a new body.
 */
export function propose(
  model: BondedModel,
  intent: string,
  scene: SceneRef[],
  toolNames: string[],
): ProposedAction {
  if (!model.loaded) {
    return { kind: "message", arguments: {}, message: "Model not loaded" };
  }
  const lower = intent.toLowerCase();

  const isQuery = ["query", "find", "list", "count", "how many"].some((word) => lower.includes(word));
  if (isQuery && toolNames.includes("query_scene")) {
    const tagMatch = intent.match(/\btagged\s+["']?([A-Za-z][\w-]*)/i);
    const tag = tagMatch?.[1] ?? "spawned";
    return {
      kind: "tool_call",
      toolName: "query_scene",
      arguments: { tag },
      message: modelNote(model, "proposing query_scene"),
    };
  }

  if (
    ["velocity", "push", "impulse", "shove", "throw"].some((word) => lower.includes(word)) &&
    toolNames.includes("apply_velocity")
  ) {
    const id = resolveEntity(intent, scene);
    if (id == null) {
      return {
        kind: "message",
        arguments: {},
        message: modelNote(model, "no entity matched for apply_velocity"),
      };
    }
    const values = stripId(nums(intent), id);
    const [vx, vy, vz] = values.length >= 3 ? values : [1.4, 0.15, 0.35];
    return {
      kind: "tool_call",
      toolName: "apply_velocity",
      arguments: { id: String(id), vx: String(vx), vy: String(vy), vz: String(vz) },
      message: modelNote(model, "proposing apply_velocity"),
    };
  }

  const looksLikeMove =
    ["move", "reposition", "translate", "relocate", "set position"].some((word) => lower.includes(word));
  const editing = ["edit", "change", "recolor", "recolour", "paint", "colour", "color", "dye", "tint", "update", "modify"].some(
    (word) => lower.includes(word),
  );
  const makingNew = ["create", "spawn", "add", "forge", "another", "new"].some((word) => lower.includes(word));
  const tint = colorWord(intent);
  const namedId = resolveEntity(intent, scene);

  if (namedId != null && tint && toolNames.includes("set_color") && (editing || !makingNew)) {
    return {
      kind: "tool_call",
      toolName: "set_color",
      arguments: { id: String(namedId), color: tint },
      message: modelNote(model, "proposing set_color"),
    };
  }

  if ((looksLikeMove || (editing && namedId != null && stripId(nums(intent), namedId).length >= 3)) && toolNames.includes("set_transform")) {
    const id = resolveEntity(intent, scene);
    if (id == null) {
      return {
        kind: "message",
        arguments: {},
        message: modelNote(model, "no entity matched for set_transform"),
      };
    }
    const values = stripId(nums(intent), id);
    if (values.length < 3) {
      return {
        kind: "message",
        arguments: {},
        message: modelNote(model, "set_transform needs three coordinates"),
      };
    }
    const [x, y, z] = values;
    return {
      kind: "tool_call",
      toolName: "set_transform",
      arguments: { id: String(id), x: String(x), y: String(y), z: String(z) },
      message: modelNote(model, "proposing set_transform"),
    };
  }

  if (editing && namedId != null && !makingNew) {
    return {
      kind: "message",
      arguments: {},
      message: modelNote(model, "that object is already in the scene; say a color or a position to edit it"),
    };
  }

  const wantsSpawn = ["create", "spawn", "make", "forge", "add", "drop", "build"].some((word) => lower.includes(word));
  if (wantsSpawn && toolNames.includes("spawn_entity")) {
    const asset = assetFrom(lower);
    const name = nameFrom(intent, asset);
    const values = nums(intent);
    const [x, y, z] = values.length >= 3 ? values : [0, 0, 0];
    const arguments_: Record<string, string> = {
      name,
      x: String(x),
      y: String(y),
      z: String(z),
      asset,
    };
    if (tint) arguments_.color = tint;
    return {
      kind: "tool_call",
      toolName: "spawn_entity",
      arguments: arguments_,
      message: modelNote(model, "proposing spawn_entity"),
    };
  }

  return {
    kind: "message",
    arguments: {},
    message: modelNote(model, `intent acknowledged: ${intent}`),
  };
}

export function sceneRefs(entities: Record<number, Entity>): SceneRef[] {
  return Object.values(entities).map((entity) => ({
    id: entity.id,
    name: entity.name,
    asset:
      entity.representation.kind === "mesh"
        ? entity.representation.assetId
        : entity.representation.kind === "gaussian"
          ? "gaussian"
          : entity.representation.kind,
  }));
}

export function ggufMagicOk(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x47 && bytes[2] === 0x55 && bytes[3] === 0x46;
}
