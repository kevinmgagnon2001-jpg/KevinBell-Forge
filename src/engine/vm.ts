import { colorMentions, colorWord, huesMatch, normalizeColor } from "./color.ts";
import { executeProposal, registerSkill } from "./harness.ts";
import { deckProposal } from "./deck-bridge.ts";
import { compatProposal } from "./isa.ts";
import { portalProposal } from "./portal-tool.ts";
import { moduleDProposal } from "./module-d.ts";
import type { Entity, ProposedAction, Skill, World } from "./types.ts";

export type Job = "create" | "edit" | "delete" | "undo" | "query" | "push" | "field";

const EDIT_TOOLS = new Set(["edit_entity", "set_color", "set_transform", "control_avatar"]);

function roster(world: World): Entity[] {
  return Object.values(world.entities).sort((a, b) => a.id - b.id);
}

function live(world: World): Entity[] {
  return Object.values(world.entities)
    .filter((entity) => !entity.tags.includes("architect"))
    .sort((a, b) => a.id - b.id);
}

function assetOf(entity: Entity): string {
  if (entity.representation.kind === "mesh") return entity.representation.assetId;
  if (entity.representation.kind === "gaussian") return "gaussian";
  return entity.representation.kind;
}

function fingerprint(entity: Entity): string {
  const p = entity.transform.position;
  const s = entity.transform.scale;
  return [
    entity.name,
    assetOf(entity),
    entity.customData.color ?? "",
    p.x.toFixed(3),
    p.y.toFixed(3),
    p.z.toFixed(3),
    s.x.toFixed(3),
    s.y.toFixed(3),
    s.z.toFixed(3),
    entity.customData.yaw ?? "",
    entity.customData.src ?? "",
  ].join("|");
}

export function avatarOf(world: World): Entity | undefined {
  return roster(world).find((entity) => entity.tags.includes("architect"));
}

export function mentionsAvatar(intent: string): boolean {
  return /\b(avatar|architect|yourself|myself|my body)\b/i.test(intent) || /\b(you|me)\b/i.test(intent);
}

export function gesture(intent: string): string | null {
  const lower = intent.toLowerCase();
  if (/\b(turn|look|face) left\b/.test(lower)) return "turn-left";
  if (/\b(turn|look|face) right\b/.test(lower)) return "turn-right";
  if (/\b(walk|step)\b/.test(lower) && /\b(back|backward)\b/.test(lower)) return "back";
  if (/\bforward\b/.test(lower) && /\b(walk|step|go|avatar|you|me)\b/.test(lower)) return "forward";
  if (/\bwalk\b/.test(lower) && !/\bback\b/.test(lower)) return "forward";
  if (/\b(strafe|step) left\b/.test(lower)) return "left";
  if (/\b(strafe|step) right\b/.test(lower)) return "right";
  if (/\b(jump|rise|go up)\b/.test(lower)) return "up";
  if (/\b(crouch|go down)\b/.test(lower)) return "down";
  return null;
}

const NUDGE = 0.85;

/** A named object sliding, not the avatar walking. */
export function nudgeOf(intent: string): { x: number; y: number; z: number } | null {
  const lower = intent.toLowerCase();
  if (/\b(turn|look|face|walk)\b/.test(lower)) return null;
  if (!/\b(move|nudge|shift|slide|reposition|put|place)\b/.test(lower)) return null;
  if (/\bleft\b/.test(lower)) return { x: -NUDGE, y: 0, z: 0 };
  if (/\bright\b/.test(lower)) return { x: NUDGE, y: 0, z: 0 };
  if (/\b(forward|ahead)\b/.test(lower)) return { x: 0, y: 0, z: NUDGE };
  if (/\b(back|backward)\b/.test(lower)) return { x: 0, y: 0, z: -NUDGE };
  if (/\bup\b/.test(lower)) return { x: 0, y: NUDGE, z: 0 };
  if (/\bdown\b/.test(lower)) return { x: 0, y: -NUDGE, z: 0 };
  return null;
}

export function agentRequest(intent: string): { name: string; role: string } | null {
  if (!/\bagents?\b/i.test(intent)) return null;
  if (/\b(delete|remove|despawn|erase)\b/i.test(intent)) return null;
  const role = /critic/i.test(intent) ? "critic" : /scout/i.test(intent) ? "scout" : "builder";
  const named = intent.match(/\bnamed\s+([A-Za-z][A-Za-z0-9_-]{0,24})/);
  const name = named?.[1] ?? (role === "critic" ? "Critic" : role === "scout" ? "Scout" : "Builder");
  return { name, role };
}

export function wantsSecondModel(intent: string): boolean {
  return (
    /\b(second model|critic model|another (lm|model)|load the critic)\b/i.test(intent) ||
    (/\bcritic\b/i.test(intent) && /\b(spawn|summon|create|add|ask|review|iterate)\b/i.test(intent))
  );
}

const DIRECTION = new Set(["left", "right", "forward", "back", "backward", "ahead", "up", "down"]);

