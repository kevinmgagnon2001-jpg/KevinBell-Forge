import wasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import { residentById, type ResidentId } from "./resident-catalog";
import { FORGE_TOOLS, TOOL_GRAMMAR, type ResidentToolCall } from "./resident-parse";
import { modelCacheManager } from "./model-cache";

type ProgressFn = (progress: number, label: string, bytes?: { loaded: number; total: number }) => void;

export type ResidentTurn = {
  text: string;
  toolCalls: ResidentToolCall[];
};

type Engine = {
  loadModelFromHF: (
    source: { repo: string; file: string },
    params?: {
      n_ctx?: number;
      n_threads?: number;
      n_batch?: number;
      n_parallel?: number;
      n_gpu_layers?: number;
      flash_attn?: boolean;
      warmup?: boolean;
      cache_type_k?: "q8_0";
      cache_type_v?: "q8_0";
      signal?: AbortSignal;
      progressCallback?: (opts: { loaded: number; total: number }) => void;
    },
  ) => Promise<void>;
  createChatCompletion: (options: Record<string, unknown>) => Promise<{
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { function?: { name?: string; arguments?: string } }[];
      };
    }[];
  }>;
  exit: () => Promise<void>;
};

const STOP = ["<end_of_turn>", "<start_of_turn>", "<|im_end|>", "<|eot_id|>", "<|im_start|>", "<｜end▁of▁sentence｜>", "<｜start▁of▁sentence｜>"];

let ticket = 0;
let engine: Engine | null = null;
let currentId: ResidentId | null = null;
let ready = false;
let inflight: Promise<void> | null = null;
let inflightId: ResidentId | null = null;
let abort: AbortController | null = null;

export function residentReady(id: ResidentId): boolean {
  return ready && currentId === id && engine != null;
}

export function releaseResident(): void {
  ticket += 1;
  inflight = null;
  inflightId = null;
  ready = false;
  currentId = null;
  abort?.abort();
  abort = null;
  const current = engine;
  engine = null;
  if (current) void current.exit().catch(() => undefined);
}

export function ensureResident(id: ResidentId, onProgress: ProgressFn): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("In-situ models run in the page"));
  if (residentReady(id)) return Promise.resolve();
  if (inflight && inflightId === id) return inflight;
  const mine = ++ticket;
  inflightId = id;
  const spec = residentById(id);
  const controller = new AbortController();
  abort = controller;
  inflight = (async () => {
    onProgress(0, "Loading the runtime");
    const { Wllama, CacheManager } = await import("@wllama/wllama");
    if (mine !== ticket) return;
    onProgress(0, "Asking Hugging Face for the weights");
    const next = new Wllama({ default: wasmUrl }, { cacheManager: modelCacheManager(CacheManager) }) as unknown as Engine;
    engine = next;
    currentId = id;
    const heavy = spec.id === "spark-x2.5-4b";
    let downloaded = false;
    let compileTimer: ReturnType<typeof setTimeout> | undefined;
    const load = next.loadModelFromHF(
      { repo: spec.repo, file: spec.file },
      {
        n_ctx: heavy ? 512 : 1024,
        n_threads: 1,
        n_batch: heavy ? 64 : 128,
        n_parallel: heavy ? 1 : undefined,
        n_gpu_layers: 0,
        flash_attn: heavy ? false : undefined,
        warmup: false,
        cache_type_k: heavy ? "q8_0" : undefined,
        cache_type_v: heavy ? "q8_0" : undefined,
        signal: controller.signal,
        progressCallback: ({ loaded, total }) => {
          if (mine !== ticket) return;
          const progress = total > 0 ? Math.max(0, Math.min(100, (loaded / total) * 100)) : 0;
          if (progress >= 100 && !downloaded) {
            downloaded = true;
            compileTimer = setTimeout(() => {
              if (mine !== ticket || ready) return;
              controller.abort();
            }, heavy ? 240000 : 120000);
          }
          onProgress(progress, progress >= 100 ? "Starting the model" : spec.file, { loaded, total });
        },
      },
    );
    const hung = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => {
        if (ready || mine !== ticket) return;
        reject(
          new Error(
            downloaded
              ? heavy
                ? "Spark's weights are in this page, but the runtime did not start. This page can only open a model under 2 GB."
                : "The weights downloaded, but the runtime did not start."
              : "The download was stopped.",
          ),
        );
      });
    });
    try {
      await Promise.race([load, hung]);
    } catch (error) {
      if (mine === ticket) {
        ready = false;
        currentId = null;
        const current = engine;
        engine = null;
        void current?.exit().catch(() => undefined);
      }
      throw error;
    } finally {
      if (compileTimer) clearTimeout(compileTimer);
    }
    if (mine !== ticket) {
      await next.exit().catch(() => undefined);
      return;
    }
    ready = true;
  })().finally(() => {
    if (inflightId === id && mine === ticket) inflight = null;
  });
  return inflight;
}

function readTurn(result: Awaited<ReturnType<Engine["createChatCompletion"]>>, label: string): ResidentTurn {
  const message = result.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? [])
    .map((call) => ({
      name: call.function?.name ?? "",
      arguments: call.function?.arguments ?? "",
    }))
    .filter((call) => call.name);
  const text = message?.content?.trim() ?? "";
  return {
    text: text || (toolCalls.length ? "" : `(${label} returned nothing)`),
    toolCalls,
  };
}

export async function completeResident(prompt: string): Promise<ResidentTurn> {
  if (!engine || !ready || !currentId) throw new Error("model is not loaded");
  const spec = residentById(currentId);
  const sampling = {
    max_tokens: 128,
    temperature: 0.3,
    top_k: 200,
    top_p: 0.95,
    min_p: 0,
    chat_template_kwargs: { enable_thinking: false },
    stop: STOP,
  };
  const messages = [{ role: "user" as const, content: prompt }];
  try {
    const result = await engine.createChatCompletion({
      ...sampling,
      messages,
      tools: FORGE_TOOLS,
      tool_choice: "required",
      grammar: TOOL_GRAMMAR,
    });
    return readTurn(result, spec.label);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/abort/i.test(message)) throw error;
    const result = await engine.createChatCompletion({ ...sampling, messages });
    return readTurn(result, spec.label);
  }
}
