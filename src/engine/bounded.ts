/**
 * Run an untrusted WebAssembly function with a wall-clock limit.
 *
 * WebAssembly cannot reach anything it is not given, but it can loop forever. So the call runs in a
 * worker (worker_threads in Node, a Web Worker in the browser) that is terminated when time is up.
 * The module must have no imports. Arguments and the result are numbers (i32/i64/f32/f64).
 */
export type BoundedResult = { ok: true; value: number | bigint; ms: number } | { ok: false; reason: string };

const WORKER_SOURCE = `
const run = (msg) => {
  try {
    const mod = new WebAssembly.Module(msg.bytes);
    const inst = new WebAssembly.Instance(mod, {});
    const fn = inst.exports[msg.name];
    if (typeof fn !== "function") return { ok: false, reason: "export is not a function" };
    const args = msg.args.map((a) => (a.t === "i64" ? BigInt(a.v) : Number(a.v)));
    const value = fn(...args);
    return { ok: true, value: typeof value === "bigint" ? { t: "i64", v: value.toString() } : { t: "num", v: value } };
  } catch (error) {
    return { ok: false, reason: "trapped: " + (error && error.message ? error.message : String(error)) };
  }
};
`;

export type WasmSignature = { params: ("i32" | "i64" | "f32" | "f64")[]; results: ("i32" | "i64" | "f32" | "f64")[] };

/** Read a function export's signature without running anything. */
export function exportSignature(bytes: Uint8Array, name: string): WasmSignature | null {
  // Minimal parse of the type, import, function and export sections.
  let p = 8;
  const u = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[p++];
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return result >>> 0;
      shift += 7;
    }
  };
  const VT: Record<number, "i32" | "i64" | "f32" | "f64"> = { 0x7f: "i32", 0x7e: "i64", 0x7d: "f32", 0x7c: "f64" };
  const types: WasmSignature[] = [];
  const funcs: number[] = [];
  let importedFuncs = 0;
  let exportIndex = -1;
  try {
    while (p < bytes.length) {
      const id = bytes[p++];
      const size = u();
      const end = p + size;
      if (id === 1) {
        const n = u();
        for (let i = 0; i < n; i += 1) {
          if (bytes[p++] !== 0x60) return null;
          const pc = u();
          const params = Array.from({ length: pc }, () => VT[bytes[p++]]);
          const rc = u();
          const results = Array.from({ length: rc }, () => VT[bytes[p++]]);
          types.push({ params, results });
        }
      } else if (id === 2) {
        const n = u();
        for (let i = 0; i < n; i += 1) {
          p += u(); p += u();
          const kind = bytes[p++];
          if (kind === 0) { u(); importedFuncs += 1; } else return null;
        }
      } else if (id === 3) {
        const n = u();
        for (let i = 0; i < n; i += 1) funcs.push(u());
      } else if (id === 7) {
        const n = u();
        for (let i = 0; i < n; i += 1) {
          const len = u();
          const text = new TextDecoder().decode(bytes.subarray(p, p + len));
          p += len;
          const kind = bytes[p++];
          const index = u();
          if (kind === 0 && text === name) exportIndex = index;
        }
      }
      p = end;
    }
  } catch {
    return null;
  }
  if (exportIndex < importedFuncs) return null;
  const type = types[funcs[exportIndex - importedFuncs]];
  return type && type.params.every(Boolean) && type.results.every(Boolean) ? type : null;
}

export async function runWasmBounded(bytes: Uint8Array, name: string, args: (number | bigint)[], timeoutMs = 1000): Promise<BoundedResult> {
  if (!WebAssembly.validate(bytes as BufferSource)) return { ok: false, reason: "module failed validation" };
  const module = new WebAssembly.Module(bytes as BufferSource);
  if (WebAssembly.Module.imports(module).length) return { ok: false, reason: "module asks for imports; skills get none" };
  const payload = {
    bytes,
    name,
    args: args.map((a) => (typeof a === "bigint" ? { t: "i64", v: a.toString() } : { t: "num", v: a })),
  };
  const started = Date.now();
  const decode = (raw: { ok: boolean; reason?: string; value?: { t: string; v: string | number } }): BoundedResult =>
    raw.ok && raw.value
      ? { ok: true, value: raw.value.t === "i64" ? BigInt(raw.value.v) : Number(raw.value.v), ms: Date.now() - started }
      : { ok: false, reason: raw.reason ?? "failed" };

  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  if (isNode) {
    const { Worker } = await import("node:worker_threads");
    const worker = new Worker(`${WORKER_SOURCE}\nconst { parentPort } = require("node:worker_threads");\nparentPort.on("message", (m) => parentPort.postMessage(run(m)));`, { eval: true });
    return new Promise<BoundedResult>((resolve) => {
      const timer = setTimeout(() => {
        void worker.terminate();
        resolve({ ok: false, reason: `stopped after ${timeoutMs} ms` });
      }, timeoutMs);
      worker.once("message", (raw) => {
        clearTimeout(timer);
        void worker.terminate();
        resolve(decode(raw));
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        resolve({ ok: false, reason: String(error) });
      });
      worker.postMessage(payload);
    });
  }
  if (typeof Worker === "undefined" || typeof Blob === "undefined") return { ok: false, reason: "no worker available to bound the call" };
  const url = URL.createObjectURL(new Blob([`${WORKER_SOURCE}\nself.onmessage = (e) => self.postMessage(run(e.data));`], { type: "text/javascript" }));
  const worker = new Worker(url);
  return new Promise<BoundedResult>((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({ ok: false, reason: `stopped after ${timeoutMs} ms` });
    }, timeoutMs);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(decode(event.data));
    };
    worker.postMessage(payload);
  });
}
