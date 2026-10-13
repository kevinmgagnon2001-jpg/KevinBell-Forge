/**
 * Random x86-64 programs for the instructions glibc needs (SSE2, adc/sbb, rotates, bit tests,
 * bsf/bsr/tzcnt/lzcnt, cmpxchg/xadd, bswap, high-byte registers, 8/16-bit arithmetic, fs: thread-local
 * storage, string moves), with the real CPU as the oracle.
 *
 *   node --experimental-strip-types scripts/gen-x86-corpus.ts [count] [seed]
 *
 * Each program ends by printing 8 general registers, 4 xmm registers and 64 bytes of its buffer.
 * Saved to fixtures/x86-corpus.json and replayed by src/engine/guest/x86-corpus.test.ts.
 * Needs: as, ld, an x86-64 host with SSE2 (and BMI1/LZCNT for tzcnt/lzcnt cases).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const V = ["r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15"];
const V32 = V.map((r) => `${r}d`);
const V16 = V.map((r) => `${r}w`);
const V8 = V.map((r) => `${r}b`);
const CC = ["e", "ne", "l", "le", "g", "ge", "b", "be", "a", "ae", "s", "ns", "o", "no"];

let state = 1;
const rand = (n: number) => {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5; state >>>= 0;
  return state % n;
};
const pick = <T>(xs: T[]): T => xs[rand(xs.length)];
const r64 = (): bigint => {
  const k = rand(4);
  if (k === 0) return BigInt(rand(300));
  if (k === 1) return (1n << 64n) - BigInt(1 + rand(300));
  if (k === 2) return BigInt(rand(0x7fffffff)) << BigInt(rand(33));
  return (BigInt(rand(0x10000)) << 48n) | (BigInt(rand(0x10000)) << 32n) | (BigInt(rand(0x10000)) << 16n) | BigInt(rand(0x10000));
};
const hx = (v: bigint | number) => `0x${v.toString(16)}`;
const xm = () => `xmm${rand(4)}`;

let label = 0;
function op(out: string[]) {
  const d = rand(8), s = rand(8), t = rand(8);
  const off = rand(32) * 8;
  switch (rand(36)) {
    case 0: out.push(`movabs ${V[d]}, ${hx(r64())}`); return;
    case 1: // adc / sbb chains with a carry from a real compare
      out.push(`cmp ${V[s]}, ${V[t]}`, rand(2) ? `${pick(["adc", "sbb"])} ${V[d]}, ${V[s]}` : `${pick(["adc", "sbb"])} ${V32[d]}, ${V32[s]}`);
      return;
    case 2: out.push(`cmp ${V32[s]}, ${V32[t]}`, `${pick(["adc", "sbb"])} ${V32[d]}, ${rand(200)}`); return;
    case 3: out.push(`${pick(["rol", "ror"])} ${pick([V[d], V32[d]])}, ${rand(70)}`); return;
    case 4: out.push(`mov rcx, ${V[t]}`, `${pick(["rol", "ror"])} ${pick([V[d], V32[d]])}, cl`); return;
    // bsf/bsr leave most flags undefined, tzcnt/lzcnt define only C and Z: read those, then redefine the rest
    case 5: out.push(`mov rax, ${V[s]}`, "or rax, 1", `${pick(["bsf", "bsr"])} ${V[d]}, rax`, `cmp ${V[s]}, ${V[t]}`); return;
    case 6: out.push(`${pick(["tzcnt", "lzcnt"])} ${pick([V[d] + ", " + V[s], V32[d] + ", " + V32[s]])}`, `set${pick(["c", "nc", "z", "nz"])} al`, "movzx eax, al", `add ${V[t]}, rax`); return;
    case 7: { // bit tests on registers, capture CF
      const o = pick(["bt", "bts", "btr", "btc"]);
      out.push(rand(2) ? `${o} ${V[d]}, ${rand(64)}` : `${o} ${V[d]}, ${V[t]}`, "setc al", "movzx eax, al", `add ${V[s]}, rax`);
      return;
    }
    case 8: { // bit strings in memory with a register index
      const o = pick(["bt", "bts", "btr", "btc"]);
      out.push(`mov rcx, ${V[t]}`, "and rcx, 511", `${o} qword ptr [rbx], rcx`, "setc al", "movzx eax, al", `xor ${V[d]}, rax`);
      return;
    }
    case 9: out.push(`mov rax, ${V[s]}`, `lock cmpxchg qword ptr [rbx+${off}], ${V[t]}`, "setz cl", "movzx ecx, cl", `add ${V[d]}, rcx`, `xor ${V[d]}, rax`); return;
    case 10: out.push(`mov rax, ${V[s]}`, `cmpxchg ${V32[d]}, ${V32[t]}`, `mov ${V[s]}, rax`); return;
    case 11: out.push(rand(2) ? `lock xadd qword ptr [rbx+${off}], ${V[d]}` : `xadd ${V[d]}, ${V[s]}`); return;
    case 12: out.push(`bswap ${pick([V[d], V32[d]])}`); return;
    case 13: // high-byte registers
      out.push(`mov rax, ${V[s]}`, `mov rcx, ${V[t]}`, `mov rdx, ${V[d]}`, `${pick(["add", "sub", "xor", "and", "or", "mov"])} ${pick(["ah", "ch", "dh"])}, ${pick(["al", "cl", "dl", "ah", "ch", "dh"])}`, `${pick(["inc", "dec", "neg", "not"])} ${pick(["ah", "ch", "dh"])}`, `mov ${V[d]}, rax`, `xor ${V[s]}, rcx`, `add ${V[t]}, rdx`);
      return;
    case 14: { // 8/16-bit arithmetic with flags captured
      const r = pick([V8, V16]);
      out.push(`${pick(["add", "sub", "xor", "and", "or", "adc", "sbb"])} ${r[d]}, ${r[s]}`, `set${pick(CC)} al`, "movzx eax, al", `add ${V[t]}, rax`);
      return;
    }
    case 15: out.push(`${pick(["movsx", "movzx"])} ${V[d]}, ${pick([V8[s], V16[s]])}`); return;
    case 16: out.push(`not ${pick([V[d], V32[d], V16[d], V8[d]])}`, `${pick(["neg", "inc", "dec"])} ${pick([V[d], V32[d], V16[d], V8[d]])}`, `set${pick(CC)} al`, "movzx eax, al", `add ${V[s]}, rax`); return;
    case 17: out.push(`mov eax, ${V32[s]}`, "cdq", `mov ecx, ${V32[t]}`, "or ecx, 1", "and ecx, 0xffff", "idiv ecx", `mov ${V32[d]}, eax`, `add ${V32[s]}, edx`); return;
    case 18: // multiplies; CF/OF are defined after them (ZF/SF are not, so they are never read)
      out.push(...pick([
        [`mov eax, ${V32[s]}`, `mul ${V32[t]}`, `mov ${V32[d]}, edx`],
        [`mov rax, ${V[s]}`, `imul ${V[t]}`, `mov ${V[d]}, rdx`],
        [`imul ${V[d]}, ${V[s]}`],
        [`imul ${V32[d]}, ${V32[s]}, ${rand(2000) - 1000}`],
        [`imul ${V16[d]}, ${V16[s]}`],
      ]), `set${pick(["c", "nc", "o", "no"])} al`, "movzx eax, al", `add ${V[t]}, rax`);
      return;
    case 19: out.push(`mov ${V[d]}, qword ptr fs:[${off}]`, `add qword ptr fs:[${(off + 8) % 256}], ${V[s]}`); return;
    case 20: { // string moves inside the buffer
      out.push("lea rdi, [rbx+256]", `lea rsi, [rbx+${rand(8) * 8}]`, `mov ecx, ${1 + rand(24)}`, pick(["rep movsb", "rep movsq", "rep stosb", "rep stosq", "movsq", "stosb"]));
      return;
    }
    // ---------- SSE2 ----------
    case 21: out.push(`${pick(["pxor", "pand", "por", "pandn", "paddb", "paddw", "paddd", "paddq", "psubb", "psubw", "psubd", "psubq", "pcmpeqb", "pcmpeqw", "pcmpeqd", "pcmpgtb", "pcmpgtw", "pcmpgtd", "pminub", "pmaxub", "pminsw", "pmaxsw", "punpcklbw", "punpckhbw", "punpcklwd", "punpckhwd", "punpckldq", "punpckhdq", "punpcklqdq", "punpckhqdq", "xorps", "andps", "orps", "andnps", "unpcklps", "unpckhps"])} ${xm()}, ${xm()}`); return;
    case 22: out.push(`${pick(["pshufd", "pshuflw", "pshufhw", "shufps"])} ${xm()}, ${xm()}, ${rand(256)}`); return;
    case 23: out.push(`${pick(["psrldq", "pslldq"])} ${xm()}, ${rand(18)}`); return;
    case 24: out.push(`${pick(["psrlw", "psllw", "psraw", "psrld", "pslld", "psrad", "psrlq", "psllq"])} ${xm()}, ${rand(70)}`); return;
    case 25: out.push(rand(2) ? `movq ${xm()}, ${V[s]}` : `movd ${xm()}, ${V32[s]}`, rand(2) ? `movq ${V[d]}, ${xm()}` : `movd ${V32[d]}, ${xm()}`); return;
    case 26: out.push(`pmovmskb ${V32[d]}, ${xm()}`, `movmskps ${V32[s]}, ${xm()}`); return;
    case 27: out.push(pick([`movss ${xm()}, ${xm()}`, `movsd ${xm()}, ${xm()}`, `movhlps ${xm()}, ${xm()}`, `movlhps ${xm()}, ${xm()}`, `movq ${xm()}, ${xm()}`, `movdqa ${xm()}, ${xm()}`])); return;
    case 28: out.push(pick([`movdqu ${xm()}, xmmword ptr [rbx+${off}]`, `movdqu xmmword ptr [rbx+${off}], ${xm()}`, `movups ${xm()}, xmmword ptr [rbx+${off}]`, `movss ${xm()}, dword ptr [rbx+${off}]`, `movsd ${xm()}, qword ptr [rbx+${off}]`, `movss dword ptr [rbx+${off}], ${xm()}`, `movlps ${xm()}, qword ptr [rbx+${off}]`, `movhps ${xm()}, qword ptr [rbx+${off}]`, `movhps qword ptr [rbx+${off}], ${xm()}`, `movq qword ptr [rbx+${off}], ${xm()}`, `pxor ${xm()}, xmmword ptr [rbx+${off & ~15}]`, `pcmpeqb ${xm()}, xmmword ptr [rbx+${off & ~15}]`]));
      return;
    case 30: // scalar shifts, then read CF (and OF, which is defined for a count of one)
      if (rand(3) === 0) out.push(`${pick(["shl", "shr", "sar"])} ${pick([V[d], V32[d]])}, 1`, `set${pick(["c", "nc", "o", "no", "z", "s"])} al`); // OF is defined for a count of one only
      else out.push(rand(2) ? `${pick(["shl", "shr", "sar"])} ${pick([V[d], V32[d]])}, ${rand(70)}` : `mov rcx, ${V[t]}\n${pick(["shl", "shr", "sar"])} ${pick([V[d], V32[d]])}, cl`, `set${pick(["c", "nc", "z", "nz", "s", "ns"])} al`);
      out.push("movzx eax, al", `add ${V[s]}, rax`);
      return;
    case 31: { // full-width division: (rdx:rax) / divisor, with rdx kept below the divisor so it never faults
      const signed = rand(2) === 0;
      if (!signed) out.push(`mov rcx, ${V[t]}`, "or rcx, 1", `mov rdx, ${V[s]}`, "xor edx, edx", `mov rax, ${V[d]}`, rand(2) ? `mov edx, ${rand(1000)}` : "nop", "cmp rdx, rcx", `jb ok_${label}`, "xor edx, edx", `ok_${label}:`, "div rcx", `mov ${V[d]}, rax`, `xor ${V[s]}, rdx`);
      else out.push(`mov rcx, ${V[t]}`, "sar rcx, 20", "or rcx, 1", `mov rax, ${V[d]}`, "sar rax, 30", "cqo", "idiv rcx", `mov ${V[d]}, rax`, `add ${V[s]}, rdx`);
      label += 1;
      return;
    }
    case 32: { // scalar floating point, including NaN, infinities and signed zeros from the data
      const fop = pick(["addsd", "subsd", "mulsd", "divsd", "minsd", "maxsd", "sqrtsd", "addss", "subss", "mulss", "divss", "minss", "maxss", "sqrtss"]);
      out.push(rand(2) ? `${fop} ${xm()}, ${xm()}` : `${fop} ${xm()}, ${fop.endsWith("sd") ? "qword" : "dword"} ptr [rbx+${384 + rand(16) * 8}]`);
      return;
    }
    case 33: out.push(pick([`cvtsi2sd ${xm()}, ${V[s]}`, `cvtsi2sd ${xm()}, ${V32[s]}`, `cvtsi2ss ${xm()}, ${V[s]}`, `cvtsi2ss ${xm()}, ${V32[s]}`, `cvttsd2si ${V[d]}, ${xm()}`, `cvtsd2si ${V[d]}, ${xm()}`, `cvttss2si ${V32[d]}, ${xm()}`, `cvtss2si ${V[d]}, ${xm()}`, `cvtsd2ss ${xm()}, ${xm()}`, `cvtss2sd ${xm()}, ${xm()}`])); return;
    case 34: { // ucomisd/comisd then every condition, parity included
      const l = `fc_${label++}`;
      out.push(`${pick(["ucomisd", "comisd", "ucomiss", "comiss"])} ${xm()}, ${xm()}`, `set${pick(["e", "ne", "b", "ae", "be", "a", "p", "np"])} al`, "movzx eax, al", `add ${V[s]}, rax`, `j${pick(["p", "np", "a", "be"])} ${l}`, `inc ${V[d]}`, `${l}:`);
      return;
    }
    case 35: out.push(rand(2) ? `${pick(["shld", "shrd"])} ${pick([`${V[d]}, ${V[s]}`, `${V32[d]}, ${V32[s]}`])}, ${rand(70)}` : `mov rcx, ${V[t]}\n${pick(["shld", "shrd"])} ${V[d]}, ${V[s]}, cl`, `set${pick(["c", "nc", "z", "s"])} al`, "movzx eax, al", `add ${V[t]}, rax`); return;
    case 29: { // a compare-and-branch so flags from the new ops get used
      const l = `skip_${label++}`;
      out.push(`cmp ${V[s]}, ${V[t]}`, `j${pick(CC)} ${l}`, `xor ${V[d]}, ${V[s]}`, `${l}:`);
      return;
    }
  }
}

function program(): string {
  const body: string[] = [];
  for (let i = 0; i < 8; i += 1) body.push(`movabs ${V[i]}, ${hx(r64())}`);
  const n = 10 + rand(40);
  for (let i = 0; i < n; i += 1) op(body);
  return [
    ".intel_syntax noprefix", ".globl _start", ".text", "_start:",
    "lea rbx, [rip+buf]",
    // thread pointer -> tls (arch_prctl ARCH_SET_FS)
    "mov eax, 158", "mov edi, 0x1002", "lea rsi, [rip+tls]", "syscall",
    "movdqu xmm0, xmmword ptr [rbx+384]", "movdqu xmm1, xmmword ptr [rbx+400]", "movdqu xmm2, xmmword ptr [rbx+416]", "movdqu xmm3, xmmword ptr [rbx+48]",
    ...body,
    "lea rdi, [rip+out]",
    ...V.map((r, i) => `mov qword ptr [rdi+${i * 8}], ${r}`),
    ...[0, 1, 2, 3].map((i) => `movdqu xmmword ptr [rdi+${64 + i * 16}], xmm${i}`),
    "movdqu xmm4, xmmword ptr [rbx+0]", "movdqu xmmword ptr [rdi+128], xmm4",
    "movdqu xmm4, xmmword ptr [rbx+16]", "movdqu xmmword ptr [rdi+144], xmm4",
    "movdqu xmm4, xmmword ptr [rbx+256]", "movdqu xmmword ptr [rdi+160], xmm4",
    "movdqu xmm4, xmmword ptr [rbx+272]", "movdqu xmmword ptr [rdi+176], xmm4",
    "mov eax, 1", "mov edi, 1", "lea rsi, [rip+out]", "mov edx, 192", "syscall",
    "mov eax, 60", "xor edi, edi", "syscall",
    "ud2", // end of code: nothing after this is an instruction
    ".data", ".align 16",
    `buf: .quad ${Array.from({ length: 48 }, () => hx(r64())).join(", ")}`,
    `fdata: .quad ${Array.from({ length: 16 }, () => hx(pick([0x7ff8000000000000n, 0xfff0000000000000n, 0x7ff0000000000000n, 0x8000000000000000n, 0n, 0x3ff0000000000000n, 0x4059000000000000n, 0xc0091eb851eb851fn, 0x7fc000003f800000n, 0x40490fdbc0000000n, r64(), 0x43e0000000000000n, 0xc3e0000000000001n, 0x41dfffffffc00000n]))).join(", ")}`,
    `tls: .quad ${Array.from({ length: 40 }, () => hx(r64())).join(", ")}`,
    "out: .zero 192",
  ].join("\n") + "\n";
}

const count = Number(process.argv[2] ?? 150);
state = Number(process.argv[3] ?? 20261013) >>> 0 || 1;
const dir = mkdtempSync(join(tmpdir(), "forge-x86-"));
const cases: { id: number; elf: string; expected: string; asm: string }[] = [];
try {
  for (let id = 0; id < count; id += 1) {
    const asm = program();
    writeFileSync(join(dir, "p.s"), asm);
    execFileSync("as", [join(dir, "p.s"), "-o", join(dir, "p.o")]);
    execFileSync("ld", ["-static", "-n", "-s", "--no-warn-rwx-segments", join(dir, "p.o"), "-o", join(dir, "p.elf")]);
    let expected: string;
    try {
      expected = execFileSync(join(dir, "p.elf")).toString("hex");
    } catch (error) {
      if (process.env.FORGE_KEEP_FAILED) writeFileSync(`/tmp/failed-${id}.s`, asm);
      console.error(`program ${id} crashed on the CPU (${(error as { signal?: string }).signal ?? "error"}); skipped`);
      continue;
    }
    cases.push({ id, elf: readFileSync(join(dir, "p.elf")).toString("base64"), expected, asm });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(new URL("../fixtures/x86-corpus.json", import.meta.url), JSON.stringify({ oracle: "x86-64 hardware", cases }));
console.log(`wrote ${cases.length} programs to fixtures/x86-corpus.json`);
