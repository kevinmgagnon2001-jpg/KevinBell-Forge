import { makeSpawned, playTetris, seatOffCenter } from "./manifold.ts";
import type { Entity, ProposedAction, World } from "./types.ts";

/**
 * Command shape from DroidDeck's agent bridge (docs/agent-control.md, schema 2).
 * Droid-Deck/DroidDeck, GPL-3.0. This file is not their code.
 * Their session is proot plus gamescope plus Proton. This one only drives the forge.
 * run, guest, cdp, env, override, and prefs stay off, the same split as their
 * debugging-tools toggle. Those would execute a guest or evaluate script.
 */

const PLAYER = new Set(["state", "start", "stop", "resume", "focus", "input"]);
const DEBUG = new Set(["run", "guest", "cdp", "env", "override", "prefs"]);
const KEYS: Record<string, string> = { left: "left", right: "right", up: "rotate", down: "down", confirm: "drop", back: "back" };

export type DeckResult = { ok: boolean; detail: string; world: World; code: number };

function deckOf(world: World): Entity | undefined {
  return Object.values(world.entities).find((entity) => entity.customData.method === "deck");
}

function report(world: World): string {
  const deck = deckOf(world);
  const body = {
    schema: 2,
    runtime: "forge-session",
    phase: deck?.customData.phase || "IDLE",
    focus: deck?.customData.focus || null,
    seq: Number(deck?.customData.seq) || 0,
    agent: { guest: false, commands: [...PLAYER] },
  };
  return `Deck bridge schema 2. Command shape from DroidDeck's agent bridge. Not proot, gamescope, Proton, or Steam.\n${JSON.stringify(body)}`;
}

function put(world: World, entity: Entity, patch: Record<string, string>): { world: World; entity: Entity } {
  const next = { ...entity, customData: { ...entity.customData, ...patch } };
  return { world: { ...world, entities: { ...world.entities, [next.id]: next } }, entity: next };
}

export function deckProposal(intent: string): ProposedAction | null {
  const lower = intent.toLowerCase();
  const named = /\b(droid\s*deck|deck session|deck bridge)\b/.test(lower);
  const verb = /\bdeck\b/.test(lower) && /\b(start|stop|resume|state|status|focus|input|session)\b/.test(lower);
  if (!named && !verb) return null;
  const message = "deck bridge";
  if (/\b(stop|end|quit)\b/.test(lower)) return { kind: "tool_call", toolName: "deck_bridge", arguments: { command: "stop" }, message };
  if (/\bresume\b/.test(lower)) return { kind: "tool_call", toolName: "deck_bridge", arguments: { command: "resume" }, message };
  if (/\b(state|status)\b/.test(lower)) return { kind: "tool_call", toolName: "deck_bridge", arguments: { command: "state" }, message };
  const key = lower.match(/\binput\s+(left|right|up|down|confirm|back)\b/);
  if (key) return { kind: "tool_call", toolName: "deck_bridge", arguments: { command: "input", key: key[1] }, message };
  if (/\bfocus\b/.test(lower)) {
    const id = lower.match(/\bfocus\s+(\d+)\b/);
    return { kind: "tool_call", toolName: "deck_bridge", arguments: { command: "focus", id: id?.[1] ?? "" }, message };
  }
  return { kind: "tool_call", toolName: "deck_bridge", arguments: { command: "start" }, message };
}

export function deckCommand(world: World, args: Record<string, string>): DeckResult {
  const command = (args.command ?? "").trim().toLowerCase();
  if (JSON.stringify(args).length > 4096) return { ok: false, code: 2, detail: "request too large", world };
  if (DEBUG.has(command)) {
    return {
      ok: false,
      code: 7,
      detail: `'${command}' is a DroidDeck debugging command. It stays off, so the bridge cannot run a guest or evaluate script.`,
      world,
    };
  }
  if (!PLAYER.has(command)) return { ok: false, code: 2, detail: `unknown deck command '${command}'`, world };

  if (command === "state") return { ok: true, code: 0, detail: report(world), world };

  if (command === "stop") {
    const deck = deckOf(world);
    if (!deck) return { ok: true, code: 0, detail: report(world), world };
    const next = put(world, deck, { phase: "IDLE", focus: "", seq: String((Number(deck.customData.seq) || 0) + 1) });
    return { ok: true, code: 0, detail: report(next.world), world: next.world };
  }

  if (command === "focus") {
    const deck = deckOf(world);
    if (!deck || deck.customData.phase !== "READY") return { ok: false, code: 4, detail: "deck session is not ready", world };
    const id = Number(args.id);
    if (!world.entities[id]) return { ok: false, code: 2, detail: "focus needs an entity id", world };
    const next = put(world, deck, { focus: String(id), seq: String((Number(deck.customData.seq) || 0) + 1) });
    return { ok: true, code: 0, detail: report(next.world), world: next.world };
  }

  if (command === "input") {
    const deck = deckOf(world);
    if (!deck || deck.customData.phase !== "READY") return { ok: false, code: 4, detail: "deck session is not ready", world };
    const move = KEYS[(args.key ?? "").trim().toLowerCase()];
    if (!move) return { ok: false, code: 2, detail: "input key is left, right, up, down, confirm, or back", world };
    const played = move === "back" ? world : playTetris(world, move);
    const live = deckOf(played) ?? deck;
    const next = put(played, live, { lastKey: args.key, seq: String((Number(live.customData.seq) || 0) + 1) });
    return { ok: true, code: 0, detail: `${report(next.world)}\ninput ${args.key}`, world: next.world };
  }

  const existing = deckOf(world);
  if (existing) {
    const next = put(world, existing, { phase: "READY", seq: String((Number(existing.customData.seq) || 0) + 1) });
    return { ok: true, code: 0, detail: report(next.world), world: next.world };
  }
  const spawned = seatOffCenter(
    world,
    makeSpawned(world.nextId, { name: "Deck", asset: "card", x: "-2.6", y: "1.1", z: "1.2", color: "teal" }),
    { x: "-2.6", y: "1.1", z: "1.2" },
  );
  spawned.customData = {
    ...spawned.customData,
    method: "deck",
    phase: "READY",
    focus: "",
    seq: "1",
    page: "https://github.com/Droid-Deck/DroidDeck/blob/main/docs/agent-control.md",
  };
  const ready = { ...world, entities: { ...world.entities, [spawned.id]: spawned }, nextId: world.nextId + 1 };
  return { ok: true, code: 0, detail: report(ready), world: ready };
}
