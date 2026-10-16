import { create } from "zustand";
import { propose, sceneRefs } from "./bonded";
import { nearestColorName } from "./color";
import { executeProposal } from "./harness";
import { gaugeIntent } from "./gauges";
import { cleanMoves, moveIntent } from "./motion";
import { cleanWeather, weatherIntent } from "./weather";
import { soundIntent } from "./sounds";
import { cleanTown, townIntent } from "./town";
import { hyperIntent } from "./hyper";
import { ropeIntent } from "./rope";
import { clothIntent } from "./cloth";
import { fireIntent } from "./fire";
import { growthIntent } from "./growth";
import { companionIntent, companionOf, companionPrompt, ordersFromModel } from "./companion";
import { cleanBest } from "./arcade";
import { cleanRecent, MAX_SKILLS, skillIntent, skillBrief } from "./skillbook";
import { bootWorld, ensureAvatar, ensureHelm, labWorld, stepWorld } from "./manifold";
import { DEFAULT_MODEL_PATH, MEMORY_BUDGET_MB, TOOL_NAMES } from "./os";
import { DEFAULT_RESIDENT_ID, isResidentId, residentById, type ResidentId } from "./resident-catalog";
import { completeCritic, criticReady, ensureCritic, releaseCritic } from "./critic";
import { mergeLibrary, type NeuralAsset } from "./library";
import type { BondedModel, LogEntry, PluginKind, ProposedAction, Skill, World } from "./types";
import { ENGINE_VERSION, GROK_MODEL } from "./types";
import { chatResident, completeResident, ensureResident, releaseResident, residentReady } from "./resident";
import { researchTask } from "./research-call";
import { runModuleD } from "./module-d-call";
import { settleIntent } from "./turn";
import { currentGaze } from "@/components/forge/look";
import { runHarness, wantsSecondModel } from "./vm";
import type { MechanicPackage } from "./mechanic";

const STORAGE_KEY = "aetherforge-manifold-v2";

export type ForgeState = World & {
  osTicks: number;
  history: LogEntry[];
  logSeq: number;
  selectedId: number | null;
  running: boolean;
  busy: boolean;
  plugin: PluginKind;
  model: BondedModel;
  memoryBudgetMb: number;
  ticksPerIntent: number;
  residentId: ResidentId;
  residentPower: boolean;
  residentStatus: "off" | "loading" | "ready" | "error";
  residentProgress: number;
  residentLoaded: number;
  residentTotal: number;
  residentDetail: string;
  residentHeld: boolean;
  criticPower: boolean;
  criticStatus: "off" | "loading" | "ready" | "error";
  criticProgress: number;
  criticDetail: string;
  library: NeuralAsset[];
  /** Mechanics this person has (made, built in, or kept from someone else), newest last. */
  mechanics: MechanicPackage[];
  /** The mechanic they move with: a package hash, or "" for the engine's own walking. */
  moverHash: string;
  /** Add a mechanic (already checked) to the library. */
  keepMechanic: (pkg: MechanicPackage) => void;
  dropMechanic: (hash: string) => void;
  setMover: (hash: string) => void;
  stepSim: (count?: number) => void;
  setRunning: (running: boolean) => void;
  select: (id: number | null) => void;
  submitIntent: (intent: string) => Promise<void>;
  submitScript: (intent: string) => Promise<void>;
  bootResident: () => Promise<void>;
  /** Switched off for this launch only (e.g. no download on mobile data); the saved choice stays on. */
  holdResident: (detail: string) => void;
  setResidentPower: (power: boolean) => void;
  setResidentModel: (id: ResidentId) => void;
  setCriticPower: (power: boolean) => void;
  bootCritic: () => Promise<void>;
  dispatchManual: (name: string, args: Record<string, string>) => void;
  setPlugin: (plugin: PluginKind) => void;
  setTicks: (ticks: number) => void;
  importGguf: (fileName: string, magicOk: boolean) => string | null;
  reset: () => void;
  despawn: (id: number) => void;
  hydrate: () => void;
  /** Add lines to the log from outside the harness (file drops, portals, the Linux layer). */
  note: (entries: Omit<LogEntry, "id">[]) => void;
  /** Replace the world with one built outside the harness (a visited island placed beside ours). */
  adopt: (world: World, entries: Omit<LogEntry, "id">[]) => void;
};

function demoModel(): BondedModel {
  return { name: "demo-bonded", path: DEFAULT_MODEL_PATH, loaded: true, validated: false };
}

function bootHistory(): { history: LogEntry[]; logSeq: number } {
  const history: LogEntry[] = [
    {
      id: 1,
      tone: "engine",
      title: "Boot",
      body: `AetherForge v${ENGINE_VERSION} — engine-as-harness`,
    },
    {
      id: 2,
      tone: "engine",
      title: "Resident",
      body: "The lab is live. The helm on the architect is the computer you wear. ForgeTerminal on the bench is the same manifold, standing in the room.",
    },
    {
      id: 3,
      tone: "engine",
      title: "Avatar",
      body: "Architect Avatar entity id: 1",
    },
    {
      id: 4,
      tone: "engine",
      title: "Tools",
      body: TOOL_NAMES.join(", "),
    },
  ];
  return { history, logSeq: history.length + 1 };
}

