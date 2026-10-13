/**
 * Page-side entry to the Linux layer. In the desktop app the program runs natively (wasmtime); in a
 * browser it runs in a worker (so a long program cannot freeze the window), or inline where workers
 * are unavailable.
 */
import { runLinux, type LinuxOptions, type LinuxReport } from "./linux.ts";

export async function runLinuxProgram(bytes: Uint8Array, options: LinuxOptions = {}, timeoutMs = 30_000): Promise<LinuxReport> {
  if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    // Desktop app: run natively in wasmtime (src-tauri/src/guest.rs).
    const { runLinuxHosted } = await import("../native-host.ts");
    return runLinuxHosted(bytes, options);
  }
  if (typeof Worker === "undefined") return runLinux(bytes, options);
  let worker: Worker;
  try {
    worker = new Worker(new URL("./linux-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return runLinux(bytes, options);
  }
  return new Promise<LinuxReport>((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({
        ok: false, arch: null, engine: options.engine ?? "wasm", exitCode: null, stdout: "", stdoutBytes: new Uint8Array(), stderr: "",
        stop: "timeout", detail: `stopped after ${Math.round(timeoutMs / 1000)} s`, gaps: [], syscalls: {}, unsupportedSyscalls: [], instructions: 0, relifts: 0,
      });
    }, timeoutMs);
    worker.onmessage = (event: MessageEvent<LinuxReport>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(runLinux(bytes, options));
    };
    worker.postMessage({ bytes, options });
  });
}
