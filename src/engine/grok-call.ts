import { createServerFn } from "@tanstack/react-start";
import { TOOLS } from "./os";
import type { ProposedAction } from "./types";
import { GROK_MODEL } from "./types";

type SceneLine = {
  id: number;
  name: string;
  tags: string;
  x: number;
  y: number;
  z: number;
};

type GrokInput = {
  intent: string;
  tick: number;
  entityCount: number;
  scene: SceneLine[];
};

export type GrokResult =
  | { ok: true; action: ProposedAction }
  | { ok: false; error: string };

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  return JSON.stringify(value);
}

function jsonType(hint: string): string {
  if (hint === "f32") return "number";
  if (hint === "u64") return "integer";
  return "string";
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export const proposeWithGrok = createServerFn({ method: "POST" })
  .validator((input: unknown): GrokInput => {
    if (!input || typeof input !== "object") throw new Error("bad input");
    const raw = input as Record<string, unknown>;
    const intent = typeof raw.intent === "string" ? raw.intent.trim().slice(0, 400) : "";
    if (!intent) throw new Error("intent required");
    const sceneRaw = Array.isArray(raw.scene) ? raw.scene.slice(0, 24) : [];
    const scene: SceneLine[] = [];
    for (const row of sceneRaw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const id = Number(item.id);
      if (!Number.isFinite(id)) continue;
      scene.push({
        id,
        name: clip(typeof item.name === "string" ? item.name : "entity", 48),
        tags: clip(typeof item.tags === "string" ? item.tags : "", 80),
        x: Number(item.x) || 0,
        y: Number(item.y) || 0,
        z: Number(item.z) || 0,
      });
    }
    return {
      intent,
      tick: Number.isFinite(Number(raw.tick)) ? Number(raw.tick) : 0,
      entityCount: Number.isFinite(Number(raw.entityCount)) ? Number(raw.entityCount) : scene.length,
      scene,
    };
  })
  .handler(async ({ data }): Promise<GrokResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "XAI_API_KEY not set" };

    const tools = TOOLS.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(tool.parameters).map(([key, hint]) => [key, { type: jsonType(hint) }]),
          ),
          required: Object.keys(tool.parameters),
        },
      },
    }));

    const sceneText = data.scene
      .map((entity) => `${entity.id} ${entity.name} tags=${entity.tags || "—"} pos=${entity.x},${entity.y},${entity.z}`)
      .join("\n");

    const body = {
      model: GROK_MODEL,
      temperature: 0,
      max_tokens: 280,
      messages: [
        {
          role: "system",
          content:
            "You are the Architect inside AetherForge. Reply with tool calls, not prose. Use only the provided tools.",
        },
        {
          role: "user",
          content: `tick=${data.tick} entities=${data.entityCount}\n${sceneText}\nintent: ${data.intent}`,
        },
      ],
      tools,
      tool_choice: "auto",
    };

    let response: Response;
    try {
      response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      return { ok: false, error: clip(message, 180) };
    }

    if (!response.ok) return { ok: false, error: `grok HTTP ${response.status}` };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, error: "grok response was not JSON" };
    }

    const message = (payload as { choices?: { message?: Record<string, unknown> }[] })?.choices?.[0]?.message;
    const calls = message?.tool_calls;
    if (Array.isArray(calls) && calls.length > 0) {
      const call = calls[0] as { function?: { name?: unknown; arguments?: unknown } };
      const name = typeof call.function?.name === "string" ? call.function.name : "";
      const argumentsRaw = call.function?.arguments;
      let parsed: Record<string, unknown> = {};
      if (typeof argumentsRaw === "string") {
        try {
          const value = JSON.parse(argumentsRaw) as unknown;
          if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
        } catch {
          parsed = {};
        }
      } else if (argumentsRaw && typeof argumentsRaw === "object") {
        parsed = argumentsRaw as Record<string, unknown>;
      }
      const argumentsMap: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) argumentsMap[key] = asString(value);
      const action: ProposedAction = {
        kind: "tool_call",
        toolName: name,
        arguments: argumentsMap,
        message: `[Grok:${GROK_MODEL}] ${name || "tool"}`,
      };
      return { ok: true, action };
    }

    const content = typeof message?.content === "string" ? message.content : "(empty)";
    return {
      ok: true,
      action: { kind: "message", arguments: {}, message: content },
    };
  });
