/**
 * Second layer for scripts (work item N3): a gated script runs in its own worker with a
 * message-only API.
 *
 *   gateScript (static checks, script-gate.ts)
 *     -> a fresh worker: network, storage, workers, eval and the Function constructors are removed
 *        before the script loads; the shared prototypes are frozen
 *     -> the script's default export is called with `forge`, an object whose methods only send
 *        messages; the host answers each one (and only for what the island was granted)
 *     -> the worker is terminated when the script returns, throws, or runs out of time
 *
 * A script never touches the world directly. It asks; the host decides, the same rule as portals.
 *
 * Script shape:
 *   export default async function (forge) {
 *     const n = await forge.query("lab");
 *     await forge.log(`there are ${n.length} lab things`);
 *     return n.length;
 *   }
 */
import { gateScript, type GateIssue, type GateOptions } from "./script-gate.ts";

export type HostApi = Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;
export type ScriptRun =
  | { ok: true; value: unknown; calls: number; ms: number }
  | { ok: false; stage: "gate"; issues: GateIssue[] }
  | { ok: false; stage: "run"; error: string; calls: number; ms: number };

/** Globals removed inside the worker, whatever the static gate said. */
export const REMOVED = [
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "RTCPeerConnection", "navigator",
  "localStorage", "sessionStorage", "indexedDB", "caches", "importScripts", "Worker", "SharedWorker",
  "eval", "Function", "require", "process", "Deno", "Bun", "BroadcastChannel", "MessageChannel",
  "postMessage", "close", "onmessage",
];

/** Also removed in browser workers. (Node uses WebAssembly internally to load modules, so there the static gate alone keeps it from scripts.) */
const BROWSER_ONLY = ["WebAssembly"];

const lockdown = (names: string[]) => `
const __deny = (name) => function () { throw new Error("forge: " + name + " is not available to scripts"); };
const __send = __forgeSend;
for (const name of ${JSON.stringify(names)}) {
  try { Object.defineProperty(globalThis, name, { value: __deny(name), writable: false, configurable: false, enumerable: false }); } catch {}
}
for (const f of [function () {}, async function () {}, function* () {}, async function* () {}]) {
  try { Object.defineProperty(Object.getPrototypeOf(f), "constructor", { value: __deny("the Function constructor"), writable: false, configurable: false }); } catch {}
}
for (const p of [Object.prototype, Array.prototype, Function.prototype, String.prototype, Number.prototype, Boolean.prototype, Promise.prototype, Map.prototype, Set.prototype, RegExp.prototype, Error.prototype, Symbol.prototype]) Object.freeze(p);
let __next = 1;
const __pending = new Map();
const forge = new Proxy(Object.freeze({}), {
  get(_t, name) {
    if (typeof name !== "string" || name === "then") return undefined;
    return (...args) => new Promise((resolve, reject) => {
      const id = __next++;
      __pending.set(id, { resolve, reject });
      __send({ type: "call", id, name, args: JSON.parse(JSON.stringify(args ?? [])) });
    });
  },
});
globalThis.__forgeReply = (m) => {
  const p = __pending.get(m.id);
  if (!p) return;
  __pending.delete(m.id);
  if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error));
};
globalThis.__forgeRun = async (url) => {
  try {
    const mod = await import(url);
    if (typeof mod.default !== "function") throw new Error("the script must export a default function");
    const value = await mod.default(forge);
    __send({ type: "done", value: value === undefined ? null : JSON.parse(JSON.stringify(value)) });
  } catch (error) {
    __send({ type: "error", error: String(error && error.message ? error.message : error) });
  }
};
`;

type Msg = { type: "call"; id: number; name: string; args: unknown[] } | { type: "done"; value: unknown } | { type: "error"; error: string };

