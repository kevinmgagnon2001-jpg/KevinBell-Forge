/**
 * Builds the random-program corpus for the compat layer, using the real CPU as the oracle.
 *
 *   node --experimental-strip-types scripts/gen-compat-corpus.ts [count] [seed]
 *
 * Each random program is written twice, as x86-64 and as AArch64 assembly with the same meaning,
 * assembled into static Linux executables (as/ld and clang/ld.lld), and the x86-64 one is run on
 * this machine. Its output (eight 64-bit registers) is the expected answer for both builds.
 * The corpus is saved to fixtures/compat-corpus.json and replayed by src/engine/guest/corpus.test.ts
 * without any toolchain. Needs: as, ld, clang with the aarch64 target, ld.lld, an x86-64 host.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Cc = "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "lo" | "ls" | "hi" | "hs";
const CCS: Cc[] = ["eq", "ne", "lt", "le", "gt", "ge", "lo", "ls", "hi", "hs"];
const X86CC: Record<Cc, string> = { eq: "e", ne: "ne", lt: "l", le: "le", gt: "g", ge: "ge", lo: "b", ls: "be", hi: "a", hs: "ae" };

const XV = ["r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15"];
const XV32 = XV.map((r) => `${r}d`);
const XV8 = XV.map((r) => `${r}b`);
const XV16 = XV.map((r) => `${r}w`);
const AV = [19, 20, 21, 22, 23, 24, 25, 26];

let state = 1;
const rand = (n: number) => {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5; state >>>= 0;
  return state % n;
};
const pick = <T>(xs: T[]): T => xs[rand(xs.length)];
const r64 = (): bigint => {
  const kind = rand(5);
  if (kind === 0) return BigInt(rand(16));
  if (kind === 1) return BigInt(rand(65536));
  if (kind === 2) return (1n << 64n) - BigInt(1 + rand(1000));
  if (kind === 3) return BigInt(1 + rand(0x7fffffff)) << BigInt(rand(33));
  return (BigInt(rand(0x10000)) << 48n) | (BigInt(rand(0x10000)) << 32n) | (BigInt(rand(0x10000)) << 16n) | BigInt(rand(0x10000));
};
const hx = (v: bigint) => `0x${v.toString(16)}`;
const LOGIC_MASKS = [0xffn, 0xffffn, 0xffffffffn, 0xff00ff00ff00ff00n, 0x0f0f0f0f0f0f0f0fn, 0x5555555555555555n, 0xfffffffffffffff0n, 0x7fffffffffffffffn];

type Out = { x: string[]; a: string[] };

let label = 0;
function op(out: Out, depth: number, allowLoop: boolean) {
  const d = rand(8), s = rand(8), t = rand(8);
  const kind = rand(allowLoop ? 17 : 15);
  const X = out.x, A = out.a;
  switch (kind) {
    case 0: { // movi
      const v = r64();
      X.push(`movabs ${XV[d]}, ${hx(v)}`);
      A.push(`movz x${AV[d]}, #${hx(v & 0xffffn)}`);
      for (let k = 1n; k < 4n; k += 1n) {
        const part = (v >> (16n * k)) & 0xffffn;
        if (part) A.push(`movk x${AV[d]}, #${hx(part)}, lsl #${16n * k}`);
      }
      return;
    }
    case 1: case 2: { // alu reg, 64 or 32
      const name = pick(["add", "sub", "and", "or", "xor", "mul"]);
      const wide = kind === 1;
      const xr = wide ? XV : XV32;
      const ar = (i: number) => `${wide ? "x" : "w"}${AV[i]}`;
      const acc = wide ? "rax" : "eax";
      X.push(`mov ${acc}, ${xr[s]}`);
      X.push(name === "mul" ? `imul ${acc}, ${xr[t]}` : `${name} ${acc}, ${xr[t]}`);
      X.push(`mov ${xr[d]}, ${acc}`);
      const an = { add: "add", sub: "sub", and: "and", or: "orr", xor: "eor", mul: "mul" }[name]!;
      A.push(`${an} ${ar(d)}, ${ar(s)}, ${ar(t)}`);
      return;
    }
    case 3: { // add/sub imm12
      const name = pick(["add", "sub"]);
      const v = rand(4096);
      X.push(`mov rax, ${XV[s]}`, `${name} rax, ${v}`, `mov ${XV[d]}, rax`);
      A.push(`${name} x${AV[d]}, x${AV[s]}, #${v}`);
      return;
    }
    case 4: { // logic with a bitmask immediate
      const name = pick(["and", "or", "xor"]);
      const m = pick(LOGIC_MASKS);
      X.push(`movabs rax, ${hx(m)}`, `${name} rax, ${XV[s]}`, `mov ${XV[d]}, rax`);
      A.push(`${{ and: "and", or: "orr", xor: "eor" }[name]} x${AV[d]}, x${AV[s]}, #${hx(m)}`);
      return;
    }
    case 5: { // shift by immediate
      const name = pick(["shl", "shr", "sar"]);
      const wide = rand(2) === 0;
      const n = rand(wide ? 64 : 32);
      const acc = wide ? "rax" : "eax";
      X.push(`mov ${acc}, ${(wide ? XV : XV32)[s]}`, `${name} ${acc}, ${n}`, `mov ${(wide ? XV : XV32)[d]}, ${acc}`);
      A.push(`${{ shl: "lsl", shr: "lsr", sar: "asr" }[name]} ${wide ? "x" : "w"}${AV[d]}, ${wide ? "x" : "w"}${AV[s]}, #${n}`);
      return;
    }
    case 6: { // shift by register
      const name = pick(["shl", "shr", "sar"]);
      X.push(`mov rcx, ${XV[t]}`, `mov rax, ${XV[s]}`, `${name} rax, cl`, `mov ${XV[d]}, rax`);
      A.push(`${{ shl: "lsl", shr: "lsr", sar: "asr" }[name]} x${AV[d]}, x${AV[s]}, x${AV[t]}`);
      return;
    }
    case 7: { // high multiply
      const signed = rand(2) === 0;
      X.push(`mov rax, ${XV[s]}`, `${signed ? "imul" : "mul"} ${XV[t]}`, `mov ${XV[d]}, rdx`);
      A.push(`${signed ? "smulh" : "umulh"} x${AV[d]}, x${AV[s]}, x${AV[t]}`);
      return;
    }
    case 8: { // unsigned div / rem
      const rem = rand(2) === 0;
      X.push(`mov rcx, ${XV[t]}`, "or rcx, 1", `mov rax, ${XV[s]}`, "xor edx, edx", "div rcx", `mov ${XV[d]}, ${rem ? "rdx" : "rax"}`);
      A.push(`orr x0, x${AV[t]}, #1`, `udiv x1, x${AV[s]}, x0`);
      A.push(rem ? `msub x${AV[d]}, x1, x0, x${AV[s]}` : `mov x${AV[d]}, x1`);
      return;
    }
    case 9: { // signed div / rem by a small positive divisor
      const rem = rand(2) === 0;
      X.push(`mov rcx, ${XV[t]}`, "and rcx, 0xffff", "or rcx, 1", `mov rax, ${XV[s]}`, "cqo", "idiv rcx", `mov ${XV[d]}, ${rem ? "rdx" : "rax"}`);
      A.push(`and x0, x${AV[t]}, #0xffff`, "orr x0, x0, #1", `sdiv x1, x${AV[s]}, x0`);
      A.push(rem ? `msub x${AV[d]}, x1, x0, x${AV[s]}` : `mov x${AV[d]}, x1`);
      return;
    }
    case 10: { // cmp + cmov / csel
      const cc = pick(CCS);
      const e = rand(8);
      X.push(`cmp ${XV[s]}, ${XV[t]}`, `cmov${X86CC[cc]} ${XV[d]}, ${XV[e]}`);
      A.push(`cmp x${AV[s]}, x${AV[t]}`, `csel x${AV[d]}, x${AV[e]}, x${AV[d]}, ${cc}`);
      return;
    }
    case 11: { // cmp + set / cset, sometimes against an immediate
      const cc = pick(CCS);
      if (rand(2)) {
        const v = rand(4096);
        X.push(`cmp ${XV[s]}, ${v}`);
        A.push(`cmp x${AV[s]}, #${v}`);
      } else {
        X.push(`cmp ${XV[s]}, ${XV[t]}`);
        A.push(`cmp x${AV[s]}, x${AV[t]}`);
      }
      X.push(`set${X86CC[cc]} al`, "movzx eax, al", `mov ${XV[d]}, rax`);
      A.push(`cset x${AV[d]}, ${cc}`);
      return;
    }
    case 12: { // store then load, all sizes and extensions
      const size = pick([1, 2, 4, 8]);
      const off = rand(256 / size) * size;
      const signed = size < 8 && rand(2) === 0;
      const xs = { 1: XV8, 2: XV16, 4: XV32, 8: XV }[size]![s];
      const ptr = { 1: "byte", 2: "word", 4: "dword", 8: "qword" }[size];
      X.push(`mov ${ptr} ptr [rbx+${off}], ${xs}`);
      const as = { 1: "strb", 2: "strh", 4: "str", 8: "str" }[size];
      A.push(`${as} ${size === 8 ? "x" : "w"}${AV[s]}, [x27, #${off}]`);
      const off2 = rand(256 / size) * size;
      if (size === 8) { X.push(`mov ${XV[d]}, qword ptr [rbx+${off2}]`); A.push(`ldr x${AV[d]}, [x27, #${off2}]`); }
      else if (size === 4) {
        if (signed) { X.push(`movsxd ${XV[d]}, dword ptr [rbx+${off2}]`); A.push(`ldrsw x${AV[d]}, [x27, #${off2}]`); }
        else { X.push(`mov ${XV32[d]}, dword ptr [rbx+${off2}]`); A.push(`ldr w${AV[d]}, [x27, #${off2}]`); }
      } else {
        X.push(`${signed ? "movsx" : "movzx"} ${signed ? XV[d] : XV32[d]}, ${ptr} ptr [rbx+${off2}]`);
        A.push(`ldr${signed ? "s" : ""}${size === 1 ? "b" : "h"} ${signed ? "x" : "w"}${AV[d]}, [x27, #${off2}]`);
      }
      return;
    }
    case 13: { // indexed addressing: buf[(v & 31) * 8]
      X.push(`mov rcx, ${XV[t]}`, "and rcx, 31", `mov qword ptr [rbx+rcx*8], ${XV[s]}`, `add ${XV[d]}, qword ptr [rbx+rcx*8]`);
      A.push(`and x0, x${AV[t]}, #31`, `str x${AV[s]}, [x27, x0, lsl #3]`, `ldr x1, [x27, x0, lsl #3]`, `add x${AV[d]}, x${AV[d]}, x1`);
      return;
    }
    case 14: { // call a subroutine (stack frame, push/pop, stp/ldp)
      X.push("call fx");
      A.push("bl fa");
      return;
    }
    case 15: { // forward conditional skip
      if (depth > 1) return;
      const cc = pick(CCS);
      const l = `skip_${label++}`;
      X.push(`cmp ${XV[s]}, ${XV[t]}`, `j${X86CC[cc]} ${l}`);
      A.push(`cmp x${AV[s]}, x${AV[t]}`, `b.${cc} ${l}`);
      const n = 1 + rand(3);
      for (let i = 0; i < n; i += 1) op(out, depth + 1, false);
      X.push(`${l}:`);
      A.push(`${l}:`);
      return;
    }
    case 16: { // bounded loop
      if (depth > 0) return;
      const k = 1 + rand(12);
      const l = `loop_${label++}`;
      X.push(`mov edi, ${k}`, `${l}:`);
      A.push(`mov x3, #${k}`, `${l}:`);
      const n = 1 + rand(4);
      for (let i = 0; i < n; i += 1) op(out, depth + 1, false);
      if (rand(2)) {
        X.push("sub rdi, 1", `jnz ${l}`);
        A.push("subs x3, x3, #1", `b.ne ${l}`);
      } else {
        X.push("dec rdi", "test rdi, rdi", `jne ${l}`);
        A.push("sub x3, x3, #1", `cbnz x3, ${l}`);
      }
      return;
    }
  }
}

function program(): { x86: string; arm: string } {
  const out: Out = { x: [], a: [] };
  for (let i = 0; i < 8; i += 1) {
    const v = r64();
    out.x.push(`movabs ${XV[i]}, ${hx(v)}`);
    out.a.push(`movz x${AV[i]}, #${hx(v & 0xffffn)}`);
    for (let k = 1n; k < 4n; k += 1n) out.a.push(`movk x${AV[i]}, #${hx((v >> (16n * k)) & 0xffffn)}, lsl #${16n * k}`);
  }
  const n = 6 + rand(30);
  for (let i = 0; i < n; i += 1) op(out, 0, true);
  const x86 = [
    ".intel_syntax noprefix", ".globl _start", ".text", "_start:", "lea rbx, [rip+buf]",
    ...out.x,
    ...XV.map((r, i) => `mov qword ptr [rbx+${256 + i * 8}], ${r}`),
    "mov eax, 1", "mov edi, 1", "lea rsi, [rbx+256]", "mov edx, 64", "syscall",
    "mov eax, 60", "xor edi, edi", "syscall",
    "fx:", "push rbp", "mov rbp, rsp", "sub rsp, 16", "mov qword ptr [rbp-8], r8", "mov rax, qword ptr [rbp-8]",
    "imul rax, rax, 3", "add rax, r9", "mov r8, rax", "leave", "ret",
    ".bss", ".align 16", "buf: .zero 512",
  ].join("\n");
  const arm = [
    ".globl _start", ".text", "_start:", "adrp x27, buf", "add x27, x27, :lo12:buf",
    ...out.a,
    ...AV.map((r, i) => `str x${r}, [x27, #${256 + i * 8}]`),
    "mov x8, #64", "mov x0, #1", "add x1, x27, #256", "mov x2, #64", "svc #0",
    "mov x8, #93", "mov x0, #0", "svc #0",
    "fa:", "stp x29, x30, [sp, #-32]!", "mov x29, sp", "str x19, [sp, #16]", "ldr x0, [sp, #16]",
    "mov x1, #3", "mul x0, x0, x1", "add x19, x0, x20", "ldp x29, x30, [sp], #32", "ret",
    ".bss", ".align 4", "buf: .zero 512",
  ].join("\n");
  return { x86: `${x86}\n`, arm: `${arm}\n` };
}

const count = Number(process.argv[2] ?? 120);
state = Number(process.argv[3] ?? 20261012) >>> 0 || 1;
const dir = mkdtempSync(join(tmpdir(), "forge-corpus-"));
const cases: { id: number; x86: string; arm: string; expected: string; asm: { x86: string; arm: string } }[] = [];
try {
  for (let id = 0; id < count; id += 1) {
    const p = program();
    writeFileSync(join(dir, "x.s"), p.x86);
    writeFileSync(join(dir, "a.s"), p.arm);
    execFileSync("as", [join(dir, "x.s"), "-o", join(dir, "x.o")]);
    execFileSync("ld", ["-static", "-n", "-s", "--no-warn-rwx-segments", join(dir, "x.o"), "-o", join(dir, "x.elf")]);
    execFileSync("clang", ["--target=aarch64-linux-gnu", "-c", join(dir, "a.s"), "-o", join(dir, "a.o")]);
    execFileSync("ld.lld", ["-static", "-n", "-s", join(dir, "a.o"), "-o", join(dir, "a.elf")]);
    const expected = execFileSync(join(dir, "x.elf")).toString("hex");
    cases.push({
      id,
      x86: readFileSync(join(dir, "x.elf")).toString("base64"),
      arm: readFileSync(join(dir, "a.elf")).toString("base64"),
      expected,
      asm: { x86: p.x86, arm: p.arm },
    });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(new URL("../fixtures/compat-corpus.json", import.meta.url), JSON.stringify({ oracle: "x86-64 hardware", generated: new Date().toISOString().slice(0, 10), cases }));
console.log(`wrote ${cases.length} programs to fixtures/compat-corpus.json`);
