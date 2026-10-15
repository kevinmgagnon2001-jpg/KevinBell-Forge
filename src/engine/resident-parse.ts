import { propose, sceneRefs } from "./bonded.ts";
import { NAMED_COLORS } from "./color.ts";
import { executeProposal } from "./harness.ts";
import { TOOL_NAMES, TOOLS } from "./os.ts";
import { gaugeCatalog } from "./gauges.ts";
import type { BondedModel, ProposedAction, World } from "./types.ts";
import { alignToJob } from "./vm.ts";

const TOOL_SET = new Set<string>(TOOL_NAMES);

const ASSETS = ["cube", "sphere", "platform", "pillar", "ring", "gaussian"] as const;

const COLOR_NAMES = NAMED_COLORS.map((color) => color.name).filter((name) => name !== "gray" && name !== "stone");

const MODEL_TOOLS = TOOLS.filter(
  (tool) =>
    tool.name !== "define_skill" &&
    tool.name !== "set_asset" &&
    tool.name !== "place_neural" &&
    tool.name !== "sandbox_list" &&
    tool.name !== "sandbox_read" &&
    tool.name !== "sandbox_write" &&
    tool.name !== "search_web_clean" &&
    tool.name !== "deck_bridge" &&
    tool.name !== "compat_map" &&
    tool.name !== "place_portal",
);

/** Tool notes passed into the resident model in the shape llama.cpp expects. */
export const FORGE_TOOLS = MODEL_TOOLS.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([key, kind]) => [
          key,
          key === "asset"
            ? { type: "string", enum: [...ASSETS] }
            : key === "color"
              ? { type: "string", enum: COLOR_NAMES }
              : kind === "string"
                ? { type: "string" }
                : { type: "number" },
        ]),
      ),
      required: Object.keys(tool.parameters).filter((key) => !tool.optional?.includes(key)),
    },
  },
}));

const COLOR_RULE = COLOR_NAMES.map((name) => `"${name}"`).join(" | ");

/**
 * Forces one tool-call object. Edit tools are listed before spawn so a flat
 * distribution does not default to creating another object.
 */
export const TOOL_GRAMMAR = `
root ::= steer | agent | undo | del | editc | editp | edits | paint | xform | vel | query | spawn | spawnc
steer ::= "{" "\\"tool\\":\\"control_avatar\\"" "," "\\"move\\":\\"" ("forward" | "back" | "left" | "right" | "up" | "down" | "turn-left" | "turn-right") "\\"" "}"
agent ::= "{" "\\"tool\\":\\"spawn_agent\\"" "," "\\"name\\":\\"" ident "\\"" "," "\\"role\\":\\"" ("builder" | "critic" | "scout") "\\"" "}"
undo ::= "{" "\\"tool\\":\\"undo\\"" "}"
del ::= "{" "\\"tool\\":\\"delete_entity\\"" "," id "}"
editc ::= "{" "\\"tool\\":\\"edit_entity\\"" "," id "," "\\"color\\":\\"" color "\\"" "}"
editp ::= "{" "\\"tool\\":\\"edit_entity\\"" "," id "," x "," y "," z "}"
edits ::= "{" "\\"tool\\":\\"edit_entity\\"" "," id "," "\\"scale\\":" num "}"
paint ::= "{" "\\"tool\\":\\"set_color\\"" "," id "," "\\"color\\":\\"" color "\\"" "}"
xform ::= "{" "\\"tool\\":\\"set_transform\\"" "," id "," x "," y "," z "}"
vel ::= "{" "\\"tool\\":\\"apply_velocity\\"" "," id "," vx "," vy "," vz "}"
query ::= "{" "\\"tool\\":\\"query_scene\\"" "," tag "}"
spawn ::= "{" "\\"tool\\":\\"spawn_entity\\"" "," name "," x "," y "," z "," asset "}"
spawnc ::= "{" "\\"tool\\":\\"spawn_entity\\"" "," name "," x "," y "," z "," asset "," "\\"color\\":\\"" color "\\"" "}"
name ::= "\\"name\\":\\"" ident "\\""
tag ::= "\\"tag\\":\\"" ident "\\""
asset ::= "\\"asset\\":\\"" ("cube" | "sphere" | "platform" | "pillar" | "ring" | "gaussian") "\\""
id ::= "\\"id\\":" num | "\\"id\\":\\"*\\""
x ::= "\\"x\\":" num
y ::= "\\"y\\":" num
z ::= "\\"z\\":" num
vx ::= "\\"vx\\":" num
vy ::= "\\"vy\\":" num
vz ::= "\\"vz\\":" num
color ::= ${COLOR_RULE}
ident ::= [A-Za-z] [A-Za-z0-9_-]*
num ::= "-"? [0-9]+ ("." [0-9]+)?
`.trim();

export type ResidentToolCall = { name: string; arguments: string };

