/**
 * Guest IR, version 2. The neutral form that x86-64 and AArch64 machine code is lifted into.
 *
 * Same idea as FEX-Emu and QEMU TCG: decode the source machine's instructions into a small set of
 * operations with exact semantics, then either interpret them (reference) or lower them to
 * WebAssembly (fast path). Bytes the decoders do not know become gaps and are never executed.
 *
 * Values are 64-bit. Widths 8/16/32/64 follow the source machine:
 *   64  full write
 *   32  result zero-extended into the register (x86 and ARM agree)
 *   16/8  merge into the low bits, upper bits kept (x86 only)
 *
 * Flags are kept as Z, S, C, O plus K. C is the x86 carry (borrow after a subtraction). K is 1 when the
 * last flag-setting op was a subtraction, so ARM's carry (which is NOT-borrow) is C xor K.
 */

export type GuestArch = "x86_64" | "aarch64";
export type W = 8 | 16 | 32 | 64;
export type Src = { r: number } | { imm: bigint };
export type Ea = { base: number | null; index: number | null; scale: 1 | 2 | 4 | 8; disp: bigint; rip?: boolean; seg?: number; a32?: boolean };
/** Ea.seg: a register added as a segment base (x86 fs: uses the thread pointer). Ea.a32: 32-bit address size. */

export type AluOp = "add" | "sub" | "adc" | "sbb" | "ctz" | "clz" | "and" | "or" | "xor" | "shl" | "shr" | "sar" | "ror" | "mul" | "umulh" | "smulh" | "udiv" | "sdiv" | "urem" | "srem";
export type FlagMode = "none" | "arith" | "logic" | "inc" | "shift";
export type Cond =
  | "eq" | "ne" | "b" | "ae" | "be" | "a" | "s" | "ns" | "o" | "no" | "lt" | "ge" | "le" | "gt"
  | "cs" | "cc" | "hi" | "ls" | "al" | "p" | "np";

export type Op =
  | { k: "mov"; d: number; s: Src; w: W }
  | { k: "alu"; op: AluOp; d: number | null; a: Src; b: Src; w: W; f: FlagMode }
  | { k: "ext"; d: number; s: Src; from: 8 | 16 | 32; signed: boolean; w: W }
  | { k: "lea"; d: number; ea: Ea; w: W }
  | { k: "load"; d: number; ea: Ea; size: 1 | 2 | 4 | 8; signed: boolean; w: W }
  | { k: "store"; s: Src; ea: Ea; size: 1 | 2 | 4 | 8 }
  | { k: "set"; d: number; c: Cond; w: W }
  | { k: "csel"; d: number; c: Cond; a: Src; b: Src; w: W }
  | { k: "ccmp"; c: Cond; a: Src; b: Src; w: W; neg: boolean; nzcv: number }
  | { k: "setnzcv"; nzcv: number }
  | { k: "br"; c: Cond; t: bigint }
  | { k: "cbz"; s: Src; w: W; nz: boolean; t: bigint }
  | { k: "tbz"; s: Src; bit: number; nz: boolean; t: bigint }
  | { k: "jmp"; t: bigint }
  | { k: "jmpr"; s: Src }
  | { k: "sys" }
  | { k: "guardz"; s: Src; w: W }
  | { k: "guardext"; hi: number; lo: number; signed: boolean; w: W }
  | { k: "halt"; why: string }
  /** Scalar floating point on the low lane of xmm registers (size 4: single, 8: double). d = a op b. */
  | { k: "fop"; op: "add" | "sub" | "mul" | "div" | "min" | "max" | "sqrt"; d: number; a: number; b: number; size: 4 | 8 }
  /** Conversions. i2f: xmm d low lane = float(int s at width w). f2i: register d = int(xmm a), truncating or rounding. f2f: between sizes. */
  | { k: "fcvt"; kind: "i2f"; d: number; s: Src; w: 32 | 64; size: 4 | 8 }
  | { k: "fcvt"; kind: "f2i"; d: number; a: number; w: 32 | 64; size: 4 | 8; trunc: boolean }
  | { k: "fcvt"; kind: "f2f"; d: number; a: number; from: 4 | 8 }
  /** ucomis/comis: Z, P, C from comparing the low lanes (unordered sets all three); O, S, K cleared. */
  | { k: "fcmp"; a: number; b: number; size: 4 | 8 }
  /** x86 div/idiv: (rdx:rax) / s at width w -> rax quotient, rdx remainder. Zero or a quotient that does not fit stops with div0. */
  | { k: "div2"; signed: boolean; s: Src; w: W }
  /** Z and S from v at width w, C = O = 0: the flags of a shift, applied only when the shift count is nonzero. */
  | { k: "flagsz"; v: Src; w: W; when: { s: Src; mask: number } | null }
  /** Set one flag (c or o) to bit `bit` of v, optionally only when (s & mask) is nonzero or equals eq. */
  | { k: "setflag"; flag: "c" | "o"; v: Src; bit: number; when: { s: Src; mask: number; eq?: number } | null }
  /** x86 cpuid: a fixed, honest feature table (baseline x86-64: SSE2, no AVX). Reads eax/ecx, writes eax/ebx/ecx/edx. */
  | { k: "cpuid" }
  /** 128-bit vector op on xmm registers (numbers 0..16, see XMM). d = op(a, b), imm for shuffles and shifts. */
  | { k: "vec"; op: VecOp; d: number; a: number; b: number; imm: number }
  /** Byte sign bits of xmm a (pmovmskb) or dword sign bits (movmskps) into a general register. */
  | { k: "vmask"; d: number; a: number; lanes: 16 | 4 };

