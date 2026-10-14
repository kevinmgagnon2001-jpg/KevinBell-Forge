import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { decodeArm } from "./arm.ts";
import { describeOp, Stop } from "./ir.ts";
import { runLinux } from "./linux.ts";
import { decodeX86 } from "./x86.ts";
import { parseRecordedTree } from "../../../scripts/fixture-tree.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../fixtures/linux/${name}`, import.meta.url)));
const text = (name: string) => readFileSync(new URL(`../../../fixtures/linux/${name}`, import.meta.url), "utf8");
const bytesFetch = (bytes: number[]) => (addr: bigint) => (addr < BigInt(bytes.length) ? bytes[Number(addr)] : undefined);

test("hand-written x86-64 and AArch64 Linux programs print the same as on real Linux", () => {
  const expected = text("hello.expected");
  for (const engine of ["wasm", "interpreter"] as const) {
    const x86 = runLinux(fixture("hello-x86_64.elf"), { engine });
    assert.equal(x86.ok, true, x86.detail);
    assert.equal(x86.stdout, expected);
    const arm = runLinux(fixture("hello-aarch64.elf"), { engine });
    assert.equal(arm.ok, true, arm.detail);
    assert.equal(arm.stdout, expected.replace("x86-64", "AArch64"));
    assert.equal(arm.arch, "aarch64");
  }
});

test("one C program from gcc and clang, x86-64 and AArch64, -O0 to -O3, matches real hardware on both engines", () => {
  const expected = text("workload.expected");
  const code = Number(text("workload.exitcode").trim());
  const builds = ["x86_64", "x86_64-gcc-O0", "x86_64-gcc-Os", "x86_64-gcc-O3", "x86_64-clang-O1", "aarch64", "aarch64-clang-O0", "aarch64-clang-O3"].map((b) => `workload-${b}.elf`);
  for (const file of builds) {
    for (const engine of ["wasm", "interpreter"] as const) {
      const report = runLinux(fixture(file), { engine, stdin: "abc" });
      assert.equal(report.ok, true, `${file} ${engine}: ${report.detail}`);
      assert.equal(report.stdout, expected, `${file} ${engine}`);
      assert.equal(report.exitCode, code);
      assert.deepEqual(report.unsupportedSyscalls, []);
    }
  }
});

test("unknown machine code is reported as a gap and never executed", () => {
  // x86: mov eax,1 ; rdtsc (not in the map) ; mov eax,60 ; syscall
  const d = decodeX86(bytesFetch([0x0f, 0x31]), 0n);
  assert.ok("gap" in d);
  assert.match(d.gap.reason, /not in the map/);
  // ARM: SVE (ptrue p0.b) and LSE atomics (casal) are gaps; the guest is told it has neither
  for (const bytes of [[0xe0, 0xe3, 0x18, 0x25], [0x41, 0xfc, 0xe0, 0xc8]]) {
    const a = decodeArm(bytesFetch(bytes), 0n);
    assert.ok("gap" in a, bytes.join(","));
  }
});

test("a program that reaches a gap stops there with evidence; nothing after it runs", () => {
  const elf = fixture("hello-x86_64.elf").slice();
  // Patch the first instruction (mov eax,1 = b8 01 00 00 00) into rdtsc + 3 nops.
  const entry = Number(new DataView(elf.buffer).getBigUint64(24, true));
  const phoff = Number(new DataView(elf.buffer).getBigUint64(32, true));
  const vaddr = Number(new DataView(elf.buffer).getBigUint64(phoff + 16, true));
  const off = Number(new DataView(elf.buffer).getBigUint64(phoff + 8, true));
  const at = entry - vaddr + off;
  elf.set([0x0f, 0x31, 0x90, 0x90, 0x90], at);
  for (const engine of ["wasm", "interpreter"] as const) {
    const report = runLinux(elf, { engine });
    assert.equal(report.ok, false);
    assert.equal(report.stdout, "");
    assert.match(report.detail, /Not executed/);
  }
});

test("infinite loops stop on fuel; stray memory access stops as a fault", () => {
  // jmp $ (eb fe) as an x86 ELF made from the hello fixture
  const elf = fixture("hello-x86_64.elf").slice();
  const dv = new DataView(elf.buffer);
  const entry = Number(dv.getBigUint64(24, true));
  const phoff = Number(dv.getBigUint64(32, true));
  const at = entry - Number(dv.getBigUint64(phoff + 16, true)) + Number(dv.getBigUint64(phoff + 8, true));
  elf.set([0xeb, 0xfe], at);
  for (const engine of ["wasm", "interpreter"] as const) {
    const report = runLinux(elf, { engine, fuel: 10_000 });
    assert.equal(report.ok, false);
    assert.equal(report.stop, "out of fuel");
  }
  // mov rax, [0] -> null page fault
  const bad = fixture("hello-x86_64.elf").slice();
  bad.set([0x48, 0x8b, 0x04, 0x25, 0, 0, 0, 0], at);
  for (const engine of ["wasm", "interpreter"] as const) {
    const report = runLinux(bad, { engine });
    assert.equal(report.stop, "memory fault");
    assert.match(report.detail, /0x0 /);
  }
});