export function jobOf(intent: string, world: World, selected?: number | null, gaze?: number | null): Job {
  const lower = intent.toLowerCase();
  if (moduleDProposal(intent)) return "field";
  if (deckProposal(intent)) return "field";
  if (compatProposal(intent)) return "field";
  if (portalProposal(intent)) return "field";
  if (/\b(undo|revert|rollback)\b/.test(lower) || /\bgo back\b/.test(lower)) return "undo";
  if (/\b(delete|remove|despawn|destroy|erase|clear)\b/.test(lower)) return "delete";
  if (/\b(nanite|meshlets?|virtual geometry|virtualized geometry|cluster lod)\b/.test(lower)) return "create";
  if (/\b(query|find|list|count|how many)\b/.test(lower)) return "query";
  if (/\b(push|velocity|impulse|shove|throw)\b/.test(lower)) return "push";
  if (meshKind(intent) && /\b(import|load|mesh)\b/.test(lower) && !/\b(onto|selected)\b/.test(lower)) return "create";
  const playing = /\b(piece|tetris|block)\b/.test(lower);
  const wantsNew =
    /\b(create|spawn|add|forge|summon)\b/.test(lower) ||
    /\banother\b/.test(lower) ||
    /\bmake (a|an|another|new)\b/.test(lower) ||
    (/\bdrop\b/.test(lower) && !playing);
  const editVerb =
    /\b(edit|change|recolor|recolour|paint|dye|tint|update|modify|move|resize|scale|rename|bigger|smaller|taller|shorter|turn|walk|step|wrap|import)\b/.test(
      lower,
    );
  const pronoun = /\b(it|them|those|this|that|these|current|existing|already|selected)\b/.test(lower);
  const present = roster(world).length > 0;
  if (gesture(intent) && !wantsNew && present) return "edit";
  if ((editVerb || pronoun || focusId(world, intent, selected, gaze) != null || colorWord(intent) || mentionsAvatar(intent)) && !wantsNew && present) {
    return "edit";
  }
  if (wantsNew) return "create";
  if (live(world).length && (colorWord(intent) || editVerb)) return "edit";
  return "create";
}

function solidId(world: World, id: number | null | undefined, intent: string): string | null {
  if (id == null || !Number.isFinite(id)) return null;
  const entity = world.entities[id];
  if (!entity || entity.tags.includes("floor") || entity.tags.includes("helm")) return null;
  if (entity.tags.includes("architect") && !mentionsAvatar(intent)) return null;
  return String(entity.id);
}

const GENERIC_NAME = new Set(["piece", "block", "cube", "sphere", "platform", "pillar", "ring", "cell"]);

function descriptorColors(intent: string): string[] {
  const colors = colorMentions(intent);
  if (!colors.length) return [];
  const painting = /\b(paint|color|colour|recolor|recolour|dye|tint)\b/i.test(intent);
  const identifies = (word: string) =>
    new RegExp(
      `\\b${word}\\s+(block|blocks|piece|pieces|cube|cubes|sphere|spheres|orb|orbs|ball|balls|one|ones|cell|cells|brick|bricks|pillar|column|ring)\\b|\\b(?:the|a|an)\\s+${word}\\b`,
      "i",
    ).test(intent);
  if (!painting) return colors.filter(identifies);
  if (colors.length > 1) return colors.slice(0, -1).filter(identifies);
  return identifies(colors[0]) ? [colors[0]] : [];
}

function shapeWords(intent: string): string[] {
  const lower = intent.toLowerCase();
  const shapes: string[] = [];
  if (/\b(blocks?|cells?|bricks?)\b/.test(lower)) shapes.push("block");
  if (/\bpieces?\b/.test(lower)) shapes.push("piece");
  if (/\bcubes?\b/.test(lower)) shapes.push("cube");
  if (/\b(spheres?|balls?|orbs?)\b/.test(lower)) shapes.push("sphere");
  if (/\b(pillars?|columns?)\b/.test(lower)) shapes.push("pillar");
  if (/\brings?\b/.test(lower)) shapes.push("ring");
  if (/\b(platforms?|slabs?)\b/.test(lower)) shapes.push("platform");
  return shapes;
}

function shapeOk(entity: Entity, shapes: string[]): boolean {
  const asset = assetOf(entity);
  const cell = entity.tags.includes("live") || entity.tags.includes("locked");
  return shapes.some((shape) => {
    if (shape === "block" || shape === "piece") return cell;
    if (shape === "cube") return asset === "cube" && !cell;
    if (shape === "sphere") return asset === "sphere";
    if (shape === "pillar") return asset === "pillar";
    if (shape === "ring") return asset === "ring";
    if (shape === "platform") return asset === "platform";
    return asset === shape;
  });
}