export type VecOp =
  | "and" | "or" | "xor" | "andn"
  | "add8" | "add16" | "add32" | "add64" | "sub8" | "sub16" | "sub32" | "sub64"
  | "eq8" | "eq16" | "eq32" | "gt8" | "gt16" | "gt32"
  | "minu8" | "maxu8" | "mins16" | "maxs16"
  | "shuffle" // imm indexes into a table of 16 byte selectors (see vecShuffles)
  | "shl16" | "shr16" | "sar16" | "shl32" | "shr32" | "sar32" | "shl64" | "shr64";

/**
 * Byte shuffles, as in wasm i8x16.shuffle: 16 indexes, 0..15 pick from a, 16..31 from b.
 * Decoders register a shuffle once and refer to it by number, so the IR stays small.
 */
export const vecShuffles: number[][] = [];
export function shuffleId(lanes: number[]): number {
  const key = lanes.join(",");
  const at = vecShuffles.findIndex((x) => x.join(",") === key);
  if (at >= 0) return at;
  vecShuffles.push(lanes);
  return vecShuffles.length - 1;
}

const toBytes = (lo: bigint, hi: bigint) => {
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(0, lo, true);
  dv.setBigUint64(8, hi, true);
  return b;
};
const fromBytes = (b: Uint8Array): [bigint, bigint] => {
  const dv = new DataView(b.buffer, b.byteOffset, 16);
  return [dv.getBigUint64(0, true), dv.getBigUint64(8, true)];
};

/** Reference semantics of a vector op on (lo, hi) pairs. Mirrors the wasm SIMD lowering. */
export function vecValue(op: VecOp, a: [bigint, bigint], b: [bigint, bigint], immv: number): [bigint, bigint] {
  if (op === "and") return [a[0] & b[0], a[1] & b[1]];
  if (op === "or") return [a[0] | b[0], a[1] | b[1]];
  if (op === "xor") return [a[0] ^ b[0], a[1] ^ b[1]];
  if (op === "andn") return [a[0] & ~b[0] & M64, a[1] & ~b[1] & M64]; // a & ~b (wasm v128.andnot)
  const A = toBytes(a[0], a[1]);
  const B = toBytes(b[0], b[1]);
  const R = new Uint8Array(16);
  if (op === "shuffle") {
    const lanes = vecShuffles[immv];
    for (let i = 0; i < 16; i += 1) R[i] = lanes[i] < 16 ? A[lanes[i]] : B[lanes[i] - 16];
    return fromBytes(R);
  }
  const size = Number(/\d+/.exec(op)![0]) / 8;
  const n = 16 / size;
  const av = new DataView(A.buffer);
  const bv = new DataView(B.buffer);
  const rv = new DataView(R.buffer);
  const bits = BigInt(size * 8);
  const lm = (1n << bits) - 1n;
  const get = (v: DataView, i: number) => {
    let x = 0n;
    for (let k = size - 1; k >= 0; k -= 1) x = (x << 8n) | BigInt(v.getUint8(i * size + k));
    return x;
  };
  const put = (i: number, x: bigint) => {
    for (let k = 0; k < size; k += 1) rv.setUint8(i * size + k, Number((x >> BigInt(8 * k)) & 0xffn));
  };
  const sgn = (x: bigint) => BigInt.asIntN(size * 8, x);
  for (let i = 0; i < n; i += 1) {
    const x = get(av, i);
    const y = get(bv, i);
    let r = 0n;
    if (op.startsWith("add")) r = (x + y) & lm;
    else if (op.startsWith("sub")) r = (x - y) & lm;
    else if (op.startsWith("eq")) r = x === y ? lm : 0n;
    else if (op.startsWith("gt")) r = sgn(x) > sgn(y) ? lm : 0n;
    else if (op === "minu8") r = x < y ? x : y;
    else if (op === "maxu8") r = x > y ? x : y;
    else if (op === "mins16") r = sgn(x) < sgn(y) ? x : y;
    else if (op === "maxs16") r = sgn(x) > sgn(y) ? x : y;
    else if (op.startsWith("shl")) r = (x << BigInt(immv)) & lm;
    else if (op.startsWith("shr")) r = x >> BigInt(immv);
    else if (op.startsWith("sar")) r = BigInt.asUintN(size * 8, sgn(x) >> BigInt(immv));
    put(i, r);
  }
  return fromBytes(R);
}