function asArgs(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const args: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "tool" || key === "message" || key === "arguments") continue;
    if (item == null) continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      args[key] = String(item);
    }
  }
  return args;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const starts: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{") starts.push(index);
  }
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const slice = text.slice(starts[index]);
    const end = slice.lastIndexOf("}");
    if (end <= 0) continue;
    try {
      const parsed = JSON.parse(slice.slice(0, end + 1)) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const json = parsed as Record<string, unknown>;
      const named = typeof json.tool === "string" ? json.tool : typeof json.name === "string" ? json.name : "";
      if (TOOL_SET.has(named) || "message" in json || "tool" in json) return json;
    } catch {
      // Keep walking back to an earlier object. Thought dumps often contain stray braces.
    }
  }
  return null;
}

/** Pull one tool call out of a resident model's raw text. Never invents a call. */
export function parseResidentReply(raw: string): ProposedAction {
  const text = raw
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json|```/gi, "")
    .trim();
  const json = extractJsonObject(text);
  if (!json) {
    return { kind: "message", arguments: {}, message: text || "(empty model reply)" };
  }

  const named = typeof json.tool === "string" ? json.tool : typeof json.name === "string" ? json.name : "";
  if (!named || named === "null" || !TOOL_SET.has(named)) {
    const message = typeof json.message === "string" && json.message.trim() ? json.message.trim() : text;
    return { kind: "message", arguments: {}, message };
  }

  const nested = asArgs(json.arguments);
  const flat = asArgs(json);
  return {
    kind: "tool_call",
    toolName: named,
    arguments: Object.keys(nested).length ? nested : flat,
    message: "in situ",
  };
}

export function proposalFromToolCalls(calls: ResidentToolCall[]): ProposedAction | null {
  for (const call of calls) {
    if (!call.name || !TOOL_SET.has(call.name)) continue;
    let parsed: unknown = {};
    if (call.arguments.trim()) {
      try {
        parsed = JSON.parse(call.arguments) as unknown;
      } catch {
        parsed = {};
      }
    }
    return {
      kind: "tool_call",
      toolName: call.name,
      arguments: asArgs(parsed),
      message: "in situ",
    };
  }
  return null;
}

/**
 * The model proposes a tool. The harness then checks that the tool matches the
 * job, so a spawn cannot stand in for an edit, a delete, or an undo.
 */
export function interpretResident(
  world: World,
  label: string,
  intent: string,
  raw: string,
  toolCalls: ResidentToolCall[],
  model: BondedModel,
): ProposedAction {
  const parsed = proposalFromToolCalls(toolCalls) ?? parseResidentReply(raw);
  const aligned = alignToJob(world, intent, parsed);
  if (aligned.kind === "tool_call" && executeProposal(world, aligned).ok) {
    const redirected = aligned.toolName !== parsed.toolName;
    return {
      ...aligned,
      message: redirected
        ? `${label} chose ${aligned.toolName} after the harness checked the scene.`
        : `${label} chose ${aligned.toolName}`,
    };
  }
  const read = alignToJob(world, intent, propose(model, intent, sceneRefs(world.entities), TOOL_NAMES));
  if (read.kind === "tool_call" && executeProposal(world, read).ok) {
    return {
      ...read,
      message: `${label} did not choose a tool, so the harness read the command.`,
    };
  }
  if (aligned.kind === "message" && aligned.message) return aligned;
  return {
    kind: "message",
    arguments: {},
    message: `${label} did not choose a tool.`,
  };
}

const GAUGE_WORDS = /gauge|meter|stat|thermo|boiler|piston|coil|dial|skin|mesh|engine room|reactor/i;

export function residentPrompt(scene: string, intent: string): string {
  return [
    "Choose the one tool that fits the command. Reply with one JSON object and no other text.",
    "Entity 1 ArchitectAvatar is you. Move, turn, recolor, and resize that body. Never delete it.",
    "control_avatar steps you: move is forward, back, left, right, up, down, turn-left, or turn-right.",
    "spawn_agent adds another body. role is builder, critic, or scout. A critic is the second model.",
    "spawn_entity creates a NEW object only: name, x, y, z, asset, optional color.",
    "Never spawn to edit, recolor, move, resize, rename, or delete an object already listed.",
    "edit_entity changes an existing id: id plus color, x, y, z, scale, asset, or name.",
    "set_color recolors an existing id. set_transform moves an existing id. id may be one number or a comma list.",
    "You do not need an exact name. the yellow blocks, the left piece, the blue sphere, and the terminal are enough.",
    "delete_entity removes an existing id. id * removes every object except the avatar.",
    "undo reverts the last change. apply_velocity pushes an id. query_scene lists a tag.",
    "asset is cube, sphere, platform, pillar, ring, or gaussian.",
    `color is ${COLOR_NAMES.join(", ")}.`,
    "A new object sits on the platform, off its center.",
    // Only when the command is about gauges: every line here is prompt the small model must read first.
    ...(GAUGE_WORDS.test(intent)
      ? [`place_gauge shows a live device stat as a machine: stat, optional mesh and skin. style_gauge id (or *) plus mesh, skin or stat. build_gauge_rig rig. ${gaugeCatalog()}`]
      : []),
    "Scene id name asset color x,y,z:",
    scene || "(empty)",
    `Command: ${intent}`,
  ].join("\n");
}