function pieceLetter(intent: string): string | null {
  const lower = intent.toLowerCase();
  const match = lower.match(/\b([iotzsjl])(?:-|\s+)(?:piece|block|cell)s?\b|\b(?:piece|block)\s+([iotzsjl])\b|\bthe\s+([otszjl])\b/);
  const letter = match?.[1] || match?.[2] || match?.[3] || "";
  return letter ? letter.toUpperCase() : null;
}

/** A place in the sentence, not the direction of a nudge. "move left" is not "the left block". */
function spatialOf(intent: string): "left" | "right" | "top" | "bottom" | "front" | "back" | null {
  const lower = intent.toLowerCase();
  if (/\b(leftmost|on the left|the left (?:block|piece|cube|cell|one|sphere|brick))\b/.test(lower)) return "left";
  if (/\b(rightmost|on the right|the right (?:block|piece|cube|cell|one|sphere|brick))\b/.test(lower)) return "right";
  if (/\b(topmost|highest|upper|the top|on top)\b/.test(lower)) return "top";
  if (/\b(bottommost|lowest|the bottom|the lower)\b/.test(lower)) return "bottom";
  if (/\b(nearest|closest|frontmost)\b/.test(lower)) return "front";
  if (/\b(farthest|furthest|backmost)\b/.test(lower)) return "back";
  return null;
}

function extreme(list: Entity[], which: NonNullable<ReturnType<typeof spatialOf>>, avatar: Entity | undefined): Entity[] {
  const key = (entity: Entity) => {
    const p = entity.transform.position;
    if (which === "left") return p.x;
    if (which === "right") return -p.x;
    if (which === "top") return -p.y;
    if (which === "bottom") return p.y;
    if (which === "back") return -frontScore(entity, avatar);
    return frontScore(entity, avatar);
  };
  let best = Number.POSITIVE_INFINITY;
  for (const entity of list) best = Math.min(best, key(entity));
  return list.filter((entity) => key(entity) <= best + 0.05);
}

function frontScore(entity: Entity, avatar: Entity | undefined): number {
  const yaw = Number(avatar?.customData.yaw) || 0;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const origin = avatar?.transform.position ?? { x: 0, y: 0, z: 0 };
  const dx = entity.transform.position.x - origin.x;
  const dz = entity.transform.position.z - origin.z;
  return -(dx * fx + dz * fz);
}

/**
 * Objects named by a loose description: color, shape, tetris letter, or place.
 * Returns one id, a comma list, or null when the sentence is not describing a thing.
 */
function describeTargets(world: World, intent: string, selected?: number | null, gaze?: number | null): string | null {
  const avatar = avatarOf(world);
  let matches = live(world).filter((entity) => !entity.tags.includes("floor") && !entity.tags.includes("helm") && !entity.tags.includes("architect"));
  let used = false;
  const colors = descriptorColors(intent);
  if (colors.length) {
    used = true;
    matches = matches.filter((entity) => colors.some((color) => huesMatch(entity.customData.color, color)));
  }
  const shapes = shapeWords(intent);
  if (shapes.length) {
    used = true;
    matches = matches.filter((entity) => shapeOk(entity, shapes));
  }
  const letter = pieceLetter(intent);
  if (letter) {
    used = true;
    matches = matches.filter((entity) => (entity.customData.piece || "").toUpperCase() === letter);
  }
  const lower = intent.toLowerCase();
  if (/\b(falling|live)\b/.test(lower) || (/\bthe piece\b/.test(lower) && !letter)) {
    const falling = matches.filter((entity) => entity.tags.includes("live"));
    if (falling.length) {
      used = true;
      matches = falling;
    }
  }
  if (/\b(locked|stacked|settled|landed)\b/.test(lower)) {
    used = true;
    matches = matches.filter((entity) => entity.tags.includes("locked"));
  }
  const beside = lower.match(/\b(?:next to|beside|near)\s+(?:the\s+)?([a-z][\w-]*)/);
  if (beside && !DIRECTION.has(beside[1]) && !colorMentions(beside[1]).length) {
    const anchor = matches.find((entity) => entity.name.toLowerCase() === beside[1])
      ?? live(world).find((entity) => entity.name.toLowerCase() === beside[1]);
    if (anchor) {
      used = true;
      const others = matches.filter((entity) => entity.id !== anchor.id);
      others.sort((a, b) => distance(a, anchor) - distance(b, anchor));
      matches = others.slice(0, 1);
    }
  }
  if (!used || !matches.length) return null;
  const spatial = spatialOf(intent);
  if (spatial) matches = extreme(matches, spatial, avatar);
  if (!matches.length) return null;
  if (matches.length === 1) return String(matches[0].id);
  const deictic = /\b(it|this|that|selected|looking|looked|crosshair|cursor)\b/.test(lower);
  if (deictic) {
    const seen = matches.find((entity) => entity.id === gaze) ?? matches.find((entity) => entity.id === selected);
    if (seen) return String(seen.id);
  }
  return matches.map((entity) => entity.id).join(",");
}

function distance(a: Entity, b: Entity): number {
  const p = a.transform.position;
  const q = b.transform.position;
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
}