function freshCore() {
  const world = labWorld();
  const terminal = Object.values(world.entities).find((entity) => entity.tags.includes("terminal"));
  return {
    ...world,
    osTicks: 0,
    selectedId: (terminal?.id ?? 1) as number | null,
    running: false,
    busy: false,
    plugin: "demo" as PluginKind,
    model: demoModel(),
    memoryBudgetMb: MEMORY_BUDGET_MB,
    ticksPerIntent: 3,
    residentId: DEFAULT_RESIDENT_ID,
    residentPower: true,
    residentStatus: "loading" as const,
    residentProgress: 0,
    residentLoaded: 0,
    residentTotal: 0,
    residentDetail: "Fetching Gemma into this page",
    residentHeld: false,
    criticPower: false,
    criticStatus: "off" as const,
    criticProgress: 0,
    criticDetail: "Second model is off. Spawn a critic when you want another opinion.",
    library: [] as NeuralAsset[],
    mechanics: [] as MechanicPackage[],
    moverHash: "",
    ...bootHistory(),
  };
}

function megabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1048576;
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

function argLine(args: Record<string, string>): string {
  const parts = Object.entries(args).map(([key, value]) => `${key}=${value}`);
  return parts.length ? parts.join("  ") : "—";
}

type Persisted = {
  world: World;
  osTicks: number;
  history: LogEntry[];
  logSeq: number;
  selectedId: number | null;
  plugin: PluginKind;
  model: BondedModel;
  ticksPerIntent: number;
  residentId: ResidentId;
  residentPower: boolean;
  criticPower: boolean;
  library?: NeuralAsset[];
  mechanics?: MechanicPackage[];
  moverHash?: string;
};

const MAX_MECHANICS = 12;

/** Keep only what looks like a mechanic package; each is checked in full before it ever runs. */
function cleanMechanics(value: unknown): MechanicPackage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is MechanicPackage => !!p && typeof p === "object" && (p as MechanicPackage).forge === "mechanic" && typeof (p as MechanicPackage).hash === "string")
    .slice(-MAX_MECHANICS);
}

function cleanLibrary(value: unknown): NeuralAsset[] {
  if (!Array.isArray(value)) return [];
  const assets: NeuralAsset[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const item = row as NeuralAsset;
    if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.palette !== "string") continue;
    assets.push(item);
  }
  return assets.slice(-24);
}

function isEntityRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every((entity) => {
    if (!entity || typeof entity !== "object") return false;
    const row = entity as { id?: unknown; name?: unknown; tags?: unknown; transform?: { position?: unknown } };
    return typeof row.id === "number" && typeof row.name === "string" && !!row.transform?.position && Array.isArray(row.tags);
  });
}

function sceneBrief(world: World): string {
  const all = Object.values(world.entities).sort((a, b) => a.id - b.id);
  const cells = all.filter((entity) => entity.tags.includes("live") || entity.tags.includes("locked"));
  const cellIds = new Set(cells.map((entity) => entity.id));
  const rest = all.filter((entity) => !cellIds.has(entity.id));
  const lineOf = (entity: (typeof all)[number]) => {
    const position = entity.transform.position;
    const asset =
      entity.representation.kind === "mesh"
        ? entity.representation.assetId
        : entity.representation.kind === "gaussian"
          ? "gaussian"
          : entity.tags.includes("architect")
            ? "you"
            : "agent";
    const who = entity.tags.includes("architect") ? "you" : entity.tags.includes("agent") ? entity.customData.role || "agent" : asset;
    return `${entity.id} ${entity.name} ${who} ${nearestColorName(entity.customData.color)} ${position.x.toFixed(1)},${position.y.toFixed(1)},${position.z.toFixed(1)}`;
  };
  const lines = rest.slice(0, 16).map(lineOf);
  if (rest.length > 16) lines.push(`…${rest.length - 16} more`);
  const groups = new Map<string, typeof cells>();
  for (const cell of cells) {
    const key = `${(cell.customData.piece || "?").toUpperCase()}|${nearestColorName(cell.customData.color)}|${cell.tags.includes("live") ? "falling" : "stacked"}`;
    const list = groups.get(key) ?? [];
    list.push(cell);
    groups.set(key, list);
  }
  for (const [key, list] of groups) {
    const [piece, color, state] = key.split("|");
    const ids = list.map((entity) => entity.id).join(",");
    lines.push(`${ids} ${piece} ${color} ${state} tetris x${list.length}`);
  }
  return lines
    .concat(skillBrief(world).slice(-6))
    .join("\n");
}

let residentBoot: Promise<void> | null = null;

