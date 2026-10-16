import { gaugeCatalog } from "./gauges.ts";
import type { ToolSchema } from "./types.ts";

/** Builtin tools registered by AetherOS, in registration order. */
export const TOOLS: ToolSchema[] = [
  {
    name: "spawn_entity",
    description: "Spawn a new object. Not for editing one that already exists. Place it off the platform center.",
    parameters: {
      name: "string",
      x: "f32",
      y: "f32",
      z: "f32",
      asset: "string",
      color: "string",
    },
    optional: ["color"],
  },
  {
    name: "set_transform",
    description: "Move an existing entity. Use this to edit a position, not to create a new object.",
    parameters: {
      id: "u64",
      x: "f32",
      y: "f32",
      z: "f32",
    },
  },
  {
    name: "set_color",
    description: "Recolor an existing entity. Use this instead of spawning when the command edits a color.",
    parameters: {
      id: "u64",
      color: "string",
    },
  },
  {
    name: "edit_entity",
    description: "Change an existing entity. Use this instead of spawn when the command edits, recolors, moves, resizes, or renames. scale grows it evenly; sx, sy, sz stretch one axis (sy 1.5 is taller). finish glint makes it sparkle (snow, glitter, metal flake), plain takes that off.",
    parameters: {
      id: "u64",
      name: "string",
      color: "string",
      x: "f32",
      y: "f32",
      z: "f32",
      asset: "string",
      scale: "f32",
      sx: "f32",
      sy: "f32",
      sz: "f32",
      finish: "string",
    },
    optional: ["name", "color", "x", "y", "z", "asset", "scale", "sx", "sy", "sz", "finish"],
  },
  {
    name: "repeat",
    description:
      "Do the last change again, or run a saved skill by name. words are tweaks: taller, bigger, smaller, wider, a colour, to the left/right/in front/behind, higher, 3 times. Copies go to the next free spot.",
    parameters: { skill: "string", words: "string", times: "f32" },
    optional: ["skill", "words", "times"],
  },
  {
    name: "save_skill",
    description: "Keep the last count changes (default 1) as a named skill that can be run again by name, anywhere, with tweaks.",
    parameters: { name: "string", count: "f32", description: "string" },
    optional: ["count", "description"],
  },
  {
    name: "list_skills",
    description: "List the skills this world has learned.",
    parameters: {},
  },
  {
    name: "delete_entity",
    description: "Remove an existing entity. id * removes every entity except the avatar.",
    parameters: { id: "u64" },
  },
  {
    name: "undo",
    description: "Revert the last change to the scene.",
    parameters: {},
  },
  {
    name: "define_skill",
    description: "Teach the harness a named skill that runs one existing tool. The engine also saves a skill when a call had to be corrected.",
    parameters: {
      name: "string",
      tool: "string",
      description: "string",
      args: "string",
      job: "string",
    },
    optional: ["description", "args", "job"],
  },
  {
    name: "control_avatar",
    description: "Step or turn a body. move is forward, back, left, right, up, down, turn-left, or turn-right. Omit id to move your avatar.",
    parameters: { id: "u64", move: "string" },
    optional: ["id"],
  },
  {
    name: "spawn_agent",
    description: "Spawn another agent in the scene. role is builder, critic, or scout. A critic is the second opinion.",
    parameters: { name: "string", role: "string" },
  },
  {
    name: "set_asset",
    description: "Attach a Wikimedia image or a lab texture (tex:marble, tex:circuit, tex:clay, tex:paper, tex:steel, tex:brick, tex:grain, tex:night) to an existing id.",
    parameters: { id: "u64", src: "string", title: "string", page: "string" },
    optional: ["title", "page"],
  },
  {
    name: "place_neural",
    description: "Place a compact neural splat from the asset library. Tiny recipe, splat render.",
    parameters: {
      id: "u64",
      title: "string",
      palette: "string",
      seed: "f32",
      count: "f32",
      shape: "string",
      source: "string",
    },
    optional: ["id", "seed", "count", "shape", "source"],
  },
  {
    name: "build_play",
    description: "Build a playable Tetris well, a marble run, or a Blocks arcade cabinet (the drag-and-place block puzzle). kind is tetris, marble or blocks.",
    parameters: { kind: "string" },
  },
  {
    name: "play_move",
    description: "Move the live Tetris piece. move is left, right, rotate, down, or drop.",
    parameters: { move: "string" },
  },
  {
    name: "make_move",
    description:
      "Make a move (an emote or animation) and keep it. words describe it from primitives: wave, cheer, clap, point, salute, bow, shrug, flex, think, stretch, dance, jumping jacks, sit, look around, facepalm; with left/right, fast/slow, big/small, N times, 'then' between steps, 'upper body' to keep walking, 'keep' to loop. Or give keys as JSON keyframes [{t:0..1,pose:{joint:{x,y,z}}}] with length seconds; joints are root pelvis chest head hipL hipR kneeL kneeR shoulderL shoulderR elbowL elbowR.",
    parameters: { name: "string", words: "string", keys: "string", length: "f32", loop: "bool" },
    optional: ["name", "words", "keys", "length", "loop"],
  },
  {
    name: "do_move",
    description: "Do a move now: a kept move's name, or words to build one on the spot (as make_move), or stop. id is the figure (default you).",
    parameters: { move: "string", id: "u64" },
    optional: ["id"],
  },
  {
    name: "apply_method",
    description:
      "Run a local stand-in for a research method. name is gsplat (LoCoSplat-style densify), xpbd (position projection), or nanite (cluster LOD cut). Never executes remote code.",
    parameters: { name: "string" },
  },
  {
    name: "query_scene",
    description: "Query entities by tag",
    parameters: { tag: "string" },
  },
  {
    name: "apply_velocity",
    description: "Set velocity on a physics-enabled entity",
    parameters: {
      id: "u64",
      vx: "f32",
      vy: "f32",
      vz: "f32",
    },
  },
  {
    name: "sandbox_list",
    description: "List note files in the jailed sandbox. Does not run them or leave the directory.",
    parameters: { path: "string" },
    optional: ["path"],
  },
  {
    name: "sandbox_read",
    description: "Read one .md, .txt, or .json note from the sandbox. Does not execute it.",
    parameters: { path: "string" },
  },
  {
    name: "sandbox_write",
    description: "Write one text note into the sandbox. Cannot leave the sandbox or run a shell.",
    parameters: { path: "string", text: "string" },
  },
  {
    name: "search_web_clean",
    description: "Fetch a public page in a child process and file the markdown. Does not execute the page.",
    parameters: { query: "string" },
  },
  {
    name: "deck_bridge",
    description:
      "Drive the forge session. command is state, start, stop, resume, focus, or input. Guest commands run, guest, and cdp stay off.",
    parameters: { command: "string", key: "string", id: "string" },
    optional: ["key", "id"],
  },
  {
    name: "compat_map",
    description:
      "Translate a closed x86/ARM program through one IR, list gaps, or learn sub after the flagship fixture passes. Does not run unknown bytes.",
    parameters: { command: "string", hex: "string", arch: "string" },
    optional: ["hex", "arch"],
  },
  {
    name: "place_portal",
    description: "Place a portal to another island (a forge://host:port/slug address) in front of the avatar. Walking into it visits that island.",
    parameters: { address: "string" },
  },
  {
    name: "place_gauge",
    description: `Place a machine that shows a live device stat (gauges.ts). ${gaugeCatalog()} mesh and skin are optional; x and z place it, else it takes the next free spot.`,
    parameters: { stat: "string", mesh: "string", skin: "string", name: "string", x: "f32", z: "f32" },
    optional: ["mesh", "skin", "name", "x", "z"],
  },
  {
    name: "style_gauge",
    description: "Change the mesh, skin or stat of gauges. id is one id, a comma list, or * for every gauge.",
    parameters: { id: "string", mesh: "string", skin: "string", stat: "string" },
    optional: ["mesh", "skin", "stat"],
  },
  {
    name: "set_weather",
    description:
      "Change the weather, time of day or mood live. words is a phrase (rain at dusk, foggy morning, snow at midnight, rainy tokyo alley, stop the rain, 7pm, speed up time). Or set numbers: hour 0-24, cloud rain snow fog wind storm 0-1, mood neon eerie cozy dreamy cold apocalyptic or none, flow (game minutes per second).",
    parameters: { words: "string", hour: "f32", cloud: "f32", rain: "f32", snow: "f32", fog: "f32", wind: "f32", storm: "f32", mood: "string", flow: "f32" },
    optional: ["words", "hour", "cloud", "rain", "snow", "fog", "wind", "storm", "mood", "flow"],
  },
  {
    name: "set_sound",
    description:
      "Give an entity a sound from words (creak, chime, hum, whoosh, drip, beep, crackle, engine, thunder, squeak, knock, bubble, purr, zap, pop, choir; with ghostly, deep, high, loud, quiet, slow, fast, keep looping), or id scene for the scene's music (calm, sad, happy, spooky). words none removes it.",
    parameters: { id: "string", words: "string" },
  },
  {
    name: "fill_town",
    description: "Add people who live here: each has a plan for the day, remembers what they do, and walks round others. count (default 8), place a named spot to make them its regulars.",
    parameters: { count: "f32", place: "string" },
    optional: ["count", "place"],
  },
  {
    name: "ask_town",
    description: "What a townsperson did today and is doing now (name), or who is about (no name).",
    parameters: { name: "string" },
    optional: ["name"],
  },
  {
    name: "send_npc",
    description: "Send a townsperson (name, or everyone) to a place by name, or home.",
    parameters: { name: "string", place: "string" },
  },
  {
    name: "place_hyper",
    description: "Place a 4D bubble: a regular polytope turning through the fourth dimension inside an iridescent bubble. shape is tesseract, 24-cell, 600-cell or 120-cell (the most vertices). size in metres.",
    parameters: { shape: "string", x: "f32", z: "f32", size: "f32", name: "string" },
    optional: ["shape", "x", "z", "size", "name"],
  },
  {
    name: "wield",
    description: "Hold the hyper sword (item hyper-sword), whose blade is a hypercube turning through 4D, or put it away (item none).",
    parameters: { item: "string" },
  },
  {
    name: "build_gauge_rig",
    description: "Place a whole room of gauges at once (engine-room, steam, cyber). skin overrides the rig's own.",
    parameters: { rig: "string", skin: "string" },
    optional: ["skin"],
  },
];

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);

