import { executeProposal, registerSkill } from "./harness.ts";
import type { ProposedAction, World } from "./types.ts";
import type { FieldNote } from "./research.ts";
import { avatarOf, focusId, mentionsAvatar } from "./vm.ts";

export type NeuralAsset = {
  id: string;
  name: string;
  kind: "splat";
  seed: number;
  count: number;
  palette: string;
  shape: "blob" | "column" | "ring" | "slab";
  source: string;
  bytes: number;
};

const MATERIALS: { test: RegExp; palette: string; shape?: NeuralAsset["shape"] }[] = [
  { test: /\bmarble\b/i, palette: "#f4f1ec,#d9d3cb,#b7b1a8,#8e8880" },
  { test: /\b(gold|gilded|brass)\b/i, palette: "#f0d48a,#d4a24a,#a9782e,#6e4e1e" },
  { test: /\b(wood|timber|oak)\b/i, palette: "#e6d2b0,#c4a574,#8d5a32,#5c3a22" },
  { test: /\b(metal|steel|iron|chrome)\b/i, palette: "#eef1f4,#d5d8dd,#9aa3af,#6e7681" },
  { test: /\b(leaf|leaves|foliage|tree|moss|grass)\b/i, palette: "#8fd19a,#3cba6f,#1f6b3a,#0e3b22", shape: "column" },
  { test: /\b(water|sea|ocean|ice)\b/i, palette: "#d5e7f7,#7eb6e8,#4c8df5,#1d4e89" },
  { test: /\b(brick|clay|terracotta)\b/i, palette: "#d7a08a,#c46a4a,#a84832,#6e2e22" },
  { test: /\b(glass|crystal)\b/i, palette: "#ffffff,#e7f6f6,#9fd4d6,#4aa7ad" },
  { test: /\b(stone|rock|concrete|granite)\b/i, palette: "#e7e2da,#c8c2b8,#8a8178,#5c574f" },
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shapeOf(text: string): NeuralAsset["shape"] {
  if (/\b(column|pillar|tower|tree|obelisk)\b/i.test(text)) return "column";
  if (/\b(ring|torus|wheel|halo)\b/i.test(text)) return "ring";
  if (/\b(slab|floor|ground|platform|rug|plane)\b/i.test(text)) return "slab";
  return "blob";
}

function paletteOf(text: string): { palette: string; shape?: NeuralAsset["shape"] } {
  for (const material of MATERIALS) {
    if (material.test.test(text)) return material;
  }
  return { palette: "#d7c4a3,#8a8178,#4c8df5,#2a2c31" };
}

export function neuralRecipe(name: string, summary: string, source: string): NeuralAsset {
  const title = (name || "Asset").replace(/\s+/g, " ").trim().slice(0, 42) || "Asset";
  const blob = `${title} ${summary}`;
  const material = paletteOf(blob);
  const shape = shapeOf(blob) === "blob" && material.shape ? material.shape : shapeOf(blob);
  const draft = {
    id: `n${hash(title + source).toString(16).slice(0, 8)}`,
    name: title,
    kind: "splat" as const,
    seed: hash(blob) % 100000,
    count: 220,
    palette: material.palette,
    shape,
    source: source.slice(0, 180),
    bytes: 0,
  };
  draft.bytes = JSON.stringify(draft).length;
  return draft;
}

export function mergeLibrary(current: NeuralAsset[], filed: NeuralAsset[]): NeuralAsset[] {
  const next = [...current];
  for (const asset of filed) {
    if (!asset?.id || next.some((item) => item.id === asset.id)) continue;
    next.push(asset);
  }
  return next.slice(-24);
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

function skillId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 28);
  const full = `place_${slug || "asset"}`;
  return full.slice(0, 40);
}

/** File a compact splat and place it. The skill is the injected code that can place it again. */
export function fileNeural(
  world: World,
  intent: string,
  note: FieldNote,
): { ok: true; world: World; result: string; proposal: ProposedAction; asset: NeuralAsset } {
  const asset = neuralRecipe(note.title || note.query || "Asset", `${intent} ${note.summary}`, note.source);
  const host = hostId(world, intent);
  const args: Record<string, string> = {
    title: asset.name,
    palette: asset.palette,
    seed: String(asset.seed),
    count: String(asset.count),
    shape: asset.shape,
    source: asset.source,
  };
  if (host) args.id = host;
  const placed = executeProposal(world, { kind: "tool_call", toolName: "place_neural", arguments: args });
  const skill = skillId(asset.name);
  const withSkill = registerSkill(placed.ok ? placed.world : world, {
    name: skill,
    description: `Neural splat ${asset.name} (${asset.bytes} B) from ${asset.source || "a local guess"}`.slice(0, 160),
    job: "create",
    steps: [{ tool: "place_neural", arguments: { ...args, id: "" } }],
  });
  const where = note.source ? `from ${note.source}` : "without a web page, from the words in the command";
  return {
    ok: true,
    world: withSkill,
    result: `Filed ${asset.name} as a ${asset.bytes} B neural splat ${where}. Injected skill ${skill}.`,
    proposal: {
      kind: "tool_call",
      toolName: "place_neural",
      arguments: args,
      message: "neural asset",
    },
    asset,
  };
}