/** id, "*", a comma list, or null. A color word is not a name. "Piece" is not a unique name. */
export function focusId(world: World, intent: string, selected?: number | null, gaze?: number | null): string | null {
  const props = live(world);
  const lower = intent.toLowerCase();
  const avatar = avatarOf(world);
  const moved = intent.match(/\b(?:move|reposition|shift|nudge|put|place)\s+(?:the\s+)?([A-Za-z][\w-]*)/i);
  if (moved && !DIRECTION.has(moved[1].toLowerCase())) {
    const named = props.find((entity) => entity.name.toLowerCase() === moved[1].toLowerCase());
    if (named) return String(named.id);
  }
  if (avatar && mentionsAvatar(intent) && !/\bagents?\b/i.test(lower)) return String(avatar.id);
  const material = texturePack(intent) ?? (/\b(paint|color|colour|recolor|recolour|dye|tint)\b/.test(lower) ? colorToken(intent) : null);
  let best: Entity | null = null;
  for (const entity of props) {
    const name = entity.name.toLowerCase();
    if (name.length < 2 || !lower.includes(name) || GENERIC_NAME.has(name)) continue;
    if (material && name === material && !new RegExp(`\\bthe\\s+${name}\\b`, "i").test(intent)) continue;
    if (colorMentions(name).length && new RegExp(`\\b${name}\\s+(block|blocks|piece|pieces|cell|cells|brick|bricks)\\b`, "i").test(intent)) continue;
    if (!best || entity.name.length > best.name.length) best = entity;
  }
  if (best) return String(best.id);
  const described = describeTargets(world, intent, selected, gaze);
  if (described) return described;
  for (const kind of ["platform", "pillar", "sphere", "ring", "gaussian", "cube", "gem", "knot", "vase", "crystal"] as const) {
    if (!lower.includes(kind)) continue;
    const matches = props.filter((entity) => assetOf(entity) === kind && !entity.tags.includes("floor") && !entity.tags.includes("helm"));
    if (matches.length === 1) return String(matches[0].id);
  }
  if (/\b(all|every|everything|current objects|them|those|these)\b/.test(lower) && props.length) return "*";
  const aimed =
    /\b(it|this|that|selected|current|looking|looked|focused|focus|crosshair|cursor)\b/.test(lower) ||
    nudgeOf(intent) != null ||
    colorWord(intent) != null ||
    texturePack(intent) != null;
  if (aimed) {
    const seen = solidId(world, gaze, intent) ?? solidId(world, selected, intent);
    if (seen) return seen;
  }
  const picked = selected != null ? world.entities[selected] : undefined;
  if (picked && !picked.tags.includes("floor") && (nudgeOf(intent) || /\b(it|this|that|selected|current)\b/.test(lower))) {
    return String(picked.id);
  }
  if (/\b(it|this|that|current)\b/.test(lower) && props.length) return String(props[props.length - 1].id);
  if (/\b(it|this|that|me|you)\b/.test(lower) && avatar) return String(avatar.id);
  if (gesture(intent) && avatar) return String(avatar.id);
  if (/\b(clear|scene)\b/.test(lower) && /\b(delete|remove|despawn|destroy|erase|clear)\b/.test(lower) && props.length) {
    return "*";
  }
  return null;
}

function colorToken(intent: string): string | null {
  const colors = colorMentions(intent);
  return colors.length ? colors[colors.length - 1] : null;
}

