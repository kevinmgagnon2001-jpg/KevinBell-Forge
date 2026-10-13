/**
 * WebAssembly backend for the guest IR.
 *
 * Lowers a lifted program to one module with no imports. The module owns its memory (guest memory,
 * exported as "mem") and exports `run(): i32`. State (registers, pc, flags, fuel) sits in the null
 * page, so `run` loads it, executes until something needs the host (a system call, a fault, fuel
 * running out, an address with no translation) and saves it back. The host handles the event and
 * calls `run` again. Nothing outside the module is reachable from guest code.
 *
 * Layout: one dispatch loop with a br_table over every instruction address. Straight-line code
 * falls from one instruction to the next without going through the table; every taken branch goes
 * through it and costs one unit of fuel.
 */
import { CPUID, NREG, NULL_PAGE, STATE, Stop, VEC_UNARY, vecShuffles, XMM, type VecOp, type AluOp, type Cond, type Ea, type FlagMode, type Insn, type Op, type Src, type W } from "./ir.ts";
import type { Program } from "./lift.ts";

// locals
const PC = NREG;
const FUEL = NREG + 1;
const TA = NREG + 2;
const TB = NREG + 3;
const TR = NREG + 4;
const TEA = NREG + 5;
const FA = NREG + 6;
const I64_LOCALS = NREG + 7;
const ZF = I64_LOCALS;
const SF = ZF + 1;
const CF = ZF + 2;
const OF = ZF + 3;
const KF = ZF + 4;
const CODE = ZF + 5;
const I32_LOCALS = 8;
const PF = ZF + 7; // parity, set by floating-point compares
const I_IDX = ZF + 6; // dispatch index
const CHUNK_BITS = 15;
const CHUNK = 1 << CHUNK_BITS;
const V0 = ZF + I32_LOCALS; // two v128 scratch locals
const V128 = 0x7b;
const F64 = 0x7c;
const FA_ = V0 + 2; // f64 scratch: a
const FB_ = V0 + 3; // f64 scratch: b
const FR_ = V0 + 4; // f64 scratch: result