export const MEMORY_BUDGET_MB = 4096;

/** Default GGUF path kept for the scripted driver. Live intents use the in-page Gemma resident. */
export const DEFAULT_MODEL_PATH = "models/gemma-4-E2B_q4_0-it.gguf";

export const ENGINE_SCRIPT = [
  "Create a small platform near the origin",
  "Query anything tagged spawned",
] as const;

/** A short pass through the lab. Does not replace solids with splats. */
export const LAB_TOUR = [
  "Paint the cube named Clay teal",
  "Walk the avatar forward",
  "Spawn a critic agent named Critic",
  "Push DropOrb upward",
] as const;

/** Court built only by bonded intents. Wording avoids query/move/push traps on spawns. */
export const DEMO_SCRIPT = [
  "Create a platform named Court at 0, 0, 0",
  "Create a pillar named North at 0, 0, -4",
  "Create a pillar named South at 0, 0, 4",
  "Create a pillar named East at 4, 0, 0",
  "Create a pillar named West at -4, 0, 0",
  "Create a ring named Halo at 0, 2.8, 0",
  "Create a gaussian beacon named Beacon at 0, 1.8, 0",
  "Create a sphere named Orb at 6, 4, 2",
  "Push Orb upward at velocity 0.4, 7.2, 0.15",
  "Query anything tagged spawned",
] as const;

export function toolByName(name: string): ToolSchema | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