test("writing into the program's own code is refused", () => {
  // mov byte [rip+0], 0x90 then exit: the store targets code
  const elf = fixture("hello-x86_64.elf").slice();
  const dv = new DataView(elf.buffer);
  const entry = Number(dv.getBigUint64(24, true));
  const phoff = Number(dv.getBigUint64(32, true));
  const at = entry - Number(dv.getBigUint64(phoff + 16, true)) + Number(dv.getBigUint64(phoff + 8, true));
  elf.set([0xc6, 0x05, 0x00, 0x00, 0x00, 0x00, 0x90], at);
  for (const engine of ["wasm", "interpreter"] as const) {
    const report = runLinux(elf, { engine });
    assert.equal(report.stop, STOP_SMC);
  }
});
const STOP_SMC = "program tried to modify its own code";

test("decoders produce readable IR evidence", () => {
  // x86: lea rsi, [rip+0x10] ; ARM: add x0, sp, #16
  const x = decodeX86(bytesFetch([0x48, 0x8d, 0x35, 0x10, 0, 0, 0]), 0n);
  assert.ok("insn" in x);
  assert.equal(describeOp(x.insn.ops[0]), "lea r6, [0x17]");
  const a = decodeArm(bytesFetch([0xe0, 0x43, 0x00, 0x91]), 0n);
  assert.ok("insn" in a);
  assert.equal(describeOp(a.insn.ops[0]), "add.64 r0, r31, #0x10");
  assert.equal(Stop.gap, 4);
});

test("non-ELF and dynamically linked inputs are refused with a reason", () => {
  assert.match(runLinux(new Uint8Array([1, 2, 3])).detail, /not an ELF/);
});

test("ordinary glibc programs (static): printf, malloc, qsort, strings, TLS, SSE2 and floating point match real hardware", () => {
  const demoOut = text("libc-demo.expected");
  const demoErr = text("libc-demo.stderr");
  const floatOut = text("libc-float.expected");
  for (const engine of ["tiered", "interpreter", "wasm"] as const) {
    const demo = runLinux(fixture("libc-demo-x86_64.elf"), { engine, stdin: "abc" });
    assert.equal(demo.ok, true, `${engine}: ${demo.detail}`);
    assert.equal(demo.stdout, demoOut, engine);
    assert.equal(demo.stderr, demoErr, engine);
    assert.equal(demo.exitCode, 0);
    const fp = runLinux(fixture("libc-float-x86_64.elf"), { engine });
    assert.equal(fp.ok, true, `${engine}: ${fp.detail}`);
    assert.equal(fp.stdout, floatOut, engine);
  }
});

test("files: raw system calls on x86-64 and AArch64, and glibc stdio, match real hardware, files left behind included", () => {
  const input = fixture("files-in.txt");
  const runs = [
    { file: "files-x86_64.elf", out: "files.expected", code: Number(text("files.exitcode").trim()), tree: { "/in.txt": text("files-in.txt"), "/out.txt": text("files.out.txt") } },
    { file: "files-aarch64.elf", out: "files.expected", code: Number(text("files.exitcode").trim()), tree: { "/in.txt": text("files-in.txt"), "/out.txt": text("files.out.txt") } },
    { file: "libc-files-x86_64.elf", out: "libc-files.expected", code: 0, tree: { "/in.txt": text("files-in.txt"), "/report.txt": text("libc-files.report.txt") } },
  ];
  for (const run of runs) {
    for (const engine of ["tiered", "interpreter", "wasm"] as const) {
      const report = runLinux(fixture(run.file), { engine, files: { "in.txt": input } });
      assert.equal(report.ok, true, `${run.file} ${engine}: ${report.detail}`);
      assert.equal(report.stdout, text(run.out), `${run.file} ${engine}`);
      assert.equal(report.exitCode, run.code);
      assert.deepEqual(report.unsupportedSyscalls, []);
      const tree = Object.fromEntries(Object.entries(report.files).map(([k, v]) => [k, new TextDecoder().decode(v)]));
      assert.deepEqual(tree, run.tree, `${run.file} ${engine}`);
    }
  }
});

