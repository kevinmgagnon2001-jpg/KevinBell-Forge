/**
 * One call site for running translated code, whatever is hosting the UI.
 * Inside the Forge desktop app (Tauri) the module runs natively in wasmtime with a fuel limit.
 * In a plain browser tab it runs in the page's own WebAssembly engine.
 */
import type { IrOp } from "./isa.ts";
import { lowerToWasm, runOnWasm } from "./wasm-backend.ts";
import { finishReport, LinuxShim, prepareLinux, relift, runLinux, sparseChunks, stopDetail, type LinuxOptions, type LinuxReport } from "./guest/linux.ts";
import { Stop, type StopCode } from "./guest/ir.ts";
import { lowerProgram } from "./guest/wasm.ts";


type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauri(): TauriInternals | null {
  const internals = (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return internals && typeof internals.invoke === "function" ? internals : null;
}

export type HostKind = "desktop" | "browser";

export function hostKind(): HostKind {
  return tauri() ? "desktop" : "browser";
}

export async function runTranslated(ops: IrOp[], seed = 0): Promise<{ host: HostKind; x0: number }> {
  const native = tauri();
  if (native) {
    const bytes = Array.from(lowerToWasm(ops));
    const x0 = (await native.invoke("run_wasm", { bytes, seed })) as number;
    return { host: "desktop", x0 };
  }
  return { host: "browser", x0: runOnWasm(ops, seed) };
}

// ---------- Linux programs on the desktop host (work item N1) ----------


type Resume = {
  status: "exit" | "needs-code" | "stopped" | "running" | "trap";
  code: number;
  detail: string;
  pc: number;
  fault: number;
  exitCode: number | null;
  stdout: number[];
  stderr: number[];
  syscalls: Record<string, number>;
  unsupported: string[];
  fuelUsed: number;
};

/**
 * Run a static Linux program. In the desktop app the lowered module runs natively in wasmtime and
 * the Rust shim answers system calls (src-tauri/src/guest.rs); when the program reaches code that
 * has not been lifted yet, this side lifts it and swaps in a new module. In a browser tab it runs
 * in the page (runLinux). Same report either way.
 */
export async function runLinuxHosted(bytes: Uint8Array, options: LinuxOptions = {}): Promise<LinuxReport & { host: HostKind }> {
  const native = tauri();
  if (!native) return { ...runLinux(bytes, options), host: "browser" };
  const prepared = prepareLinux(bytes, options);
  if (!prepared.ok) return { ...runLinux(bytes, options), host: "desktop" };
  const { program, fetch, memBytes } = prepared;
  const shimView = new LinuxShim(prepared.arch, prepared.brkBase, prepared.mmapTop); // collects output for the report
  const lower = () => Array.from(lowerProgram(program, memBytes).bytes);
  const stdin = typeof options.stdin === "string" ? new TextEncoder().encode(options.stdin) : options.stdin ?? new Uint8Array();
  const id = (await native.invoke("guest_start", {
    module: lower(),
    arch: prepared.arch,
    chunks: sparseChunks(prepared.memory).map((c) => [c.addr, Array.from(c.bytes)]),
    brkBase: Number(prepared.brkBase),
    mmapTop: Number(prepared.mmapTop),
    stdin: Array.from(stdin),
    fuel: options.fuel ?? 2_000_000_000,
  })) as number;
  let relifts = 0;
  let stop: StopCode = Stop.running;
  let detail = "";
  let used = 0;
  try {
    for (let round = 0; round < 100_000; round += 1) {
      const r = (await native.invoke("guest_resume", { id, maxEvents: 10_000 })) as Resume;
      if (r.stdout.length) shimView.stdout.push(Uint8Array.from(r.stdout));
      if (r.stderr.length) shimView.stderr.push(Uint8Array.from(r.stderr));
      Object.assign(shimView.counts, r.syscalls);
      for (const u of r.unsupported) shimView.unsupported.add(u);
      used = r.fuelUsed;
      if (r.status === "exit") {
        shimView.exitCode = r.exitCode;
        break;
      }
      if (r.status === "running") continue;
      if (r.status === "needs-code") {
        const again = relift(program, fetch, BigInt(r.pc), relifts);
        relifts += 1;
        if (!again.ok) {
          stop = again.stop;
          detail = again.detail;
          break;
        }
        await native.invoke("guest_swap", { id, module: lower() });
        continue;
      }
      if (r.status === "trap") {
        stop = Stop.unsupported;
        detail = `native engine stopped: ${r.detail}`;
        break;
      }
      stop = r.code as StopCode;
      detail = stopDetail(stop, BigInt(r.pc), BigInt(r.fault));
      break;
    }
  } finally {
    await native.invoke("guest_end", { id });
  }
  return { ...finishReport(shimView, program, "wasm", stop, detail, used, relifts), host: "desktop" };
}
