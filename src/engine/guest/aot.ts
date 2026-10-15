/**
 * Ahead-of-time recompilation (docs/RECOMPILER.md, step 1).
 *
 * The usual path lifts a program lazily: it follows the code it can see from the entry point, runs new
 * code in the interpreter, and rebuilds the WebAssembly module as running uncovers more ("relift").
 * Here the whole program is lifted up front, from every root a static pass can find:
 *
 *   - the entry point and code addresses stored in data (function pointer tables, vtables, init arrays);
 *   - x86 switch tables (`lea base, [rip + table]` into read-only data);
 *   - code addresses computed in code: x86 `lea reg, [rip + fn]`, ARM `adrp` + `add`, moves of constants;
 *   - glibc's IRELATIVE relocations (the resolvers that pick memcpy, strlen, ... at start-up), which a
 *     static program keeps in its executable segment, where the data scan does not look;
 *
 * repeated until a pass finds nothing new, then lowered once. The result runs from its first
 * instruction in WebAssembly, with nothing lifted at start. If it still reaches code nobody found, the
 * runner falls back to the usual path (it re-lifts from the saved roots, so nothing is lost).
 *
 * `encodeAhead` / `decodeAhead` turn a build into one file for a cache keyed by `aheadKey` (the
 * program's SHA-256, its memory size and AOT_VERSION).
 */
import { lift, MAX_INSNS, inText, type Program } from "./lift.ts";
import { jumpTableTargets, prepareLinux, type LinuxOptions } from "./linux.ts";
import type { Segment } from "./elf.ts";
import { lowerProgram } from "./wasm.ts";
import type { GuestArch } from "./ir.ts";

/** Bump whenever the decoders or the lowering change what a build contains; old cache entries then miss. */
export const AOT_VERSION = 1;

export type AheadBuild = {
  v: number;
  arch: GuestArch;
  memBytes: number;
  /** The lowered module (imports only its memory). */
  bytes: Uint8Array;
  /** Every root the static pass lifted from; lifting from these again rebuilds the same program. */
  roots: bigint[];
  insns: number;
  gaps: number;
  /** Static passes until nothing new turned up. */
  passes: number;
};

/** R_X86_64_IRELATIVE and R_AARCH64_IRELATIVE. */
const IRELATIVE: Record<GuestArch, bigint> = { x86_64: 37n, aarch64: 1032n };

/**
 * Resolver functions named by IRELATIVE relocations: Elf64_Rela records (offset, info, addend) whose
 * type is IRELATIVE and whose addend lands in the code. Found by scanning the loaded segments, since a
 * static program has no dynamic section to point at them.
 */
export function irelativeTargets(memory: Uint8Array, segments: Segment[], text: [bigint, bigint][], arch: GuestArch): bigint[] {
  const out = new Set<bigint>();
  const dv = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
  const inCode = (v: bigint) => text.some(([lo, hi]) => v >= lo && v < hi);
  for (const seg of segments) {
    const start = Number((seg.vaddr + 7n) & ~7n);
    const end = Number(seg.vaddr + seg.filesz);
    for (let at = start; at + 24 <= end; at += 8) {
      if (dv.getBigUint64(at + 8, true) !== IRELATIVE[arch]) continue;
      const addend = dv.getBigUint64(at + 16, true);
      if (inCode(addend) && (arch !== "aarch64" || addend % 4n === 0n)) out.add(addend);
    }
  }
  return [...out];
}

/** Code addresses a program computes in registers: lea rip-relative, adrp + add, moves of constants. */
export function computedCodeAddresses(program: Program): bigint[] {
  const out = new Set<bigint>();
  const consts = new Map<number, bigint>();
  const sorted = [...program.insns.values()].sort((a, b) => (a.pc < b.pc ? -1 : a.pc > b.pc ? 1 : 0));
  let expected = -1n;
  const note = (v: bigint) => {
    if (program.arch === "aarch64" && v % 4n !== 0n) return;
    if (inText(program, v)) out.add(v);
  };
  for (const insn of sorted) {
    // Constants only flow along straight-line code.
    if (insn.pc !== expected) consts.clear();
    expected = insn.next;
    for (const op of insn.ops) {
      if (op.k === "mov" && "imm" in op.s) {
        consts.set(op.d, op.s.imm);
        note(op.s.imm);
        continue;
      }
      if (op.k === "lea" && op.ea.base === null && op.ea.index === null) {
        consts.set(op.d, op.ea.disp);
        note(op.ea.disp);
        continue;
      }
      if (op.k === "alu" && op.op === "add" && op.d !== null && "r" in op.a && "imm" in op.b && consts.has(op.a.r)) {
        const v = BigInt.asUintN(64, consts.get(op.a.r)! + op.b.imm);
        consts.set(op.d, v);
        note(v);
        continue;
      }
      if ("d" in op && typeof op.d === "number") consts.delete(op.d);
    }
  }
  return [...out];
}

