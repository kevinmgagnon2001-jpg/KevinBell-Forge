import wasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import { residentById, DEFAULT_RESIDENT_ID } from "./resident-catalog";
import { modelCacheManager } from "./model-cache";

type ProgressFn = (progress: number, label: string) => void;

type Engine = {
  loadModelFromHF: (
    source: { repo: string; file: string },
    params?: {
      n_ctx?: number;
      n_threads?: number;
      n_batch?: number;
      signal?: AbortSignal;
      progressCallback?: (opts: { loaded: number; total: number }) => void;
    },
  ) => Promise<void>;
  createChatCompletion: (options: Record<string, unknown>) => Promise<{
    choices?: { message?: { content?: string | null } }[];
  }>;
  exit: () => Promise<void>;
};

const STOP = ["<end_of_turn>", "<start_of_turn>", "<|im_end|>", "<|eot_id|>", "<|im_start|>"];

let ticket = 0;
let engine: Engine | null = null;
let ready = false;
let inflight: Promise<void> | null = null;
let abort: AbortController | null = null;

export function criticReady(): boolean {
  return ready && engine != null;
}

export function releaseCritic(): void {
  ticket += 1;
  inflight = null;
  ready = false;
  abort?.abort();
  abort = null;
  const current = engine;
  engine = null;
  if (current) void current.exit().catch(() => undefined);
}

/** Second resident copy of Gemma, so a critic can sit beside the actor. */
export function ensureCritic(onProgress: ProgressFn): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("The critic runs in this page"));
  if (criticReady()) return Promise.resolve();
  if (inflight) return inflight;
  const mine = ++ticket;
  const spec = residentById(DEFAULT_RESIDENT_ID);
  const controller = new AbortController();
  abort = controller;
  inflight = (async () => {
    onProgress(0, "Loading the critic runtime");
    const { Wllama, CacheManager } = await import("@wllama/wllama");
    if (mine !== ticket) return;
    onProgress(0, "Asking Hugging Face for the critic");
    const next = new Wllama({ default: wasmUrl }, { cacheManager: modelCacheManager(CacheManager) }) as unknown as Engine;
    engine = next;
    let full = false;
    const stall = window.setTimeout(() => {
      if (full && mine === ticket && !ready) controller.abort();
    }, 12000);
    try {
      await next.loadModelFromHF(
        { repo: spec.repo, file: spec.file },
        {
          n_ctx: 768,
          n_threads: 1,
          n_batch: 64,
          signal: controller.signal,
          progressCallback: ({ loaded, total }) => {
            if (mine !== ticket) return;
            const progress = total > 0 ? Math.max(0, Math.min(100, (loaded / total) * 100)) : 0;
            if (progress >= 100) full = true;
            onProgress(progress, progress >= 100 ? "compiling critic" : spec.file);
          },
        },
      );
    } finally {
      window.clearTimeout(stall);
    }
    if (mine !== ticket) {
      await next.exit().catch(() => undefined);
      return;
    }
    ready = true;
  })().finally(() => {
    if (mine === ticket) inflight = null;
  });
  return inflight;
}

export async function completeCritic(prompt: string): Promise<{ text: string }> {
  if (!engine || !ready) throw new Error("critic is not loaded");
  const result = await engine.createChatCompletion({
    messages: [{ role: "user", content: prompt }],
    max_tokens: 80,
    temperature: 0.2,
    top_k: 40,
    top_p: 0.9,
    chat_template_kwargs: { enable_thinking: false },
    stop: STOP,
  });
  return { text: result.choices?.[0]?.message?.content?.trim() ?? "" };
}
