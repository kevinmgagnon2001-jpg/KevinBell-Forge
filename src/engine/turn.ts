import { criticPrompt, parseCritic } from "./critique.ts";
import { fileNeural, type NeuralAsset } from "./library.ts";
import { codeFromText, fieldQuery, isLearning, isRefusal, wantsAsset, wantsWeb, type FieldNote } from "./research.ts";
import { executeProposal, registerSkill } from "./harness.ts";
import { compatProposal } from "./isa.ts";
import { moduleDProposal } from "./module-d.ts";
import { interpretResident, parseResidentReply, proposalFromToolCalls, residentPrompt } from "./resident-parse.ts";
import type { ResidentToolCall } from "./resident-parse.ts";
import type { BondedModel, LogTone, ProposedAction, World } from "./types.ts";
import { focusId, runHarness, type HarnessTrace } from "./vm.ts";

export type TurnNote = { tone: LogTone; title: string; body: string };

type Turn = { text: string; toolCalls: ResidentToolCall[] };

function traceFrom(proposal: ProposedAction, world: World, result: string, ok: boolean): HarnessTrace {
  return {
    proposal,
    world,
    result,
    ok,
    attempts: [{ tool: proposal.toolName ?? proposal.kind, ok, detail: result }],
  };
}

function blankNote(query: string): FieldNote {
  return { ok: false, query, summary: "", title: query || "Asset", source: "", imageUrl: "" };
}

function isSceneCommand(intent: string): boolean {
  return /\b(make|spawn|create|add|forge|build|paint|color|colour|move|walk|turn|edit|scale|resize|bigger|smaller|delete|remove|undo|push|nudge|platform|pillar|sphere|ring|cube|avatar|agent|tetris|marble|mesh|texture|wrap|import|paper|method|nanite|meshlet|geometry)\b/i.test(
    intent,
  );
}

function askedForSplat(intent: string): boolean {
  return wantsAsset(intent);
}

function filedTrace(world: World, intent: string, note: FieldNote): { trace: HarnessTrace; filed: NeuralAsset[] } {
  const filed = fileNeural(world, intent, note);
  return { trace: traceFrom(filed.proposal, filed.world, filed.result, true), filed: [filed.asset] };
}

/** Run a tool call found in a page, or one the harness can write itself. Never eval raw script. */
function injectCall(world: World, intent: string, text: string): HarnessTrace | null {
  const call = codeFromText(text);
  if (!call) return null;
  const ran = executeProposal(world, { kind: "tool_call", toolName: call.tool, arguments: call.arguments });
  const name = `web_${fieldQuery(intent).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "snippet"}`;
  const withSkill = registerSkill(ran.world, {
    name,
    description: `Injected ${call.tool} from a web snippet`.slice(0, 160),
    job: "create",
    steps: [{ tool: call.tool, arguments: call.arguments }],
  });
  return traceFrom(
    { kind: "tool_call", toolName: call.tool, arguments: call.arguments, message: "injected snippet" },
    withSkill,
    ran.ok ? `${ran.result} Injected skill ${name}.` : ran.result,
    ran.ok,
  );
}

/**
 * The scene command runs first and stays a solid mesh.
 * A splat is filed only when the command asks for one.
 */