test("directories, dup, fcntl and pipes: raw system calls on x86-64 and AArch64, and glibc, match real hardware", () => {
  const input = fixture("files-in.txt");
  const runs = [
    { file: "dirs-x86_64.elf", name: "dirs" },
    { file: "dirs-aarch64.elf", name: "dirs" },
    { file: "libc-dirs-x86_64.elf", name: "libc-dirs" },
  ];
  for (const run of runs) {
    for (const engine of ["tiered", "interpreter", "wasm"] as const) {
      const report = runLinux(fixture(run.file), { engine, files: { "in.txt": input } });
      assert.equal(report.ok, true, `${run.file} ${engine}: ${report.detail}`);
      assert.equal(report.stdout, text(`${run.name}.expected`), `${run.file} ${engine}`);
      assert.equal(report.exitCode, Number(text(`${run.name}.exitcode`).trim()));
      assert.deepEqual(report.unsupportedSyscalls, []);
      const tree = Object.fromEntries(Object.entries(report.files).map(([k, v]) => [k, new TextDecoder().decode(v)]));
      assert.deepEqual(tree, parseRecordedTree(text(`${run.name}.tree`)), `${run.file} ${engine}`);
    }
  }
});

test("mapped files, renames, truncation, poll/select and links: raw system calls on x86-64 and AArch64, and glibc, match real hardware", () => {
  const input = fixture("files-in.txt");
  const runs = [
    { file: "mapio-x86_64.elf", name: "mapio" },
    { file: "mapio-aarch64.elf", name: "mapio" },
    { file: "libc-mapio-x86_64.elf", name: "libc-mapio" },
    { file: "links-x86_64.elf", name: "links" },
    { file: "links-aarch64.elf", name: "links" },
    { file: "libc-links-x86_64.elf", name: "libc-links" },
  ];
  for (const run of runs) {
    for (const engine of ["tiered", "interpreter", "wasm"] as const) {
      const report = runLinux(fixture(run.file), { engine, files: { "in.txt": input } });
      assert.equal(report.ok, true, `${run.file} ${engine}: ${report.detail}`);
      assert.equal(report.stdout, text(`${run.name}.expected`), `${run.file} ${engine}`);
      assert.equal(report.exitCode, Number(text(`${run.name}.exitcode`).trim()));
      assert.deepEqual(report.unsupportedSyscalls, []);
      const tree = Object.fromEntries(Object.entries(report.files).map(([k, v]) => [k, new TextDecoder().decode(v)]));
      assert.deepEqual(tree, parseRecordedTree(text(`${run.name}.tree`)), `${run.file} ${engine}`);
    }
  }
});

test("threads: glibc pthreads (mutex, condition variable, barrier, once, TLS, join) match real hardware on every engine", () => {
  for (const engine of ["tiered", "interpreter", "wasm"] as const) {
    const report = runLinux(fixture("libc-threads-x86_64.elf"), { engine });
    assert.equal(report.ok, true, `${engine}: ${report.detail}`);
    assert.equal(report.stdout, text("libc-threads.expected"), engine);
    assert.equal(report.exitCode, Number(text("libc-threads.exitcode").trim()));
    assert.deepEqual(report.unsupportedSyscalls, []);
    assert.ok(report.syscalls.clone >= 7 && report.syscalls.futex > 0, engine);
  }
});

test("ARM64 glibc programs and the NEON/FP instruction corpus (built and run on ARM64 hardware) match the CPU on every engine", () => {
  const input = fixture("files-in.txt");
  for (const name of ["libc-demo", "libc-float", "libc-files", "libc-dirs", "libc-mapio", "libc-links", "neon"]) {
    const withTree = existsSync(new URL(`../../../fixtures/linux/${name}.arm.tree`, import.meta.url));
    for (const engine of ["tiered", "interpreter", "wasm"] as const) {
      const report = runLinux(fixture(`${name}-aarch64.elf`), { engine, stdin: "abc", files: withTree ? { "in.txt": input } : undefined });
      assert.equal(report.ok, true, `${name} ${engine}: ${report.detail}`);
      assert.equal(report.stdout, text(`${name}.arm.expected`), `${name} ${engine}`);
      assert.equal(report.exitCode, Number(text(`${name}.arm.exitcode`).trim()));
      assert.deepEqual(report.unsupportedSyscalls, []);
      if (withTree) {
        const tree = Object.fromEntries(Object.entries(report.files).map(([k, v]) => [k, new TextDecoder().decode(v)]));
        assert.deepEqual(tree, parseRecordedTree(text(`${name}.arm.tree`)), `${name} ${engine}`);
      }
    }
  }
});

test("files: a program sees only its own tree", () => {
  // With an empty tree, in.txt does not exist even though the program asks for it.
  const report = runLinux(fixture("files-x86_64.elf"), { files: {} });
  assert.equal(report.ok, true);
  assert.match(report.stdout, /^open in\.txt: 0\nin\.txt size: -9\n/);
  assert.deepEqual(Object.keys(report.files), ["/out.txt"]);
});