export const useForge = create<ForgeState>((set, get) => {
  const pushLog = (entries: Omit<LogEntry, "id">[]) => {
    set((state) => {
      let seq = state.logSeq;
      const made = entries.map((entry) => ({ ...entry, id: seq++ }));
      return { history: [...state.history, ...made].slice(-80), logSeq: seq };
    });
  };

  const commit = (world: World, selectedId: number | null, entries: Omit<LogEntry, "id">[]) => {
    set((state) => {
      let seq = state.logSeq;
      const made = entries.map((entry) => ({ ...entry, id: seq++ }));
      return {
        ...world,
        selectedId,
        history: [...state.history, ...made].slice(-80),
        logSeq: seq,
      };
    });
  };

  const finish = (proposal: ProposedAction, userTitle: string, userBody: string, modelTitle: string) => {
    const latest = get();
    const executed = executeProposal(latest, proposal);
    const selected =
      proposal.kind === "tool_call" && proposal.arguments.id
        ? Number(proposal.arguments.id) || latest.selectedId
        : latest.selectedId;
    const spawned = executed.world.nextId > latest.nextId ? executed.world.nextId - 1 : null;
    commit(
      executed.world,
      spawned ?? (selected != null && executed.world.entities[selected] ? selected : latest.selectedId),
      [
        { tone: "user", title: userTitle, body: userBody },
        {
          tone: "model",
          title: proposal.toolName ? `${modelTitle} · ${proposal.toolName}` : modelTitle,
          body: `${proposal.message ?? "No action"}\n${argLine(proposal.arguments)}`,
        },
        { tone: executed.ok ? "engine" : "warn", title: executed.ok ? "Result" : "Failed", body: executed.result },
      ],
    );
  };

  return {
    ...freshCore(),
    stepSim: (count = 1) => {
      set((state) => {
        const world = stepWorld(state, count);
        const steps = world.tick - state.tick;
        return { ...world, osTicks: state.osTicks + steps };
      });
    },
    setRunning: (running) => set({ running }),
    select: (id) => set({ selectedId: id }),
    submitIntent: async (intentRaw) => {
      const intent = intentRaw.trim().slice(0, 400);
      if (!intent) return;
      // A typed forge:// address needs no model (nor waits for one): the harness places the portal itself.
      if (/forge:\/\/\S+/i.test(intent)) {
        const before = get();
        const ran = runHarness(before, intent, { kind: "message", arguments: {}, message: "" }, before.selectedId);
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Portal", body: ran.result },
        ]);
        return;
      }
      // "send diagnostics" / "report a problem: the boiler flickers" opens the report (diagnostics.ts).
      const report = intent.match(/^(?:send|report|file)\b.*?\b(?:diagnostics|report|problem|bug|issue)\b\s*[:,-]?\s*(.*)$/i);
      if (report) {
        const { sendDiagnostics } = await import("@/components/forge/diagnostics-recorder");
        const ok = await sendDiagnostics(report[1] ?? "").catch(() => false);
        pushLog([
          { tone: "user", title: "Intent", body: intent },
          { tone: ok ? "engine" : "warn", title: "Diagnostics", body: ok ? "The report is open as a GitHub issue. Review it and submit; the next build session reads it." : "Could not open the report." },
        ]);
        return;
      }
      // "build breakout" (the Hyper Breakout cabinet) needs no model.
      if (/^(?:(?:please|can you|could you)\s+)?(?:build|make|add|put|set up|give me)\b.*\b(breakout|brick ?breaker)\b/i.test(intent) && !/\b(paint|colou?r|texture)\b/i.test(intent)) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: "build_play", arguments: { kind: "breakout" } });
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Arcade", body: ran.result },
        ]);
        return;
      }
      // "build blocks" (the Blocks cabinet) needs no model either.
      if (/^(?:(?:please|can you|could you)\s+)?(?:build|make|add|put|set up|give me)\b.*\bblocks\b/i.test(intent) && !/\b(paint|colou?r|texture)\b/i.test(intent)) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: "build_play", arguments: { kind: "blocks" } });
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Blocks", body: ran.result },
        ]);
        return;
      }
      // Moves ("wave", "do a little dance", "make a move called victory: cheer then flex") are picks
      // and words from a fixed vocabulary (motion.ts), so they run now too.
      const moveCall = moveIntent(intent, get());
      if (moveCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: moveCall.tool, arguments: moveCall.arguments });
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Moves", body: `${moveCall.tool} ${argLine(moveCall.arguments)}\n${ran.result}` },
        ]);
        return;
      }
      // 4D bubbles and the hyper sword ("make a 4d bubble", "give me the 4d sword") (hyper.ts).
      const hyperCall = hyperIntent(intent);
      if (hyperCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: hyperCall.tool, arguments: hyperCall.arguments });
        const spawned = ran.world.nextId > before.nextId ? ran.world.nextId - 1 : before.selectedId;
        commit(ran.ok ? ran.world : before, spawned, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "4D", body: ran.result },
        ]);
        return;
      }
      // The companion ("follow me", "bring me the gold", "stack the cubes here") (companion.ts).
      const companionCall = companionIntent(intent, get());
      if (companionCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: companionCall.tool, arguments: companionCall.arguments });
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Companion", body: ran.result },
        ]);
        return;
      }
      // Spoken to by name in words it does not know ("Pip, tidy up the cubes"): the resident model
      // rewrites them in the companion's little language.
      const buddy = companionOf(get());
      if (buddy && intent.trim().toLowerCase().startsWith(buddy.name.toLowerCase()) && get().residentPower && residentReady(get().residentId)) {
        const words = intent.trim().slice(buddy.name.length).replace(/^[,:\s]+/, "");
        const line = ordersFromModel(await chatResident(companionPrompt(words, get())).catch(() => ""));
        const before = get();
        const ran = line ? executeProposal(before, { kind: "tool_call", toolName: "order_companion", arguments: { words: line } }) : null;
        commit(ran?.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran?.ok ? "engine" : "warn", title: "Companion", body: ran ? `${line}\n${ran.result}` : `${buddy.name} doesn't know how to do that yet.` },
        ]);
        return;
      }
      // Growth ("grow moss on the column", "frost the bench", "let the steel rust") (growth.ts).
      const growCall = growthIntent(intent);
      if (growCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: growCall.tool, arguments: growCall.arguments });
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Growth", body: ran.result },
        ]);
        return;
      }
      // Fire ("set the bench on fire", "light a campfire", "put out the fire") (fire.ts).
      const fireCall = fireIntent(intent);
      if (fireCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: fireCall.tool, arguments: fireCall.arguments });
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Fire", body: ran.result },
        ]);
        return;
      }
      // Capes and flags ("give me a red cape", "raise a flag") (cloth.ts).
      const clothCall = clothIntent(intent);
      if (clothCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: clothCall.tool, arguments: clothCall.arguments });
        const spawned = ran.world.nextId > before.nextId ? ran.world.nextId - 1 : before.selectedId;
        commit(ran.ok ? ran.world : before, spawned, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Cloth", body: ran.result },
        ]);
        return;
      }
      // Ropes, cables and string lights ("string lights between the bench and the terminal") (rope.ts).
      const ropeCall = ropeIntent(intent);
      if (ropeCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: ropeCall.tool, arguments: ropeCall.arguments });
        const spawned = ran.world.nextId > before.nextId ? ran.world.nextId - 1 : before.selectedId;
        commit(ran.ok ? ran.world : before, spawned, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Ropes", body: ran.result },
        ]);
        return;
      }
      // Townsfolk ("fill the plaza with people", "what did Mia do today?", "send Leo to the bench") (town.ts).
      const townCall = townIntent(intent, get());
      if (townCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: townCall.tool, arguments: townCall.arguments });
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Town", body: ran.result },
        ]);
        return;
      }
      // Skills ("do that again, but taller", "remember that as lamp", "lamp to the left") (skillbook.ts).
      const skillCall = skillIntent(intent, get());
      if (skillCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: skillCall.tool, arguments: skillCall.arguments });
        const spawned = ran.world.nextId > before.nextId ? ran.world.nextId - 1 : before.selectedId;
        commit(ran.ok ? ran.world : before, spawned, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Skills", body: ran.result },
        ]);
        return;
      }
      // Weather and time ("make it rain at dusk", "foggy morning", "7pm") come from fixed tables (weather.ts).
      const weatherCall = weatherIntent(intent);
      if (weatherCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: weatherCall.tool, arguments: weatherCall.arguments });
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Weather", body: ran.result },
        ]);
        return;
      }
      // Sounds and sparkle ("make the door creak like a ghost ship", "score this scene", "make it sparkle").
      const soundCall = soundIntent(intent, get(), get().selectedId);
      if (soundCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: soundCall.tool, arguments: soundCall.arguments });
        commit(ran.ok ? ran.world : before, before.selectedId, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: soundCall.tool === "set_sound" ? "Sound" : "Finish", body: ran.result },
        ]);
        return;
      }
      // Gauge requests ("add a neon thermometer", "make the gauges brass", "build the engine room") are
      // plain picks from fixed lists (gauges.ts), so they run now, with the model off or busy.
      const gaugeCall = gaugeIntent(intent, get());
      if (gaugeCall) {
        const before = get();
        const ran = executeProposal(before, { kind: "tool_call", toolName: gaugeCall.tool, arguments: gaugeCall.arguments });
        const spawned = ran.world.nextId > before.nextId ? ran.world.nextId - 1 : before.selectedId;
        commit(ran.ok ? ran.world : before, spawned, [
          { tone: "user", title: "Intent", body: intent },
          { tone: ran.ok ? "engine" : "warn", title: "Gauges", body: `${gaugeCall.tool} ${argLine(gaugeCall.arguments)}\n${ran.result}` },
        ]);
        return;
      }
      if (get().busy) return;
      const spec = residentById(get().residentId);
      if (!get().residentPower) {
        pushLog([
          { tone: "user", title: "Intent", body: intent },
          { tone: "warn", title: "Model off", body: `${spec.short} is powered down. Turn it on to forge.` },
        ]);
        return;
      }
      set({ busy: true });
      try {
        if (!residentReady(spec.id)) await get().bootResident();
        const live = get();
        if (!live.residentPower || live.residentId !== spec.id) return;
        if (!residentReady(spec.id)) {
          pushLog([
            { tone: "user", title: "Intent", body: intent },
            { tone: "warn", title: spec.short, body: live.residentDetail || "Model is not loaded." },
          ]);
          return;
        }
        if (wantsSecondModel(intent) && !get().criticPower) {
          get().setCriticPower(true);
        }
        const before = get();
        const critique =
          before.criticPower
            ? async (prompt: string) => (criticReady() ? completeCritic(prompt) : completeResident(prompt))
            : null;
        const settled = await settleIntent({
          world: before,
          intent,
          label: spec.short,
          model: before.model,
          scene: [
            sceneBrief(before),
            ...before.library.slice(-4).map((asset) => `library ${asset.name} splat ${asset.bytes}B`),
          ]
            .filter(Boolean)
            .join("\n"),
          proposeTurn: (prompt) => completeResident(prompt),
          critiqueTurn: critique,
          research: async (query, failure) => researchTask({ data: { query, failure } }),
          moduleD: (call) => runModuleD({ data: call }),
          focus: before.selectedId,
          gaze: currentGaze(),
        });
        const trace = settled.trace;
        const idArg = Number(trace.proposal.arguments.id);
        const spawned = trace.world.nextId > before.nextId ? trace.world.nextId - 1 : null;
        const kept = Number.isFinite(idArg) && trace.world.entities[idArg] ? idArg : before.selectedId;
        const selected =
          spawned ?? (kept != null && trace.world.entities[kept] ? kept : (Object.values(trace.world.entities)[0]?.id ?? null));
        commit(trace.world, selected, settled.notes);
        if (settled.filed.length) set((state) => ({ library: mergeLibrary(state.library ?? [], settled.filed) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "the turn failed";
        pushLog([
          { tone: "user", title: "Intent", body: intent },
          { tone: "warn", title: "Failed", body: message.slice(0, 280) },
        ]);
      } finally {
        set({ busy: false });
      }
    },
    submitScript: async (intentRaw) => {
      const intent = intentRaw.trim().slice(0, 400);
      if (!intent || get().busy) return;
      set({ busy: true });
      try {
        const state = get();
        const proposal = propose(state.model, intent, sceneRefs(state.entities), TOOL_NAMES);
        finish(proposal, "Script", intent, "Script");
      } finally {
        set({ busy: false });
      }
    },
    bootResident: () => {
      const id = get().residentId;
      if (!get().residentPower) return Promise.resolve();
      if (residentReady(id)) {
        set({ residentStatus: "ready", residentProgress: 100, residentDetail: "Weights are in this page." });
        return Promise.resolve();
      }
      if (residentBoot && get().residentStatus === "loading") return residentBoot;
      const spec = residentById(id);
      set({
        residentStatus: "loading",
        residentProgress: 0,
        residentDetail: `Fetching ${spec.label} into this page`,
      });
      let lastPaint = 0;
      let lastLabel = "";
      const task: Promise<void> = ensureResident(id, (progress, label, bytes) => {
        if (get().residentId !== id || !get().residentPower) return;
        const now = Date.now();
        if (now - lastPaint < 80 && progress < 100 && label === lastLabel) return;
        lastPaint = now;
        lastLabel = label;
        const file = label.split("/").pop() || label;
        const loaded = bytes?.loaded ?? 0;
        const total = bytes?.total ?? 0;
        set({
          residentProgress: progress,
          residentLoaded: loaded,
          residentTotal: total,
          residentDetail:
            progress >= 100
              ? "Weights are in. Starting the model."
              : total > 0
                ? `${Math.round(progress)}% · ${megabytes(loaded)} of ${megabytes(total)}`
                : file,
        });
      })
        .then(() => {
          if (get().residentId !== id || !get().residentPower) return;
          if (!residentReady(id)) return;
          set({ residentStatus: "ready", residentProgress: 100, residentDetail: `${spec.short} is on.` });
          pushLog([
            {
              tone: "engine",
              title: spec.short,
              body: `${spec.label} is resident in this page (${spec.repo}).`,
            },
          ]);
        })
        .catch((error: unknown) => {
          if (get().residentId !== id || !get().residentPower) return;
          const message = error instanceof Error ? error.message : "could not load weights";
          set({ residentStatus: "error", residentDetail: message.slice(0, 280) });
          pushLog([{ tone: "warn", title: spec.short, body: message.slice(0, 280) }]);
        })
        .finally(() => {
          if (residentBoot === task) residentBoot = null;
        });
      residentBoot = task;
      return task;
    },
    holdResident: (detail) => {
      releaseResident();
      residentBoot = null;
      set({ residentPower: false, residentHeld: true, residentStatus: "off", residentProgress: 0, residentDetail: detail });
    },
    setResidentPower: (power) => {
      if (get().residentHeld) set({ residentHeld: false });
      if (get().residentPower === power) return;
      const spec = residentById(get().residentId);
      if (!power) {
        releaseResident();
        residentBoot = null;
        set({
          residentPower: false,
          residentStatus: "off",
          residentProgress: 0,
          residentDetail: "Powered down. Forge will not call a model.",
        });
        pushLog([{ tone: "engine", title: "Power", body: `${spec.short} is off.` }]);
        return;
      }
      set({ residentPower: true, residentDetail: `Turning ${spec.short} on` });
      pushLog([{ tone: "engine", title: "Power", body: `${spec.short} is on. Weights load into this page.` }]);
      void get().bootResident();
    },
    setResidentModel: (id) => {
      if (get().residentId === id) return;
      const spec = residentById(id);
      releaseResident();
      residentBoot = null;
      set({
        residentId: id,
        residentProgress: 0,
        residentStatus: get().residentPower ? "loading" : "off",
        residentDetail: get().residentPower ? `Switching to ${spec.label}` : "Powered down. Forge will not call a model.",
      });
      pushLog([
        {
          tone: "engine",
          title: "Model",
          body: `${spec.label} selected. ${spec.place === "in situ" ? "It runs in this page." : spec.blurb}`,
        },
      ]);
      if (get().residentPower) void get().bootResident();
    },
    bootCritic: () => {
      if (!get().criticPower) return Promise.resolve();
      if (criticReady()) {
        set({
          criticStatus: "ready",
          criticProgress: 100,
          criticDetail: "A second Gemma is in this page and reviews after each command.",
        });
        return Promise.resolve();
      }
      set({
        criticStatus: "ready",
        criticProgress: Math.max(get().criticProgress, 1),
        criticDetail: "Critic is live on Gemma. It reviews after each command while a second copy loads.",
      });
      let lastPaint = 0;
      let lastLabel = "";
      const giveUp = () => {
        if (!get().criticPower || criticReady()) return;
        releaseCritic();
        set({
          criticStatus: "ready",
          criticProgress: 100,
          criticDetail: "Critic is live on Gemma. A second copy did not start, so the same model reviews after the actor.",
        });
      };
      const timer = window.setTimeout(giveUp, 16000);
      return ensureCritic((progress, label) => {
        if (!get().criticPower) return;
        const now = Date.now();
        if (now - lastPaint < 80 && progress < 100 && label === lastLabel) return;
        lastPaint = now;
        lastLabel = label;
        if (criticReady()) return;
        set({
          criticStatus: "ready",
          criticProgress: progress,
          criticDetail:
            progress >= 100
              ? "Critic is live. The second copy is compiling and will take over if it starts."
              : `Critic is live on Gemma. Second copy ${Math.round(progress)}%.`,
        });
      })
        .then(() => {
          window.clearTimeout(timer);
          if (!get().criticPower) return;
          if (criticReady()) {
            set({
              criticStatus: "ready",
              criticProgress: 100,
              criticDetail: "A second Gemma is in this page and reviews after each command.",
            });
            pushLog([{ tone: "engine", title: "Critic", body: "The second model is live and will review the next command." }]);
            return;
          }
          giveUp();
        })
        .catch(() => {
          window.clearTimeout(timer);
          giveUp();
        });
    },
    setCriticPower: (power) => {
      if (get().criticPower === power) return;
      if (!power) {
        releaseCritic();
        set({
          criticPower: false,
          criticStatus: "off",
          criticProgress: 0,
          criticDetail: "Second model is off.",
        });
        pushLog([{ tone: "engine", title: "Critic", body: "The second model is off." }]);
        return;
      }
      set({ criticPower: true, criticStatus: "ready", criticProgress: 100, criticDetail: "Critic is live on Gemma." });
      pushLog([{ tone: "engine", title: "Critic", body: "Second model requested. It loads beside Gemma and reviews the next commands." }]);
      void get().bootCritic();
    },
    dispatchManual: (name, args) => {
      const state = get();
      const proposal: ProposedAction = { kind: "tool_call", toolName: name, arguments: args };
      const executed = executeProposal(state, proposal);
      const id = Number(args.id);
      const spawned = executed.world.nextId > state.nextId ? executed.world.nextId - 1 : null;
      const selected = spawned ?? (Number.isFinite(id) && executed.world.entities[id] ? id : state.selectedId);
      commit(executed.world, selected, [
        { tone: "user", title: "Manual", body: `${name}  ${argLine(args)}` },
        { tone: executed.ok ? "engine" : "warn", title: executed.ok ? "Result" : "Failed", body: executed.result },
      ]);
    },
    setPlugin: (plugin) => {
      const state = get();
      if (state.plugin === plugin) return;
      set({ plugin });
      const body =
        plugin === "grok"
          ? `Remote Grok (${GROK_MODEL}). One intent sends one request. The harness still validates every tool call.`
          : plugin === "bonded"
            ? state.model.validated
              ? `Bonded model '${state.model.name}' is imported. The in-browser driver mirrors its tool calls.`
              : `Bond a .gguf to record it. Until the header checks out, the demo driver proposes calls.`
            : "Demo heuristic (no model file required).";
      pushLog([{ tone: plugin === "bonded" && !state.model.validated ? "warn" : "engine", title: "Plugin", body }]);
    },
    setTicks: (ticks) => set({ ticksPerIntent: Math.max(1, Math.min(30, Math.round(ticks) || 3)) }),
    importGguf: (fileName, magicOk) => {
      const path = fileName.trim();
      if (!path) return "model file not found: (empty)";
      if (!path.toLowerCase().endsWith(".gguf")) return `expected a .gguf file: ${path}`;
      if (!magicOk) return `not a valid GGUF file (bad magic): ${path}`;
      const stem = path.split(/[/\\]/).pop()?.replace(/\.gguf$/i, "") || "bonded-model";
      const model: BondedModel = { name: stem, path, loaded: true, validated: true };
      set({ model, plugin: "bonded" });
      pushLog([{ tone: "engine", title: "Bond", body: `Bonded model '${stem}' imported` }]);
      return null;
    },
    note: (entries) => pushLog(entries),
    keepMechanic: (pkg) =>
      set((state) => ({ mechanics: [...state.mechanics.filter((m) => m.hash !== pkg.hash), pkg].slice(-MAX_MECHANICS) })),
    dropMechanic: (hash) =>
      set((state) => ({ mechanics: state.mechanics.filter((m) => m.hash !== hash), moverHash: state.moverHash === hash ? "" : state.moverHash })),
    setMover: (hash) => set((state) => ({ moverHash: !hash || state.mechanics.some((m) => m.hash === hash) ? hash : state.moverHash })),
    adopt: (world, entries) => commit(ensureAvatar(world), get().selectedId, entries),
    reset: () =>
      set((state) => ({
        ...freshCore(),
        residentId: state.residentId,
        residentPower: state.residentPower,
        residentStatus: state.residentStatus,
        residentProgress: state.residentProgress,
        residentDetail: state.residentDetail,
        criticPower: state.criticPower,
        criticStatus: state.criticStatus,
        criticProgress: state.criticProgress,
        criticDetail: state.criticDetail,
        library: state.library,
        mechanics: state.mechanics,
        moverHash: state.moverHash,
        // Moves you made stay through a reset, like your mechanics.
        moves: state.moves,
        weather: undefined,
        recent: [],
        score: undefined,
        town: undefined,
      })),
    despawn: (id) => {
      const state = get();
      const entity = state.entities[id];
      if (!entity || entity.tags.includes("architect") || entity.tags.includes("helm")) return;
      const executed = executeProposal(state, {
        kind: "tool_call",
        toolName: "delete_entity",
        arguments: { id: String(id) },
      });
      const remaining = Object.values(executed.world.entities).sort((a, b) => a.id - b.id);
      commit(executed.world, remaining.find((item) => !item.tags.includes("architect"))?.id ?? remaining[0]?.id ?? null, [
        { tone: "engine", title: "Despawn", body: executed.result },
      ]);
    },
    hydrate: () => {
      if (typeof window === "undefined") return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw) as Persisted;
        if (!data.world || !isEntityRecord(data.world.entities)) return;
        const hasLab = Object.values(data.world.entities).some((entity) => entity.tags?.includes("lab"));
        if (!hasLab) {
          set({
            plugin: data.plugin === "grok" || data.plugin === "bonded" || data.plugin === "demo" ? data.plugin : "demo",
            model: data.model?.path ? { ...demoModel(), ...data.model } : demoModel(),
            ticksPerIntent: data.ticksPerIntent || 3,
            residentId: isResidentId(data.residentId) ? data.residentId : DEFAULT_RESIDENT_ID,
            residentPower: typeof data.residentPower === "boolean" ? data.residentPower : true,
            criticPower: typeof data.criticPower === "boolean" ? data.criticPower : false,
            library: cleanLibrary(data.library),
            mechanics: cleanMechanics(data.mechanics),
            moverHash: typeof data.moverHash === "string" ? data.moverHash : "",
            running: false,
            busy: false,
          });
          return;
        }
        const world = ensureHelm(ensureAvatar({
          ...data.world,
          undo: Array.isArray(data.world.undo) ? data.world.undo.slice(-16) : [],
          skills: cleanSkills(data.world.skills),
          compat: Array.isArray(data.world.compat) ? data.world.compat.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
          moves: cleanMoves(data.world.moves),
          weather: cleanWeather(data.world.weather),
          recent: cleanRecent(data.world.recent),
          score: typeof data.world.score === "string" ? data.world.score.slice(0, 120) : undefined,
          town: cleanTown(data.world.town, data.world.entities),
          best: cleanBest(data.world.best),
          gravity: bootWorld().gravity,
          deltaTime: bootWorld().deltaTime,
        }));
        const ids = Object.keys(world.entities).map(Number);
        const selected =
          data.selectedId != null && world.entities[data.selectedId] ? data.selectedId : (ids[0] ?? null);
        set({
          ...world,
          osTicks: data.osTicks || 0,
          history: Array.isArray(data.history) ? data.history.slice(-80) : get().history,
          logSeq: data.logSeq || get().logSeq,
          selectedId: selected,
          plugin: data.plugin === "grok" || data.plugin === "bonded" || data.plugin === "demo" ? data.plugin : "demo",
          model: data.model?.path ? { ...demoModel(), ...data.model } : demoModel(),
          ticksPerIntent: data.ticksPerIntent || 3,
          residentId: isResidentId(data.residentId) ? data.residentId : DEFAULT_RESIDENT_ID,
          residentPower: typeof data.residentPower === "boolean" ? data.residentPower : true,
          criticPower: typeof data.criticPower === "boolean" ? data.criticPower : false,
          library: cleanLibrary(data.library),
          mechanics: cleanMechanics(data.mechanics),
          moverHash: typeof data.moverHash === "string" ? data.moverHash : "",
          running: false,
          busy: false,
        });
      } catch {
        /* keep the boot manifold */
      }
    },
  };
});