/**
 * Lift a whole Linux program and lower it once. Throws when the program cannot be loaded.
 * `maxPasses` bounds the fixpoint (each pass usually finds less than the one before).
 */
export function compileAhead(bytes: Uint8Array, options: LinuxOptions = {}, maxPasses = 8): AheadBuild {
  const prepared = prepareLinux(bytes, options);
  if (!prepared.ok) throw new Error(prepared.reason);
  const { program, fetch, memory, memBytes } = prepared;
  const roots = new Set<bigint>([...prepared.roots, ...irelativeTargets(memory, prepared.segments, program.text, program.arch)]);
  // The usual load lifts with a budget; here everything reachable is lifted.
  lift(program, fetch, [...roots], MAX_INSNS);
  let passes = 0;
  for (; passes < maxPasses; passes += 1) {
    const found = [...computedCodeAddresses(program), ...(program.arch === "x86_64" ? jumpTableTargets(program, memory, prepared.segments, program.text) : [])].filter((r) => !roots.has(r));
    if (!found.length) break;
    found.forEach((r) => roots.add(r));
    const { added } = lift(program, fetch, found, MAX_INSNS);
    if (!added) break;
  }
  const build = lowerProgram(program, memBytes, { importMemory: true });
  return { v: AOT_VERSION, arch: program.arch, memBytes, bytes: build.bytes, roots: [...roots], insns: program.insns.size, gaps: program.gaps.size, passes: passes + 1 };
}

/** The cache key: the program's SHA-256, the guest memory size and the build format version. */
export async function aheadKey(bytes: Uint8Array, memBytes = 16 * 1024 * 1024): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex}-m${memBytes >> 20}-v${AOT_VERSION}`;
}

const MAGIC = [0x46, 0x41, 0x4f, 0x54]; // "FAOT"

/** One file: magic, header length, JSON header, roots (little-endian u64), the module. */
export function encodeAhead(build: AheadBuild): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({ v: build.v, arch: build.arch, memBytes: build.memBytes, roots: build.roots.length, insns: build.insns, gaps: build.gaps, passes: build.passes, wasm: build.bytes.length }),
  );
  const out = new Uint8Array(8 + header.length + build.roots.length * 8 + build.bytes.length);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint32(4, header.length, true);
  out.set(header, 8);
  let at = 8 + header.length;
  for (const r of build.roots) {
    dv.setBigUint64(at, r, true);
    at += 8;
  }
  out.set(build.bytes, at);
  return out;
}

/** Read a cached build back; null when it is damaged or from another build format. */
export function decodeAhead(file: Uint8Array): AheadBuild | null {
  try {
    if (file.length < 8 || MAGIC.some((b, i) => file[i] !== b)) return null;
    const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const headerLength = dv.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(file.subarray(8, 8 + headerLength))) as { v: number; arch: GuestArch; memBytes: number; roots: number; insns: number; gaps: number; passes: number; wasm: number };
    if (header.v !== AOT_VERSION) return null;
    let at = 8 + headerLength;
    const roots: bigint[] = [];
    for (let i = 0; i < header.roots; i += 1, at += 8) roots.push(dv.getBigUint64(at, true));
    const bytes = file.slice(at, at + header.wasm);
    if (bytes.length !== header.wasm || !WebAssembly.validate(bytes as BufferSource)) return null;
    return { v: header.v, arch: header.arch, memBytes: header.memBytes, bytes, roots, insns: header.insns, gaps: header.gaps, passes: header.passes };
  } catch {
    return null;
  }
}