/** Gate, then run in an isolated worker. `api` holds the host functions the script may call. */
export async function runGatedScript(
  source: string,
  fileName: string,
  api: HostApi,
  options: GateOptions & { timeoutMs?: number; maxCalls?: number } = {},
): Promise<ScriptRun> {
  const gated = gateScript(source, fileName, { ...options, allowImports: [] });
  if (!gated.ok) return { ok: false, stage: "gate", issues: gated.issues };
  return runInWorker(gated.js, api, options.timeoutMs ?? 2000, options.maxCalls ?? 1000);
}

/** The runtime layer on its own (already-checked JavaScript). Exported for tests of the second layer. */
export async function runInWorker(js: string, api: HostApi, timeoutMs = 2000, maxCalls = 1000): Promise<ScriptRun> {
  const started = Date.now();
  let calls = 0;
  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  const moduleUrl = isNode ? `data:text/javascript;base64,${btoaUtf8(js)}` : URL.createObjectURL(new Blob([js], { type: "text/javascript" }));

  type Port = { post: (m: unknown) => void; kill: () => void };
  let port: Port;
  const result = new Promise<ScriptRun>((resolve) => {
    const finish = (r: ScriptRun) => {
      clearTimeout(timer);
      port?.kill();
      if (!isNode) URL.revokeObjectURL(moduleUrl);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, stage: "run", error: `stopped after ${timeoutMs} ms`, calls, ms: Date.now() - started }), timeoutMs);
    const onMessage = async (m: Msg) => {
      if (m.type === "done") return finish({ ok: true, value: m.value, calls, ms: Date.now() - started });
      if (m.type === "error") return finish({ ok: false, stage: "run", error: m.error, calls, ms: Date.now() - started });
      if (m.type !== "call") return;
      calls += 1;
      if (calls > maxCalls) return finish({ ok: false, stage: "run", error: `more than ${maxCalls} host calls`, calls, ms: Date.now() - started });
      const fn = Object.prototype.hasOwnProperty.call(api, m.name) ? api[m.name] : null;
      if (!fn) return port.post({ type: "reply", id: m.id, ok: false, error: `forge.${m.name} is not offered to this script` });
      try {
        const value = await fn(...(Array.isArray(m.args) ? m.args : []));
        port.post({ type: "reply", id: m.id, ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) });
      } catch (error) {
        port.post({ type: "reply", id: m.id, ok: false, error: String(error instanceof Error ? error.message : error) });
      }
    };
    void (async () => {
      if (isNode) {
        const { Worker } = await import("node:worker_threads");
        const boot = `
          const { parentPort } = require("node:worker_threads");
          globalThis.__forgeSend = (m) => parentPort.postMessage(m);
          ${lockdown(REMOVED)}
          parentPort.on("message", (m) => { if (m.type === "reply") globalThis.__forgeReply(m); });
          globalThis.__forgeRun(${JSON.stringify(moduleUrl)});
        `;
        const worker = new Worker(boot, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
        port = { post: (m) => worker.postMessage(m), kill: () => void worker.terminate() };
        worker.on("message", (m: Msg) => void onMessage(m));
        worker.on("error", (e) => finish({ ok: false, stage: "run", error: String(e), calls, ms: Date.now() - started }));
      } else {
        const boot = `
          const __post = self.postMessage.bind(self);
          globalThis.__forgeSend = (m) => __post(m);
          self.addEventListener("message", (e) => { if (e.data && e.data.type === "reply") globalThis.__forgeReply(e.data); });
          ${lockdown([...REMOVED, ...BROWSER_ONLY])}
          globalThis.__forgeRun(${JSON.stringify(moduleUrl)});
        `;
        const url = URL.createObjectURL(new Blob([boot], { type: "text/javascript" }));
        const worker = new Worker(url, { type: "module" });
        port = { post: (m) => worker.postMessage(m), kill: () => { worker.terminate(); URL.revokeObjectURL(url); } };
        worker.onmessage = (e: MessageEvent<Msg>) => void onMessage(e.data);
        worker.onerror = (e) => finish({ ok: false, stage: "run", error: String(e.message), calls, ms: Date.now() - started });
      }
    })();
  });
  return result;
}

function btoaUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