function cleanSkills(value: unknown): Skill[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((skill): skill is Skill => {
      if (!skill || typeof skill !== "object") return false;
      const row = skill as Skill;
      return typeof row.name === "string" && Array.isArray(row.steps);
    })
    .slice(-MAX_SKILLS);
}

function persistedWorld(state: ForgeState): World {
  return {
    entities: state.entities,
    nextId: state.nextId,
    tick: state.tick,
    gravity: state.gravity,
    deltaTime: state.deltaTime,
    eventLog: state.eventLog.slice(-64),
    events: state.events.slice(-64),
    undo: (state.undo ?? []).slice(-16),
    skills: (state.skills ?? []).slice(-MAX_SKILLS),
    recent: state.recent ?? [],
    compat: (state.compat ?? []).slice(0, 8),
    moves: state.moves ?? [],
    ...(state.weather ? { weather: state.weather } : {}),
    ...(state.score ? { score: state.score } : {}),
    ...(state.town ? { town: state.town } : {}),
    ...(state.best ? { best: state.best } : {}),
  };
}

/**
 * What linked devices share (link-client.ts): the world, its clock and the log. Choices that belong to
 * one device (which model it runs, what it has selected) stay on that device. Islands visited through a
 * portal are left out: each device keeps its own live link to them.
 */