/** One source instruction and the IR it lifts to. */
export type Insn = { pc: bigint; len: number; next: bigint; ops: Op[]; fall: boolean; text: string };
export type Gap = { pc: bigint; bytes: string; reason: string };

/**
 * IR registers (64-bit each).
 *   0..15   x86: rax rcx rdx rbx rsp rbp rsi rdi r8..r15     ARM: x0..x15
 *   16..30  ARM: x16..x30            31 ARM sp
 *   32..34  temps                    35 write sink (ARM xzr as a destination)
 *   36      thread pointer (x86 fs base, ARM tpidr_el0)
 *   37..68  x86 xmm0..xmm15 as (low, high) 64-bit halves: xmm n = 37 + 2n, 38 + 2n
 *   69..70  xmm16: a temp vector for memory operands
 *   71      fourth temp
 */
export const NREG = 72;
/** A fourth temp, for decodings that need one more scratch value. */
export const T3 = 71;
export const T0 = 32;
export const T1 = 33;
export const T2 = 34;
export const SINK = 35;
export const TP = 36;
export const XMM = (n: number, half: 0 | 1 = 0) => 37 + n * 2 + half;

/** Why the machine stopped. Same codes from the interpreter and from the WebAssembly module. */
export const Stop = {
  running: 0,
  syscall: 1,
  fuel: 2,
  unmapped: 3,
  gap: 4,
  fault: 5,
  div0: 6,
  smc: 7,
  unsupported: 8,
  halt: 9,
} as const;
export type StopCode = (typeof Stop)[keyof typeof Stop];
export const STOP_NAME: Record<number, string> = {
  0: "running",
  1: "syscall",
  2: "out of fuel",
  3: "jumped to an address with no translation",
  4: "reached bytes the map does not know (not executed)",
  5: "memory fault",
  6: "divide error (by zero, or the quotient does not fit)",
  7: "program tried to modify its own code",
  8: "unsupported operation",
  9: "halted",
};

/** Guest memory layout. Address 0..0x1000 is the null page; the WebAssembly backend keeps CPU state there. */
export const NULL_PAGE = 0x1000;
/**
 * CPU state in the guest's null page. codeLo/codeHi hold the translated code range that stores are
 * checked against; the WebAssembly module writes them itself when run() starts.
 */
export const STATE = { regs: 0, pc: 0x300, flags: 0x308, fuel: 0x320, code: 0x328, fault: 0x330, codeLo: 0x340, codeHi: 0x348 } as const;

export const M64 = (1n << 64n) - 1n;
export const mask = (w: number): bigint => (w >= 64 ? M64 : (1n << BigInt(w)) - 1n);
export const u64 = (v: bigint): bigint => v & M64;
export const sx = (v: bigint, w: number): bigint => BigInt.asIntN(w, v);
export const imm = (v: bigint | number): Src => ({ imm: u64(BigInt(v)) });
export const reg = (r: number): Src => ({ r });

export function condNames(): Cond[] {
  return ["eq", "ne", "b", "ae", "be", "a", "s", "ns", "o", "no", "lt", "ge", "le", "gt", "cs", "cc", "hi", "ls", "al"];
}

/** p: x86 parity (even number of set bits in the low byte of the result; unordered for float compares). */
export type Flags = { z: number; s: number; c: number; o: number; k: number; p?: number };

