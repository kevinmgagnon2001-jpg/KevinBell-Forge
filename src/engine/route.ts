/**
 * Requests that need no model, in the order Forge tries them (store.ts submitIntent): fixed-vocabulary
 * readers for each system, then the general planner (planner.ts). Pure, so the order and every
 * catalog entry (catalog.ts) can be tested without a page.
 */
import { clothIntent } from "./cloth.ts";
import { companionIntent } from "./companion.ts";
import { fireIntent } from "./fire.ts";
import { gaugeIntent } from "./gauges.ts";
import { growthIntent } from "./growth.ts";
import { hyperIntent } from "./hyper.ts";
import { moveIntent } from "./motion.ts";
import { rigidIntent } from "./rigid.ts";
import { ropeIntent } from "./rope.ts";
import { skillIntent } from "./skillbook.ts";
import { soundIntent } from "./sounds.ts";
import { townIntent } from "./town.ts";
import { weatherIntent } from "./weather.ts";
import { smokeRingIntent } from "./vortex.ts";
import type { World } from "./types.ts";

export type Routed =
  /** One tool call; `title` heads the log line; `spawns` selects what it made; `showArgs` logs the call. */
  | { kind: "call"; title: string; tool: string; arguments: Record<string, string>; spawns?: boolean; showArgs?: boolean }
  /** Drawn only, nothing in the world changes (smoke rings). */
  | { kind: "rings"; count: number };

const POLITE = /^(?:(?:please|can you|could you)\s+)?/;
const MAKE = /(?:build|make|add|put|set up|give me|play|start|open)\b/;
const MANY = /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|dozen|few|some|several|row|line|stack|pile|tower|circle|grid|pyramid|wall|red|orange|yellow|green|teal|blue|indigo|violet|purple|pink|white|black|gr[ae]y|gold|big|small|tiny|huge)\b/i;

/** The first fixed reader that claims the words, or null (then the planner, then the model). */
export function routeIntent(world: World, selectedId: number | null, intent: string): Routed | null {
  const lower = intent.toLowerCase();
  const arcade = new RegExp(`^${POLITE.source}${MAKE.source}`, "i");
  // "build breakout", "build blocks", "build the marble run" (the cabinets and the run).
  if (arcade.test(lower) && /\b(breakout|brick ?breaker)\b/.test(lower) && !/\b(paint|colou?r|texture)\b/.test(lower)) {
    return { kind: "call", title: "Arcade", tool: "build_play", arguments: { kind: "breakout" } };
  }
  if (arcade.test(lower) && /\bblocks\b/.test(lower) && !/\b(paint|colou?r|texture)\b/.test(lower) && !MANY.test(lower)) {
    return { kind: "call", title: "Blocks", tool: "build_play", arguments: { kind: "blocks" } };
  }
  if (arcade.test(lower) && /\bmarble ?(?:run|track)\b/.test(lower)) {
    return { kind: "call", title: "Arcade", tool: "build_play", arguments: { kind: "marble" } };
  }
  const readers: [string, () => { tool: string; arguments: Record<string, string> } | null, boolean?, boolean?][] = [
    ["Moves", () => moveIntent(intent, world), false, true],
    ["4D", () => hyperIntent(intent), true],
    ["Companion", () => companionIntent(intent, world)],
  ];
  for (const [title, read, spawns, showArgs] of readers) {
    const call = read();
    if (call) return { kind: "call", title, tool: call.tool, arguments: call.arguments, spawns, showArgs };
  }
  const rings = smokeRingIntent(intent);
  if (rings) return { kind: "rings", count: rings.count };
  const more: [string, () => { tool: string; arguments: Record<string, string> } | null, boolean?, boolean?][] = [
    ["Toys", () => rigidIntent(intent)],
    ["Growth", () => growthIntent(intent)],
    ["Fire", () => fireIntent(intent)],
    ["Cloth", () => clothIntent(intent), true],
    ["Ropes", () => ropeIntent(intent), true],
    ["Town", () => townIntent(intent, world)],
    ["Skills", () => skillIntent(intent, world), true],
    ["Weather", () => weatherIntent(intent)],
    ["Sound", () => soundIntent(intent, world, selectedId)],
    ["Gauges", () => gaugeIntent(intent, world), true, true],
  ];
  for (const [title, read, spawns, showArgs] of more) {
    const call = read();
    if (call) return { kind: "call", title: title === "Sound" && call.tool !== "set_sound" ? "Finish" : title, tool: call.tool, arguments: call.arguments, spawns, showArgs };
  }
  return null;
}
