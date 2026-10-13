/**
 * Run a static Linux program (x86-64 or ARM64) through Forge's Linux layer from the command line.
 *
 *   node --experimental-strip-types scripts/forge-run.ts ./program [--interp] [--fuel N] [--show-ir]
 *
 * Prints the program's output, then a one-line report on stderr: architecture, how it stopped,
 * system calls used, and any instruction gaps (reported, never executed). Exit code is the program's.
 */
import { readFileSync } from "node:fs";
import { readElf } from "../src/engine/guest/elf.ts";
import { describeOp } from "../src/engine/guest/ir.ts";
import { lift, newProgram } from "../src/engine/guest/lift.ts";
import { runLinux } from "../src/engine/guest/linux.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: forge-run.ts <static-linux-program> [--interp] [--fuel N] [--show-ir]");
  process.exit(2);
}
const bytes = new Uint8Array(readFileSync(file));
const fuelAt = args.indexOf("--fuel");
if (args.includes("--show-ir")) {
  const elf = readElf(bytes);
  if (elf.ok) {
    const mem = new Uint8Array(64 * 1024 * 1024);
    for (const s of elf.elf.segments) mem.set(bytes.subarray(s.offset, s.offset + Number(s.filesz)), Number(s.vaddr));
    const program = newProgram(elf.elf.arch, elf.elf.segments.filter((s) => s.flags & 1).map((s) => [s.vaddr, s.vaddr + s.memsz]));
    lift(program, (a) => mem[Number(a)], [elf.elf.entry]);
    for (const insn of [...program.insns.values()].sort((a, b) => (a.pc < b.pc ? -1 : 1)).slice(0, 80)) {
      console.error(`0x${insn.pc.toString(16)}  ${insn.text.padEnd(10)} ${insn.ops.map(describeOp).join(" ; ")}`);
    }
  }
}
let stdin = new Uint8Array();
if (!process.stdin.isTTY) {
  try {
    stdin = new Uint8Array(readFileSync(0));
  } catch {
    /* no stdin attached */
  }
}
const started = performance.now();
const report = runLinux(bytes, {
  engine: args.includes("--interp") ? "interpreter" : "wasm",
  fuel: fuelAt >= 0 ? Number(args[fuelAt + 1]) : undefined,
  stdin,
  argv: [file],
});
process.stdout.write(report.stdoutBytes);
process.stderr.write(report.stderr);
const ms = (performance.now() - started).toFixed(0);
console.error(
  `\n[forge] ${report.arch ?? "?"} via ${report.engine}: ${report.detail} in ${ms} ms; syscalls ${JSON.stringify(report.syscalls)}${report.gaps.length ? `; ${report.gaps.length} undecoded spot(s) seen while lifting (often data after code), none executed` : ""}${report.unsupportedSyscalls.length ? `; unsupported: ${report.unsupportedSyscalls.join(", ")}` : ""}`,
);
process.exit(report.exitCode ?? 125);