export function evalCond(c: Cond, f: Flags): boolean {
  const carm = f.c ^ f.k;
  switch (c) {
    case "eq": return f.z === 1;
    case "ne": return f.z === 0;
    case "b": return f.c === 1;
    case "ae": return f.c === 0;
    case "be": return (f.c | f.z) === 1;
    case "a": return (f.c | f.z) === 0;
    case "s": return f.s === 1;
    case "ns": return f.s === 0;
    case "o": return f.o === 1;
    case "no": return f.o === 0;
    case "lt": return (f.s ^ f.o) === 1;
    case "ge": return (f.s ^ f.o) === 0;
    case "le": return (f.z | (f.s ^ f.o)) === 1;
    case "gt": return (f.z | (f.s ^ f.o)) === 0;
    case "cs": return carm === 1;
    case "cc": return carm === 0;
    case "hi": return carm === 1 && f.z === 0;
    case "ls": return carm === 0 || f.z === 1;
    case "al": return true;
    case "p": return f.p === 1;
    case "np": return f.p !== 1;
  }
}

/** Result of an ALU op at width w, as an unsigned w-bit value. */
export function aluValue(op: AluOp, a: bigint, b: bigint, w: number, cin = 0): bigint {
  const m = mask(w);
  const aw = a & m;
  const bw = b & m;
  const sh = bw & (w === 64 ? 63n : 31n);
  switch (op) {
    case "add": return (aw + bw) & m;
    case "adc": return (aw + bw + BigInt(cin)) & m;
    case "ctz": {
      // count trailing zeros of a (b unused); w when a is zero
      if (aw === 0n) return BigInt(w);
      let n = 0n;
      while (((aw >> n) & 1n) === 0n) n += 1n;
      return n;
    }
    case "clz": {
      if (aw === 0n) return BigInt(w);
      let n = 0n;
      while (((aw >> (BigInt(w) - 1n - n)) & 1n) === 0n) n += 1n;
      return n;
    }
    case "sbb": return (aw - bw - BigInt(cin)) & m;
    case "sub": return (aw - bw) & m;
    case "and": return aw & bw;
    case "or": return aw | bw;
    case "xor": return aw ^ bw;
    case "shl": return (aw << sh) & m;
    case "shr": return aw >> sh;
    case "sar": return BigInt.asUintN(w, sx(aw, w) >> sh);
    case "ror": {
      const n = bw % BigInt(w);
      return ((aw >> n) | (aw << (BigInt(w) - n))) & m;
    }
    case "mul": return (aw * bw) & m;
    case "umulh": return ((aw * bw) >> BigInt(w)) & m;
    case "smulh": return BigInt.asUintN(w, (sx(aw, w) * sx(bw, w)) >> BigInt(w));
    case "udiv": return bw === 0n ? 0n : aw / bw;
    case "urem": return bw === 0n ? aw : aw % bw;
    case "sdiv": {
      if (bw === 0n) return 0n;
      return BigInt.asUintN(w, sx(aw, w) / sx(bw, w));
    }
    case "srem": {
      if (bw === 0n) return aw;
      return BigInt.asUintN(w, sx(aw, w) % sx(bw, w));
    }
  }
}

/** 1 when the low byte has an even number of set bits. */
export function parity(r: bigint): number {
  let b = Number(r & 0xffn);
  b ^= b >> 4;
  b ^= b >> 2;
  b ^= b >> 1;
  return (b & 1) ^ 1;
}

export function flagsAfter(op: AluOp, mode: FlagMode, a: bigint, b: bigint, r: bigint, w: number, prev: Flags): Flags {
  if (mode === "none") return prev;
  const m = mask(w);
  const top = BigInt(w - 1);
  const aw = a & m;
  const bw = b & m;
  const z = r === 0n ? 1 : 0;
  const s = Number((r >> top) & 1n);
  const p = parity(r);
  if (mode === "logic" || mode === "shift") return { z, s, c: 0, o: 0, k: 0, p };
  const isSub = op === "sub" || op === "sbb";
  const o = isSub ? Number((((aw ^ bw) & (aw ^ r)) >> top) & 1n) : Number((((aw ^ r) & (bw ^ r)) >> top) & 1n);
  if (mode === "inc") return { z, s, c: prev.c, o, k: prev.k, p };
  const cin = BigInt(prev.c);
  const c =
    op === "adc" ? (aw + bw + cin > m ? 1 : 0)
    : op === "sbb" ? (aw < bw + cin ? 1 : 0)
    : isSub ? (aw < bw ? 1 : 0) : aw + bw > m ? 1 : 0;
  return { z, s, c, o, k: isSub ? 1 : 0, p };
}