export async function settleIntent(opts: {
  world: World;
  intent: string;
  label: string;
  model: BondedModel;
  scene: string;
  proposeTurn: (prompt: string) => Promise<Turn>;
  critiqueTurn: ((prompt: string) => Promise<{ text: string }>) | null;
  research: (query: string, failure: string) => Promise<FieldNote>;
  moduleD?: (call: { tool: string; arguments: Record<string, string> }) => Promise<{ ok: boolean; detail: string }>;
  focus?: number | null;
  gaze?: number | null;
}): Promise<{ trace: HarnessTrace; notes: TurnNote[]; filed: NeuralAsset[] }> {
  const notes: TurnNote[] = [{ tone: "user", title: "Intent", body: opts.intent }];
  const field = moduleDProposal(opts.intent);
  if (field?.kind === "tool_call" && field.toolName) {
    if (!opts.moduleD) {
      const detail = "The sandbox loopback is not connected.";
      notes.push({ tone: "warn", title: "Sandbox", body: detail });
      return { trace: traceFrom(field, opts.world, detail, false), notes, filed: [] };
    }
    const result = await opts.moduleD({ tool: field.toolName, arguments: field.arguments });
    notes.push({
      tone: result.ok ? "engine" : "warn",
      title: field.toolName === "search_web_clean" ? "Ingest" : "Sandbox",
      body: result.detail,
    });
    return { trace: traceFrom(field, opts.world, result.detail, result.ok), notes, filed: [] };
  }
  const askedWeb = wantsWeb(opts.intent);
  const askedAsset = wantsAsset(opts.intent);
  const sceneCommand = isSceneCommand(opts.intent);
  let filed: NeuralAsset[] = [];
  let trace: HarnessTrace = traceFrom({ kind: "message", arguments: {}, message: "No action" }, opts.world, "No action", false);

  if ((sceneCommand && !askedAsset) || (!askedWeb && !askedAsset)) {
    let proposal: ProposedAction;
    try {
      const turn = await opts.proposeTurn(residentPrompt(opts.scene, opts.intent));
      const parsed = (turn.toolCalls.length ? proposalFromToolCalls(turn.toolCalls) : null) ?? parseResidentReply(turn.text);
      proposal =
        parsed.kind === "tool_call"
          ? parsed
          : interpretResident(opts.world, opts.label, opts.intent, turn.text, turn.toolCalls, opts.model);
      if (proposal.toolName === "place_neural" && !askedForSplat(opts.intent)) {
        proposal = interpretResident(opts.world, opts.label, opts.intent, "", [], opts.model);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "generation failed";
      proposal = interpretResident(opts.world, opts.label, opts.intent, message, [], opts.model);
    }
    trace = runHarness(opts.world, opts.intent, proposal, opts.focus, opts.gaze);
    if (!trace.ok && !isRefusal(trace.result)) {
      const local = interpretResident(opts.world, opts.label, opts.intent, trace.result, [], opts.model);
      const again = runHarness(opts.world, opts.intent, local, opts.focus, opts.gaze);
      notes.push({
        tone: again.ok ? "engine" : "warn",
        title: "Extrapolate",
        body: again.ok ? again.result : "The tools could not finish that on their own.",
      });
      if (again.ok) trace = again;
    }
  }

  if ((askedWeb || askedForSplat(opts.intent) || isLearning(opts.intent)) && !compatProposal(opts.intent)) {
    notes.push({ tone: "engine", title: "Web", body: "Searching the open web, not only Wikipedia." });
    try {
      const note = await opts.research(opts.intent, trace.ok ? "" : trace.result);
      notes.push({
        tone: "engine",
        title: "Web",
        body: [note.title, note.summary, note.source].filter(Boolean).join("\n") || note.error || "Nothing useful came back.",
      });
      const injected = injectCall(trace.ok ? trace.world : opts.world, opts.intent, `${note.summary}\n${opts.intent}`);
      const host = focusId(trace.world, opts.intent, opts.focus, opts.gaze);
      const texture = Boolean(note.imageUrl) && !/\b(splat|neural|gaussian)\b/i.test(opts.intent);
      if (texture && host && host !== "*") {
        const painted = executeProposal(trace.ok ? trace.world : opts.world, {
          kind: "tool_call",
          toolName: "set_asset",
          arguments: { id: host, src: note.imageUrl, title: note.title || "Texture", page: note.source },
        });
        notes.push({ tone: painted.ok ? "engine" : "warn", title: "Texture", body: painted.result });
        if (painted.ok) {
          trace = traceFrom(
            { kind: "tool_call", toolName: "set_asset", arguments: { id: host, src: note.imageUrl }, message: "texture" },
            painted.world,
            painted.result,
            true,
          );
        }
      } else if (injected?.ok && !texture) {
        notes.push({ tone: "engine", title: "Inject", body: injected.result });
        trace = injected;
      } else if (askedForSplat(opts.intent) && filed.length === 0) {
        const pulled = filedTrace(opts.world, opts.intent, note.title || note.summary ? note : blankNote(opts.intent));
        notes.push({ tone: "engine", title: "Library", body: pulled.trace.result });
        trace = pulled.trace;
        filed = pulled.filed;
      } else if (!sceneCommand && !trace.ok && (note.summary || note.source)) {
        trace = traceFrom(
          { kind: "message", arguments: {}, message: note.summary || note.title },
          opts.world,
          note.summary || note.error || "No page matched.",
          Boolean(note.summary || note.source),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "lookup failed";
      notes.push({ tone: "warn", title: "Web", body: message });
      if (askedForSplat(opts.intent) && filed.length === 0) {
        const pulled = filedTrace(opts.world, opts.intent, blankNote(opts.intent));
        notes.push({ tone: "engine", title: "Library", body: `${pulled.trace.result} The web missed, so this recipe is local.` });
        trace = pulled.trace;
        filed = pulled.filed;
      }
    }
  }

  if (opts.critiqueTurn && !isRefusal(trace.result)) {
    try {
      const review = parseCritic((await opts.critiqueTurn(criticPrompt(opts.scene, opts.intent))).text);
      notes.push({
        tone: "model",
        title: "Critic",
        body: review.pass ? "Pass. The second model agrees." : `Change it: ${review.fix || "try a different tool"}`,
      });
      if (!review.pass && review.fix) {
        const again = runHarness(trace.world, review.fix, {
          kind: "message",
          arguments: {},
          message: "critic",
        }, opts.focus, opts.gaze);
        notes.push({
          tone: again.ok ? "engine" : "warn",
          title: "Iteration",
          body: again.ok ? again.result : `${again.result} Keeping the neural asset already filed.`,
        });
        if (again.ok) trace = again;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "critic failed";
      notes.push({ tone: "warn", title: "Critic", body: message });
    }
  }

  const attempts = trace.attempts
    .map((attempt, index) => `${index + 1}. ${attempt.ok ? "pass" : "fail"} ${attempt.tool}: ${attempt.detail}`)
    .join("\n");
  notes.push({
    tone: "model",
    title: trace.proposal.toolName ? `${opts.label} · ${trace.proposal.toolName}` : opts.label,
    body: `${trace.proposal.message ?? "No action"}${trace.proposal.arguments && Object.keys(trace.proposal.arguments).length ? `\n${Object.entries(trace.proposal.arguments).map(([key, value]) => `${key}=${value}`).join("  ")}` : ""}`,
  });
  notes.push({
    tone: trace.ok ? "engine" : "warn",
    title: trace.ok ? "Verified" : "Failed",
    body: `${trace.result}\n${attempts}`,
  });
  return { trace, notes, filed };
}
