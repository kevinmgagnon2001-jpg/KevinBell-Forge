/**
 * Lifter: walks machine code from its entry points, following every direct branch, call and
 * return site, and builds the instruction map. Indirect jumps are resolved at run time: when the
 * machine lands on an address it has not seen, the runner lifts from there and carries on.
 */
import { decodeArm } from "./arm.ts";
import type { Gap, GuestArch, Insn } from "./ir.ts";
import { decodeX86, type Fetch } from "./x86.ts";

export type Program = {
  arch: GuestArch;
  insns: Map<bigint, Insn>;
  gaps: Map<bigint, Gap>;
  /** Executable ranges [lo, hi). Lifting never leaves them. */
  text: [bigint, bigint][];
};

export function newProgram(arch: GuestArch, text: [bigint, bigint][]): Program {
  return { arch, insns: new Map(), gaps: new Map(), text };
}

export function inText(program: Program, pc: bigint): boolean {
  return program.text.some(([lo, hi]) => pc >= lo && pc < hi);
}

export function lift(program: Program, fetch: Fetch, roots: bigint[], limit = 200_000): { added: number } {
  const decode = program.arch === "x86_64" ? decodeX86 : decodeArm;
  const work = [...roots];
  let added = 0;
  const textFetch: Fetch = (addr) => (inText(program, addr) ? fetch(addr) : undefined);
  while (work.length) {
    const pc = work.pop()!;
    if (program.insns.has(pc) || program.gaps.has(pc)) continue;
    if (!inText(program, pc)) continue;
    if (program.arch === "aarch64" && pc % 4n !== 0n) {
      program.gaps.set(pc, { pc, bytes: "", reason: "misaligned arm instruction address" });
      continue;
    }
    if (program.insns.size >= limit) throw new Error("program is larger than the lifter limit");
    const result = decode(textFetch, pc);
    if ("gap" in result) {
      program.gaps.set(pc, result.gap);
      continue;
    }
    program.insns.set(pc, result.insn);
    added += 1;
    for (const t of result.targets) work.push(t);
    if (result.insn.fall) work.push(result.insn.next);
  }
  return { added };
}

/**
 * The span of addresses that hold translated instructions. A store into it would make the
 * translation stale, so both engines stop with "self-modifying code" instead.
 */
export function codeExtent(program: Program): [bigint, bigint][] {
  let lo = -1n;
  let hi = -1n;
  for (const insn of program.insns.values()) {
    if (lo < 0n || insn.pc < lo) lo = insn.pc;
    const end = insn.pc + BigInt(insn.len);
    if (end > hi) hi = end;
  }
  return lo < 0n ? [] : [[lo, hi]];
}

/** Human-readable listing, for the UI and for evidence in reports. */
export function listing(program: Program, max = 64): string[] {
  const rows = [...program.insns.values()].sort((a, b) => (a.pc < b.pc ? -1 : 1)).slice(0, max);
  return rows.map((insn) => `0x${insn.pc.toString(16)}  ${insn.text}`);
}