export function nzcvFlags(nzcv: number, p?: number): Flags {
  // ARM order N Z C V. Stored with K = 0, so ARM carry reads straight from C.
  return { s: (nzcv >> 3) & 1, z: (nzcv >> 2) & 1, c: (nzcv >> 1) & 1, o: nzcv & 1, k: 0, p };
}

/** Value written into a register of old value `old` by a w-bit write of `v`. */
export function writeWidth(old: bigint, v: bigint, w: number): bigint {
  if (w === 64) return v & M64;
  if (w === 32) return v & 0xffffffffn;
  const m = mask(w);
  return (old & ~m & M64) | (v & m);
}

/** The CPU the guest is told it runs on: x86-64 baseline (v1). Leaf -> [eax, ebx, ecx, edx]. */
export const CPUID: [number, [number, number, number, number]][] = [
  [0x0, [0x1, 0x67726f46, 0x55504374, 0x72695665]], // max leaf 1, vendor "ForgeVirtCPU" (ebx, edx, ecx order)
  [0x1, [0x000306a9, 0x00000800, 0x00000000, 0x07808111]], // fpu tsc cx8 cmov mmx fxsr sse sse2 (no sse3+, no avx)
  [0x80000000, [0x80000001, 0, 0, 0]],
  [0x80000001, [0, 0, 0x00000001, 0x20100800]], // lahf; syscall nx lm
];

export function describeOp(op: Op): string {
  const s = (x: Src) => ("r" in x ? `r${x.r}` : `#0x${x.imm.toString(16)}`);
  const e = (x: Ea) =>
    `[${[x.base === null ? null : `r${x.base}`, x.index === null ? null : `r${x.index}*${x.scale}`, x.disp ? `0x${x.disp.toString(16)}` : null].filter(Boolean).join("+") || "0"}]`;
  switch (op.k) {
    case "mov": return `mov.${op.w} r${op.d}, ${s(op.s)}`;
    case "alu": return `${op.op}.${op.w}${op.f === "none" ? "" : "!"} ${op.d === null ? "_" : `r${op.d}`}, ${s(op.a)}, ${s(op.b)}`;
    case "ext": return `${op.signed ? "sext" : "zext"}${op.from} r${op.d}, ${s(op.s)}`;
    case "lea": return `lea r${op.d}, ${e(op.ea)}`;
    case "load": return `ld${op.size}${op.signed ? "s" : ""} r${op.d}, ${e(op.ea)}`;
    case "store": return `st${op.size} ${s(op.s)}, ${e(op.ea)}`;
    case "set": return `set.${op.c} r${op.d}`;
    case "csel": return `csel.${op.c} r${op.d}, ${s(op.a)}, ${s(op.b)}`;
    case "ccmp": return `ccmp.${op.c} ${s(op.a)}, ${s(op.b)}, #${op.nzcv}`;
    case "setnzcv": return `nzcv #${op.nzcv}`;
    case "br": return `b.${op.c} 0x${op.t.toString(16)}`;
    case "cbz": return `${op.nz ? "cbnz" : "cbz"} ${s(op.s)}, 0x${op.t.toString(16)}`;
    case "tbz": return `${op.nz ? "tbnz" : "tbz"} ${s(op.s)}, #${op.bit}, 0x${op.t.toString(16)}`;
    case "jmp": return `jmp 0x${op.t.toString(16)}`;
    case "jmpr": return `jmp ${s(op.s)}`;
    case "sys": return "syscall";
    case "guardz": return `guard ${s(op.s)} != 0`;
    case "guardext": return `guard r${op.hi} = ext(r${op.lo})`;
    case "halt": return `halt ${op.why}`;
    case "cpuid": return "cpuid";
    case "fop": return `f${op.op}${op.size === 4 ? "s" : "d"} x${op.d}, x${op.a}, x${op.b}`;
    case "fcvt": return op.kind === "i2f" ? `cvt i${op.w}->f${op.size * 8} x${op.d}, ${s(op.s)}` : op.kind === "f2i" ? `cvt f${op.size * 8}->i${op.w} r${op.d}, x${op.a}` : `cvt f${op.from * 8}->f${op.from === 8 ? 32 : 64} x${op.d}, x${op.a}`;
    case "fcmp": return `fcmp${op.size * 8} x${op.a}, x${op.b}`;
    case "div2": return `${op.signed ? "idiv" : "div"}${op.w} r2:r0, ${s(op.s)}`;
    case "flagsz": return `zs = ${s(op.v)}${op.when ? ` if ${s(op.when.s)}&${op.when.mask}` : ""}`;
    case "setflag": return `${op.flag}f = ${s(op.v)}[${op.bit}]${op.when ? ` if ${s(op.when.s)}&${op.when.mask}${op.when.eq === undefined ? "" : `==${op.when.eq}`}` : ""}`;
    case "vec": return `v.${op.op} x${op.d}, x${op.a}, x${op.b}${op.op === "shuffle" ? ` [${vecShuffles[op.imm].join(",")}]` : op.imm ? `, #${op.imm}` : ""}`;
    case "vmask": return `vmask${op.lanes} r${op.d}, x${op.a}`;
  }
}

