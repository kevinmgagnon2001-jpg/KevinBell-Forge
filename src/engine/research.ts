import { allowedAssetUrl } from "./asset-url.ts";
import { executeProposal, registerSkill } from "./harness.ts";
import type { ProposedAction, World } from "./types.ts";
import { avatarOf, focusId, mentionsAvatar } from "./vm.ts";

export type FieldNote = {
  ok: boolean;
  query: string;
  summary: string;
  title: string;
  source: string;
  imageUrl: string;
  error?: string;
};

export function wantsWeb(intent: string): boolean {
  return /\b(research|look up|lookup|search the web|search for|wikipedia|wikimedia|on the web|browse|surf the)\b/i.test(intent);
}

export function wantsAsset(intent: string): boolean {
  if (/\b(splat|neural|gaussian)\b/i.test(intent)) return true;
  return /\b(texture|photo|picture|image)\b/i.test(intent) && /\b(pull|download|place|onto|apply|wrap)\b/i.test(intent);
}

export function isFieldRequest(intent: string): boolean {
  return wantsWeb(intent) || wantsAsset(intent);
}

export function isLearning(intent: string): boolean {
  return /\b(learn|improve|teach yourself|from now on|add a skill|iterate)\b/i.test(intent);
}

export function isRefusal(result: string): boolean {
  return /your body and stays/i.test(result);
}

export function fieldQuery(intent: string): string {
  const cleaned = intent
    .replace(
      /\b(please|pull|download|research|look up|lookup|search(?: the web| for)?|find(?: me| a| an)?|a|an|the|onto|on|avatar|architect|yourself|texture|photo|picture|image|asset|reference|of|me|my|and|put|it|learn|to|how|do|i|what|is|improve|teach|yourself)\b/gi,
      " ",
    )
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || intent).slice(0, 140);
}

const HARNESS_TOOLS = new Set([
  "spawn_entity",
  "set_transform",
  "set_color",
  "edit_entity",
  "delete_entity",
  "control_avatar",
  "place_neural",
  "spawn_agent",
  "set_asset",
  "build_play",
  "play_move",
  "apply_method",
  "query_scene",
  "undo",
  "apply_force",
]);

/** A tool call written as JSON, from the model or from a page. Unknown tools are ignored. */
export function codeFromText(text: string): { tool: string; arguments: Record<string, string> } | null {
  const match = text.match(/\{[\s\S]{0,500}\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { tool?: unknown; toolName?: unknown; name?: unknown; arguments?: unknown };
    const tool = String(parsed.tool || parsed.toolName || parsed.name || "");
    if (!HARNESS_TOOLS.has(tool)) return null;
    const raw = parsed.arguments && typeof parsed.arguments === "object" ? (parsed.arguments as Record<string, unknown>) : {};
    const args: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" || typeof value === "number") args[key] = String(value).slice(0, 80);
    }
    return { tool, arguments: args };
  } catch {
    return null;
  }
}

function wantsPicture(intent: string): boolean {
  return /\b(pull|download|texture|photo|picture|image|reference|asset|look like)\b/i.test(intent);
}

function cardName(title: string): string {
  const words = title.replace(/^File:/i, "").replace(/\.[a-z0-9]{2,4}$/i, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.slice(0, 3).join("") || "Reference";
  return name.slice(0, 28);
}

function hostId(world: World, intent: string): string | null {
  if (mentionsAvatar(intent) || /\b(hold|wear|onto you)\b/i.test(intent)) {
    const avatar = avatarOf(world);
    if (avatar) return String(avatar.id);
  }
  const id = focusId(world, intent);
  if (id && id !== "*") return id;
  return null;
}

/** Apply a web note: answer in text, and pull a Wikimedia image onto a body or a new card. */
export function applyFieldNote(world: World, intent: string, note: FieldNote): {
  ok: boolean;
  world: World;
  result: string;
  proposal: ProposedAction;
} {
  const lines = [note.summary, note.source].filter(Boolean);
  const title = note.title || note.query || "reference";
  if (note.imageUrl && allowedAssetUrl(note.imageUrl)) {
    const host = hostId(world, intent);
    let current = world;
    let id = host;
    if (!id) {
      const spawned = executeProposal(current, {
        kind: "tool_call",
        toolName: "spawn_entity",
        arguments: { name: cardName(title), x: "2.4", y: "0", z: "1.6", asset: "card" },
      });
      if (!spawned.ok) {
        return {
          ok: false,
          world,
          result: spawned.result,
          proposal: { kind: "message", arguments: {}, message: spawned.result },
        };
      }
      current = spawned.world;
      id = String(current.nextId - 1);
    }
    const pulled = executeProposal(current, {
      kind: "tool_call",
      toolName: "set_asset",
      arguments: { id, src: note.imageUrl, title: title.slice(0, 80), page: note.source },
    });
    const proposal: ProposedAction = {
      kind: "tool_call",
      toolName: "set_asset",
      arguments: { id, src: note.imageUrl, title },
      message: "pulled from the web",
    };
    let next = pulled.ok ? pulled.world : current;
    if (isLearning(intent)) {
      next = registerSkill(next, {
        name: `field_${fieldQuery(intent).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 28) || "note"}`,
        description: intent.slice(0, 140),
        job: "field",
        steps: [{ tool: "set_asset", arguments: { id: "$id", src: note.imageUrl, title } }],
      });
    }
    return {
      ok: pulled.ok,
      world: next,
      result: [pulled.result, ...lines].filter(Boolean).join("\n"),
      proposal,
    };
  }
  if (wantsPicture(intent)) {
    return {
      ok: false,
      world,
      result: lines.join("\n") || note.error || "The web had no image for that.",
      proposal: { kind: "message", arguments: {}, message: note.error || "No image" },
    };
  }
  const answered = lines.join("\n") || note.error || "Nothing useful came back.";
  let next = world;
  if (isLearning(intent) && note.summary) {
    next = registerSkill(next, {
      name: `note_${fieldQuery(intent).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "web"}`,
      description: note.summary.slice(0, 160),
      job: "field",
      steps: [{ tool: "query_scene", arguments: { tag: "spawned" } }],
    });
  }
  return {
    ok: Boolean(note.summary || note.source),
    world: next,
    result: answered,
    proposal: { kind: "message", arguments: {}, message: "field note" },
  };
}