function assetChange(intent: string): string | null {
  const match = intent.match(
    /\b(?:into|make it a|make it an|turn it into|turn into)\s+(?:a\s+|an\s+)?(cube|sphere|platform|pillar|ring|gaussian)\b/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

function renameTo(intent: string): string | null {
  const match = intent.match(/\b(?:rename(?:\s+\w+)?\s+to|call it|named)\s+([A-Za-z][A-Za-z0-9_-]{0,31})/i);
  return match?.[1] ?? null;
}

function scaleOf(intent: string): string | null {
  if (/\b(bigger|larger|taller|grow)\b/i.test(intent)) return "1.45";
  if (/\b(smaller|shorter|shrink)\b/i.test(intent)) return "0.7";
  const match = intent.match(/\bscale\s+([0-9]+(?:\.[0-9]+)?)/i);
  return match?.[1] ?? null;
}

function coordsOf(intent: string, proposal: ProposedAction): { x: string; y: string; z: string } | null {
  const moving = /\b(move|put|place|shift|position|to)\b/i.test(intent);
  if (!moving && proposal.toolName !== "set_transform") return null;
  const fromArgs = [proposal.arguments.x, proposal.arguments.y, proposal.arguments.z];
  if (fromArgs.every((value) => value != null && value.trim() !== "" && Number.isFinite(Number(value)))) {
    return { x: fromArgs[0], y: fromArgs[1], z: fromArgs[2] };
  }
  const nums = [...intent.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter((value) => Number.isFinite(value));
  if (nums.length < 3) return null;
  const [x, y, z] = nums.slice(-3);
  return { x: String(x), y: String(y), z: String(z) };
}

function editProposal(world: World, intent: string, proposal: ProposedAction, selected?: number | null, gaze?: number | null): ProposedAction {
  const id = focusId(world, intent, selected, gaze) ?? (proposal.arguments.id?.trim() || null);
  if (!id) {
    return {
      kind: "message",
      arguments: {},
      message: "Nothing matched. Say it loosely, like the yellow blocks, the left piece, or the blue sphere. Or look straight at it.",
    };
  }
  const painting = /\b(paint|color|colour|recolor|recolour|dye|tint)\b/i.test(intent);
  const described = descriptorColors(intent);
  const asset = assetChange(intent);
  const name = renameTo(intent);
  const scale = scaleOf(intent);
  const coords = coordsOf(intent, proposal);
  const tint = colorWord(intent);
  const applyColor = Boolean(tint) && (painting || described.length === 0 || (!scale && !asset && !coords));
  const color = applyColor ? tint : null;
  const onlyColor = color && !asset && !name && !scale && !coords;
  if (onlyColor) {
    return {
      kind: "tool_call",
      toolName: "set_color",
      arguments: { id, color },
      message: proposal.message,
    };
  }
  const args: Record<string, string> = { id };
  if (color) args.color = color;
  if (asset) args.asset = asset;
  if (name) args.name = name;
  if (scale) args.scale = scale;
  if (coords) Object.assign(args, coords);
  const beside = intent.match(/\b(?:next to|beside)\s+(?:the\s+)?([A-Za-z][\w-]*)/i);
  if (beside && !coords && !id.includes(",")) {
    const other = Object.values(world.entities).find((entity) => entity.name.toLowerCase() === beside[1].toLowerCase());
    const self = world.entities[Number(id)];
    if (other && self && other.id !== self.id) {
      args.x = String(Math.round((other.transform.position.x + 1.15) * 100) / 100);
      args.y = String(self.transform.position.y);
      args.z = String(other.transform.position.z);
    }
  }
  if (Object.keys(args).length === 1) {
    return {
      kind: "message",
      arguments: {},
      message: "Name a color, position, size, or shape to edit the existing object.",
    };
  }
  return { kind: "tool_call", toolName: "edit_entity", arguments: args, message: proposal.message };
}

function deleteProposal(world: World, intent: string, selected?: number | null, gaze?: number | null): ProposedAction {
  const id = focusId(world, intent, selected, gaze);
  if (!id) {
    return { kind: "message", arguments: {}, message: "Name the object to delete, or say everything." };
  }
  return { kind: "tool_call", toolName: "delete_entity", arguments: { id }, message: "delete" };
}

function meshKind(intent: string): string | null {
  const lower = intent.toLowerCase();
  if (/\b(gem|diamond|icosahedron)\b/.test(lower)) return "gem";
  if (/\b(knot|torus)\b/.test(lower)) return "knot";
  if (/\bvase\b/.test(lower)) return "vase";
  if (/\bcrystal\b/.test(lower)) return "crystal";
  if (/\bmesh\b/.test(lower)) return "gem";
  return null;
}

/** A texture pack named in the sentence. A bare color is not a pack, and "the clay red" stays a recolor. */
export function texturePack(intent: string): string | null {
  const lower = intent.toLowerCase();
  const named = lower.match(/\b(marble|circuit|chip|clay|ceramic|paper|steel|brick|grain|night)\b/);
  const wrapping = /\b(texture|wrap|albedo|coat|skin)\b/.test(lower);
  const painting = /\bpaint\b/.test(lower);
  if (!wrapping && !painting) return null;
  if (!named) return wrapping ? "marble" : null;
  const pack = named[1] === "chip" ? "circuit" : named[1] === "ceramic" ? "clay" : named[1];
  if (!wrapping && new RegExp(`\\bthe\\s+${pack}\\b`).test(lower)) return null;
  const colors = [...lower.matchAll(/\b(red|orange|amber|yellow|green|teal|blue|indigo|violet|pink|white|black|gray|grey|gold)\b/g)].map(
    (match) => match[1],
  );
  if (colors.some((color) => color !== pack)) return null;
  return pack;
}

function playMove(intent: string): string | null {
  const lower = intent.toLowerCase();
  if (/\b(rotate|spin|turn the piece)\b/.test(lower)) return "rotate";
  if (/\b(hard drop|drop)\b/.test(lower)) return "drop";
  if (/\bleft\b/.test(lower)) return "left";
  if (/\bright\b/.test(lower)) return "right";
  return null;
}

export function alignToJob(world: World, intent: string, proposal: ProposedAction, selected?: number | null, gaze?: number | null): ProposedAction {
  const field = moduleDProposal(intent) ?? deckProposal(intent) ?? compatProposal(intent) ?? portalProposal(intent);
  if (field) return field;
  const coloring = /\b(paint|color|colour|recolor|recolour|dye|tint|wrap|texture)\b/i.test(intent);
  const board = Object.values(world.entities).some((entity) => entity.customData.play === "tetris");
  const pieceMove =
    !coloring &&
    board &&
    (/\b(piece|block)\b/i.test(intent) ||
      (/\btetris\b/i.test(intent) && /\b(left|right|rotate|spin|drop)\b/i.test(intent) && !/\b(build|make|new|start)\b/i.test(intent)));
  if (pieceMove) {
    return {
      kind: "tool_call",
      toolName: "play_move",
      arguments: { move: playMove(intent) ?? "drop" },
      message: proposal.message,
    };
  }
  if (!coloring && /\bblocks\b/i.test(intent) && /\b(build|make|add|put|game|arcade|cabinet|play)\b/i.test(intent)) {
    return { kind: "tool_call", toolName: "build_play", arguments: { kind: "blocks" }, message: proposal.message };
  }
  if (!coloring && /\btetris\b/i.test(intent)) {
    return { kind: "tool_call", toolName: "build_play", arguments: { kind: "tetris" }, message: proposal.message };
  }
  if (/\bmarble\b/i.test(intent) && /\b(run|game|track|course)\b/i.test(intent) && !/\btexture\b/i.test(intent)) {
    return { kind: "tool_call", toolName: "build_play", arguments: { kind: "marble" }, message: proposal.message };
  }
  if (/\b(nanite|meshlets?|virtual geometry|virtualized geometry|cluster lod)\b/i.test(intent)) {
    return { kind: "tool_call", toolName: "apply_method", arguments: { name: "nanite" }, message: proposal.message };
  }
  if (/\b(paper|arxiv|locosplat|gpbd|xpbd)\b/i.test(intent) || (/\blatest\b/i.test(intent) && /\b(paper|research|code|method)\b/i.test(intent))) {
    const physics = /\b(marble|physics|xpbd|pbd|position-based|position based)\b/i.test(intent);
    return {
      kind: "tool_call",
      toolName: "apply_method",
      arguments: { name: physics ? "xpbd" : "gsplat" },
      message: proposal.message,
    };
  }
  const tex = texturePack(intent);
  if (tex) {
    const id = focusId(world, intent, selected, gaze);
    if (!id || id === "*") {
      return {
        kind: "message",
        arguments: {},
        message: "Look at a solid, or name it, before wrapping a texture.",
      };
    }
    return {
      kind: "tool_call",
      toolName: "set_asset",
      arguments: { id, src: `tex:${tex}`, title: tex },
      message: proposal.message,
    };
  }
  const mesh = meshKind(intent);
  if (mesh && /\b(import|load|mesh|spawn|make|add)\b/i.test(intent)) {
    const id = focusId(world, intent, selected, gaze);
    const onto = /\b(onto|on|selected|retexture|restyle)\b/i.test(intent);
    if (onto && id && id !== "*") {
      return {
        kind: "tool_call",
        toolName: "edit_entity",
        arguments: { id, asset: mesh },
        message: proposal.message,
      };
    }
    if (!/\b(onto|on the)\b/i.test(intent)) {
      return {
        kind: "tool_call",
        toolName: "spawn_entity",
        arguments: { name: mesh[0].toUpperCase() + mesh.slice(1), asset: mesh, x: "2.2", y: "0", z: "1.3" },
        message: proposal.message,
      };
    }
  }
  const summoned = agentRequest(intent);
  if (summoned) {
    return {
      kind: "tool_call",
      toolName: "spawn_agent",
      arguments: { name: summoned.name, role: summoned.role },
      message: proposal.message,
    };
  }
  const nudge = nudgeOf(intent);
  if (nudge && !mentionsAvatar(intent)) {
    const id = focusId(world, intent, selected, gaze);
    if (id && id !== "*") {
      const ids = id.split(",").filter((part) => {
        const entity = world.entities[Number(part)];
        return entity && !entity.tags.includes("architect") && !entity.tags.includes("floor");
      });
      if (ids.length > 1) {
        return {
          kind: "tool_call",
          toolName: "set_transform",
          arguments: { id: ids.join(","), x: String(nudge.x), y: String(nudge.y), z: String(nudge.z), delta: "1" },
          message: proposal.message,
        };
      }
      const entity = ids.length === 1 ? world.entities[Number(ids[0])] : undefined;
      if (entity) {
        const p = entity.transform.position;
        return {
          kind: "tool_call",
          toolName: "set_transform",
          arguments: {
            id: String(entity.id),
            x: String(Math.round((p.x + nudge.x) * 100) / 100),
            y: String(Math.round((p.y + nudge.y) * 100) / 100),
            z: String(Math.round((p.z + nudge.z) * 100) / 100),
          },
          message: proposal.message,
        };
      }
    }
  }
  const move = gesture(intent);
  if (move) {
    const id = focusId(world, intent, selected, gaze);
    if (!id || id === "*") {
      return { kind: "message", arguments: {}, message: "There is no body to move." };
    }
    return { kind: "tool_call", toolName: "control_avatar", arguments: { id, move }, message: proposal.message };
  }
  const job = jobOf(intent, world, selected, gaze);
  if (job === "delete" && mentionsAvatar(intent) && !/\bagents?\b/i.test(intent)) {
    return {
      kind: "message",
      arguments: {},
      message: "ArchitectAvatar is your body and stays. Move, turn, or recolor it.",
    };
  }
  if (job === "undo") return { kind: "tool_call", toolName: "undo", arguments: {}, message: proposal.message };
  if (job === "delete") {
    const resolved = focusId(world, intent, selected, gaze);
    if (resolved) return { kind: "tool_call", toolName: "delete_entity", arguments: { id: resolved }, message: proposal.message };
    if (proposal.kind === "tool_call" && proposal.toolName === "delete_entity" && proposal.arguments.id) return proposal;
    return deleteProposal(world, intent, selected, gaze);
  }
  if (job === "edit") {
    const resolved = focusId(world, intent, selected, gaze);
    if (resolved || colorWord(intent)) return editProposal(world, intent, proposal, selected, gaze);
    if (
      proposal.kind === "tool_call" &&
      EDIT_TOOLS.has(proposal.toolName ?? "") &&
      proposal.arguments.id &&
      (proposal.arguments.id === "*" || world.entities[Number(proposal.arguments.id)])
    ) {
      return proposal;
    }
    const learned = (world.skills ?? []).find((skill) => skill.job === "edit" && skillMatches(skill, intent));
    if (learned) {
      const id = focusId(world, intent, selected, gaze);
      if (id) {
        return {
          kind: "tool_call",
          toolName: learned.name,
          arguments: bindings(intent, proposal, id),
          message: `skill ${learned.name}`,
        };
      }
    }
    return editProposal(world, intent, proposal, selected, gaze);
  }
  if (job === "create" && proposal.kind === "tool_call" && proposal.toolName === "spawn_entity") return proposal;
  if (job === "query" && proposal.kind === "tool_call" && proposal.toolName === "query_scene") return proposal;
  if (job === "push") {
    const resolved = focusId(world, intent, selected, gaze);
    if (
      proposal.kind === "tool_call" &&
      proposal.toolName === "apply_velocity" &&
      resolved &&
      resolved !== "*" &&
      !resolved.includes(",")
    ) {
      return { ...proposal, arguments: { ...proposal.arguments, id: resolved } };
    }
    if (proposal.kind === "tool_call" && proposal.toolName === "apply_velocity") return proposal;
  }
  return proposal;
}

function skillMatches(skill: Skill, intent: string): boolean {
  const blob = JSON.stringify(skill.steps);
  if (blob.includes("$color")) return colorWord(intent) != null;
  if (blob.includes("$scale")) return scaleOf(intent) != null;
  if (blob.includes("$x")) return /\b(move|put|place|shift)\b/i.test(intent);
  return false;
}

function bindings(intent: string, proposal: ProposedAction, id: string): Record<string, string> {
  const args: Record<string, string> = { id };
  const color = colorWord(intent) ?? normalizeColor(proposal.arguments.color);
  if (color) args.color = color;
  const scale = scaleOf(intent);
  if (scale) args.scale = scale;
  const coords = coordsOf(intent, proposal);
  if (coords) Object.assign(args, coords);
  return args;
}

export function verifyJob(job: Job, before: World, after: World, intent: string, tool: string | undefined): { ok: boolean; reason: string } {
  const beforeIds = new Set(live(before).map((entity) => entity.id));
  const afterIds = new Set(live(after).map((entity) => entity.id));
  const added = [...afterIds].filter((id) => !beforeIds.has(id));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));
  if (job === "edit") {
    if (added.length) return { ok: false, reason: "edit spawned a new object instead of changing one" };
    const changed = roster(after).some((entity) => {
      const prior = before.entities[entity.id];
      return prior && fingerprint(prior) !== fingerprint(entity);
    });
    if (!changed) return { ok: false, reason: "edit did not change an existing object" };
    const painting = /\b(paint|color|colour|recolor|recolour|dye|tint)\b/i.test(intent);
    const color = painting ? colorWord(intent) : null;
    if (color && !roster(after).some((entity) => entity.customData.color === color)) {
      return { ok: false, reason: "the color did not land on an existing object" };
    }
    return { ok: true, reason: "existing object updated" };
  }
  if (job === "delete") {
    if (!removed.length) return { ok: false, reason: "nothing was deleted" };
    if (added.length) return { ok: false, reason: "delete also spawned an object" };
    return { ok: true, reason: "object removed" };
  }
  if (job === "create") {
    if (!added.length) return { ok: false, reason: "nothing new was created" };
    return { ok: true, reason: "object created" };
  }
  if (job === "undo") {
    if (tool !== "undo") return { ok: false, reason: "undo did not run" };
    return { ok: true, reason: "reverted" };
  }
  if (job === "field") {
    const ok =
      tool === "sandbox_list" ||
      tool === "sandbox_read" ||
      tool === "sandbox_write" ||
      tool === "search_web_clean" ||
      tool === "deck_bridge" ||
      tool === "compat_map" ||
      tool === "place_portal";
    return { ok, reason: ok ? "sandbox loopback finished" : "not a sandbox tool" };
  }
  if (job === "query") return { ok: tool === "query_scene", reason: tool === "query_scene" ? "listed" : "not a query" };
  if (job === "push") {
    const pushed = live(after).some((entity) => {
      const prior = before.entities[entity.id];
      const next = entity.physics?.velocity;
      const prev = prior?.physics?.velocity;
      return next && (next.x !== prev?.x || next.y !== prev?.y || next.z !== prev?.z);
    });
    return pushed ? { ok: true, reason: "velocity set" } : { ok: false, reason: "nothing was pushed" };
  }
  return { ok: false, reason: "unverified" };
}

function skillFrom(intent: string, job: Job, proposal: ProposedAction): Skill | null {
  if (proposal.kind !== "tool_call" || !proposal.toolName) return null;
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(proposal.arguments)) {
    if (key === "id") args.id = "$id";
    else if (key === "color") args.color = "$color";
    else if (key === "scale") args.scale = "$scale";
    else if (key === "x" || key === "y" || key === "z") args[key] = `$${key}`;
    else args[key] = value;
  }
  const name = `${job}_${Object.keys(args)
    .filter((key) => key !== "id")
    .sort()
    .join("_") || "act"}`.replace(/[^a-z0-9_]/g, "");
  return {
    name,
    description: intent.slice(0, 120),
    job,
    steps: [{ tool: proposal.toolName, arguments: args }],
  };
}