// ---------- floating point reference semantics (x86 SSE scalar) ----------

const f64 = new Float64Array(1);
const u64v = new BigUint64Array(f64.buffer);
const f32 = new Float32Array(1);
const u32v = new Uint32Array(f32.buffer);
export const bitsToF64 = (b: bigint) => ((u64v[0] = b & M64), f64[0]);
export const f64ToBits = (x: number) => ((f64[0] = x), u64v[0]);
export const bitsToF32 = (b: bigint) => ((u32v[0] = Number(b & 0xffffffffn)), f32[0]);
export const f32ToBits = (x: number) => ((f32[0] = x), BigInt(u32v[0]));

/** x86 result for a NaN-producing operation: the default quiet NaN, negative. */
export const QNAN64 = 0xfff8000000000000n;
export const QNAN32 = 0xffc00000n;

export function floatOp(op: "add" | "sub" | "mul" | "div" | "min" | "max" | "sqrt", a: number, b: number, size: 4 | 8): number {
  const round = size === 4 ? Math.fround : (x: number) => x;
  switch (op) {
    case "add": return round(a + b);
    case "sub": return round(a - b);
    case "mul": return round(a * b);
    case "div": return round(a / b);
    case "sqrt": return round(Math.sqrt(b));
    case "min": return a < b ? a : b; // x86: anything else (NaN, equal zeros) gives the second operand
    case "max": return a > b ? a : b;
  }
}

/** cvt(t)sd2si: out of range or NaN gives the "integer indefinite" value (only the top bit set). */
export function floatToInt(x: number, w: 32 | 64, trunc: boolean): bigint {
  const v = trunc ? Math.trunc(x) : roundEven(x);
  const lim = w === 64 ? 2 ** 63 : 2 ** 31;
  if (!(v >= -lim && v < lim)) return w === 64 ? 0x8000000000000000n : 0x80000000n;
  return BigInt.asUintN(w, BigInt(v));
}

export function roundEven(x: number): number {
  if (!Number.isFinite(x)) return x;
  const r = Math.round(x);
  return Math.abs(x - Math.trunc(x)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const isNaNBits = (b: bigint, size: 4 | 8) =>
  size === 8 ? (b & 0x7ff0000000000000n) === 0x7ff0000000000000n && (b & 0x000fffffffffffffn) !== 0n : (b & 0x7f800000n) === 0x7f800000n && (b & 0x007fffffn) !== 0n;

/**
 * The NaN an x86 SSE operation returns: a NaN first operand (made quiet), else a NaN second operand,
 * else the default negative quiet NaN (for invalid operations such as 0/0 or sqrt(-1)).
 */
export function nanResult(aBits: bigint, bBits: bigint, size: 4 | 8, op: string): bigint {
  const a = size === 8 ? aBits & M64 : aBits & 0xffffffffn;
  const b = size === 8 ? bBits & M64 : bBits & 0xffffffffn;
  const quiet = size === 8 ? 0x0008000000000000n : 0x00400000n;
  if (op !== "sqrt" && isNaNBits(a, size)) return a | quiet;
  if (isNaNBits(b, size)) return b | quiet;
  return size === 8 ? QNAN64 : QNAN32;
}

/** int64 -> single precision with one correct rounding (to nearest even), as cvtsi2ss does. */
export function i64ToF32(v: bigint): number {
  const neg = v < 0n;
  let m = neg ? -v : v;
  if (m < 1n << 53n) return Math.fround(Number(v));
  // keep 25 significant bits plus a sticky bit, then let fround do the final rounding exactly
  let shift = 0n;
  while (m >> shift >= 1n << 26n) shift += 1n;
  const sticky = (m & ((1n << shift) - 1n)) !== 0n ? 1n : 0n;
  m = (m >> shift) | sticky;
  const x = Number(m) * 2 ** Number(shift);
  return Math.fround(neg ? -x : x);
}
