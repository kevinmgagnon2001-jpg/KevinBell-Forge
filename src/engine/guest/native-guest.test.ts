/**
 * The page side of the desktop runner (runLinuxHosted), against a stand-in for the Rust commands
 * in src-tauri (guest_start / guest_resume / guest_swap / guest_end). The stand-in follows the same
 * contract as guest.rs: run the import-free module, answer system calls, hand fuel out in slices,
 * report untranslated code back so the page lifts more and swaps the module.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runLinuxHosted } from "../native-host.ts";
import { GuestState } from "./machine.ts";
import { LinuxShim } from "./linux.ts";
import { Stop } from "./ir.ts";

function fakeDesktop() {
  type S = { run: () => number; mem: Uint8Array; shim: LinuxShim; budget: number; start: number };
  const sessions = new Map<number, S>();
  let next = 1;
  let swaps = 0;
  const instantiate = (module: number[]) => {
    const m = new WebAssembly.Module(Uint8Array.from(module));
    assert.equal(WebAssembly.Module.imports(m).length, 0, "guest modules import nothing");
    const inst = new WebAssembly.Instance(m, {});
    return { run: inst.exports.run as () => number, mem: new Uint8Array((inst.exports.mem as WebAssembly.Memory).buffer) };
  };
  const invoke = async (cmd: string, a: Record<string, any> = {}) => {
    if (cmd === "guest_start") {
      const vm = instantiate(a.module);
      for (const [addr, bytes] of a.chunks as [number, number[]][]) vm.mem.set(bytes, addr);
      const id = next++;
      sessions.set(id, { ...vm, shim: new LinuxShim(a.arch, BigInt(a.brkBase), BigInt(a.mmapTop), Uint8Array.from(a.stdin)), budget: a.fuel, start: a.fuel });
      return id;
    }
    const s = sessions.get(a.id)!;
    if (cmd === "guest_swap") {
      const vm = instantiate(a.module);
      vm.mem.set(s.mem);
      s.run = vm.run;
      s.mem = vm.mem;
      swaps += 1;
      return null;
    }
    if (cmd === "guest_end") return sessions.delete(a.id);
    if (cmd !== "guest_resume") throw new Error(cmd);
    const state = new GuestState(s.mem);
    const reply = (status: string, code = 0, pc = 0n, fault = 0n) => {
      const out = { status, code, detail: "", pc: Number(pc), fault: Number(fault), exitCode: s.shim.exitCode, stdout: Array.from(s.shim.stdout.bytes()), stderr: [], syscalls: { ...s.shim.counts }, unsupported: [...s.shim.unsupported], fuelUsed: s.start - s.budget };
      (s.shim as unknown as { stdout: { bytes: () => Uint8Array } }).stdout = new (s.shim.stdout.constructor as any)();
      return out;
    };
    for (let e = 0; e < a.maxEvents; e += 1) {
      const give = Math.max(0, Math.min(s.budget, 100_000));
      state.fuel = BigInt(give);
      const code = s.run();
      s.budget -= give - Math.max(0, Number(state.fuel));
      if (code === Stop.syscall) {
        if (s.shim.handle(state) === "exit") return reply("exit");
        continue;
      }
      if (code === Stop.fuel) return s.budget <= 0 ? reply("stopped", code, state.pc) : reply("running");
      if (code === Stop.unmapped) return reply("needs-code", code, state.pc);
      return reply("stopped", code, state.pc, state.faultAddr);
    }
    return reply("running");
  };
  return { invoke, swaps: () => swaps };
}

test("desktop path: the C workload runs through the native protocol, lifting more code and swapping modules as it goes", async () => {
  const fake = fakeDesktop();
  (globalThis as any).__TAURI_INTERNALS__ = { invoke: fake.invoke };
  try {
    const expected = readFileSync(new URL("../../../fixtures/linux/workload.expected", import.meta.url), "utf8");
    for (const file of ["workload-x86_64-gcc-O0.elf", "workload-aarch64-clang-O3.elf"]) {
      const elf = new Uint8Array(readFileSync(new URL(`../../../fixtures/linux/${file}`, import.meta.url)));
      const report = await runLinuxHosted(elf, { stdin: "abc" });
      assert.equal(report.host, "desktop");
      assert.equal(report.ok, true, report.detail);
      assert.equal(report.stdout, expected, file);
      assert.equal(report.exitCode, 7);
    }
    assert.ok(fake.swaps() > 0, "indirect calls made the page lift more code and swap the module");
  } finally {
    delete (globalThis as any).__TAURI_INTERNALS__;
  }
});

test("without the desktop host the same call runs in the page", async () => {
  const elf = new Uint8Array(readFileSync(new URL("../../../fixtures/linux/hello-aarch64.elf", import.meta.url)));
  const report = await runLinuxHosted(elf);
  assert.equal(report.host, "browser");
  assert.match(report.stdout, /AArch64/);
});