export type HarnessTrace = {
  proposal: ProposedAction;
  world: World;
  result: string;
  ok: boolean;
  attempts: { tool: string; ok: boolean; detail: string }[];
};

/**
 * Run one architect command on the manifold.
 * A call that does the wrong job is rolled back, repaired, and checked again.
 * A repair that had to teach a new tool is saved as a skill.
 */
export function runHarness(world: World, intent: string, proposal: ProposedAction, selected?: number | null, gaze?: number | null): HarnessTrace {
  const job = jobOf(intent, world, selected, gaze);
  const attempts: HarnessTrace["attempts"] = [];
  const first = alignToJob(world, intent, proposal, selected, gaze);
  if (first.kind !== "tool_call" || !first.toolName) {
    const detail = first.message ?? "No action";
    return { proposal: first, world, result: detail, ok: false, attempts: [{ tool: "message", ok: false, detail }] };
  }
  const ran = executeProposal(world, first);
  const check = verifyJob(job, world, ran.world, intent, first.toolName);
  const passed = ran.ok && check.ok;
  attempts.push({
    tool: first.toolName ?? first.kind,
    ok: passed,
    detail: passed ? check.reason : ran.ok ? check.reason : ran.result,
  });
  if (passed) {
    const rewritten = proposal.toolName && proposal.toolName !== first.toolName;
    if (!rewritten) return { proposal: first, world: ran.world, result: ran.result, ok: true, attempts };
    const skill = skillFrom(intent, job, first);
    const taught = skill ? registerSkill(ran.world, skill) : ran.world;
    const learned = Boolean(skill && taught.skills.some((item) => item.name === skill.name) && !(world.skills ?? []).some((item) => item.name === skill.name));
    const result = learned ? `${ran.result}\nSkill '${skill?.name}' saved. The harness can use it next time.` : ran.result;
    return { proposal: first, world: taught, result, ok: true, attempts };
  }

  const repaired = alignToJob(world, intent, { kind: "message", arguments: {}, message: check.reason }, selected, gaze);
  if (repaired.kind !== "tool_call" || repaired.toolName === first.toolName) {
    return {
      proposal: first,
      world,
      result: ran.ok ? check.reason : ran.result,
      ok: false,
      attempts,
    };
  }
  const again = executeProposal(world, repaired);
  const second = verifyJob(job, world, again.world, intent, repaired.toolName);
  attempts.push({
    tool: repaired.toolName ?? "repair",
    ok: again.ok && second.ok,
    detail: again.ok && second.ok ? again.result : second.reason,
  });
  if (!(again.ok && second.ok)) {
    return { proposal: repaired, world, result: second.reason, ok: false, attempts };
  }
  const skill = skillFrom(intent, job, repaired);
  const taught = skill ? registerSkill(again.world, skill) : again.world;
  const learned = skill && taught.skills.some((item) => item.name === skill.name) && !(world.skills ?? []).some((item) => item.name === skill.name);
  const result = learned ? `${again.result}\nSkill '${skill?.name}' saved for the next time.` : again.result;
  return { proposal: repaired, world: taught, result, ok: true, attempts };
}