function uleb(value: number): number[] {
  const out: number[] = [];
  let n = value >>> 0;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

function sleb(value: bigint): number[] {
  const out: number[] = [];
  let n = BigInt.asIntN(64, value);
  for (;;) {
    const byte = Number(n & 0x7fn);
    n >>= 7n;
    const done = (n === 0n && (byte & 0x40) === 0) || (n === -1n && (byte & 0x40) !== 0);
    out.push(done ? byte : byte | 0x80);
    if (done) return out;
  }
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

const I64 = 0x7e;
const I32 = 0x7f;

class Emitter {
  code: number[] = [];
  ctl: string[] = [];
  private at = new Map<string, number[]>();
  emit(...bytes: number[]) {
    for (const b of bytes) this.code.push(b);
  }
  open(kind: "block" | "loop" | "if", label: string) {
    this.emit(kind === "block" ? 0x02 : kind === "loop" ? 0x03 : 0x04, 0x40);
    const list = this.at.get(label);
    if (list) list.push(this.ctl.length);
    else this.at.set(label, [this.ctl.length]);
    this.ctl.push(label);
  }
  end() {
    this.emit(0x0b);
    const label = this.ctl.pop()!;
    const list = this.at.get(label)!;
    list.pop();
    if (!list.length) this.at.delete(label);
  }
  depth(label: string): number {
    const list = this.at.get(label);
    if (!list || !list.length) throw new Error(`no label ${label}`);
    return this.ctl.length - 1 - list[list.length - 1];
  }
  br(label: string) {
    this.emit(0x0c, ...uleb(this.depth(label)));
  }
  get(l: number) {
    this.emit(0x20, ...uleb(l));
  }
  set(l: number) {
    this.emit(0x21, ...uleb(l));
  }
  tee(l: number) {
    this.emit(0x22, ...uleb(l));
  }
  i64(v: bigint) {
    this.emit(0x42, ...sleb(v));
  }
  i32(v: number) {
    this.emit(0x41, ...sleb(BigInt(v | 0)));
  }
}

const maskOf = (w: number): bigint => (w >= 64 ? -1n : (1n << BigInt(w)) - 1n);

export type WasmBuild = { bytes: Uint8Array; lo: bigint; count: number };

/**
 * Guest address space per WebAssembly function (log2 bytes). Each function holds the instructions of
 * one aligned chunk, so no single function is huge. V8 compiles lazily and copes with large functions;
 * optimizing ahead-of-time compilers (wasmtime's Cranelift) slow down sharply on them, so the desktop
 * host asks for smaller ones.
 */
export const FN_BITS_DEFAULT = 14;

export function lowerProgram(program: Program, memBytes: number, options: { fnBits?: number } = {}): WasmBuild {
  const FN_BITS = BigInt(options.fnBits ?? FN_BITS_DEFAULT);
  if (memBytes % 65536 !== 0) throw new Error("guest memory must be a multiple of 64 KiB");
  const all = [...program.insns.values()].sort((a, b) => (a.pc < b.pc ? -1 : a.pc > b.pc ? 1 : 0));
  if (!all.length) throw new Error("nothing to lower");
  const codeLo = all[0].pc;
  const hi = all[all.length - 1].pc + BigInt(all[all.length - 1].len);
  const arm = program.arch === "aarch64";
  // Chunks are aligned to absolute addresses, and nothing about the program as a whole is baked into
  // a chunk's function: when more code is lifted, unchanged chunks lower to identical bytes, so a
  // compiler with a per-function cache (the desktop host's wasmtime) only compiles what changed.
  const lo = codeLo & ~((1n << FN_BITS) - 1n);
  const spanBytes = hi - lo;
  const chunks = Number((spanBytes + (1n << FN_BITS) - 1n) >> FN_BITS);
  if (chunks > 65536) throw new Error("program is too large for the WebAssembly backend; use the interpreter");
  const groups = new Map<number, Insn[]>();
  for (const insn of all) {
    const c = Number((insn.pc - lo) >> FN_BITS);
    const list = groups.get(c);
    if (list) list.push(insn);
    else groups.set(c, [insn]);
  }
  const chunkIds = [...groups.keys()].sort((x, y) => x - y);
  const FIRST_CHUNK_FN = 9;
  const fnOf = new Map(chunkIds.map((c, i) => [c, FIRST_CHUNK_FN + i]));

  // ---- top-level run(): pick the chunk function for pc, call it, follow jumps between chunks ----
  const t = new Emitter();
  // The code range stores are checked against (checkAccess) lives in the state page.
  t.i32(0); t.i64(codeLo); t.emit(0x37, 3, ...uleb(STATE.codeLo));
  t.i32(0); t.i64(hi); t.emit(0x37, 3, ...uleb(STATE.codeHi));
  t.emit(0x03, 0x40);
  const chunkOfPc = () => {
    t.i32(0); t.emit(0x29, 3, ...uleb(STATE.pc)); t.i64(lo); t.emit(0x7d); t.tee(0);
    t.i64(spanBytes); t.emit(0x5a);
    t.emit(0x04, 0x40); t.i32(Stop.unmapped); t.emit(0x0f); t.emit(0x0b);
    t.get(0); t.i64(FN_BITS); t.emit(0x88); t.emit(0xa7);
  };
  chunkOfPc();
  t.tee(1);
  t.emit(0x11, 0, 0); // call_indirect (type 0) table 0
  t.tee(2); t.i32(Stop.unmapped); t.emit(0x47);
  t.emit(0x04, 0x40); t.get(2); t.emit(0x0f); t.emit(0x0b);
  chunkOfPc();
  t.get(1); t.emit(0x46);
  t.emit(0x04, 0x40); t.i32(Stop.unmapped); t.emit(0x0f); t.emit(0x0b);
  t.emit(0x0c, 0); // br loop: the other chunk's function takes over
  t.emit(0x0b);
  t.emit(0x00, 0x0b); // unreachable; end
  const topBody = [2, 1, I64, 2, I32, ...t.code];
  const stubBody = [0, 0x41, Stop.unmapped, 0x0b];

  const chunkBodies = chunkIds.map((c) => chunkBody(groups.get(c)!, arm, memBytes));
  const bodies = [topBody, mulhBody(false), mulhBody(true), stubBody, udiv128Body(), armFopBody(), armRoundBody(), armF2iBody(), armFcmpBody(), ...chunkBodies];
  const pages = memBytes / 65536;
  const name = (str: string) => [...uleb(str.length), ...[...str].map((ch) => ch.charCodeAt(0))];
  const elems: number[] = [];
  for (let c = 0; c < chunks; c += 1) elems.push(...uleb(fnOf.get(c) ?? 3));
  const parts: number[][] = [
    [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    section(1, [
      7,
      0x60, 0, 1, I32,
      0x60, 2, I64, I64, 1, I64,
      0x60, 3, I64, I64, I64, 2, I64, I64,
      0x60, 4, I64, I64, I32, I32, 1, I64, // armFop(a, b, op, single)
      0x60, 3, I64, I32, I32, 1, I64, // armRound(a, mode, single)
      0x60, 4, I64, I32, I32, I32, 1, I64, // armF2i(a, mode, single, kind)
      0x60, 3, I64, I64, I32, 1, I32, // armFcmp(a, b, single) -> nzcv
    ]),
    section(3, [...uleb(bodies.length), 0, 1, 1, 0, 2, 3, 4, 5, 6, ...chunkIds.map(() => 0)]),
    section(4, [1, 0x70, 0x01, ...uleb(chunks), ...uleb(chunks)]),
    section(5, [1, 1, ...uleb(pages), ...uleb(pages)]),
    section(7, [2, ...name("run"), 0x00, 0, ...name("mem"), 0x02, 0]),
    section(9, [1, 0x00, 0x41, 0x00, 0x0b, ...uleb(chunks), ...elems]),
  ];
  const codeParts: number[][] = [uleb(bodies.length)];
  for (const body of bodies) codeParts.push(uleb(body.length), body);
  const codeLen = codeParts.reduce((n, x) => n + x.length, 0);
  parts.push([10, ...uleb(codeLen)], ...codeParts);
  const total = parts.reduce((n, x) => n + x.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return { bytes, lo, count: all.length };
}

/** One function: load CPU state, dispatch over this chunk's instructions, save state, return a stop code. */
function chunkBody(insns: Insn[], arm: boolean, memBytes: number): number[] {
  const lo = insns[0].pc;
  const hi = insns[insns.length - 1].pc + BigInt(insns[insns.length - 1].len);
  const span = Number(hi - lo) >> (arm ? 2 : 0);
  const e = new Emitter();
  const N = insns.length;

  // ---- load state ----
  for (let r = 0; r < NREG; r += 1) {
    e.i32(0);
    e.emit(0x29, 3, ...uleb(STATE.regs + r * 8));
    e.set(r);
  }
  e.i32(0); e.emit(0x29, 3, ...uleb(STATE.pc)); e.set(PC);
  for (let i = 0; i < 6; i += 1) {
    e.i32(0); e.emit(0x28, 2, ...uleb(STATE.flags + i * 4)); e.set(i === 5 ? PF : ZF + i);
  }
  e.i32(0); e.emit(0x29, 3, ...uleb(STATE.fuel)); e.set(FUEL);

  e.open("block", "exit");
  e.open("loop", "dispatch");
  // fuel
  e.get(FUEL); e.i64(1n); e.emit(0x7d); e.tee(FUEL); e.i64(0n); e.emit(0x53); // i64.lt_s
  e.open("if", "fuel");
  e.i32(Stop.fuel); e.set(CODE); e.br("exit");
  e.end();
  e.open("block", "unmapped");
  for (let i = N - 1; i >= 0; i -= 1) e.open("block", `b${i}`);
  // index = pc - lo, bounds and alignment checked
  e.get(PC); e.i64(lo); e.emit(0x7d); e.tee(TA);
  e.i64(BigInt(Number(hi - lo))); e.emit(0x5a); // i64.ge_u
  if (arm) { e.get(TA); e.i64(3n); e.emit(0x83); e.i64(0n); e.emit(0x52); e.emit(0x72); } // or misaligned
  e.emit(0x0d, ...uleb(e.depth("unmapped")));
  e.get(TA);
  if (arm) { e.i64(2n); e.emit(0x88); }
  e.emit(0xa7); // i32.wrap_i64
  {
    // Two-level dispatch: br_table is limited in size (V8 allows 65520 entries), so split the
    // address space into chunks of CHUNK entries and pick the chunk first.
    const table: number[] = new Array(span).fill(-1);
    insns.forEach((insn, i) => {
      table[Number(insn.pc - lo) >> (arm ? 2 : 0)] = i;
    });
    const chunks = Math.ceil(span / CHUNK);
    if (chunks <= 1) {
      const targets = table.map((i) => (i < 0 ? e.depth("unmapped") : e.depth(`b${i}`)));
      e.emit(0x0e, ...uleb(targets.length));
      for (const t of targets) e.emit(...uleb(t));
      e.emit(...uleb(e.depth("unmapped")));
    } else {
      e.set(I_IDX); // keep the index
      for (let c = chunks - 1; c >= 0; c -= 1) e.open("block", `c${c}`);
      e.get(I_IDX); e.i32(CHUNK_BITS); e.emit(0x76); // i32.shr_u
      e.emit(0x0e, ...uleb(chunks));
      for (let c = 0; c < chunks; c += 1) e.emit(...uleb(e.depth(`c${c}`)));
      e.emit(...uleb(e.depth("unmapped")));
      for (let c = 0; c < chunks; c += 1) {
        e.end(); // chunk c
        const part = table.slice(c * CHUNK, (c + 1) * CHUNK);
        e.get(I_IDX); e.i32(CHUNK - 1); e.emit(0x71); // i32.and
        const targets = part.map((i) => (i < 0 ? e.depth("unmapped") : e.depth(`b${i}`)));
        e.emit(0x0e, ...uleb(targets.length));
        for (const t of targets) e.emit(...uleb(t));
        e.emit(...uleb(e.depth("unmapped")));
      }
    }
  }

  for (let i = 0; i < N; i += 1) {
    e.end(); // end of b{i}: instruction i starts here
    const insn = insns[i];
    lowerInsn(e, insn, memBytes);
    if (insn.fall) {
      const following = insns[i + 1];
      if (!following || following.pc !== insn.next) {
        e.i64(insn.next); e.set(PC); e.br("dispatch");
      }
    }
  }
  e.end(); // unmapped
  e.i32(Stop.unmapped); e.set(CODE); e.br("exit");
  e.end(); // loop
  e.end(); // exit

  // ---- save state ----
  for (let r = 0; r < NREG; r += 1) {
    e.i32(0); e.get(r); e.emit(0x37, 3, ...uleb(STATE.regs + r * 8));
  }
  e.i32(0); e.get(PC); e.emit(0x37, 3, ...uleb(STATE.pc));
  for (let i = 0; i < 6; i += 1) {
    e.i32(0); e.get(i === 5 ? PF : ZF + i); e.emit(0x36, 2, ...uleb(STATE.flags + i * 4));
  }
  e.i32(0); e.i64(0n); e.get(FUEL); e.get(FUEL); e.i64(0n); e.emit(0x53); e.emit(0x1b); e.emit(0x37, 3, ...uleb(STATE.fuel)); // max(fuel, 0)
  e.i32(0); e.get(FA); e.emit(0x37, 3, ...uleb(STATE.fault));
  e.i32(0); e.get(CODE); e.emit(0x36, 2, ...uleb(STATE.code));
  e.get(CODE);
  e.emit(0x0b);

  return [...uleb(4), ...uleb(I64_LOCALS), I64, ...uleb(I32_LOCALS), I32, ...uleb(2), V128, ...uleb(3), F64, ...e.code];
}

/** (hi:lo) / d for hi < d, unsigned 128-by-64 long division. Returns (quotient, remainder). Function 4. */
function udiv128Body(): number[] {
  const e = new Emitter();
  // params 0 hi, 1 lo, 2 d; locals 3 i (i32), 4 q, 5 carry
  e.emit(0x03, 0x40);
  e.get(0); e.i64(63n); e.emit(0x88); e.set(5);
  e.get(0); e.i64(1n); e.emit(0x86); e.get(1); e.i64(63n); e.emit(0x88); e.emit(0x84); e.set(0);
  e.get(1); e.i64(1n); e.emit(0x86); e.set(1);
  e.get(4); e.i64(1n); e.emit(0x86); e.set(4);
  e.get(5); e.emit(0x50); e.emit(0x45);
  e.get(0); e.get(2); e.emit(0x5a);
  e.emit(0x72);
  e.emit(0x04, 0x40);
  e.get(0); e.get(2); e.emit(0x7d); e.set(0);
  e.get(4); e.i64(1n); e.emit(0x84); e.set(4);
  e.emit(0x0b);
  e.get(3); e.i32(1); e.emit(0x6a); e.tee(3); e.i32(64); e.emit(0x49); e.emit(0x0d, 0);
  e.emit(0x0b);
  e.get(4); e.get(0);
  e.emit(0x0b);
  return [2, 1, I32, 2, I64, ...e.code];
}

/** 64x64 -> high 64 bits, unsigned or signed. Function indexes 1 and 2. */
function mulhBody(signed: boolean): number[] {
  const e = new Emitter();
  // params: 0 a, 1 b ; locals: 2 alo 3 ahi 4 blo 5 bhi 6 p1 7 p2 8 mid
  const M32 = 0xffffffffn;
  e.get(0); e.i64(M32); e.emit(0x83); e.set(2);
  e.get(0); e.i64(32n); e.emit(0x88); e.set(3);
  e.get(1); e.i64(M32); e.emit(0x83); e.set(4);
  e.get(1); e.i64(32n); e.emit(0x88); e.set(5);
  e.get(2); e.get(5); e.emit(0x7e); e.set(6); // p1 = alo*bhi
  e.get(3); e.get(4); e.emit(0x7e); e.set(7); // p2 = ahi*blo
  // mid = (alo*blo >> 32) + (p1 & M32) + (p2 & M32)
  e.get(2); e.get(4); e.emit(0x7e); e.i64(32n); e.emit(0x88);
  e.get(6); e.i64(M32); e.emit(0x83); e.emit(0x7c);
  e.get(7); e.i64(M32); e.emit(0x83); e.emit(0x7c);
  e.set(8);
  // hi = ahi*bhi + (p1 >> 32) + (p2 >> 32) + (mid >> 32)
  e.get(3); e.get(5); e.emit(0x7e);
  e.get(6); e.i64(32n); e.emit(0x88); e.emit(0x7c);
  e.get(7); e.i64(32n); e.emit(0x88); e.emit(0x7c);
  e.get(8); e.i64(32n); e.emit(0x88); e.emit(0x7c);
  if (signed) {
    // subtract b if a < 0, subtract a if b < 0
    e.get(1); e.i64(0n); e.get(0); e.i64(0n); e.emit(0x53); e.emit(0x1b); e.emit(0x7d);
    e.get(0); e.i64(0n); e.get(1); e.i64(0n); e.emit(0x53); e.emit(0x1b); e.emit(0x7d);
  }
  e.emit(0x0b);
  return [1, 7, I64, ...e.code];
}

// ---------- ARM floating point helpers (functions 5..8; same rules as armFop etc. in ir.ts) ----------

/** Codes for armFop's op parameter. */
const ARM_FOP: Record<string, number> = { add: 0, sub: 1, mul: 2, div: 3, sqrt: 4, max: 5, min: 6, maxnm: 7, minnm: 8 };
const ARM_ROUND: Record<string, number> = { n: 0, p: 1, m: 2, z: 3, a: 4 };
const F64C = (e: Emitter, x: number) => e.emit(0x44, ...f64Bytes(x));

/** Push 1 if raw bits (local `a`) are a NaN of the size given by i32 local `single`. */
function fIsNaN(e: Emitter, a: number, single: number) {
  e.get(a); e.i64(0x7fffffffffffffffn); e.emit(0x83); e.i64(0x7ff0000000000000n); e.emit(0x56);
  e.get(a); e.i64(0x7fffffffn); e.emit(0x83); e.i64(0x7f800000n); e.emit(0x56);
  e.get(single); e.emit(0x1b);
}
/** Push the quiet bit for the size. */
function fQuiet(e: Emitter, single: number) {
  e.i64(0x0008000000000000n); e.i64(0x400000n); e.get(single); e.emit(0x1b);
}
/** Push raw bits (local `a`) as an f64 (singles widened exactly). */
function fToF64(e: Emitter, a: number, single: number) {
  e.get(a); e.emit(0xbf);
  e.get(a); e.emit(0xa7); e.emit(0xbe); e.emit(0xbb);
  e.get(single); e.emit(0x1b);
}
/** f64 on the stack (in local `x`) -> raw bits of the size. */
function fFromF64(e: Emitter, x: number, single: number) {
  e.get(x); e.emit(0xbd);
  e.get(x); e.emit(0xb6); e.emit(0xbc); e.emit(0xad);
  e.get(single); e.emit(0x1b);
}
/** Round f64 local `x` in place by the mode in i32 local `mode` (n p m z a); `t` is an f64 scratch local. */
function fRound(e: Emitter, x: number, mode: number, t: number) {
  const is = (m: number) => { e.get(mode); e.i32(m); e.emit(0x46); };
  is(0); e.open("if", "rn"); e.get(x); e.emit(0x9e); e.set(x); e.end();
  is(1); e.open("if", "rp"); e.get(x); e.emit(0x9b); e.set(x); e.end();
  is(2); e.open("if", "rm"); e.get(x); e.emit(0x9c); e.set(x); e.end();
  is(3); e.open("if", "rz"); e.get(x); e.emit(0x9d); e.set(x); e.end();
  is(4); e.open("if", "ra");
  // ties away: t = trunc(x); if |x - t| >= 0.5 then t + copysign(1, x)
  e.get(x); e.emit(0x9d); e.set(t);
  e.get(x); e.get(t); e.emit(0xa1); e.emit(0x99); F64C(e, 0.5); e.emit(0x66);
  e.open("if", "away"); e.get(t); F64C(e, 1); e.get(x); e.emit(0xa6); e.emit(0xa0); e.set(t); e.end();
  e.get(t); e.set(x);
  e.end();
}

/** armFop(a, b, op, single) -> bits. Function 5. */
function armFopBody(): number[] {
  const e = new Emitter();
  const A = 0, B = 1, OP = 2, S = 3, X = 4, Y = 5, NA = 6, NB = 7;
  fIsNaN(e, A, S); e.set(NA);
  fIsNaN(e, B, S); e.set(NB);
  // sqrt reads only a
  e.get(OP); e.i32(4); e.emit(0x46); e.open("if", "sq"); e.get(A); e.set(B); e.get(NA); e.set(NB); e.end();
  e.get(NA); e.get(NB); e.emit(0x72); e.open("if", "nan");
  // maxnm/minnm: one quiet NaN and a number gives the number
  e.get(OP); e.i32(7); e.emit(0x4e); e.get(NA); e.get(NB); e.emit(0x47); e.emit(0x71);
  e.open("if", "nm");
  e.get(NA); e.open("if", "na");
  e.get(A); fQuiet(e, S); e.emit(0x83); e.emit(0x50); e.emit(0x45); e.open("if", "q"); e.get(B); e.emit(0x0f); e.end();
  e.emit(0x05);
  e.get(B); fQuiet(e, S); e.emit(0x83); e.emit(0x50); e.emit(0x45); e.open("if", "q"); e.get(A); e.emit(0x0f); e.end();
  e.end();
  e.end();
  // signalling NaNs first (quieted), then quiet ones, a before b
  e.get(NA); e.get(A); fQuiet(e, S); e.emit(0x83); e.emit(0x50); e.emit(0x71); e.open("if", "sa"); e.get(A); fQuiet(e, S); e.emit(0x84); e.emit(0x0f); e.end();
  e.get(NB); e.get(B); fQuiet(e, S); e.emit(0x83); e.emit(0x50); e.emit(0x71); e.open("if", "sb"); e.get(B); fQuiet(e, S); e.emit(0x84); e.emit(0x0f); e.end();
  e.get(NA); e.open("if", "qa"); e.get(A); e.emit(0x0f); e.end();
  e.get(B); e.emit(0x0f);
  e.end();
  fToF64(e, A, S); e.set(X);
  fToF64(e, B, S); e.set(Y);
  const is = (m: number) => { e.get(OP); e.i32(m); e.emit(0x46); };
  const f = (opcode: number, label: string, m: number) => { is(m); e.open("if", label); e.get(X); e.get(Y); e.emit(opcode); e.set(X); e.end(); };
  f(0xa0, "add", 0); f(0xa1, "sub", 1); f(0xa2, "mul", 2); f(0xa3, "div", 3);
  is(4); e.open("if", "sqrt"); e.get(X); e.emit(0x9f); e.set(X); e.end();
  f(0xa5, "max", 5); f(0xa4, "min", 6); f(0xa5, "maxnm", 7); f(0xa4, "minnm", 8);
  // an invalid operation (inf - inf, 0 * inf, 0 / 0, sqrt of a negative) gives the default NaN
  e.get(X); e.get(X); e.emit(0x62); e.open("if", "dn");
  e.i64(0x7ff8000000000000n); e.i64(0x7fc00000n); e.get(S); e.emit(0x1b); e.emit(0x0f);
  e.end();
  fFromF64(e, X, S);
  e.emit(0x0b);
  return [2, 2, F64, 2, I32, ...e.code];
}

/** armRound(a, mode, single) -> bits. Function 6. */
function armRoundBody(): number[] {
  const e = new Emitter();
  const A = 0, MODE = 1, S = 2, X = 3, T = 4;
  fIsNaN(e, A, S); e.open("if", "nan"); e.get(A); fQuiet(e, S); e.emit(0x84); e.emit(0x0f); e.end();
  fToF64(e, A, S); e.set(X);
  fRound(e, X, MODE, T);
  fFromF64(e, X, S);
  e.emit(0x0b);
  return [1, 2, F64, ...e.code];
}

/** armF2i(a, mode, single, kind) -> zero-extended integer; kind: 0 s32, 1 u32, 2 s64, 3 u64. Function 7. */
function armF2iBody(): number[] {
  const e = new Emitter();
  const A = 0, MODE = 1, S = 2, KIND = 3, X = 4, T = 5;
  fIsNaN(e, A, S); e.open("if", "nan"); e.i64(0n); e.emit(0x0f); e.end();
  fToF64(e, A, S); e.set(X);
  fRound(e, X, MODE, T);
  const is = (k: number) => { e.get(KIND); e.i32(k); e.emit(0x46); };
  is(0); e.open("if", "s32"); e.get(X); e.emit(0xfc, 2); e.emit(0xad); e.emit(0x0f); e.end();
  is(1); e.open("if", "u32"); e.get(X); e.emit(0xfc, 3); e.emit(0xad); e.emit(0x0f); e.end();
  is(2); e.open("if", "s64"); e.get(X); e.emit(0xfc, 6); e.emit(0x0f); e.end();
  e.get(X); e.emit(0xfc, 7);
  e.emit(0x0b);
  return [1, 2, F64, ...e.code];
}

/** armFcmp(a, b, single) -> NZCV. Function 8. */
function armFcmpBody(): number[] {
  const e = new Emitter();
  const A = 0, B = 1, S = 2, X = 3, Y = 4;
  fIsNaN(e, A, S); fIsNaN(e, B, S); e.emit(0x72); e.open("if", "un"); e.i32(0b0011); e.emit(0x0f); e.end();
  fToF64(e, A, S); e.set(X);
  fToF64(e, B, S); e.set(Y);
  e.get(X); e.get(Y); e.emit(0x61); e.open("if", "eq"); e.i32(0b0110); e.emit(0x0f); e.end();
  e.get(X); e.get(Y); e.emit(0x63); e.open("if", "lt"); e.i32(0b1000); e.emit(0x0f); e.end();
  e.i32(0b0010);
  e.emit(0x0b);
  return [1, 2, F64, ...e.code];
}

// ---------- per-instruction lowering ----------

function src(e: Emitter, s: Src) {
  if ("r" in s) e.get(s.r);
  else e.i64(s.imm);
}

function maskTop(e: Emitter, w: W) {
  if (w < 64) { e.i64(maskOf(w)); e.emit(0x83); }
}

function signExtendTop(e: Emitter, w: W) {
  if (w === 32) e.emit(0xc4);
  else if (w === 16) e.emit(0xc3);
  else if (w === 8) e.emit(0xc2);
}

/** Write the value in TR (already masked to w) into register d with width semantics. */
function writeFrom(e: Emitter, from: number, d: number, w: W) {
  if (w === 64 || w === 32) {
    e.get(from);
    if (w === 32) maskTop(e, 32);
    e.set(d);
    return;
  }
  e.get(d); e.i64(~maskOf(w)); e.emit(0x83);
  e.get(from); maskTop(e, w);
  e.emit(0x84);
  e.set(d);
}

/** Store float bits from the stack into vector low half `d`: all 64 bits, or the low 32 (upper bits kept). */
function mergeFloat(e: Emitter, d: number, d64: boolean) {
  if (d64) {
    e.set(d);
    return;
  }
  e.i64(0xffffffffn); e.emit(0x83); e.set(TR);
  e.get(d); e.i64(-0x100000000n); e.emit(0x83); e.get(TR); e.emit(0x84); e.set(d);
}

function exitWith(e: Emitter, code: number, pc: bigint) {
  e.i64(pc); e.set(PC);
  e.i32(code); e.set(CODE);
  e.br("exit");
}

function cond(e: Emitter, c: Cond) {
  const g = (l: number) => e.get(l);
  const carm = () => { g(CF); g(KF); e.emit(0x73); };
  const sxo = () => { g(SF); g(OF); e.emit(0x73); };
  const not = () => e.emit(0x45);
  switch (c) {
    case "eq": g(ZF); break;
    case "ne": g(ZF); not(); break;
    case "b": g(CF); break;
    case "ae": g(CF); not(); break;
    case "be": g(CF); g(ZF); e.emit(0x72); break;
    case "a": g(CF); g(ZF); e.emit(0x72); not(); break;
    case "s": g(SF); break;
    case "ns": g(SF); not(); break;
    case "o": g(OF); break;
    case "no": g(OF); not(); break;
    case "lt": sxo(); break;
    case "ge": sxo(); not(); break;
    case "le": g(ZF); sxo(); e.emit(0x72); break;
    case "gt": g(ZF); sxo(); e.emit(0x72); not(); break;
    case "cs": carm(); break;
    case "cc": carm(); not(); break;
    case "hi": carm(); g(ZF); not(); e.emit(0x71); break;
    case "ls": carm(); not(); g(ZF); e.emit(0x72); break;
    case "al": e.i32(1); break;
    case "p": g(PF); break;
    case "np": g(PF); not(); break;
  }
}

function ea(e: Emitter, x: Ea) {
  if (x.base !== null) e.get(x.base);
  else e.i64(0n);
  if (x.index !== null) {
    e.get(x.index);
    if (x.scale > 1) { e.i64(BigInt(Math.log2(x.scale))); e.emit(0x86); }
    e.emit(0x7c);
  }
  if (x.disp !== 0n) { e.i64(x.disp); e.emit(0x7c); }
  if (x.a32) { e.i64(0xffffffffn); e.emit(0x83); }
  if (x.seg !== undefined) { e.get(x.seg); e.emit(0x7c); }
  e.set(TEA);
}

function checkAccess(e: Emitter, size: number, memBytes: number, pc: bigint, store: boolean) {
  e.get(TEA); e.i64(BigInt(NULL_PAGE)); e.emit(0x54); // lt_u
  e.get(TEA); e.i64(BigInt(memBytes - size)); e.emit(0x56); // gt_u
  e.emit(0x72);
  e.open("if", "fault");
  e.get(TEA); e.set(FA);
  exitWith(e, Stop.fault, pc);
  e.end();
  if (store) {
    // overlap with the translated code: tea < codeHi && tea + size > codeLo
    e.get(TEA); e.i32(0); e.emit(0x29, 3, ...uleb(STATE.codeHi)); e.emit(0x54);
    e.get(TEA); e.i64(BigInt(size)); e.emit(0x7c); e.i32(0); e.emit(0x29, 3, ...uleb(STATE.codeLo)); e.emit(0x56);
    e.emit(0x71);
    e.open("if", "smc");
    e.get(TEA); e.set(FA);
    exitWith(e, Stop.smc, pc);
    e.end();
  }
}

function aluCompute(e: Emitter, op: AluOp, w: W) {
  // TA, TB hold masked operands. Leaves the masked result on the stack.
  const shiftCount = () => { e.get(TB); if (w < 64) { e.i64(31n); e.emit(0x83); } };
  switch (op) {
    case "add": e.get(TA); e.get(TB); e.emit(0x7c); break;
    case "ctz": e.get(TA); e.emit(0x7a); if (w < 64) { e.i64(BigInt(w)); e.get(TA); e.i64(0n); e.emit(0x52); e.emit(0x1b); } break; // i64.ctz; a zero source gives w
    case "clz": e.get(TA); e.emit(0x79); if (w < 64) { e.i64(BigInt(64 - w)); e.emit(0x7d); } break;
    case "adc": e.get(TA); e.get(TB); e.emit(0x7c); e.get(CF); e.emit(0xad); e.emit(0x7c); break;
    case "sbb": e.get(TA); e.get(TB); e.emit(0x7d); e.get(CF); e.emit(0xad); e.emit(0x7d); break;
    case "sub": e.get(TA); e.get(TB); e.emit(0x7d); break;
    case "and": e.get(TA); e.get(TB); e.emit(0x83); break;
    case "or": e.get(TA); e.get(TB); e.emit(0x84); break;
    case "xor": e.get(TA); e.get(TB); e.emit(0x85); break;
    case "mul": e.get(TA); e.get(TB); e.emit(0x7e); break;
    case "shl": e.get(TA); shiftCount(); e.emit(0x86); break;
    case "shr": e.get(TA); shiftCount(); e.emit(0x88); break;
    case "sar": e.get(TA); signExtendTop(e, w); shiftCount(); e.emit(0x87); break;
    case "ror":
      if (w === 64) { e.get(TA); e.get(TB); e.emit(0x8a); }
      else if (w === 32) { e.get(TA); e.emit(0xa7); e.get(TB); e.emit(0xa7); e.emit(0x78); e.emit(0xad); }
      else throw new Error("ror below 32 bits is not lowered");
      break;
    case "umulh":
      if (w === 64) { e.get(TA); e.get(TB); e.emit(0x10, 1); }
      else { e.get(TA); e.get(TB); e.emit(0x7e); e.i64(BigInt(w)); e.emit(0x88); }
      break;
    case "smulh":
      if (w === 64) { e.get(TA); e.get(TB); e.emit(0x10, 2); }
      else { e.get(TA); signExtendTop(e, w); e.get(TB); signExtendTop(e, w); e.emit(0x7e); e.i64(BigInt(w)); e.emit(0x87); }
      break;
    case "udiv":
    case "urem": {
      // b == 0 -> 0 (div) or a (rem), like AArch64. x86 guards zero before it gets here.
      const safe = () => { e.i64(1n); e.get(TB); e.get(TB); e.emit(0x50); e.emit(0x1b); };
      if (op === "udiv") e.i64(0n); else e.get(TA);
      e.get(TA); safe(); e.emit(op === "udiv" ? 0x80 : 0x82);
      e.get(TB); e.emit(0x50);
      e.emit(0x1b);
      break;
    }
    case "sdiv":
    case "srem": {
      // Sign-extended operands. b == -1 never reaches the trapping instruction.
      const A = () => { e.get(TA); signExtendTop(e, w); };
      const B = () => { e.get(TB); signExtendTop(e, w); };
      const safe = () => { e.i64(1n); B(); B(); e.emit(0x50); B(); e.i64(-1n); e.emit(0x51); e.emit(0x72); e.emit(0x1b); };
      if (op === "sdiv") e.i64(0n); else A();
      if (op === "sdiv") { e.i64(0n); A(); e.emit(0x7d); } else e.i64(0n);
      A(); safe(); e.emit(op === "sdiv" ? 0x7f : 0x81);
      B(); e.i64(-1n); e.emit(0x51);
      e.emit(0x1b);
      B(); e.emit(0x50);
      e.emit(0x1b);
      break;
    }
  }
  if (w < 64) maskTop(e, w);
}

function flags(e: Emitter, op: AluOp, mode: FlagMode, w: W) {
  if (mode === "none") return;
  const top = BigInt(w - 1);
  e.get(TR); e.emit(0x50); e.set(ZF);
  e.get(TR); e.i64(top); e.emit(0x88); e.i64(1n); e.emit(0x83); e.emit(0xa7); e.set(SF);
  parityOf(e, TR);
  if (mode === "logic" || mode === "shift") {
    e.i32(0); e.set(CF); e.i32(0); e.set(OF); e.i32(0); e.set(KF);
    return;
  }
  const sub = op === "sub" || op === "sbb";
  if (sub) { e.get(TA); e.get(TB); e.emit(0x85); e.get(TA); e.get(TR); e.emit(0x85); e.emit(0x83); }
  else { e.get(TA); e.get(TR); e.emit(0x85); e.get(TB); e.get(TR); e.emit(0x85); e.emit(0x83); }
  e.i64(top); e.emit(0x88); e.i64(1n); e.emit(0x83); e.emit(0xa7); e.set(OF);
  if (mode === "inc") return;
  if (op === "sbb") {
    // borrow = a < b || (cin && a == b)
    e.get(TA); e.get(TB); e.emit(0x54);
    e.get(CF); e.get(TA); e.get(TB); e.emit(0x51); e.emit(0x71);
    e.emit(0x72);
  } else if (op === "adc") {
    if (w === 64) { e.get(TR); e.get(TA); e.emit(0x54); e.get(CF); e.get(TR); e.get(TA); e.emit(0x51); e.emit(0x71); e.emit(0x72); }
    else { e.get(TA); e.get(TB); e.emit(0x7c); e.get(CF); e.emit(0xad); e.emit(0x7c); e.i64(maskOf(w)); e.emit(0x56); }
  } else if (sub) { e.get(TA); e.get(TB); e.emit(0x54); }
  else if (w === 64) { e.get(TR); e.get(TA); e.emit(0x54); }
  else { e.get(TA); e.get(TB); e.emit(0x7c); e.i64(maskOf(w)); e.emit(0x56); }
  e.set(CF);
  e.i32(sub ? 1 : 0); e.set(KF);
}

function lowerOp(e: Emitter, op: Op, insn: Insn, memBytes: number) {
  switch (op.k) {
    case "mov":
      src(e, op.s); maskTop(e, op.w); e.set(TR);
      writeFrom(e, TR, op.d, op.w);
      return;
    case "alu":
      src(e, op.a); maskTop(e, op.w); e.set(TA);
      src(e, op.b); maskTop(e, op.w); e.set(TB);
      aluCompute(e, op.op, op.w);
      e.set(TR);
      flags(e, op.op, op.f, op.w);
      if (op.d !== null) writeFrom(e, TR, op.d, op.w);
      return;
    case "ext":
      src(e, op.s);
      if (op.signed) signExtendTop(e, op.from);
      else maskTop(e, op.from);
      maskTop(e, op.w);
      e.set(TR);
      writeFrom(e, TR, op.d, op.w);
      return;
    case "lea":
      ea(e, op.ea);
      e.get(TEA); maskTop(e, op.w); e.set(TR);
      writeFrom(e, TR, op.d, op.w);
      return;
    case "load": {
      ea(e, op.ea);
      checkAccess(e, op.size, memBytes, insn.pc, false);
      e.get(TEA); e.emit(0xa7);
      const opcode = { 1: op.signed ? 0x30 : 0x31, 2: op.signed ? 0x32 : 0x33, 4: op.signed ? 0x34 : 0x35, 8: 0x29 }[op.size];
      e.emit(opcode, 0, 0);
      maskTop(e, op.w);
      e.set(TR);
      writeFrom(e, TR, op.d, op.w);
      return;
    }
    case "store": {
      ea(e, op.ea);
      checkAccess(e, op.size, memBytes, insn.pc, true);
      e.get(TEA); e.emit(0xa7);
      src(e, op.s);
      const opcode = { 1: 0x3c, 2: 0x3d, 4: 0x3e, 8: 0x37 }[op.size];
      e.emit(opcode, 0, 0);
      return;
    }
    case "set":
      cond(e, op.c); e.emit(0xad); e.set(TR);
      writeFrom(e, TR, op.d, op.w);
      return;
    case "csel":
      src(e, op.a); src(e, op.b); cond(e, op.c); e.emit(0x1b);
      maskTop(e, op.w); e.set(TR);
      writeFrom(e, TR, op.d, op.w);
      return;
    case "ccmp": {
      cond(e, op.c);
      e.open("if", "ccmp");
      const kind: AluOp = op.neg ? "add" : "sub";
      src(e, op.a); maskTop(e, op.w); e.set(TA);
      src(e, op.b); maskTop(e, op.w); e.set(TB);
      aluCompute(e, kind, op.w);
      e.set(TR);
      flags(e, kind, "arith", op.w);
      e.emit(0x05); // else
      setNzcv(e, op.nzcv);
      e.end();
      return;
    }
    case "setnzcv":
      setNzcv(e, op.nzcv);
      return;
    case "br":
      cond(e, op.c);
      e.open("if", "br");
      e.i64(op.t); e.set(PC); e.br("dispatch");
      e.end();
      return;
    case "cbz":
      src(e, op.s); maskTop(e, op.w); e.emit(0x50);
      if (op.nz) e.emit(0x45);
      e.open("if", "cbz");
      e.i64(op.t); e.set(PC); e.br("dispatch");
      e.end();
      return;
    case "tbz":
      src(e, op.s); e.i64(BigInt(op.bit)); e.emit(0x88); e.i64(1n); e.emit(0x83); e.emit(0xa7);
      if (!op.nz) e.emit(0x45);
      e.open("if", "tbz");
      e.i64(op.t); e.set(PC); e.br("dispatch");
      e.end();
      return;
    case "jmp":
      e.i64(op.t); e.set(PC); e.br("dispatch");
      return;
    case "jmpr":
      src(e, op.s); e.set(PC); e.br("dispatch");
      return;
    case "sys":
      exitWith(e, Stop.syscall, insn.next);
      return;
    case "guardz":
      src(e, op.s); maskTop(e, op.w); e.emit(0x50);
      e.open("if", "guard");
      exitWith(e, Stop.div0, insn.pc);
      e.end();
      return;
    case "guardext":
      // want = signed && top bit of lo ? mask : 0 ; stop if hi_w != want
      e.get(op.hi); maskTop(e, op.w);
      if (op.signed) { e.get(op.lo); signExtendTop(e, op.w); e.i64(63n); e.emit(0x87); maskTop(e, op.w); }
      else e.i64(0n);
      e.emit(0x52);
      e.open("if", "guard");
      exitWith(e, Stop.unsupported, insn.pc);
      e.end();
      return;
    case "halt":
      exitWith(e, Stop.halt, insn.pc);
      return;
    case "vec": {
      const lo = (x: number) => XMM(x);
      const pack = (x: number) => {
        // v128 from the two i64 halves
        e.i64(0n); simd(e, 0x12); // i64x2.splat 0
        e.get(lo(x)); simd(e, 0x1e); e.emit(0);
        e.get(lo(x) + 1); simd(e, 0x1e); e.emit(1);
      };
      const VEC: Partial<Record<VecOp, number>> = {
        and: 0x4e, or: 0x50, xor: 0x51, andn: 0x4f,
        add8: 0x6e, add16: 0x8e, add32: 0xae, add64: 0xce, sub8: 0x71, sub16: 0x91, sub32: 0xb1, sub64: 0xd1,
        eq8: 0x23, eq16: 0x2d, eq32: 0x37, eq64: 0xd6, gt8: 0x27, gt16: 0x31, gt32: 0x3b, gt64: 0xd9,
        ge8: 0x2b, ge16: 0x35, ge32: 0x3f, ge64: 0xdb, hi8: 0x28, hi16: 0x32, hi32: 0x3c, hs8: 0x2c, hs16: 0x36, hs32: 0x40,
        minu8: 0x77, maxu8: 0x79, mins8: 0x76, maxs8: 0x78, minu16: 0x97, maxu16: 0x99, mins16: 0x96, maxs16: 0x98,
        minu32: 0xb7, maxu32: 0xb9, mins32: 0xb6, maxs32: 0xb8, mul16: 0x95, mul32: 0xb5, mul64: 0xd5,
        swizzle: 0x0e,
        shl8: 0x6b, shr8: 0x6d, sar8: 0x6c, shl16: 0x8b, shr16: 0x8d, sar16: 0x8c, shl32: 0xab, shr32: 0xad, sar32: 0xac, shl64: 0xcb, shr64: 0xcd, sar64: 0xcc,
        popcnt8: 0x62,
        zxl8: 0x89, zxh8: 0x8a, sxl8: 0x87, sxh8: 0x88, zxl16: 0xa9, zxh16: 0xaa, sxl16: 0xa7, sxh16: 0xa8, zxl32: 0xc9, zxh32: 0xca, sxl32: 0xc7, sxh32: 0xc8,
      };
      pack(op.a);
      if (VEC_UNARY.has(op.op)) {
        simd(e, VEC[op.op]!);
      } else if (/^(shl|shr|sar)/.test(op.op)) {
        e.i32(op.imm);
        simd(e, VEC[op.op]!);
      } else if (op.op === "shuffle") {
        pack(op.b);
        simd(e, 0x0d);
        e.emit(...vecShuffles[op.imm]);
      } else {
        pack(op.b);
        simd(e, VEC[op.op]!);
      }
      e.tee(V0);
      simd(e, 0x1d); e.emit(0); e.set(lo(op.d));
      e.get(V0); simd(e, 0x1d); e.emit(1); e.set(lo(op.d) + 1);
      return;
    }
    case "vmask": {
      const lo = XMM(op.a);
      e.i64(0n); simd(e, 0x12);
      e.get(lo); simd(e, 0x1e); e.emit(0);
      e.get(lo + 1); simd(e, 0x1e); e.emit(1);
      simd(e, op.lanes === 16 ? 0x64 : 0xa4); // i8x16.bitmask / i32x4.bitmask
      e.emit(0xad); // i64.extend_i32_u
      e.set(op.d);
      return;
    }
    case "fop": {
      const lo = (x: number) => XMM(x);
      const d64 = op.size === 8;
      if (op.arm || op.op === "maxnm" || op.op === "minnm") {
        e.get(lo(op.a)); e.get(lo(op.b)); e.i32(ARM_FOP[op.op]); e.i32(d64 ? 0 : 1);
        e.emit(0x10, 5);
        mergeFloat(e, lo(op.d), d64);
        return;
      }
      // operands as f64 (singles are widened exactly; the result is rounded back to single)
      const load = (x: number, into: number) => {
        e.get(lo(x));
        if (d64) e.emit(0xbf); // f64.reinterpret_i64
        else { e.emit(0xa7); e.emit(0xbe); e.emit(0xbb); } // i32.wrap, f32.reinterpret, f64.promote
        e.set(into);
      };
      load(op.a, FA_);
      load(op.b, FB_);
      const raw = (x: number) => { e.get(lo(x)); if (!d64) { e.i64(0xffffffffn); e.emit(0x83); } };
      if (op.op === "min" || op.op === "max") {
        // x86 minsd/maxsd: a < b (or a > b) ? a : b, on the exact bits (NaN or equal zeros give b)
        raw(op.a); raw(op.b);
        e.get(FA_); e.get(FB_); e.emit(op.op === "min" ? 0x63 : 0x64);
        e.emit(0x1b);
      } else {
        const F = { add: 0xa0, sub: 0xa1, mul: 0xa2, div: 0xa3 } as Record<string, number>;
        if (op.op === "sqrt") { e.get(FB_); e.emit(0x9f); }
        else { e.get(FA_); e.get(FB_); e.emit(F[op.op]); }
        if (!d64) { e.emit(0xb6); e.emit(0xbb); } // round to single: f32.demote, f64.promote
        e.set(FR_);
        const bits = () => {
          e.get(FR_);
          if (d64) e.emit(0xbd); // i64.reinterpret_f64
          else { e.emit(0xb6); e.emit(0xbc); e.emit(0xad); } // f32.demote, i32.reinterpret, i64.extend_u
        };
        const quiet = BigInt(d64 ? "0x0008000000000000" : "0x00400000");
        // NaN results follow x86: first operand NaN (quieted), else second, else the default QNaN
        e.get(FR_); e.get(FR_); e.emit(0x62); // f64.ne -> is NaN
        e.emit(0x04, I64); e.ctl.push("fnan");
        if (op.op !== "sqrt") {
          e.get(FA_); e.get(FA_); e.emit(0x62);
          e.emit(0x04, I64); e.ctl.push("fa");
          raw(op.a); e.i64(quiet); e.emit(0x84);
          e.emit(0x05);
        }
        e.get(FB_); e.get(FB_); e.emit(0x62);
        e.emit(0x04, I64); e.ctl.push("fb");
        raw(op.b); e.i64(quiet); e.emit(0x84);
        e.emit(0x05);
        e.i64(d64 ? -0x8000000000000n : 0xffc00000n);
        e.emit(0x0b); e.ctl.pop();
        if (op.op !== "sqrt") { e.emit(0x0b); e.ctl.pop(); }
        e.emit(0x05);
        bits();
        e.emit(0x0b); e.ctl.pop();
      }
      if (d64) e.set(lo(op.d));
      else {
        e.set(TR);
        e.get(lo(op.d)); e.i64(-0x100000000n); e.emit(0x83); e.get(TR); e.emit(0x84); e.set(lo(op.d));
      }
      return;
    }
    case "fcvt": {
      const lo = (x: number) => XMM(x);
      if (op.kind === "i2f" && op.unsigned) {
        src(e, op.s); maskTop(e, op.w);
        e.emit(op.size === 8 ? 0xba : 0xb5); // f64/f32.convert_i64_u
        if (op.size === 8) e.emit(0xbd);
        else { e.emit(0xbc); e.emit(0xad); }
        mergeFloat(e, lo(op.d), op.size === 8);
        return;
      }
      if (op.kind === "f2i" && op.arm) {
        e.get(lo(op.a)); e.i32(ARM_ROUND[op.arm.round]); e.i32(op.size === 8 ? 0 : 1); e.i32((op.w === 64 ? 2 : 0) + (op.arm.unsigned ? 1 : 0));
        e.emit(0x10, 7);
        e.set(TR);
        writeFrom(e, TR, op.d, op.w);
        return;
      }
      if (op.kind === "i2f") {
        src(e, op.s);
        if (op.w === 32) { e.emit(0xa7); e.emit(op.size === 8 ? 0xb7 : 0xb2); } // f64/f32.convert_i32_s
        else e.emit(op.size === 8 ? 0xb9 : 0xb4); // f64/f32.convert_i64_s
        if (op.size === 8) { e.emit(0xbd); e.set(lo(op.d)); }
        else {
          e.emit(0xbc); e.emit(0xad); e.set(TR);
          e.get(lo(op.d)); e.i64(-0x100000000n); e.emit(0x83); e.get(TR); e.emit(0x84); e.set(lo(op.d));
        }
        return;
      }
      if (op.kind === "f2f") {
        e.get(lo(op.a));
        if (op.from === 8) {
          e.emit(0xbf); e.emit(0xb6); e.emit(0xbc); e.emit(0xad); e.set(TR); // demote to single bits
          e.get(lo(op.d)); e.i64(-0x100000000n); e.emit(0x83); e.get(TR); e.emit(0x84); e.set(lo(op.d));
        } else {
          e.emit(0xa7); e.emit(0xbe); e.emit(0xbb); e.emit(0xbd); e.set(lo(op.d)); // promote
        }
        return;
      }
      // float -> int, x86 style: NaN or out of range gives the "integer indefinite" value
      e.get(lo(op.a));
      if (op.size === 8) e.emit(0xbf);
      else { e.emit(0xa7); e.emit(0xbe); e.emit(0xbb); }
      if (!op.trunc) e.emit(0x9e); // f64.nearest (ties to even, like the default rounding mode)
      else e.emit(0x9d); // f64.trunc
      e.set(FR_);
      const lim = op.w === 64 ? 9223372036854775808 : 2147483648;
      e.get(FR_); e.emit(0x44, ...f64Bytes(-lim)); e.emit(0x66); // f64.ge
      e.get(FR_); e.emit(0x44, ...f64Bytes(lim)); e.emit(0x63); // f64.lt
      e.emit(0x71);
      e.emit(0x04, I64); e.ctl.push("cvt");
      e.get(FR_); e.emit(0xb0); // i64.trunc_f64_s (in range here)
      e.emit(0x05);
      e.i64(op.w === 64 ? -0x8000000000000000n : 0x80000000n);
      e.emit(0x0b); e.ctl.pop();
      if (op.w === 32) { e.i64(0xffffffffn); e.emit(0x83); }
      e.set(TR);
      writeFrom(e, TR, op.d, op.w);
      return;
    }
    case "fcmp": {
      const lo = (x: number) => XMM(x);
      if (op.arm) {
        const compare = () => {
          e.get(lo(op.a)); e.get(lo(op.b)); e.i32(op.size === 8 ? 0 : 1);
          e.emit(0x10, 8);
          e.set(KF);
          e.get(KF); e.i32(3); e.emit(0x76); e.i32(1); e.emit(0x71); e.set(SF);
          e.get(KF); e.i32(2); e.emit(0x76); e.i32(1); e.emit(0x71); e.set(ZF);
          e.get(KF); e.i32(1); e.emit(0x76); e.i32(1); e.emit(0x71); e.set(CF);
          e.get(KF); e.i32(1); e.emit(0x71); e.set(OF);
          e.i32(0); e.set(KF);
        };
        if (op.cond) {
          cond(e, op.cond);
          e.open("if", "fccmp");
          compare();
          e.emit(0x05);
          setNzcv(e, op.nzcv ?? 0);
          e.end();
        } else compare();
        return;
      }
      const load = (x: number, into: number) => {
        e.get(lo(x));
        if (op.size === 8) e.emit(0xbf);
        else { e.emit(0xa7); e.emit(0xbe); e.emit(0xbb); }
        e.set(into);
      };
      load(op.a, FA_);
      load(op.b, FB_);
      // unordered = a != a || b != b
      e.get(FA_); e.get(FA_); e.emit(0x62); e.get(FB_); e.get(FB_); e.emit(0x62); e.emit(0x72); e.set(PF);
      e.get(PF); e.get(FA_); e.get(FB_); e.emit(0x61); e.emit(0x72); e.set(ZF);
      e.get(PF); e.get(FA_); e.get(FB_); e.emit(0x63); e.emit(0x72); e.set(CF);
      e.i32(0); e.set(SF); e.i32(0); e.set(OF); e.i32(0); e.set(KF);
      return;
    }
    case "fround":
      e.get(XMM(op.a)); e.i32(ARM_ROUND[op.mode]); e.i32(op.size === 8 ? 0 : 1);
      e.emit(0x10, 6);
      mergeFloat(e, XMM(op.d), op.size === 8);
      return;
    case "fma":
      // Not lowered yet: the interpreter computes it exactly. Stop rather than guess.
      exitWith(e, Stop.unsupported, insn.pc);
      return;
    case "div2": {
      const w = op.w;
      const div0 = () => exitWith(e, Stop.div0, insn.pc);
      // divisor
      src(e, op.s); maskTop(e, w); e.set(TB);
      e.get(TB); e.emit(0x50); e.open("if", "dz"); div0(); e.end();
      if (w < 64) {
        // the 2w-bit dividend fits in 64 bits
        e.get(2); maskTop(e, w); e.i64(BigInt(w)); e.emit(0x86); e.get(0); maskTop(e, w); e.emit(0x84);
        if (op.signed && w === 16) e.emit(0xc4); // sign-extend the 32-bit dividend
        e.set(TA);
        const lim = 1n << BigInt(w - 1);
        if (!op.signed) {
          e.get(TA); e.get(TB); e.emit(0x80); e.set(TR);
          e.get(TR); e.i64(maskOf(w)); e.emit(0x56); e.open("if", "ov"); div0(); e.end();
          e.get(TA); e.get(TB); e.emit(0x82); e.set(FA);
        } else {
          e.get(TB); signExtendTop(e, w); e.set(TB);
          // INT64_MIN / -1 would trap in WebAssembly; it is an overflow on x86 anyway
          e.get(TA); e.i64(-0x8000000000000000n); e.emit(0x51); e.get(TB); e.i64(-1n); e.emit(0x51); e.emit(0x71);
          e.open("if", "ov"); div0(); e.end();
          e.get(TA); e.get(TB); e.emit(0x7f); e.set(TR);
          e.get(TR); e.i64(-lim); e.emit(0x53); e.get(TR); e.i64(lim); e.emit(0x59); e.emit(0x72);
          e.open("if", "ov"); div0(); e.end();
          e.get(TA); e.get(TB); e.emit(0x81); e.set(FA);
        }
      } else if (!op.signed) {
        e.get(2); e.get(TB); e.emit(0x5a); e.open("if", "ov"); div0(); e.end();
        e.get(2); e.get(0); e.get(TB); e.emit(0x10, 4); e.set(FA); e.set(TR);
      } else {
        // |dividend| (128-bit) and |divisor|, divide unsigned, then fix the signs
        e.get(2); e.i64(0n); e.emit(0x53); e.emit(0xad); e.set(TEA); // TEA = 1 if the dividend is negative
        e.get(TB); e.i64(0n); e.emit(0x53); e.emit(0xad); e.set(TR); // TR = divisor negative
        // TA = |hi|, FA = |lo|
        e.get(0); e.set(FA);
        e.get(2); e.set(TA);
        e.get(TEA); e.i64(0n); e.emit(0x52); e.open("if", "nh");
        e.i64(0n); e.get(0); e.emit(0x7d); e.set(FA);
        e.get(2); e.i64(-1n); e.emit(0x85); e.get(0); e.emit(0x50); e.emit(0xad); e.emit(0x7c); e.set(TA);
        e.end();
        e.get(TR); e.i64(0n); e.emit(0x52); e.open("if", "nd");
        e.i64(0n); e.get(TB); e.emit(0x7d); e.set(TB);
        e.end();
        e.get(TA); e.get(TB); e.emit(0x5a); e.open("if", "ov"); div0(); e.end();
        e.get(TA); e.get(FA); e.get(TB); e.emit(0x10, 4); e.set(FA); e.set(TA); // TA = q, FA = r (unsigned)
        // quotient sign = sign(dividend) xor sign(divisor); range check
        e.get(TEA); e.get(TR); e.emit(0x85); e.i64(0n); e.emit(0x52); e.open("if", "qn");
        e.get(TA); e.i64(-0x8000000000000000n); e.emit(0x56); e.open("if", "ov"); div0(); e.end();
        e.i64(0n); e.get(TA); e.emit(0x7d); e.set(TA);
        e.emit(0x05);
        e.get(TA); e.i64(-0x8000000000000000n); e.emit(0x5a); e.open("if", "ov"); div0(); e.end();
        e.end();
        e.get(TEA); e.i64(0n); e.emit(0x52); e.open("if", "rn");
        e.i64(0n); e.get(FA); e.emit(0x7d); e.set(FA);
        e.end();
        e.get(TA); e.set(TR);
      }
      // TR = quotient, FA = remainder
      writeFrom(e, TR, 0, w);
      writeFrom(e, FA, 2, w);
      return;
    }
    case "flagsz": {
      if (op.when) {
        src(e, op.when.s); e.i64(BigInt(op.when.mask)); e.emit(0x83); e.i64(0n); e.emit(0x52);
        e.open("if", "flagsz");
      }
      src(e, op.v); maskTop(e, op.w); e.set(TR);
      e.get(TR); e.emit(0x50); e.set(ZF);
      e.get(TR); e.i64(BigInt(op.w - 1)); e.emit(0x88); e.i64(1n); e.emit(0x83); e.emit(0xa7); e.set(SF);
      parityOf(e, TR);
      e.i32(0); e.set(CF); e.i32(0); e.set(OF); e.i32(0); e.set(KF);
      if (op.when) e.end();
      return;
    }
    case "setflag": {
      if (op.when) {
        src(e, op.when.s); e.i64(BigInt(op.when.mask)); e.emit(0x83);
        if (op.when.eq === undefined) { e.i64(0n); e.emit(0x52); } else { e.i64(BigInt(op.when.eq)); e.emit(0x51); }
        e.open("if", "flag");
      }
      src(e, op.v); e.i64(BigInt(op.bit)); e.emit(0x88); e.i64(1n); e.emit(0x83); e.emit(0xa7);
      e.set(op.flag === "c" ? CF : OF);
      if (op.when) e.end();
      return;
    }
    case "cpuid": {
      // eax, ebx, ecx, edx = table[eax]; unknown leaves read as zero
      const out = [0, 3, 1, 2];
      e.get(0); e.i64(0xffffffffn); e.emit(0x83); e.set(TA);
      for (const r of out) { e.i64(0n); e.set(r); }
      for (const [leaf, row] of CPUID) {
        e.get(TA); e.i64(BigInt(leaf)); e.emit(0x51);
        e.open("if", "cpuid");
        row.forEach((v, i) => { e.i64(BigInt(v >>> 0)); e.set(out[i]); });
        e.end();
      }
      return;
    }
  }
}

/** PF = even number of set bits in the low byte of local x. */
function parityOf(e: Emitter, x: number) {
  e.get(x); e.i64(0xffn); e.emit(0x83); e.emit(0x7b); e.i64(1n); e.emit(0x83); e.emit(0x50); e.set(PF); // i64.popcnt & 1, then eqz
}

function f64Bytes(x: number): number[] {
  return Array.from(new Uint8Array(new Float64Array([x]).buffer));
}

function simd(e: Emitter, sub: number) {
  e.emit(0xfd, ...uleb(sub));
}

function setNzcv(e: Emitter, nzcv: number) {
  e.i32((nzcv >> 3) & 1); e.set(SF);
  e.i32((nzcv >> 2) & 1); e.set(ZF);
  e.i32((nzcv >> 1) & 1); e.set(CF);
  e.i32(nzcv & 1); e.set(OF);
  e.i32(0); e.set(KF);
}

function lowerInsn(e: Emitter, insn: Insn, memBytes: number) {
  for (const op of insn.ops) lowerOp(e, op, insn, memBytes);
}

export function instantiate(build: WasmBuild): { run: () => number; mem: WebAssembly.Memory } {
  if (!WebAssembly.validate(build.bytes as BufferSource)) throw new Error("lowered module failed validation");
  const module = new WebAssembly.Module(build.bytes as BufferSource);
  if (WebAssembly.Module.imports(module).length) throw new Error("lowered module must not import anything");
  const instance = new WebAssembly.Instance(module, {});
  return { run: instance.exports.run as () => number, mem: instance.exports.mem as WebAssembly.Memory };
}