export type SharedSave = {
  forge: "shared-save";
  version: 1;
  world: World;
  osTicks: number;
  history: LogEntry[];
  logSeq: number;
  running: boolean;
  /** Your mechanics and the one you move with travel with you between devices. */
  mechanics?: MechanicPackage[];
  moverHash?: string;
};

export function sharedSave(state: ForgeState): SharedSave {
  const world = persistedWorld(state);
  // Visited islands, and this device's own screen (device-apps.ts), stay on this device.
  const entities = Object.fromEntries(Object.entries(world.entities).filter(([, entity]) => !entity.customData?.island && !entity.tags.includes("device-screen")));
  return {
    forge: "shared-save",
    version: 1,
    world: { ...world, entities },
    osTicks: state.osTicks,
    history: state.history.slice(-80),
    logSeq: state.logSeq,
    running: state.running,
    mechanics: state.mechanics,
    moverHash: state.moverHash,
  };
}

/** Take a save from another device. Returns false (and changes nothing) if it is not a usable save. */
export function applySharedSave(value: unknown): boolean {
  const save = value as SharedSave;
  if (!save || save.forge !== "shared-save" || save.version !== 1 || !save.world || !isEntityRecord(save.world.entities)) return false;
  const state = useForge.getState();
  const visited = Object.fromEntries(Object.entries(state.entities).filter(([, entity]) => entity.customData?.island || entity.tags.includes("device-screen")));
  const world = ensureHelm(ensureAvatar({
    ...save.world,
    entities: { ...save.world.entities, ...visited },
    undo: Array.isArray(save.world.undo) ? save.world.undo.slice(-16) : [],
    skills: cleanSkills(save.world.skills),
    compat: Array.isArray(save.world.compat) ? save.world.compat.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    moves: cleanMoves(save.world.moves),
    weather: cleanWeather(save.world.weather),
    recent: cleanRecent(save.world.recent),
    score: typeof save.world.score === "string" ? save.world.score.slice(0, 120) : undefined,
    town: cleanTown(save.world.town, save.world.entities),
    best: cleanBest(save.world.best),
    gravity: bootWorld().gravity,
    deltaTime: bootWorld().deltaTime,
  }));
  useForge.setState({
    ...world,
    osTicks: Number(save.osTicks) || 0,
    history: Array.isArray(save.history) ? save.history.slice(-80) : state.history,
    logSeq: Number(save.logSeq) || state.logSeq,
    selectedId: state.selectedId != null && world.entities[state.selectedId] ? state.selectedId : (Number(Object.keys(world.entities)[0]) || null),
    running: Boolean(save.running),
    ...(Array.isArray(save.mechanics) ? { mechanics: cleanMechanics(save.mechanics) } : {}),
    ...(typeof save.moverHash === "string" ? { moverHash: save.moverHash } : {}),
  });
  return true;
}

let persistReady = false;

export function startPersist() {
  if (persistReady || typeof window === "undefined") return;
  persistReady = true;
  useForge.getState().hydrate();
  let timer = 0;
  useForge.subscribe((state) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const payload: Persisted = {
        world: persistedWorld(state),
        osTicks: state.osTicks,
        history: state.history,
        logSeq: state.logSeq,
        selectedId: state.selectedId,
        plugin: state.plugin,
        model: state.model,
        ticksPerIntent: state.ticksPerIntent,
        residentId: state.residentId,
        residentPower: state.residentPower || state.residentHeld,
        criticPower: state.criticPower,
        library: (state.library ?? []).slice(-24),
        mechanics: state.mechanics,
        moverHash: state.moverHash,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }, 200);
  });
}
